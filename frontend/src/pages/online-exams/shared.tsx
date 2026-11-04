import { type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { Question } from "../../api/types";
import { Dash } from "../../components/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { t } from "../../i18n";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-transparent",
  published: "bg-success/15 text-success border-transparent",
  expired: "",
};
export const TYPE_LABEL: Record<Question["type"], string> = {
  multiple_choice: t("Multiple choice"),
  true_false: t("True / false"),
  fill_in_the_blanks: t("Fill in the blanks"),
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "expired" ? "secondary" : "outline"} className={cn("capitalize", STATUS_CLASS[status])}>
      {status}
    </Badge>
  );
}

export function ResultBadge({ result, className }: { result: string | null | undefined; className?: string }) {
  if (!result) return <Dash />;
  return result === "pass" ? (
    <Badge className={cn("bg-success/15 text-success border-transparent capitalize", className)}>{result}</Badge>
  ) : (
    <Badge variant="destructive" className={cn("capitalize", className)}>
      {result}
    </Badge>
  );
}

/** JSON list stored as text in question_bank (options / correct_answers). */
export function parseList(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return raw ? [raw] : [];
  }
}

/** Legacy questions mark blanks with ^, new ones with ___. */
export const blankify = (title: string) => title.replace(/\^/g, "________");

export function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

/** Icon-only link styled like IconAction. */
export function IconLink({ label, to, children }: { label: string; to: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild size="icon-sm" variant="ghost">
          <Link to={to} aria-label={label}>
            {children}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
