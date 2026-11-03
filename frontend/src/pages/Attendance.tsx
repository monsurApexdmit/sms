import dayjs from "dayjs";
import { CalendarDaysIcon, CheckIcon, ClipboardCheckIcon, PartyPopperIcon, PrinterIcon, SaveIcon, UndoIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../api/client";
import { useAction, useClasses, useGet, useList, useSections } from "../api/hooks";
import type { Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { DatePicker } from "../components/date-picker";
import { ExportButton } from "../components/ExportButton";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";
import { PrintHeader, useChildSelect } from "./Academic";

interface SheetRow {
  attendance_id: number;
  student_id: number;
  name: string;
  roll: number | null;
  status: number | null;
  /** approved leave covers this day */
  on_leave: boolean;
}

// legacy statuses: 0 = not marked, 1 = present, 2 = absent
const STATUS = [
  { value: "1", label: "Present", on: "data-[state=on]:bg-success/15 data-[state=on]:text-success" },
  { value: "2", label: "Absent", on: "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive" },
  { value: "0", label: "Not marked", on: "data-[state=on]:bg-muted data-[state=on]:text-foreground" },
];

const PRESENT_BADGE = "bg-success/15 text-success border-transparent";
const OFF_CELL = "bg-muted text-muted-foreground";

/** Holiday titles and weekly days off of a month, as returned with the attendance reports. */
interface MonthCalendar {
  holidays: Record<string, string>;
  off_days: number[];
  working_days: number;
}

const offTitle = (cal: MonthCalendar, day: number) => cal.holidays[String(day)] ?? (cal.off_days.includes(day) ? "Weekly day off" : undefined);
const ABSENT_BADGE = "bg-destructive/10 text-destructive border-transparent";

export function AttendancePage() {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const ready = sel.classId && sel.sectionId && date;
  const sheet = useGet<SheetRow[]>(ready ? "/attendance/sheet" : null, { class_id: sel.classId, section_id: sel.sectionId, date });
  const day = useGet<{ holiday: string | null; weekly_off: boolean }>(date ? "/calendar/day" : null, { date });
  const [rows, setRows] = useState<SheetRow[]>([]);
  useEffect(() => setRows(sheet.data ?? []), [sheet.data]);

  const save = useAction(
    () =>
      api.put("/attendance/sheet", {
        class_id: Number(sel.classId),
        section_id: Number(sel.sectionId),
        date,
        items: rows.map((r) => ({ attendance_id: r.attendance_id, status: r.status ?? 0 })),
      }),
    { success: "Attendance saved", invalidate: [["/attendance/sheet"]] },
  );
  const setAll = (status: number) => setRows((rs) => rs.map((r) => ({ ...r, status })));
  const present = rows.filter((r) => r.status === 1).length;
  const absent = rows.filter((r) => r.status === 2).length;
  const unmarked = rows.length - present - absent;
  const dirty = JSON.stringify(rows) !== JSON.stringify(sheet.data ?? []);

  const pickDate = (v: string) => {
    if (v && dayjs(v).isAfter(dayjs(), "day")) {
      toast.error("Attendance can't be taken for a future date");
      return;
    }
    setDate(v);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Daily attendance" subtitle="Absent students' parents are notified by SMS when a gateway is configured" />
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <ClassPicker value={sel} onChange={setSel} />
          <Field label="Date" className="w-48">
            <DatePicker value={date} onChange={pickDate} clearable={false} />
          </Field>
        </CardContent>
      </Card>
      {(day.data?.holiday || day.data?.weekly_off) && (
        <Alert>
          <PartyPopperIcon />
          <AlertTitle>{day.data.holiday ? `Holiday: ${day.data.holiday}` : "Weekly day off"}</AlertTitle>
          <AlertDescription>This day is not a school day in the academic calendar. You can still record attendance if classes were held.</AlertDescription>
        </Alert>
      )}
      {ready ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
            <div className="flex flex-wrap gap-2">
              <Badge className={PRESENT_BADGE}>Present {present}</Badge>
              <Badge className={ABSENT_BADGE}>Absent {absent}</Badge>
              <Badge variant="secondary">Not marked {unmarked}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-success hover:text-success" disabled={rows.length === 0} onClick={() => setAll(1)}>
                <CheckIcon />
                All present
              </Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={rows.length === 0} onClick={() => setAll(2)}>
                <XIcon />
                All absent
              </Button>
              <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={() => setAll(0)}>
                Clear
              </Button>
            </div>
          </div>
          <Table className="min-w-[480px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-20">Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="w-72">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState loading={sheet.isLoading} empty={!sheet.isLoading && rows.length === 0} colSpan={3} emptyText="No students enrolled in this section" />
              {rows.map((r, i) => (
                <TableRow key={r.attendance_id}>
                  <TableCell className="text-muted-foreground">{r.roll ?? <Dash />}</TableCell>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.on_leave && <Badge className="bg-chart-2/15 text-chart-2 ml-2 border-transparent">On leave</Badge>}
                  </TableCell>
                  <TableCell>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      aria-label={`Attendance for ${r.name}`}
                      value={String(r.status ?? 0)}
                      onValueChange={(v) => v && setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: Number(v) } : x)))}
                    >
                      {STATUS.map((s) => (
                        <ToggleGroupItem key={s.value} value={s.value} className={cn("text-xs", s.on)}>
                          {s.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <CardFooter className="bg-muted/30 flex-wrap justify-between gap-3 border-t px-4 py-3 [.border-t]:pt-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              {dayjs(date).format("dddd, DD MMM YYYY")}
              {dirty && <Badge className="bg-warning/20 text-warning-foreground border-transparent">Unsaved changes</Badge>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setRows(sheet.data ?? [])}>
                <UndoIcon />
                Reset
              </Button>
              <Button loading={save.isPending} disabled={rows.length === 0} onClick={() => save.mutate(undefined)}>
                <SaveIcon />
                Save
              </Button>
            </div>
          </CardFooter>
        </Card>
      ) : (
        <EmptyState icon={ClipboardCheckIcon} title="Choose a class, section and date">
          The attendance sheet for that day opens here.
        </EmptyState>
      )}
    </div>
  );
}

// --- report -------------------------------------------------------------------

const cellClass = (s?: number) =>
  s === 1 ? "bg-success/15 text-success" : s === 2 ? "bg-destructive/10 text-destructive" : "";
const cellText = (s?: number) => (s === 1 ? "P" : s === 2 ? "A" : "");

function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="bg-success/15 text-success inline-flex size-5 items-center justify-center rounded-sm font-semibold">P</span>
        Present
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-destructive/10 text-destructive inline-flex size-5 items-center justify-center rounded-sm font-semibold">A</span>
        Absent
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex size-5 rounded-sm border" />
        Not marked
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("inline-flex size-5 items-center justify-center rounded-sm font-semibold", OFF_CELL)}>H</span>
        Holiday / day off
      </span>
    </div>
  );
}

