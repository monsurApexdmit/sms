import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, ClockIcon, PrinterIcon, XIcon } from "lucide-react";
import { type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { api, errorMessage } from "../../api/client";
import type { Question } from "../../api/types";
import { useUser } from "../../auth/AuthContext";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/states";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import { Skeleton } from "../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { cn } from "../../lib/utils";
import { ResultBadge, TYPE_LABEL, blankify } from "./shared";
import { t, tn } from "../../i18n";

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
          {t("Answered")}</Badge>
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
              <TableHead className="w-20">{t("Blank")}</TableHead>
              <TableHead>{t("Submitted")}</TableHead>
              <TableHead>{t("Correct")}</TableHead>
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
                      {given || t("Not answered")}
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
          { value: "true", label: t("True") },
          { value: "false", label: t("False") },
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
        {staff ? t("Back to exam") : t("Online exams")}
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
          <AlertTitle>{forbidden ? t("Answer script not available yet") : t("Could not load the answer script")}</AlertTitle>
          <AlertDescription>
            {forbidden
              ? t("{errorMessage}. Check back once the exam has ended and your answers have been submitted.", { errorMessage: errorMessage(error) })
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
          title={t("Answer script")}
          subtitle={t("{title} · {name}", { title: exam.title, name: student.name })}
          actions={
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon />
              {t("Print")}</Button>
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
              {t("Student:")}{" "}<span className="font-medium">{student.name}</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {tn("{correctCount} of {length} questions correct · pass mark {minimum_percentage}%", { correctCount, length: questions.length, minimum_percentage: exam.minimum_percentage })}</p>
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
                    {tn("Question {value} · {value2}", { value: i + 1, value2: TYPE_LABEL[q.type] })}
                  </span>
                  <span className="flex items-center gap-2">
                    {unanswered ? (
                      <Badge variant="secondary">{t("Not answered")}</Badge>
                    ) : q.is_correct ? (
                      <Badge className="bg-success/15 text-success border-transparent">{t("Correct")}</Badge>
                    ) : (
                      <Badge variant="destructive">{t("Incorrect")}</Badge>
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
        {questions.length === 0 && <EmptyState title={t("This exam has no questions")} />}
      </div>
    </div>
  );
}
