import { BusIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { useGet } from "../api/hooks";
import type { TransportExpiry } from "../api/types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { t, tn, tp } from "../i18n";

const WHAT: Record<TransportExpiry["kind"], string> = { insurance: t("insurance"), fitness: t("fitness certificate"), licence: t("driving licence") };

export const expiryText = (e: TransportExpiry) =>
  e.days_left < 0
    ? tp(-e.days_left, "{label}: {what} expired {count} day ago", "{label}: {what} expired {count} days ago", { label: e.label, what: WHAT[e.kind] })
    : e.days_left === 0
      ? t("{label}: {what} expires today", { label: e.label, what: WHAT[e.kind] })
      : tp(e.days_left, "{label}: {what} expires in {count} day", "{label}: {what} expires in {count} days", { label: e.label, what: WHAT[e.kind] });

/** Admin-only: vehicle insurance/fitness and driver licences expiring within 30 days. Renders nothing when all is current. */
export function TransportExpiryAlert({ linkToPage = true }: { linkToPage?: boolean }) {
  const { data } = useGet<TransportExpiry[]>("/transport/expiring");
  if (!data?.length) return null;
  const expired = data.some((e) => e.days_left < 0);
  return (
    <Alert variant={expired ? "destructive" : "default"}>
      <BusIcon />
      <AlertTitle>{t("Transport documents need renewing")}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {data.slice(0, 5).map((e) => (
            <li key={`${e.kind}-${e.item_id}`}>{expiryText(e)}</li>
          ))}
          {data.length > 5 && <li>{tn("and {value} more", { value: data.length - 5 })}</li>}
        </ul>
        {linkToPage && (
          <Link to="/app/transport" className="text-primary font-medium underline underline-offset-4">
            {t("Open transport")}</Link>
        )}
      </AlertDescription>
    </Alert>
  );
}
