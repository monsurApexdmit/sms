import dayjs from "dayjs";
import { ArrowLeftIcon, ArrowRightLeftIcon, BadgeCheckIcon, ClockIcon, FileTextIcon, GraduationCapIcon, ImageIcon, PencilIcon, PlusIcon, PrinterIcon, SearchIcon, Trash2Icon, UploadIcon, WalletIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { LIVE, useAction, useClasses, useDebounced, useGet, usePagedList, usePublicSettings, useSections } from "../api/hooks";
import type { AdmissionApplication, AdmissionSettings, AdmissionStatus, Enquiry } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { findPhoto, PHOTO_ACCEPT, PHOTO_LABEL } from "../components/admission-photo";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { PAYMENT_METHODS, paymentMethodLabel } from "../components/payment-methods";
import { Pager } from "../components/Pager";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";
import { t, tn, tp } from "../i18n";

const STATUS: Record<AdmissionStatus, [string, string]> = {
  new: [t("New"), "bg-primary/10 text-primary"],
  reviewing: [t("Reviewing"), "bg-warning/20 text-amber-700 dark:text-amber-300"],
  accepted: [t("Accepted"), "bg-success/15 text-success"],
  rejected: [t("Rejected"), "bg-destructive/10 text-destructive"],
  enrolled: [t("Enrolled"), "bg-chart-2/15 text-chart-2"],
  withdrawn: [t("Withdrawn"), "bg-muted text-muted-foreground"],
};
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, [label]]) => ({ value, label }));
const SOURCE_LABEL: Record<AdmissionApplication["source"], string> = { online: t("Online"), office: t("Office"), enquiry: t("Enquiry") };
const ENQUIRY_SOURCES = [
  { value: "walk-in", label: t("Walk-in") },
  { value: "phone", label: t("Phone") },
  { value: "website", label: t("Website") },
  { value: "other", label: t("Other") },
];
const ENQUIRY_STATUS = [
  { value: "open", label: t("Open") },
  { value: "converted", label: t("Converted") },
  { value: "closed", label: t("Closed") },
];
const GENDERS = [
  { value: "male", label: t("Male") },
  { value: "female", label: t("Female") },
  { value: "other", label: t("Other") },
];
const INVALIDATE = [["/admissions"], ["/admissions/summary"], ["/enquiries"]];
const PAYMENT_FILTER = [
  { value: "unverified", label: t("Payment to verify") },
  { value: "verified", label: t("Payment verified") },
  { value: "none", label: t("No payment") },
];
const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

/** Payment method, transaction ID and whether the office has checked it. */
function PaymentCell({ a }: { a: AdmissionApplication }) {
  if (!a.payment_reference) return <Dash />;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {a.payment_verified ? <BadgeCheckIcon className="text-success size-4 shrink-0" /> : <ClockIcon className="size-4 shrink-0 text-amber-600" />}
        <span className="truncate font-mono text-xs">{a.payment_reference}</span>
      </div>
      <div className="text-muted-foreground text-xs">
        {paymentMethodLabel(a.payment_method)}
        {a.payment_amount !== null && ` · ${money(a.payment_amount)}`}
      </div>
    </div>
  );
}

const StatusBadge = ({ status }: { status: AdmissionStatus }) => (
  <Badge className={cn("border-transparent", STATUS[status]?.[1])}>{STATUS[status]?.[0] ?? status}</Badge>
);

// --- settings strip -------------------------------------------------------------------

