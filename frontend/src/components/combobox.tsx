import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t, tn } from "../i18n";

export type Option = { value: string; label: string };

interface BaseProps {
  data: Option[];
  placeholder?: string;
  disabled?: boolean;
  /** shown when the list is empty or nothing matches the search */
  emptyText?: string;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}

/** Searchable single select. `value` is null when nothing is chosen. */
export function Combobox({
  data, value, onChange, placeholder = t("Select…"), disabled, emptyText = t("Nothing found"), clearable, className, id, ...rest
}: BaseProps & { value: string | null | undefined; onChange: (value: string | null) => void; clearable?: boolean }) {  // prettier-ignore
  const [open, setOpen] = useState(false);
  const selected = data.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={rest["aria-invalid"]}
          disabled={disabled}
          className={cn("w-full justify-between px-3 font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <span className="flex items-center gap-1">
            {clearable && selected && !disabled && (
              <XIcon
                className="opacity-50 hover:opacity-100"
                aria-label={t("Clear")}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }}
              />
            )}
            <ChevronsUpDownIcon className="opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-48 p-0" align="start">
        <Command>
          {data.length > 7 && <CommandInput placeholder={t("Search…")} />}
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {data.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value === value && clearable ? null : o.value);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn(o.value === value ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable multi select shown as badges. */
export function MultiCombobox({
  data, value, onChange, placeholder = t("Select…"), disabled, emptyText = t("Nothing found"), className, id,
}: BaseProps & { value: string[]; onChange: (value: string[]) => void }) {  // prettier-ignore
  const [open, setOpen] = useState(false);
  const labels = new Map(data.map((o) => [o.value, o.label]));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal", className)}
        >
          <span className="flex flex-wrap gap-1">
            {value.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {value.slice(0, 6).map((v) => (
              <Badge key={v} variant="secondary">
                {labels.get(v) ?? v}
              </Badge>
            ))}
            {value.length > 6 && <Badge variant="outline">{tn("+{value} more", { value: value.length - 6 })}</Badge>}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("Search…")} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {data.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)}>
                  <CheckIcon className={cn(value.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                {t("Clear selection")}</Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
