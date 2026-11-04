import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { t } from "../i18n";

/** Loading / empty rows for a <TableBody>. Renders nothing once there is data. */
export function TableState({ loading, empty, colSpan, emptyText = t("No records yet") }: { loading?: boolean; empty?: boolean; colSpan: number; emptyText?: string }) {
  if (loading)
    return (
      <>
        {[0, 1, 2].map((i) => (
          <TableRow key={i}>
            <TableCell colSpan={colSpan}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  if (empty)
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="text-muted-foreground py-10 text-center">
          {emptyText}
        </TableCell>
      </TableRow>
    );
  return null;
}

export function EmptyState({ icon: Icon = InboxIcon, title, children, className }: { icon?: LucideIcon; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center", className)}>
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted-foreground text-sm">{children}</div>}
    </div>
  );
}

export const Dash = () => <span className="text-muted-foreground">—</span>;
