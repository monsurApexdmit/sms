import { CheckIcon, LanguagesIcon } from "lucide-react";
import { useEffect } from "react";

import { usePublicSettings } from "../api/hooks";
import { LANGUAGES, applySchoolLanguage, digits, lang, setDigits, setLanguage, t } from "../i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Follows the school's default language (System settings) until the person picks one here. */
export function useSchoolLanguage() {
  const settings = usePublicSettings();
  const school = settings.data?.language;
  useEffect(() => {
    if (school !== undefined) applySchoolLanguage(school);
  }, [school]);
}

/** Language menu for the app header, the sign-in page and the public website. Choosing reloads the page. */
export function LanguageSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  useSchoolLanguage();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "icon" : "sm"} className={cn("gap-1.5", className)} aria-label={t("Language")}>
          <LanguagesIcon />
          {!compact && <span lang={current.code}>{current.label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t("Language")}</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} lang={l.code} onSelect={() => setLanguage(l.code)}>
            <CheckIcon className={cn(l.code === lang ? "opacity-100" : "opacity-0")} />
            {l.label}
          </DropdownMenuItem>
        ))}
        {lang !== "en" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("Numbers")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setDigits("latn")}>
              <CheckIcon className={cn(digits === "latn" ? "opacity-100" : "opacity-0")} />
              123
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDigits("beng")}>
              <CheckIcon className={cn(digits === "beng" ? "opacity-100" : "opacity-0")} />
              ১২৩
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
