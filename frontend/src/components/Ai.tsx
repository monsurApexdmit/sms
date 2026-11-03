import dayjs from "dayjs";
import { CheckIcon, SaveIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import { useAction, useGet } from "../api/hooks";
import type { AiFeature, AiSettings, AiStatus, AiUsageRow, ProgressSummary, Question, QuestionDraft } from "../api/types";
import { cn } from "../lib/utils";
import { Combobox } from "./combobox";
import { Field } from "./field";
import { TableState } from "./states";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Textarea } from "./ui/textarea";

const MASK = "********";
const FEATURE_LABEL: Record<AiFeature, string> = {
  report_remark: "Report-card remarks",
  questions: "Exam questions",
  progress_summary: "Progress summaries",
};

/** Whether the signed-in user can use an AI feature (all are off until an admin sets the assistant up). */
export function useAiFeature(feature: AiFeature) {
  const { data } = useGet<AiStatus>("/ai/status");
  return { available: !!data?.features.includes(feature), label: data?.label ?? "AI-generated, may contain mistakes" };
}

export function AiLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-1 text-xs", className)}>
      <SparklesIcon className="size-3" />
      {text}
    </span>
  );
}

// --- report-card remarks ------------------------------------------------------------------

const TONES = [
  { value: "encouraging", label: "Encouraging" },
  { value: "formal", label: "Formal" },
  { value: "brief", label: "Brief" },
];

/** Drafts remark options; picking one only fills the remark box (the teacher still saves it). */
export function AiRemarkDrafts({ studentId, examId, year, onPick }: { studentId: number; examId: number | null; year: string; onPick: (text: string) => void }) {
  const { available, label } = useAiFeature("report_remark");
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState("encouraging");
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const draft = useAction(
    async () => (await api.post<{ options: string[] }>("/ai/report-remark", { student_id: studentId, exam_id: examId, year, tone, notes: notes.trim() || null })).data,
    { onSuccess: (r) => setOptions(r.options) },
  );
  if (!available) return null;
  if (!open)
    return (
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <SparklesIcon />
        Draft with AI
      </Button>
    );
  return (
    <div className="bg-muted/30 grid gap-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Tone">
          <Combobox data={TONES} value={tone} onChange={(v) => setTone(v ?? "encouraging")} />
        </Field>
        <Field label="Your notes (optional)" htmlFor="ai-notes" description="Shared with the AI service. Don't include names or private details.">
          <Input id="ai-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. helps classmates, needs to read more" />
        </Field>
      </div>
      <Button type="button" size="sm" className="w-fit" loading={draft.isPending} onClick={() => draft.mutate(undefined)}>
        <SparklesIcon />
        {options.length ? "Try again" : "Draft remarks"}
      </Button>
      {options.length > 0 && (
        <div className="grid gap-2">
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(o)}
              className="hover:border-primary hover:bg-primary/5 rounded-md border bg-card p-2 text-left text-sm transition-colors"
            >
              {o}
            </button>
          ))}
          <AiLabel text={`${label}. Click one to put it in the remark box, then edit and save it.`} />
        </div>
      )}
    </div>
  );
}

// --- exam questions ------------------------------------------------------------------------

const TYPE_LABEL: Record<Question["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  fill_in_the_blanks: "Fill in the blanks",
};

