import { useQueryClient } from "@tanstack/react-query";
import { SmartphoneIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction } from "../api/hooks";
import type { LocalGateway } from "../api/types";
import { Button } from "./ui/button";

export const GATEWAY_LABELS: Record<LocalGateway, string> = { bkash: "bKash", nagad: "Nagad", sslcommerz: "SSLCommerz" };
const ORDER: LocalGateway[] = ["bkash", "nagad", "sslcommerz"];

/** "Pay with bKash / Nagad / SSLCommerz" buttons for one unpaid invoice. The server picks the amount. */
export function LocalPayButtons({ invoiceId, gateways, disabled }: { invoiceId: number; gateways: LocalGateway[] | undefined; disabled?: boolean }) {
  const start = useAction(
    async ({ gateway }: { gateway: LocalGateway }) => (await api.post<{ redirect_url: string }>(`/invoices/${invoiceId}/${gateway}-checkout`)).data,
    {
      onSuccess: (r) => {
        window.location.href = r.redirect_url;
      },
    },
  );
  return (
    <>
      {ORDER.filter((g) => gateways?.includes(g)).map((gateway) => (
        <Button
          key={gateway}
          size="sm"
          variant="outline"
          loading={start.isPending && start.variables?.gateway === gateway}
          disabled={disabled || start.isPending}
          onClick={() => start.mutate({ gateway })}
        >
          <SmartphoneIcon />
          {GATEWAY_LABELS[gateway]}
        </Button>
      ))}
    </>
  );
}

/**
 * The gateways send the browser back to /app/my-invoices?gateway=…&result=…&ref=… (through the API's
 * /return endpoints). On success the server is asked to confirm with the gateway; handled exactly once.
 */
export function useLocalGatewayReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const handled = useRef(false);

  useEffect(() => {
    const gateway = params.get("gateway") as LocalGateway | null;
    if (!gateway || !(gateway in GATEWAY_LABELS) || handled.current) return;
    handled.current = true;
    const label = GATEWAY_LABELS[gateway];
    const result = params.get("result");
    const ref = params.get("ref");
    const strip = () => {
      const next = new URLSearchParams(params);
      ["gateway", "result", "ref"].forEach((k) => next.delete(k));
      const search = next.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    };
    if (result !== "success" || !ref) {
      if (result === "cancel") toast.info(`${label} payment cancelled. Your invoice has not been charged.`);
      else toast.error(`${label} payment did not go through. Your invoice has not been charged.`);
      strip();
      return;
    }
    api
      .post<{ status: "paid" | "pending" | "failed"; invoice_id: number }>(`/payments/${gateway}/confirm`, { ref })
      .then(({ data: r }) => {
        if (r.status === "paid") toast.success("Payment received. Thank you!");
        else if (r.status === "failed") toast.error(`${label} reports that the payment failed. Your invoice has not been charged.`);
        else toast.info(`${label} is still processing your payment. The invoice will update once it is confirmed.`);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => {
        qc.invalidateQueries({ queryKey: ["/invoices/mine"] });
        qc.invalidateQueries({ queryKey: ["/invoices"] });
        strip();
      });
  }, [params, navigate, location.pathname, qc]);
}
