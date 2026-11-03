import dayjs from "dayjs";
import { ArrowRightLeftIcon, FileTextIcon, GraduationCapIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useClasses, useDebounced, useGet, usePagedList, useSections } from "../api/hooks";
import type { AdmissionApplication, AdmissionStatus, Enquiry } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { Dash, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";

const STATUS: Record<AdmissionStatus, [string, string]> = {
  new: ["New", "bg-primary/10 text-primary"],
  reviewing: ["Reviewing", "bg-warning/20 text-amber-700 dark:text-amber-300"],
  accepted: ["Accepted", "bg-success/15 text-success"],
  rejected: ["Rejected", "bg-destructive/10 text-destructive"],
  enrolled: ["Enrolled", "bg-chart-2/15 text-chart-2"],
  withdrawn: ["Withdrawn", "bg-muted text-muted-foreground"],
};
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, [label]]) => ({ value, label }));
const SOURCE_LABEL: Record<AdmissionApplication["source"], string> = { online: "Online", office: "Office", enquiry: "Enquiry" };
const ENQUIRY_SOURCES = [
  { value: "walk-in", label: "Walk-in" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];
const ENQUIRY_STATUS = [
  { value: "open", label: "Open" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];
const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];
const INVALIDATE = [["/admissions"], ["/admissions/summary"], ["/enquiries"]];

const StatusBadge = ({ status }: { status: AdmissionStatus }) => (
  <Badge className={cn("border-transparent", STATUS[status]?.[1])}>{STATUS[status]?.[0] ?? status}</Badge>
);

// --- settings strip -------------------------------------------------------------------

function AdmissionSettingsBar({ isAdmin }: { isAdmin: boolean }) {
  const settings = useGet<{ open: boolean; year: string }>("/admissions/settings");
  const years = useGet<{ years: string[] }>("/academic-years");
  const summary = useGet<{ year: string; counts: Record<AdmissionStatus, number> }>("/admissions/summary");
  const save = useAction((v: { open: boolean; year: string }) => api.put("/admissions/settings", v), {
    success: "Admission settings saved",
    invalidate: [["/admissions/settings"], ["/admissions/summary"]],
  });
  const s = settings.data;
  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-end justify-between gap-4 px-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 pb-2">
            <Switch id="adm-open" disabled={!isAdmin || !s} checked={!!s?.open} onCheckedChange={(open) => s && save.mutate({ ...s, open })} />
            <Label htmlFor="adm-open">Online applications open</Label>
          </div>
          <Field label="Admission year" className="w-40">
            <Combobox
              disabled={!isAdmin || !s}
              data={[...new Set([...(years.data?.years ?? []), ...(s ? [s.year] : [])])].sort().map((y) => ({ value: y, label: y }))}
              value={s?.year ?? null}
              onChange={(year) => s && year && save.mutate({ ...s, year })}
            />
          </Field>
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
    </Card>
  );
}

// --- application form (office entry / edit) ----------------------------------------------

type ApplicationValues = Record<
  "student_name" | "date_of_birth" | "previous_school" | "guardian_name" | "guardian_relation" | "guardian_phone" | "guardian_email" | "address" | "notes",
  string
