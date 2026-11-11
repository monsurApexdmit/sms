import { t } from "../i18n";

/** How an admission application fee was paid (paid outside the system, recorded by transaction ID). */
export const PAYMENT_METHODS = [
  { value: "bkash", label: t("bKash") },
  { value: "nagad", label: t("Nagad") },
  { value: "rocket", label: t("Rocket") },
  { value: "bank", label: t("Bank deposit or transfer") },
  { value: "cash", label: t("Cash at the office") },
  { value: "other", label: t("Other") },
];

export const paymentMethodLabel = (value: string | null | undefined) => PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value ?? "";
