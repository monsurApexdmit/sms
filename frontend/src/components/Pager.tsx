import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t, tn } from "../i18n";

/** "1–50 of 312" with previous/next buttons, for lists paged on the server. Hidden when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  const last = Math.ceil(total / pageSize) - 1;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="no-print flex items-center justify-end gap-2 border-t p-3 text-sm">
      <span className="text-muted-foreground tabular-nums">
        {tn("{from}–{to} of {total}", { from, to, total })}
      </span>
      <Button variant="outline" size="icon-sm" aria-label={t("Previous page")} disabled={page <= 0} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label={t("Next page")} disabled={page >= last} onClick={() => onPage(page + 1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
