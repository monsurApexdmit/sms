import { describe, expect, it } from "vitest";

import { findPhoto, isPhotoDocument } from "./admission-photo";

describe("admission photo", () => {
  it("needs a photo label and an image file", () => {
    expect(isPhotoDocument({ label: "Photo", file_name: "a1_me.JPG" })).toBe(true);
    expect(isPhotoDocument({ label: "Student picture", file_name: "a.webp" })).toBe(true);
    expect(isPhotoDocument({ label: "ছবি", file_name: "a.png" })).toBe(true);
    expect(isPhotoDocument({ label: "Photo", file_name: "a.pdf" })).toBe(false);
    expect(isPhotoDocument({ label: "Birth certificate", file_name: "a.jpg" })).toBe(false);
  });

  it("picks the most recent photo", () => {
    const docs = [
      { label: "Photo", file_name: "old.jpg" },
      { label: "Birth certificate", file_name: "bc.jpg" },
      { label: "Photo", file_name: "new.jpg" },
    ];
    expect(findPhoto(docs)?.file_name).toBe("new.jpg");
    expect(findPhoto([])).toBeUndefined();
    expect(findPhoto([{ label: "Birth certificate", file_name: "bc.jpg" }])).toBeUndefined();
  });

  it("falls back to an unlabelled image", () => {
    const scan = { label: "Document", file_name: "scan.pdf" };
    const first = { label: "Document", file_name: "a.png" };
    expect(findPhoto([scan, first, { label: "Document", file_name: "b.jpg" }])).toBe(first);
    expect(findPhoto([first, { label: "Photo", file_name: "p.jpg" }])?.file_name).toBe("p.jpg");
    expect(findPhoto(undefined)).toBeUndefined();
  });
});
