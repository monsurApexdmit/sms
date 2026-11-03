import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  BanknoteIcon,
  CircleAlertIcon,
  CreditCardIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptTextIcon,
  ScaleIcon,
  SearchIcon,
  Trash2Icon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm } from "react-hook-form";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useClasses, useDebounced, useGet, useList, usePagedList, usePublicSettings } from "../api/hooks";
import type { Invoice, InvoicePage, Payment, PaymentPage, PublicSettings, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox, MultiCombobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { fromUnix, money, toOptions } from "../utils";

const METHODS = ["cash", "cheque", "card", "bank", "mobile"].map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }));
// legacy rows store 1/2/3 for cash/cheque/card
const LEGACY_METHODS: Record<string, string> = { "1": "Cash", "2": "Cheque", "3": "Card", paypal: "PayPal", stripe: "Stripe" };
const methodLabel = (m: string | null | undefined) => (m ? LEGACY_METHODS[m] ?? METHODS.find((o) => o.value === m)?.label ?? m : "—");
const today = () => dayjs().format("YYYY-MM-DD");
const sum = <T,>(items: T[] | undefined, pick: (item: T) => unknown) => (items ?? []).reduce((acc, item) => acc + Number(pick(item) ?? 0), 0);

type InvoiceWithPayments = Invoice & { payments: Payment[] };
type InvoiceState = "paid" | "partial" | "unpaid";

function invoiceState(inv: Pick<Invoice, "status" | "amount_paid">): InvoiceState {
  if (inv.status === "paid") return "paid";
  return Number(inv.amount_paid ?? 0) > 0 ? "partial" : "unpaid";
}

const STATE_STYLE: Record<InvoiceState, [string, string]> = {
  paid: ["Paid", "border-transparent bg-success/15 text-success"],
  partial: ["Partial", "border-transparent bg-warning/20 text-amber-700 dark:text-amber-300"],
  unpaid: ["Unpaid", "border-destructive/50 text-destructive"],
};

function StatusBadge({ invoice }: { invoice: Pick<Invoice, "status" | "amount_paid"> }) {
  const [label, className] = STATE_STYLE[invoiceState(invoice)];
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

const TONES = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/20 text-amber-700 dark:text-amber-300",
};

function StatCard({ label, value, hint, icon: Icon, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: keyof typeof TONES }) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-5">
        <CardDescription className="text-xs font-medium tracking-wide uppercase">{label}</CardDescription>
        <span className={cn("flex size-8 items-center justify-center rounded-md", TONES[tone])}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="px-5">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function StatSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

// --- invoice forms --------------------------------------------------------------

interface InvoiceValues {
  student_id: string | null;
  student_ids: string[];
  title: string;
  description: string;
  amount: string;
  amount_paid: string;
  method: string;
  date: string;
}

