import dayjs from "dayjs";
import { Controller, useForm } from "react-hook-form";

import { api } from "../../api/client";
import { useAction, useClasses, useSections, useSubjects } from "../../api/hooks";
import type { OnlineExam } from "../../api/types";
import { useUser } from "../../auth/AuthContext";
import { Combobox } from "../../components/combobox";
import { DatePicker } from "../../components/date-picker";
import { Field } from "../../components/field";
import { Button } from "../../components/ui/button";
import { DialogFooter } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { t } from "../../i18n";

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

export function ExamForm({ exam, onDone }: { exam: OnlineExam | null; onDone: () => void }) {
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
    { success: t("Exam saved"), invalidate: [["/online-exams"], [`/online-exams/${exam?.online_exam_id}`]], onSuccess: onDone },
  );
  const required = { required: t("Required") };
  const { errors } = form.formState;

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label={t("Title")} htmlFor="exam-title" required error={errors.title?.message}>
        <Input id="exam-title" {...form.register("title", required)} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="class_id"
          rules={required}
          render={({ field, fieldState }) => (
            <Field label={t("Class")} required error={fieldState.error?.message}>
              <Combobox
                data={(classes.data?.items ?? []).map((c) => ({ value: String(c.class_id), label: c.name }))}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  form.setValue("section_id", null);
                  form.setValue("subject_id", null);
                }}
                placeholder={t("Choose class")}
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
            <Field label={t("Section")} required error={fieldState.error?.message}>
              <Combobox
                disabled={!classId}
                data={(sections.data?.items ?? []).map((s) => ({ value: String(s.section_id), label: s.name }))}
                value={field.value}
                onChange={field.onChange}
                placeholder={t("Choose section")}
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
          <Field label={t("Subject")} required error={fieldState.error?.message}>
            <Combobox
              disabled={!classId}
              data={subjectItems.map((s) => ({ value: String(s.subject_id), label: s.name }))}
              value={field.value}
              onChange={field.onChange}
              placeholder={t("Choose subject")}
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
            <Field label={t("Date")} required error={fieldState.error?.message}>
              <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
            </Field>
          )}
        />
        <Field label={t("Start")} htmlFor="exam-start" required>
          <Input id="exam-start" type="time" {...form.register("time_start", required)} />
        </Field>
        <Field label={t("End")} htmlFor="exam-end" required error={errors.time_end?.message}>
          <Input
            id="exam-end"
            type="time"
            aria-invalid={!!errors.time_end}
            {...form.register("time_end", { validate: (v, all) => (v > all.time_start ? true : t("Must be after start time")) })}
          />
        </Field>
      </div>
      <Field label={t("Pass mark (%)")} htmlFor="exam-pass" className="sm:w-1/3">
        <Input id="exam-pass" type="number" min={0} max={100} {...form.register("minimum_percentage")} />
      </Field>
      <Field label={t("Instructions")} htmlFor="exam-instruction">
        <Textarea id="exam-instruction" rows={3} {...form.register("instruction")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>
          {t("Save")}</Button>
      </DialogFooter>
    </form>
  );
}
