import { BanknoteIcon, OctagonAlertIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { useGet, usePublicSettings } from "../api/hooks";
import type { AnalyticsSummary } from "../api/types";
import { money } from "../utils";
import { StatTile } from "./StatTile";
import { t } from "../i18n";

/** Two admin dashboard tiles linking to the full analytics. */
export function AnalyticsTiles() {
  const currency = usePublicSettings().data?.currency || "usd";
  const { data } = useGet<AnalyticsSummary>("/analytics/summary");
  if (!data) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Link to="/app/analytics" className="rounded-xl focus-visible:outline-2">
        <StatTile label={t("Students at risk")} value={data.at_risk_high} hint={t("High risk; {at_risk_medium} more at medium", { at_risk_medium: data.at_risk_medium })} icon={OctagonAlertIcon} tone="destructive" />
      </Link>
      <Link to="/app/analytics" className="rounded-xl focus-visible:outline-2">
        <StatTile label={t("Fees collected this month")} value={money(data.collected_this_month, currency)} hint={t("{billed_this_month} billed this month", { billed_this_month: money(data.billed_this_month, currency) })} icon={BanknoteIcon} tone="success" />
      </Link>
    </div>
  );
}
