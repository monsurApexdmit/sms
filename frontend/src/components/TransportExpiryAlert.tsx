import { BusIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { useGet } from "../api/hooks";
import type { TransportExpiry } from "../api/types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

const WHAT: Record<TransportExpiry["kind"], string> = { insurance: "insurance", fitness: "fitness certificate", licence: "driving licence" };

export const expiryText = (e: TransportExpiry) =>
  `${e.label}: ${WHAT[e.kind]} ${e.days_left < 0 ? `expired ${-e.days_left} day${e.days_left === -1 ? "" : "s"} ago` : e.days_left === 0 ? "expires today" : `expires in ${e.days_left} day${e.days_left === 1 ? "" : "s"}`}`;

/** Admin-only: vehicle insurance/fitness and driver licences expiring within 30 days. Renders nothing when all is current. */
export function TransportExpiryAlert({ linkToPage = true }: { linkToPage?: boolean }) {
  const { data } = useGet<TransportExpiry[]>("/transport/expiring");
  if (!data?.length) return null;
  const expired = data.some((e) => e.days_left < 0);
  return (
    <Alert variant={expired ? "destructive" : "default"}>
      <BusIcon />
      <AlertTitle>Transport documents need renewing</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {data.slice(0, 5).map((e) => (
            <li key={`${e.kind}-${e.item_id}`}>{expiryText(e)}</li>
          ))}
          {data.length > 5 && <li>and {data.length - 5} more</li>}
        </ul>
        {linkToPage && (
          <Link to="/app/transport" className="text-primary font-medium underline underline-offset-4">
            Open transport
          </Link>
        )}
      </AlertDescription>
    </Alert>
  );
}
