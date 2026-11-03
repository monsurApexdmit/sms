import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import dayjs from "dayjs";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  ClockIcon,
  EyeIcon,
  FileCheckIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PrinterIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, errorMessage } from "../api/client";
import { useAction, useClasses, useGet, useSections, useSubjects } from "../api/hooks";
import type { OnlineExam, Question, QuestionDraft } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { AiQuestionDrafts, useAiFeature } from "../components/Ai";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Progress } from "../components/ui/progress";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { fromUnix } from "../utils";
import { useChildSelect } from "./Academic";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-warning/20 text-warning-foreground border-transparent",
  published: "bg-success/15 text-success border-transparent",
  expired: "",
};
const TYPE_LABEL: Record<Question["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  fill_in_the_blanks: "Fill in the blanks",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "expired" ? "secondary" : "outline"} className={cn("capitalize", STATUS_CLASS[status])}>
      {status}
    </Badge>
  );
}

function ResultBadge({ result, className }: { result: string | null | undefined; className?: string }) {
  if (!result) return <Dash />;
  return result === "pass" ? (
    <Badge className={cn("bg-success/15 text-success border-transparent capitalize", className)}>{result}</Badge>
  ) : (
    <Badge variant="destructive" className={cn("capitalize", className)}>
      {result}
    </Badge>
  );
}

/** JSON list stored as text in question_bank (options / correct_answers). */
function parseList(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return raw ? [raw] : [];
  }
}

/** Legacy questions mark blanks with ^, new ones with ___. */
const blankify = (title: string) => title.replace(/\^/g, "________");

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

