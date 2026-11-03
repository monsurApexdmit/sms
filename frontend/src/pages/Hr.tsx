import dayjs from "dayjs";
import {
  BanknoteIcon, CalculatorIcon, CheckCheckIcon, EyeIcon, LockIcon, PartyPopperIcon, PencilIcon, PlusIcon, PrinterIcon,
  ReceiptTextIcon, SaveIcon, Trash2Icon, UndoIcon, WalletIcon,
} from "lucide-react";  // prettier-ignore
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../api/client";
import { useAction, useGet, usePublicSettings } from "../api/hooks";
import type { PayItem, Payslip, PayrollRun, SalaryStructure, StaffAttendanceRow, StaffMember } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { money, titleCase } from "../utils";
import { PrintHeader } from "./Academic";
import { t, tn } from "../i18n";

const staffKey = (s: { staff_role: string; staff_id: number }) => `${s.staff_role}-${s.staff_id}`;

// --- staff attendance --------------------------------------------------------------------

type Status = NonNullable<StaffAttendanceRow["status"]>;
const STATUSES: { value: Status; label: string; short: string; tone: string; on: string }[] = [
  { value: "present", label: t("Present"), short: t("P"), tone: "bg-success/15 text-success", on: "data-[state=on]:bg-success/15 data-[state=on]:text-success" },
  { value: "late", label: t("Late"), short: t("L"), tone: "bg-warning/20 text-amber-700 dark:text-amber-300", on: "data-[state=on]:bg-warning/20 data-[state=on]:text-amber-700" },
  { value: "half_day", label: t("Half day"), short: "½", tone: "bg-chart-2/15 text-chart-2", on: "data-[state=on]:bg-chart-2/15 data-[state=on]:text-chart-2" },
  { value: "absent", label: t("Absent"), short: t("A"), tone: "bg-destructive/10 text-destructive", on: "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive" },
  { value: "leave", label: t("Leave"), short: t("LV"), tone: "bg-primary/10 text-primary", on: "data-[state=on]:bg-primary/10 data-[state=on]:text-primary" },
];
const statusOf = (v: string | undefined) => STATUSES.find((s) => s.value === v);

interface MonthReport {
  days: number;
  holidays: Record<string, string>;
  off_days: number[];
  working_days: number;
  rows: (StaffMember & { days: Record<string, Status> } & Record<Status, number>)[];
}

