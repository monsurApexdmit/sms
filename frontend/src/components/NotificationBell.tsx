import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type Page } from "../api/client";
import type { AppNotification } from "../api/types";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { t } from "../i18n";

/** Unread count (polled every minute and when the window regains focus) and the latest notifications. */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const count = useQuery({
    queryKey: ["/notifications/unread-count"],
    queryFn: async () => (await api.get<{ count: number }>("/notifications/unread-count")).data.count,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const latest = useQuery({
    queryKey: ["/notifications", { limit: 8 }],
    queryFn: async () => (await api.get<Page<AppNotification>>("/notifications", { params: { limit: 8 } })).data,
    enabled: open,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/notifications"] }).then(() => qc.invalidateQueries({ queryKey: ["/notifications/unread-count"] }));

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) await api.post(`/notifications/${n.notification_id}/read`).catch(() => undefined);
    refresh();
    navigate(n.link || "/app/notifications");
  };
  const readAll = async () => {
    await api.post("/notifications/read-all");
    refresh();
  };
  const unread = count.data ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? t("Notifications, {unread} unread", { unread }) : t("Notifications")}>
          <BellIcon />
          {unread > 0 && (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("Notifications")}</span>
          <Button variant="ghost" size="xs" disabled={unread === 0} onClick={readAll}>
            <CheckCheckIcon />
            {t("Mark all read")}</Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {latest.isLoading && <p className="text-muted-foreground p-4 text-sm">{t("Loading…")}</p>}
          {latest.data?.items.length === 0 && <p className="text-muted-foreground p-6 text-center text-sm">{t("You're all caught up")}</p>}
          {latest.data?.items.map((n) => (
            <button
              key={n.notification_id}
              type="button"
              onClick={() => openItem(n)}
              className={cn("hover:bg-muted/60 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left last:border-0", !n.read_at && "bg-primary/5")}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {!n.read_at && <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                <span className="truncate">{n.title}</span>
              </span>
              {n.body && <span className="text-muted-foreground line-clamp-2 text-xs">{n.body}</span>}
              <span className="text-muted-foreground text-[11px]">{dayjs(n.created_at).format("DD MMM, HH:mm")}</span>
            </button>
          ))}
        </div>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => { setOpen(false); navigate("/app/notifications"); }}>
            {t("See all")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
