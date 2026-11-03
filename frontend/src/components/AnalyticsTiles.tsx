import { BanknoteIcon, OctagonAlertIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { useGet, usePublicSettings } from "../api/hooks";
import type { AnalyticsSummary } from "../api/types";
import { money } from "../utils";
import { StatTile } from "./StatTile";

/** Two admin dashboard tiles linking to the full analytics. */
export function AnalyticsTiles() {
  const currency = usePublicSettings().data?.currency || "usd";
  const { data } = useGet<AnalyticsSummary>("/analytics/summary");
  if (!data) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Link to="/app/analytics" className="rounded-xl focus-visible:outline-2">
        <StatTile label="Students at risk" value={data.at_risk_high} hint={`High risk; ${data.at_risk_medium} more at medium`} icon={OctagonAlertIcon} tone="destructive" />
      </Link>
      <Link to="/app/analytics" className="rounded-xl focus-visible:outline-2">
        <StatTile label="Fees collected this month" value={money(data.collected_this_month, currency)} hint={`${money(data.billed_this_month, currency)} billed this month`} icon={BanknoteIcon} tone="success" />
      </Link>
    </div>
  );
}