function AdmissionSettingsBar({ isAdmin }: { isAdmin: boolean }) {
  const settings = useGet<AdmissionSettings>("/admissions/settings");
  const [feeOpen, setFeeOpen] = useState(false);
  const years = useGet<{ years: string[] }>("/academic-years");
  const summary = useGet<{ year: string; counts: Record<AdmissionStatus, number> }>("/admissions/summary", undefined, LIVE);
  const save = useAction((v: AdmissionSettings) => api.put("/admissions/settings", v), {
    success: t("Admission settings saved"),
    invalidate: [["/admissions/settings"], ["/admissions/summary"]],
  });
  const s = settings.data;
  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-end justify-between gap-4 px-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 pb-2">
            <Switch id="adm-open" disabled={!isAdmin || !s} checked={!!s?.open} onCheckedChange={(open) => s && save.mutate({ ...s, open })} />
            <Label htmlFor="adm-open">{t("Online applications open")}</Label>
          </div>
          <Field label={t("Admission year")} className="w-40">
            <Combobox
              disabled={!isAdmin || !s}
              data={[...new Set([...(years.data?.years ?? []), ...(s ? [s.year] : [])])].sort().map((y) => ({ value: y, label: y }))}
              value={s?.year ?? null}
              onChange={(year) => s && year && save.mutate({ ...s, year })}
            />
          </Field>
          <Button variant="outline" disabled={!s} onClick={() => setFeeOpen(true)}>
            <WalletIcon />
            {s?.fee ? tn("Application fee: {value}", { value: money(s.fee) }) : t("Application fee")}
            {s?.payment_required && <Badge variant="secondary" className="ml-1">{t("Required")}</Badge>}
          </Button>
        </div>
        {summary.data && (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS) as AdmissionStatus[]).map((k) => (
              <Badge key={k} variant="outline" className="tabular-nums">
                {STATUS[k][0]} {summary.data!.counts[k] ?? 0}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={feeOpen} onOpenChange={setFeeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Application fee")}</DialogTitle>
            <DialogDescription>{t("Shown on the online admission form. Applicants pay outside the system and enter the transaction ID; you verify it here.")}</DialogDescription>
          </DialogHeader>
          {s && <FeeForm settings={s} readOnly={!isAdmin} saving={save.isPending} onSave={(v) => save.mutate(v, { onSuccess: () => setFeeOpen(false) })} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FeeForm({ settings, readOnly, saving, onSave }: { settings: AdmissionSettings; readOnly: boolean; saving: boolean; onSave: (v: AdmissionSettings) => void }) {
  const [fee, setFee] = useState(settings.fee === null ? "" : String(Number(settings.fee)));
  const [required, setRequired] = useState(settings.payment_required);
  const [instructions, setInstructions] = useState(settings.payment_instructions ?? "");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...settings, fee: fee.trim() === "" ? null : fee.trim(), payment_required: required, payment_instructions: instructions.trim() || null });
      }}
    >
      <Field label={t("Fee amount")} htmlFor="adm-fee" description={t("Empty: no fee")}>
        <Input id="adm-fee" type="number" min={0} step="0.01" className="w-40" disabled={readOnly} value={fee} onChange={(e) => setFee(e.target.value)} />
      </Field>
      <Field label={t("How to pay")} htmlFor="adm-pay-how" description={t("For example: Send the fee to bKash 01700-000000 (Payment), then enter the TrxID.")}>
        <Textarea id="adm-pay-how" rows={3} disabled={readOnly} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Switch id="adm-pay-required" disabled={readOnly} checked={required} onCheckedChange={setRequired} />
        <Label htmlFor="adm-pay-required">{t("Online applications must include a payment transaction ID")}</Label>
      </div>
      {!readOnly && (
        <DialogFooter>
          <Button type="submit" loading={saving}>{t("Save")}</Button>
        </DialogFooter>
      )}
    </form>
  );
}

// --- application form (office entry / edit) ----------------------------------------------

type ApplicationValues = Record<
  "student_name" | "date_of_birth" | "previous_school" | "guardian_name" | "guardian_relation" | "guardian_phone" | "guardian_email" | "address" | "notes",
  string
> & { class_id: string | null; gender: string | null; payment_method: string | null; payment_reference: string; payment_amount: string };

const toValues = (a: AdmissionApplication | null): ApplicationValues => ({
  student_name: a?.student_name ?? "",
  class_id: a ? String(a.class_id) : null,
  date_of_birth: a?.date_of_birth ?? "",
  gender: a?.gender ?? null,
  previous_school: a?.previous_school ?? "",
  guardian_name: a?.guardian_name ?? "",
  guardian_relation: a?.guardian_relation ?? "",
  guardian_phone: a?.guardian_phone ?? "",
  guardian_email: a?.guardian_email ?? "",
  address: a?.address ?? "",
  notes: a?.notes ?? "",
  payment_method: a?.payment_method ?? null,
  payment_reference: a?.payment_reference ?? "",
  payment_amount: a?.payment_amount === null || a?.payment_amount === undefined ? "" : String(Number(a.payment_amount)),
});

