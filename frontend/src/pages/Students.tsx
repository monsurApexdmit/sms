import dayjs from "dayjs";
import JsBarcode from "jsbarcode";
import {
  ArrowLeftIcon,
  ClipboardListIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EyeIcon,
  FileDownIcon,
  FileSpreadsheetIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  IdCardIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  UserRoundIcon,
  WalletIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, type RegisterOptions } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useClasses, useDebounced, useGet, useList, usePublicSettings, useSections } from "../api/hooks";
import type { IdCardInfo, Invoice, Payment, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox, type Option } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { ExportButton } from "../components/ExportButton";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { fromUnix, initials, money, titleCase, toOptions } from "../utils";
import { PasswordInput } from "./Auth";
import { BLOOD, GENDER, PhotoButton } from "./People";
import { t as tr, tn } from "../i18n";

interface ParentInfo {
  parent_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  profession: string | null;
  address: string | null;
}

// --- add / edit form ------------------------------------------------------------

const EMPTY = {
  name: "", email: "", password: "", student_code: "", birthday: "", sex: null as string | null, religion: "",
  blood_group: null as string | null, address: "", phone: "", parent_id: null as string | null,
  transport_id: null as string | null, dormitory_id: null as string | null, dormitory_room_number: "",
  class_id: null as string | null, section_id: null as string | null, roll: "",
};  // prettier-ignore

type FormValues = typeof EMPTY;
type Key = keyof FormValues;

function initialValues(editing: Student | null): FormValues {
  if (!editing) return EMPTY;
  const values = { ...EMPTY } as Record<string, unknown>;
  for (const [k, v] of Object.entries(editing)) {
    if (!(k in EMPTY)) continue;
    const blank = EMPTY[k as Key] === null ? null : "";
    values[k] = v === null || v === undefined || v === "" ? blank : String(v);
  }
  values.birthday = editing.birthday && dayjs(editing.birthday).isValid() ? dayjs(editing.birthday).format("YYYY-MM-DD") : "";
  values.password = "";
  return values as FormValues;
}

function StudentForm({ editing, onDone }: { editing: Student | null; onDone: () => void }) {
  const form = useForm<FormValues>({ defaultValues: initialValues(editing) });
  const errors = form.formState.errors;
  const classId = form.watch("class_id");
  const classes = useClasses();
  const sections = useSections(classId);
  const parents = useList<{ parent_id: number; name: string }>("/parents");
  const transports = useList<{ transport_id: number; route_name: string }>("/transports");
  const dorms = useList<{ dormitory_id: number; name: string }>("/dormitories");

  const save = useAction(
    (v: FormValues) => {
      const num = (x: unknown) => (x === "" || x === null ? null : Number(x));
      const payload = {
        ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x])),
        birthday: v.birthday || null,
        password: v.password || undefined,
        parent_id: num(v.parent_id),
        transport_id: num(v.transport_id),
        dormitory_id: num(v.dormitory_id),
        class_id: Number(v.class_id),
        section_id: num(v.section_id),
        roll: num(v.roll),
      };
      return editing ? api.put(`/students/${editing.student_id}`, payload) : api.post("/students", payload);
    },
    { success: editing ? tr("Student updated") : tr("Student added"), invalidate: [["/students"]], onSuccess: onDone },
  );

  const text = (name: Key, label: string, o: { className?: string; required?: boolean; type?: string; placeholder?: string; rules?: RegisterOptions<FormValues, Key> } = {}) => (
    <Field label={label} htmlFor={`st-${name}`} required={o.required} error={errors[name]?.message} className={o.className}>
      <Controller
        control={form.control}
        name={name}
        rules={o.rules}
        render={({ field }) => (
          <Input
            id={`st-${name}`}
            type={o.type}
            min={o.type === "number" ? 1 : undefined}
            placeholder={o.placeholder}
            value={String(field.value ?? "")}
            onChange={field.onChange}
            onBlur={field.onBlur}
            aria-invalid={!!errors[name] || undefined}
          />
        )}
      />
    </Field>
  );

  const select = (name: Key, label: string, data: Option[], o: { className?: string; required?: boolean; onPick?: (v: string | null) => void } = {}) => (
    <Field label={label} htmlFor={`st-${name}`} required={o.required} error={errors[name]?.message} className={o.className}>
      <Controller
        control={form.control}
        name={name}
        rules={o.required ? { required: tr("Required") } : undefined}
        render={({ field }) => (
          <Combobox
            id={`st-${name}`}
            data={data}
            value={field.value as string | null}
            onChange={(v) => {
              field.onChange(v);
              o.onPick?.(v);
            }}
            clearable={!o.required}
            aria-invalid={!!errors[name] || undefined}
          />
        )}
      />
    </Field>
  );

  const half = "sm:col-span-6";
  const third = "sm:col-span-4";

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-12">
        {text("name", tr("Name"), { className: half, required: true, rules: { required: tr("Required") } })}
        {text("student_code", tr("Student ID no."), { className: half, placeholder: tr("auto if empty") })}
        {text("email", tr("Email"), { className: half, required: true, type: "email", rules: { validate: (v) => (/^\S+@\S+$/.test(String(v)) ? true : tr("Valid email required")) } })}
        <Field
          label={tr("Password")}
          htmlFor="st-password"
          required={!editing}
          description={editing ? tr("Leave empty to keep") : tr("At least 8 characters")}
          error={errors.password?.message}
          className={half}
        >
          <Controller
            control={form.control}
            name="password"
            rules={{ validate: (v) => (!editing && String(v).length < 8 ? tr("At least 8 characters") : true) }}
            render={({ field }) => (
              <PasswordInput id="st-password" autoComplete="new-password" value={String(field.value ?? "")} onChange={field.onChange} onBlur={field.onBlur} aria-invalid={!!errors.password || undefined} />
            )}
          />
        </Field>
        {select("class_id", tr("Class"), toOptions(classes.data?.items, "class_id", "name"), { className: third, required: true, onPick: () => form.setValue("section_id", null) })}
        {select("section_id", tr("Section"), toOptions(sections.data?.items, "section_id", "name"), { className: third })}
        {text("roll", tr("Roll"), { className: third, type: "number" })}
        {select("parent_id", tr("Parent"), toOptions(parents.data?.items, "parent_id", "name"), { className: half })}
        {text("phone", tr("Phone"), { className: half, type: "tel" })}
        {select("sex", tr("Gender"), GENDER, { className: third })}
        <Field label={tr("Birthday")} htmlFor="st-birthday" className={third}>
          <Controller control={form.control} name="birthday" render={({ field }) => <DatePicker id="st-birthday" value={String(field.value ?? "")} onChange={field.onChange} />} />
        </Field>
        {select("blood_group", tr("Blood group"), BLOOD, { className: third })}
        {text("religion", tr("Religion"), { className: half })}
        {select("transport_id", tr("Transport route"), toOptions(transports.data?.items, "transport_id", "route_name"), { className: half })}
        {select("dormitory_id", tr("Dormitory"), toOptions(dorms.data?.items, "dormitory_id", "name"), { className: half })}
        {text("dormitory_room_number", tr("Room number"), { className: half })}
        <Field label={tr("Address")} htmlFor="st-address" className="sm:col-span-12">
          <Controller control={form.control} name="address" render={({ field }) => <Textarea id="st-address" rows={2} value={String(field.value ?? "")} onChange={field.onChange} />} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>
          {tr("Save")}</Button>
      </DialogFooter>
    </form>
  );
}