function StudentMonth({ studentId, month }: { studentId: string; month: string }) {
  const { data, isLoading } = useGet<MonthCalendar & { days: number; records: Record<string, number>; present: number; absent: number }>(`/attendance/student/${studentId}`, { month });
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (!data) return null;
  const first = dayjs(`${month}-01`);
  const today = dayjs().format("YYYY-MM-DD");
  return (
    <Card className="gap-4 print:border-0 print:shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{first.format("MMMM YYYY")}</span>
          <Badge className={PRESENT_BADGE}>Present {data.present}</Badge>
          <Badge className={ABSENT_BADGE}>Absent {data.absent}</Badge>
          <Badge variant="secondary">Working days {data.working_days}</Badge>
        </div>
        <Legend />
      </CardContent>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 [print-color-adjust:exact] sm:gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-muted-foreground pb-1 text-center text-xs font-medium">
              {d}
            </div>
          ))}
          {Array.from({ length: first.day() }, (_, i) => (
            <div key={`pad${i}`} />
          ))}
          {Array.from({ length: data.days }, (_, i) => {
            const s = data.records[String(i + 1)];
            const off = offTitle(data, i + 1);
            const isToday = first.add(i, "day").format("YYYY-MM-DD") === today;
            return (
              <div key={i} title={off} className={cn("flex aspect-square flex-col rounded-md border p-1 sm:aspect-auto sm:h-16 sm:p-2", off && !s && OFF_CELL, cellClass(s), isToday && "ring-primary ring-2")}>
                <span className="text-muted-foreground text-[10px] sm:text-xs">{i + 1}</span>
                <span className="m-auto text-sm font-bold">{cellText(s) || (off ? "H" : "")}</span>
                {data.holidays[String(i + 1)] && <span className="hidden truncate text-[10px] sm:block">{data.holidays[String(i + 1)]}</span>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type ReportRow = { student_id: number; name: string; roll: number | null; days: Record<string, number>; present: number; absent: number };

export function AttendanceReportPage() {
  const user = useUser();
  const staff = user.role === "admin" || user.role === "teacher";
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const { childId, select } = useChildSelect();
  const [studentId, setStudentId] = useState<string | null>(null);
  const ready = staff && sel.classId && sel.sectionId && month;
  const report = useGet<MonthCalendar & { days: number; rows: ReportRow[] }>(ready ? "/attendance/report" : null, { class_id: sel.classId, section_id: sel.sectionId, month });
  const students = useList<Student>(staff && sel.classId ? "/students" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000 });
  const ownId = user.role === "student" ? String(user.id) : childId;
  const classes = useClasses();
  const sections = useSections(sel.classId);
  const className = classes.data?.items.find((c) => String(c.class_id) === sel.classId)?.name;
  const sectionName = sections.data?.items.find((s) => String(s.section_id) === sel.sectionId)?.name;
  const studentName = students.data?.items.find((s) => String(s.student_id) === studentId)?.name;
  const monthLabel = month ? dayjs(`${month}-01`).format("MMMM YYYY") : "";

  const showStudent = (!staff && ownId) || (staff && studentId);
  const canPrint = month && (showStudent || (staff && !studentId && report.data));
  const first = dayjs(`${month}-01`);

  return (
    <div className="space-y-6">
      <style>{"@media print { @page { size: landscape; } }"}</style>
      <PageHeader
        title="Attendance report"
        actions={
          <>
            {select}
            {ready && !studentId && (
              <ExportButton size="default" path="/export/attendance.xlsx" params={{ class_id: sel.classId, section_id: sel.sectionId, month }} />
            )}
            {canPrint && (
              <Button variant="outline" onClick={() => window.print()}>
                <PrinterIcon />
                Print
              </Button>
            )}
          </>
        }
      />
      <Card className="no-print py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          {staff && <ClassPicker value={sel} onChange={(v) => { setSel(v); setStudentId(null); }} />}
          <Field label="Month" htmlFor="report-month" className="w-44">
            <Input id="report-month" type="month" value={month} max={dayjs().format("YYYY-MM")} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          {staff && (
            <Field label="Single student (optional)" className="w-60">
              <Combobox
                clearable
                disabled={!sel.classId}
                placeholder="Whole section"
                data={toOptions(students.data?.items, "student_id", "name")}
                value={studentId}
                onChange={setStudentId}
              />
            </Field>
          )}
        </CardContent>
      </Card>

      {showStudent && month && (
        <PrintHeader
          title="Attendance sheet"
          lines={[studentName ?? (user.role === "student" ? user.name : undefined), staff && className ? `Class ${className}${sectionName ? ` : Section ${sectionName}` : ""}` : undefined, monthLabel]}
        />
      )}
      {!staff && ownId && month && <StudentMonth studentId={ownId} month={month} />}
      {staff && studentId && month && <StudentMonth studentId={studentId} month={month} />}

      {staff && !ready && !studentId && (
        <EmptyState icon={CalendarDaysIcon} title="Choose a class, section and month">
          The monthly attendance grid appears here.
        </EmptyState>
      )}

      {ready && !studentId && (
        <>
          <PrintHeader title="Attendance sheet" lines={[`Class ${className ?? ""}`, `Section ${sectionName ?? ""}`, monthLabel]} />
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <Legend />
            {report.data && <Badge variant="secondary">Working days {report.data.working_days}</Badge>}
          </div>
          <Card className="gap-0 overflow-hidden py-0 print:rounded-none print:shadow-none">
            {report.isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : report.data && (
              <Table className="border-collapse text-xs [print-color-adjust:exact] [&_td]:border [&_th]:border">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="bg-muted sticky left-0 z-10 min-w-44 print:static">Student</TableHead>
                    {Array.from({ length: report.data.days }, (_, i) => {
                      const d = first.add(i, "day");
                      const off = offTitle(report.data!, i + 1);
                      return (
                        <TableHead key={i} title={off} className={cn("h-auto px-1 py-1 text-center", off && OFF_CELL)}>
                          <div className="text-[10px] font-normal">{d.format("dd")[0]}</div>
                          <div>{i + 1}</div>
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-success px-2 text-center">P</TableHead>
                    <TableHead className="text-destructive px-2 text-center">A</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState empty={report.data.rows.length === 0} colSpan={report.data.days + 3} emptyText="No students enrolled in this section" />
                  {report.data.rows.map((r) => (
                    <TableRow key={r.student_id}>
                      <TableCell className="bg-card sticky left-0 z-10 font-medium print:static">
                        {r.roll ? <span className="text-muted-foreground">{r.roll}. </span> : null}
                        {r.name}
                      </TableCell>
                      {Array.from({ length: report.data!.days }, (_, i) => {
                        const s = r.days[String(i + 1)];
                        const off = offTitle(report.data!, i + 1);
                        return (
                          <TableCell key={i} className={cn("min-w-7 px-1 text-center font-semibold", off && !s && OFF_CELL, cellClass(s))}>
                            {cellText(s) || (off ? "H" : "")}
                          </TableCell>
                        );
                      })}
                      <TableCell className="px-2 text-center font-bold tabular-nums">{r.present}</TableCell>
                      <TableCell className="px-2 text-center font-bold tabular-nums">{r.absent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <div className="print-only">
            <Legend />
          </div>
        </>
      )}
    </div>
  );
}
