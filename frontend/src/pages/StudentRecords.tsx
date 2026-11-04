import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  ArrowLeftIcon,
  AwardIcon,
  BanIcon,
  FilePlusIcon,
  HeartPulseIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useAction, useDebounced, useGet, useList, usePagedList, usePublicSettings } from "../api/hooks";
import type {
  Certificate,
  CertificateKind,
  CertificateTemplate,
  RecordKind,
  Student,
  StudentHealth,
  StudentProfile,
  StudentRecordEntry,
} from "../api/types";
import { useUser } from "../auth/AuthContext";
import { AiProgressSummary } from "../components/Ai";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { initials, toOptions } from "../utils";
import { useChildSelect } from "./Academic";
import { t as tr, tn } from "../i18n";

const RECORD_KINDS: Record<RecordKind, [string, string]> = {
  health: [tr("Health"), "bg-chart-2/15 text-chart-2"],
  discipline: [tr("Discipline"), "bg-destructive/10 text-destructive"],
  counselling: [tr("Counselling"), "bg-chart-5/15 text-chart-5"],
  achievement: [tr("Achievement"), "bg-success/15 text-success"],
  other: [tr("Other"), "bg-muted text-foreground"],
};

const CERT_KINDS: Record<CertificateKind, string> = {
  transfer: tr("Transfer certificate"),
  bonafide: tr("Bonafide certificate"),
  character: tr("Character certificate"),
  custom: tr("Certificate"),
};

const fmtDate = (d: string | null | undefined) => (d ? dayjs(d).format("DD MMM YYYY") : "");

// --- health -------------------------------------------------------------------------

const HEALTH_FIELDS: { name: keyof StudentHealth; label: string; long?: boolean }[] = [
  { name: "blood_group", label: tr("Blood group") },
  { name: "height_cm", label: tr("Height (cm)") },
  { name: "weight_kg", label: tr("Weight (kg)") },
  { name: "doctor", label: tr("Doctor") },
  { name: "emergency_contact_name", label: tr("Emergency contact") },
  { name: "emergency_contact_phone", label: tr("Emergency phone") },
  { name: "allergies", label: tr("Allergies"), long: true },
  { name: "conditions", label: tr("Medical conditions"), long: true },
  { name: "medications", label: tr("Medications"), long: true },
  { name: "notes", label: tr("Notes"), long: true },
];

type HealthValues = Record<string, string>;

