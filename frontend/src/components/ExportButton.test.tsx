import { AxiosError, AxiosHeaders } from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { ExportButton, downloadFile } from "./ExportButton";

let clicked: { href: string; download: string }[] = [];

beforeEach(() => {
  clicked = [];
  // jsdom has no object URLs and does not follow downloads
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});

const xlsx = (disposition?: string) => ({
  data: new Blob(["x"]),
  headers: disposition ? { "content-disposition": disposition } : {},
});

describe("downloadFile", () => {
  it("saves under the server's file name and passes the filters on", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(xlsx('attachment; filename="invoices-2026-11-03.xlsx"'));
    await downloadFile("/export/invoices.xlsx", { status: "unpaid" });
    expect(get).toHaveBeenCalledWith("/export/invoices.xlsx", { params: { status: "unpaid" }, responseType: "blob" });
    expect(clicked).toEqual([{ href: "blob:test", download: "invoices-2026-11-03.xlsx" }]);
    expect(document.querySelector("a")).toBeNull(); // the temporary link is removed
  });

  it("falls back to the given name", async () => {
    vi.spyOn(api, "get").mockResolvedValue(xlsx());
    await downloadFile("/export/x", undefined, "export.xlsx");
    expect(clicked[0]?.download).toBe("export.xlsx");
  });
});

describe("ExportButton", () => {
  it("shows the API's error message from a blob error body", async () => {
    const body = new Blob([JSON.stringify({ detail: "Too many rows to export (60000). Narrow the filters." })]);
    const error = new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 422, statusText: "", data: body, headers: {}, config: { headers: new AxiosHeaders() },
    });  // prettier-ignore
    vi.spyOn(api, "get").mockRejectedValue(error);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "id");

    render(<ExportButton path="/export/students.xlsx" />);
    fireEvent.click(screen.getByRole("button", { name: /export to excel/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many rows to export (60000). Narrow the filters."));
    expect(clicked).toEqual([]);
    expect(screen.getByRole("button", { name: /export to excel/i })).toBeEnabled();
  });
});