/** Drafts questions for an online exam. Nothing is saved: each draft opens the normal question form. */
export function AiQuestionDrafts({ examId, onReview }: { examId: number; onReview: (draft: QuestionDraft) => void }) {
  const { label } = useAiFeature("questions");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [mark, setMark] = useState("1");
  const [difficulty, setDifficulty] = useState("medium");
  const [types, setTypes] = useState<Question["type"][]>(["multiple_choice"]);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [used, setUsed] = useState<number[]>([]);
  const generate = useAction(
    async () =>
      (
        await api.post<{ questions: QuestionDraft[]; dropped: number }>("/ai/questions", {
          online_exam_id: examId, topic: topic.trim(), count: Number(count), types, difficulty, mark: Number(mark),
        })  // prettier-ignore
      ).data,
    {
      onSuccess: (r) => {
        setDrafts(r.questions);
        setUsed([]);
      },
    },
  );
  const toggle = (t: Question["type"], on: boolean) => setTypes((all) => (on ? [...all, t] : all.filter((x) => x !== t)));

  return (
    <div className="grid gap-4">
      <Field label="Topic or syllabus text" htmlFor="ai-topic" description="Shared with the AI service. Paste the topic, learning objectives or a short passage.">
        <Textarea id="ai-topic" rows={4} maxLength={2000} value={topic} onChange={(e) => setTopic(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="How many" htmlFor="ai-count">
          <Input id="ai-count" type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field label="Marks each" htmlFor="ai-mark">
          <Input id="ai-mark" type="number" min={0.5} step={0.5} value={mark} onChange={(e) => setMark(e.target.value)} />
        </Field>
        <Field label="Difficulty">
          <Combobox
            data={[{ value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]}
            value={difficulty}
            onChange={(v) => setDifficulty(v ?? "medium")}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        {(Object.keys(TYPE_LABEL) as Question["type"][]).map((t) => (
          <div key={t} className="flex items-center gap-2">
            <Checkbox id={`ai-type-${t}`} checked={types.includes(t)} onCheckedChange={(c) => toggle(t, c === true)} />
            <Label htmlFor={`ai-type-${t}`} className="font-normal">
              {TYPE_LABEL[t]}
            </Label>
          </div>
        ))}
      </div>
      <Button type="button" className="w-fit" loading={generate.isPending} disabled={topic.trim().length < 3 || types.length === 0} onClick={() => generate.mutate(undefined)}>
        <SparklesIcon />
        {drafts.length ? "Draft again" : "Draft questions"}
      </Button>
      {drafts.length > 0 && (
        <div className="grid gap-2">
          <AiLabel text={`${label}. Check each question and answer before adding it.`} />
          {drafts.map((d, i) => (
            <div key={i} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{d.question_title}</div>
                <div className="text-muted-foreground text-xs">
                  {TYPE_LABEL[d.type]} ·{" "}
                  {d.type === "multiple_choice"
                    ? d.options.map((o, j) => `${j + 1}. ${o}${d.correct_answers.includes(String(j + 1)) ? " ✓" : ""}`).join("  ")
                    : `Answer: ${d.correct_answers.join(", ")}`}
                </div>
              </div>
              {used.includes(i) ? (
                <Badge variant="secondary" className="shrink-0">
                  <CheckIcon />
                  Opened
                </Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setUsed((u) => [...u, i]);
                    onReview(d);
                  }}
                >
                  Review & add
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- progress summaries --------------------------------------------------------------------

/** On-demand summary of a student's progress (staff version for staff, gentler version for parents). */
export function AiProgressSummary({ studentId, className }: { studentId: number; className?: string }) {
  const { available, label } = useAiFeature("progress_summary");
  const [result, setResult] = useState<ProgressSummary | null>(null);
  useEffect(() => setResult(null), [studentId]);
  const run = useAction(async () => (await api.post<ProgressSummary>("/ai/progress-summary", { student_id: studentId })).data, { onSuccess: setResult });
  if (!available) return null;
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <SparklesIcon className="text-primary size-4" />
          Progress summary
        </CardTitle>
        <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate(undefined)}>
          {result ? "Refresh" : "Summarise progress"}
        </Button>
      </CardHeader>
      {result && (
        <CardContent className="space-y-2 px-4 text-sm">
          <p className="whitespace-pre-line">{result.summary}</p>
          {result.suggestions.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {result.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          <AiLabel text={`${label} · ${dayjs(result.generated_at).format("DD MMM YYYY HH:mm")}`} />
        </CardContent>
      )}
    </Card>
  );
}

// --- admin settings ------------------------------------------------------------------------

/** System settings → AI assistant: switch, API key, model, limits and usage. */
export function AiSettingsCard() {
  const { data } = useGet<AiSettings>("/ai/settings");
  const usage = useGet<{ rows: AiUsageRow[] }>("/ai/usage");
  const [values, setValues] = useState<Partial<AiSettings>>({});
  useEffect(() => data && setValues(data), [data]);
  const save = useAction(
    () =>
      api.put("/ai/settings", {
        ai_enabled: !!values.ai_enabled,
        anthropic_api_key: values.anthropic_api_key ?? "",
        ai_model: values.ai_model,
        ai_monthly_cap: Number(values.ai_monthly_cap ?? 0),
        ai_daily_user_cap: Number(values.ai_daily_user_cap ?? 0),
      }),
    { success: "AI assistant settings saved", invalidate: [["/ai/settings"], ["/ai/status"]] },
  );
  const set = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            AI assistant
            {data?.configured ? (
              <Badge className="bg-success/15 text-success border-transparent">On</Badge>
            ) : (
              <Badge variant="secondary">Off</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Drafts report-card remarks, exam questions and progress summaries with Claude (Anthropic). Staff review every draft before it is saved. Student names, contact details, health and counselling
            records are never sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch id="ai-enabled" checked={!!values.ai_enabled} onCheckedChange={(c) => set("ai_enabled", c)} />
            <Label htmlFor="ai-enabled">Turn on the AI assistant</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Anthropic API key"
              htmlFor="ai-key"
              description={data?.uses_environment_key ? "Using the ANTHROPIC_API_KEY from the server environment" : values.anthropic_api_key === MASK ? "Saved; type to replace" : "From console.anthropic.com"}
            >
              <Input
                id="ai-key"
                type="password"
                autoComplete="new-password"
                placeholder="Not set"
                value={values.anthropic_api_key ?? ""}
                onFocus={(e) => values.anthropic_api_key === MASK && e.target.select()}
                onChange={(e) => set("anthropic_api_key", e.target.value)}
              />
            </Field>
            <Field label="Model">
              <Combobox data={(data?.models ?? []).map((m) => ({ value: m, label: m }))} value={values.ai_model ?? null} onChange={(v) => v && set("ai_model", v)} />
            </Field>
            <Field label="Requests per month (whole school)" htmlFor="ai-month" description={data ? `${data.requests_this_month} used this month` : undefined}>
              <Input id="ai-month" type="number" min={0} value={values.ai_monthly_cap ?? ""} onChange={(e) => set("ai_monthly_cap", Number(e.target.value))} />
            </Field>
            <Field label="Requests per person per day" htmlFor="ai-day">
              <Input id="ai-day" type="number" min={0} value={values.ai_daily_user_cap ?? ""} onChange={(e) => set("ai_daily_user_cap", Number(e.target.value))} />
            </Field>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t pt-6">
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <SaveIcon />
            Save
          </Button>
        </CardFooter>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">AI usage</CardTitle>
          <CardDescription>Requests and tokens per month. Prompts and answers are not stored.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Feature</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Input tokens</TableHead>
              <TableHead className="text-right">Output tokens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={usage.isLoading} empty={!usage.isLoading && (usage.data?.rows ?? []).length === 0} colSpan={6} emptyText="No AI requests yet" />
            {(usage.data?.rows ?? []).map((r) => (
              <TableRow key={`${r.month}-${r.feature}`}>
                <TableCell>{dayjs(`${r.month}-01`).format("MMMM YYYY")}</TableCell>
                <TableCell>{FEATURE_LABEL[r.feature] ?? r.feature}</TableCell>
                <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                <TableCell className="text-right tabular-nums">{r.failed}</TableCell>
                <TableCell className="text-right tabular-nums">{r.input_tokens.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.output_tokens.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