function HealthForm({ studentId, health, onDone }: { studentId: number; health: StudentHealth; onDone: () => void }) {
  const form = useForm<HealthValues>({
    defaultValues: Object.fromEntries(HEALTH_FIELDS.map((f) => [f.name, health[f.name] == null ? "" : String(health[f.name])])),
  });
  const save = useAction(
    (v: HealthValues) => {
      const num = (x: string) => (x.trim() ? Number(x) : null);
      const text = (x: string) => x.trim() || null;
      const body = Object.fromEntries(HEALTH_FIELDS.map((f) => [f.name, f.name === "height_cm" || f.name === "weight_kg" ? num(v[f.name]) : text(v[f.name])]));
      return api.put(`/student-profile/${studentId}/health`, body);
    },
    { success: tr("Health profile saved"), invalidate: [[`/student-profile/${studentId}`]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {HEALTH_FIELDS.filter((f) => !f.long).map((f) => (
          <Field key={f.name} label={f.label} htmlFor={`h-${f.name}`}>
            <Input id={`h-${f.name}`} type={f.name.endsWith("_cm") || f.name.endsWith("_kg") ? "number" : "text"} step="0.1" {...form.register(f.name)} />
          </Field>
        ))}
      </div>
      {HEALTH_FIELDS.filter((f) => f.long).map((f) => (
        <Field key={f.name} label={f.label} htmlFor={`h-${f.name}`}>
          <Textarea id={`h-${f.name}`} rows={2} {...form.register(f.name)} />
        </Field>
      ))}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function HealthCard({ profile }: { profile: StudentProfile }) {
  const [editing, setEditing] = useState(false);
  const h = profile.health;
  const filled = HEALTH_FIELDS.filter((f) => h[f.name] != null && h[f.name] !== "");
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulseIcon className="text-destructive size-4" />
          {tr("Health profile")}</CardTitle>
        {profile.can_edit_health && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon />
            {tr("Edit")}</Button>
        )}
      </CardHeader>
      <CardContent>
        {filled.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tr("Nothing recorded yet.")}</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {filled.map((f) => (
              <div key={f.name} className={cn(f.long && "sm:col-span-2")}>
                <dt className="text-muted-foreground text-xs">{f.label}</dt>
                <dd className="whitespace-pre-wrap">{String(h[f.name])}</dd>
              </div>
            ))}
          </dl>
        )}
        {h.updated_at && <p className="text-muted-foreground mt-4 text-xs">{tn("Updated {dayjs}", { dayjs: dayjs(h.updated_at + "Z").format("DD MMM YYYY HH:mm") })}</p>}
      </CardContent>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("Health profile")}</DialogTitle>
          </DialogHeader>
          {editing && <HealthForm studentId={profile.student.student_id} health={h} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- records ------------------------------------------------------------------------

interface RecordValues {
  kind: RecordKind;
  date: string;
  title: string;
  details: string;
  action_taken: string;
  confidential: boolean;
}

function RecordForm({ studentId, record, onDone }: { studentId: number; record: StudentRecordEntry | null; onDone: () => void }) {
  const form = useForm<RecordValues>({
    defaultValues: record
      ? { ...record, details: record.details ?? "", action_taken: record.action_taken ?? "" }
      : { kind: "discipline", date: dayjs().format("YYYY-MM-DD"), title: "", details: "", action_taken: "", confidential: false },
  });
  const { errors } = form.formState;
  const kind = form.watch("kind");
  const save = useAction(
    (v: RecordValues) => {
      const body = { ...v, details: v.details || null, action_taken: v.action_taken || null };
      return record ? api.put(`/student-records/${record.record_id}`, body) : api.post(`/student-profile/${studentId}/records`, body);
    },
    { success: tr("Saved"), invalidate: [[`/student-profile/${studentId}`]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="kind" render={({ field }) => (
          <Field label={tr("Type")}>
            <Combobox data={Object.entries(RECORD_KINDS).map(([value, [label]]) => ({ value, label }))} value={field.value} onChange={(v) => field.onChange(v ?? "other")} />
          </Field>
        )} />
        <Controller control={form.control} name="date" rules={{ required: tr("Required") }} render={({ field }) => (
          <Field label={tr("Date")} required error={errors.date?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
      </div>
      <Field label={tr("Title")} htmlFor="rec-title" required error={errors.title?.message}>
        <Input id="rec-title" aria-invalid={!!errors.title} {...form.register("title", { required: tr("Required") })} />
      </Field>
      <Field label={tr("Details")} htmlFor="rec-details">
        <Textarea id="rec-details" rows={4} {...form.register("details")} />
      </Field>
      <Field label={tr("Action taken")} htmlFor="rec-action">
        <Textarea id="rec-action" rows={2} {...form.register("action_taken")} />
      </Field>
      <Controller control={form.control} name="confidential" render={({ field }) => (
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={kind === "counselling" || field.value} disabled={kind === "counselling"} onCheckedChange={field.onChange} />
          <span>
            {tr("Confidential")}<span className="text-muted-foreground block text-xs">
              {kind === "counselling" ? tr("Counselling notes are always confidential.") : tr("Only admins and the author can see it. Never shown to the student or parents.")}
            </span>
          </span>
        </label>
      )} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function RecordsCard({ profile }: { profile: StudentProfile }) {
  const studentId = profile.student.student_id;
  const [editing, setEditing] = useState<StudentRecordEntry | "new" | null>(null);
  const remove = useAction((id: number) => api.delete(`/student-records/${id}`), { success: tr("Deleted"), invalidate: [[`/student-profile/${studentId}`]] });
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{tr("Records")}</CardTitle>
        {profile.can_add_records && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon />
            {tr("Add record")}</Button>
        )}
      </CardHeader>
      <CardContent>
        {profile.records.length === 0 ? (
          <p className="text-muted-foreground text-sm">{tr("No records.")}</p>
        ) : (
          <ol className="border-muted relative space-y-5 border-l pl-5">
            {profile.records.map((r) => {
              const [label, style] = RECORD_KINDS[r.kind] ?? [r.kind, ""];
              return (
                <li key={r.record_id} className="relative">
                  <span className="bg-primary absolute top-1.5 -left-[25px] size-2.5 rounded-full" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">{fmtDate(r.date)}</span>
                    <Badge className={cn("border-transparent", style)}>{label}</Badge>
                    {r.confidential && (
                      <Badge variant="outline" className="gap-1">
                        <LockIcon className="size-3" />
                        {tr("Confidential")}</Badge>
                    )}
                    {r.can_edit && (
                      <span className="ml-auto flex gap-1">
                        <IconAction label={tr("Edit")} onClick={() => setEditing(r)}><PencilIcon /></IconAction>
                        <IconAction label={tr("Delete")} destructive onClick={() => confirmAction({ title: tr("Delete \"{title}\"?", { title: r.title }), onConfirm: () => remove.mutate(r.record_id) })}>
                          <Trash2Icon />
                        </IconAction>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-medium">{r.title}</div>
                  {r.details && <p className="text-sm whitespace-pre-wrap">{r.details}</p>}
                  {r.action_taken && <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{tn("Action: {action_taken}", { action_taken: r.action_taken })}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? tr("Add record") : tr("Edit record")}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <RecordForm key={editing === "new" ? "new" : editing.record_id} studentId={studentId} record={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- certificates (shared) ------------------------------------------------------------

function CertificateList({ items, printBase, empty, actions }: {
  items: Certificate[]; printBase: string; empty: string; actions?: (c: Certificate) => ReactNode;
}) {  // prettier-ignore
  const navigate = useNavigate();
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead className="w-36">{tr("Serial")}</TableHead>
          <TableHead>{tr("Certificate")}</TableHead>
          <TableHead>{tr("Student")}</TableHead>
          <TableHead className="w-32">{tr("Issued")}</TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableState empty={items.length === 0} colSpan={5} emptyText={empty} />
        {items.map((c) => (
          <TableRow key={c.certificate_id} className={cn(c.cancelled && "opacity-60")}>
            <TableCell className="font-mono text-xs">{c.serial_no}</TableCell>
            <TableCell>
              {CERT_KINDS[c.kind] ?? c.kind}
              {c.cancelled && <Badge className="bg-destructive/10 text-destructive ml-2 border-transparent">{tr("Cancelled")}</Badge>}
            </TableCell>
            <TableCell>{c.student_name ?? <Dash />}</TableCell>
            <TableCell className="tabular-nums">{fmtDate(c.issued_on)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <IconAction label={tr("Open / print")} onClick={() => navigate(`${printBase}/${c.certificate_id}`)}><PrinterIcon /></IconAction>
                {actions?.(c)}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- profile ----------------------------------------------------------------------------

function ProfileView({ studentId, printBase, extra }: { studentId: number; printBase: string; extra?: (p: StudentProfile) => ReactNode }) {
  const { data, isLoading, isError } = useGet<StudentProfile>(`/student-profile/${studentId}`);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <EmptyState title={tr("This student's records are not available to you")} />;
  const s = data.student;
  return (
    <div className="space-y-6">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-4 px-4">
          <Avatar className="size-14">
            {s.image_url && <AvatarImage src={s.image_url} alt="" />}
            <AvatarFallback>{initials(s.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-lg font-semibold">{s.name}</div>
            <div className="text-muted-foreground text-sm">
              {s.class_name ? tr("Class {class_name}{value}{value2}", { class_name: s.class_name, value: s.section_name ? ` · Section ${s.section_name}` : "", value2: s.roll != null ? " " + tr("· Roll {roll}", { roll: s.roll }) : "" }) : tr("Not enrolled this year")}
              {s.parent_name && " " + tr("· Parent: {parent_name}", { parent_name: s.parent_name })}
            </div>
          </div>
          {extra && <div className="ml-auto">{extra(data)}</div>}
        </CardContent>
      </Card>
      <AiProgressSummary studentId={studentId} />
      <Tabs defaultValue="health" className="gap-4">
        <TabsList>
          <TabsTrigger value="health">{tr("Health")}</TabsTrigger>
          <TabsTrigger value="records">{tn("Records ({length})", { length: data.records.length })}</TabsTrigger>
          <TabsTrigger value="certificates">{tn("Certificates ({length})", { length: data.certificates.length })}</TabsTrigger>
        </TabsList>
        <TabsContent value="health"><HealthCard profile={data} /></TabsContent>
        <TabsContent value="records"><RecordsCard profile={data} /></TabsContent>
        <TabsContent value="certificates">
          <Card className="gap-0 overflow-hidden py-0">
            <CertificateList items={data.certificates} printBase={printBase} empty={tr("No certificates issued")} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Staff view of one student, opened from the Students list. */
export function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const [issuing, setIssuing] = useState(false);
  const studentId = Number(id);
  return (
    <>
      <PageHeader
        title={tr("Student profile")}
        subtitle={tr("Health, records and certificates")}
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeftIcon />
            {tr("Back")}</Button>
        }
      />
      <ProfileView
        studentId={studentId}
        printBase="/app/certificates"
        extra={() =>
          user.role === "admin" && (
            <Button size="sm" variant="outline" onClick={() => setIssuing(true)}>
              <FilePlusIcon />
              {tr("Issue certificate")}</Button>
          )
        }
      />
      <IssueDialog open={issuing} studentId={studentId} onClose={() => setIssuing(false)} />
    </>
  );
}

/** Student / parent view of their own (or their child's) records and certificates. */
export function MyRecordsPage() {
  const user = useUser();
  const { childId, select } = useChildSelect();
  const studentId = user.role === "student" ? user.id : childId ? Number(childId) : null;
  return (
    <>
      <PageHeader title={tr("Health & certificates")} subtitle={tr("Health profile, school records and certificates")} actions={select} />
      {studentId ? <ProfileView key={studentId} studentId={studentId} printBase="/app/my-records/certificates" /> : <EmptyState icon={ScrollTextIcon} title={tr("Choose a child")} />}
    </>
  );
}

// --- issuing ------------------------------------------------------------------------------

interface IssueValues {
  template_id: string | null;
  issued_on: string;
  reason: string;
  conduct: string;
}

function IssueDialog({ open, studentId, onClose }: { open: boolean; studentId?: number; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr("Issue certificate")}</DialogTitle>
          <DialogDescription>{tr("The text is saved as shown in the preview; later template changes don't alter issued certificates.")}</DialogDescription>
        </DialogHeader>
        {open && <IssueForm presetStudent={studentId} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function IssueForm({ presetStudent, onDone }: { presetStudent?: number; onDone: () => void }) {
  const navigate = useNavigate();
  const templates = useGet<CertificateTemplate[]>("/certificate-templates");
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [studentId, setStudentId] = useState<string | null>(presetStudent ? String(presetStudent) : null);
  const students = useList<Student>(!presetStudent && sel.classId ? "/students" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000 });
  const form = useForm<IssueValues>({ defaultValues: { template_id: null, issued_on: dayjs().format("YYYY-MM-DD"), reason: "", conduct: "Good" } });
  // watch() returns a new object every render; debounce its JSON so equal values don't re-render
  const values = JSON.parse(useDebounced(JSON.stringify(form.watch()), 400)) as IssueValues;
  const body = { template_id: Number(values.template_id), student_id: Number(studentId), issued_on: values.issued_on || null, reason: values.reason || null, conduct: values.conduct || null };
  const ready = !!values.template_id && !!studentId;
  const preview = useQuery({
    queryKey: ["/certificates/preview", body],
    queryFn: async () => (await api.post<{ rendered_body: string; unknown_placeholders: string[] }>("/certificates/preview", body)).data,
    enabled: ready,
  });
  const issue = useAction(
    async (v: IssueValues) =>
      (await api.post<Certificate>("/certificates", { ...body, template_id: Number(v.template_id), issued_on: v.issued_on || null, reason: v.reason || null, conduct: v.conduct || null })).data,
    { success: tr("Certificate issued"), invalidate: [["/certificates"], ["/student-profile"]], onSuccess: (c) => navigate(`/app/certificates/${c.certificate_id}`) },
  );
  const active = (templates.data ?? []).filter((t) => t.active);
  return (
    <form onSubmit={form.handleSubmit((v) => issue.mutate(v))} className="grid gap-4">
      {!presetStudent && (
        <div className="flex flex-wrap items-end gap-3">
          <ClassPicker value={sel} onChange={(v) => { setSel(v); setStudentId(null); }} />
          <Field label={tr("Student")} className="w-60">
            <Combobox disabled={!sel.classId} data={toOptions(students.data?.items, "student_id", "name")} value={studentId} onChange={setStudentId} placeholder={tr("Choose student")} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="template_id" rules={{ required: true }} render={({ field }) => (
          <Field label={tr("Template")} required>
            <Combobox data={active.map((t) => ({ value: String(t.template_id), label: `${t.name} (${CERT_KINDS[t.kind]})` }))} value={field.value} onChange={field.onChange} placeholder={active.length ? tr("Choose template") : tr("No active templates")} />
          </Field>
        )} />
        <Controller control={form.control} name="issued_on" render={({ field }) => (
          <Field label={tr("Issue date")}><DatePicker value={field.value} onChange={field.onChange} clearable={false} /></Field>
        )} />
        <Field label={tr("Reason / purpose")} htmlFor="iss-reason"><Input id="iss-reason" {...form.register("reason")} /></Field>
        <Field label={tr("Conduct")} htmlFor="iss-conduct"><Input id="iss-conduct" {...form.register("conduct")} /></Field>
      </div>
      <div className="bg-muted/40 min-h-32 rounded-md border p-4 text-sm whitespace-pre-wrap">
        {!ready ? <span className="text-muted-foreground">{tr("Choose a student and a template to see the preview.")}</span> : preview.data?.rendered_body ?? <Skeleton className="h-20 w-full" />}
      </div>
      {preview.data && preview.data.unknown_placeholders.length > 0 && (
        <p className="text-destructive text-xs">{tr("Unknown placeholders stay as typed:")}{" "}{preview.data.unknown_placeholders.map((p) => `{${p}}`).join(", ")}</p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={issue.isPending} disabled={!ready}>{tr("Issue")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

// --- admin: certificates and templates ------------------------------------------------------

interface TemplateValues {
  kind: CertificateKind;
  name: string;
  body: string;
  active: boolean;
}

function TemplateForm({ template, onDone }: { template: CertificateTemplate | null; onDone: () => void }) {
  const placeholders = useGet<Record<string, string>>("/certificate-templates/placeholders");
  const form = useForm<TemplateValues>({ defaultValues: template ?? { kind: "custom", name: "", body: "", active: true } });
  const { errors } = form.formState;
  const save = useAction(
    (v: TemplateValues) => (template ? api.put(`/certificate-templates/${template.template_id}`, v) : api.post("/certificate-templates", v)),
    { success: tr("Template saved"), invalidate: [["/certificate-templates"]], onSuccess: onDone },
  );
  const insert = (name: string) => form.setValue("body", `${form.getValues("body")}{${name}}`, { shouldDirty: true });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Name")} htmlFor="tpl-name" required error={errors.name?.message}>
          <Input id="tpl-name" aria-invalid={!!errors.name} {...form.register("name", { required: tr("Required") })} />
        </Field>
        <Controller control={form.control} name="kind" render={({ field }) => (
          <Field label={tr("Kind")} description={tr("Sets the serial prefix (TC, BC, CC, CERT)")}>
            <Combobox data={Object.entries(CERT_KINDS).map(([value, label]) => ({ value, label }))} value={field.value} onChange={(v) => field.onChange(v ?? "custom")} />
          </Field>
        )} />
      </div>
      <Field label={tr("Text")} htmlFor="tpl-body" required error={errors.body?.message}>
        <Textarea id="tpl-body" rows={10} className="font-mono text-xs" {...form.register("body", { required: tr("Required") })} />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(placeholders.data ?? {}).map(([name, help]) => (
          <button key={name} type="button" title={help} onClick={() => insert(name)} className="bg-muted hover:bg-muted/70 rounded px-1.5 py-0.5 font-mono text-xs">
            {`{${name}}`}
          </button>
        ))}
      </div>
      <Controller control={form.control} name="active" render={({ field }) => (
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={field.value} onCheckedChange={field.onChange} />
          {tr("Available when issuing")}</label>
      )} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function TemplatesTab() {
  const { data, isLoading } = useGet<CertificateTemplate[]>("/certificate-templates");
  const [editing, setEditing] = useState<CertificateTemplate | "new" | null>(null);
  const defaults = useAction(() => api.post("/certificate-templates/defaults"), { success: tr("Default templates added"), invalidate: [["/certificate-templates"]] });
  const remove = useAction((id: number) => api.delete(`/certificate-templates/${id}`), { success: tr("Deleted"), invalidate: [["/certificate-templates"]] });
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap justify-end gap-2 border-b p-3">
        {!isLoading && (data ?? []).length === 0 && (
          <Button size="sm" variant="outline" loading={defaults.isPending} onClick={() => defaults.mutate(undefined)}>{tr("Add default templates")}</Button>
        )}
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon />
          {tr("New template")}</Button>
      </div>
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{tr("Name")}</TableHead>
            <TableHead className="w-48">{tr("Kind")}</TableHead>
            <TableHead className="w-28">{tr("Status")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={isLoading} empty={!isLoading && (data ?? []).length === 0} colSpan={4} emptyText={tr("No templates")} />
          {(data ?? []).map((t) => (
            <TableRow key={t.template_id}>
              <TableCell className="font-medium">
                {t.name}
                {t.unknown_placeholders.length > 0 && <span className="text-destructive ml-2 text-xs">{tn("unknown: {unknown_placeholders}", { unknown_placeholders: t.unknown_placeholders.join(", ") })}</span>}
              </TableCell>
              <TableCell>{CERT_KINDS[t.kind]}</TableCell>
              <TableCell>{t.active ? <Badge className="bg-success/15 text-success border-transparent">{tr("Active")}</Badge> : <Badge variant="secondary">{tr("Off")}</Badge>}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <IconAction label={tr("Edit")} onClick={() => setEditing(t)}><PencilIcon /></IconAction>
                  <IconAction label={tr("Delete")} destructive onClick={() => confirmAction({ title: tr("Delete \"{name}\"?", { name: t.name }), onConfirm: () => remove.mutate(t.template_id) })}>
                    <Trash2Icon />
                  </IconAction>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? tr("New template") : tr("Edit template")}</DialogTitle>
            <DialogDescription>{tr("Click a placeholder to add it; it is replaced with the student's details when issuing.")}</DialogDescription>
          </DialogHeader>
          {editing !== null && <TemplateForm key={editing === "new" ? "new" : editing.template_id} template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CancelForm({ certificate, onDone }: { certificate: Certificate; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const cancel = useAction(() => api.post(`/certificates/${certificate.certificate_id}/cancel`, { reason }), {
    success: tr("Certificate cancelled"),
    invalidate: [["/certificates"], ["/student-profile"]],
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4">
      <Field label={tr("Reason")} htmlFor="cancel-reason" required>
        <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{tr("Keep")}</Button>
        <Button variant="destructive" disabled={!reason.trim()} loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>{tr("Cancel certificate")}</Button>
      </DialogFooter>
    </div>
  );
}

export function CertificatesPage() {
  const [kind, setKind] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [cancelling, setCancelling] = useState<Certificate | null>(null);
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Certificate>("/certificates", { kind: kind ?? undefined });
  return (
    <>
      <PageHeader
        title={tr("Certificates")}
        subtitle={tr("Transfer, bonafide and character certificates. Anyone can check a serial number at /api/public/certificates/verify.")}
        actions={
          <Button onClick={() => setIssuing(true)}>
            <FilePlusIcon />
            {tr("Issue certificate")}</Button>
        }
      />
      <Tabs defaultValue="issued" className="gap-4">
        <TabsList>
          <TabsTrigger value="issued">{tr("Issued")}</TabsTrigger>
          <TabsTrigger value="templates">{tr("Templates")}</TabsTrigger>
        </TabsList>
        <TabsContent value="issued">
          <Card className="gap-0 overflow-hidden py-0">
            <div className="border-b p-3">
              <Combobox className="w-60" data={Object.entries(CERT_KINDS).map(([value, label]) => ({ value, label }))} value={kind} onChange={setKind} clearable placeholder={tr("All kinds")} />
            </div>
            {isLoading ? (
              <Skeleton className="m-4 h-20" />
            ) : (
              <CertificateList
                items={data?.items ?? []}
                printBase="/app/certificates"
                empty={tr("No certificates issued")}
                actions={(c) =>
                  !c.cancelled && (
                    <IconAction label={tr("Cancel")} destructive onClick={() => setCancelling(c)}>
                      <BanIcon />
                    </IconAction>
                  )
                }
              />
            )}
            <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
          </Card>
        </TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
      </Tabs>
      <IssueDialog open={issuing} onClose={() => setIssuing(false)} />
      <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tn("Cancel {serial_no}?", { serial_no: cancelling?.serial_no })}</DialogTitle>
            <DialogDescription>{tr("A cancelled certificate can't be printed by the student or parent and no longer verifies.")}</DialogDescription>
          </DialogHeader>
          {cancelling && <CancelForm certificate={cancelling} onDone={() => setCancelling(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- printable certificate ------------------------------------------------------------------

export function CertificatePrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const { data: c, isLoading, isError } = useGet<Certificate>(`/certificates/${id}`);
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !c) return <EmptyState icon={AwardIcon} title={tr("This certificate is not available")} />;
  const s = settings.data;
  return (
    <div className="space-y-4">
      <style>{"@media print { @page { size: A4; margin: 16mm; } }"}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeftIcon />
          {tr("Back")}</Button>
        <Button onClick={() => window.print()} disabled={c.cancelled}>
          <PrinterIcon />
          {tr("Print / save as PDF")}</Button>
      </div>
      {c.cancelled && (
        <p className="no-print text-destructive text-sm">{tn("Cancelled{value}. Shown for the record only.", { value: c.cancel_reason ? tr(": {cancel_reason}", { cancel_reason: c.cancel_reason }) : "" })}</p>
      )}
      <div className="bg-card relative mx-auto flex min-h-[260mm] max-w-[210mm] flex-col border-4 border-double p-10 shadow-sm print:min-h-[262mm] print:max-w-none print:border-4 print:shadow-none">
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>{tr("Serial:")}{" "}<span className="text-foreground font-mono">{c.serial_no}</span></span>
          <span>{tn("Date: {fmtDate}", { fmtDate: fmtDate(c.issued_on) })}</span>
        </div>
        <div className="mt-6 text-center">
          {s?.logo_url && <img src={s.logo_url} alt="" className="mx-auto mb-3 max-h-20" />}
          <div className="text-2xl font-bold tracking-wide uppercase">{s?.system_name}</div>
          {s?.address && <div className="text-sm">{s.address}</div>}
          {s?.phone && <div className="text-muted-foreground text-xs">{s.phone}</div>}
          <div className="mx-auto mt-8 inline-block border-b-2 pb-1 text-xl font-semibold tracking-wider uppercase">{CERT_KINDS[c.kind]}</div>
        </div>
        <div className="mt-10 flex-1 text-justify text-[15px] leading-8 whitespace-pre-wrap">{c.rendered_body}</div>
        <div className="mt-16 grid grid-cols-2 gap-16 text-center text-sm">
          <div className="border-t pt-2">{tr("Class teacher")}</div>
          <div className="border-t pt-2">{tr("Head of institution")}</div>
        </div>
        {c.cancelled && (
          <div className="text-destructive/30 pointer-events-none absolute inset-0 flex -rotate-30 items-center justify-center text-7xl font-black uppercase">{tr("Cancelled")}</div>
        )}
      </div>
    </div>
  );
}
