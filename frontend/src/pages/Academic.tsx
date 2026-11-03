import dayjs from "dayjs";
import { CalendarDaysIcon, ClockIcon, DownloadIcon, PencilIcon, PlusIcon, PrinterIcon, Trash2Icon, UploadIcon, UserIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { api } from "../api/client";
import { useAction, useClasses, useGet, useList, usePublicSettings, useSections, useSubjects } from "../api/hooks";
import type { FileItem, Subject } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { DAYS, fromUnix, titleCase, toOptions } from "../utils";

function useTeacherOptions() {
  const t = useList<{ teacher_id: number; name: string }>("/teachers");
  return toOptions(t.data?.items, "teacher_id", "name");
}

/** School name/logo block that only appears on paper (see .print-only in index.css). */
export function PrintHeader({ title, lines }: { title: string; lines?: ReactNode[] }) {
  const settings = usePublicSettings();
  return (
    <div className="print-only mb-6 text-center">
      {settings.data?.logo_url && <img src={settings.data.logo_url} alt="" className="mx-auto mb-2 max-h-16" />}
      <div className="text-xl font-semibold">{settings.data?.system_name}</div>
      {settings.data?.address && <div className="text-sm">{settings.data.address}</div>}
      <div className="mt-3 text-lg font-medium">{title}</div>
      {lines?.filter(Boolean).map((l, i) => (
        <div key={i} className="text-sm">
          {l}
        </div>
      ))}
    </div>
  );
}

export function ClassesPage() {
  const teachers = useTeacherOptions();
  const classes = useClasses();
  const [classId, setClassId] = useState<string | null>(null);
  return (
    <Tabs defaultValue="classes" className="gap-4">
      <TabsList>
        <TabsTrigger value="classes">Classes</TabsTrigger>
        <TabsTrigger value="sections">Sections</TabsTrigger>
      </TabsList>
      <TabsContent value="classes">
        <CrudPage
          title="Classes"
          path="/classes"
          idField="class_id"
          fields={[
            { name: "name", label: "Name", required: true, placeholder: "e.g. Ten (max 11 characters)" },
            { name: "name_numeric", label: "Numeric name", placeholder: "e.g. 10" },
            { name: "teacher_id", label: "Class teacher", type: "select", options: teachers },
          ]}
        />
      </TabsContent>
      <TabsContent value="sections">
        <CrudPage
          title="Sections"
          path="/sections"
          idField="section_id"
          params={{ class_id: classId || undefined }}
          headerExtra={
            <Combobox className="w-48" placeholder="Filter by class" clearable data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} />
          }
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "nick_name", label: "Nick name" },
            { name: "class_id", label: "Class", type: "select", required: true, options: toOptions(classes.data?.items, "class_id", "name") },
            { name: "teacher_id", label: "Section teacher", type: "select", options: teachers },
          ]}
        />
      </TabsContent>
    </Tabs>
  );
}

export function SubjectsPage() {
  const user = useUser();
  const teachers = useTeacherOptions();
  const classes = useClasses();
  const [classId, setClassId] = useState<string | null>(null);
  return (
    <CrudPage
      title="Subjects"
      path="/subjects"
      idField="subject_id"
      canWrite={user.role === "admin"}
      params={{ class_id: classId || undefined }}
      headerExtra={
        <Combobox className="w-48" placeholder="Filter by class" clearable data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} />
      }
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "class_id", label: "Class", type: "select", required: true, options: toOptions(classes.data?.items, "class_id", "name") },
        { name: "teacher_id", label: "Teacher", type: "select", options: teachers },
      ]}
    />
  );
}

// --- routine ------------------------------------------------------------------

interface Routine {
  class_routine_id: number;
  class_id: number;
  section_id: number;
  subject_id: number;
  day: string;
  time_start: number;
  time_start_min: number;
  time_end: number;
  time_end_min: number;
}

const pad = (n: number) => String(n ?? 0).padStart(2, "0");
const slot = (r: Routine) => `${pad(r.time_start)}:${pad(r.time_start_min)} – ${pad(r.time_end)}:${pad(r.time_end_min)}`;
const minutes = (r: Routine) => r.time_start * 60 + r.time_start_min;

// subject colour accents so the same subject is easy to spot across the week
const ACCENTS = ["border-l-sky-500", "border-l-emerald-500", "border-l-amber-500", "border-l-violet-500", "border-l-rose-500", "border-l-teal-500", "border-l-orange-500", "border-l-indigo-500"];

