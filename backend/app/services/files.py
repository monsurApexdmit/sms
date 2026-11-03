"""Upload handling.

Fixes the legacy app's main hole: uploads kept their original name and any
extension (including .php) inside the web root. Here every file is
extension-whitelisted, renamed, size-limited, and only served through
`/api/media` with a signed URL.
"""

import io
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings
from app.core.security import sign_media_path

DOCUMENT_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "odt", "ods",
    "jpg", "jpeg", "png", "gif", "webp", "mp3", "mp4", "zip",
}  # fmt: skip
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}

# Directory names match the legacy `uploads/` layout so old files still resolve.
DIRS = {
    "syllabus": "syllabus",
    "document": "document",
    "message": "private_messaging_attached_file",
    "group_message": "group_messaging_attached_file",
    "news": "frontend/news_image",
    "gallery_cover": "frontend/gallery_cover",
    "gallery_image": "frontend/gallery_images",
    "notice": "frontend/noticeboard",
    "slider": "frontend/slider",
    "site": "frontend",
    "admission": "admission_document",
}


def upload_root() -> Path:
    root = get_settings().upload_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_path(relative: str) -> Path:
    """Resolve a path inside the upload root, refusing traversal."""
    root = upload_root()
    target = (root / relative).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid path")
    return target


def _extension(filename: str | None) -> str:
    return (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""


def _clean_name(filename: str | None) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", (filename or "file").rsplit("/", 1)[-1])
    return stem.strip("._")[:80] or "file"


async def _read_limited(upload: UploadFile) -> bytes:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File larger than {get_settings().max_upload_mb} MB")
    return data


async def save_document(upload: UploadFile, kind: str, allowed: set[str] = DOCUMENT_EXTENSIONS) -> str:
    """Store an attachment and return the file name to keep in the DB column."""
    ext = _extension(upload.filename)
    if ext not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"File type .{ext or '?'} is not allowed")
    data = await _read_limited(upload)
    name = f"{uuid.uuid4().hex[:12]}_{_clean_name(upload.filename)}"
    if not name.lower().endswith(f".{ext}"):
        name = f"{name}.{ext}"
    target = safe_path(f"{DIRS[kind]}/{name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return name


async def save_image(upload: UploadFile, relative: str, *, max_side: int = 1600) -> str:
    """Decode, re-encode as JPEG and store at a fixed path. Re-encoding strips
    anything that is not image data, so a disguised script cannot survive."""
    if _extension(upload.filename) not in IMAGE_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only image files are allowed")
    data = await _read_limited(upload)
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not a valid image") from None
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    target = safe_path(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, "JPEG", quality=88)
    return target.name


async def save_site_image(upload: UploadFile, kind: str) -> str:
    name = f"{uuid.uuid4().hex[:16]}.jpg"
    await save_image(upload, f"{DIRS[kind]}/{name}")
    return name


def delete_file(kind: str, name: str | None) -> None:
    if not name:
        return
    try:
        safe_path(f"{DIRS[kind]}/{name}").unlink(missing_ok=True)
    except HTTPException:
        pass


def media_url(kind: str, name: str | None, seconds: int | None = None) -> str | None:
    if not name:
        return None
    return sign_media_path(f"{DIRS[kind]}/{name}", seconds)


def user_image_url(role: str, user_id: int, seconds: int | None = None) -> str | None:
    relative = f"{role}_image/{user_id}.jpg"
    if safe_path(relative).is_file():
        return sign_media_path(relative, seconds)
    return None