/** Icon-only link styled like IconAction. */
function IconLink({ label, to, children }: { label: string; to: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild size="icon-sm" variant="ghost">
          <Link to={to} aria-label={label}>
            {children}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// --- staff: exams ---------------------------------------------------------------

interface ExamValues {
  title: string;
  class_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  exam_date: string;
  time_start: string;
  time_end: string;
  minimum_percentage: string;
  instruction: string;
}

function ExamForm({ exam, onDone }: { exam: OnlineExam | null; onDone: () => void }) {
  const user = useUser();
  const form = useForm<ExamValues>({
    defaultValues: {
      title: exam?.title ?? "",
      class_id: exam ? String(exam.class_id) : null,
      section_id: exam ? String(exam.section_id) : null,
      subject_id: exam ? String(exam.subject_id) : null,
      exam_date: exam ? dayjs.unix(exam.exam_date).format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"),
      time_start: exam?.time_start ?? "09:00",
      time_end: exam?.time_end ?? "10:00",
      minimum_percentage: exam ? String(Number(exam.minimum_percentage)) : "40",
      instruction: exam?.instruction ?? "",
    },
  });
  const classId = form.watch("class_id");
  const classes = useClasses();
  const sections = useSections(classId || null);
  const subjects = useSubjects(classId || null);
  const subjectItems = (subjects.data?.items ?? []).filter((s) => user.role === "admin" || s.teacher_id === user.id);
  const save = useAction(
    (v: ExamValues) => {
      const body = {
        ...v,
        class_id: Number(v.class_id),
        section_id: Number(v.section_id),
        subject_id: Number(v.subject_id),
        exam_date: v.exam_date,
        minimum_percentage: Number(v.minimum_percentage),
        instruction: v.instruction || null,
      };
      return exam ? api.put(`/online-exams/${exam.online_exam_id}`, body) : api.post("/online-exams", body);
    },
    { success: "Exam saved", invalidate: [["/online-exams"], [`/online-exams/${exam?.online_exam_id}`]], onSuccess: onDone },
  );
  const required = { required: "Required" };
  const { errors } = form.formState;

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label="Title" htmlFor="exam-title" required error={errors.title?.message}>
        <Input id="exam-title" {...form.register("title", required)} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="class_id"
          rules={required}
          render={({ field, fieldState }) => (
            <Field label="Class" required error={fieldState.error?.message}>
              <Combobox
                data={(classes.data?.items ?? []).map((c) => ({ value: String(c.class_id), label: c.name }))}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  form.setValue("section_id", null);
                  form.setValue("subject_id", null);
                }}
                placeholder="Choose class"
                aria-invalid={!!fieldState.error}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="section_id"
          rules={required}
          render={({ field, fieldState }) => (
            <Field label="Section" required error={fieldState.error?.message}>
              <Combobox
                disabled={!classId}
                data={(sections.data?.items ?? []).map((s) => ({ value: String(s.section_id), label: s.name }))}
                value={field.value}
                onChange={field.onChange}
                placeholder="Choose section"
                aria-invalid={!!fieldState.error}
              />
            </Field>
          )}
        />
      </div>
      <Controller
        control={form.control}
        name="subject_id"
        rules={required}
        render={({ field, fieldState }) => (
          <Field label="Subject" required error={fieldState.error?.message}>
            <Combobox
              disabled={!classId}
              data={subjectItems.map((s) => ({ value: String(s.subject_id), label: s.name }))}
              value={field.value}
              onChange={field.onChange}
              placeholder="Choose subject"
              aria-invalid={!!fieldState.error}
            />
          </Field>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Controller
          control={form.control}
          name="exam_date"
          rules={required}
          render={({ field, fieldState }) => (
            <Field label="Date" required error={fieldState.error?.message}>
              <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
            </Field>
          )}
        />
        <Field label="Start" htmlFor="exam-start" required>
          <Input id="exam-start" type="time" {...form.register("time_start", required)} />
        </Field>
        <Field label="End" htmlFor="exam-end" required error={errors.time_end?.message}>
          <Input
            id="exam-end"
            type="time"
            aria-invalid={!!errors.time_end}
            {...form.register("time_end", { validate: (v, all) => (v > all.time_start ? true : "Must be after start time") })}
          />
        </Field>
      </div>
      <Field label="Pass mark (%)" htmlFor="exam-pass" className="sm:w-1/3">
        <Input id="exam-pass" type="number" min={0} max={100} {...form.register("minimum_percentage")} />
      </Field>
      <Field label="Instructions" htmlFor="exam-instruction">
        <Textarea id="exam-instruction" rows={3} {...form.register("instruction")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function OnlineExamsPage() {
  const { data, isLoading } = useGet<OnlineExam[]>("/online-exams");
  const classes = useClasses();
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState("all");
  const className = new Map((classes.data?.items ?? []).map((c) => [c.class_id, c.name]));
  const rows = (data ?? []).filter((e) => status === "all" || e.status === status);
  const changeStatus = useAction(({ id, status }: { id: number; status: string }) => api.put(`/online-exams/${id}/status`, { status }), {
    success: "Status updated",
    invalidate: [["/online-exams"]],
  });

  return (
    <>
      <PageHeader
        title="Online exams"
        subtitle="Create exams, add questions and publish them to students"
        actions={
          <Button onClick={() => setOpened(true)}>
            <PlusIcon />
            New exam
          </Button>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
            {["all", "pending", "published", "expired"].map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-3 capitalize">
                {s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-muted-foreground text-sm">{rows.length} exams</span>
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Questions</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={rows.length === 0} colSpan={8} emptyText="No online exams yet" />
            {rows.map((e) => (
              <TableRow key={e.online_exam_id}>
                <TableCell className="font-medium">
                  <Link to={`/app/online-exams/${e.online_exam_id}`} className="hover:underline">
                    {e.title}
                  </Link>
                </TableCell>
                <TableCell>{className.get(e.class_id) ?? <Dash />}</TableCell>
                <TableCell>{e.subject_name ?? <Dash />}</TableCell>
                <TableCell>{fromUnix(e.exam_date)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {e.time_start} – {e.time_end}
                </TableCell>
                <TableCell>
                  {e.question_count} <span className="text-muted-foreground">({e.total_mark} marks)</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={e.status} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <IconLink label="Open" to={`/app/online-exams/${e.online_exam_id}`}>
                      <EyeIcon />
                    </IconLink>
                    {e.status !== "published" ? (
                      <IconAction
                        label={e.question_count ? "Publish" : "Add questions before publishing"}
                        disabled={!e.question_count}
                        onClick={() => changeStatus.mutate({ id: e.online_exam_id, status: "published" })}
                      >
                        <SendIcon />
                      </IconAction>
                    ) : (
                      <IconAction label="Close exam" onClick={() => changeStatus.mutate({ id: e.online_exam_id, status: "expired" })}>
                        <XIcon />
                      </IconAction>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New online exam</DialogTitle>
          </DialogHeader>
          {opened && <ExamForm exam={null} onDone={() => setOpened(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Add or edit a question; `draft` (an AI-drafted question) prefills a new one. */
function QuestionForm({ examId, question, draft, onDone }: { examId: number; question: Question | null; draft?: QuestionDraft; onDone: () => void }) {
  const [type, setType] = useState<Question["type"]>(question?.type ?? draft?.type ?? "multiple_choice");
  const [title, setTitle] = useState(question?.question_title ?? draft?.question_title ?? "");
  const [mark, setMark] = useState(question ? String(Number(question.mark)) : draft ? String(draft.mark) : "1");
  const [options, setOptions] = useState<string[]>(
    question?.type === "multiple_choice" ? parseList(question.options) : draft?.type === "multiple_choice" ? draft.options : ["", "", "", ""],
  );
  const [correct, setCorrect] = useState<string[]>(
    question?.type === "multiple_choice" ? parseList(question.correct_answers) : draft?.type === "multiple_choice" ? draft.correct_answers : [],
  );
  const [truth, setTruth] = useState(
    question?.type === "true_false" ? (question.correct_answers ?? "true") : draft?.type === "true_false" ? (draft.correct_answers[0] ?? "true") : "true",
  );
  const [words, setWords] = useState(
    question?.type === "fill_in_the_blanks" ? parseList(question.correct_answers).join(", ") : draft?.type === "fill_in_the_blanks" ? draft.correct_answers.join(", ") : "",
  );
  const save = useAction(
    () => {
      const correct_answers =
        type === "multiple_choice" ? correct : type === "true_false" ? [truth] : words.split(",").map((w) => w.trim()).filter(Boolean);
      const body = { type, question_title: title, mark: Number(mark), options: type === "multiple_choice" ? options : [], correct_answers };
      return question ? api.put(`/online-exams/questions/${question.question_bank_id}`, body) : api.post(`/online-exams/${examId}/questions`, body);
    },
    { success: "Question saved", invalidate: [[`/online-exams/${examId}`]], onSuccess: onDone },
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Type">
          <Combobox
            disabled={!!question}
            data={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            value={type}
            onChange={(v) => v && setType(v as Question["type"])}
          />
        </Field>
        <Field label="Marks" htmlFor="q-mark">
          <Input id="q-mark" type="number" min={0.5} step={0.5} value={mark} onChange={(e) => setMark(e.target.value)} />
        </Field>
      </div>
      <Field label="Question" htmlFor="q-title" description={type === "fill_in_the_blanks" ? "Write ___ where each blank goes" : undefined}>
        <Textarea id="q-title" rows={3} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {type === "multiple_choice" && (
        <div className="grid gap-2">
          <Label>Options (tick the correct ones)</Label>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                aria-label={`Option ${i + 1} is correct`}
                checked={correct.includes(String(i + 1))}
                onCheckedChange={(c) => setCorrect(c === true ? [...correct, String(i + 1)] : correct.filter((x) => x !== String(i + 1)))}
              />
              <Input
                className="flex-1"
                placeholder={`Option ${i + 1}`}
                value={o}
                onChange={(e) => {
                  const v = e.target.value;
                  setOptions((all) => all.map((x, j) => (j === i ? v : x)));
                }}
              />
              <IconAction
                label="Remove option"
                destructive
                disabled={options.length <= 2}
                onClick={() => {
                  setOptions((all) => all.filter((_, j) => j !== i));
                  setCorrect([]);
                }}
              >
                <Trash2Icon />
              </IconAction>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setOptions((all) => [...all, ""])}>
            <PlusIcon />
            Add option
          </Button>
        </div>
      )}
      {type === "true_false" && (
        <Field label="Correct answer">
          <RadioGroup value={truth} onValueChange={setTruth} className="flex gap-6">
            {["true", "false"].map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem id={`truth-${v}`} value={v} />
                <Label htmlFor={`truth-${v}`} className="font-normal capitalize">
                  {v}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </Field>
      )}
      {type === "fill_in_the_blanks" && (
        <Field label="Correct words, in order" htmlFor="q-words" description="Comma separated; matching ignores case">
          <Input id="q-words" value={words} onChange={(e) => setWords(e.target.value)} />
        </Field>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save question
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Option rows of a staff question card / print sheet with the correct ones ticked. */
function QuestionAnswers({ q, showAnswers }: { q: Question; showAnswers: boolean }) {
  const correct = parseList(q.correct_answers);
  if (q.type === "fill_in_the_blanks")
    return showAnswers ? (
      <p className="text-sm">
        <span className="text-muted-foreground">Answers: </span>
        <span className="font-medium">{correct.join(", ") || "—"}</span>
      </p>
    ) : null;
  const options =
    q.type === "true_false"
      ? [
          { value: "true", label: "True" },
          { value: "false", label: "False" },
        ]
      : parseList(q.options).map((label, i) => ({ value: String(i + 1), label }));
  const truth = q.type === "true_false" ? [q.correct_answers ?? ""] : correct;
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {options.map((o, i) => {
        const ok = showAnswers && truth.includes(o.value);
        return (
          <li key={o.value} className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-sm", ok && "bg-success/10 text-success font-medium")}>
            <span className="text-muted-foreground w-5 shrink-0">{String.fromCharCode(65 + i)}.</span>
            <span className="flex-1">{o.label}</span>
            {ok && <CheckIcon className="size-4" />}
          </li>
        );
      })}
    </ul>
  );
}

interface StaffResultRow {
  student_id: number;
  student_name: string;
  obtained_mark: string;
  result: string;
  status: string;
}

export function OnlineExamDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useGet<{ exam: OnlineExam; questions: Question[] }>(`/online-exams/${id}`);
  const results = useGet<StaffResultRow[]>(`/online-exams/${id}/results`);
  const classes = useClasses();
  const sections = useSections(data?.exam.class_id);
  const [editExam, setEditExam] = useState(false);
  const [question, setQuestion] = useState<Question | null | "new" | { draft: QuestionDraft }>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const ai = useAiFeature("questions");
  const [printAnswers, setPrintAnswers] = useState(true);
  const setStatus = useAction((status: string) => api.put(`/online-exams/${id}/status`, { status }), {
    success: "Status updated",
    invalidate: [[`/online-exams/${id}`], ["/online-exams"]],
  });
  const delQ = useAction((qid: number) => api.delete(`/online-exams/questions/${qid}`), { invalidate: [[`/online-exams/${id}`]] });
  const delExam = useAction(() => api.delete(`/online-exams/${id}`), {
    success: "Exam deleted",
    invalidate: [["/online-exams"]],
    onSuccess: () => navigate("/app/online-exams"),
  });

  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  const { exam, questions } = data;
  const submitted = results.data?.filter((r) => r.status === "submitted") ?? [];
  const passed = submitted.filter((r) => r.result === "pass").length;
  const className = classes.data?.items.find((c) => c.class_id === exam.class_id)?.name;
  const sectionName = sections.data?.items.find((s) => s.section_id === exam.section_id)?.name;
  const minutes = minutesBetween(exam.time_start, exam.time_end);

  const print = (withAnswers: boolean) => {
    flushSync(() => setPrintAnswers(withAnswers));
    window.print();
  };

  return (
    <>
      <div className="no-print">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link to="/app/online-exams">
            <ArrowLeftIcon />
            All exams
          </Link>
        </Button>
        <PageHeader
          title={exam.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={exam.status} />
              {[className, sectionName && `Section ${sectionName}`, exam.subject_name].filter(Boolean).join(" · ")}
            </span>
          }
          actions={
            <>
              {exam.status !== "published" && (
                <Button onClick={() => setStatus.mutate("published")} loading={setStatus.isPending}>
                  <SendIcon />
                  Publish
                </Button>
              )}
              {exam.status === "published" && (
                <Button variant="outline" onClick={() => setStatus.mutate("expired")} loading={setStatus.isPending}>
                  <XIcon />
                  Close exam
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditExam(true)}>
                <PencilIcon />
                Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={!questions.length}>
                    <PrinterIcon />
                    Print questions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => print(true)}>With answers</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => print(false)}>Question paper only</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => confirmAction({ title: "Delete exam with all questions and results?", onConfirm: () => delExam.mutate(undefined) })}
              >
                <Trash2Icon />
                Delete
              </Button>
            </>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Schedule" value={fromUnix(exam.exam_date)} hint={`${exam.time_start} – ${exam.time_end} (${minutes} min)`} />
          <Stat label="Questions" value={String(questions.length)} hint={`${exam.total_mark} marks in total`} />
          <Stat label="Pass mark" value={`${Number(exam.minimum_percentage)}%`} hint={`${((exam.total_mark * Number(exam.minimum_percentage)) / 100).toFixed(1)} marks`} />
          <Stat label="Submitted" value={String(submitted.length)} hint={submitted.length ? `${passed} passed` : "No submissions yet"} />
        </div>

        <Tabs defaultValue="questions" className="gap-4">
          <TabsList>
            <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>
            <TabsTrigger value="results">Results ({submitted.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="questions" className="space-y-3">
            {exam.instruction && (
              <Alert>
                <CircleAlertIcon />
                <AlertTitle>Instructions</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap">{exam.instruction}</AlertDescription>
              </Alert>
            )}
            {questions.length === 0 && (
              <EmptyState icon={ClipboardListIcon} title="No questions yet">
                Add at least one question before publishing the exam.
              </EmptyState>
            )}
            {questions.map((q, i) => (
              <Card key={q.question_bank_id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="leading-snug">
                    {i + 1}. {blankify(q.question_title)}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="secondary">{TYPE_LABEL[q.type]}</Badge>
                    <Badge variant="outline">{Number(q.mark)} marks</Badge>
                  </CardDescription>
                  <CardAction className="flex gap-1">
                    <IconAction label="Edit question" onClick={() => setQuestion(q)}>
                      <PencilIcon />
                    </IconAction>
                    <IconAction
                      label="Delete question"
                      destructive
                      onClick={() => confirmAction({ title: "Delete this question?", onConfirm: () => delQ.mutate(q.question_bank_id) })}
                    >
                      <Trash2Icon />
                    </IconAction>
                  </CardAction>
                </CardHeader>
                <CardContent className="px-4">
                  <QuestionAnswers q={q} showAnswers />
                </CardContent>
              </Card>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setQuestion("new")}>
                <PlusIcon />
                Add question
              </Button>
              {ai.available && (
                <Button variant="outline" onClick={() => setAiOpen(true)}>
                  <SparklesIcon />
                  Draft with AI
                </Button>
              )}
            </div>
          </TabsContent>
          <TabsContent value="results">
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Marks</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState loading={results.isLoading} empty={results.data?.length === 0} colSpan={5} emptyText="Nobody has taken this exam yet" />
                  {results.data?.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.student_name}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "submitted" ? "secondary" : "outline"} className="capitalize">
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.obtained_mark ?? "—"} / {exam.total_mark}
                      </TableCell>
                      <TableCell>
                        <ResultBadge result={r.result} />
                      </TableCell>
                      <TableCell>
                        {r.status === "submitted" && (
                          <div className="flex justify-end">
                            <IconLink label="View script" to={`/app/online-exams/${exam.online_exam_id}/script?student_id=${r.student_id}`}>
                              <FileCheckIcon />
                            </IconLink>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* printable question set (CI online_exam_questions_print_view) */}
      <div className="print-only text-black">
        <div className="mb-6 border-b pb-4 text-center">
          <h1 className="text-xl font-bold">{exam.title}</h1>
          <p className="text-sm">
            Class: {className ?? "—"}
            {sectionName && ` | Section: ${sectionName}`} | Subject: {exam.subject_name ?? "—"}
          </p>
          <p className="text-sm">
            Total marks: {exam.total_mark} | Time: {minutes} minutes | Pass mark: {Number(exam.minimum_percentage)}%
          </p>
          {exam.instruction && <p className="mt-2 text-sm italic">Instructions: {exam.instruction}</p>}
        </div>
        <ol className="space-y-5">
          {questions.map((q, i) => (
            <li key={q.question_bank_id} className="break-inside-avoid">
              <div className="flex justify-between gap-4 font-medium">
                <span>
                  {i + 1}. {blankify(q.question_title)}
                </span>
                <span className="shrink-0 text-sm">[{Number(q.mark)}]</span>
              </div>
              <div className="mt-1 pl-4">
                <QuestionAnswers q={q} showAnswers={printAnswers} />
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Dialog open={editExam} onOpenChange={setEditExam}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit exam</DialogTitle>
          </DialogHeader>
          {editExam && <ExamForm exam={exam} onDone={() => setEditExam(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={question !== null} onOpenChange={(o) => !o && setQuestion(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{question === "new" || (question && "draft" in question) ? "Add question" : "Edit question"}</DialogTitle>
          </DialogHeader>
          {question !== null && (
            <QuestionForm
              examId={exam.online_exam_id}
              question={question === "new" || "draft" in question ? null : question}
              draft={question !== "new" && "draft" in question ? question.draft : undefined}
              onDone={() => setQuestion(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Draft questions with AI</DialogTitle>
          </DialogHeader>
          {/* stays mounted while a draft is reviewed so the remaining drafts are kept */}
          <AiQuestionDrafts examId={exam.online_exam_id} onReview={(draft) => setQuestion({ draft })} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// --- student side -------------------------------------------------------------

interface ResultRow {
  exam: OnlineExam;
  obtained_mark: number;
  result: string;
}

export function MyOnlineExamsPage() {
  const user = useUser();
  const { childId, select } = useChildSelect();
  const available = useGet<OnlineExam[]>(user.role === "student" ? "/online-exams/available" : null);
  const results = useGet<ResultRow[]>(user.role === "student" || childId ? "/online-exams/results/mine" : null, { student_id: childId || undefined });
  const now = dayjs();
  const scriptQuery = user.role === "parent" && childId ? `?student_id=${childId}` : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Online exams" actions={select} />
      {user.role === "student" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Available exams</h2>
          {available.isLoading && <Skeleton className="h-20 w-full" />}
          {available.data?.length === 0 && <EmptyState icon={ClipboardListIcon} title="No exams published for your class" />}
          <div className="grid gap-3 md:grid-cols-2">
            {available.data?.map((e) => {
              const start = dayjs.unix(e.exam_date).hour(Number(e.time_start.slice(0, 2))).minute(Number(e.time_start.slice(3, 5)));
              const end = dayjs.unix(e.exam_date).hour(Number(e.time_end.slice(0, 2))).minute(Number(e.time_end.slice(3, 5)));
              const open = now.isAfter(start) && now.isBefore(end) && e.my_status !== "submitted";
              return (
                <Card key={e.online_exam_id} className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle>{e.title}</CardTitle>
                    <CardDescription>{e.subject_name}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-end justify-between gap-3 px-4">
                    <div className="text-muted-foreground space-y-0.5 text-sm">
                      <p className="flex items-center gap-1.5">
                        <ClockIcon className="size-3.5" />
                        {fromUnix(e.exam_date)} · {e.time_start}–{e.time_end}
                      </p>
                      <p>
                        {e.question_count} questions · pass {Number(e.minimum_percentage)}%
                      </p>
                    </div>
                    {e.my_status === "submitted" ? (
                      <Badge className="bg-success/15 text-success border-transparent">Submitted</Badge>
                    ) : open ? (
                      <Button asChild size="sm">
                        <Link to={`/app/take-exam/${e.online_exam_id}`}>
                          <PlayIcon />
                          {e.my_status === "attended" ? "Continue" : "Start"}
                        </Link>
                      </Button>
                    ) : (
                      <Badge variant="secondary">{now.isBefore(start) ? "Not started" : "Closed"}</Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Results</h2>
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Marks</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState loading={results.isLoading} empty={results.data?.length === 0} colSpan={6} emptyText="No results yet" />
              {results.data?.map((r) => (
                <TableRow key={r.exam.online_exam_id}>
                  <TableCell className="font-medium">{r.exam.title}</TableCell>
                  <TableCell>{r.exam.subject_name}</TableCell>
                  <TableCell>{fromUnix(r.exam.exam_date)}</TableCell>
                  <TableCell>
                    {r.obtained_mark} / {r.exam.total_mark}
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={r.result} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/app/my-online-exams/${r.exam.online_exam_id}/script${scriptQuery}`}>
                        <EyeIcon />
                        View answers
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

interface ExamPaper {
  exam: OnlineExam;
  ends_at: number;
  server_time: number;
  questions: { question_bank_id: number; type: Question["type"]; question_title: string; mark: number; options: string[]; blanks: number }[];
}

export function TakeExamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<{ obtained_mark: number; total_mark: number; result: string } | null>(null);

  useEffect(() => {
    api.post<ExamPaper>(`/online-exams/${id}/start`).then((r) => setPaper(r.data)).catch((e) => setError(errorMessage(e)));
  }, [id]);

  // Clock offset so a wrong device clock cannot extend the exam.
  const offset = useMemo(() => (paper ? paper.server_time - Math.floor(Date.now() / 1000) : 0), [paper]);
  const submit = useAction(
    async () =>
      (await api.post(`/online-exams/${id}/submit`, { answers: Object.entries(answers).map(([qid, answer]) => ({ question_bank_id: Number(qid), answer })) })).data,
    { onSuccess: (r) => setResult(r as typeof result) },
  );
  useEffect(() => {
    if (!paper || result) return;
    const tick = () => {
      const remaining = paper.ends_at - (Math.floor(Date.now() / 1000) + offset);
      setLeft(remaining);
      if (remaining <= 0 && !submit.isPending) submit.mutate(undefined);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [paper, offset, result]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error)
    return (
      <Alert variant="destructive" className="max-w-xl">
        <CircleAlertIcon />
        <AlertTitle>Cannot open exam</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/app/my-online-exams")}>
            <ArrowLeftIcon />
            Back
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (result)
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardHeader>
          <div className="bg-success/15 text-success mx-auto mb-2 flex size-12 items-center justify-center rounded-full">
            <CheckIcon className="size-6" />
          </div>
          <CardTitle className="text-xl">Exam submitted</CardTitle>
          <CardDescription>Your answers have been recorded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-4xl font-bold tabular-nums">
            {result.obtained_mark} <span className="text-muted-foreground text-2xl font-medium">/ {result.total_mark}</span>
          </p>
          <ResultBadge result={result.result} className="px-3 py-1 text-sm" />
          <p className="text-muted-foreground text-sm">The full answer script becomes available once the exam closes.</p>
          <Button asChild className="w-full">
            <Link to="/app/my-online-exams">Back to exams</Link>
          </Button>
        </CardContent>
      </Card>
    );
  if (!paper)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );

  const set = (qid: number, value: string[]) => setAnswers((a) => ({ ...a, [qid]: value }));
  const isAnswered = (qid: number) => (answers[qid] ?? []).some((v) => v.trim() !== "");
  const answered = paper.questions.filter((q) => isAnswered(q.question_bank_id)).length;
  const total = paper.questions.length;
  const secs = Math.max(0, left);
  const urgent = left < 120;
  const confirmSubmit = () =>
    confirmAction({
      title: "Submit exam?",
      description:
        answered < total
          ? `You have answered ${answered} of ${total} questions. You cannot change answers after submitting.`
          : "You cannot change answers after submitting.",
      confirmLabel: "Submit",
      cancelLabel: "Keep working",
      destructive: false,
      onConfirm: () => submit.mutate(undefined),
    });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="bg-background/95 sticky top-14 z-[5] -mx-4 mb-6 border-b px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{paper.exam.title}</h1>
            <p className="text-muted-foreground truncate text-xs">
              {paper.exam.subject_name} · {total} questions · {paper.exam.total_mark} marks
            </p>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
              urgent ? "border-destructive/40 bg-destructive/10 text-destructive animate-pulse" : "bg-muted",
            )}
            aria-label="Time left"
          >
            <ClockIcon className="size-4" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Progress value={total ? (answered / total) * 100 : 0} className="flex-1" />
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {answered}/{total} answered
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {paper.questions.map((q, i) => (
            <button
              key={q.question_bank_id}
              type="button"
              onClick={() => document.getElementById(`q-${q.question_bank_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className={cn(
                "size-7 rounded-md border text-xs font-medium transition-colors",
                isAnswered(q.question_bank_id) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
              aria-label={`Question ${i + 1}${isAnswered(q.question_bank_id) ? " (answered)" : ""}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {paper.exam.instruction && (
        <Alert className="mb-4">
          <CircleAlertIcon />
          <AlertTitle>Instructions</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{paper.exam.instruction}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {paper.questions.map((q, i) => (
          <Card key={q.question_bank_id} id={`q-${q.question_bank_id}`} className="scroll-mt-48 gap-4">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>Question {i + 1}</span>
                <Badge variant="outline">{q.mark} marks</Badge>
              </CardDescription>
              <CardTitle className="leading-snug">{blankify(q.question_title)}</CardTitle>
            </CardHeader>
            <CardContent>
              {q.type === "multiple_choice" && (
                <div className="grid gap-2">
                  {q.options.map((o, j) => {
                    const value = String(j + 1);
                    const current = answers[q.question_bank_id] ?? [];
                    const checked = current.includes(value);
                    const optId = `q${q.question_bank_id}-o${j}`;
                    return (
                      <Label
                        key={j}
                        htmlFor={optId}
                        className={cn("flex items-center gap-3 rounded-md border p-3 font-normal", checked && "border-primary bg-primary/5")}
                      >
                        <Checkbox
                          id={optId}
                          checked={checked}
                          onCheckedChange={(c) => set(q.question_bank_id, c === true ? [...current, value] : current.filter((v) => v !== value))}
                        />
                        {o}
                      </Label>
                    );
                  })}
                </div>
              )}
              {q.type === "true_false" && (
                <RadioGroup
                  value={answers[q.question_bank_id]?.[0] ?? ""}
                  onValueChange={(v) => set(q.question_bank_id, [v])}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {["true", "false"].map((v) => {
                    const optId = `q${q.question_bank_id}-${v}`;
                    return (
                      <Label
                        key={v}
                        htmlFor={optId}
                        className={cn(
                          "flex items-center gap-3 rounded-md border p-3 font-normal capitalize",
                          answers[q.question_bank_id]?.[0] === v && "border-primary bg-primary/5",
                        )}
                      >
                        <RadioGroupItem id={optId} value={v} />
                        {v}
                      </Label>
                    );
                  })}
                </RadioGroup>
              )}
              {q.type === "fill_in_the_blanks" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: q.blanks }, (_, j) => (
                    <Input
                      key={j}
                      placeholder={`Blank ${j + 1}`}
                      aria-label={`Blank ${j + 1}`}
                      value={answers[q.question_bank_id]?.[j] ?? ""}
                      onChange={(e) => {
                        const next = [...(answers[q.question_bank_id] ?? Array(q.blanks).fill(""))];
                        next[j] = e.target.value;
                        set(q.question_bank_id, next);
                      }}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-muted-foreground text-sm">
          {answered} of {total} questions answered
        </p>
        <Button size="lg" loading={submit.isPending} onClick={confirmSubmit}>
          <SendIcon />
          Submit exam
        </Button>
      </div>
    </div>
  );
}

// --- answer script ------------------------------------------------------------

interface AnswerScript {
  exam: { online_exam_id: number; title: string; class_name: string | null; subject_name: string | null; total_marks: number; minimum_percentage: number };
  student: { student_id: number; name: string };
  obtained_mark: number;
  result: "pass" | "fail";
  questions: {
    question_bank_id: number;
    type: Question["type"];
    question_title: string;
    mark: number;
    options: string[];
    correct_answers: string[];
    submitted_answers: string[];
    is_correct: boolean;
  }[];
}
type ScriptQuestion = AnswerScript["questions"][number];

const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase();

function OptionRow({ index, label, correct, chosen }: { index: string; label: ReactNode; correct: boolean; chosen: boolean }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 text-sm",
        correct && "border-success/40 bg-success/10",
        chosen && !correct && "border-destructive/40 bg-destructive/10",
      )}
    >
      <span className="text-muted-foreground w-5 shrink-0 font-medium">{index}</span>
      <span className="flex-1">{label}</span>
      {chosen && (
        <Badge variant="outline" className={cn("bg-background", correct ? "text-success" : "text-destructive")}>
          Answered
        </Badge>
      )}
      {correct ? <CheckIcon className="text-success size-4 shrink-0" /> : chosen ? <XIcon className="text-destructive size-4 shrink-0" /> : null}
    </li>
  );
}

function ScriptAnswer({ q }: { q: ScriptQuestion }) {
  if (q.type === "fill_in_the_blanks") {
    const count = Math.max(q.correct_answers.length, q.submitted_answers.length);
    return (
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-20">Blank</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Correct</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: count }, (_, i) => {
              const given = q.submitted_answers[i];
              const ok = !!given && norm(given) === norm(q.correct_answers[i]);
              return (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className={cn("font-medium", given ? (ok ? "text-success" : "text-destructive") : "text-muted-foreground")}>
                    <span className="inline-flex items-center gap-1.5">
                      {given ? (ok ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />) : null}
                      {given || "Not answered"}
                    </span>
                  </TableCell>
                  <TableCell className="text-success">{q.correct_answers[i] ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }
  const options =
    q.type === "true_false"
      ? [
          { value: "true", label: "True" },
          { value: "false", label: "False" },
        ]
      : q.options.map((label, i) => ({ value: String(i + 1), label }));
  const correct = q.correct_answers.map(norm);
  const chosen = q.submitted_answers.map(norm);
  return (
    <ul className="grid gap-2">
      {options.map((o, i) => (
        <OptionRow key={o.value} index={`${String.fromCharCode(65 + i)}.`} label={o.label} correct={correct.includes(o.value)} chosen={chosen.includes(o.value)} />
      ))}
    </ul>
  );
}

export function AnswerScriptPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const user = useUser();
  const staff = user.role === "admin" || user.role === "teacher";
  const studentId = search.get("student_id");
  const path = `/online-exams/${id}/answer-script`;
  const params = { student_id: studentId || undefined };
  const { data, error, isLoading } = useQuery({
    queryKey: [path, params],
    queryFn: async () => (await api.get<AnswerScript>(path, { params })).data,
    retry: (count, err) => !(axios.isAxiosError(err) && err.response?.status === 403) && count < 1,
  });
  const back = staff ? `/app/online-exams/${id}` : "/app/my-online-exams";
  const forbidden = axios.isAxiosError(error) && error.response?.status === 403;

  const backButton = (
    <Button asChild variant="ghost" size="sm" className="no-print mb-3 -ml-2">
      <Link to={back}>
        <ArrowLeftIcon />
        {staff ? "Back to exam" : "Online exams"}
      </Link>
    </Button>
  );

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (error || !data)
    return (
      <>
        {backButton}
        <Alert variant={forbidden ? "default" : "destructive"} className="max-w-xl">
          {forbidden ? <ClockIcon /> : <CircleAlertIcon />}
          <AlertTitle>{forbidden ? "Answer script not available yet" : "Could not load the answer script"}</AlertTitle>
          <AlertDescription>
            {forbidden
              ? `${errorMessage(error)}. Check back once the exam has ended and your answers have been submitted.`
              : errorMessage(error)}
          </AlertDescription>
        </Alert>
      </>
    );

  const { exam, student, questions } = data;
  const pct = exam.total_marks ? (data.obtained_mark / exam.total_marks) * 100 : 0;
  const correctCount = questions.filter((q) => q.is_correct).length;

  return (
    <div className="space-y-6">
      <div>
        {backButton}
        <PageHeader
          title="Answer script"
          subtitle={`${exam.title} · ${student.name}`}
          actions={
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon />
              Print
            </Button>
          }
        />
      </div>

      <Card>
        <CardContent className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-1">
            <p className="text-lg font-semibold">{exam.title}</p>
            <p className="text-muted-foreground text-sm">
              {[exam.class_name, exam.subject_name].filter(Boolean).join(" · ")}
            </p>
            <p className="text-sm">
              Student: <span className="font-medium">{student.name}</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {correctCount} of {questions.length} questions correct · pass mark {exam.minimum_percentage}%
            </p>
          </div>
          <div className="flex items-center gap-4 md:flex-col md:items-end">
            <p className="text-3xl font-bold tabular-nums">
              {data.obtained_mark}
              <span className="text-muted-foreground text-xl font-medium"> / {exam.total_marks}</span>
            </p>
            <ResultBadge result={data.result} className="px-3 py-1 text-sm" />
          </div>
          <div className="md:col-span-2">
            <Progress value={pct} className={cn(data.result === "pass" ? "*:data-[slot=progress-indicator]:bg-success" : "*:data-[slot=progress-indicator]:bg-destructive")} />
            <p className="text-muted-foreground mt-1 text-xs">{pct.toFixed(1)}%</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {questions.map((q, i) => {
          const unanswered = !q.submitted_answers.some((a) => a.trim() !== "");
          return (
            <Card key={q.question_bank_id} className="break-inside-avoid gap-4">
              <CardHeader>
                <CardDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Question {i + 1} · {TYPE_LABEL[q.type]}
                  </span>
                  <span className="flex items-center gap-2">
                    {unanswered ? (
                      <Badge variant="secondary">Not answered</Badge>
                    ) : q.is_correct ? (
                      <Badge className="bg-success/15 text-success border-transparent">Correct</Badge>
                    ) : (
                      <Badge variant="destructive">Incorrect</Badge>
                    )}
                    <Badge variant="outline" className="tabular-nums">
                      {q.is_correct ? q.mark : 0} / {q.mark}
                    </Badge>
                  </span>
                </CardDescription>
                <CardTitle className="leading-snug">{blankify(q.question_title)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ScriptAnswer q={q} />
              </CardContent>
            </Card>
          );
        })}
        {questions.length === 0 && <EmptyState title="This exam has no questions" />}
      </div>
    </div>
  );
}

