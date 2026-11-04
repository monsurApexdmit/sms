import dayjs from "dayjs";
import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "../i18n";

interface Props {
  /** "YYYY-MM-DD", or "" when empty */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}

/** Date field backed by the shadcn calendar. Works with plain YYYY-MM-DD strings. */
export function DatePicker({ value, onChange, placeholder = t("Pick a date"), disabled, clearable = true, className, id, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const date = value && dayjs(value).isValid() ? dayjs(value).toDate() : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={rest["aria-invalid"]}
          className={cn("w-full justify-between px-3 font-normal", !date && "text-muted-foreground", className)}
        >
          {date ? dayjs(date).format("DD MMM YYYY") : placeholder}
          <span className="flex items-center gap-1">
            {clearable && date && !disabled && (
              <XIcon
                className="opacity-50 hover:opacity-100"
                aria-label={t("Clear")}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }}
              />
            )}
            <CalendarIcon className="opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          startMonth={new Date(1950, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          onSelect={(d) => {
            onChange(d ? dayjs(d).format("YYYY-MM-DD") : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
