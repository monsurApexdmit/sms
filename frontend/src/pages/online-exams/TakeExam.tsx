import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, ClockIcon, SendIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, errorMessage } from "../../api/client";
import { useAction } from "../../api/hooks";
import type { OnlineExam, Question } from "../../api/types";
import { confirmAction } from "../../components/confirm";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Progress } from "../../components/ui/progress";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";
import { ResultBadge, blankify } from "./shared";
import { t as tr, tn } from "../../i18n";

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
        <AlertTitle>{tr("Cannot open exam")}</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/app/my-online-exams")}>
            <ArrowLeftIcon />
            {tr("Back")}</Button>
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
          <CardTitle className="text-xl">{tr("Exam submitted")}</CardTitle>
          <CardDescription>{tr("Your answers have been recorded.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-4xl font-bold tabular-nums">
            {result.obtained_mark} <span className="text-muted-foreground text-2xl font-medium">/ {result.total_mark}</span>
          </p>
          <ResultBadge result={result.result} className="px-3 py-1 text-sm" />
          <p className="text-muted-foreground text-sm">{tr("The full answer script becomes available once the exam closes.")}</p>
          <Button asChild className="w-full">
            <Link to="/app/my-online-exams">{tr("Back to exams")}</Link>
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
      title: tr("Submit exam?"),
      description:
        answered < total
          ? tr("You have answered {answered} of {total} questions. You cannot change answers after submitting.", { answered, total })
          : tr("You cannot change answers after submitting."),
      confirmLabel: tr("Submit"),
      cancelLabel: tr("Keep working"),
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
              {tn("{subject_name} · {total} questions · {total_mark} marks", { subject_name: paper.exam.subject_name, total, total_mark: paper.exam.total_mark })}</p>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
              urgent ? "border-destructive/40 bg-destructive/10 text-destructive animate-pulse" : "bg-muted",
            )}
            aria-label={tr("Time left")}
          >
            <ClockIcon className="size-4" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Progress value={total ? (answered / total) * 100 : 0} className="flex-1" />
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {tn("{answered}/{total} answered", { answered, total })}</span>
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
              aria-label={(isAnswered(q.question_bank_id) ? tr("Question {number} (answered)", { number: i + 1 }) : tr("Question {number}", { number: i + 1 }))}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {paper.exam.instruction && (
        <Alert className="mb-4">
          <CircleAlertIcon />
          <AlertTitle>{tr("Instructions")}</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{paper.exam.instruction}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {paper.questions.map((q, i) => (
          <Card key={q.question_bank_id} id={`q-${q.question_bank_id}`} className="scroll-mt-48 gap-4">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                <span>{tn("Question {value}", { value: i + 1 })}</span>
                <Badge variant="outline">{tn("{mark} marks", { mark: q.mark })}</Badge>
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
                      placeholder={tr("Blank {value}", { value: j + 1 })}
                      aria-label={tr("Blank {value}", { value: j + 1 })}
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
          {tn("{answered} of {total} questions answered", { answered, total })}</p>
        <Button size="lg" loading={submit.isPending} onClick={confirmSubmit}>
          <SendIcon />
          {tr("Submit exam")}</Button>
      </div>
    </div>
  );
}
