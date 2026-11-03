import { useClasses, useExams, useSections, useSubjects } from "../api/hooks";
import { toOptions } from "../utils";
import { Combobox } from "./combobox";
import { Field } from "./field";
import { t } from "../i18n";

export interface Selection {
  classId: string | null;
  sectionId: string | null;
  subjectId?: string | null;
  examId?: string | null;
}

interface Props {
  value: Selection;
  onChange: (value: Selection) => void;
  withSection?: boolean;
  withSubject?: boolean;
  withExam?: boolean;
  /** limit subjects to this teacher */
  teacherId?: number;
}

/** Class → section → subject (and exam) selects used by marks, attendance, routine, etc. */
export function ClassPicker({ value, onChange, withSection = true, withSubject, withExam, teacherId }: Props) {
  const classes = useClasses();
  const sections = useSections(value.classId);
  const subjects = useSubjects(value.classId);
  const exams = useExams();
  const subjectItems = (subjects.data?.items ?? []).filter((s) => !teacherId || s.teacher_id === teacherId);

  return (
    <div className="no-print flex flex-wrap items-end gap-3">
      {withExam && (
        <Field label={t("Exam")} className="w-52">
          <Combobox
            data={toOptions(exams.data?.items, "exam_id", "name")}
            value={value.examId ?? null}
            onChange={(examId) => onChange({ ...value, examId })}
            placeholder={t("Choose exam")}
          />
        </Field>
      )}
      <Field label={t("Class")} className="w-44">
        <Combobox
          data={toOptions(classes.data?.items, "class_id", "name")}
          value={value.classId}
          onChange={(classId) => onChange({ ...value, classId, sectionId: null, subjectId: null })}
          placeholder={t("Choose class")}
        />
      </Field>
      {withSection && (
        <Field label={t("Section")} className="w-40">
          <Combobox
            disabled={!value.classId}
            data={toOptions(sections.data?.items, "section_id", "name")}
            value={value.sectionId}
            onChange={(sectionId) => onChange({ ...value, sectionId })}
            placeholder={t("Choose section")}
          />
        </Field>
      )}
      {withSubject && (
        <Field label={t("Subject")} className="w-52">
          <Combobox
            disabled={!value.classId}
            data={toOptions(subjectItems, "subject_id", "name")}
            value={value.subjectId ?? null}
            onChange={(subjectId) => onChange({ ...value, subjectId })}
            placeholder={t("Choose subject")}
            emptyText={teacherId ? t("No subjects assigned to you") : undefined}
          />
        </Field>
      )}
    </div>
  );
}
