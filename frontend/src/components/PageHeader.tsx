import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { NAV } from "../nav";

/** Page title with the section's icon (taken from the menu entry for the current address). */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const Icon = NAV.find((n) => pathname === `/app/${n.path}` || pathname.startsWith(`/app/${n.path}/`))?.icon;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
      <div className="flex min-w-0 items-center gap-4">
        {Icon && (
          <div className="from-primary text-primary-foreground shadow-primary/25 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br to-[color-mix(in_oklch,var(--primary),black_30%)] shadow-lg print:hidden">
            <Icon className="size-[22px]" />
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-[1.75rem]">{title}</h1>
          {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
