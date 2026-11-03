import dayjs from "dayjs";
import { CalendarCheckIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useGet } from "../api/hooks";
import type { CalendarEvent, SchoolYear } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { t as tr } from "../i18n";

// --- academic calendar ------------------------------------------------------------

const KINDS: Record<CalendarEvent["kind"], [string, string]> = {
  holiday: [tr("Holiday"), "bg-destructive/10 text-destructive"],
  exam: [tr("Exam"), "bg-warning/20 text-amber-700 dark:text-amber-300"],
  event: [tr("Event"), "bg-primary/10 text-primary"],
  meeting: [tr("Meeting"), "bg-chart-2/15 text-chart-2"],
  other: [tr("Other"), "bg-muted text-foreground"],
};
const AUDIENCES = [
  { value: "all", label: tr("Everyone") },
  { value: "staff", label: tr("Staff") },
  { value: "students", label: tr("Students") },
  { value: "parents", label: tr("Parents") },
];

type EventValues = Omit<CalendarEvent, "event_id" | "description"> & { description: string };
const EMPTY_EVENT: EventValues = { title: "", kind: "event", audience: "all", start_date: "", end_date: "", description: "" };

const fmtRange = (e: Pick<CalendarEvent, "start_date" | "end_date">) =>
  e.start_date === e.end_date ? dayjs(e.start_date).format("DD MMM YYYY") : `${dayjs(e.start_date).format("DD MMM")} – ${dayjs(e.end_date).format("DD MMM YYYY")}`;