function ApplicationForm({ application, onDone }: { application: AdmissionApplication | null; onDone: (a: AdmissionApplication) => void }) {
  const classes = useClasses();
  const form = useForm<ApplicationValues>({ defaultValues: toValues(application) });
  const { errors } = form.formState;
  const save = useAction(
    async (v: ApplicationValues) => {
      const body = { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x])), class_id: Number(v.class_id) };
      const r = application ? await api.put(`/admissions/${application.application_id}`, body) : await api.post("/admissions", body);
      return r.data as AdmissionApplication;
    },
    { success: t("Saved"), invalidate: INVALIDATE, onSuccess: onDone },
  );
  const text = (name: keyof ApplicationValues, label: string, opts: { required?: boolean; className?: string; type?: string } = {}) => (
    <Field label={label} htmlFor={`app-${name}`} required={opts.required} error={errors[name]?.message} className={opts.className}>
      <Input id={`app-${name}`} type={opts.type} aria-invalid={!!errors[name]} {...form.register(name, opts.required ? { required: t("Required") } : {})} />
    </Field>
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("student_name", t("Student name"), { required: true })}
        <Controller control={form.control} name="class_id" rules={{ required: t("Required") }} render={({ field }) => (
          <Field label={t("Class applied for")} required error={errors.class_id?.message}>
            <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Controller control={form.control} name="date_of_birth" render={({ field }) => (
          <Field label={t("Date of birth")}><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
        <Controller control={form.control} name="gender" render={({ field }) => (
          <Field label={t("Gender")}><Combobox data={GENDERS} value={field.value} onChange={field.onChange} clearable /></Field>
        )} />
        {text("previous_school", t("Previous school"), { className: "sm:col-span-2" })}
        {text("guardian_name", t("Guardian name"), { required: true })}
        {text("guardian_relation", t("Relation"))}
        {text("guardian_phone", t("Guardian phone"), { required: true, type: "tel" })}
        {text("guardian_email", t("Guardian email"), { type: "email" })}
      </div>
      <Field label={t("Address")} htmlFor="app-address"><Textarea id="app-address" rows={2} {...form.register("address")} /></Field>
      <Field label={t("Notes")} htmlFor="app-notes"><Textarea id="app-notes" rows={2} {...form.register("notes")} /></Field>
      <Separator />
      <div className="grid gap-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><WalletIcon className="text-muted-foreground size-4" />{t("Application fee payment")}</h3>
        <p className="text-muted-foreground text-xs">{t("Optional. Changing the payment clears its verification.")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Controller control={form.control} name="payment_method" rules={{ validate: (v, all) => !!v === !!all.payment_reference.trim() || t("Give both the method and the transaction ID") }} render={({ field }) => (
          <Field label={t("Payment method")} error={errors.payment_method?.message}>
            <Combobox data={PAYMENT_METHODS} value={field.value} onChange={field.onChange} clearable />
          </Field>
        )} />
        {text("payment_reference", t("Transaction ID / receipt no."))}
        <Field label={t("Amount paid")} htmlFor="app-payment_amount">
          <Input id="app-payment_amount" type="number" min={0} step="0.01" {...form.register("payment_amount")} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

// --- enrol ------------------------------------------------------------------------------

interface EnrollValues {
  section_id: string | null;
  roll: string;
  student_email: string;
  student_password: string;
  parent_email: string;
  parent_password: string;
}

function EnrollForm({ application, onDone }: { application: AdmissionApplication; onDone: () => void }) {
  const sections = useSections(application.class_id);
  const form = useForm<EnrollValues>({
    defaultValues: { section_id: null, roll: "", student_email: "", student_password: "", parent_email: application.guardian_email ?? "", parent_password: "" },
  });
  const { errors } = form.formState;
  const enroll = useAction(
    (v: EnrollValues) =>
      api.post(`/admissions/${application.application_id}/enroll`, {
        section_id: Number(v.section_id),
        roll: v.roll ? Number(v.roll) : null,
        student_email: v.student_email.trim(),
        student_password: v.student_password,
        parent_email: v.parent_email.trim() || null,
        parent_password: v.parent_password || null,
      }),
    { success: t("{student_name} enrolled", { student_name: application.student_name }), invalidate: [...INVALIDATE, ["/students"]], onSuccess: onDone },
  );
  const password = { minLength: { value: 8, message: t("At least 8 characters") } };
  return (
    <form onSubmit={form.handleSubmit((v) => enroll.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="section_id" rules={{ required: t("Required") }} render={({ field }) => (
          <Field label={t("Section of class {value}", { value: application.class_name ?? "" })} required error={errors.section_id?.message}>
            <Combobox data={toOptions(sections.data?.items, "section_id", "name")} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Field label={t("Roll")} htmlFor="enr-roll" description={t("Empty: next free roll number")}>
          <Input id="enr-roll" type="number" min={1} {...form.register("roll")} />
        </Field>
        <Field label={t("Student login email")} htmlFor="enr-semail" required error={errors.student_email?.message}>
          <Input id="enr-semail" type="email" aria-invalid={!!errors.student_email} {...form.register("student_email", { required: t("Required") })} />
        </Field>
        <Field label={t("Student password")} htmlFor="enr-spass" required error={errors.student_password?.message}>
          <Input id="enr-spass" type="password" autoComplete="new-password" aria-invalid={!!errors.student_password} {...form.register("student_password", { required: t("Required"), ...password })} />
        </Field>
      </div>
      <Separator />
      <p className="text-muted-foreground text-sm">
        {t("Parent account: an existing parent with this email is linked to the student. Otherwise a new parent account is created with the password below. Leave the email empty for none.")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Parent email")} htmlFor="enr-pemail">
          <Input id="enr-pemail" type="email" {...form.register("parent_email")} />
        </Field>
        <Field label={t("New parent password")} htmlFor="enr-ppass" error={errors.parent_password?.message}>
          <Input id="enr-ppass" type="password" autoComplete="new-password" {...form.register("parent_password", password)} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="submit" loading={enroll.isPending}>
          <GraduationCapIcon />
          {t("Enrol")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

// --- application detail -----------------------------------------------------------------

function ApplicationDetail({ id, isAdmin, onEdit, onEnroll }: { id: number; isAdmin: boolean; onEdit: (a: AdmissionApplication) => void; onEnroll: (a: AdmissionApplication) => void }) {
  const { data: a } = useGet<AdmissionApplication>(`/admissions/${id}`, undefined, LIVE);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [label, setLabel] = useState("");
  const invalidate = [...INVALIDATE, [`/admissions/${id}`]];
  const saveStatus = useAction(
    () => api.post(`/admissions/${id}/status`, { status, note: note.trim() || null, notify }),
    { success: t("Status updated"), invalidate, onSuccess: () => setStatus(null) },
  );
  const upload = useAction(
    ({ file, label }: { file: File; label: string }) => {
      const body = new FormData();
      body.append("file", file);
      body.append("label", label);
      return api.post(`/admissions/${id}/documents`, body);
    },
    { success: t("Document added"), invalidate, onSuccess: () => setLabel("") },
  );
  const removeDoc = useAction((docId: number) => api.delete(`/admissions/${id}/documents/${docId}`), { success: t("Document removed"), invalidate });
  const verify = useAction((verified: boolean) => api.post(`/admissions/${id}/payment`, { verified }), {
    success: t("Payment updated"),
    invalidate,
  });

  if (!a) return null;
  const enrolled = a.status === "enrolled";
  const photo = findPhoto(a.documents);
  const rows: [string, React.ReactNode][] = [
    [t("Class"), `${a.class_name ?? a.class_id} · ${a.year}`],
    [t("Date of birth"), a.date_of_birth ? dayjs(a.date_of_birth).format("DD MMM YYYY") : null],
    [t("Gender"), a.gender],
    [t("Previous school"), a.previous_school],
    [t("Guardian"), [a.guardian_name, a.guardian_relation && `(${a.guardian_relation})`].filter(Boolean).join(" ")],
    [t("Phone"), a.guardian_phone],
    [t("Email"), a.guardian_email],
    [t("Address"), a.address],
    [t("Notes"), a.notes],
    [t("Received"), `${dayjs(a.created_at).format("DD MMM YYYY HH:mm")} · ${SOURCE_LABEL[a.source] ?? a.source}`],
  ];

  return (
    <div className="space-y-6 px-4 pb-6">
      <div className="flex items-start gap-4">
        <div className="bg-muted/50 flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {photo?.url ? <img src={photo.url} alt={t("Student photo")} className="size-full object-cover" /> : <ImageIcon className="text-muted-foreground size-7" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="truncate text-base font-semibold">{a.student_name}</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{a.reference}</span>
            <StatusBadge status={a.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link to={`/app/admissions/${a.application_id}/form`}>
                <PrinterIcon />
                {t("View / print form")}</Link>
            </Button>
            {isAdmin && !enrolled && (
              <FileButton accept={PHOTO_ACCEPT} onChange={(f) => f && upload.mutate({ file: f, label: PHOTO_LABEL })}>
                {(props) => (
                  <Button {...props} size="sm" variant="outline" loading={upload.isPending}>
                    <ImageIcon />
                    {photo ? t("Replace photo") : t("Upload photo")}</Button>
                )}
              </FileButton>
            )}
            {isAdmin && !enrolled && (
              <Button size="sm" variant="outline" onClick={() => onEdit(a)}>
                <PencilIcon />
                {t("Edit")}</Button>
            )}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="whitespace-pre-line">{v || <Dash />}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><WalletIcon className="text-muted-foreground size-4" />{t("Application fee payment")}</h3>
          {a.payment_reference && (
            <Badge className={cn("ml-auto border-transparent", a.payment_verified ? "bg-success/15 text-success" : "bg-warning/20 text-amber-700")}>
              {a.payment_verified ? t("Verified") : t("Not verified")}
            </Badge>
          )}
        </div>
        {a.payment_reference ? (
          <>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t("Method")}</dt>
              <dd>{paymentMethodLabel(a.payment_method)}</dd>
              <dt className="text-muted-foreground">{t("Transaction ID")}</dt>
              <dd className="font-mono break-all">{a.payment_reference}</dd>
              <dt className="text-muted-foreground">{t("Amount")}</dt>
              <dd>{a.payment_amount !== null ? money(a.payment_amount) : <Dash />}</dd>
              {a.payment_verified && (
                <>
                  <dt className="text-muted-foreground">{t("Verified by")}</dt>
                  <dd>{[a.payment_verified_by, a.payment_verified_at && dayjs(a.payment_verified_at).format("DD MMM YYYY HH:mm")].filter(Boolean).join(" · ")}</dd>
                </>
              )}
            </dl>
            {a.payment_verified ? (
              <Button size="sm" variant="ghost" loading={verify.isPending} onClick={() => verify.mutate(false)}>
                {t("Mark as not verified")}</Button>
            ) : (
              <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate(true)}>
                <BadgeCheckIcon />
                {t("Mark payment as verified")}</Button>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("No payment recorded.")}</p>
        )}
      </div>

      {a.status_note && (
        <p className="bg-muted rounded-md p-3 text-sm">
          <span className="font-medium">{t("Note:")}{" "}</span>
          {a.status_note}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Documents")}</h3>
        {(a.documents ?? []).length === 0 && <p className="text-muted-foreground text-sm">{t("No documents")}</p>}
        {(a.documents ?? []).map((d) => (
          <div key={d.document_id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <FileTextIcon className="text-muted-foreground size-4" />
            <a href={d.url ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">{d.label}</a>
            <span className="text-muted-foreground truncate text-xs">{d.file_name.replace(/^[0-9a-f]{12}_/, "")}</span>
            {isAdmin && !enrolled && (
              <IconAction label={t("Remove document")} destructive onClick={() => confirmAction({ title: t("Remove \"{label}\"?", { label: d.label }), onConfirm: () => removeDoc.mutate(d.document_id) })}>
                <Trash2Icon />
              </IconAction>
            )}
          </div>
        ))}
        {isAdmin && !enrolled && (
          <div className="flex flex-wrap gap-2">
            <Input className="w-56" placeholder={t("Label, e.g. Birth certificate")} value={label} onChange={(e) => setLabel(e.target.value)} />
            <FileButton accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(f) => f && upload.mutate({ file: f, label: label.trim() || "Document" })}>
              {(props) => (
                <Button {...props} variant="outline" loading={upload.isPending}>
                  <UploadIcon />
                  {t("Upload")}</Button>
              )}
            </FileButton>
          </div>
        )}
      </div>

      {isAdmin && !enrolled && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t("Decision")}</h3>
          <Combobox data={STATUS_OPTIONS.filter((o) => o.value !== "enrolled")} value={status ?? a.status} onChange={setStatus} />
          <Textarea rows={2} placeholder={t("Note (sent to the guardian with an acceptance or rejection)")} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id="adm-notify" checked={notify} onCheckedChange={setNotify} />
              <Label htmlFor="adm-notify">{t("Email the guardian")}</Label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!status || status === a.status} loading={saveStatus.isPending} onClick={() => saveStatus.mutate(undefined)}>
                {t("Save status")}</Button>
              {a.status === "accepted" && (
                <Button onClick={() => onEnroll(a)}>
                  <GraduationCapIcon />
                  {t("Enrol student")}</Button>
              )}
            </div>
          </div>
        </div>
      )}
      {enrolled && <p className="text-muted-foreground text-sm">{tn("Enrolled as student #{student_id}{value}.", { student_id: a.student_id, value: a.parent_id ? t(", parent #{parent_id}", { parent_id: a.parent_id }) : "" })}</p>}
    </div>
  );
}

// --- applications tab -------------------------------------------------------------------

function Applications({ isAdmin }: { isAdmin: boolean }) {
  const classes = useClasses();
  const [status, setStatus] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, isLoading, page, setPage, pageSize } = usePagedList<AdmissionApplication>("/admissions", {
    status: status ?? undefined, class_id: classId ?? undefined, payment: payment ?? undefined, q: q || undefined,
  }, 50, LIVE);  // prettier-ignore
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdmissionApplication | "new" | null>(null);
  const [enrolling, setEnrolling] = useState<AdmissionApplication | null>(null);
  const rows = data?.items ?? [];

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto]">
          <Combobox data={STATUS_OPTIONS} value={status} onChange={setStatus} clearable placeholder={t("All statuses")} />
          <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} clearable placeholder={t("All classes")} />
          <Combobox data={PAYMENT_FILTER} value={payment} onChange={setPayment} clearable placeholder={t("Any payment")} />
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder={t("Reference, student, guardian, phone or transaction ID")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              {t("New application")}</Button>
          )}
        </div>
        <Table className="min-w-[960px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Reference")}</TableHead>
              <TableHead>{t("Student")}</TableHead>
              <TableHead>{t("Class")}</TableHead>
              <TableHead>{t("Guardian")}</TableHead>
              <TableHead>{t("Payment")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Received")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={7} emptyText={t("No applications")} />
            {rows.map((a) => (
              <TableRow key={a.application_id} className="cursor-pointer" onClick={() => setViewing(a.application_id)}>
                <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                <TableCell className="font-medium">
                  {a.student_name}
                  {a.document_count > 0 && <span className="text-muted-foreground ml-2 text-xs">{tp(a.document_count, "{count} doc", "{count} docs")}</span>}
                </TableCell>
                <TableCell>{a.class_name ?? <Dash />}</TableCell>
                <TableCell>
                  <div>{a.guardian_name}</div>
                  <div className="text-muted-foreground text-xs">{a.guardian_phone}</div>
                </TableCell>
                <TableCell className="max-w-44"><PaymentCell a={a} /></TableCell>
                <TableCell><StatusBadge status={a.status} /></TableCell>
                <TableCell>
                  <div className="tabular-nums">{dayjs(a.created_at).format("DD MMM YYYY")}</div>
                  <div className="text-muted-foreground text-xs">{SOURCE_LABEL[a.source] ?? a.source}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </Card>

      <Sheet open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t("Application")}</SheetTitle>
            <SheetDescription>{t("Details, documents and decision.")}</SheetDescription>
          </SheetHeader>
          {viewing !== null && <ApplicationDetail id={viewing} isAdmin={isAdmin} onEdit={setEditing} onEnroll={setEnrolling} />}
        </SheetContent>
      </Sheet>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("New application") : t("Edit application")}</DialogTitle>
            {editing === "new" && <DialogDescription>{t("Register an applicant from the office: paper forms, phone calls and walk-ins.")}</DialogDescription>}
          </DialogHeader>
          {editing !== null && (
            <ApplicationForm
              key={editing === "new" ? "new" : editing.application_id}
              application={editing === "new" ? null : editing}
              onDone={(a) => {
                setEditing(null);
                setViewing(a.application_id);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={enrolling !== null} onOpenChange={(open) => !open && setEnrolling(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tn("Enrol {student_name}", { student_name: enrolling?.student_name })}</DialogTitle>
            <DialogDescription>{tn("Creates the student account and enrols the student for {year}.", { year: enrolling?.year })}</DialogDescription>
          </DialogHeader>
          {enrolling && <EnrollForm application={enrolling} onDone={() => setEnrolling(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- enquiries tab ----------------------------------------------------------------------

type EnquiryValues = { name: string; phone: string; email: string; class_id: string | null; source: string; follow_up_on: string; status: string; notes: string };

function EnquiryForm({ enquiry, onDone }: { enquiry: Enquiry | null; onDone: () => void }) {
  const classes = useClasses();
  const form = useForm<EnquiryValues>({
    defaultValues: {
      name: enquiry?.name ?? "", phone: enquiry?.phone ?? "", email: enquiry?.email ?? "",
      class_id: enquiry?.class_id ? String(enquiry.class_id) : null, source: enquiry?.source ?? "walk-in",
      follow_up_on: enquiry?.follow_up_on ?? "", status: enquiry?.status ?? "open", notes: enquiry?.notes ?? "",
    },
  });  // prettier-ignore
  const { errors } = form.formState;
  const save = useAction(
    (v: EnquiryValues) => {
      const body = {
        name: v.name.trim(), phone: v.phone.trim() || null, email: v.email.trim() || null, class_id: v.class_id ? Number(v.class_id) : null,
        source: v.source, follow_up_on: v.follow_up_on || null, status: v.status, notes: v.notes.trim() || null,
      };  // prettier-ignore
      return enquiry ? api.put(`/enquiries/${enquiry.enquiry_id}`, body) : api.post("/enquiries", body);
    },
    { success: t("Saved"), invalidate: [["/enquiries"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Name")} htmlFor="enq-name" required error={errors.name?.message}>
          <Input id="enq-name" aria-invalid={!!errors.name} {...form.register("name", { required: t("Required") })} />
        </Field>
        <Field label={t("Phone")} htmlFor="enq-phone"><Input id="enq-phone" type="tel" {...form.register("phone")} /></Field>
        <Field label={t("Email")} htmlFor="enq-email"><Input id="enq-email" type="email" {...form.register("email")} /></Field>
        <Controller control={form.control} name="class_id" render={({ field }) => (
          <Field label={t("Class of interest")}><Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} clearable /></Field>
        )} />
        <Controller control={form.control} name="source" render={({ field }) => (
          <Field label={t("Source")}><Combobox data={ENQUIRY_SOURCES} value={field.value} onChange={(v) => field.onChange(v ?? "walk-in")} /></Field>
        )} />
        <Controller control={form.control} name="follow_up_on" render={({ field }) => (
          <Field label={t("Follow up on")}><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
        {enquiry && (
          <Controller control={form.control} name="status" render={({ field }) => (
            <Field label={t("Status")}><Combobox data={ENQUIRY_STATUS} value={field.value} onChange={(v) => field.onChange(v ?? "open")} /></Field>
          )} />
        )}
      </div>
      <Field label={t("Notes")} htmlFor="enq-notes"><Textarea id="enq-notes" rows={3} {...form.register("notes")} /></Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function ConvertForm({ enquiry, onDone }: { enquiry: Enquiry; onDone: () => void }) {
  const classes = useClasses();
  const [studentName, setStudentName] = useState("");
  const [classId, setClassId] = useState<string | null>(enquiry.class_id ? String(enquiry.class_id) : null);
  const convert = useAction(
    () => api.post(`/enquiries/${enquiry.enquiry_id}/convert`, { student_name: studentName.trim(), class_id: classId ? Number(classId) : null }),
    { success: t("Application created"), invalidate: INVALIDATE, onSuccess: onDone },
  );
  return (
    <div className="grid gap-4">
      <Field label={t("Student name")} htmlFor="conv-name" required>
        <Input id="conv-name" value={studentName} onChange={(e) => setStudentName(e.target.value)} />
      </Field>
      <Field label={t("Class applied for")} required>
        <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} />
      </Field>
      <DialogFooter>
        <Button disabled={!studentName.trim() || !classId} loading={convert.isPending} onClick={() => convert.mutate(undefined)}>
          <ArrowRightLeftIcon />
          {t("Create application")}</Button>
      </DialogFooter>
    </div>
  );
}

function Enquiries({ isAdmin }: { isAdmin: boolean }) {
  const [due, setDue] = useState(false);
  const [status, setStatus] = useState<string | null>("open");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Enquiry>("/enquiries", {
    due: due || undefined, status: due ? undefined : status ?? undefined, q: q || undefined,
  }, 50, LIVE);  // prettier-ignore
  const [editing, setEditing] = useState<Enquiry | "new" | null>(null);
  const [converting, setConverting] = useState<Enquiry | null>(null);
  const remove = useAction((id: number) => api.delete(`/enquiries/${id}`), { success: t("Deleted"), invalidate: [["/enquiries"]] });
  const today = dayjs().format("YYYY-MM-DD");
  const rows = data?.items ?? [];

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="flex items-center gap-2">
            <Switch id="enq-due" checked={due} onCheckedChange={setDue} />
            <Label htmlFor="enq-due">{t("Follow-ups due")}</Label>
          </div>
          <Combobox className="w-40" disabled={due} data={ENQUIRY_STATUS} value={status} onChange={setStatus} clearable placeholder={t("All")} />
          <div className="relative min-w-56 flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder={t("Name, phone or email")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              {t("New enquiry")}</Button>
          )}
        </div>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Contact")}</TableHead>
              <TableHead>{t("Class")}</TableHead>
              <TableHead>{t("Source")}</TableHead>
              <TableHead>{t("Follow up")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              {isAdmin && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={isAdmin ? 7 : 6} emptyText={due ? t("No follow-ups due") : t("No enquiries")} />
            {rows.map((e) => (
              <TableRow key={e.enquiry_id} className="align-top">
                <TableCell>
                  <div className="font-medium">{e.name}</div>
                  {e.notes && <div className="text-muted-foreground max-w-64 truncate text-xs">{e.notes}</div>}
                </TableCell>
                <TableCell>
                  <div>{e.phone ?? <Dash />}</div>
                  {e.email && <div className="text-muted-foreground text-xs">{e.email}</div>}
                </TableCell>
                <TableCell>{e.class_name ?? <Dash />}</TableCell>
                <TableCell>{ENQUIRY_SOURCES.find((s) => s.value === e.source)?.label ?? e.source}</TableCell>
                <TableCell className={cn("tabular-nums", e.status === "open" && e.follow_up_on && e.follow_up_on <= today && "text-destructive font-medium")}>
                  {e.follow_up_on ? dayjs(e.follow_up_on).format("DD MMM YYYY") : <Dash />}
                </TableCell>
                <TableCell><Badge variant="outline">{ENQUIRY_STATUS.find((s) => s.value === e.status)?.label ?? e.status}</Badge></TableCell>
                {isAdmin && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {!e.application_id && (
                        <IconAction label={t("Convert to application")} onClick={() => setConverting(e)}><ArrowRightLeftIcon /></IconAction>
                      )}
                      <IconAction label={t("Edit")} onClick={() => setEditing(e)}><PencilIcon /></IconAction>
                      <IconAction label={t("Delete")} destructive onClick={() => confirmAction({ title: t("Delete enquiry from {name}?", { name: e.name }), onConfirm: () => remove.mutate(e.enquiry_id) })}>
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
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("New enquiry") : t("Edit enquiry")}</DialogTitle>
          </DialogHeader>
          {editing !== null && <EnquiryForm key={editing === "new" ? "new" : editing.enquiry_id} enquiry={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={converting !== null} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Start an application")}</DialogTitle>
            <DialogDescription>{tn("{name} becomes the guardian on the application.", { name: converting?.name })}</DialogDescription>
          </DialogHeader>
          {converting && <ConvertForm enquiry={converting} onDone={() => setConverting(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdmissionsPage() {
  const user = useUser();
  const isAdmin = user.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader title={t("Admissions")} subtitle={t("Online and office applications, decisions and enrolment, and enquiries to follow up.")} />
      <AdmissionSettingsBar isAdmin={isAdmin} />
      <Tabs defaultValue="applications" className="gap-6">
        <TabsList>
          <TabsTrigger value="applications">{t("Applications")}</TabsTrigger>
          <TabsTrigger value="enquiries">{t("Enquiries")}</TabsTrigger>
        </TabsList>
        <TabsContent value="applications">
          <Applications isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="enquiries">
          <Enquiries isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- printable application form -------------------------------------------------------

function FormValue({ label, value, className, mono }: { label: string; value?: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn("flex items-end gap-2 text-sm", className)}>
      <span className="text-muted-foreground shrink-0 font-medium print:text-black">{label}:</span>
      <span className={cn("border-foreground/30 min-h-6 flex-1 border-b border-dashed pb-0.5 font-semibold print:border-black", mono && "font-mono")}>
        {value || " "}
      </span>
    </div>
  );
}

function Tick({ label, checked }: { label: string; checked: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="border-foreground/60 inline-flex size-4 items-center justify-center rounded-sm border text-[11px] leading-none font-bold print:border-black">{checked ? "✓" : ""}</span>
      {label}
    </span>
  );
}

function FormBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-4">
      <h2 className="bg-muted rounded-md px-3 py-1.5 text-sm font-bold tracking-wide uppercase print:bg-gray-100">{title}</h2>
      {children}
    </section>
  );
}

/** One application laid out like the paper admission form, with the applicant's photo, ready to print. */
export function ApplicationFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: a, isLoading, isError } = useGet<AdmissionApplication>(`/admissions/${id}`);
  const settings = usePublicSettings().data;

  if (isLoading) return <Skeleton className="mx-auto h-[60rem] w-full max-w-4xl" />;
  if (isError || !a) return <EmptyState title={t("Application not found")}>{t("It may have been deleted.")}</EmptyState>;

  const photo = findPhoto(a.documents);
  const date = (d: string | null) => (d ? dayjs(d).format("DD MMM YYYY") : null);
  const name = settings?.system_name ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeftIcon />
          {t("Back")}</Button>
        <Button onClick={() => window.print()}>
          <PrinterIcon />
          {t("Print")}</Button>
      </div>

      <div className="bg-card space-y-8 rounded-xl border p-6 shadow-sm sm:p-10 print:rounded-none print:border-0 print:p-0 print:text-black print:shadow-none">
        <div className="flex items-start justify-between gap-6 border-b-2 border-current pb-6">
          <div className="flex items-center gap-4">
            {settings?.logo_url && <img src={settings.logo_url} alt="" className="h-16 w-auto" />}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
              {settings?.address && <p className="text-sm">{settings.address}</p>}
              <p className="text-sm">{[settings?.phone, settings?.system_email].filter(Boolean).join(" · ")}</p>
              <p className="mt-3 text-lg font-semibold tracking-wide uppercase">{t("Admission form")}</p>
              <p className="text-muted-foreground text-xs print:text-black">
                {t("Academic year: {year}", { year: a.year })} · {t("Form no.:")} <span className="text-foreground font-mono font-semibold">{a.reference}</span>
              </p>
            </div>
          </div>
          <div className="border-foreground/50 flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-dashed text-center text-xs print:border-solid print:border-black">
            {photo?.url ? <img src={photo.url} alt={t("Student photo")} className="size-full object-cover" /> : <span className="p-2">{t("Affix passport-size photo")}</span>}
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs print:text-black">
          <span>{t("Received")}: <b className="text-foreground">{dayjs(a.created_at).format("DD MMM YYYY HH:mm")}</b> ({SOURCE_LABEL[a.source] ?? a.source})</span>
          <span>{t("Status")}: <b className="text-foreground">{STATUS[a.status]?.[0] ?? a.status}</b></span>
        </div>

        <FormBlock title={t("Student information")}>
          <FormValue label={t("Full name")} value={<span className="uppercase">{a.student_name}</span>} />
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <FormValue label={t("Date of birth")} value={date(a.date_of_birth)} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground font-medium print:text-black">{t("Gender")}:</span>
              {GENDERS.map((g) => <Tick key={g.value} label={g.label} checked={a.gender === g.value} />)}
            </div>
            <FormValue label={t("Class applying for")} value={a.class_name ?? a.class_id} />
            <FormValue label={t("Admission year")} value={a.year} />
          </div>
          <FormValue label={t("Previous school")} value={a.previous_school} />
          <FormValue label={t("Home address")} value={<span className="whitespace-pre-line">{a.address}</span>} />
        </FormBlock>

        <FormBlock title={t("Parent / guardian information")}>
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <FormValue label={t("Guardian")} value={a.guardian_name} />
            <FormValue label={t("Relationship")} value={a.guardian_relation} />
            <FormValue label={t("Mobile")} value={a.guardian_phone} />
            <FormValue label={t("Email")} value={a.guardian_email} />
          </div>
        </FormBlock>

        <FormBlock title={t("Application fee")}>
          {a.payment_reference ? (
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <FormValue label={t("Paid with")} value={paymentMethodLabel(a.payment_method)} />
              <FormValue label={t("Transaction ID")} value={a.payment_reference} mono />
              <FormValue label={t("Amount")} value={a.payment_amount !== null ? money(a.payment_amount) : null} />
              <FormValue
                label={t("Payment")}
                value={a.payment_verified ? `${t("Verified")}${a.payment_verified_by ? ` · ${a.payment_verified_by}` : ""}` : t("Not verified")}
              />
            </div>
          ) : (
            <p className="text-sm">{t("No payment recorded.")}</p>
          )}
        </FormBlock>

        <FormBlock title={t("Documents attached")}>
          {(a.documents ?? []).length ? (
            <div className="grid gap-2 sm:grid-cols-2 print:grid-cols-2">
              {(a.documents ?? []).map((d) => <Tick key={d.document_id} label={d.label} checked />)}
            </div>
          ) : (
            <p className="text-sm">{t("No documents")}</p>
          )}
        </FormBlock>

        {a.notes && (
          <FormBlock title={t("Notes")}>
            <p className="text-sm whitespace-pre-line">{a.notes}</p>
          </FormBlock>
        )}

        <FormBlock title={t("Declaration")}>
          <p className="text-sm leading-relaxed">
            {tn("I declare that the information given above is true and complete. I agree to abide by the rules and regulations of {name}.", { name })}</p>
          <div className="grid gap-8 pt-8 sm:grid-cols-3 print:grid-cols-3">
            {[t("Signature of parent / guardian"), t("Signature of student"), t("Date")].map((s) => (
              <div key={s} className="border-t border-current pt-1 text-center text-xs">
                {s}
              </div>
            ))}
          </div>
        </FormBlock>

        <div className="break-inside-avoid rounded-md border border-dashed p-4 print:border-black">
          <p className="mb-4 text-xs font-bold tracking-wide uppercase">{t("For office use only")}</p>
          <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
            <FormValue label={t("Decision")} value={STATUS[a.status]?.[0]} />
            <FormValue label={t("Reviewed by")} value={a.reviewed_by} />
            <FormValue label={t("Student ID")} value={a.student_id} />
            <FormValue label={t("Received by")} />
            <FormValue label={t("Date")} />
            <FormValue label={t("Principal")} />
          </div>
          {a.status_note && <p className="mt-4 text-sm"><span className="font-medium">{t("Note:")}</span> {a.status_note}</p>}
        </div>
      </div>
    </div>
  );
}