function DailySheet() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const sheet = useGet<{ day: { holiday: string | null; weekly_off: boolean }; rows: StaffAttendanceRow[] }>("/hr/attendance/sheet", { date });
  const [rows, setRows] = useState<StaffAttendanceRow[]>([]);
  useEffect(() => setRows(sheet.data?.rows ?? []), [sheet.data]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(sheet.data?.rows ?? []);
  const save = useAction(
    () => api.put("/hr/attendance/sheet", { date, items: rows.map(({ name: _, ...r }) => ({ ...r, check_in: r.check_in || null, check_out: r.check_out || null, note: r.note || null })) }),
    { success: t("Staff attendance saved"), invalidate: [["/hr/attendance/sheet"], ["/hr/attendance/report"]] },
  );
  const update = (i: number, patch: Partial<StaffAttendanceRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const day = sheet.data?.day;

  const pickDate = (v: string) => {
    if (v && dayjs(v).isAfter(dayjs(), "day")) {
      toast.error(t("Attendance can't be taken for a future date"));
      return;
    }
    setDate(v);
  };

  return (
    <div className="space-y-4">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <Field label={t("Date")} className="w-48">
            <DatePicker value={date} onChange={pickDate} clearable={false} />
          </Field>
          <Button variant="outline" disabled={rows.length === 0} onClick={() => setRows((rs) => rs.map((r) => ({ ...r, status: r.status ?? "present" })))}>
            <CheckCheckIcon />
            {t("Mark the rest present")}</Button>
        </CardContent>
      </Card>
      {(day?.holiday || day?.weekly_off) && (
        <Alert>
          <PartyPopperIcon />
          <AlertTitle>{day.holiday ? t("Holiday: {holiday}", { holiday: day.holiday }) : t("Weekly day off")}</AlertTitle>
          <AlertDescription>{t("This day is not a working day and is not counted in payroll.")}</AlertDescription>
        </Alert>
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="min-w-[900px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Staff member")}</TableHead>
              <TableHead className="w-96">{t("Status")}</TableHead>
              <TableHead className="w-28">{t("In")}</TableHead>
              <TableHead className="w-28">{t("Out")}</TableHead>
              <TableHead>{t("Note")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={sheet.isLoading} empty={!sheet.isLoading && rows.length === 0} colSpan={5} emptyText={t("No staff accounts yet")} />
            {rows.map((r, i) => (
              <TableRow key={staffKey(r)}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-muted-foreground text-xs">{titleCase(r.staff_role)}</div>
                </TableCell>
                <TableCell>
                  <ToggleGroup type="single" variant="outline" size="sm" aria-label={t("Attendance for {name}", { name: r.name })} value={r.status ?? ""} onValueChange={(v) => update(i, { status: (v || null) as Status | null })}>
                    {STATUSES.map((s) => (
                      <ToggleGroupItem key={s.value} value={s.value} className={cn("text-xs", s.on)}>
                        {s.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </TableCell>
                <TableCell><Input type="time" aria-label={t("Check in")} value={r.check_in ?? ""} onChange={(e) => update(i, { check_in: e.target.value })} /></TableCell>
                <TableCell><Input type="time" aria-label={t("Check out")} value={r.check_out ?? ""} onChange={(e) => update(i, { check_out: e.target.value })} /></TableCell>
                <TableCell><Input aria-label={t("Note")} value={r.note ?? ""} maxLength={500} onChange={(e) => update(i, { note: e.target.value })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <CardFooter className="bg-muted/30 flex-wrap justify-between gap-3 border-t px-4 py-3 [.border-t]:pt-3">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            {dayjs(date).format("dddd, DD MMM YYYY")}
            {dirty && <Badge className="bg-warning/20 text-warning-foreground border-transparent">{t("Unsaved changes")}</Badge>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setRows(sheet.data?.rows ?? [])}>
              <UndoIcon />
              {t("Reset")}</Button>
            <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined)}>
              <SaveIcon />
              {t("Save")}</Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function MonthGrid({ path }: { path: string }) {
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const { data, isLoading } = useGet<MonthReport>(path, { month });
  const first = dayjs(`${month}-01`);
  const offTitle = (d: number) => data?.holidays[String(d)] ?? (data?.off_days.includes(d) ? t("Weekly day off") : undefined);
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <Field label={t("Month")} htmlFor="hr-month" className="w-44">
          <Input id="hr-month" type="month" value={month} max={dayjs().format("YYYY-MM")} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <span key={s.value} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-0.5 font-semibold", s.tone)}>{s.short}</span>
              {s.label}
            </span>
          ))}
          {data && <Badge variant="secondary">{tn("Working days {working_days}", { working_days: data.working_days })}</Badge>}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <PrinterIcon />
            {t("Print")}</Button>
        </div>
      </div>
      <PrintHeader title={t("Staff attendance")} lines={[first.format("MMMM YYYY"), data ? t("Working days: {working_days}", { working_days: data.working_days }) : undefined]} />
      <Card className="gap-0 overflow-hidden py-0 print:rounded-none print:shadow-none">
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-24 w-full" /></div>
        ) : data && (
          <Table className="border-collapse text-xs [print-color-adjust:exact] [&_td]:border [&_th]:border">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="bg-muted sticky left-0 z-10 min-w-44 print:static">{t("Staff member")}</TableHead>
                {Array.from({ length: data.days }, (_, i) => (
                  <TableHead key={i} title={offTitle(i + 1)} className={cn("h-auto px-1 py-1 text-center", offTitle(i + 1) && "bg-muted text-muted-foreground")}>
                    <div className="text-[10px] font-normal">{first.add(i, "day").format("dd")[0]}</div>
                    <div>{i + 1}</div>
                  </TableHead>
                ))}
                {STATUSES.map((s) => <TableHead key={s.value} className="px-2 text-center">{s.short}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState empty={data.rows.length === 0} colSpan={data.days + 6} emptyText={t("No staff")} />
              {data.rows.map((r) => (
                <TableRow key={staffKey(r)}>
                  <TableCell className="bg-card sticky left-0 z-10 font-medium print:static">{r.name}</TableCell>
                  {Array.from({ length: data.days }, (_, i) => {
                    const s = statusOf(r.days[String(i + 1)]);
                    return (
                      <TableCell key={i} className={cn("min-w-7 px-1 text-center font-semibold", !s && offTitle(i + 1) && "bg-muted", s?.tone)}>
                        {s?.short ?? ""}
                      </TableCell>
                    );
                  })}
                  {STATUSES.map((s) => <TableCell key={s.value} className="px-2 text-center font-bold tabular-nums">{r[s.value]}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );  // prettier-ignore
}

export function StaffAttendancePage() {
  return (
    <div className="space-y-6">
      <style>{"@media print { @page { size: landscape; } }"}</style>
      <PageHeader title={t("Staff attendance")} subtitle={t("Teachers, librarians and accountants. Absences can reduce pay when payroll deducts them.")} />
      <Tabs defaultValue="daily" className="gap-6">
        <TabsList className="no-print">
          <TabsTrigger value="daily">{t("Daily sheet")}</TabsTrigger>
          <TabsTrigger value="month">{t("Monthly report")}</TabsTrigger>
        </TabsList>
        <TabsContent value="daily"><DailySheet /></TabsContent>
        <TabsContent value="month"><MonthGrid path="/hr/attendance/report" /></TabsContent>
      </Tabs>
    </div>
  );
}

// --- salary structures -------------------------------------------------------------------

interface StructureValues {
  staff: string | null;
  basic: string;
  effective_from: string;
  allowances: { name: string; amount: string }[];
  deductions: { name: string; amount: string }[];
}

const toValues = (s: SalaryStructure | null): StructureValues =>
  s
    ? {
        staff: staffKey(s), basic: String(s.basic), effective_from: s.effective_from,
        allowances: s.allowances.map((i) => ({ name: i.name, amount: String(i.amount) })),
        deductions: s.deductions.map((i) => ({ name: i.name, amount: String(i.amount) })),
      }  // prettier-ignore
    : { staff: null, basic: "", effective_from: dayjs().startOf("month").format("YYYY-MM-DD"), allowances: [], deductions: [] };

function PayItems({ form, name, label }: { form: ReturnType<typeof useForm<StructureValues>>; name: "allowances" | "deductions"; label: string }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name });
  return (
    <Field label={label}>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={f.id} className="flex gap-2">
            <Input placeholder={t("Name")} aria-label={t("{label} name", { label })} {...form.register(`${name}.${i}.name`, { required: true })} />
            <Input type="number" min="0" step="0.01" placeholder={t("Amount")} aria-label={t("{label} amount", { label })} className="w-32" {...form.register(`${name}.${i}.amount`, { required: true })} />
            <IconAction label={t("Remove")} destructive onClick={() => remove(i)}><Trash2Icon /></IconAction>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => append({ name: "", amount: "" })}>
          <PlusIcon />
          {t("Add")}</Button>
      </div>
    </Field>
  );
}

function StructureForm({ structure, staff, onDone }: { structure: SalaryStructure | null; staff: StaffMember[]; onDone: () => void }) {
  const form = useForm<StructureValues>({ defaultValues: toValues(structure) });
  const { errors } = form.formState;
  const items = (list: { name: string; amount: string }[]): PayItem[] => list.map((i) => ({ name: i.name.trim(), amount: Number(i.amount) }));
  const save = useAction(
    (v: StructureValues) => {
      const [role, id] = (v.staff ?? "").split("-");
      const body = { staff_role: role, staff_id: Number(id), basic: Number(v.basic), effective_from: v.effective_from, allowances: items(v.allowances), deductions: items(v.deductions) };
      return structure ? api.put(`/hr/salary-structures/${structure.salary_structure_id}`, body) : api.post("/hr/salary-structures", body);
    },
    { success: t("Salary structure saved"), invalidate: [["/hr/salary-structures"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Controller control={form.control} name="staff" rules={{ required: t("Required") }} render={({ field }) => (
        <Field label={t("Staff member")} required error={errors.staff?.message}>
          <Combobox data={staff.map((s) => ({ value: staffKey(s), label: `${s.name} (${titleCase(s.staff_role)})` }))} value={field.value} onChange={field.onChange} placeholder={t("Choose staff member")} />
        </Field>
      )} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Basic salary")} htmlFor="ss-basic" required error={errors.basic?.message}>
          <Input id="ss-basic" type="number" min="0" step="0.01" aria-invalid={!!errors.basic} {...form.register("basic", { required: t("Required") })} />
        </Field>
        <Controller control={form.control} name="effective_from" rules={{ required: t("Required") }} render={({ field }) => (
          <Field label={t("Effective from")} required error={errors.effective_from?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
      </div>
      <PayItems form={form} name="allowances" label={t("Allowances")} />
      <PayItems form={form} name="deductions" label={t("Deductions")} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

export function SalaryStructuresPage() {
  const currency = usePublicSettings().data?.currency ?? "usd";
  const { data, isLoading } = useGet<SalaryStructure[]>("/hr/salary-structures");
  const staff = useGet<StaffMember[]>("/hr/staff");
  const [editing, setEditing] = useState<SalaryStructure | "new" | null>(null);
  const remove = useAction((id: number) => api.delete(`/hr/salary-structures/${id}`), { success: t("Deleted"), invalidate: [["/hr/salary-structures"]] });
  const sum = (items: PayItem[]) => items.reduce((a, i) => a + i.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Salary structures")}
        subtitle={t("Basic pay, allowances and deductions per staff member. For each month, the latest structure in effect is used.")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("New structure")}</Button>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Staff member")}</TableHead>
              <TableHead>{t("Effective from")}</TableHead>
              <TableHead className="text-right">{t("Basic")}</TableHead>
              <TableHead className="text-right">{t("Allowances")}</TableHead>
              <TableHead className="text-right">{t("Deductions")}</TableHead>
              <TableHead className="text-right">{t("Net (before absences)")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && (data ?? []).length === 0} colSpan={7} emptyText={t("No salary structures yet")} />
            {(data ?? []).map((s) => (
              <TableRow key={s.salary_structure_id}>
                <TableCell>
                  <div className="font-medium">{s.name ?? <Dash />}</div>
                  <div className="text-muted-foreground text-xs">{titleCase(s.staff_role)}</div>
                </TableCell>
                <TableCell>{dayjs(s.effective_from).format("DD MMM YYYY")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(s.basic, currency)}</TableCell>
                <TableCell className="text-right tabular-nums" title={s.allowances.map((i) => `${i.name}: ${i.amount}`).join("\n")}>{money(sum(s.allowances), currency)}</TableCell>
                <TableCell className="text-right tabular-nums" title={s.deductions.map((i) => `${i.name}: ${i.amount}`).join("\n")}>{money(sum(s.deductions), currency)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(s.basic + sum(s.allowances) - sum(s.deductions), currency)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction label={t("Edit")} onClick={() => setEditing(s)}><PencilIcon /></IconAction>
                    <IconAction label={t("Delete")} destructive onClick={() => confirmAction({ title: t("Delete salary structure?"), description: t("Payslips already created keep their amounts."), onConfirm: () => remove.mutate(s.salary_structure_id) })}>
                      <Trash2Icon />
                    </IconAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("New salary structure") : t("Edit salary structure")}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <StructureForm key={editing === "new" ? "new" : editing.salary_structure_id} structure={editing === "new" ? null : editing} staff={staff.data ?? []} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- payroll -----------------------------------------------------------------------------

const RUN_STATUS: Record<PayrollRun["status"], string> = {
  draft: "bg-muted text-foreground",
  finalized: "bg-warning/20 text-amber-700 dark:text-amber-300",
  paid: "bg-success/15 text-success",
};

function RunDetail({ runId, currency, onDeleted }: { runId: number; currency: string; onDeleted: () => void }) {
  const { data: run, isLoading } = useGet<PayrollRun & { payslips: Payslip[] }>(`/hr/payroll/${runId}`);
  const [paying, setPaying] = useState(false);
  const [payDate, setPayDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [method, setMethod] = useState<string | null>("bank");
  const invalidate = [["/hr/payroll"], ["/payments"], ["/finance/summary"]];
  const recalc = useAction(() => api.post(`/hr/payroll/${runId}/recalculate`), { success: t("Payslips recalculated"), invalidate });
  const finalize = useAction(() => api.post(`/hr/payroll/${runId}/finalize`), { success: t("Payroll finalized"), invalidate });
  const pay = useAction(() => api.post(`/hr/payroll/${runId}/pay`, { method: method ?? "bank", date: payDate || null }), {
    success: t("Payroll paid and recorded as expenses"),
    invalidate,
    onSuccess: () => setPaying(false),
  });
  const remove = useAction(() => api.delete(`/hr/payroll/${runId}`), { success: t("Payroll deleted"), invalidate, onSuccess: onDeleted });

  if (isLoading || !run) return <Skeleton className="h-48 w-full" />;
  const total = (k: "gross" | "net" | "absence_deduction") => run.payslips.reduce((a, p) => a + p[k], 0);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{dayjs(`${run.month}-01`).format("MMMM YYYY")}</span>
          <Badge className={cn("border-transparent", RUN_STATUS[run.status])}>{titleCase(run.status)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" && (
            <>
              <Button size="sm" variant="outline" loading={recalc.isPending} onClick={() => recalc.mutate(undefined)}>
                <CalculatorIcon />
                {t("Recalculate")}</Button>
              <Button size="sm" variant="outline" onClick={() => confirmAction({ title: t("Delete the {month} payroll?", { month: run.month }), onConfirm: () => remove.mutate(undefined) })}>
                <Trash2Icon />
                {t("Delete")}</Button>
              <Button size="sm" onClick={() => confirmAction({ title: t("Finalize the {month} payroll?", { month: run.month }), description: t("Payslips can no longer be recalculated, and staff can see them."), onConfirm: () => finalize.mutate(undefined) })}>
                <LockIcon />
                {t("Finalize")}</Button>
            </>
          )}
          {run.status === "finalized" && (
            <Button size="sm" onClick={() => setPaying(true)}>
              <BanknoteIcon />
              {t("Mark as paid")}</Button>
          )}
        </div>
      </div>
      <Table className="min-w-[900px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{t("Staff member")}</TableHead>
            <TableHead className="text-right">{t("Days (worked / working)")}</TableHead>
            <TableHead className="text-right">{t("Basic")}</TableHead>
            <TableHead className="text-right">{t("Gross")}</TableHead>
            <TableHead className="text-right">{t("Absence deduction")}</TableHead>
            <TableHead className="text-right">{t("Net")}</TableHead>
            <TableHead>{t("Paid")}</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState empty={run.payslips.length === 0} colSpan={8} emptyText={t("No staff member has a salary structure for this month")} />
          {run.payslips.map((p) => (
            <TableRow key={p.payslip_id}>
              <TableCell>
                <div className="font-medium">{p.name}</div>
                <div className="text-muted-foreground text-xs">{titleCase(p.staff_role)}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.present_days} / {p.working_days}
                {p.leave_days > 0 && <div className="text-muted-foreground text-xs">{tn("{leave_days} on leave", { leave_days: p.leave_days })}</div>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(p.basic, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.gross, currency)}</TableCell>
              <TableCell className="text-destructive text-right tabular-nums">{p.absence_deduction ? money(p.absence_deduction, currency) : <Dash />}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(p.net, currency)}</TableCell>
              <TableCell>{p.paid_on ? dayjs(p.paid_on).format("DD MMM YYYY") : <Dash />}</TableCell>
              <TableCell>
                <Button asChild variant="ghost" size="icon-sm" aria-label={t("View payslip")}>
                  <Link to={`/app/payslip/${p.payslip_id}`}><EyeIcon /></Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {run.payslips.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">{t("Total")}</TableCell>
              <TableCell className="text-right tabular-nums">{money(total("gross"), currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(total("absence_deduction"), currency)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total("net"), currency)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        )}
      </Table>
      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Mark payroll as paid")}</DialogTitle>
            <DialogDescription>{t("Each payslip is recorded once as a \"Salary\" expense in Income & expenses.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Paid on")}>
              <DatePicker value={payDate} onChange={setPayDate} clearable={false} />
            </Field>
            <Field label={t("Method")}>
              <Combobox data={[{ value: "bank", label: t("Bank transfer") }, { value: "cash", label: t("Cash") }, { value: "cheque", label: t("Cheque") }]} value={method} onChange={setMethod} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(false)}>{t("Cancel")}</Button>
            <Button loading={pay.isPending} onClick={() => pay.mutate(undefined)}>{t("Mark as paid")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );  // prettier-ignore
}

export function PayrollPage() {
  const user = useUser();
  const currency = usePublicSettings().data?.currency ?? "usd";
  const { data: runs, isLoading } = useGet<PayrollRun[]>("/hr/payroll");
  const settings = useGet<{ deduct_absence: boolean }>("/hr/settings");
  const [selected, setSelected] = useState<number | null>(null);
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const create = useAction((m: string) => api.post<PayrollRun>("/hr/payroll", { month: m }), {
    success: t("Draft payroll created"),
    invalidate: [["/hr/payroll"]],
    onSuccess: (r) => setSelected(r.data.payroll_run_id),
  });
  const setDeduct = useAction((on: boolean) => api.put("/hr/settings", { deduct_absence: on }), { success: t("Saved"), invalidate: [["/hr/settings"]] });
  const current = selected ?? runs?.[0]?.payroll_run_id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("Payroll")} subtitle={t("Monthly payslips from salary structures and staff attendance. Holidays and weekly days off are not working days.")} />
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("Month")} htmlFor="payroll-month" className="w-44">
              <Input id="payroll-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button loading={create.isPending} disabled={!month} onClick={() => create.mutate(month)}>
              <PlusIcon />
              {t("Create payroll")}</Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={settings.data?.deduct_absence ?? false} disabled={user.role !== "admin"} onCheckedChange={(v) => setDeduct.mutate(v)} />
            {t("Deduct unpaid absences (basic ÷ working days per absent day, half for a half day)")}</label>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="gap-0 self-start overflow-hidden py-0">
          {isLoading ? (
            <div className="p-3"><Skeleton className="h-24 w-full" /></div>
          ) : (runs ?? []).length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">{t("No payroll yet")}</p>
          ) : (
            (runs ?? []).map((r) => (
              <button
                key={r.payroll_run_id}
                type="button"
                onClick={() => setSelected(r.payroll_run_id)}
                className={cn("hover:bg-muted/60 flex w-full items-center justify-between gap-2 border-b px-4 py-3 text-left text-sm last:border-b-0", r.payroll_run_id === current && "bg-muted")}
              >
                <div>
                  <div className="font-medium">{dayjs(`${r.month}-01`).format("MMMM YYYY")}</div>
                  <div className="text-muted-foreground text-xs">{tn("{staff} staff · {net}", { staff: r.staff, net: money(r.net, currency) })}</div>
                </div>
                <Badge className={cn("border-transparent", RUN_STATUS[r.status])}>{titleCase(r.status)}</Badge>
              </button>
            ))
          )}
        </Card>
        {current ? (
          <RunDetail key={current} runId={current} currency={currency} onDeleted={() => setSelected(null)} />
        ) : (
          <EmptyState icon={WalletIcon} title={t("No payroll selected")}>{t("Create a payroll for a month to calculate payslips.")}</EmptyState>
        )}
      </div>
    </div>
  );  // prettier-ignore
}

// --- payslips ------------------------------------------------------------------------------

export function MyPayslipsPage() {
  const currency = usePublicSettings().data?.currency ?? "usd";
  const { data, isLoading } = useGet<Payslip[]>("/hr/payslips/mine");
  return (
    <div className="space-y-6">
      <PageHeader title={t("My payslips")} />
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Month")}</TableHead>
              <TableHead className="text-right">{t("Gross")}</TableHead>
              <TableHead className="text-right">{t("Net")}</TableHead>
              <TableHead>{t("Paid")}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && (data ?? []).length === 0} colSpan={5} emptyText={t("No payslips yet")} />
            {(data ?? []).map((p) => (
              <TableRow key={p.payslip_id}>
                <TableCell className="font-medium">{dayjs(`${p.month}-01`).format("MMMM YYYY")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.gross, currency)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(p.net, currency)}</TableCell>
                <TableCell>{p.paid_on ? dayjs(p.paid_on).format("DD MMM YYYY") : <Badge variant="secondary">{t("Not paid yet")}</Badge>}</TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={t("View payslip")}>
                    <Link to={`/app/payslip/${p.payslip_id}`}><ReceiptTextIcon /></Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );  // prettier-ignore
}

export function PayslipPage() {
  const user = useUser();
  const { id } = useParams();
  const { data: slip, isLoading, error } = useGet<Payslip & { school: string; address: string; currency: string }>(`/hr/payslips/${id}`);
  if (!["admin", "accountant", "teacher", "librarian"].includes(user.role)) return <Navigate to="/app/dashboard" replace />;
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (error || !slip) return <EmptyState icon={ReceiptTextIcon} title={t("Payslip not available")} />;
  const c = slip.currency;
  const line = (label: string, amount: number, tone?: string) => (
    <div key={label} className="flex justify-between gap-4 py-1 text-sm">
      <span>{label}</span>
      <span className={cn("tabular-nums", tone)}>{money(amount, c)}</span>
    </div>
  );
  const deductions = slip.deductions.reduce((a, i) => a + i.amount, 0) + slip.absence_deduction;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Payslip – {dayjs}", { dayjs: dayjs(`${slip.month}-01`).format("MMMM YYYY") })}
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon />
            {t("Print / save as PDF")}</Button>
        }
      />
      <PrintHeader title={t("Payslip – {dayjs}", { dayjs: dayjs(`${slip.month}-01`).format("MMMM YYYY") })} />
      <Card className="mx-auto max-w-2xl gap-4 print:border-0 print:shadow-none">
        <CardContent className="space-y-6">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">{t("Name:")}{" "}</span><span className="font-medium">{slip.name}</span></div>
            <div><span className="text-muted-foreground">{t("Role:")}{" "}</span>{titleCase(slip.staff_role)}</div>
            <div><span className="text-muted-foreground">{t("Payslip no:")}{" "}</span>{slip.payslip_id}</div>
            <div><span className="text-muted-foreground">{t("Paid on:")}{" "}</span>{slip.paid_on ? dayjs(slip.paid_on).format("DD MMM YYYY") : t("Not paid yet")}</div>
            <div><span className="text-muted-foreground">{t("Working days:")}{" "}</span>{slip.working_days}</div>
            <div>
              <span className="text-muted-foreground">{t("Days worked:")}{" "}</span>
              {slip.present_days}
              {slip.leave_days > 0 && " " + t("(incl. {leave_days} on leave)", { leave_days: slip.leave_days })}
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="border-b pb-1 font-semibold">{t("Earnings")}</div>
              {line(t("Basic"), slip.basic)}
              {slip.allowances.map((i) => line(i.name, i.amount))}
              <div className="flex justify-between gap-4 border-t pt-1 text-sm font-semibold">
                <span>{t("Gross")}</span>
                <span className="tabular-nums">{money(slip.gross, c)}</span>
              </div>
            </div>
            <div>
              <div className="border-b pb-1 font-semibold">{t("Deductions")}</div>
              {slip.deductions.map((i) => line(i.name, i.amount))}
              {slip.absence_deduction > 0 && line(t("Unpaid absence ({absent_days} days)", { absent_days: slip.absent_days }), slip.absence_deduction)}
              {deductions === 0 && <p className="text-muted-foreground py-1 text-sm">{t("None")}</p>}
              <div className="flex justify-between gap-4 border-t pt-1 text-sm font-semibold">
                <span>{t("Total deductions")}</span>
                <span className="tabular-nums">{money(deductions, c)}</span>
              </div>
            </div>
          </div>
          <div className="bg-muted/50 flex items-center justify-between rounded-md px-4 py-3 [print-color-adjust:exact]">
            <span className="font-semibold">{t("Net pay")}</span>
            <span className="text-xl font-bold tabular-nums">{money(slip.net, c)}</span>
          </div>
          <div className="print-only pt-16">
            <div className="flex justify-between text-sm">
              <span className="border-t px-8 pt-1">{t("Employee")}</span>
              <span className="border-t px-8 pt-1">{t("Authorised signature")}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );  // prettier-ignore
}
