// The applicant's photo is stored as an ordinary admission document. The public form and
// the office upload it under this label; older uploads labelled "photo", "picture" or
// "ছবি" count too, as long as the file is an image.
export const PHOTO_LABEL = "Photo";
export const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp";

const PHOTO_WORDS = /photo|picture|ছবি/i;
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

export function isPhotoDocument(d: { label: string; file_name: string }): boolean {
  return PHOTO_WORDS.test(d.label) && IMAGE_FILE.test(d.file_name);
}

/** An image uploaded without a label of its own (stored as "Document"). */
const unlabelledImage = (d: { label: string; file_name: string }) => /^(document)?$/i.test(d.label.trim()) && IMAGE_FILE.test(d.file_name);

/**
 * The most recent photo: replacing a photo uploads a new one, which then wins. Without one,
 * an image attached with no label (applicants often attach the photo that way) stands in.
 */
export function findPhoto<D extends { label: string; file_name: string }>(docs: D[] | null | undefined): D | undefined {
  const newest = [...(docs ?? [])].reverse();
  return newest.find(isPhotoDocument) ?? [...newest].reverse().find(unlabelledImage);
}
