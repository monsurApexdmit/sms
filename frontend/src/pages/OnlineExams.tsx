import dayjs from "dayjs";
import {
  ArrowLeftIcon,
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
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useAction, useClasses, useGet, useSections } from "../api/hooks";
import type { OnlineExam, Question } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { fromUnix } from "../utils";
import { useChildSelect } from "./Academic";
import { ExamForm } from "./online-exams/ExamForm";
import { QuestionAnswers, QuestionForm } from "./online-exams/QuestionForm";
import { IconLink, ResultBadge, StatusBadge, TYPE_LABEL, blankify, minutesBetween } from "./online-exams/shared";

export { AnswerScriptPage } from "./online-exams/AnswerScript";
export { TakeExamPage } from "./online-exams/TakeExam";

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
  const [question, setQuestion] = useState<Question | null | "new">(null);
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
            <Button variant="secondary" onClick={() => setQuestion("new")}>
              <PlusIcon />
              Add question
            </Button>
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
            <DialogTitle>{question === "new" ? "Add question" : "Edit question"}</DialogTitle>
          </DialogHeader>
          {question !== null && (
            <QuestionForm examId={exam.online_exam_id} question={question === "new" ? null : question} onDone={() => setQuestion(null)} />
          )}
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
