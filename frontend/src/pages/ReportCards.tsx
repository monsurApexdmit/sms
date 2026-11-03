import dayjs from "dayjs";
import { CalendarClockIcon, FileBadgeIcon, IdCardIcon, MessageSquareTextIcon, PencilIcon, PlusIcon, PrinterIcon, ScaleIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useExams, useGet, useList, useSubjects } from "../api/hooks";
import type { AdmitCard, ExamPaper, ExamWeights, ReportCard, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { AiRemarkDrafts } from "../components/Ai";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { initials, toOptions } from "../utils";
import { PrintHeader, useChildSelect } from "./Academic";

const ANNUAL = "annual";

/** The student whose own data a student or parent is looking at. */
function useOwnStudent() {
  const user = useUser();
  const { childId, select } = useChildSelect();
  return { ownId: user.role === "student" ? String(user.id) : childId, select };
}

function ExamSelect({ value, onChange, withAnnual }: { value: string | null; onChange: (v: string | null) => void; withAnnual?: boolean }) {
  const exams = useExams();
  const options = toOptions(exams.data?.items, "exam_id", "name");
  return (
    <Field label="Exam" className="w-52">
      <Combobox data={withAnnual ? [{ value: ANNUAL, label: "Annual (all exams)" }, ...options] : options} value={value} onChange={onChange} placeholder="Choose exam" />
    </Field>
  );
}

const fmtDate = (d: string) => dayjs(d).format("ddd, DD MMM YYYY");

// --- exam timetable and admit cards -----------------------------------------------------

interface PaperValues {
  subject_id: string | null;
  exam_date: string;
  start_time: string;
  end_time: string;
  room: string;
}

function PaperForm({ paper, examId, classId, onDone }: { paper: ExamPaper | null; examId: string; classId: string; onDone: () => void }) {
  const subjects = useSubjects(classId);
  const form = useForm<PaperValues>({
    defaultValues: paper
      ? { subject_id: String(paper.subject_id), exam_date: paper.exam_date, start_time: paper.start_time, end_time: paper.end_time, room: paper.room ?? "" }
      : { subject_id: null, exam_date: "", start_time: "10:00", end_time: "13:00", room: "" },
  });
  const { errors } = form.formState;
  const save = useAction(
    async (v: PaperValues) => {
      const body = { ...v, exam_id: Number(examId), class_id: Number(classId), subject_id: Number(v.subject_id), room: v.room || null };
      return (paper ? await api.put<ExamPaper>(`/exam-schedule/${paper.exam_schedule_id}`, body) : await api.post<ExamPaper>("/exam-schedule", body)).data;
    },
    { success: "Saved", invalidate: [["/exam-schedule"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Controller control={form.control} name="subject_id" rules={{ required: "Required" }} render={({ field }) => (
        <Field label="Subject" required error={errors.subject_id?.message}>
          <Combobox data={toOptions(subjects.data?.items, "subject_id", "name")} value={field.value} onChange={field.onChange} placeholder="Choose subject" />
        </Field>
      )} />
      <Controller control={form.control} name="exam_date" rules={{ required: "Required" }} render={({ field }) => (
        <Field label="Date" required error={errors.exam_date?.message}>
          <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
        </Field>
      )} />
      <div className="grid grid-cols-3 gap-4">
        <Field label="Starts" htmlFor="paper-start" required>
          <Input id="paper-start" type="time" {...form.register("start_time", { required: true })} />
        </Field>
        <Field label="Ends" htmlFor="paper-end" required>
          <Input id="paper-end" type="time" {...form.register("end_time", { required: true })} />
        </Field>
        <Field label="Room" htmlFor="paper-room">
          <Input id="paper-room" {...form.register("room")} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function ScheduleTable({ rows, loading, onEdit, onDelete, showClashes = true }: {
  rows: ExamPaper[]; loading?: boolean; onEdit?: (p: ExamPaper) => void; onDelete?: (p: ExamPaper) => void; showClashes?: boolean;
}) {  // prettier-ignore
  const editable = !!(onEdit && onDelete);
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Room</TableHead>
          {editable && <TableHead className="no-print w-24" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableState loading={loading} empty={!loading && rows.length === 0} colSpan={editable ? 5 : 4} emptyText="No papers scheduled yet" />
        {rows.map((p) => (
          <TableRow key={p.exam_schedule_id} className={cn(showClashes && p.clashes.length > 0 && "bg-destructive/5")}>
            <TableCell>{fmtDate(p.exam_date)}</TableCell>
            <TableCell className="tabular-nums">
              {p.start_time} – {p.end_time}
              {showClashes && p.clashes.length > 0 && (
                <Badge className="bg-destructive/10 text-destructive no-print ml-2 border-transparent">
                  <TriangleAlertIcon />
                  Overlaps
                </Badge>
              )}
            </TableCell>
            <TableCell className="font-medium">{p.subject ?? <Dash />}</TableCell>
            <TableCell>{p.room ?? <Dash />}</TableCell>
            {editable && (
              <TableCell className="no-print">
                <div className="flex justify-end gap-1">
                  <IconAction label="Edit" onClick={() => onEdit(p)}><PencilIcon /></IconAction>
                  <IconAction label="Delete" destructive onClick={() => onDelete(p)}><Trash2Icon /></IconAction>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AdmitCardView({ card }: { card: AdmitCard }) {
  const s = card.student;
  return (
    <div className="break-inside-avoid print:break-after-page">
      <PrintHeader title={`Admit card – ${card.exam.name}`} lines={[card.exam.year]} />
      <Card className="gap-4 print:border-0 print:shadow-none">
        <CardContent className="flex flex-wrap items-center gap-4">
          <Avatar className="size-20 rounded-md">
            {s.image_url && <AvatarImage src={s.image_url} alt="" />}
            <AvatarFallback className="rounded-md text-lg">{initials(s.name ?? "")}</AvatarFallback>
          </Avatar>
          <div className="grid gap-1 text-sm">
            <div className="text-base font-semibold">{s.name}</div>
            <div><span className="text-muted-foreground">Exam </span>{card.exam.name}</div>
            <div>
              <span className="text-muted-foreground">Class </span>{s.class_name ?? <Dash />}
              {s.section_name && <> / {s.section_name}</>}
              <span className="text-muted-foreground ml-4">Roll </span>{s.roll ?? <Dash />}
              {s.student_code && <><span className="text-muted-foreground ml-4">ID </span>{s.student_code}</>}
            </div>
          </div>
        </CardContent>
        <CardContent className="px-0">
          <ScheduleTable rows={card.schedule} showClashes={false} />
        </CardContent>
        <CardContent className="text-muted-foreground flex justify-between pt-8 text-xs">
          <span className="border-t px-6 pt-1">Student's signature</span>
          <span className="border-t px-6 pt-1">Principal's signature</span>
        </CardContent>
      </Card>
    </div>
  );  // prettier-ignore
}

export function ExamTimetablePage() {
  const user = useUser();
  const isAdmin = user.role === "admin";
  const staff = user.role === "admin" || user.role === "teacher";
  const { ownId, select } = useOwnStudent();
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null, examId: null });
  const [ownExam, setOwnExam] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExamPaper | "new" | null>(null);
  const [admitCards, setAdmitCards] = useState(false);

  const examId = staff ? sel.examId : ownExam;
  const papers = useGet<ExamPaper[]>(
    staff ? (sel.examId && sel.classId ? "/exam-schedule" : null) : ownExam && ownId ? `/exam-schedule/student/${ownId}` : null,
    staff ? { exam_id: sel.examId, class_id: sel.classId } : { exam_id: ownExam },
  );
  const cards = useGet<AdmitCard[]>(staff && admitCards && sel.examId && sel.classId ? "/admit-cards" : null, { exam_id: sel.examId, class_id: sel.classId, section_id: sel.sectionId || undefined });
  const ownCard = useGet<AdmitCard>(!staff && admitCards && ownExam && ownId ? `/admit-cards/student/${ownId}` : null, { exam_id: ownExam });
  const remove = useAction((id: number) => api.delete(`/exam-schedule/${id}`), { success: "Deleted", invalidate: [["/exam-schedule"]] });
  const rows = papers.data ?? [];
  const clashes = rows.filter((p) => p.clashes.length > 0).length;
  const ready = !!examId && (staff ? !!sel.classId : !!ownId);
  useEffect(() => setAdmitCards(false), [examId, sel.classId, sel.sectionId, ownId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam timetable"
        subtitle="Papers by date for each class, and admit cards to print."
        actions={
          <>
            {select}
            {ready && (
              <Button variant={admitCards ? "default" : "outline"} onClick={() => setAdmitCards(!admitCards)}>
                <IdCardIcon />
                {admitCards ? "Show timetable" : "Admit cards"}
              </Button>
            )}
            {ready && (
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon />
                Print
              </Button>
            )}
            {isAdmin && ready && !admitCards && (
              <Button onClick={() => setEditing("new")}>
                <PlusIcon />
                Add paper
              </Button>
            )}
          </>
        }
      />
      <Card className="no-print py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          {staff ? <ClassPicker value={sel} onChange={setSel} withExam withSection={admitCards} /> : <ExamSelect value={ownExam} onChange={setOwnExam} />}
        </CardContent>
      </Card>

      {!ready && (
        <EmptyState icon={CalendarClockIcon} title={staff ? "Choose an exam and a class" : "Choose an exam"}>
          The papers and their times appear here.
        </EmptyState>
      )}
      {ready && clashes > 0 && !admitCards && (
        <Alert variant="destructive" className="no-print">
          <TriangleAlertIcon />
          <AlertDescription>{clashes} papers overlap with another paper of this class on the same day.</AlertDescription>
        </Alert>
      )}
      {ready && !admitCards && (
        <>
          <PrintHeader title="Exam timetable" />
          <Card className="gap-0 overflow-hidden py-0 print:border-0 print:shadow-none">
            <ScheduleTable
              rows={rows}
              loading={papers.isLoading}
              onEdit={isAdmin ? setEditing : undefined}
              onDelete={isAdmin ? (p) => confirmAction({ title: `Delete the ${p.subject ?? ""} paper?`, onConfirm: () => remove.mutate(p.exam_schedule_id) }) : undefined}
            />
          </Card>
        </>
      )}
      {ready && admitCards && (
        <div className="space-y-6">
          {(cards.isLoading || ownCard.isLoading) && <Skeleton className="h-64 w-full" />}
          {staff && cards.data?.length === 0 && <EmptyState title="No students enrolled" />}
          {(staff ? cards.data ?? [] : ownCard.data ? [ownCard.data] : []).map((c) => (
            <AdmitCardView key={c.student.student_id} card={c} />
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add paper" : "Edit paper"}</DialogTitle>
          </DialogHeader>
          {editing !== null && sel.examId && sel.classId && (
            <PaperForm key={editing === "new" ? "new" : editing.exam_schedule_id} paper={editing === "new" ? null : editing} examId={sel.examId} classId={sel.classId} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- exam weights -----------------------------------------------------------------------

function WeightsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useGet<ExamWeights>(open ? "/exam-weights" : null);
  const [values, setValues] = useState<Record<number, string>>({});
  useEffect(() => setValues(Object.fromEntries((data?.exams ?? []).map((e) => [e.exam_id, e.weight == null ? "" : String(e.weight)]))), [data]);
  const total = Object.values(values).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const save = useAction(
    () => api.put("/exam-weights", { year: data!.year, weights: Object.entries(values).map(([id, w]) => ({ exam_id: Number(id), weight: w === "" ? null : Number(w) })) }),
    { success: "Exam weights saved", invalidate: [["/exam-weights"], ["/report-cards"]], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exam weights {data?.year}</DialogTitle>
          <DialogDescription>Share of each exam in the annual result. Leave empty to leave an exam out. Weights should add up to 100%.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(data?.exams ?? []).length === 0 && <p className="text-muted-foreground text-sm">No exams in this year.</p>}
          {(data?.exams ?? []).map((e) => (
            <div key={e.exam_id} className="flex items-center justify-between gap-3">
              <label htmlFor={`weight-${e.exam_id}`} className="text-sm font-medium">{e.name}</label>
              <div className="flex items-center gap-1">
                <Input id={`weight-${e.exam_id}`} type="number" min={0} max={100} step="any" className="w-24 text-right" value={values[e.exam_id] ?? ""} onChange={(ev) => setValues({ ...values, [e.exam_id]: ev.target.value })} />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </div>
          ))}
          <div className={cn("flex justify-between border-t pt-3 text-sm font-semibold", Math.abs(total - 100) > 0.01 && "text-destructive")}>
            <span>Total</span>
            <span className="tabular-nums">{total}%</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!data} onClick={() => save.mutate(undefined)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );  // prettier-ignore
}

// --- report cards -----------------------------------------------------------------------

const RESULT_STYLE: Record<string, string> = {
  Pass: "bg-success/15 text-success",
  Fail: "bg-destructive/10 text-destructive",
  Incomplete: "bg-muted text-muted-foreground",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function ReportCardView({ card, onRemark }: { card: ReportCard; onRemark?: () => void }) {
  const s = card.student;
  const annual = card.kind === "annual";
  const att = card.attendance;
  return (
    <div className="space-y-4 break-inside-avoid print:break-after-page">
      <PrintHeader title={annual ? `Annual report card ${card.year}` : `Report card – ${card.exam?.name ?? ""}`} lines={annual ? undefined : [card.year]} />
      <Card className="gap-4 print:border-0 print:shadow-none">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="text-base font-semibold">{s.name}</div>
          {s.student_code && <div><span className="text-muted-foreground">ID </span>{s.student_code}</div>}
          <div><span className="text-muted-foreground">Class </span>{s.class_name ?? <Dash />}{s.section_name && ` / ${s.section_name}`}</div>
          <div><span className="text-muted-foreground">Roll </span>{s.roll ?? <Dash />}</div>
          <Badge variant="secondary" className="no-print">{annual ? `Annual ${card.year}` : card.exam?.name}</Badge>
        </CardContent>
        <CardContent className="px-0">
          {annual ? (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Subject</TableHead>
                  {card.exams.map((e) => (
                    <TableHead key={e.exam_id} className="text-right">{e.name} <span className="text-muted-foreground font-normal">({e.weight}%)</span></TableHead>
                  ))}
                  <TableHead className="text-right">Weighted %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.subjects.map((sub) => (
                  <TableRow key={sub.subject_id}>
                    <TableCell className="font-medium">{sub.subject}</TableCell>
                    {card.exams.map((e) => (
                      <TableCell key={e.exam_id} className="text-right tabular-nums">{sub.marks?.[String(e.exam_id)] ?? <Dash />}</TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">{sub.weighted_percentage ?? <Dash />}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30">
                  <TableCell className="font-medium">Exam result</TableCell>
                  {card.exams.map((e) => (
                    <TableCell key={e.exam_id} className="text-right text-xs">
                      {e.percentage ?? "—"}% · GPA {e.gpa ?? "—"} · {e.result}
                    </TableCell>
                  ))}
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Full marks</TableHead>
                  <TableHead className="text-right">Obtained</TableHead>
                  <TableHead className="text-center">Grade</TableHead>
                  <TableHead className="text-right">Grade point</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.subjects.map((sub) => (
                  <TableRow key={sub.subject_id}>
                    <TableCell className="font-medium">{sub.subject}</TableCell>
                    <TableCell className="text-right tabular-nums">{sub.full_marks}</TableCell>
                    <TableCell className="text-right tabular-nums">{sub.mark_obtained ?? <Dash />}</TableCell>
                    <TableCell className={cn("text-center font-semibold", sub.grade_point === 0 && "text-destructive")}>{sub.grade ?? <Dash />}</TableCell>
                    <TableCell className="text-right tabular-nums">{sub.grade_point ?? <Dash />}</TableCell>
                    <TableCell className="text-muted-foreground">{sub.comment ?? ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{card.full_total}</TableCell>
                  <TableCell className="text-right tabular-nums">{card.total}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
        {card.warnings.length > 0 && (
          <CardContent>
            <Alert className="no-print">
              <TriangleAlertIcon />
              <AlertDescription>{card.warnings.join(" ")}</AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6 [print-color-adjust:exact] print:grid-cols-6">
          <Stat label="Result"><Badge className={cn("border-transparent", RESULT_STYLE[card.result])}>{card.result}</Badge></Stat>
          <Stat label={annual ? "CGPA" : "GPA"}>{card.gpa ?? "—"}</Stat>
          <Stat label="Percentage">{card.percentage == null ? (card.result === "Incomplete" ? "Incomplete" : "—") : `${card.percentage}%`}</Stat>
          <Stat label="Position in class">{card.position_class == null ? "—" : `${card.position_class} of ${card.class_size}`}</Stat>
          <Stat label="Position in section">{card.position_section == null ? "—" : `${card.position_section} of ${card.section_size}`}</Stat>
          <Stat label="Attendance">
            {att.percent == null ? "—" : `${att.percent}%`}
            <span className="text-muted-foreground ml-1 text-xs font-normal">{att.present}/{att.working_days} days</span>
          </Stat>
        </CardContent>
        <CardContent className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">Teacher's remark</span>
            {onRemark && (
              <Button size="xs" variant="ghost" className="no-print" onClick={onRemark}>
                <MessageSquareTextIcon />
                {card.remark ? "Edit remark" : "Add remark"}
              </Button>
            )}
          </div>
          <p className="mt-1 min-h-6 whitespace-pre-line">{card.remark ?? <span className="text-muted-foreground">—</span>}</p>
        </CardContent>
        <CardContent className="text-muted-foreground print-only">
          <div className="flex justify-between pt-10 text-xs">
            <span className="border-t px-6 pt-1">Class teacher</span>
            <span className="border-t px-6 pt-1">Guardian</span>
            <span className="border-t px-6 pt-1">Principal</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );  // prettier-ignore
}

function RemarkDialog({ card, onClose }: { card: ReportCard | null; onClose: () => void }) {
  const [text, setText] = useState("");
  useEffect(() => setText(card?.remark ?? ""), [card]);
  const save = useAction(
    () => api.put(`/report-cards/student/${card!.student.student_id}/remark`, { exam_id: card!.exam?.exam_id ?? null, year: card!.year, remark: text }),
    { success: "Remark saved", invalidate: [["/report-cards"], [`/report-cards/student/${card?.student.student_id}`]], onSuccess: onClose },
  );
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remark for {card?.student.name}</DialogTitle>
          <DialogDescription>{card?.kind === "annual" ? `Annual report ${card.year}` : card?.exam?.name}</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Remark" />
        {card && <AiRemarkDrafts key={`${card.student.student_id}-${card.exam?.exam_id ?? "annual"}`} studentId={card.student.student_id} examId={card.exam?.exam_id ?? null} year={card.year} onPick={setText} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );  // prettier-ignore
}

export function ReportCardsPage() {
  const user = useUser();
  const staff = user.role === "admin" || user.role === "teacher";
  const { ownId, select } = useOwnStudent();
  const [examId, setExamId] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [studentId, setStudentId] = useState<string | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [remarkFor, setRemarkFor] = useState<ReportCard | null>(null);
  const examParam = examId && examId !== ANNUAL ? examId : undefined;

  const students = useList<Student>(staff && sel.classId ? "/students" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000 });
  const bulk = useGet<ReportCard[]>(staff && examId && sel.classId && !studentId ? "/report-cards" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, exam_id: examParam });
  const oneId = staff ? studentId : ownId;
  const one = useGet<ReportCard>(examId && oneId ? `/report-cards/student/${oneId}` : null, { exam_id: examParam });
  const cards = oneId ? (one.data ? [one.data] : []) : bulk.data ?? [];
  const loading = one.isLoading || bulk.isLoading;
  const ready = !!examId && (staff ? !!sel.classId : !!ownId);

  return (
    <div className="space-y-6">
      <style>{"@media print { @page { size: A4 portrait; } }"}</style>
      <PageHeader
        title="Report cards"
        subtitle={staff ? "Results per exam or for the whole year, with positions, attendance and remarks. Print one or the whole section." : undefined}
        actions={
          <>
            {select}
            {user.role === "admin" && (
              <Button variant="outline" onClick={() => setWeightsOpen(true)}>
                <ScaleIcon />
                Exam weights
              </Button>
            )}
            {cards.length > 0 && (
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon />
                {cards.length > 1 ? `Print ${cards.length}` : "Print"}
              </Button>
            )}
          </>
        }
      />
      <Card className="no-print py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <ExamSelect value={examId} onChange={setExamId} withAnnual />
          {staff && <ClassPicker value={sel} onChange={(v) => { setSel(v); setStudentId(null); }} />}
          {staff && (
            <Field label="Single student (optional)" className="w-60">
              <Combobox clearable disabled={!sel.classId} placeholder="Everyone" data={toOptions(students.data?.items, "student_id", "name")} value={studentId} onChange={setStudentId} />
            </Field>
          )}
        </CardContent>
      </Card>

      {!ready && (
        <EmptyState icon={FileBadgeIcon} title={staff ? "Choose an exam and a class" : "Choose an exam"}>
          Pick "Annual" for the weighted result of the whole year.
        </EmptyState>
      )}
      {ready && loading && <Skeleton className="h-96 w-full" />}
      {ready && !loading && cards.length === 0 && <EmptyState title="No report cards" >Nobody is enrolled for this selection.</EmptyState>}
      <div className="space-y-8">
        {cards.map((c) => (
          <ReportCardView key={c.student.student_id} card={c} onRemark={staff ? () => setRemarkFor(c) : undefined} />
        ))}
      </div>

      <RemarkDialog card={remarkFor} onClose={() => setRemarkFor(null)} />
      <WeightsDialog open={weightsOpen} onClose={() => setWeightsOpen(false)} />
    </div>
  );
}
