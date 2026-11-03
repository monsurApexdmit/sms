import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ChartColumnIcon, ClipboardListIcon, DownloadIcon, EyeIcon, InfoIcon, PrinterIcon, SaveIcon, SendIcon, UndoIcon, UploadIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useClasses, useExams, useGet, useList, useSections } from "../api/hooks";
import type { Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { downloadFile, ExportButton } from "../components/ExportButton";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toOptions } from "../utils";
import { PrintHeader, useChildSelect } from "./Academic";

const nameOf = <T,>(items: T[] | undefined, key: keyof T, id: unknown) =>
  id === null || id === undefined ? undefined : (items ?? []).find((x) => String(x[key]) === String(id));

export function ExamsPage() {
  return (
    <Tabs defaultValue="exams" className="gap-4">
      <TabsList>
        <TabsTrigger value="exams">Exams</TabsTrigger>
        <TabsTrigger value="grades">Grades</TabsTrigger>
      </TabsList>
      <TabsContent value="exams">
        <CrudPage
          title="Exams"
          subtitle="Exams of the running academic year"
          path="/exams"
          idField="exam_id"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "date", label: "Date", type: "date" },
            { name: "comment", label: "Comment", type: "textarea" },
            { name: "year", label: "Year", tableOnly: true },
          ]}
        />
      </TabsContent>
      <TabsContent value="grades">
        <CrudPage
          title="Grades"
          path="/grades"
          idField="grade_id"
          fields={[
            { name: "name", label: "Grade", required: true },
            { name: "grade_point", label: "Grade point", required: true },
            { name: "mark_from", label: "Mark from", type: "number", required: true },
            { name: "mark_upto", label: "Mark up to", type: "number", required: true },
            { name: "comment", label: "Comment" },
          ]}
        />
      </TabsContent>
    </Tabs>
  );
}

// --- question papers ----------------------------------------------------------

interface QuestionPaper {
  question_paper_id: number;
  title: string;
  question_paper: string | null;
  class_id: number | null;
  exam_id: number | null;
  teacher_id: number | null;
}

// while the dialog is open, print only the paper (the rest of the app lives in #root)
const PAPER_PRINT_CSS = `@media print {
  #root, [data-slot="dialog-overlay"] { display: none !important; }
  [data-slot="dialog-content"] {
    position: static !important; transform: none !important; translate: none !important; max-width: none !important; width: auto !important;
    max-height: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; animation: none !important;
  }
}`;

function QuestionPaperDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const classes = useClasses();
  const exams = useExams();
  const { data, isLoading } = useGet<QuestionPaper>(id ? `/question-papers/${id}` : null);
  const className = nameOf(classes.data?.items, "class_id", data?.class_id)?.name;
  const examName = nameOf(exams.data?.items, "exam_id", data?.exam_id)?.name;
  const meta = [examName, className && `Class ${className}`].filter(Boolean).join(" · ");

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {id !== null && <style>{PAPER_PRINT_CSS}</style>}
        <PrintHeader title={data?.title ?? "Question paper"} lines={meta ? [meta] : undefined} />
        <DialogHeader className="no-print">
          <DialogTitle>{data?.title ?? "Question paper"}</DialogTitle>
          <DialogDescription>{meta || "Question paper details"}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : data?.question_paper ? (
          <div className="rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap print:border-0 print:p-0">{data.question_paper}</div>
        ) : (
          <EmptyState icon={ClipboardListIcon} title="No questions written yet">
            Edit the paper to add its questions.
          </EmptyState>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()} disabled={!data}>
            <PrinterIcon />
            Print question paper
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionPapersPage() {
  const user = useUser();
  const classes = useClasses();
  const exams = useExams();
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <>
      <CrudPage
        title="Question papers"
        path="/question-papers"
        idField="question_paper_id"
        params={user.role === "teacher" ? { teacher_id: user.id } : undefined}
        fixed={user.role === "teacher" ? { teacher_id: user.id } : undefined}
        extraActions={(row) => (
          <IconAction label="View & print" onClick={() => setViewing(Number(row.question_paper_id))}>
            <EyeIcon />
          </IconAction>
        )}
        fields={[
          { name: "title", label: "Title", required: true },
          { name: "class_id", label: "Class", type: "select", options: toOptions(classes.data?.items, "class_id", "name") },
          { name: "exam_id", label: "Exam", type: "select", options: toOptions(exams.data?.items, "exam_id", "name") },
          { name: "question_paper", label: "Questions", type: "textarea", formOnly: true },
        ]}
      />
      <QuestionPaperDialog id={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

// --- marks entry --------------------------------------------------------------

interface MarkRow {
  mark_id: number;
  student_id: number;
  student_name: string;
  roll: number | null;
  mark_obtained: number | null;
  comment: string | null;
}

/** Download the section's mark sheet as CSV, fill it in a spreadsheet, and import it back (all rows or none). */
function MarksImport({ params, disabled }: { params: Record<string, string | null | undefined>; disabled?: boolean }) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const template = async () => {
    try {
      await downloadFile("/marks/import-template", params, "marks.csv");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const upload = async (file: File | null) => {
    if (!file) return;
    const body = new FormData();
    Object.entries(params).forEach(([k, v]) => body.append(k, String(v ?? "")));
    body.append("file", file);
    setBusy(true);
    try {
      const { data } = await api.post<{ updated: number }>("/marks/import", body);
      toast.success(`${data.updated} marks imported`);
      qc.invalidateQueries({ queryKey: ["/marks"] });
    } catch (error) {
      const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: { errors?: string[] } })?.detail : undefined;
      if (detail?.errors) setErrors(detail.errors);
      else toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={template}>
        <DownloadIcon />
        Download template
      </Button>
      <FileButton onChange={upload} accept=".csv,text/csv">
        {(props) => (
          <Button variant="outline" loading={busy} disabled={disabled} title={disabled ? "Save or reset your changes first" : undefined} {...props}>
            <UploadIcon />
            Import CSV
          </Button>
        )}
      </FileButton>
      <Dialog open={errors !== null} onOpenChange={(open) => !open && setErrors(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing was imported</DialogTitle>
            <DialogDescription>Fix these rows in the file and import it again.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {errors?.map((e) => <li key={e}>{e}</li>)}
          </ul>
          <DialogFooter>
            <Button onClick={() => setErrors(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MarksPage() {
  const user = useUser();
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null, subjectId: null, examId: null });
  const ready = sel.classId && sel.sectionId && sel.subjectId && sel.examId;
  const params = { exam_id: sel.examId, class_id: sel.classId, section_id: sel.sectionId, subject_id: sel.subjectId };
  const sheet = useGet<MarkRow[]>(ready ? "/marks" : null, params);
  const [rows, setRows] = useState<MarkRow[]>([]);
  useEffect(() => setRows(sheet.data ?? []), [sheet.data]);

  const save = useAction(
    () =>
      api.put("/marks", {
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Number(v)])),
        items: rows.map((r) => ({ mark_id: r.mark_id, mark_obtained: r.mark_obtained, comment: r.comment || null })),
      }),
    { success: "Marks saved", invalidate: [["/marks"]] },
  );
  const update = (i: number, patch: Partial<MarkRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(sheet.data ?? []);
  const entered = rows.filter((r) => r.mark_obtained !== null).length;
  // Enter moves to the same field on the next student, like a spreadsheet
  const next = (field: string, i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.getElementById(`${field}-${i + 1}`)?.focus();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marks entry"
        subtitle={user.role === "teacher" ? "Only subjects assigned to you are listed" : undefined}
        actions={ready && <MarksImport params={params} disabled={dirty} />}
      />
      <Card className="py-4">
        <CardContent className="px-4">
          <ClassPicker value={sel} onChange={setSel} withSubject withExam teacherId={user.role === "teacher" ? user.id : undefined} />
        </CardContent>
      </Card>
      {ready ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="max-h-[calc(100svh-20rem)] min-h-48 overflow-auto">
            <table className="w-full min-w-[560px] caption-bottom text-sm">
              <TableHeader className="bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="w-32">Marks</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={sheet.isLoading} empty={!sheet.isLoading && rows.length === 0} colSpan={4} emptyText="No students enrolled in this section" />
                {rows.map((r, i) => (
                  <TableRow key={r.mark_id}>
                    <TableCell className="text-muted-foreground py-1">{r.roll ?? <Dash />}</TableCell>
                    <TableCell className="py-1 font-medium">{r.student_name}</TableCell>
                    <TableCell className="py-1">
                      <Input
                        id={`mark-${i}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={1000}
                        aria-label={`Marks for ${r.student_name}`}
                        className="h-8 w-24 tabular-nums"
                        value={r.mark_obtained ?? ""}
                        onChange={(e) => update(i, { mark_obtained: e.target.value === "" ? null : Number(e.target.value) })}
                        onKeyDown={next("mark", i)}
                      />
                    </TableCell>
                    <TableCell className="py-1">
                      <Input
                        id={`comment-${i}`}
                        aria-label={`Comment for ${r.student_name}`}
                        className="h-8 min-w-48"
                        value={r.comment ?? ""}
                        onChange={(e) => update(i, { comment: e.target.value })}
                        onKeyDown={next("comment", i)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          <CardFooter className="bg-muted/30 flex-wrap justify-between gap-3 border-t px-4 py-3 [.border-t]:pt-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span>
                {entered} of {rows.length} entered
              </span>
              {dirty && <Badge className="bg-warning/20 text-warning-foreground border-transparent">Unsaved changes</Badge>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setRows(sheet.data ?? [])}>
                <UndoIcon />
                Reset
              </Button>
              <Button loading={save.isPending} disabled={rows.length === 0} onClick={() => save.mutate(undefined)}>
                <SaveIcon />
                Save marks
              </Button>
            </div>
          </CardFooter>
        </Card>
      ) : (
        <EmptyState icon={ClipboardListIcon} title="Choose an exam, class, section and subject">
          The mark sheet for that subject opens here.
        </EmptyState>
      )}
    </div>
  );
}

// --- marksheet ----------------------------------------------------------------

interface Marksheet {
  student: { name: string; student_code?: string; class_name?: string; section_name?: string; roll?: number };
  year: string;
  exams: {
    exam_id: number;
    name: string;
    total: number;
    average_grade_point: number;
    subjects: { subject_id: number; subject: string; mark_obtained: number | null; highest: number | null; grade: string | null; grade_point: string | null; comment: string | null }[];
  }[];
}

// bordered cells on paper; regular shadcn rows on screen
const PRINT_TABLE = "print:border-collapse print:[&_td]:border print:[&_td]:border-black/40 print:[&_th]:border print:[&_th]:border-black/40";

export function MarksheetPage() {
  const user = useUser();
  const staff = user.role === "admin" || user.role === "teacher";
  const { childId, select } = useChildSelect();
  const [classId, setClassId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const classes = useClasses();
  const students = useList<Student>(staff && classId ? "/students" : null, { class_id: classId, limit: 1000 });
  const id = staff ? studentId : user.role === "student" ? String(user.id) : childId;
  const { data, isLoading } = useGet<Marksheet>(id ? `/marksheet/${id}` : null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marksheet"
        actions={
          <>
            {select}
            {data && (
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon />
                Print
              </Button>
            )}
          </>
        }
      />
      {staff && (
        <Card className="no-print py-4">
          <CardContent className="flex flex-wrap items-end gap-3 px-4">
            <Field label="Class" className="w-44">
              <Combobox
                data={toOptions(classes.data?.items, "class_id", "name")}
                value={classId}
                onChange={(v) => { setClassId(v); setStudentId(null); }}
                placeholder="Choose class"
              />
            </Field>
            <Field label="Student" className="w-64">
              <Combobox
                disabled={!classId}
                data={toOptions(students.data?.items, "student_id", "name")}
                value={studentId}
                onChange={setStudentId}
                placeholder="Choose student"
              />
            </Field>
          </CardContent>
        </Card>
      )}
      {isLoading && <Skeleton className="h-48 w-full" />}
      {!id && staff && (
        <EmptyState icon={ChartColumnIcon} title="Choose a class and student">
          Their results for the running year appear here.
        </EmptyState>
      )}
      {data && (
        <div className="space-y-4">
          <PrintHeader title={`Marksheet ${data.year}`} />
          <Card className="py-4 print:border-0 print:py-0 print:shadow-none">
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 px-4 text-sm">
              <div className="text-base font-semibold">{data.student.name}</div>
              {data.student.student_code && (
                <div>
                  <span className="text-muted-foreground">ID </span>
                  {data.student.student_code}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Class </span>
                {data.student.class_name ?? <Dash />} {data.student.section_name && `/ ${data.student.section_name}`}
              </div>
              <div>
                <span className="text-muted-foreground">Roll </span>
                {data.student.roll ?? <Dash />}
              </div>
              <Badge variant="secondary">{data.year}</Badge>
            </CardContent>
          </Card>
          {data.exams.length === 0 && <EmptyState title="No exams in this academic year" />}
          {data.exams.map((exam) => (
            <Card key={exam.exam_id} className="gap-0 overflow-hidden py-0 print:break-inside-avoid print:border-0 print:shadow-none">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b py-3 [.border-b]:pb-3 print:border-0 print:px-0">
                <CardTitle>{exam.name}</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="secondary">Total {exam.total}</Badge>
                  <Badge>GPA {exam.average_grade_point.toFixed(2)}</Badge>
                </div>
              </CardHeader>
              <Table className={PRINT_TABLE}>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Marks</TableHead>
                    <TableHead>Highest</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Point</TableHead>
                    <TableHead>Comment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exam.subjects.map((s) => (
                    <TableRow key={s.subject_id}>
                      <TableCell className="font-medium">{s.subject}</TableCell>
                      <TableCell className="tabular-nums">{s.mark_obtained ?? <Dash />}</TableCell>
                      <TableCell className="tabular-nums">{s.highest ?? <Dash />}</TableCell>
                      <TableCell>{s.grade ?? <Dash />}</TableCell>
                      <TableCell>{s.grade_point ?? <Dash />}</TableCell>
                      <TableCell className="whitespace-normal">{s.comment ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// --- tabulation ---------------------------------------------------------------

interface Tabulation {
  subjects: { subject_id: number; name: string }[];
  rows: { student_id: number; name: string; roll: number | null; marks: Record<string, number | null>; total: number; average_grade_point: number }[];
}

export function TabulationPage() {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null, examId: null });
  const ready = sel.classId && sel.examId;
  const { data, isLoading } = useGet<Tabulation>(ready ? "/tabulation" : null, { class_id: sel.classId, exam_id: sel.examId, section_id: sel.sectionId || undefined });
  const classes = useClasses();
  const sections = useSections(sel.classId);
  const exams = useExams();
  const className = nameOf(classes.data?.items, "class_id", sel.classId)?.name;
  const sectionName = nameOf(sections.data?.items, "section_id", sel.sectionId)?.name;
  const examName = nameOf(exams.data?.items, "exam_id", sel.examId)?.name;

  return (
    <div className="space-y-6">
      <style>{"@media print { @page { size: landscape; } }"}</style>
      <PageHeader
        title="Tabulation sheet"
        subtitle="Section is optional"
        actions={
          data && (
            <>
              <ExportButton size="default" path="/export/tabulation.xlsx" params={{ class_id: sel.classId, exam_id: sel.examId, section_id: sel.sectionId || undefined }} />
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon />
                Print
              </Button>
            </>
          )
        }
      />
      <Card className="no-print py-4">
        <CardContent className="px-4">
          <ClassPicker value={sel} onChange={setSel} withExam />
        </CardContent>
      </Card>
      {!ready && (
        <EmptyState icon={ChartColumnIcon} title="Choose an exam and class">
          Every student's marks for the exam appear in one sheet.
        </EmptyState>
      )}
      {ready && (isLoading || data) && (
        <>
          <PrintHeader
            title="Tabulation sheet"
            lines={[examName, [className && `Class ${className}`, sectionName && `Section ${sectionName}`].filter(Boolean).join(" : ")]}
          />
          <Card className="gap-0 overflow-hidden py-0 print:rounded-none print:shadow-none">
            <Table className="min-w-[600px] border-collapse [&_td]:border-r [&_td:last-child]:border-r-0 [&_th]:border-r [&_th:last-child]:border-r-0 print:[&_td]:border print:[&_th]:border">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-16">Roll</TableHead>
                  <TableHead>Student</TableHead>
                  {data?.subjects.map((s) => (
                    <TableHead key={s.subject_id} className="text-center">
                      {s.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">GPA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={isLoading} empty={data?.rows.length === 0} colSpan={(data?.subjects.length ?? 0) + 4} emptyText="No students found" />
                {data?.rows.map((r) => (
                  <TableRow key={r.student_id}>
                    <TableCell className="text-muted-foreground">{r.roll ?? <Dash />}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    {data.subjects.map((s) => (
                      <TableCell key={s.subject_id} className="text-center tabular-nums">
                        {r.marks[s.subject_id] ?? <Dash />}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-semibold tabular-nums">{r.total}</TableCell>
                    <TableCell className="text-center tabular-nums">{r.average_grade_point.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// --- exam marks by SMS --------------------------------------------------------

type Receiver = "student" | "parent";

export function ExamSmsPage() {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null, examId: null });
  const [receiver, setReceiver] = useState<Receiver>("student");
  const ready = sel.examId && sel.classId;
  const send = useAction(
    async () =>
      (
        await api.post<{ queued: number }>(`/exams/${sel.examId}/marks-sms`, {
          class_id: Number(sel.classId),
          section_id: sel.sectionId ? Number(sel.sectionId) : null,
          receiver,
        })
      ).data,
    { onSuccess: (r) => toast.success(`${r.queued} message${r.queued === 1 ? "" : "s"} queued`) },
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Marks by SMS" subtitle="Text each student's exam results to students or their parents" />
      <Alert>
        <InfoIcon />
        <AlertTitle>An SMS service is required</AlertTitle>
        <AlertDescription>
          <p>
            Messages are only delivered when an SMS gateway (Clickatell, Twilio or MSG91) is selected and configured in{" "}
            <Link to="/app/settings" className="text-primary font-medium underline underline-offset-4">
              System settings
            </Link>
            . Recipients without a phone number are skipped.
          </p>
        </AlertDescription>
      </Alert>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Send results</CardTitle>
          <CardDescription>Each message lists the student's marks per subject for the chosen exam.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <ClassPicker value={sel} onChange={setSel} withExam />
            <p className="text-muted-foreground text-xs">
              Leave the section empty to send to the whole class.
              {sel.sectionId && (
                <>
                  {" "}
                  <button type="button" className="text-primary underline underline-offset-4" onClick={() => setSel({ ...sel, sectionId: null })}>
                    Use all sections
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="grid gap-3">
            <Label>Send to</Label>
            <RadioGroup value={receiver} onValueChange={(v) => setReceiver(v as Receiver)} className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="student" id="receiver-student" />
                <Label htmlFor="receiver-student" className="font-normal">
                  Students
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="parent" id="receiver-parent" />
                <Label htmlFor="receiver-parent" className="font-normal">
                  Parents
                </Label>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t [.border-t]:pt-6">
          <Button
            disabled={!ready}
            loading={send.isPending}
            onClick={() =>
              confirmAction({
                title: "Send results by SMS?",
                description: `Every ${receiver} in the selected ${sel.sectionId ? "section" : "class"} with a phone number will receive a text.`,
                confirmLabel: "Send",
                destructive: false,
                onConfirm: () => send.mutate(undefined),
              })
            }
          >
            <SendIcon />
            Send SMS
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
