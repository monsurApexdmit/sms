import axios from "axios";
import { FileSpreadsheetIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { Button } from "./ui/button";
import { t } from "../i18n";

/** Turns a blob error body (responseType "blob") back into JSON so errorMessage can read it. */
async function blobError(error: unknown): Promise<unknown> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await error.response.data.text());
    } catch {
      // not JSON; keep the generic message
    }
  }
  return error;
}

/** Downloads a file from the API and saves it under the server's file name. */
export async function downloadFile(path: string, params?: Record<string, unknown>, fallbackName = "download") {
  try {
    const res = await api.get<Blob>(path, { params, responseType: "blob" });
    const match = /filename="?([^";]+)"?/.exec(String(res.headers["content-disposition"] ?? ""));
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    throw await blobError(error);
  }
}

/** "Export to Excel" for a list screen; `params` should be the screen's current filters. */
export function ExportButton({
  path, params, label = t("Export to Excel"), size = "sm", variant = "outline", ...rest
}: { path: string; params?: Record<string, unknown>; label?: string } & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {  // prettier-ignore
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadFile(path, params, "export.xlsx");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size={size} variant={variant} loading={busy} onClick={run} {...rest}>
      <FileSpreadsheetIcon />
      {label}
    </Button>
  );
}
