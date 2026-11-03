import dayjs from "dayjs";

/** Legacy tables store unix seconds, often as strings. */
export function fromUnix(value: string | number | null | undefined, format = "DD MMM YYYY"): string {
  const n = Number(value);
  if (!value || Number.isNaN(n) || n <= 0) return "—";
  return dayjs.unix(n).format(format);
}

export function money(value: string | number | null | undefined, currency = "usd"): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const toOptions = <T,>(items: T[] | undefined, value: keyof T, label: keyof T) =>
  (items ?? []).map((item) => ({ value: String(item[value]), label: String(item[label] ?? "") }));

export const DAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const;

export function initials(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