function InvoiceForm({ onDone }: { onDone: () => void }) {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [mode, setMode] = useState<"single" | "mass">("single");
  const students = useList<Student>(sel.classId ? "/students" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000 });
  const form = useForm<InvoiceValues>({
    defaultValues: { student_id: null, student_ids: [], title: "", description: "", amount: "", amount_paid: "0", method: "cash", date: today() },
  });
  const { errors } = form.formState;
  const save = useAction(
    (v: InvoiceValues): Promise<unknown> => {
      const base = { title: v.title, description: v.description || null, amount: Number(v.amount), amount_paid: Number(v.amount_paid || 0), method: v.method, date: v.date || null };
      return mode === "single"
        ? api.post("/invoices", { ...base, student_id: Number(v.student_id) })
        : api.post("/invoices/mass", { ...base, student_ids: v.student_ids.map(Number) });
    },
    { success: "Invoice created", invalidate: [["/invoices"], ["/finance/summary"]], onSuccess: onDone },
  );
  const options = toOptions(students.data?.items, "student_id", "name");

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={(v) => v && setMode(v as "single" | "mass")}
        className="w-full"
      >
        <ToggleGroupItem value="single" className="flex-1">One student</ToggleGroupItem>
        <ToggleGroupItem value="mass" className="flex-1">Many students</ToggleGroupItem>
      </ToggleGroup>
      <ClassPicker value={sel} onChange={setSel} />
      {mode === "single" ? (
        <Controller
          control={form.control}
          name="student_id"
          rules={{ validate: (v) => (mode === "single" && !v ? "Choose a student" : true) }}
          render={({ field, fieldState }) => (
            <Field label="Student" required error={fieldState.error?.message}>
              <Combobox data={options} value={field.value} onChange={field.onChange} placeholder={sel.classId ? "Choose student" : "Choose a class first"} disabled={!sel.classId} aria-invalid={!!fieldState.error} />
            </Field>
          )}
        />
      ) : (
        <Controller
          control={form.control}
          name="student_ids"
          rules={{ validate: (v) => (mode === "mass" && !v.length ? "Choose at least one student" : true) }}
          render={({ field, fieldState }) => (
            <Field label="Students" required error={fieldState.error?.message}>
              <div className="flex items-start gap-2">
                <MultiCombobox data={options} value={field.value} onChange={field.onChange} placeholder={sel.classId ? "Choose students" : "Choose a class first"} disabled={!sel.classId} className="flex-1" />
                <Button type="button" variant="secondary" disabled={!options.length} onClick={() => field.onChange(options.map((o) => o.value))}>
                  All
                </Button>
              </div>
            </Field>
          )}
        />
      )}
      <Field label="Title" htmlFor="inv-title" required error={errors.title?.message}>
        <Input id="inv-title" aria-invalid={!!errors.title} {...form.register("title", { required: "Required" })} />
      </Field>
      <Field label="Description" htmlFor="inv-desc">
        <Textarea id="inv-desc" rows={2} {...form.register("description")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total amount" htmlFor="inv-amount" required error={errors.amount?.message}>
          <Input id="inv-amount" type="number" step="0.01" min={0} aria-invalid={!!errors.amount} {...form.register("amount", { validate: (v) => (Number(v) > 0 ? true : "Enter an amount") })} />
        </Field>
        <Field label="Paid now" htmlFor="inv-paid">
          <Input id="inv-paid" type="number" step="0.01" min={0} {...form.register("amount_paid")} />
        </Field>
        <Controller
          control={form.control}
          name="method"
          render={({ field }) => (
            <Field label="Method">
              <Combobox data={METHODS} value={field.value} onChange={(v) => field.onChange(v ?? "cash")} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="date"
          render={({ field }) => (
            <Field label="Date">
              <DatePicker value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Create</Button>
      </DialogFooter>
    </form>
  );
}

function PaymentForm({ invoice, currency, onDone }: { invoice: Invoice; currency: string; onDone: () => void }) {
  const due = Number(invoice.due ?? 0);
  const form = useForm({ defaultValues: { amount: String(due), method: "cash", date: today(), description: "" } });
  const { errors } = form.formState;
  const pay = useAction(
    (v: { amount: string; method: string; date: string; description: string }) =>
      api.post(`/invoices/${invoice.invoice_id}/payments`, { amount: Number(v.amount), method: v.method, date: v.date || null, description: v.description || null }),
    { success: "Payment recorded", invalidate: [["/invoices"], ["/finance/summary"], ["/payments"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => pay.mutate(v))} className="grid gap-4">
      <div className="bg-muted/50 grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm">
        <div className="col-span-3 font-medium">
          {invoice.student_name ?? "—"} · {invoice.title}
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Total</div>
          {money(invoice.amount, currency)}
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Paid</div>
          {money(invoice.amount_paid, currency)}
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Due</div>
          <span className="font-semibold">{money(due, currency)}</span>
        </div>
      </div>
      <Field label="Amount" htmlFor="pay-amount" required error={errors.amount?.message}>
        <Input
          id="pay-amount"
          type="number"
          step="0.01"
          min={0.01}
          max={due}
          aria-invalid={!!errors.amount}
          {...form.register("amount", { validate: (v) => (Number(v) <= 0 ? "Enter an amount" : Number(v) > due + 0.001 ? `At most ${money(due, currency)}` : true) })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="method"
          render={({ field }) => (
            <Field label="Method">
              <Combobox data={METHODS} value={field.value} onChange={(v) => field.onChange(v ?? "cash")} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="date"
          render={({ field }) => (
            <Field label="Date">
              <DatePicker value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      </div>
      <Field label="Note" htmlFor="pay-note">
        <Input id="pay-note" {...form.register("description")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={pay.isPending}>
          <BanknoteIcon />
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditInvoice({ invoice, loading, onCancel, onSave }: { invoice: Invoice; loading: boolean; onCancel: () => void; onSave: (v: { title: string; description: string; amount: number }) => void }) {
  const form = useForm({ defaultValues: { title: invoice.title, description: invoice.description ?? "", amount: String(invoice.amount) } });
  const { errors } = form.formState;
  return (
    <form onSubmit={form.handleSubmit((v) => onSave({ ...v, amount: Number(v.amount) }))} className="grid gap-4">
      <Field label="Title" htmlFor="edit-title" required error={errors.title?.message}>
        <Input id="edit-title" aria-invalid={!!errors.title} {...form.register("title", { required: "Required" })} />
      </Field>
      <Field label="Description" htmlFor="edit-desc">
        <Textarea id="edit-desc" rows={3} {...form.register("description")} />
      </Field>
      <Field label="Total amount" htmlFor="edit-amount" required error={errors.amount?.message}>
        <Input id="edit-amount" type="number" step="0.01" min={0} aria-invalid={!!errors.amount} {...form.register("amount", { validate: (v) => (Number(v) > 0 ? true : "Enter an amount") })} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>Save</Button>
      </DialogFooter>
    </form>
  );
}

// --- invoice view & print -------------------------------------------------------

// while an invoice is open, printing shows only the invoice copy rendered into <body>
const PRINT_CSS = "@media print { body > :not(#invoice-print) { display: none !important; } #invoice-print { padding: 32px; color: #000; background: #fff; } }";

function InvoiceDocument({ invoice, school, currency }: { invoice: InvoiceWithPayments; school?: PublicSettings; currency: string }) {
  return (
    <div className="space-y-6 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {school?.logo_url && <img src={school.logo_url} alt="" className="size-12 rounded-md object-contain" />}
          <div className="space-y-0.5">
            <div className="text-base font-semibold">{school?.system_name}</div>
            {school?.address && <div className="text-muted-foreground whitespace-pre-line">{school.address}</div>}
            {(school?.phone || school?.system_email) && <div className="text-muted-foreground">{[school.phone, school.system_email].filter(Boolean).join(" · ")}</div>}
          </div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">Invoice</div>
          <div className="text-lg font-semibold">#{invoice.invoice_id}</div>
          <div className="text-muted-foreground">{fromUnix(invoice.creation_timestamp)}</div>
          <StatusBadge invoice={invoice} />
        </div>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">Bill to</div>
          <div className="font-medium">{invoice.student_name ?? "—"}</div>
          {invoice.year && <div className="text-muted-foreground">Session {invoice.year}</div>}
        </div>
        {invoice.status === "paid" && invoice.payment_timestamp && (
          <div className="sm:text-right">
            <div className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">Paid on</div>
            <div>{fromUnix(invoice.payment_timestamp)}</div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full">
          <thead className="bg-muted/50 text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-3 py-2">
                <div className="font-medium">{invoice.title}</div>
                {invoice.description && <div className="text-muted-foreground whitespace-pre-line">{invoice.description}</div>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{money(invoice.amount, currency)}</td>
            </tr>
          </tbody>
          <tfoot className="border-t">
            <tr>
              <td className="px-3 pt-2 text-right text-muted-foreground">Total</td>
              <td className="px-3 pt-2 text-right tabular-nums">{money(invoice.amount, currency)}</td>
            </tr>
            <tr>
              <td className="px-3 text-right text-muted-foreground">Paid</td>
              <td className="px-3 text-right tabular-nums">{money(invoice.amount_paid, currency)}</td>
            </tr>
            <tr>
              <td className="px-3 pb-2 text-right font-semibold">Due</td>
              <td className="px-3 pb-2 text-right font-semibold tabular-nums">{money(invoice.due, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <div className="mb-2 font-semibold">Payment history</div>
        {invoice.payments.length === 0 ? (
          <p className="text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50 text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.payment_id} className="border-t">
                    <td className="px-3 py-2">{fromUnix(p.timestamp)}</td>
                    <td className="px-3 py-2">{methodLabel(p.method)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceDetail({ id, currency }: { id: number; currency: string }) {
  const { data } = useGet<InvoiceWithPayments>(`/invoices/${id}`);
  const settings = usePublicSettings();
  if (!data)
    return (
      <div className="space-y-4 px-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <PrinterIcon />
          Print
        </Button>
      </div>
      <InvoiceDocument invoice={data} school={settings.data} currency={currency} />
      <style>{PRINT_CSS}</style>
      {createPortal(
        <div id="invoice-print" className="print-only">
          <InvoiceDocument invoice={data} school={settings.data} currency={currency} />
        </div>,
        document.body,
      )}
    </div>
  );
}

function InvoiceSheet({ id, currency, onClose }: { id: number | null; currency: string; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Invoice</SheetTitle>
          <SheetDescription>Details, payments and a printable copy.</SheetDescription>
        </SheetHeader>
        {id !== null && <InvoiceDetail id={id} currency={currency} />}
      </SheetContent>
    </Sheet>
  );
}

// --- staff: invoices ------------------------------------------------------------

function StudentHistory({ currency, onView }: { currency: string; onView: (id: number) => void }) {
  const classes = useClasses();
  const [classId, setClassId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const students = useList<Student>(classId ? "/students" : null, { class_id: classId, limit: 1000 });
  const invoices = useList<Invoice>(studentId ? "/invoices" : null, { student_id: studentId, limit: 1000 });
  const payments = useList<Payment>(studentId ? "/payments" : null, { student_id: studentId, limit: 1000 });
  const student = students.data?.items.find((s) => String(s.student_id) === studentId);
  const billed = sum(invoices.data?.items, (i) => i.amount);
  const paid = sum(invoices.data?.items, (i) => i.amount_paid);
  const due = sum(invoices.data?.items, (i) => i.due);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end gap-3">
        <Field label="Class" className="w-44">
          <Combobox
            data={toOptions(classes.data?.items, "class_id", "name")}
            value={classId}
            onChange={(v) => {
              setClassId(v);
              setStudentId(null);
            }}
            placeholder="Choose class"
          />
        </Field>
        <Field label="Student" className="w-full sm:w-72">
          <Combobox
            data={(students.data?.items ?? []).map((s) => ({ value: String(s.student_id), label: s.roll ? `${s.name} (roll ${s.roll})` : s.name }))}
            value={studentId}
            onChange={setStudentId}
            disabled={!classId}
            placeholder={classId ? "Choose student" : "Choose a class first"}
            emptyText="No students in this class"
          />
        </Field>
        {studentId && (
          <Button variant="outline" onClick={() => window.print()} className="sm:ml-auto">
            <PrinterIcon />
            Print
          </Button>
        )}
      </div>

      {!studentId ? (
        <EmptyState icon={ReceiptTextIcon} title="Pick a student">
          Choose a class and a student to see their invoices and payments.
        </EmptyState>
      ) : (
        <>
          {student && (
            <div>
              <h2 className="text-lg font-semibold">{student.name}</h2>
              <p className="text-muted-foreground text-sm">
                {[student.class_name && `Class ${student.class_name}`, student.section_name && `Section ${student.section_name}`, student.roll && `Roll ${student.roll}`].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}
          {invoices.isLoading ? (
            <StatSkeleton count={3} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Billed" value={money(billed, currency)} hint={`${invoices.data?.items.length ?? 0} invoices`} icon={ReceiptTextIcon} />
              <StatCard label="Paid" value={money(paid, currency)} icon={WalletIcon} tone="success" />
              <StatCard label="Due" value={money(due, currency)} icon={CircleAlertIcon} tone={due > 0 ? "destructive" : "success"} />
            </div>
          )}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="no-print w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={invoices.isLoading} empty={invoices.data?.items.length === 0} colSpan={8} emptyText="No invoices for this student" />
                {invoices.data?.items.map((inv) => (
                  <TableRow key={inv.invoice_id}>
                    <TableCell className="text-muted-foreground">{inv.invoice_id}</TableCell>
                    <TableCell className="font-medium">{inv.title}</TableCell>
                    <TableCell>{fromUnix(inv.creation_timestamp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.amount, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.amount_paid, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.due, currency)}</TableCell>
                    <TableCell><StatusBadge invoice={inv} /></TableCell>
                    <TableCell className="no-print">
                      <IconAction label="View invoice" onClick={() => onView(inv.invoice_id)}><EyeIcon /></IconAction>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {!!invoices.data?.items.length && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{money(billed, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(paid, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(due, currency)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={payments.isLoading} empty={payments.data?.items.length === 0} colSpan={5} emptyText="No payments recorded" />
                {payments.data?.items.map((p) => (
                  <TableRow key={p.payment_id}>
                    <TableCell>{fromUnix(p.timestamp)}</TableCell>
                    <TableCell>{p.title ?? <Dash />}</TableCell>
                    <TableCell>{methodLabel(p.method)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.invoice_id ? `#${p.invoice_id}` : <Dash />}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.amount, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {!!payments.data?.items.length && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>Total received</TableCell>
                    <TableCell className="text-right tabular-nums">{money(sum(payments.data.items, (p) => p.amount), currency)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

export function InvoicesPage() {
  const settings = usePublicSettings();
  const currency = settings.data?.currency ?? "usd";
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Invoice, InvoicePage>("/invoices", { status: status === "all" ? undefined : status, q: q || undefined });
  const [createOpen, setCreateOpen] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const remove = useAction((id: number) => api.delete(`/invoices/${id}`), { success: "Invoice deleted", invalidate: [["/invoices"], ["/finance/summary"]] });
  const edit = useAction(
    (v: { title: string; description: string; amount: number }) => api.put(`/invoices/${editing!.invoice_id}`, v),
    { success: "Invoice updated", invalidate: [["/invoices"]], onSuccess: () => setEditing(null) },
  );

  const rows = data?.items ?? [];
  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Bill students, take payments and review payment history."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New invoice
          </Button>
        }
      />
      <Tabs defaultValue="invoices" className="gap-6">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="history">Student history</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="space-y-6">
          {isLoading ? (
            <StatSkeleton count={4} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Billed" value={money(summary?.billed ?? 0, currency)} hint={`${data?.total ?? 0} invoices`} icon={ReceiptTextIcon} />
              <StatCard label="Collected" value={money(summary?.collected ?? 0, currency)} icon={WalletIcon} tone="success" />
              <StatCard label="Outstanding" value={money(summary?.outstanding ?? 0, currency)} icon={CircleAlertIcon} tone="destructive" />
              <StatCard label="Open invoices" value={summary?.open ?? 0} hint={`${summary?.partial ?? 0} partially paid`} icon={BanknoteIcon} tone="warning" />
            </div>
          )}
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
              <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="unpaid">Unpaid</ToggleGroupItem>
                <ToggleGroupItem value="paid">Paid</ToggleGroupItem>
              </ToggleGroup>
              <div className="relative w-full sm:max-w-xs">
                <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input placeholder="Search student, title or number" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
            </div>
            <Table className="min-w-[800px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={9} emptyText="No invoices" />
                {rows.map((inv) => (
                  <TableRow key={inv.invoice_id}>
                    <TableCell className="text-muted-foreground">{inv.invoice_id}</TableCell>
                    <TableCell className="font-medium">{inv.student_name ?? <Dash />}</TableCell>
                    <TableCell>{inv.title}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.amount, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.amount_paid, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.due, currency)}</TableCell>
                    <TableCell><StatusBadge invoice={inv} /></TableCell>
                    <TableCell>{fromUnix(inv.creation_timestamp)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {inv.status !== "paid" && (
                          <IconAction label="Take payment" onClick={() => setPaying(inv)}>
                            <BanknoteIcon className="text-success" />
                          </IconAction>
                        )}
                        <IconAction label="View" onClick={() => setViewing(inv.invoice_id)}><EyeIcon /></IconAction>
                        <IconAction label="Edit" onClick={() => setEditing(inv)}><PencilIcon /></IconAction>
                        <IconAction
                          label="Delete"
                          destructive
                          onClick={() => confirmAction({ title: "Delete invoice?", description: "Its payments are deleted too.", onConfirm: () => remove.mutate(inv.invoice_id) })}
                        >
                          <Trash2Icon />
                        </IconAction>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <StudentHistory currency={currency} onView={setViewing} />
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>Bill one student or a whole group at once.</DialogDescription>
          </DialogHeader>
          {createOpen && <InvoiceForm onDone={() => setCreateOpen(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!paying} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
          </DialogHeader>
          {paying && <PaymentForm invoice={paying} currency={currency} onDone={() => setPaying(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit invoice</DialogTitle>
          </DialogHeader>
          {editing && <EditInvoice key={editing.invoice_id} invoice={editing} loading={edit.isPending} onCancel={() => setEditing(null)} onSave={(v) => edit.mutate(v)} />}
        </DialogContent>
      </Dialog>
      <InvoiceSheet id={viewing} currency={currency} onClose={() => setViewing(null)} />
    </>
  );
}

// --- accounting ---------------------------------------------------------------

interface Summary {
  income: number;
  expense: number;
  balance: number;
  unpaid_invoices: number;
  outstanding_due: number;
  currency: string;
  monthly: { month: string; income: number; expense: number }[];
}

interface ExpenseValues {
  title: string;
  expense_category_id: string | null;
  amount: string;
  method: string;
  date: string;
  description: string;
}

const EMPTY_EXPENSE: ExpenseValues = { title: "", expense_category_id: null, amount: "", method: "cash", date: today(), description: "" };

function PaymentsTable({ type, currency }: { type: "income" | "expense"; currency: string }) {
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Payment, PaymentPage>("/payments", { payment_type: type });
  const cats = useList<{ expense_category_id: number; name: string }>(type === "expense" ? "/expense-categories" : null);
  const [editing, setEditing] = useState<Payment | null | "new">(null);
  const remove = useAction((id: number) => api.delete(`/expenses/${id}`), { success: "Deleted", invalidate: [["/payments"], ["/finance/summary"]] });
  const form = useForm<ExpenseValues>({ defaultValues: EMPTY_EXPENSE });
  const { errors } = form.formState;
  const save = useAction(
    (v: ExpenseValues) => {
      const body = { ...v, expense_category_id: v.expense_category_id ? Number(v.expense_category_id) : null, amount: Number(v.amount), date: v.date || null, description: v.description || null };
      return editing && editing !== "new" ? api.put(`/expenses/${editing.payment_id}`, body) : api.post("/expenses", body);
    },
    { success: "Saved", invalidate: [["/payments"], ["/finance/summary"]], onSuccess: () => setEditing(null) },
  );
  const openForm = (p: Payment | "new") => {
    setEditing(p);
    form.reset(
      p === "new"
        ? { ...EMPTY_EXPENSE, date: today() }
        : {
            title: p.title ?? "",
            expense_category_id: p.expense_category_id ? String(p.expense_category_id) : null,
            amount: String(Number(p.amount ?? 0)),
            method: p.method ?? "cash",
            date: p.timestamp ? dayjs.unix(Number(p.timestamp)).format("YYYY-MM-DD") : "",
            description: p.description ?? "",
          },
    );
  };
  const total = data?.amount_total ?? 0;
  const colSpan = type === "expense" ? 6 : 5;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="text-sm">
          <span className="text-muted-foreground">{type === "income" ? "Total income" : "Total expenses"}: </span>
          <span className="font-semibold tabular-nums">{money(total, currency)}</span>
        </div>
        {type === "expense" && (
          <Button size="sm" onClick={() => openForm("new")}>
            <PlusIcon />
            Add expense
          </Button>
        )}
      </div>
      <Table className="min-w-[700px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>{type === "income" ? "Student" : "Category"}</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            {type === "expense" && <TableHead className="w-24" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={isLoading} empty={data?.items.length === 0} colSpan={colSpan} emptyText="Nothing recorded" />
          {data?.items.map((p) => (
            <TableRow key={p.payment_id}>
              <TableCell>{fromUnix(p.timestamp)}</TableCell>
              <TableCell className="font-medium">{p.title ?? <Dash />}</TableCell>
              <TableCell>{(type === "income" ? p.student_name : p.category_name) ?? <Dash />}</TableCell>
              <TableCell>{methodLabel(p.method)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", type === "income" ? "text-success" : "text-destructive")}>{money(p.amount, currency)}</TableCell>
              {type === "expense" && (
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <IconAction label="Edit" onClick={() => openForm(p)}><PencilIcon /></IconAction>
                    <IconAction label="Delete" destructive onClick={() => confirmAction({ title: "Delete expense?", onConfirm: () => remove.mutate(p.payment_id) })}>
                      <Trash2Icon />
                    </IconAction>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add expense" : "Edit expense"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
            <Field label="Title" htmlFor="exp-title" required error={errors.title?.message}>
              <Input id="exp-title" aria-invalid={!!errors.title} {...form.register("title", { required: "Required" })} />
            </Field>
            <Controller
              control={form.control}
              name="expense_category_id"
              render={({ field }) => (
                <Field label="Category">
                  <Combobox data={toOptions(cats.data?.items, "expense_category_id", "name")} value={field.value} onChange={field.onChange} clearable placeholder="Choose category" />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="exp-amount" required error={errors.amount?.message}>
                <Input id="exp-amount" type="number" step="0.01" min={0.01} aria-invalid={!!errors.amount} {...form.register("amount", { validate: (v) => (Number(v) > 0 ? true : "Enter an amount") })} />
              </Field>
              <Controller
                control={form.control}
                name="method"
                render={({ field }) => (
                  <Field label="Method">
                    <Combobox data={METHODS} value={field.value} onChange={(v) => field.onChange(v ?? "cash")} />
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="date"
              render={({ field }) => (
                <Field label="Date">
                  <DatePicker value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
            <Field label="Description" htmlFor="exp-desc">
              <Textarea id="exp-desc" rows={3} {...form.register("description")} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function AccountingPage() {
  const { data, isLoading } = useGet<Summary>("/finance/summary");
  const currency = data?.currency ?? "usd";
  const peak = Math.max(1, ...(data?.monthly ?? []).flatMap((m) => [m.income, m.expense]));
  return (
    <>
      <PageHeader title="Income & expenses" subtitle="Running-year totals, monthly breakdown and the expense ledger." />
      <Tabs defaultValue="summary" className="gap-6">
        <TabsList className="w-full overflow-x-auto sm:w-fit">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="expense">Expenses</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="space-y-6">
          {isLoading || !data ? (
            <StatSkeleton count={4} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Income" value={money(data.income, currency)} icon={TrendingUpIcon} tone="success" />
                <StatCard label="Expenses" value={money(data.expense, currency)} icon={TrendingDownIcon} tone="destructive" />
                <StatCard label="Balance" value={money(data.balance, currency)} icon={ScaleIcon} />
                <StatCard label="Outstanding dues" value={money(data.outstanding_due, currency)} hint={`${data.unpaid_invoices} unpaid invoices`} icon={CircleAlertIcon} tone="warning" />
              </div>
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle>Monthly breakdown</CardTitle>
                </CardHeader>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Income</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableState empty={data.monthly.length === 0} colSpan={4} emptyText="No transactions this year" />
                    {data.monthly.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell>
                          <div className="font-medium">{dayjs(`${m.month}-01`).format("MMMM YYYY")}</div>
                          <div className="mt-1 flex max-w-48 flex-col gap-0.5" aria-hidden>
                            <span className="bg-success h-1 rounded-full" style={{ width: `${(m.income / peak) * 100}%` }} />
                            <span className="bg-destructive h-1 rounded-full" style={{ width: `${(m.expense / peak) * 100}%` }} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.income, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.expense, currency)}</TableCell>
                        <TableCell className={cn("text-right font-semibold tabular-nums", m.income - m.expense < 0 && "text-destructive")}>{money(m.income - m.expense, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="income"><PaymentsTable type="income" currency={currency} /></TabsContent>
        <TabsContent value="expense"><PaymentsTable type="expense" currency={currency} /></TabsContent>
        <TabsContent value="categories">
          <CrudPage title="Expense categories" path="/expense-categories" idField="expense_category_id" fields={[{ name: "name", label: "Name", required: true }]} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// --- student / parent ---------------------------------------------------------

export function MyInvoicesPage() {
  const user = useUser();
  const settings = usePublicSettings();
  const currency = settings.data?.currency ?? "usd";
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data, isLoading } = useGet<Invoice[]>("/invoices/mine");
  const [viewing, setViewing] = useState<number | null>(null);
  const pay = useAction(async (id: number) => (await api.post<{ url: string }>(`/invoices/${id}/stripe-checkout`)).data, {
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
  const paypal = useAction(async (id: number) => (await api.post<{ approve_url: string }>(`/invoices/${id}/paypal-order`)).data, {
    onSuccess: (r) => {
      window.location.href = r.approve_url;
    },
  });

  // PayPal sends the browser back with ?paypal=return&token=<order id> (or ?paypal=cancel); handle it exactly once
  const paypalHandled = useRef(false);
  useEffect(() => {
    const flag = params.get("paypal");
    if (!flag || paypalHandled.current) return;
    paypalHandled.current = true;
    const token = params.get("token");
    const strip = () => {
      const next = new URLSearchParams(params);
      ["paypal", "token", "PayerID"].forEach((k) => next.delete(k));
      const search = next.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    };
    if (flag !== "return" || !token) {
      if (flag === "cancel") toast.info("PayPal payment cancelled. Your invoice has not been charged.");
      strip();
      return;
    }
    api
      .post<{ status: "paid" | "pending"; invoice_id: number }>("/payments/paypal/capture", { order_id: token })
      .then(({ data: r }) => {
        if (r.status === "paid") toast.success("Payment received. Thank you!");
        else toast.info("PayPal is still processing your payment. The invoice will update once it is confirmed.");
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => {
        qc.invalidateQueries({ queryKey: ["/invoices/mine"] });
        qc.invalidateQueries({ queryKey: ["/invoices"] });
        strip();
      });
  }, [params, navigate, location.pathname, qc]);

  const parent = user.role === "parent";
  const colSpan = parent ? 7 : 6;
  const due = sum(data, (i) => i.due);

  return (
    <>
      <PageHeader title="Payments" subtitle={parent ? "Invoices of your children" : "Your invoices and payments"} />
      <div className="space-y-6">
        {params.get("paid") && (
          <Alert className="border-success/40 text-success">
            <WalletIcon />
            <AlertTitle>Thank you</AlertTitle>
            <AlertDescription>Your payment is being confirmed and the invoice will update in a moment.</AlertDescription>
          </Alert>
        )}
        {isLoading ? (
          <StatSkeleton count={3} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Billed" value={money(sum(data, (i) => i.amount), currency)} hint={`${data?.length ?? 0} invoices`} icon={ReceiptTextIcon} />
            <StatCard label="Paid" value={money(sum(data, (i) => i.amount_paid), currency)} icon={WalletIcon} tone="success" />
            <StatCard label="Due" value={money(due, currency)} icon={CircleAlertIcon} tone={due > 0 ? "destructive" : "success"} />
          </div>
        )}
        <Card className="gap-0 overflow-hidden py-0">
          <Table className="min-w-[700px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                {parent && <TableHead>Student</TableHead>}
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState loading={isLoading} empty={data?.length === 0} colSpan={colSpan} emptyText="No invoices" />
              {data?.map((inv) => (
                <TableRow key={inv.invoice_id}>
                  {parent && <TableCell>{inv.student_name}</TableCell>}
                  <TableCell className="font-medium">{inv.title}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(inv.amount, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(inv.due, currency)}</TableCell>
                  <TableCell><StatusBadge invoice={inv} /></TableCell>
                  <TableCell>{fromUnix(inv.creation_timestamp)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <IconAction label="View invoice" onClick={() => setViewing(inv.invoice_id)}><EyeIcon /></IconAction>
                      {inv.status !== "paid" && settings.data?.stripe_enabled && (
                        <Button size="sm" loading={pay.isPending && pay.variables === inv.invoice_id} disabled={paypal.isPending} onClick={() => pay.mutate(inv.invoice_id)}>
                          <CreditCardIcon />
                          Pay online
                        </Button>
                      )}
                      {inv.status !== "paid" && settings.data?.paypal_enabled && (
                        <Button size="sm" variant="outline" loading={paypal.isPending && paypal.variables === inv.invoice_id} disabled={pay.isPending} onClick={() => paypal.mutate(inv.invoice_id)}>
                          <WalletIcon />
                          Pay with PayPal
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <InvoiceSheet id={viewing} currency={currency} onClose={() => setViewing(null)} />
    </>
  );
}
