import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { api } from "../../api/client";
import { useAction } from "../../api/hooks";
import type { Question, QuestionDraft } from "../../api/types";
import { Combobox } from "../../components/combobox";
import { IconAction } from "../../components/CrudPage";
import { Field } from "../../components/field";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { DialogFooter } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { TYPE_LABEL, parseList } from "./shared";
import { t } from "../../i18n";

/** Add or edit a question; `draft` (an AI-drafted question) prefills a new one. */
export function QuestionForm({ examId, question, draft, onDone }: { examId: number; question: Question | null; draft?: QuestionDraft; onDone: () => void }) {
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
    { success: t("Question saved"), invalidate: [[`/online-exams/${examId}`]], onSuccess: onDone },
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label={t("Type")}>
          <Combobox
            disabled={!!question}
            data={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            value={type}
            onChange={(v) => v && setType(v as Question["type"])}
          />
        </Field>
        <Field label={t("Marks")} htmlFor="q-mark">
          <Input id="q-mark" type="number" min={0.5} step={0.5} value={mark} onChange={(e) => setMark(e.target.value)} />
        </Field>
      </div>
      <Field label={t("Question")} htmlFor="q-title" description={type === "fill_in_the_blanks" ? t("Write ___ where each blank goes") : undefined}>
        <Textarea id="q-title" rows={3} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {type === "multiple_choice" && (
        <div className="grid gap-2">
          <Label>{t("Options (tick the correct ones)")}</Label>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                aria-label={t("Option {value} is correct", { value: i + 1 })}
                checked={correct.includes(String(i + 1))}
                onCheckedChange={(c) => setCorrect(c === true ? [...correct, String(i + 1)] : correct.filter((x) => x !== String(i + 1)))}
              />
              <Input
                className="flex-1"
                placeholder={t("Option {value}", { value: i + 1 })}
                value={o}
                onChange={(e) => {
                  const v = e.target.value;
                  setOptions((all) => all.map((x, j) => (j === i ? v : x)));
                }}
              />
              <IconAction
                label={t("Remove option")}
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
            {t("Add option")}</Button>
        </div>
      )}
      {type === "true_false" && (
        <Field label={t("Correct answer")}>
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
        <Field label={t("Correct words, in order")} htmlFor="q-words" description={t("Comma separated; matching ignores case")}>
          <Input id="q-words" value={words} onChange={(e) => setWords(e.target.value)} />
        </Field>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("Cancel")}</Button>
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          {t("Save question")}</Button>
      </DialogFooter>
    </div>
  );
}

/** Option rows of a staff question card / print sheet with the correct ones ticked. */
export function QuestionAnswers({ q, showAnswers }: { q: Question; showAnswers: boolean }) {
  const correct = parseList(q.correct_answers);
  if (q.type === "fill_in_the_blanks")
    return showAnswers ? (
      <p className="text-sm">
        <span className="text-muted-foreground">{t("Answers:")}{" "}</span>
        <span className="font-medium">{correct.join(", ") || "—"}</span>
      </p>
    ) : null;
  const options =
    q.type === "true_false"
      ? [
          { value: "true", label: t("True") },
          { value: "false", label: t("False") },
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
