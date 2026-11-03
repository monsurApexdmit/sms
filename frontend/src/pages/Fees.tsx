import dayjs from "dayjs";
import { ArrowLeftIcon, CalendarClockIcon, FilePlus2Icon, PencilIcon, PlusIcon, PrinterIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../api/client";
import { useAction, useClasses, useGet, useList, usePublicSettings } from "../api/hooks";
import type { FeeDiscount, FeeHead, FeePlan, Receipt, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import { fromUnix, money, toOptions } from "../utils";
import { methodLabel } from "./Finance";

// --- shared -----------------------------------------------------------------------

function useYearOptions() {
  const { data } = useGet<{ running_year: string; years: string[] }>("/academic-years");
  return { running: data?.running_year ?? "", options: (data?.years ?? []).map((y) => ({ value: y, label: y })) };
}

const FINE_TYPES = [
  { value: "none", label: "No late fine" },
  { value: "flat", label: "Flat fine once" },
  { value: "per_day", label: "Fine per day late" },
];

const fineText = (p: FeePlan, currency: string) =>
  p.late_fine_type === "none"
    ? "No late fine"
    : `${money(p.late_fine_amount, currency)}${p.late_fine_type === "per_day" ? " per day" : " once"} after ${p.grace_days} grace day${p.grace_days === 1 ? "" : "s"}`;

// --- plans ------------------------------------------------------------------------

interface PlanValues {
  name: string;
  class_id: string | null;
  year: string | null;
  late_fine_type: FeePlan["late_fine_type"];
  late_fine_amount: string;
  grace_days: string;
  items: { fee_head_id: string | null; amount: string }[];
  instalments: { fee_instalment_id: number | null; name: string; due_date: string; share_percent: string }[];
}

const toValues = (p: FeePlan | null, year: string): PlanValues =>
  p
    ? {
        name: p.name, class_id: String(p.class_id), year: p.year, late_fine_type: p.late_fine_type,
        late_fine_amount: String(p.late_fine_amount), grace_days: String(p.grace_days),
        items: p.items.map((i) => ({ fee_head_id: String(i.fee_head_id), amount: String(i.amount) })),
        instalments: p.instalments.map((i) => ({ fee_instalment_id: i.fee_instalment_id, name: i.name, due_date: i.due_date, share_percent: String(i.share_percent) })),
      }
    : {
        name: "", class_id: null, year, late_fine_type: "none", late_fine_amount: "0", grace_days: "0",
        items: [{ fee_head_id: null, amount: "" }],
        instalments: [{ fee_instalment_id: null, name: "Full year", due_date: "", share_percent: "100" }],
      };  // prettier-ignore

function PlanForm({ plan, year, currency, onDone }: { plan: FeePlan | null; year: string; currency: string; onDone: () => void }) {
  const classes = useClasses();
  const heads = useList<FeeHead>("/fee-heads");
  const years = useYearOptions();
  const form = useForm<PlanValues>({ defaultValues: toValues(plan, year) });
  const items = useFieldArray({ control: form.control, name: "items" });
  const instalments = useFieldArray({ control: form.control, name: "instalments" });
  const { errors } = form.formState;
  const watched = form.watch();
  const total = watched.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const shares = watched.instalments.reduce((s, i) => s + (Number(i.share_percent) || 0), 0);

  const save = useAction(
    (v: PlanValues) => {
      const body = {
        name: v.name.trim(), class_id: Number(v.class_id), year: v.year, late_fine_type: v.late_fine_type,
        late_fine_amount: Number(v.late_fine_amount) || 0, grace_days: Number(v.grace_days) || 0,
        items: v.items.map((i) => ({ fee_head_id: Number(i.fee_head_id), amount: Number(i.amount) })),
        instalments: v.instalments.map((i) => ({ fee_instalment_id: i.fee_instalment_id, name: i.name.trim(), due_date: i.due_date, share_percent: Number(i.share_percent) })),
      };  // prettier-ignore
      return plan ? api.put(`/fee-plans/${plan.fee_plan_id}`, body) : api.post("/fee-plans", body);
    },
    { success: "Fee plan saved", invalidate: [["/fee-plans"]], onSuccess: onDone },
  );

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Plan name" htmlFor="plan-name" required error={errors.name?.message} className="sm:col-span-3">
          <Input id="plan-name" placeholder="e.g. Class Ten fees" aria-invalid={!!errors.name} {...form.register("name", { required: "Required" })} />
        </Field>
        <Controller control={form.control} name="class_id" rules={{ required: "Required" }} render={({ field }) => (
          <Field label="Class" required error={errors.class_id?.message}>
            <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Controller control={form.control} name="year" rules={{ required: "Required" }} render={({ field }) => (
          <Field label="Year" required error={errors.year?.message}>
            <Combobox data={years.options} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Fees</span>
          <span className="text-muted-foreground text-sm">Total <span className="text-foreground font-semibold tabular-nums">{money(total, currency)}</span></span>
        </div>
        {items.fields.map((f, i) => (
          <div key={f.id} className="flex items-start gap-2">
            <Controller control={form.control} name={`items.${i}.fee_head_id`} rules={{ required: true }} render={({ field }) => (
              <Combobox className="flex-1" placeholder="Fee head" data={toOptions(heads.data?.items, "fee_head_id", "name")} value={field.value} onChange={field.onChange} />
            )} />
            <Input type="number" min={1} step={1} className="w-32" placeholder="Amount" aria-label="Amount" {...form.register(`items.${i}.amount`, { required: true, min: 1 })} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove fee" disabled={items.fields.length === 1} onClick={() => items.remove(i)}><XIcon /></Button>
          </div>
        ))}
        {(heads.data?.items.length ?? 0) === 0 && <p className="text-muted-foreground text-xs">Add fee heads first (Fee heads tab).</p>}
        <Button type="button" size="sm" variant="ghost" onClick={() => items.append({ fee_head_id: null, amount: "" })}><PlusIcon />Add fee</Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Instalments</span>
          <span className={cn("text-sm tabular-nums", shares === 100 ? "text-muted-foreground" : "text-destructive font-medium")}>Shares {shares}% of 100%</span>
        </div>
        {instalments.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_6rem_auto]">
            <Input placeholder="Name, e.g. Term 1" aria-label="Instalment name" {...form.register(`instalments.${i}.name`, { required: true })} />
            <Controller control={form.control} name={`instalments.${i}.due_date`} rules={{ required: true }} render={({ field }) => (
              <DatePicker value={field.value} onChange={field.onChange} placeholder="Due date" clearable={false} className="order-3 sm:order-none" />
            )} />
            <div className="relative order-4 sm:order-none">
              <Input type="number" min={1} max={100} step="0.01" className="pr-6" aria-label="Share percent" {...form.register(`instalments.${i}.share_percent`, { required: true })} />
              <span className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-sm">%</span>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove instalment" disabled={instalments.fields.length === 1} onClick={() => instalments.remove(i)}><XIcon /></Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => instalments.append({ fee_instalment_id: null, name: "", due_date: "", share_percent: "" })}><PlusIcon />Add instalment</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Controller control={form.control} name="late_fine_type" render={({ field }) => (
          <Field label="Late fine">
            <Combobox data={FINE_TYPES} value={field.value} onChange={(v) => field.onChange(v ?? "none")} />
          </Field>
        )} />
        <Field label="Fine amount" htmlFor="plan-fine">
          <Input id="plan-fine" type="number" min={0} step={1} disabled={watched.late_fine_type === "none"} {...form.register("late_fine_amount")} />
        </Field>
        <Field label="Grace days" htmlFor="plan-grace" description="Days after the due date before fines start">
          <Input id="plan-grace" type="number" min={0} step={1} disabled={watched.late_fine_type === "none"} {...form.register("grace_days")} />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending} disabled={shares !== 100}>Save</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function PlansTab({ currency, isAdmin }: { currency: string; isAdmin: boolean }) {
  const years = useYearOptions();
  const [year, setYear] = useState<string | null>(null);
  const shownYear = year ?? years.running;
  const { data: plans, isLoading } = useGet<FeePlan[]>(shownYear ? "/fee-plans" : null, { year: shownYear });
  const [editing, setEditing] = useState<FeePlan | "new" | null>(null);
  const remove = useAction((id: number) => api.delete(`/fee-plans/${id}`), { success: "Fee plan deleted", invalidate: [["/fee-plans"]] });
  const generate = useAction(
    (v: { plan: FeePlan; instalmentId: number }) =>
      api.post<{ created: number; skipped: number; waived: number }>(`/fee-plans/${v.plan.fee_plan_id}/generate`, { fee_instalment_id: v.instalmentId }),
    {
      invalidate: [["/fee-plans"], ["/invoices"], ["/finance/summary"]],
      onSuccess: ({ data }) =>
        toast.success(`${data.created} invoice${data.created === 1 ? "" : "s"} created`, {
          description: [data.skipped && `${data.skipped} already billed`, data.waived && `${data.waived} fully covered by discounts`].filter(Boolean).join(" · ") || undefined,
        }),
    },
  );
  const runJobs = useAction(() => api.post<{ fines_updated: number; reminders_sent: number }>("/fees/daily-jobs"), {
    invalidate: [["/invoices"], ["/finance/summary"]],
    onSuccess: ({ data }) => toast.success(`Late fines updated on ${data.fines_updated} invoices; ${data.reminders_sent} reminders sent`),
  });

  return (
    <>
      <PageHeader
        title="Fee plans"
        subtitle="Fees for each class and year, billed in instalments. Generated invoices are paid like any other invoice."
        actions={
          <>
            <Combobox className="w-36" data={years.options} value={shownYear || null} onChange={(v) => v && setYear(v)} />
            {isAdmin && (
              <Button variant="outline" loading={runJobs.isPending} onClick={() => runJobs.mutate(undefined)}>
                <CalendarClockIcon />
                Run daily jobs
              </Button>
            )}
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              New plan
            </Button>
          </>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (plans ?? []).length === 0 ? (
        <EmptyState title={`No fee plans for ${shownYear}`}>Create one per class: its fees, instalments and late fine.</EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(plans ?? []).map((p) => (
            <Card key={p.fee_plan_id} className="gap-4">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <div className="text-muted-foreground text-sm">
                    Class {p.class_name ?? p.class_id} · {p.year} · {fineText(p, currency)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <IconAction label="Edit" onClick={() => setEditing(p)}><PencilIcon /></IconAction>
                  <IconAction label="Delete" destructive onClick={() => confirmAction({ title: `Delete ${p.name}?`, description: "Plans that have generated invoices cannot be deleted.", onConfirm: () => remove.mutate(p.fee_plan_id) })}>
                    <Trash2Icon />
                  </IconAction>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {p.items.map((i) => (
                    <Badge key={i.fee_head_id} variant="secondary" className="tabular-nums">{i.head}: {money(i.amount, currency)}</Badge>
                  ))}
                  <Badge className="bg-primary/10 text-primary border-transparent tabular-nums">Total {money(p.total, currency)}</Badge>
                </div>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Instalment</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.instalments.map((i) => (
                        <TableRow key={i.fee_instalment_id}>
                          <TableCell className="font-medium">{i.name} <span className="text-muted-foreground font-normal">({i.share_percent}%)</span></TableCell>
                          <TableCell>{dayjs(i.due_date).format("DD MMM YYYY")}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(i.amount, currency)}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.invoices || <Dash />}</TableCell>
                          <TableCell>
                            <IconAction
                              label="Generate invoices"
                              onClick={() =>
                                confirmAction({
                                  title: `Bill ${i.name} to class ${p.class_name ?? p.class_id}?`,
                                  description: `Creates an invoice of ${money(i.amount, currency)} (less discounts) for every student enrolled in ${p.year}. Students already billed for this instalment are skipped.`,
                                  confirmLabel: "Generate",
                                  onConfirm: () => generate.mutate({ plan: p, instalmentId: i.fee_instalment_id }),
                                })
                              }
                            >
                              <FilePlus2Icon />
                            </IconAction>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New fee plan" : "Edit fee plan"}</DialogTitle>
            <DialogDescription>Changes apply to invoices generated afterwards; existing invoices keep their amounts.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <PlanForm key={editing === "new" ? "new" : editing.fee_plan_id} plan={editing === "new" ? null : editing} year={shownYear} currency={currency} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- discounts ------------------------------------------------------------------------

interface DiscountValues {
  class_id: string | null;
  student_id: string | null;
  fee_plan_id: string | null;
  year: string | null;
  kind: "percent" | "amount";
  value: string;
  reason: string;
}

function DiscountForm({ discount, year, onDone }: { discount: FeeDiscount | null; year: string; onDone: () => void }) {
  const classes = useClasses();
  const years = useYearOptions();
  const form = useForm<DiscountValues>({
    defaultValues: discount
      ? { class_id: null, student_id: String(discount.student_id), fee_plan_id: discount.fee_plan_id ? String(discount.fee_plan_id) : null, year: discount.year, kind: discount.kind, value: String(discount.value), reason: discount.reason ?? "" }
      : { class_id: null, student_id: null, fee_plan_id: null, year, kind: "percent", value: "", reason: "" },
  });
  const { errors } = form.formState;
  const [classId, formYear] = form.watch(["class_id", "year"]);
  const students = useList<Student>(classId ? "/students" : null, { class_id: classId, limit: 1000 });
  const plans = useGet<FeePlan[]>(formYear ? "/fee-plans" : null, { year: formYear });
  const studentOptions = discount && !classId
    ? [{ value: String(discount.student_id), label: discount.student_name ?? `#${discount.student_id}` }]
    : toOptions(students.data?.items, "student_id", "name");

  const save = useAction(
    (v: DiscountValues) => {
      const body = { student_id: Number(v.student_id), fee_plan_id: v.fee_plan_id ? Number(v.fee_plan_id) : null, year: v.year, kind: v.kind, value: Number(v.value), reason: v.reason.trim() || null };
      return discount ? api.put(`/fee-discounts/${discount.fee_discount_id}`, body) : api.post("/fee-discounts", body);
    },
    { success: "Saved", invalidate: [["/fee-discounts"]], onSuccess: onDone },
  );

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="class_id" render={({ field }) => (
          <Field label="Class">
            <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={(v) => { field.onChange(v); form.setValue("student_id", null); }} placeholder="Choose class" />
          </Field>
        )} />
        <Controller control={form.control} name="student_id" rules={{ required: "Required" }} render={({ field }) => (
          <Field label="Student" required error={errors.student_id?.message}>
            <Combobox data={studentOptions} value={field.value} onChange={field.onChange} disabled={!classId && !discount} placeholder="Choose student" />
          </Field>
        )} />
        <Controller control={form.control} name="year" rules={{ required: "Required" }} render={({ field }) => (
          <Field label="Year" required>
            <Combobox data={years.options} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Controller control={form.control} name="fee_plan_id" render={({ field }) => (
          <Field label="Plan" description="Empty: every plan of that year">
            <Combobox data={toOptions(plans.data, "fee_plan_id", "name")} value={field.value} onChange={field.onChange} clearable placeholder="All plans" />
          </Field>
        )} />
        <Controller control={form.control} name="kind" render={({ field }) => (
          <Field label="Type">
            <Combobox data={[{ value: "percent", label: "Percent off each instalment" }, { value: "amount", label: "Amount off the plan" }]} value={field.value} onChange={(v) => field.onChange(v ?? "percent")} />
          </Field>
        )} />
        <Field label="Value" htmlFor="disc-value" required error={errors.value?.message}>
          <Input id="disc-value" type="number" min={0.01} step="0.01" aria-invalid={!!errors.value} {...form.register("value", { required: "Required" })} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="disc-reason">
        <Input id="disc-reason" placeholder="e.g. Merit scholarship, sibling discount" {...form.register("reason")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function DiscountsTab({ currency }: { currency: string }) {
  const years = useYearOptions();
  const [year, setYear] = useState<string | null>(null);
  const shownYear = year ?? years.running;
  const { data, isLoading } = useGet<FeeDiscount[]>(shownYear ? "/fee-discounts" : null, { year: shownYear });
  const [editing, setEditing] = useState<FeeDiscount | "new" | null>(null);
  const remove = useAction((id: number) => api.delete(`/fee-discounts/${id}`), { success: "Deleted", invalidate: [["/fee-discounts"]] });

  return (
    <>
      <PageHeader
        title="Discounts & scholarships"
        subtitle="Applied when invoices are generated; invoices already created keep their amounts."
        actions={
          <>
            <Combobox className="w-36" data={years.options} value={shownYear || null} onChange={(v) => v && setYear(v)} />
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              Add discount
            </Button>
          </>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && (data ?? []).length === 0} colSpan={5} emptyText="No discounts this year" />
            {(data ?? []).map((d) => (
              <TableRow key={d.fee_discount_id}>
                <TableCell className="font-medium">{d.student_name ?? `#${d.student_id}`}</TableCell>
                <TableCell>{d.plan_name ?? <span className="text-muted-foreground">All plans</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{d.kind === "percent" ? `${d.value}%` : money(d.value, currency)}</TableCell>
                <TableCell>{d.reason ?? <Dash />}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction label="Edit" onClick={() => setEditing(d)}><PencilIcon /></IconAction>
                    <IconAction label="Delete" destructive onClick={() => confirmAction({ title: "Delete this discount?", onConfirm: () => remove.mutate(d.fee_discount_id) })}>
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add discount or scholarship" : "Edit discount"}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <DiscountForm key={editing === "new" ? "new" : editing.fee_discount_id} discount={editing === "new" ? null : editing} year={shownYear} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FeeSetupPage() {
  const user = useUser();
  const settings = usePublicSettings();
  const currency = settings.data?.currency ?? "usd";
  return (
    <Tabs defaultValue="plans" className="gap-4">
      <TabsList>
        <TabsTrigger value="plans">Fee plans</TabsTrigger>
        <TabsTrigger value="heads">Fee heads</TabsTrigger>
        <TabsTrigger value="discounts">Discounts & scholarships</TabsTrigger>
      </TabsList>
      <TabsContent value="plans">
        <PlansTab currency={currency} isAdmin={user.role === "admin"} />
      </TabsContent>
      <TabsContent value="heads">
        <CrudPage
          title="Fee heads"
          subtitle="Kinds of fees used in plans, e.g. Tuition, Bus, Lab."
          path="/fee-heads"
          idField="fee_head_id"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "description", label: "Description", type: "textarea" },
          ]}
        />
      </TabsContent>
      <TabsContent value="discounts">
        <DiscountsTab currency={currency} />
      </TabsContent>
    </Tabs>
  );
}

// --- receipt --------------------------------------------------------------------------

export function ReceiptPage() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGet<Receipt>(`/payments/${paymentId}/receipt`);
  const settings = usePublicSettings();

  if (isLoading) return <Skeleton className="mx-auto h-96 w-full max-w-2xl" />;
  if (isError || !data) return <EmptyState title="Receipt not available">It does not exist, or you are not allowed to see it.</EmptyState>;
  const currency = data.currency;
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="no-print flex justify-between gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeftIcon />
          Back
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <PrinterIcon />
          Print
        </Button>
      </div>
      <Card className="gap-6 print:border-0 print:shadow-none">
        <CardContent className="space-y-6 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {settings.data?.logo_url && <img src={settings.data.logo_url} alt="" className="size-12 rounded-md object-contain" />}
              <div className="space-y-0.5">
                <div className="text-base font-semibold">{data.school.system_name}</div>
                {data.school.address && <div className="text-muted-foreground whitespace-pre-line">{data.school.address}</div>}
                {(data.school.phone || data.school.system_email) && <div className="text-muted-foreground">{[data.school.phone, data.school.system_email].filter(Boolean).join(" · ")}</div>}
              </div>
            </div>
            <div className="space-y-1 text-right">
              <div className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Payment receipt</div>
              <div className="text-lg font-semibold">No. {data.payment_id}</div>
              <div className="text-muted-foreground">{fromUnix(data.timestamp)}</div>
            </div>
          </div>
          <Separator />
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              {row("Received from", data.student?.name ?? "—")}
              {data.student?.student_code && row("Student ID", data.student.student_code)}
              {data.class_name && row("Class", `${data.class_name}${data.section_name ? ` · ${data.section_name}` : ""}${data.roll ? ` · Roll ${data.roll}` : ""}`)}
            </div>
            <div>
              {row("Session", data.year ?? "—")}
              {row("Method", methodLabel(data.method))}
              {data.invoice && row("Invoice", `#${data.invoice.invoice_id}`)}
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="font-medium">{data.invoice?.title ?? data.title}</div>
                {data.description && <div className="text-muted-foreground">{data.description}</div>}
              </div>
              <div className="text-2xl font-semibold tabular-nums">{money(data.amount, currency)}</div>
            </div>
            {data.invoice && (
              <>
                <Separator className="my-3" />
                {row("Invoice total", money(data.invoice.amount, currency))}
                {row("Paid to date", money(data.invoice.amount_paid, currency))}
                {row("Balance due", <span className={cn(data.invoice.due > 0 ? "text-destructive" : "text-success")}>{money(data.invoice.due, currency)}</span>)}
              </>
            )}
          </div>
          <p className="text-muted-foreground text-center text-xs">Printed {dayjs().format("DD MMM YYYY HH:mm")}. This receipt was generated by the school management system.</p>
        </CardContent>
      </Card>
    </div>
  );
}