function EventForm({ event, onDone }: { event: CalendarEvent | null; onDone: () => void }) {
  const form = useForm<EventValues>({
    defaultValues: event ? { ...event, description: event.description ?? "" } : { ...EMPTY_EVENT, start_date: dayjs().format("YYYY-MM-DD") },
  });
  const { errors } = form.formState;
  const save = useAction(
    (v: EventValues) => {
      const body = { ...v, end_date: v.end_date || v.start_date, description: v.description || null };
      return event ? api.put(`/calendar/${event.event_id}`, body) : api.post("/calendar", body);
    },
    { success: tr("Saved"), invalidate: [["/calendar"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label={tr("Title")} htmlFor="ev-title" required error={errors.title?.message}>
        <Input id="ev-title" aria-invalid={!!errors.title} {...form.register("title", { required: tr("Required") })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="kind" render={({ field }) => (
          <Field label={tr("Type")}>
            <Combobox data={Object.entries(KINDS).map(([value, [label]]) => ({ value, label }))} value={field.value} onChange={(v) => field.onChange(v ?? "event")} />
          </Field>
        )} />
        <Controller control={form.control} name="audience" render={({ field }) => (
          <Field label={tr("Shown to")}>
            <Combobox data={AUDIENCES} value={field.value} onChange={(v) => field.onChange(v ?? "all")} />
          </Field>
        )} />
        <Controller control={form.control} name="start_date" rules={{ required: tr("Required") }} render={({ field }) => (
          <Field label={tr("From")} required error={errors.start_date?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
        <Controller control={form.control} name="end_date" render={({ field }) => (
          <Field label={tr("To")} description={tr("Leave empty for a one-day event")}>
            <DatePicker value={field.value} onChange={field.onChange} />
          </Field>
        )} />
      </div>
      <Field label={tr("Details")} htmlFor="ev-desc">
        <Textarea id="ev-desc" rows={3} {...form.register("description")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

export function CalendarPage() {
  const user = useUser();
  const isAdmin = user.role === "admin";
  const [month, setMonth] = useState(() => dayjs().startOf("month"));
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const first = month.startOf("month");
  const last = month.endOf("month");
  const { data: events, isLoading } = useGet<CalendarEvent[]>("/calendar", { from: first.format("YYYY-MM-DD"), to: last.format("YYYY-MM-DD") });
  const offDays = useGet<number[]>("/calendar/weekly-off-days");
  const remove = useAction((id: number) => api.delete(`/calendar/${id}`), { success: tr("Deleted"), invalidate: [["/calendar"]] });
  const today = dayjs().format("YYYY-MM-DD");

  const onDay = (d: string) => (events ?? []).filter((e) => e.start_date <= d && d <= e.end_date);
  // API weekdays are Monday = 0; dayjs is Sunday = 0
  const isOff = (d: dayjs.Dayjs) => (offDays.data ?? []).includes((d.day() + 6) % 7);

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Academic calendar")}
        subtitle={tr("Holidays, exams, events and meetings. Holidays and weekly days off are left out of attendance working days.")}
        actions={isAdmin && (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {tr("Add to calendar")}</Button>
        )}  // prettier-ignore
      />
      <Card className="gap-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{month.format("MMMM YYYY")}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth(dayjs().startOf("month"))}>{tr("Today")}</Button>
            <Button variant="outline" size="icon-sm" aria-label={tr("Previous month")} onClick={() => setMonth(month.subtract(1, "month"))}><ChevronLeftIcon /></Button>
            <Button variant="outline" size="icon-sm" aria-label={tr("Next month")} onClick={() => setMonth(month.add(1, "month"))}><ChevronRightIcon /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {[tr("Sun"), tr("Mon"), tr("Tue"), tr("Wed"), tr("Thu"), tr("Fri"), tr("Sat")].map((d) => (
              <div key={d} className="text-muted-foreground pb-1 text-center text-xs font-medium">{d}</div>
            ))}
            {Array.from({ length: first.day() }, (_, i) => <div key={`pad${i}`} />)}
            {Array.from({ length: month.daysInMonth() }, (_, i) => {
              const d = first.add(i, "day");
              const key = d.format("YYYY-MM-DD");
              const dayEvents = onDay(key);
              const holiday = dayEvents.some((e) => e.kind === "holiday");
              return (
                <div
                  key={key}
                  className={cn(
                    "flex min-h-14 flex-col gap-0.5 overflow-hidden rounded-md border p-1 sm:min-h-24 sm:p-1.5",
                    (holiday || isOff(d)) && "bg-muted/60",
                    key === today && "ring-primary ring-2",
                  )}
                >
                  <span className={cn("text-xs", holiday ? "text-destructive font-semibold" : "text-muted-foreground")}>{i + 1}</span>
                  {dayEvents.map((e) => (
                    <button
                      key={e.event_id}
                      type="button"
                      title={e.title}
                      disabled={!isAdmin}
                      onClick={() => setEditing(e)}
                      className={cn("truncate rounded px-1 text-left text-[10px] font-medium sm:text-xs", KINDS[e.kind]?.[1], isAdmin && "hover:opacity-80")}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-48">{tr("Date")}</TableHead>
              <TableHead>{tr("Title")}</TableHead>
              <TableHead className="w-28">{tr("Type")}</TableHead>
              <TableHead className="w-28">{tr("Shown to")}</TableHead>
              {isAdmin && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && (events ?? []).length === 0} colSpan={isAdmin ? 5 : 4} emptyText={tr("Nothing on the calendar this month")} />
            {(events ?? []).map((e) => (
              <TableRow key={e.event_id}>
                <TableCell className="tabular-nums">{fmtRange(e)}</TableCell>
                <TableCell>
                  <div className="font-medium">{e.title}</div>
                  {e.description && <div className="text-muted-foreground text-xs whitespace-normal">{e.description}</div>}
                </TableCell>
                <TableCell><Badge className={cn("border-transparent", KINDS[e.kind]?.[1])}>{KINDS[e.kind]?.[0] ?? e.kind}</Badge></TableCell>
                <TableCell>{AUDIENCES.find((a) => a.value === e.audience)?.label ?? e.audience}</TableCell>
                {isAdmin && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconAction label={tr("Edit")} onClick={() => setEditing(e)}><PencilIcon /></IconAction>
                      <IconAction label={tr("Delete")} destructive onClick={() => confirmAction({ title: tr("Delete \"{title}\"?", { title: e.title }), onConfirm: () => remove.mutate(e.event_id) })}>
                        <Trash2Icon />
                      </IconAction>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? tr("Add to calendar") : tr("Edit calendar entry")}</DialogTitle>
          </DialogHeader>
          {editing !== null && <EventForm key={editing === "new" ? "new" : editing.event_id} event={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- school years and terms ---------------------------------------------------------

interface RangeValues {
  name: string;
  start_date: string;
  end_date: string;
}

function RangeForm({ nameLabel, namePlaceholder, nameLocked, initial, loading, onSave, onCancel }: {
  nameLabel: string; namePlaceholder?: string; nameLocked?: boolean; initial: RangeValues; loading: boolean;
  onSave: (v: RangeValues) => void; onCancel: () => void;
}) {  // prettier-ignore
  const form = useForm<RangeValues>({ defaultValues: initial });
  const { errors } = form.formState;
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="grid gap-4">
      <Field label={nameLabel} htmlFor="range-name" required error={errors.name?.message}>
        <Input id="range-name" placeholder={namePlaceholder} disabled={nameLocked} aria-invalid={!!errors.name} {...form.register("name", { required: tr("Required") })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="start_date" render={({ field }) => (
          <Field label={tr("Starts")}><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
        <Controller control={form.control} name="end_date" render={({ field }) => (
          <Field label={tr("Ends")}><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>{tr("Cancel")}</Button>
        <Button type="submit" loading={loading}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

const nextYearName = (years: SchoolYear[] | undefined) => {
  const latest = (years ?? []).map((y) => Number(y.name.slice(0, 4))).sort((a, b) => b - a)[0] ?? dayjs().year();
  return `${latest + 1}-${latest + 2}`;
};

type YearDialog = { kind: "year"; year: SchoolYear | null } | { kind: "term"; year: SchoolYear; term: SchoolYear["terms"][number] | null };

export function SchoolYearsPage() {
  const { data: years, isLoading } = useGet<SchoolYear[]>("/school-years");
  const [dialog, setDialog] = useState<YearDialog | null>(null);
  const invalidate = [["/school-years"], ["/academic-years"], ["/settings"], ["/settings/public"]];
  const close = () => setDialog(null);
  const dates = (v: RangeValues) => ({ start_date: v.start_date || null, end_date: v.end_date || null });

  const saveYear = useAction(
    async (v: RangeValues) => {
      if (dialog?.kind === "year" && dialog.year) await api.put(`/school-years/${dialog.year.academic_year_id}`, dates(v));
      else await api.post("/school-years", { name: v.name.trim(), ...dates(v) });
    },
    { success: tr("Saved"), invalidate, onSuccess: close },
  );
  const saveTerm = useAction(
    (v: RangeValues) => {
      if (dialog?.kind !== "term") throw new Error("no term dialog");
      const body = { academic_year_id: dialog.year.academic_year_id, name: v.name.trim(), ...dates(v) };
      return dialog.term ? api.put(`/terms/${dialog.term.term_id}`, body) : api.post("/terms", body);
    },
    { success: tr("Saved"), invalidate, onSuccess: close },
  );
  const makeCurrent = useAction((id: number) => api.post(`/school-years/${id}/make-current`), { success: tr("Current year changed"), invalidate });
  const removeYear = useAction((id: number) => api.delete(`/school-years/${id}`), { success: tr("Deleted"), invalidate });
  const removeTerm = useAction((id: number) => api.delete(`/terms/${id}`), { success: tr("Deleted"), invalidate });

  const range = (r: { start_date: string | null; end_date: string | null }) =>
    r.start_date || r.end_date ? `${r.start_date ? dayjs(r.start_date).format("DD MMM YYYY") : "…"} – ${r.end_date ? dayjs(r.end_date).format("DD MMM YYYY") : "…"}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("School years")}
        subtitle={tr("Academic years and their terms. The current year is the one new enrolments, exams and invoices belong to.")}
        actions={
          <Button onClick={() => setDialog({ kind: "year", year: null })}>
            <PlusIcon />
            {tr("New year")}</Button>
        }
      />
      {isLoading ? null : (years ?? []).length === 0 ? (
        <EmptyState icon={CalendarCheckIcon} title={tr("No school years yet")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(years ?? []).map((y) => (
            <Card key={y.academic_year_id} className={cn("gap-3", y.is_current && "border-primary")}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {y.name}
                    {y.is_current && <Badge className="bg-primary/10 text-primary border-transparent">{tr("Current")}</Badge>}
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">{range(y) ?? tr("No dates set")}</p>
                </div>
                <div className="flex gap-1">
                  {!y.is_current && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        confirmAction({
                          title: tr("Make {name} the current year?", { name: y.name }),
                          description: tr("New enrolments, exams, invoices and attendance will belong to it, in this app and the old one."),
                          onConfirm: () => makeCurrent.mutate(y.academic_year_id),
                        })
                      }
                    >
                      <StarIcon />
                      {tr("Make current")}</Button>
                  )}
                  <IconAction label={tr("Edit dates")} onClick={() => setDialog({ kind: "year", year: y })}><PencilIcon /></IconAction>
                  {!y.is_current && (
                    <IconAction label={tr("Delete")} destructive onClick={() => confirmAction({ title: tr("Delete {name}?", { name: y.name }), description: tr("Its terms are deleted too. Records that use this year keep it."), onConfirm: () => removeYear.mutate(y.academic_year_id) })}>
                      <Trash2Icon />
                    </IconAction>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {y.terms.length === 0 && <p className="text-muted-foreground text-sm">{tr("No terms")}</p>}
                {y.terms.map((t) => (
                  <div key={t.term_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground ml-2">{range(t) ?? <Dash />}</span>
                    </div>
                    <div className="flex gap-1">
                      <IconAction label={tr("Edit term")} onClick={() => setDialog({ kind: "term", year: y, term: t })}><PencilIcon /></IconAction>
                      <IconAction label={tr("Delete term")} destructive onClick={() => confirmAction({ title: tr("Delete {name}?", { name: t.name }), onConfirm: () => removeTerm.mutate(t.term_id) })}>
                        <Trash2Icon />
                      </IconAction>
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "term", year: y, term: null })}>
                  <PlusIcon />
                  {tr("Add term")}</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "year" ? (dialog.year ? tr("Edit {name}", { name: dialog.year.name }) : tr("New school year")) : dialog?.term ? tr("Edit term") : tr("New term in {value}", { value: dialog?.year.name ?? "" })}
            </DialogTitle>
          </DialogHeader>
          {dialog?.kind === "year" && (
            <RangeForm
              key={dialog.year?.academic_year_id ?? "new"}
              nameLabel={tr("Year")}
              namePlaceholder="2026-2027"
              nameLocked={!!dialog.year}
              initial={{ name: dialog.year?.name ?? nextYearName(years), start_date: dialog.year?.start_date ?? "", end_date: dialog.year?.end_date ?? "" }}
              loading={saveYear.isPending}
              onSave={(v) => saveYear.mutate(v)}
              onCancel={close}
            />
          )}
          {dialog?.kind === "term" && (
            <RangeForm
              key={dialog.term?.term_id ?? "new-term"}
              nameLabel={tr("Term name")}
              namePlaceholder={tr("Term 1")}
              initial={{ name: dialog.term?.name ?? "", start_date: dialog.term?.start_date ?? "", end_date: dialog.term?.end_date ?? "" }}
              loading={saveTerm.isPending}
              onSave={(v) => saveTerm.mutate(v)}
              onCancel={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
