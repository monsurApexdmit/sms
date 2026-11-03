import dayjs from "dayjs";
import { BookCheckIcon, DownloadIcon, PencilIcon, PlusIcon, SendIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api } from "../api/client";
import { useAction, useClasses, useGet, usePagedList, useSections, useSubjects } from "../api/hooks";
import type { Homework, HomeworkRosterRow, HomeworkSubmission } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";
import { useChildSelect } from "./Academic";
import { t, tn } from "../i18n";

const FILE_HINT = t("PDF, Office documents, images, audio/video or zip; max 10 MB");
const day = (d: string) => dayjs(d).format("DD MMM YYYY");
const score = (marks: number | null, max: number | null) => (marks === null ? "—" : max ? `${marks} / ${max}` : String(marks));

function FileLink({ url, label = t("Download") }: { url: string | null; label?: string }) {
  if (!url) return <Dash />;
  return (
    <a href={url} target="_blank" rel="noopener" className="text-primary inline-flex items-center gap-1 hover:underline">
      <DownloadIcon className="size-3.5" />
      {label}
    </a>
  );
}

/** Where a student stands on one homework. */
function StatusBadge({ hw }: { hw: Homework }) {
  const sub = hw.submission;
  const left = dayjs(hw.due_date).diff(dayjs().startOf("day"), "day");
  if (sub?.graded_at) return <Badge className="bg-success/15 text-success border-transparent">{tn("Graded {score}", { score: score(sub.marks, hw.max_marks) })}</Badge>;
  if (sub) return <Badge className="bg-primary/10 text-primary border-transparent">{sub.is_late ? t("Submitted late") : t("Submitted")}</Badge>;
  if (left < 0) return <Badge className="bg-destructive/10 text-destructive border-transparent">{t("Overdue")}</Badge>;
  if (left <= 2) return <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">{left === 0 ? t("Due today") : t("Due soon")}</Badge>;
  return <Badge variant="secondary">{tn("Due {day}", { day: day(hw.due_date) })}</Badge>;
}

export function HomeworkPage() {
  const user = useUser();
  return user.role === "admin" || user.role === "teacher" ? <StaffHomework /> : <MyHomework />;
}

// --- staff --------------------------------------------------------------------------

interface FormState {
  title: string;
  description: string;
  class_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  due_date: string;
  max_marks: string;
  allow_late: boolean;
  remove_file: boolean;
  file: File | null;
}