// --- marksheet (profile tab + promotion results) ---------------------------------

interface MarksheetData {
  student: { student_id: number; name: string; student_code?: string | null; class_name?: string | null; section_name?: string | null; roll?: number | null };
  year: string;
  exams: {
    exam_id: number;
    name: string;
    total: number;
    average_grade_point: number;
    subjects: { subject_id: number; subject: string; mark_obtained: number | null; highest: number | null; grade: string | null; grade_point: string | number | null; comment: string | null }[];
  }[];
}

function MarksheetView({ studentId }: { studentId: number }) {
  const { data, isLoading, error } = useGet<MarksheetData>(`/marksheet/${studentId}`);
  if (isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (error) return <EmptyState icon={CircleAlertIcon} title={tr("Could not load marks")}>{errorMessage(error)}</EmptyState>;
  if (!data?.exams.length)
    return (
      <EmptyState icon={ClipboardListIcon} title={tr("No marks yet")}>
        {tn("No exam results for {value}.", { value: data?.year ?? tr("the running year") })}</EmptyState>
    );
  return (
    <div className="space-y-4">
      {data.exams.map((exam) => (
        <Card key={exam.exam_id} className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <span className="font-medium">{exam.name}</span>
            <div className="flex gap-2">
              <Badge variant="secondary">{tn("Total {total}", { total: exam.total })}</Badge>
              <Badge variant="outline">{tn("GPA {average_grade_point}", { average_grade_point: exam.average_grade_point })}</Badge>
            </div>
          </div>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{tr("Subject")}</TableHead>
                <TableHead className="text-right">{tr("Obtained")}</TableHead>
                <TableHead className="text-right">{tr("Highest")}</TableHead>
                <TableHead>{tr("Grade")}</TableHead>
                <TableHead>{tr("Comment")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exam.subjects.map((s) => (
                <TableRow key={s.subject_id}>
                  <TableCell>{s.subject}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.mark_obtained ?? <Dash />}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">{s.highest ?? <Dash />}</TableCell>
                  <TableCell>{s.grade ? <Badge variant="outline">{s.grade}</Badge> : <Dash />}</TableCell>
                  <TableCell className="text-muted-foreground max-w-48 truncate">{s.comment || <Dash />}</TableCell>
                </TableRow>
              ))}
              <TableState empty={exam.subjects.length === 0} colSpan={5} emptyText={tr("No subjects for this class")} />
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  );
}

// --- student profile sheet --------------------------------------------------------

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? <Dash /> : String(v));

function ParentCard({ parentId }: { parentId: number | null }) {
  const { data: p, isLoading } = useGet<ParentInfo>(parentId ? `/parents/${parentId}` : null);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRoundIcon className="text-muted-foreground size-4" />
          {tr("Parent")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!parentId ? (
          <p className="text-muted-foreground text-sm">{tr("Parent information is not available.")}</p>
        ) : isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : p ? (
          <div className="space-y-2 text-sm">
            <div className="font-medium">
              {p.name}
              {p.profession && <span className="text-muted-foreground font-normal"> · {p.profession}</span>}
            </div>
            {p.phone && (
              <a href={`tel:${p.phone}`} className="hover:text-primary flex items-center gap-2">
                <PhoneIcon className="text-muted-foreground size-4" />
                {p.phone}
              </a>
            )}
            {p.email && (
              <a href={`mailto:${p.email}`} className="hover:text-primary flex items-center gap-2 break-all">
                <MailIcon className="text-muted-foreground size-4" />
                {p.email}
              </a>
            )}
            {p.address && (
              <div className="flex items-center gap-2">
                <MapPinIcon className="text-muted-foreground size-4" />
                {p.address}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{tr("Parent information is not available.")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DetailsTab({ s }: { s: Student }) {
  const transports = useList<{ transport_id: number; route_name: string }>(s.transport_id ? "/transports" : null);
  const dorms = useList<{ dormitory_id: number; name: string }>(s.dormitory_id ? "/dormitories" : null);
  const transport = transports.data?.items.find((t) => t.transport_id === s.transport_id)?.route_name;
  const dorm = dorms.data?.items.find((d) => d.dormitory_id === s.dormitory_id)?.name;
  return (
    <div className="space-y-4">
      <Card className="gap-2 py-4">
        <CardContent>
          <dl className="divide-y">
            <InfoRow label={tr("Email")}>{show(s.email)}</InfoRow>
            <InfoRow label={tr("Phone")}>{show(s.phone)}</InfoRow>
            <InfoRow label={tr("Gender")}>{s.sex ? titleCase(s.sex) : <Dash />}</InfoRow>
            <InfoRow label={tr("Birthday")}>{s.birthday && dayjs(s.birthday).isValid() ? dayjs(s.birthday).format("DD MMM YYYY") : show(s.birthday)}</InfoRow>
            <InfoRow label={tr("Blood group")}>{show(s.blood_group)}</InfoRow>
            <InfoRow label={tr("Religion")}>{show(s.religion)}</InfoRow>
            <InfoRow label={tr("Address")}>{show(s.address)}</InfoRow>
            <InfoRow label={tr("Transport")}>{s.transport_id ? (transport ?? tr("#{transport_id}", { transport_id: s.transport_id })) : <Dash />}</InfoRow>
            <InfoRow label={tr("Dormitory")}>
              {s.dormitory_id ? tr("{value}{value2}", { value: dorm ?? `#${s.dormitory_id}`, value2: s.dormitory_room_number ? " " + tr("· room {dormitory_room_number}", { dormitory_room_number: s.dormitory_room_number }) : "" }) : <Dash />}
            </InfoRow>
          </dl>
        </CardContent>
      </Card>
      <ParentCard parentId={s.parent_id} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const paid = status === "paid";
  return (
    <Badge className={cn("border-transparent", paid ? "bg-success/15 text-success" : "bg-warning/20 text-amber-700 dark:text-amber-300")}>
      {titleCase(status || "unpaid")}
    </Badge>
  );
}

function PaymentsTab({ studentId }: { studentId: number }) {
  const currency = usePublicSettings().data?.currency ?? "usd";
  const invoices = useList<Invoice>("/invoices", { student_id: studentId });
  const payments = useList<Payment>("/payments", { student_id: studentId, payment_type: "income" });
  const due = (invoices.data?.items ?? []).reduce((sum, i) => sum + Number(i.due ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="flex items-center gap-2 font-medium">
            <ReceiptIcon className="text-muted-foreground size-4" />
            {tr("Invoices")}</span>
          {due > 0 && <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">{tn("Due {due}", { due: money(due, currency) })}</Badge>}
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tr("Title")}</TableHead>
              <TableHead className="text-right">{tr("Amount")}</TableHead>
              <TableHead className="text-right">{tr("Paid")}</TableHead>
              <TableHead>{tr("Status")}</TableHead>
              <TableHead>{tr("Date")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={invoices.isLoading} empty={invoices.data?.items.length === 0} colSpan={5} emptyText={tr("No invoices")} />
            {invoices.data?.items.map((i) => (
              <TableRow key={i.invoice_id}>
                <TableCell className="max-w-40 truncate">{i.title}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.amount, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.amount_paid, currency)}</TableCell>
                <TableCell>
                  <StatusBadge status={i.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{fromUnix(i.creation_timestamp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b px-4 py-3 font-medium">
          <WalletIcon className="text-muted-foreground size-4" />
          {tr("Payment history")}</div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tr("Date")}</TableHead>
              <TableHead>{tr("Title")}</TableHead>
              <TableHead>{tr("Method")}</TableHead>
              <TableHead className="text-right">{tr("Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={payments.isLoading} empty={payments.data?.items.length === 0} colSpan={4} emptyText={tr("No payments recorded")} />
            {payments.data?.items.map((p) => (
              <TableRow key={p.payment_id}>
                <TableCell className="text-muted-foreground">{fromUnix(p.timestamp)}</TableCell>
                <TableCell className="max-w-40 truncate">{p.title || <Dash />}</TableCell>
                <TableCell>{p.method ? titleCase(p.method) : <Dash />}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.amount, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {!!payments.data?.items.length && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>{tr("Total paid")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(
                    payments.data.items.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
                    currency,
                  )}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>
    </div>
  );
}

function StudentAvatar({ s, className }: { s: Pick<Student, "name" | "image_url">; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={s.image_url ?? undefined} alt="" className="object-cover" />
      <AvatarFallback className="text-[length:inherit]">{initials(s.name)}</AvatarFallback>
    </Avatar>
  );
}

const classLabel = (s: Pick<Student, "class_name" | "section_name">) =>
  s.class_name ? `${s.class_name}${s.section_name ? ` / ${s.section_name}` : ""}` : null;

function StudentProfile({ id }: { id: number }) {
  const user = useUser();
  // invoices and payments are restricted to admin/accountant on the backend
  const canFinance = user.role === "admin" || user.role === "accountant";
  const { data: s, isLoading } = useGet<Student>(`/students/${id}`);

  if (isLoading || !s)
    return (
      <>
        <SheetHeader>
          <SheetTitle className="sr-only">{tr("Student profile")}</SheetTitle>
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );

  return (
    <>
      <SheetHeader className="bg-muted/40 border-b">
        <div className="flex items-center gap-4 pr-6">
          <StudentAvatar s={s} className="ring-background size-16 text-lg ring-4" />
          <div className="min-w-0 space-y-1">
            <SheetTitle className="truncate text-lg">{s.name}</SheetTitle>
            <SheetDescription>
              {classLabel(s) ?? tr("Not enrolled")}
              {s.roll ? " " + tr("· Roll {roll}", { roll: s.roll }) : ""}
            </SheetDescription>
            <div className="flex flex-wrap gap-1.5">
              {s.student_code && (
                <Badge variant="outline" className="font-mono">
                  {s.student_code}
                </Badge>
              )}
              {s.year && <Badge variant="secondary">{s.year}</Badge>}
            </div>
          </div>
        </div>
      </SheetHeader>
      <div className="px-4 pt-4 pb-6">
        <Tabs defaultValue="details" className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="details">{tr("Details")}</TabsTrigger>
            <TabsTrigger value="marks">{tr("Marks")}</TabsTrigger>
            {canFinance && <TabsTrigger value="payments">{tr("Payments")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="details">
            <DetailsTab s={s} />
          </TabsContent>
          <TabsContent value="marks">
            <MarksheetView studentId={s.student_id} />
          </TabsContent>
          {canFinance && (
            <TabsContent value="payments">
              <PaymentsTab studentId={s.student_id} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}

// --- bulk CSV import ------------------------------------------------------------

async function downloadTemplate() {
  try {
    const res = await api.get<Blob>("/students/bulk-csv/template", { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function BulkImport({ onDone }: { onDone: () => void }) {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const run = useAction(
    async () => {
      const body = new FormData();
      body.append("class_id", sel.classId!);
      if (sel.sectionId) body.append("section_id", sel.sectionId);
      body.append("file", file!);
      return (await api.post<{ created: number; errors: string[] }>("/students/bulk-csv", body)).data;
    },
    { invalidate: [["/students"]], onSuccess: setResult },
  );
  return (
    <div className="grid gap-4">
      <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <p className="min-w-0">
          {tr("CSV columns:")}{" "}<code className="text-xs break-all">StudentName,Id,Email,Password,Phone,Address,ParentID,Gender</code> {" "}{tr("(same as the old template).")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={downloading}
          onClick={async () => {
            setDownloading(true);
            await downloadTemplate();
            setDownloading(false);
          }}
        >
          <FileDownIcon />
          {tr("Download template")}</Button>
      </div>
      <ClassPicker value={sel} onChange={setSel} />
      <Field label={tr("CSV file")}>
        <FileButton onChange={setFile} accept=".csv,text/csv">
          {(props) => (
            <Button type="button" variant="outline" className="justify-start font-normal" {...props}>
              <FileSpreadsheetIcon />
              <span className={cn("truncate", !file && "text-muted-foreground")}>{file?.name ?? tr("Choose a .csv file")}</span>
            </Button>
          )}
        </FileButton>
      </Field>
      {result && (
        <Alert>
          {result.errors.length ? <CircleAlertIcon className="text-amber-600" /> : <CircleCheckIcon className="text-success" />}
          <AlertTitle>{tn("{created} students created", { created: result.created })}</AlertTitle>
          {result.errors.length > 0 && (
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tr("Close")}</Button>
        <Button disabled={!sel.classId || !file} loading={run.isPending} onClick={() => run.mutate(undefined)}>
          <UploadIcon />
          {tr("Import")}</Button>
      </DialogFooter>
    </div>
  );
}

// --- students list ----------------------------------------------------------------

export function StudentsPage() {
  const user = useUser();
  const admin = user.role === "admin";
  const navigate = useNavigate();
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [q, setQ] = useState("");
  const [transportId, setTransportId] = useState<string | null>(null);
  const [dormitoryId, setDormitoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Student | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const transports = useList<{ transport_id: number; route_name: string }>("/transports");
  const dorms = useList<{ dormitory_id: number; name: string }>("/dormitories");
  const filters = {
    class_id: sel.classId || undefined, section_id: sel.sectionId || undefined, q: q || undefined,
    transport_id: transportId || undefined, dormitory_id: dormitoryId || undefined,
  };  // prettier-ignore
  const { data, isLoading } = useList<Student>("/students", { ...filters, limit: 500 });
  const remove = useAction((id: number) => api.delete(`/students/${id}`), { success: tr("Student deleted"), invalidate: [["/students"]] });

  return (
    <>
      <PageHeader
        title={tr("Students")}
        subtitle={data ? tr("{total} students", { total: data.total }) : undefined}
        actions={
          <>
            <ExportButton size="default" path="/export/students.xlsx" params={filters} />
            {admin && (
              <>
                <Button variant="outline" onClick={() => setBulkOpen(true)}>
                  <UploadIcon />
                  {tr("Bulk import")}</Button>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <PlusIcon />
                  {tr("Add student")}</Button>
              </>
            )}
          </>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <ClassPicker value={sel} onChange={setSel} />
          <Field label={tr("Transport")} className="w-44">
            <Combobox data={toOptions(transports.data?.items, "transport_id", "route_name")} value={transportId} onChange={setTransportId} placeholder={tr("Any route")} clearable />
          </Field>
          <Field label={tr("Dormitory")} className="w-44">
            <Combobox data={toOptions(dorms.data?.items, "dormitory_id", "name")} value={dormitoryId} onChange={setDormitoryId} placeholder={tr("Any dormitory")} clearable />
          </Field>
          <Field label={tr("Search")} htmlFor="student-search" className="w-full sm:w-64">
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input id="student-search" placeholder={tr("Name, email or ID")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>
          </Field>
        </div>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>{tr("Roll")}</TableHead>
              <TableHead>{tr("Name")}</TableHead>
              <TableHead>{tr("ID")}</TableHead>
              <TableHead>{tr("Class")}</TableHead>
              <TableHead>{tr("Email")}</TableHead>
              <TableHead>{tr("Parent")}</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={data?.items.length === 0} colSpan={8} emptyText={tr("No students found")} />
            {data?.items.map((s) => (
              <TableRow key={s.student_id}>
                <TableCell>
                  <StudentAvatar s={s} className="size-8 text-xs" />
                </TableCell>
                <TableCell className="tabular-nums">{s.roll ?? <Dash />}</TableCell>
                <TableCell>
                  <button type="button" className="hover:text-primary font-medium hover:underline" onClick={() => setViewing(s.student_id)}>
                    {s.name}
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.student_code ?? <Dash />}</TableCell>
                <TableCell>{classLabel(s) ?? <span className="text-muted-foreground text-sm">{tr("not enrolled")}</span>}</TableCell>
                <TableCell className="text-muted-foreground">{s.email ?? <Dash />}</TableCell>
                <TableCell>{s.parent_name ?? <Dash />}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <IconAction label={tr("View profile")} onClick={() => setViewing(s.student_id)}>
                      <EyeIcon />
                    </IconAction>
                    <IconAction label={tr("Health, records & certificates")} onClick={() => navigate(`/app/students/${s.student_id}/records`)}>
                      <HeartPulseIcon />
                    </IconAction>
                    {admin && (
                      <>
                        <IconAction label={tr("ID card")} onClick={() => navigate(`/app/id-cards?student_id=${s.student_id}`)}>
                          <IdCardIcon />
                        </IconAction>
                        <PhotoButton path="/students" id={s.student_id} />
                        <IconAction
                          label={tr("Edit")}
                          onClick={() => {
                            setEditing(s);
                            setFormOpen(true);
                          }}
                        >
                          <PencilIcon />
                        </IconAction>
                        <IconAction
                          label={tr("Delete")}
                          destructive
                          onClick={() =>
                            confirmAction({
                              title: tr("Delete {name}?", { name: s.name }),
                              description: tr("This also removes the student's marks, attendance, invoices, payments and messages."),
                              onConfirm: () => remove.mutate(s.student_id),
                            })
                          }
                        >
                          <Trash2Icon />
                        </IconAction>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? tr("Edit student") : tr("Add student")}</DialogTitle>
            <DialogDescription>{editing ? editing.name : tr("Create the student account and enrol them in the running year.")}</DialogDescription>
          </DialogHeader>
          <StudentForm key={editing?.student_id ?? "new"} editing={editing} onDone={() => setFormOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("Bulk import students")}</DialogTitle>
            <DialogDescription>{tr("Upload a CSV to create many students in one class at once.")}</DialogDescription>
          </DialogHeader>
          <BulkImport onDone={() => setBulkOpen(false)} />
        </DialogContent>
      </Dialog>
      <Sheet open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {viewing !== null && <StudentProfile id={viewing} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

// --- promotion ----------------------------------------------------------------------

export function PromotionPage() {
  const { data: years } = useGet<{ running_year: string; years: string[] }>("/academic-years");
  const classes = useClasses();
  const [fromClass, setFromClass] = useState<string | null>(null);
  const [toClass, setToClass] = useState<string | null>(null);
  const [toYear, setToYear] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Student | null>(null);
  const students = useList<Student>(fromClass ? "/students" : null, { class_id: fromClass, limit: 1000 });
  const promote = useAction(
    () =>
      api.post<{ created: number; errors: string[] }>("/students/promotion", {
        to_year: toYear,
        items: (students.data?.items ?? []).map((s) => ({ student_id: s.student_id, class_id: Number(targets[s.student_id] ?? toClass) })),
      }),
    { success: tr("Students enrolled for the new year"), invalidate: [["/students"]] },
  );
  const classOptions = toOptions(classes.data?.items, "class_id", "name");
  const yearOptions = (years?.years ?? []).filter((y) => y > (years?.running_year ?? "")).map((y) => ({ value: y, label: y }));
  const count = students.data?.items.length ?? 0;

  return (
    <>
      <PageHeader title={tr("Student promotion")} subtitle={tr("Enrol students of the running year ({value}) into next year's classes", { value: years?.running_year ?? "" })} />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{tr("Promotion settings")}</CardTitle>
            <CardDescription>{tr("Pick the class to promote, its default target class and the new academic year.")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label={tr("Current class")} className="w-full sm:w-48">
              <Combobox data={classOptions} value={fromClass} onChange={setFromClass} placeholder={tr("Choose class")} />
            </Field>
            <Field label={tr("Promote to class")} className="w-full sm:w-48">
              <Combobox data={classOptions} value={toClass} onChange={setToClass} placeholder={tr("Choose class")} />
            </Field>
            <Field label={tr("Into academic year")} className="w-full sm:w-48">
              <Combobox data={yearOptions} value={toYear} onChange={setToYear} placeholder={tr("Choose year")} emptyText={tr("No later year configured")} />
            </Field>
          </CardContent>
        </Card>

        {fromClass ? (
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16">{tr("Roll")}</TableHead>
                  <TableHead>{tr("Name")}</TableHead>
                  <TableHead>{tr("Target class")}</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={students.isLoading} empty={count === 0} colSpan={4} emptyText={tr("No students in this class")} />
                {students.data?.items.map((s) => (
                  <TableRow key={s.student_id}>
                    <TableCell className="tabular-nums">{s.roll ?? <Dash />}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StudentAvatar s={s} className="size-7 text-xs" />
                        <span className="font-medium">{s.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Combobox
                        className="h-8 w-44"
                        data={classOptions}
                        value={targets[s.student_id] ?? toClass}
                        onChange={(v) => v && setTargets((t) => ({ ...t, [s.student_id]: v }))}
                        placeholder={tr("Choose class")}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="xs" onClick={() => setResults(s)}>
                        <ClipboardListIcon />
                        {tr("Results")}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t p-3">
              <Button disabled={!toClass || !toYear || !count} loading={promote.isPending} onClick={() => promote.mutate(undefined)}>
                <GraduationCapIcon />
                {tr("Enrol")}{" "}{count} {" "}{tr("students")}</Button>
            </div>
          </Card>
        ) : (
          <EmptyState icon={GraduationCapIcon} title={tr("Choose a class")}>
            {tr("Students of the selected class appear here with their exam results.")}</EmptyState>
        )}
      </div>

      <Dialog open={!!results} onOpenChange={(open) => !open && setResults(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{results?.name}</DialogTitle>
            <DialogDescription>
              {tn("Exam results for {value}{value2}", { value: years?.running_year ?? tr("the running year"), value2: results && classLabel(results) ? " " + tr("· {classLabel}", { classLabel: classLabel(results) }) : "" })}
            </DialogDescription>
          </DialogHeader>
          {results && <MarksheetView studentId={results.student_id} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- ID cards -----------------------------------------------------------------------

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height: 34, width: 1.4, margin: 0, fontSize: 11, textMargin: 1, background: "#ffffff" });
      setOk(true);
    } catch {
      setOk(false);
    }
  }, [value]);
  return <svg ref={ref} className={cn("h-[11mm] w-[44mm]", !ok && "hidden")} aria-label={tr("Barcode {value}", { value })} />;
}

const CARD_GRADIENT = { background: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary), black 38%))" };

function IdCard({ s, parentPhone, year, cardUid }: { s: Student; parentPhone?: string | null; year?: string | null; cardUid?: string }) {
  const settings = usePublicSettings().data;
  const rows: [string, ReactNode][] = [
    [tr("ID no."), s.student_code || s.student_id],
    [tr("Roll"), s.roll ?? "—"],
    [tr("Blood group"), s.blood_group || tr("N/A")],
    [tr("Parent phone"), parentPhone || s.phone || "—"],
  ];
  return (
    <div className="relative flex h-[86mm] w-[54mm] shrink-0 break-inside-avoid flex-col overflow-hidden rounded-[3mm] bg-white text-neutral-900 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_10px_28px_-10px_rgb(0_0_0/0.25)] ring-1 ring-black/5 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:m-[2mm] print:inline-flex print:align-top print:shadow-none print:ring-neutral-300">
      <div className="relative h-[31mm] shrink-0 overflow-hidden text-white" style={CARD_GRADIENT}>
        <div className="absolute -top-[12mm] -right-[9mm] size-[28mm] rounded-full bg-white/10" />
        <div className="absolute top-[9mm] -left-[11mm] size-[20mm] rounded-full bg-white/[0.07]" />
        <div className="relative flex items-center gap-[2mm] px-[3mm] pt-[3mm]">
          <div className="flex size-[8.5mm] shrink-0 items-center justify-center overflow-hidden rounded-[1.8mm] bg-white shadow-sm">
            {settings?.logo_url ? (
              <img src={settings.logo_url} alt="" className="size-full object-contain p-[0.6mm]" />
            ) : (
              <GraduationCapIcon className="text-primary size-[5mm]" />
            )}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="line-clamp-2 text-[7pt] font-bold tracking-wide uppercase">{settings?.system_name || tr("School")}</div>
            {settings?.address && <div className="truncate text-[5pt] opacity-80">{settings.address}</div>}
          </div>
        </div>
        <div className="relative mt-[1.6mm] flex items-center justify-center gap-[1.5mm] text-[5.5pt] font-semibold tracking-[0.22em] uppercase">
          <span className="h-px w-[5mm] bg-white/50" />
          {tr("Student ID card")}
          <span className="h-px w-[5mm] bg-white/50" />
        </div>
        <svg viewBox="0 0 54 10" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[7mm] w-full fill-white" aria-hidden>
          <path d="M0 10 V5 Q27 -4 54 5 V10 Z" />
        </svg>
      </div>

      <div className="relative z-10 -mt-[14mm] flex justify-center">
        <div className="flex h-[24mm] w-[20mm] items-center justify-center overflow-hidden rounded-[2mm] border-[0.7mm] border-white bg-neutral-100 text-[13pt] font-semibold text-neutral-400 shadow-md">
          {s.image_url ? <img src={s.image_url} alt="" className="size-full object-cover" /> : initials(s.name)}
        </div>
      </div>

      <div className="mt-[1.6mm] px-[3mm] text-center">
        <div className="line-clamp-2 text-[9pt] leading-tight font-bold">{s.name}</div>
        <div className="bg-primary/10 text-primary mt-[1mm] inline-block rounded-full px-[2.2mm] py-[0.3mm] text-[6pt] font-semibold">
          {classLabel(s) ?? tr("Not enrolled")}
        </div>
      </div>

      <dl className="mx-[4mm] mt-[2.2mm] grid grid-cols-2 gap-x-[2.5mm] gap-y-[1.4mm] border-t border-dashed border-neutral-200 pt-[1.8mm] leading-tight">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[4.6pt] font-medium tracking-wide text-neutral-500 uppercase">{k}</dt>
            <dd className="truncate text-[6.5pt] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex justify-center pb-[1.4mm]">
        <Barcode value={cardUid || s.student_code || String(s.student_id)} />
      </div>
      <div className="flex h-[4.2mm] shrink-0 items-center justify-center text-[5.5pt] font-medium tracking-wide text-white" style={CARD_GRADIENT}>
        {year ? tr("Valid for session {year}", { year }) : tr("Student ID card")}
      </div>
    </div>
  );
}

/** Find one student by name, ID no. or email to print just their card. */
function StudentSearch({ onPick }: { onPick: (s: Student) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const found = useList<Student>(open && term.length >= 2 ? "/students" : null, { q: term, limit: 20 });
  const items = found.data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="text-muted-foreground w-full justify-start font-normal sm:w-72">
          <SearchIcon />
          {tr("Search a student…")}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={tr("Name, ID no. or email")} />
          <CommandList>
            {term.length < 2 ? (
              <p className="text-muted-foreground p-3 text-center text-sm">{tr("Type at least 2 letters")}</p>
            ) : found.isLoading ? (
              <p className="text-muted-foreground p-3 text-center text-sm">{tr("Searching…")}</p>
            ) : (
              <CommandEmpty>{tr("No students found")}</CommandEmpty>
            )}
            <CommandGroup>
              {items.map((st) => (
                <CommandItem
                  key={st.student_id}
                  value={String(st.student_id)}
                  onSelect={() => {
                    onPick(st);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <Avatar className="size-7">
                    {st.image_url && <AvatarImage src={st.image_url} alt="" />}
                    <AvatarFallback className="text-[10px]">{initials(st.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{st.name}</div>
                    <div className="text-muted-foreground truncate text-xs">
                      {[st.student_code, classLabel(st)].filter(Boolean).join(" · ") || tr("Not enrolled")}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function IdCardsPage() {
  const [params, setParams] = useSearchParams();
  const single = params.get("student_id");
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const settings = usePublicSettings();
  const one = useGet<Student>(single ? `/students/${single}` : null);
  const list = useList<Student>(!single && sel.classId ? "/students" : null, {
    class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000,
  });  // prettier-ignore
  const parents = useList<ParentInfo>("/parents", { limit: 2000 });
  const phones = useMemo(() => new Map((parents.data?.items ?? []).map((p) => [p.parent_id, p.phone])), [parents.data]);
  const students = single ? (one.data ? [one.data] : []) : (list.data?.items ?? []);
  const loading = single ? one.isLoading : list.isLoading;
  // check-in cards (ID cards & devices): the barcode carries the active card code when there is one
  const cards = useList<IdCardInfo>(single || sel.classId ? "/id-cards" : null, {
    holder_role: "student", holder_id: single || undefined, class_id: single ? undefined : sel.classId, section_id: single ? undefined : sel.sectionId || undefined, limit: 2000,
  });  // prettier-ignore
  const cardUids = useMemo(() => new Map((cards.data?.items ?? []).map((c) => [c.holder_id, c.card_uid])), [cards.data]);
  const pick = (id: number) => setParams({ student_id: String(id) });

  return (
    <>
      <style>{"@media print { @page { size: A4 portrait; margin: 8mm; } }"}</style>
      <PageHeader
        title={tr("ID cards")}
        subtitle={single ? tr("Single student card") : tr("Print student identity cards for a class or section")}
        actions={
          <>
            {single && (
              <Button variant="outline" onClick={() => setParams({})}>
                <ArrowLeftIcon />
                {sel.classId ? tr("Back to class") : tr("Whole class")}</Button>
            )}
            <Button onClick={() => window.print()} disabled={!students.length}>
              <PrinterIcon />
              {students.length > 1 ? tr("Print all ({count})", { count: students.length }) : tr("Print")}</Button>
          </>
        }
      />
      <Card className="no-print mb-6 py-4">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 px-4">
          {single ? (
            <p className="text-muted-foreground self-center text-sm">{tr("Showing one student. Search for another, or go back to print a whole class.")}</p>
          ) : (
            <ClassPicker value={sel} onChange={setSel} />
          )}
          <div className="grid w-full gap-1.5 sm:w-auto">
            <span className="text-sm font-medium">{tr("Single student")}</span>
            <StudentSearch onPick={(st) => pick(st.student_id)} />
          </div>
        </CardContent>
      </Card>
      {loading ? (
        <div className="flex flex-wrap gap-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[86mm] w-[54mm] rounded-[3mm]" />
          ))}
        </div>
      ) : students.length ? (
        <div className={cn("flex flex-wrap gap-5 print:block", single && "justify-center")}>
          {students.map((s) => (
            <div key={s.student_id} className="group relative print:contents">
              <IdCard s={s} parentPhone={s.parent_id ? phones.get(s.parent_id) : null} year={s.year ?? settings.data?.running_year} cardUid={cardUids.get(s.student_id)} />
              {!single && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="no-print absolute inset-x-3 bottom-8 opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => pick(s.student_id)}
                >
                  <PrinterIcon />
                  {tr("Only this card")}</Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={IdCardIcon} title={single ? tr("Student not found") : sel.classId ? tr("No students in this class") : tr("Choose a class")}>
          {!single && !sel.classId && tr("Pick a class (and optionally a section), or search for one student.")}
        </EmptyState>
      )}
    </>
  );
}