> & { class_id: string | null; gender: string | null };

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
    { success: "Saved", invalidate: INVALIDATE, onSuccess: onDone },
  );
  const text = (name: keyof ApplicationValues, label: string, opts: { required?: boolean; className?: string; type?: string } = {}) => (
    <Field label={label} htmlFor={`app-${name}`} required={opts.required} error={errors[name]?.message} className={opts.className}>
      <Input id={`app-${name}`} type={opts.type} aria-invalid={!!errors[name]} {...form.register(name, opts.required ? { required: "Required" } : {})} />
    </Field>
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("student_name", "Student name", { required: true })}
        <Controller control={form.control} name="class_id" rules={{ required: "Required" }} render={({ field }) => (
          <Field label="Class applied for" required error={errors.class_id?.message}>
            <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Controller control={form.control} name="date_of_birth" render={({ field }) => (
          <Field label="Date of birth"><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
        <Controller control={form.control} name="gender" render={({ field }) => (
          <Field label="Gender"><Combobox data={GENDERS} value={field.value} onChange={field.onChange} clearable /></Field>
        )} />
        {text("previous_school", "Previous school", { className: "sm:col-span-2" })}
        {text("guardian_name", "Guardian name", { required: true })}
        {text("guardian_relation", "Relation")}
        {text("guardian_phone", "Guardian phone", { required: true, type: "tel" })}
        {text("guardian_email", "Guardian email", { type: "email" })}
      </div>
      <Field label="Address" htmlFor="app-address"><Textarea id="app-address" rows={2} {...form.register("address")} /></Field>
      <Field label="Notes" htmlFor="app-notes"><Textarea id="app-notes" rows={2} {...form.register("notes")} /></Field>
      <DialogFooter>
        <Button type="submit" loading={save.isPending}>Save</Button>
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
    { success: `${application.student_name} enrolled`, invalidate: [...INVALIDATE, ["/students"]], onSuccess: onDone },
  );
  const password = { minLength: { value: 8, message: "At least 8 characters" } };
  return (
    <form onSubmit={form.handleSubmit((v) => enroll.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="section_id" rules={{ required: "Required" }} render={({ field }) => (
          <Field label={`Section of class ${application.class_name ?? ""}`} required error={errors.section_id?.message}>
            <Combobox data={toOptions(sections.data?.items, "section_id", "name")} value={field.value} onChange={field.onChange} />
          </Field>
        )} />
        <Field label="Roll" htmlFor="enr-roll" description="Empty: next free roll number">
          <Input id="enr-roll" type="number" min={1} {...form.register("roll")} />
        </Field>
        <Field label="Student login email" htmlFor="enr-semail" required error={errors.student_email?.message}>
          <Input id="enr-semail" type="email" aria-invalid={!!errors.student_email} {...form.register("student_email", { required: "Required" })} />
        </Field>
        <Field label="Student password" htmlFor="enr-spass" required error={errors.student_password?.message}>
          <Input id="enr-spass" type="password" autoComplete="new-password" aria-invalid={!!errors.student_password} {...form.register("student_password", { required: "Required", ...password })} />
        </Field>
      </div>
      <Separator />
      <p className="text-muted-foreground text-sm">
        Parent account: an existing parent with this email is linked to the student. Otherwise a new parent account is created with the password below. Leave the email empty for none.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parent email" htmlFor="enr-pemail">
          <Input id="enr-pemail" type="email" {...form.register("parent_email")} />
        </Field>
        <Field label="New parent password" htmlFor="enr-ppass" error={errors.parent_password?.message}>
          <Input id="enr-ppass" type="password" autoComplete="new-password" {...form.register("parent_password", password)} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="submit" loading={enroll.isPending}>
          <GraduationCapIcon />
          Enrol
        </Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

// --- application detail -----------------------------------------------------------------

function ApplicationDetail({ id, isAdmin, onEdit, onEnroll }: { id: number; isAdmin: boolean; onEdit: (a: AdmissionApplication) => void; onEnroll: (a: AdmissionApplication) => void }) {
  const { data: a } = useGet<AdmissionApplication>(`/admissions/${id}`);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [label, setLabel] = useState("");
  const invalidate = [...INVALIDATE, [`/admissions/${id}`]];
  const saveStatus = useAction(
    () => api.post(`/admissions/${id}/status`, { status, note: note.trim() || null, notify }),
    { success: "Status updated", invalidate, onSuccess: () => setStatus(null) },
  );
  const upload = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("label", label.trim() || "Document");
      return api.post(`/admissions/${id}/documents`, body);
    },
    { success: "Document added", invalidate, onSuccess: () => setLabel("") },
  );
  const removeDoc = useAction((docId: number) => api.delete(`/admissions/${id}/documents/${docId}`), { success: "Document removed", invalidate });

  if (!a) return null;
  const enrolled = a.status === "enrolled";
  const rows: [string, React.ReactNode][] = [
    ["Class", `${a.class_name ?? a.class_id} · ${a.year}`],
    ["Date of birth", a.date_of_birth ? dayjs(a.date_of_birth).format("DD MMM YYYY") : null],
    ["Gender", a.gender],
    ["Previous school", a.previous_school],
    ["Guardian", [a.guardian_name, a.guardian_relation && `(${a.guardian_relation})`].filter(Boolean).join(" ")],
    ["Phone", a.guardian_phone],
    ["Email", a.guardian_email],
    ["Address", a.address],
    ["Notes", a.notes],
    ["Received", `${dayjs(a.created_at).format("DD MMM YYYY HH:mm")} · ${SOURCE_LABEL[a.source] ?? a.source}`],
  ];

  return (
    <div className="space-y-6 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{a.reference}</span>
        <StatusBadge status={a.status} />
        {isAdmin && !enrolled && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => onEdit(a)}>
            <PencilIcon />
            Edit
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="whitespace-pre-line">{v || <Dash />}</dd>
          </div>
        ))}
      </dl>
      {a.status_note && (
        <p className="bg-muted rounded-md p-3 text-sm">
          <span className="font-medium">Note: </span>
          {a.status_note}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Documents</h3>
        {(a.documents ?? []).length === 0 && <p className="text-muted-foreground text-sm">No documents</p>}
        {(a.documents ?? []).map((d) => (
          <div key={d.document_id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <FileTextIcon className="text-muted-foreground size-4" />
            <a href={d.url ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">{d.label}</a>
            <span className="text-muted-foreground truncate text-xs">{d.file_name.replace(/^[0-9a-f]{12}_/, "")}</span>
            {isAdmin && !enrolled && (
              <IconAction label="Remove document" destructive onClick={() => confirmAction({ title: `Remove "${d.label}"?`, onConfirm: () => removeDoc.mutate(d.document_id) })}>
                <Trash2Icon />
              </IconAction>
            )}
          </div>
        ))}
        {isAdmin && !enrolled && (
          <div className="flex flex-wrap gap-2">
            <Input className="w-56" placeholder="Label, e.g. Birth certificate" value={label} onChange={(e) => setLabel(e.target.value)} />
            <FileButton accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(f) => f && upload.mutate(f)}>
              {(props) => (
                <Button {...props} variant="outline" loading={upload.isPending}>
                  <UploadIcon />
                  Upload
                </Button>
              )}
            </FileButton>
          </div>
        )}
      </div>

      {isAdmin && !enrolled && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Decision</h3>
          <Combobox data={STATUS_OPTIONS.filter((o) => o.value !== "enrolled")} value={status ?? a.status} onChange={setStatus} />
          <Textarea rows={2} placeholder="Note (sent to the guardian with an acceptance or rejection)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id="adm-notify" checked={notify} onCheckedChange={setNotify} />
              <Label htmlFor="adm-notify">Email the guardian</Label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!status || status === a.status} loading={saveStatus.isPending} onClick={() => saveStatus.mutate(undefined)}>
                Save status
              </Button>
              {a.status === "accepted" && (
                <Button onClick={() => onEnroll(a)}>
                  <GraduationCapIcon />
                  Enrol student
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {enrolled && <p className="text-muted-foreground text-sm">Enrolled as student #{a.student_id}{a.parent_id ? `, parent #${a.parent_id}` : ""}.</p>}
    </div>
  );
}

// --- applications tab -------------------------------------------------------------------

function Applications({ isAdmin }: { isAdmin: boolean }) {
  const classes = useClasses();
  const [status, setStatus] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, isLoading, page, setPage, pageSize } = usePagedList<AdmissionApplication>("/admissions", {
    status: status ?? undefined, class_id: classId ?? undefined, q: q || undefined,
  });  // prettier-ignore
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdmissionApplication | "new" | null>(null);
  const [enrolling, setEnrolling] = useState<AdmissionApplication | null>(null);
  const rows = data?.items ?? [];

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <Combobox data={STATUS_OPTIONS} value={status} onChange={setStatus} clearable placeholder="All statuses" />
          <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} clearable placeholder="All classes" />
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder="Reference, student, guardian or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              New application
            </Button>
          )}
        </div>
        <Table className="min-w-[800px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Guardian</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={6} emptyText="No applications" />
            {rows.map((a) => (
              <TableRow key={a.application_id} className="cursor-pointer" onClick={() => setViewing(a.application_id)}>
                <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                <TableCell className="font-medium">
                  {a.student_name}
                  {a.document_count > 0 && <span className="text-muted-foreground ml-2 text-xs">{a.document_count} doc{a.document_count > 1 ? "s" : ""}</span>}
                </TableCell>
                <TableCell>{a.class_name ?? <Dash />}</TableCell>
                <TableCell>
                  <div>{a.guardian_name}</div>
                  <div className="text-muted-foreground text-xs">{a.guardian_phone}</div>
                </TableCell>
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
            <SheetTitle>Application</SheetTitle>
            <SheetDescription>Details, documents and decision.</SheetDescription>
          </SheetHeader>
          {viewing !== null && <ApplicationDetail id={viewing} isAdmin={isAdmin} onEdit={setEditing} onEnroll={setEnrolling} />}
        </SheetContent>
      </Sheet>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New application" : "Edit application"}</DialogTitle>
            {editing === "new" && <DialogDescription>For paper forms and walk-in applicants.</DialogDescription>}
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
            <DialogTitle>Enrol {enrolling?.student_name}</DialogTitle>
            <DialogDescription>Creates the student account and enrols the student for {enrolling?.year}.</DialogDescription>
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
    { success: "Saved", invalidate: [["/enquiries"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="enq-name" required error={errors.name?.message}>
          <Input id="enq-name" aria-invalid={!!errors.name} {...form.register("name", { required: "Required" })} />
        </Field>
        <Field label="Phone" htmlFor="enq-phone"><Input id="enq-phone" type="tel" {...form.register("phone")} /></Field>
        <Field label="Email" htmlFor="enq-email"><Input id="enq-email" type="email" {...form.register("email")} /></Field>
        <Controller control={form.control} name="class_id" render={({ field }) => (
          <Field label="Class of interest"><Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} clearable /></Field>
        )} />
        <Controller control={form.control} name="source" render={({ field }) => (
          <Field label="Source"><Combobox data={ENQUIRY_SOURCES} value={field.value} onChange={(v) => field.onChange(v ?? "walk-in")} /></Field>
        )} />
        <Controller control={form.control} name="follow_up_on" render={({ field }) => (
          <Field label="Follow up on"><DatePicker value={field.value} onChange={field.onChange} /></Field>
        )} />
        {enquiry && (
          <Controller control={form.control} name="status" render={({ field }) => (
            <Field label="Status"><Combobox data={ENQUIRY_STATUS} value={field.value} onChange={(v) => field.onChange(v ?? "open")} /></Field>
          )} />
        )}
      </div>
      <Field label="Notes" htmlFor="enq-notes"><Textarea id="enq-notes" rows={3} {...form.register("notes")} /></Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save</Button>
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
    { success: "Application created", invalidate: INVALIDATE, onSuccess: onDone },
  );
  return (
    <div className="grid gap-4">
      <Field label="Student name" htmlFor="conv-name" required>
        <Input id="conv-name" value={studentName} onChange={(e) => setStudentName(e.target.value)} />
      </Field>
      <Field label="Class applied for" required>
        <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} />
      </Field>
      <DialogFooter>
        <Button disabled={!studentName.trim() || !classId} loading={convert.isPending} onClick={() => convert.mutate(undefined)}>
          <ArrowRightLeftIcon />
          Create application
        </Button>
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
  });  // prettier-ignore
  const [editing, setEditing] = useState<Enquiry | "new" | null>(null);
  const [converting, setConverting] = useState<Enquiry | null>(null);
  const remove = useAction((id: number) => api.delete(`/enquiries/${id}`), { success: "Deleted", invalidate: [["/enquiries"]] });
  const today = dayjs().format("YYYY-MM-DD");
  const rows = data?.items ?? [];

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="flex items-center gap-2">
            <Switch id="enq-due" checked={due} onCheckedChange={setDue} />
            <Label htmlFor="enq-due">Follow-ups due</Label>
          </div>
          <Combobox className="w-40" disabled={due} data={ENQUIRY_STATUS} value={status} onChange={setStatus} clearable placeholder="All" />
          <div className="relative min-w-56 flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder="Name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              New enquiry
            </Button>
          )}
        </div>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Follow up</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={isAdmin ? 7 : 6} emptyText={due ? "No follow-ups due" : "No enquiries"} />
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
                        <IconAction label="Convert to application" onClick={() => setConverting(e)}><ArrowRightLeftIcon /></IconAction>
                      )}
                      <IconAction label="Edit" onClick={() => setEditing(e)}><PencilIcon /></IconAction>
                      <IconAction label="Delete" destructive onClick={() => confirmAction({ title: `Delete enquiry from ${e.name}?`, onConfirm: () => remove.mutate(e.enquiry_id) })}>
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
            <DialogTitle>{editing === "new" ? "New enquiry" : "Edit enquiry"}</DialogTitle>
          </DialogHeader>
          {editing !== null && <EnquiryForm key={editing === "new" ? "new" : editing.enquiry_id} enquiry={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={converting !== null} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start an application</DialogTitle>
            <DialogDescription>{converting?.name} becomes the guardian on the application.</DialogDescription>
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
      <PageHeader title="Admissions" subtitle="Online and office applications, decisions and enrolment, and enquiries to follow up." />
      <AdmissionSettingsBar isAdmin={isAdmin} />
      <Tabs defaultValue="applications" className="gap-6">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="enquiries">Enquiries</TabsTrigger>
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