function HomeworkForm({ homework, onDone }: { homework: Homework | null; onDone: () => void }) {
  const user = useUser();
  const classes = useClasses();
  const [form, setForm] = useState<FormState>(() => ({
    title: homework?.title ?? "",
    description: homework?.description ?? "",
    class_id: homework ? String(homework.class_id) : null,
    section_id: homework?.section_id ? String(homework.section_id) : null,
    subject_id: homework ? String(homework.subject_id) : null,
    due_date: homework?.due_date ?? dayjs().add(7, "day").format("YYYY-MM-DD"),
    max_marks: homework?.max_marks != null ? String(homework.max_marks) : "",
    allow_late: homework?.allow_late ?? false,
    remove_file: false,
    file: null,
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const sections = useSections(form.class_id);
  const subjects = useSubjects(form.class_id);
  const ownSubjects = (subjects.data?.items ?? []).filter((s) => user.role === "admin" || s.teacher_id === user.id);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useAction(
    async () => {
      const body = new FormData();
      body.append("title", form.title.trim());
      if (form.description.trim()) body.append("description", form.description.trim());
      if (form.section_id) body.append("section_id", form.section_id);
      body.append("due_date", form.due_date);
      if (form.max_marks) body.append("max_marks", form.max_marks);
      body.append("allow_late", form.allow_late ? "true" : "false");
      if (form.file) body.append("file", form.file);
      if (homework) {
        if (form.remove_file) body.append("remove_file", "true");
        await api.put(`/homework/${homework.homework_id}`, body);
      } else {
        body.append("class_id", form.class_id!);
        body.append("subject_id", form.subject_id!);
        await api.post("/homework", body);
      }
    },
    { success: t("Homework saved"), invalidate: [["/homework"]], onSuccess: onDone },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = t("Required");
    if (!form.class_id) next.class_id = t("Required");
    if (!form.subject_id) next.subject_id = t("Required");
    if (!form.due_date) next.due_date = t("Required");
    if (form.max_marks && !(Number(form.max_marks) > 0)) next.max_marks = t("Must be more than 0");
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate(undefined);
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t("Title")} htmlFor="hw-title" required error={errors.title}>
        <Input id="hw-title" value={form.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title || undefined} />
      </Field>
      <Field label={t("Instructions")} htmlFor="hw-desc">
        <Textarea id="hw-desc" rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Class")} required error={errors.class_id}>
          <Combobox
            disabled={!!homework}
            data={toOptions(classes.data?.items, "class_id", "name")}
            value={form.class_id}
            onChange={(v) => setForm((f) => ({ ...f, class_id: v, section_id: null, subject_id: null }))}
            placeholder={t("Choose class")}
          />
        </Field>
        <Field label={t("Section")}>
          <Combobox
            clearable
            disabled={!form.class_id}
            data={toOptions(sections.data?.items, "section_id", "name")}
            value={form.section_id}
            onChange={(v) => set("section_id", v)}
            placeholder={t("All sections")}
          />
        </Field>
        <Field label={t("Subject")} required error={errors.subject_id}>
          <Combobox
            disabled={!form.class_id || !!homework}
            data={toOptions(ownSubjects, "subject_id", "name")}
            value={form.subject_id}
            onChange={(v) => set("subject_id", v)}
            placeholder={t("Choose subject")}
            emptyText={t("You teach no subject in this class")}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Due date")} required error={errors.due_date}>
          <DatePicker value={form.due_date} onChange={(v) => set("due_date", v)} clearable={false} />
        </Field>
        <Field label={t("Out of (marks)")} htmlFor="hw-max" error={errors.max_marks} description={t("Leave empty for ungraded homework")}>
          <Input id="hw-max" type="number" min={0} step="0.5" value={form.max_marks} onChange={(e) => set("max_marks", e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={form.allow_late} onCheckedChange={(v) => set("allow_late", v)} />
        {t("Accept late submissions (marked as late)")}</label>
      <Field label={homework?.file_url ? t("Replace attachment") : t("Attachment")} htmlFor="hw-file" description={FILE_HINT}>
        <Input id="hw-file" type="file" onChange={(e) => set("file", e.currentTarget.files?.[0] ?? null)} />
      </Field>
      {homework?.file_url && !form.file && (
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.remove_file} onCheckedChange={(v) => set("remove_file", v)} />
          {t("Remove the current attachment")}</label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );
}

function GradeRow({ row, homework }: { row: HomeworkRosterRow; homework: Homework }) {
  const sub = row.submission;
  const [marks, setMarks] = useState(sub?.marks != null ? String(sub.marks) : "");
  const [feedback, setFeedback] = useState(sub?.feedback ?? "");
  const grade = useAction(
    () => api.put(`/homework/submissions/${sub!.submission_id}/grade`, { marks: marks === "" ? null : Number(marks), feedback: feedback.trim() || null }),
    { success: t("Saved grade for {name}", { name: row.name }), invalidate: [["/homework"], [`/homework/${homework.homework_id}/submissions`]] },
  );
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">
          {row.roll ? <span className="text-muted-foreground">{row.roll}. </span> : null}
          {row.name}
        </div>
        {!sub ? (
          <Badge variant="secondary">{t("Not submitted")}</Badge>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{dayjs(sub.submitted_at).format("DD MMM, HH:mm")}</span>
            {sub.is_late && <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">{t("Late")}</Badge>}
            {sub.graded_at && <Badge className="bg-success/15 text-success border-transparent">{t("Graded")}</Badge>}
          </div>
        )}
      </div>
      {sub && (
        <>
          {sub.text && <p className="bg-muted/50 rounded-md p-2 text-sm whitespace-pre-wrap">{sub.text}</p>}
          {sub.file_url && <FileLink url={sub.file_url} label={t("Attached file")} />}
          <div className="flex flex-wrap items-end gap-2">
            <Field label={homework.max_marks ? t("Marks (of {max_marks})", { max_marks: homework.max_marks }) : t("Marks")} className="w-32">
              <Input type="number" min={0} max={homework.max_marks ?? undefined} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} />
            </Field>
            <Field label={t("Feedback")} className="min-w-48 flex-1">
              <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("Optional")} />
            </Field>
            <Button size="sm" loading={grade.isPending} onClick={() => grade.mutate(undefined)}>
              <BookCheckIcon />
              {t("Save")}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function SubmissionsSheet({ homework, onClose }: { homework: Homework | null; onClose: () => void }) {
  const roster = useGet<HomeworkRosterRow[]>(homework ? `/homework/${homework.homework_id}/submissions` : null);
  const rows = roster.data ?? [];
  const handedIn = rows.filter((r) => r.submission).length;
  return (
    <Sheet open={homework !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{homework?.title}</SheetTitle>
          <SheetDescription>
            {homework && t("{value} · due {day} · {handedIn} of {length} handed in", { value: homework.subject_name ?? "", day: day(homework.due_date), handedIn, length: rows.length })}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {roster.isLoading && <Skeleton className="h-24 w-full" />}
          {!roster.isLoading && rows.length === 0 && <p className="text-muted-foreground text-sm">{t("No students are enrolled for this homework.")}</p>}
          {homework && rows.map((r) => <GradeRow key={`${r.student_id}-${r.submission?.graded_at ?? ""}`} row={r} homework={homework} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StaffHomework() {
  const user = useUser();
  const classes = useClasses();
  const [classId, setClassId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const subjects = useSubjects(classId, user.role === "teacher" && !classId ? user.id : undefined);
  const subjectItems = (subjects.data?.items ?? []).filter((s) => user.role === "admin" || s.teacher_id === user.id);
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Homework>("/homework", {
    class_id: classId ?? undefined, subject_id: subjectId ?? undefined, status: status === "all" ? undefined : status,
  });  // prettier-ignore
  const [editing, setEditing] = useState<Homework | "new" | null>(null);
  const [grading, setGrading] = useState<Homework | null>(null);
  const remove = useAction((id: number) => api.delete(`/homework/${id}`), { success: t("Homework deleted"), invalidate: [["/homework"]] });
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Homework")}
        subtitle={t("Set homework for a class or section, collect answers and grade them.")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("New homework")}</Button>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="flex flex-wrap gap-3">
            <Combobox
              className="w-44"
              clearable
              data={toOptions(classes.data?.items, "class_id", "name")}
              value={classId}
              onChange={(v) => { setClassId(v); setSubjectId(null); }}
              placeholder={t("All classes")}
            />
            <Combobox className="w-44" clearable data={toOptions(subjectItems, "subject_id", "name")} value={subjectId} onChange={setSubjectId} placeholder={t("All subjects")} />
          </div>
          <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
            <ToggleGroupItem value="all">{t("All")}</ToggleGroupItem>
            <ToggleGroupItem value="open">{t("Open")}</ToggleGroupItem>
            <ToggleGroupItem value="closed">{t("Past due")}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Homework")}</TableHead>
              <TableHead>{t("Class")}</TableHead>
              <TableHead>{t("Due")}</TableHead>
              <TableHead className="text-right">{t("Handed in")}</TableHead>
              <TableHead className="text-right">{t("Graded")}</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={6} emptyText={t("No homework yet")} />
            {rows.map((hw) => (
              <TableRow key={hw.homework_id}>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{hw.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {hw.subject_name}
                    {hw.teacher_name ? " " + t("· {teacher_name}", { teacher_name: hw.teacher_name }) : ""}
                    {hw.max_marks ? " " + t("· out of {max_marks}", { max_marks: hw.max_marks }) : ""}
                  </div>
                </TableCell>
                <TableCell>
                  {hw.class_name}
                  <span className="text-muted-foreground">{hw.section_name ? " " + t("· {section_name}", { section_name: hw.section_name }) : " " + t("· all sections")}</span>
                </TableCell>
                <TableCell className={cn("tabular-nums", dayjs(hw.due_date).isBefore(dayjs(), "day") && "text-muted-foreground")}>{day(hw.due_date)}</TableCell>
                <TableCell className="text-right tabular-nums">{hw.submitted ?? 0} / {hw.students ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{hw.graded ?? 0}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction label={t("Submissions")} onClick={() => setGrading(hw)}><UsersIcon /></IconAction>
                    <IconAction label={t("Edit")} onClick={() => setEditing(hw)}><PencilIcon /></IconAction>
                    <IconAction
                      label={t("Delete")}
                      destructive
                      onClick={() => confirmAction({ title: t("Delete \"{title}\"?", { title: hw.title }), description: t("Students' submissions and grades are deleted too."), onConfirm: () => remove.mutate(hw.homework_id) })}
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

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("New homework") : t("Edit homework")}</DialogTitle>
          </DialogHeader>
          {editing !== null && <HomeworkForm key={editing === "new" ? "new" : editing.homework_id} homework={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <SubmissionsSheet homework={grading} onClose={() => setGrading(null)} />
    </div>
  );
}

// --- students and parents -------------------------------------------------------------

function SubmitDialog({ homework, onClose }: { homework: Homework | null; onClose: () => void }) {
  const [text, setText] = useState(homework?.submission?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const submit = useAction(
    async () => {
      const body = new FormData();
      if (text.trim()) body.append("text", text.trim());
      if (file) body.append("file", file);
      await api.post(`/homework/${homework!.homework_id}/submission`, body);
    },
    { success: t("Homework handed in"), invalidate: [["/homework"]], onSuccess: onClose },
  );
  const late = homework && dayjs().isAfter(dayjs(homework.due_date), "day");
  return (
    <Dialog open={homework !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{homework?.submission ? t("Replace your answer") : t("Hand in")}: {homework?.title}</DialogTitle>
          <DialogDescription>
            {homework?.submission ? t("Your new answer replaces the one you handed in, attachment included.") : t("Due {value}.", { value: homework ? day(homework.due_date) : "" })}
            {late ? " " + t("This will be marked as late.") : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label={t("Answer")} htmlFor="sub-text">
            <Textarea id="sub-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label={t("Attachment")} htmlFor="sub-file" description={FILE_HINT}>
            <Input id="sub-file" type="file" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!text.trim() && !file} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
            <SendIcon />
            {t("Hand in")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HomeworkCard({ hw, canSubmit, onSubmit }: { hw: Homework; canSubmit: boolean; onSubmit: () => void }) {
  const sub: HomeworkSubmission | null = hw.submission ?? null;
  const open = !dayjs().isAfter(dayjs(hw.due_date), "day") || hw.allow_late;
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{hw.title}</CardTitle>
          <CardDescription>
            {tn("{subject_name}{value} · set {day} · due {day2}", { subject_name: hw.subject_name, value: hw.teacher_name ? " " + t("· {teacher_name}", { teacher_name: hw.teacher_name }) : "", day: day(hw.assigned_on), day2: day(hw.due_date) })}
          </CardDescription>
        </div>
        <StatusBadge hw={hw} />
      </CardHeader>
      {(hw.description || hw.file_url) && (
        <CardContent className="space-y-2">
          {hw.description && <p className="text-sm whitespace-pre-wrap">{hw.description}</p>}
          {hw.file_url && <FileLink url={hw.file_url} label={t("Homework sheet")} />}
        </CardContent>
      )}
      {sub && (
        <CardContent>
          <div className="bg-muted/40 space-y-1 rounded-md p-3 text-sm">
            <div className="text-muted-foreground text-xs">{tn("Handed in {dayjs}", { dayjs: dayjs(sub.submitted_at).format("DD MMM YYYY, HH:mm") })}</div>
            {sub.text && <p className="whitespace-pre-wrap">{sub.text}</p>}
            {sub.file_url && <FileLink url={sub.file_url} label={t("Your file")} />}
            {sub.graded_at && (
              <div className="border-t pt-2">
                <span className="font-medium">{tn("Marks: {score}", { score: score(sub.marks, hw.max_marks) })}</span>
                {sub.feedback && <p className="text-muted-foreground">{sub.feedback}</p>}
              </div>
            )}
          </div>
        </CardContent>
      )}
      {canSubmit && !sub?.graded_at && open && (
        <CardFooter>
          <Button size="sm" variant={sub ? "outline" : "default"} onClick={onSubmit}>
            <SendIcon />
            {sub ? t("Replace answer") : t("Hand in")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function MyHomework() {
  const user = useUser();
  const { childId, select } = useChildSelect();
  const [status, setStatus] = useState("open");
  const ready = user.role === "student" || !!childId;
  const { data, isLoading, page, setPage, pageSize } = usePagedList<Homework>(ready ? "/homework" : null, {
    student_id: user.role === "parent" ? childId : undefined, status: status === "all" ? undefined : status,
  }, 20);  // prettier-ignore
  const [submitting, setSubmitting] = useState<Homework | null>(null);
  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Homework")}
        subtitle={user.role === "parent" ? t("Your child's homework, what was handed in and the grades.") : t("Homework set for your class.")}
        actions={
          <>
            {select}
            <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
              <ToggleGroupItem value="open">{t("Open")}</ToggleGroupItem>
              <ToggleGroupItem value="closed">{t("Past due")}</ToggleGroupItem>
              <ToggleGroupItem value="all">{t("All")}</ToggleGroupItem>
            </ToggleGroup>
          </>
        }
      />
      {isLoading && <Skeleton className="h-40 w-full" />}
      {!isLoading && ready && rows.length === 0 && (
        <EmptyState icon={BookCheckIcon} title={status === "open" ? t("No open homework") : t("No homework")}>
          {t("New homework appears here when a teacher sets it.")}</EmptyState>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((hw) => (
          <HomeworkCard key={hw.homework_id} hw={hw} canSubmit={user.role === "student"} onSubmit={() => setSubmitting(hw)} />
        ))}
      </div>
      <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      {submitting && <SubmitDialog key={submitting.homework_id} homework={submitting} onClose={() => setSubmitting(null)} />}
    </div>
  );
}