function RoutineGrid({
  rows, subjects, teachers, loading, title, description, onEdit, onDelete,
}: {
  rows: Routine[];
  subjects: Subject[];
  teachers: { value: string; label: string }[];
  loading?: boolean;
  title: string;
  description?: ReactNode;
  onEdit?: (r: Routine) => void;
  onDelete?: (id: number) => void;
}) {  // prettier-ignore
  const subject = new Map(subjects.map((s) => [s.subject_id, s]));
  const teacher = new Map(teachers.map((t) => [t.value, t.label]));
  const today = dayjs().format("dddd").toLowerCase();

  return (
    <Card className="gap-0 overflow-hidden py-0 print:border-0 print:shadow-none">
      <CardHeader className="border-b py-4 [.border-b]:pb-4">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <PrinterIcon />
            Print
          </Button>
        </CardAction>
      </CardHeader>
      <div className="divide-y print:[&>div]:border-black/30">
        {DAYS.map((day) => {
          const items = rows.filter((r) => r.day === day).sort((a, b) => minutes(a) - minutes(b));
          return (
            <div key={day} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[8rem_1fr] sm:items-start sm:px-6 print:break-inside-avoid", day === today && "bg-primary/5 print:bg-transparent")}>
              <div className="flex items-center gap-2 pt-1 text-sm font-medium">
                {titleCase(day)}
                {day === today && <Badge variant="secondary" className="no-print">Today</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                {loading && <Skeleton className="h-16 w-40" />}
                {!loading && items.length === 0 && <span className="text-muted-foreground pt-1 text-sm">No classes</span>}
                {items.map((r) => {
                  const s = subject.get(r.subject_id);
                  const t = s?.teacher_id ? teacher.get(String(s.teacher_id)) : undefined;
                  return (
                    <div
                      key={r.class_routine_id}
                      className={cn(
                        "bg-muted/40 relative min-w-40 rounded-md border border-l-4 px-3 py-2 text-sm print:bg-transparent",
                        ACCENTS[r.subject_id % ACCENTS.length],
                        (onEdit || onDelete) && "pr-16",
                      )}
                    >
                      <div className="font-medium">{s?.name ?? `Subject #${r.subject_id}`}</div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                        <ClockIcon className="size-3" />
                        {slot(r)}
                      </div>
                      {t && (
                        <div className="text-muted-foreground flex items-center gap-1 text-xs">
                          <UserIcon className="size-3" />
                          {t}
                        </div>
                      )}
                      {(onEdit || onDelete) && (
                        <div className="absolute top-1 right-1 flex">
                          {onEdit && (
                            <IconAction label="Edit period" onClick={() => onEdit(r)}>
                              <PencilIcon />
                            </IconAction>
                          )}
                          {onDelete && (
                            <IconAction label="Remove period" destructive onClick={() => onDelete(r.class_routine_id)}>
                              <Trash2Icon />
                            </IconAction>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

interface PeriodForm {
  subject_id: string | null;
  day: string;
  start: string;
  end: string;
}

const EMPTY_PERIOD: PeriodForm = { subject_id: null, day: "sunday", start: "09:00", end: "09:45" };
const toHM = (v: string) => v.split(":").map(Number) as [number, number];

export function RoutinePage() {
  const user = useUser();
  const canEdit = user.role === "admin";
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [form, setForm] = useState<PeriodForm>(EMPTY_PERIOD);
  const [error, setError] = useState<{ subject?: string; time?: string }>({});
  const ready = sel.classId && sel.sectionId;
  const rows = useList<Routine>(ready ? "/class-routines" : null, { class_id: sel.classId, section_id: sel.sectionId });
  const subjects = useSubjects(sel.classId);
  const teachers = useTeacherOptions();
  const classes = useClasses();
  const sections = useSections(sel.classId);
  const className = classes.data?.items.find((c) => String(c.class_id) === sel.classId)?.name;
  const sectionName = sections.data?.items.find((s) => String(s.section_id) === sel.sectionId)?.name;

  const save = useAction(
    (v: PeriodForm) => {
      const [time_start, time_start_min] = toHM(v.start);
      const [time_end, time_end_min] = toHM(v.end);
      const body = {
        subject_id: Number(v.subject_id), day: v.day, time_start, time_start_min, time_end, time_end_min,
        class_id: Number(sel.classId), section_id: Number(sel.sectionId),
      };  // prettier-ignore
      return editing ? api.put(`/class-routines/${editing.class_routine_id}`, body) : api.post("/class-routines", body);
    },
    { success: editing ? "Period updated" : "Added", invalidate: [["/class-routines"]], onSuccess: () => setOpened(false) },
  );
  const del = useAction((id: number) => api.delete(`/class-routines/${id}`), { invalidate: [["/class-routines"]] });

  const openForm = (r: Routine | null) => {
    setEditing(r);
    setError({});
    setForm(
      r
        ? { subject_id: String(r.subject_id), day: r.day, start: `${pad(r.time_start)}:${pad(r.time_start_min)}`, end: `${pad(r.time_end)}:${pad(r.time_end_min)}` }
        : EMPTY_PERIOD,
    );
    setOpened(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof error = {};
    if (!form.subject_id) next.subject = "Required";
    if (!form.start || !form.end) next.time = "Start and end times are required";
    else if (form.end <= form.start) next.time = "End time must be after the start time";
    setError(next);
    if (!next.subject && !next.time) save.mutate(form);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class routine"
        subtitle={canEdit ? undefined : "Weekly timetable (read only)"}
        actions={
          ready &&
          canEdit && (
            <Button onClick={() => openForm(null)}>
              <PlusIcon />
              Add period
            </Button>
          )
        }
      />
      <Card className="no-print py-4">
        <CardContent className="px-4">
          <ClassPicker value={sel} onChange={setSel} />
        </CardContent>
      </Card>
      {ready ? (
        <>
          <PrintHeader title="Class routine" lines={[`Class ${className ?? ""} : Section ${sectionName ?? ""}`]} />
          <RoutineGrid
            title="Weekly timetable"
            description={className && sectionName ? `Class ${className} · Section ${sectionName}` : undefined}
            loading={rows.isLoading}
            rows={rows.data?.items ?? []}
            subjects={subjects.data?.items ?? []}
            teachers={teachers}
            onEdit={canEdit ? openForm : undefined}
            onDelete={
              canEdit
                ? (id) => confirmAction({ title: "Remove this period?", confirmLabel: "Remove", onConfirm: () => del.mutate(id) })
                : undefined
            }
          />
        </>
      ) : (
        <EmptyState icon={CalendarDaysIcon} title="Choose a class and section">
          The weekly timetable appears here.
        </EmptyState>
      )}
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit period" : "Add period"}</DialogTitle>
            <DialogDescription>
              {className && sectionName ? `Class ${className} · Section ${sectionName}` : null}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Subject" htmlFor="period-subject" required error={error.subject}>
              <Combobox
                id="period-subject"
                data={toOptions(subjects.data?.items, "subject_id", "name")}
                value={form.subject_id}
                onChange={(subject_id) => setForm((f) => ({ ...f, subject_id }))}
                placeholder="Choose subject"
                aria-invalid={!!error.subject || undefined}
              />
            </Field>
            <Field label="Day" htmlFor="period-day" required>
              <Combobox
                id="period-day"
                data={DAYS.map((d) => ({ value: d, label: titleCase(d) }))}
                value={form.day}
                onChange={(day) => day && setForm((f) => ({ ...f, day }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Starts" htmlFor="period-start" required>
                <Input id="period-start" type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} aria-invalid={!!error.time || undefined} />
              </Field>
              <Field label="Ends" htmlFor="period-end" required>
                <Input id="period-end" type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} aria-invalid={!!error.time || undefined} />
              </Field>
            </div>
            {error.time && <p className="text-destructive -mt-2 text-xs">{error.time}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpened(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                {editing ? "Save" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function useChildSelect() {
  const user = useUser();
  const children = useGet<{ student_id: number; name: string }[]>(user.role === "parent" ? "/students/children" : null);
  const [picked, setPicked] = useState<string | null>(null);
  const childId = user.role === "parent" ? picked ?? (children.data?.[0] ? String(children.data[0].student_id) : null) : null;
  const select =
    user.role === "parent" ? (
      <Combobox className="w-56" placeholder="Choose child" data={toOptions(children.data, "student_id", "name")} value={childId} onChange={setPicked} />
    ) : null;
  return { childId, select };
}

export function MyRoutinePage() {
  const { childId, select } = useChildSelect();
  const user = useUser();
  const rows = useGet<Routine[]>(user.role !== "parent" || childId ? "/my/routine" : null, { student_id: childId || undefined });
  const subjects = useList<Subject>("/subjects");
  const teachers = useTeacherOptions();
  return (
    <div className="space-y-6">
      <PageHeader title="My routine" actions={select} />
      <PrintHeader title="Class routine" lines={user.role === "parent" ? undefined : [user.name]} />
      <RoutineGrid
        title="Weekly timetable"
        description={user.role === "teacher" ? "Periods of the subjects you teach" : undefined}
        loading={rows.isLoading}
        rows={rows.data ?? []}
        subjects={subjects.data?.items ?? []}
        teachers={teachers}
      />
    </div>
  );
}

// --- syllabus & study material -------------------------------------------------

interface UploadForm {
  title: string;
  description: string;
  class_id: string | null;
  subject_id: string | null;
  file: File | null;
}

const EMPTY_UPLOAD: UploadForm = { title: "", description: "", class_id: null, subject_id: null, file: null };

function FilesPage({ title, path, idField }: { title: string; path: string; idField: string }) {
  const user = useUser();
  const staff = user.role === "admin" || user.role === "teacher";
  const { childId, select } = useChildSelect();
  const [classId, setClassId] = useState<string | null>(null);
  const classes = useClasses();
  const [opened, setOpened] = useState(false);
  const [form, setForm] = useState<UploadForm>(EMPTY_UPLOAD);
  const [errors, setErrors] = useState<Partial<Record<keyof UploadForm, string>>>({});
  const [fileKey, setFileKey] = useState(0);
  const list = useList<FileItem & Record<string, unknown>>(user.role === "parent" && !childId ? null : path, {
    class_id: staff ? classId || undefined : undefined,
    student_id: childId || undefined,
  });
  const className = new Map((classes.data?.items ?? []).map((c) => [String(c.class_id), c.name]));
  const formSubjects = useSubjects(form.class_id || null);
  const upload = useAction(
    (v: UploadForm) => {
      const body = new FormData();
      body.append("title", v.title);
      if (v.description) body.append("description", v.description);
      body.append("class_id", v.class_id!);
      if (v.subject_id) body.append("subject_id", v.subject_id);
      body.append("file", v.file!);
      return api.post(path, body);
    },
    {
      success: "Uploaded",
      invalidate: [[path]],
      onSuccess: () => {
        setForm(EMPTY_UPLOAD);
        setFileKey((k) => k + 1);
        setOpened(false);
      },
    },
  );
  const del = useAction((id: unknown) => api.delete(`${path}/${id}`), { success: "Deleted", invalidate: [[path]] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.title) next.title = "Required";
    if (!form.class_id) next.class_id = "Required";
    if (!form.file) next.file = "Choose a file";
    setErrors(next);
    if (Object.keys(next).length === 0) upload.mutate(form);
  };
  const colSpan = staff ? 5 : 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        actions={
          <>
            {select}
            {staff && (
              <Combobox className="w-48" placeholder="Filter by class" clearable data={toOptions(classes.data?.items, "class_id", "name")} value={classId} onChange={setClassId} />
            )}
            {staff && (
              <Button onClick={() => { setErrors({}); setOpened(true); }}>
                <UploadIcon />
                Upload
              </Button>
            )}
          </>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="min-w-[600px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>File</TableHead>
              {staff && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={list.isLoading} empty={list.data?.items.length === 0} colSpan={colSpan} emptyText="Nothing uploaded yet" />
            {list.data?.items.map((f) => (
              <TableRow key={String(f[idField])}>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{f.title}</div>
                  {f.description && <div className="text-muted-foreground text-xs">{f.description}</div>}
                </TableCell>
                <TableCell>{className.get(String(f.class_id)) ?? <Dash />}</TableCell>
                <TableCell>{fromUnix(f.timestamp)}</TableCell>
                <TableCell>
                  {f.download_url ? (
                    <a href={f.download_url} target="_blank" rel="noopener" className="text-primary inline-flex items-center gap-1 hover:underline">
                      <DownloadIcon className="size-3.5" />
                      Download
                    </a>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                {staff && (
                  <TableCell className="text-right">
                    <IconAction label="Delete" destructive onClick={() => confirmAction({ title: "Delete file?", onConfirm: () => del.mutate(f[idField]) })}>
                      <Trash2Icon />
                    </IconAction>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload {title.toLowerCase()}</DialogTitle>
            <DialogDescription>Files are renamed and served through signed links.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Title" htmlFor="upload-title" required error={errors.title}>
              <Input id="upload-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} aria-invalid={!!errors.title || undefined} />
            </Field>
            <Field label="Description" htmlFor="upload-description">
              <Textarea id="upload-description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Class" htmlFor="upload-class" required error={errors.class_id}>
                <Combobox
                  id="upload-class"
                  data={toOptions(classes.data?.items, "class_id", "name")}
                  value={form.class_id}
                  onChange={(class_id) => setForm((f) => ({ ...f, class_id, subject_id: null }))}
                  placeholder="Choose class"
                  aria-invalid={!!errors.class_id || undefined}
                />
              </Field>
              <Field label="Subject" htmlFor="upload-subject">
                <Combobox
                  id="upload-subject"
                  clearable
                  disabled={!form.class_id}
                  data={toOptions(formSubjects.data?.items, "subject_id", "name")}
                  value={form.subject_id}
                  onChange={(subject_id) => setForm((f) => ({ ...f, subject_id }))}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <Field label="File" htmlFor="upload-file" required error={errors.file} description="PDF, Office documents, images, audio/video or zip; max 10 MB">
              <Input
                key={fileKey}
                id="upload-file"
                type="file"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] ?? null;
                  setForm((f) => ({ ...f, file }));
                }}
                aria-invalid={!!errors.file || undefined}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpened(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={upload.isPending}>
                Upload
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const SyllabusPage = () => <FilesPage title="Syllabus" path="/syllabus" idField="academic_syllabus_id" />;
export const StudyMaterialPage = () => <FilesPage title="Study material" path="/study-materials" idField="document_id" />;
