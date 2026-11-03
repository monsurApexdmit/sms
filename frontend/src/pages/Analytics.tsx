import dayjs from "dayjs";
import {
  BanknoteIcon,
  CalendarCheckIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  OctagonAlertIcon,
  PercentIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  UserXIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useClasses, useGet, usePagedList, usePublicSettings } from "../api/hooks";
import type {
  AtRiskPage,
  AttendanceAnalytics,
  DefaulterPage,
  ExamAnalytics,
  FeeAnalytics,
  FeeDefaulter,
  RiskStudent,
  TeacherWorkload,
} from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { ExportButton } from "../components/ExportButton";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { StatTile as Tile } from "../components/StatTile";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import { money, toOptions } from "../utils";

// --- shared pieces --------------------------------------------------------------------

const SERIES = ["var(--chart-1)", "var(--chart-2)"];
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const AXIS = { tick: { fill: "var(--muted-foreground)", fontSize: 12 }, axisLine: false, tickLine: false } as const;
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

type TipRow = { name?: unknown; value?: unknown; color?: string; dataKey?: unknown };

/** Hover card: the label, then one row per series with its swatch. Text stays in text colours. */
function ChartTip({ active, payload, label, format, labelFormat }: {
  active?: boolean; payload?: readonly TipRow[]; label?: unknown; format: (v: number) => string; labelFormat?: (l: string) => string;
}) {  // prettier-ignore
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{labelFormat ? labelFormat(String(label)) : String(label)}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{String(p.name)}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{format(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** The chart's numbers as a table, for screen readers, print and anyone who prefers to read them. */
function TableView({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground cursor-pointer text-xs">Table view</summary>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>{head.map((h, i) => <TableHead key={h} className={cn(i > 0 && "text-right")}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={cn(j > 0 && "text-right tabular-nums")}>{c}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  );  // prettier-ignore
}

function ChartCard({ title, description, legend, children, table }: { title: string; description?: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {legend}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-64">{children}</div>
        {table}
      </CardContent>
    </Card>
  );
}

/** A rate with a thin meter: green at `good`+, amber at `warn`+, red below. */
function Meter({ value, good = 90, warn = 75 }: { value: number | null; good?: number; warn?: number }) {
  if (value === null) return <Dash />;
  const fill = value >= good ? "bg-success" : value >= warn ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full" aria-hidden>
        <div className={cn("h-full rounded-full", fill)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="w-12 text-right tabular-nums">{value}%</span>
    </div>
  );
}

const LEVEL: Record<RiskStudent["level"], [string, string, LucideIcon]> = {
  high: ["High", "bg-destructive/10 text-destructive", OctagonAlertIcon],
  medium: ["Medium", "bg-warning/20 text-amber-700 dark:text-amber-300", TriangleAlertIcon],
  low: ["Low", "bg-muted text-muted-foreground", CircleAlertIcon],
};

function LevelBadge({ level, score }: { level: RiskStudent["level"]; score: number }) {
  const [label, style, Icon] = LEVEL[level];
  return (
    <Badge className={cn("border-transparent", style)}>
      <Icon />
      {label} · {score}
    </Badge>
  );
}

function TileSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
    </div>
  );  // prettier-ignore
}

function ClassFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const classes = useClasses();
  return (
    <Field label="Class" className="w-48">
      <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={value} onChange={onChange} clearable placeholder="All my classes" />
    </Field>
  );
}

// --- at risk ---------------------------------------------------------------------------

function AtRiskTab() {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const params = { class_id: sel.classId ?? undefined, section_id: sel.sectionId ?? undefined };
  const { data, isLoading, isError, page, setPage, pageSize } = usePagedList<RiskStudent, AtRiskPage>("/analytics/at-risk", params, 25);
  const rows = data?.items ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ClassPicker value={sel} onChange={setSel} />
        <ExportButton path="/analytics/at-risk.xlsx" params={params} />
      </div>
      {isLoading ? (
        <TileSkeleton />
      ) : (
        data && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="High risk" value={data.counts.high} hint="Score 50 or more" icon={OctagonAlertIcon} tone="destructive" />
            <Tile label="Medium risk" value={data.counts.medium} hint="Score 25–49" icon={TriangleAlertIcon} tone="warning" />
            <Tile label="Low concern" value={data.counts.low} hint="One minor signal" icon={CircleAlertIcon} />
          </div>
        )
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="min-w-[900px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="w-32">Risk</TableHead>
              <TableHead>Why</TableHead>
              <TableHead className="w-24 text-right">Attendance</TableHead>
              <TableHead className="w-28 text-right">Latest exam</TableHead>
              <TableHead className="w-24 text-right">Homework</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={6} emptyText={isError ? "You can only see classes you teach" : "No students at risk"} />
            {rows.map((r) => (
              <TableRow key={r.student_id} className="align-top">
                <TableCell>
                  <Link to={`/app/students/${r.student_id}/records`} className="font-medium hover:underline">{r.name}</Link>
                  <div className="text-muted-foreground text-xs">
                    {r.class_name}
                    {r.section_name && ` · ${r.section_name}`}
                    {r.roll ? ` · Roll ${r.roll}` : ""}
                  </div>
                </TableCell>
                <TableCell><LevelBadge level={r.level} score={r.score} /></TableCell>
                <TableCell className="whitespace-normal">
                  <ul className="list-disc space-y-0.5 pl-4 text-sm">
                    {r.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(r.attendance_pct)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtPct(r.latest_exam_pct)}
                  {r.previous_exam_pct !== null && <div className="text-muted-foreground text-xs">was {fmtPct(r.previous_exam_pct)}</div>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.homework_due ? fmtPct(r.homework_rate) : <Dash />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </Card>
      <p className="text-muted-foreground text-xs">
        Score out of 100: attendance below 75% over the last 30 days (30, or 40 when below 60%), failing subjects in the latest exam (20 + 5 each),
        results down 10+ points (15), overdue fees (10), under 60% of homework handed in (10), 10+ days of leave (5). High is 50 or more.
      </p>
    </div>
  );
}

// --- fees -------------------------------------------------------------------------------

function FeesTab() {
  const currency = usePublicSettings().data?.currency || "usd";
  const { data, isLoading } = useGet<FeeAnalytics>("/analytics/fees");
  const [classId, setClassId] = useState<string | null>(null);
  const defaulters = usePagedList<FeeDefaulter, DefaulterPage>("/analytics/fees/defaulters", { class_id: classId ?? undefined }, 20);
  const m = (v: number) => money(v, currency);
  const monthLabel = (v: string) => dayjs(`${v}-01`).format("MMM YYYY");

  if (isLoading || !data) return <TileSkeleton />;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={`Billed in ${data.year}`} value={m(data.billed)} icon={WalletIcon} />
        <Tile label="Collected" value={m(data.collected)} icon={BanknoteIcon} tone="success" />
        <Tile label="Collection rate" value={fmtPct(data.collection_rate)} hint={`${m(data.outstanding)} outstanding`} icon={PercentIcon} />
        <Tile label="Overdue" value={m(data.overdue)} hint="Past the due date, all years" icon={CircleAlertIcon} tone="destructive" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            title="Billed and collected by month"
            legend={<Legend items={[{ label: "Billed", color: SERIES[0] }, { label: "Collected", color: SERIES[1] }]} />}
            table={<TableView head={["Month", "Billed", "Collected"]} rows={data.monthly.map((r) => [monthLabel(r.month), m(r.billed), m(r.collected)])} />}
          >
            <ResponsiveContainer>
              <BarChart data={data.monthly} barGap={2} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" {...AXIS} tickFormatter={(v: string) => dayjs(`${v}-01`).format("MMM")} />
                <YAxis {...AXIS} width={48} tickFormatter={(v: number) => compact.format(v)} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(p) => <ChartTip {...p} format={m} labelFormat={monthLabel} />} />
                <Bar dataKey="billed" name="Billed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="collected" name="Collected" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <ChartCard
          title="Overdue by days late"
          table={<TableView head={["Days late", "Amount", "Invoices"]} rows={data.ageing.map((b) => [b.bucket, m(b.amount), b.invoices])} />}
        >
          <ResponsiveContainer>
            <BarChart data={data.ageing} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="bucket" {...AXIS} />
              <YAxis {...AXIS} width={48} tickFormatter={(v: number) => compact.format(v)} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(p) => <ChartTip {...p} format={m} labelFormat={(l) => `${l} days late`} />} />
              <Bar dataKey="amount" name="Overdue" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24}>
                <LabelList dataKey="amount" position="top" fill="var(--muted-foreground)" fontSize={12} formatter={(v: unknown) => (Number(v) ? compact.format(Number(v)) : "")} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="py-4"><CardTitle className="text-base">Outstanding by class</CardTitle></CardHeader>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Students owing</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState empty={data.by_class.length === 0} colSpan={3} emptyText="Nothing outstanding" />
              {data.by_class.map((c) => (
                <TableRow key={c.class_id}>
                  <TableCell className="font-medium">{c.class_name || <Dash />}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.students}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(c.outstanding)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="py-4"><CardTitle className="text-base">Fee plan instalments</CardTitle></CardHeader>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Instalment</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="w-36 text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState empty={data.instalments.length === 0} colSpan={4} emptyText="No invoices generated from fee plans yet" />
              {data.instalments.map((i) => (
                <TableRow key={i.fee_instalment_id}>
                  <TableCell>
                    <div className="font-medium">{i.instalment}</div>
                    <div className="text-muted-foreground text-xs">{i.plan} · {i.invoices} invoices</div>
                  </TableCell>
                  <TableCell>{dayjs(i.due_date).format("DD MMM YYYY")}</TableCell>
                  <TableCell className="text-right tabular-nums">{m(i.billed)}</TableCell>
                  <TableCell><Meter value={i.rate} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b p-3">
          <div>
            <div className="font-semibold">Defaulters</div>
            <div className="text-muted-foreground text-sm">
              {defaulters.data ? `${defaulters.data.total} students owe ${m(defaulters.data.amount)} past the due date` : " "}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <ClassFilter value={classId} onChange={setClassId} />
            <ExportButton path="/analytics/fees/defaulters.xlsx" params={{ class_id: classId ?? undefined }} />
          </div>
        </div>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Parent phone</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">Oldest due</TableHead>
              <TableHead className="text-right">Days late</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={defaulters.isLoading} empty={!defaulters.isLoading && !defaulters.data?.items.length} colSpan={6} emptyText="No overdue fees" />
            {defaulters.data?.items.map((d) => (
              <TableRow key={d.student_id}>
                <TableCell>
                  <Link to={`/app/students/${d.student_id}/records`} className="font-medium hover:underline">{d.name}</Link>
                  <div className="text-muted-foreground text-xs">{[d.class_name, d.section_name].filter(Boolean).join(" · ")}</div>
                </TableCell>
                <TableCell>{d.parent_phone || <Dash />}</TableCell>
                <TableCell className="text-right tabular-nums">{d.invoices}</TableCell>
                <TableCell className="text-right tabular-nums">{dayjs(d.oldest_due).format("DD MMM YYYY")}</TableCell>
                <TableCell className="text-right tabular-nums">{d.days_overdue}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{m(d.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager page={defaulters.page} pageSize={defaulters.pageSize} total={defaulters.data?.total ?? 0} onPage={defaulters.setPage} />
      </Card>
    </div>
  );
}

// --- attendance ---------------------------------------------------------------------------

function AttendanceTab() {
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [classId, setClassId] = useState<string | null>(null);
  const { data, isLoading, isError } = useGet<AttendanceAnalytics>(month ? "/analytics/attendance" : null, { month, class_id: classId ?? undefined });
  const monthLabel = (v: string) => dayjs(`${v}-01`).format("MMM YYYY");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month" htmlFor="an-month" className="w-44">
          <Input id="an-month" type="month" value={month} max={dayjs().format("YYYY-MM")} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <ClassFilter value={classId} onChange={setClassId} />
      </div>
      {isError && <EmptyState title="You can only see classes you teach" />}
      {isLoading || !data ? (
        !isError && <TileSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={`Attendance in ${monthLabel(data.month)}`} value={fmtPct(data.rate)} hint="Present out of days marked" icon={CalendarCheckIcon} />
            <Tile label="Present today" value={data.today.present} hint={`of ${data.today.enrolled} enrolled`} icon={UserCheckIcon} tone="success" />
            <Tile label="Absent today" value={data.today.absent} icon={UserXIcon} tone="destructive" />
            <Tile label="Not marked today" value={data.today.not_marked} icon={ClipboardListIcon} tone="warning" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Attendance rate, last 6 months"
              table={<TableView head={["Month", "Attendance"]} rows={data.trend.map((t) => [monthLabel(t.month), fmtPct(t.rate)])} />}
            >
              <ResponsiveContainer>
                <LineChart data={data.trend} margin={{ top: 12, right: 16 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" {...AXIS} tickFormatter={(v: string) => dayjs(`${v}-01`).format("MMM")} />
                  <YAxis {...AXIS} width={40} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip cursor={{ stroke: "var(--border)" }} content={(p) => <ChartTip {...p} format={(v) => `${v}%`} labelFormat={monthLabel} />} />
                  <Line
                    dataKey="rate"
                    name="Attendance"
                    stroke={SERIES[0]}
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 4, fill: SERIES[0], stroke: "var(--card)", strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: SERIES[0], stroke: "var(--card)", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className="py-4">
                <CardTitle className="text-base">Chronic absentees</CardTitle>
                <CardDescription>Below {data.threshold}% this month, with at least 3 days marked</CardDescription>
              </CardHeader>
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Absent</TableHead>
                    <TableHead className="w-36 text-right">Attendance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState empty={data.chronic.length === 0} colSpan={3} emptyText="Nobody below the threshold" />
                  {data.chronic.map((c) => (
                    <TableRow key={c.student_id}>
                      <TableCell>
                        <Link to={`/app/students/${c.student_id}/records`} className="font-medium hover:underline">{c.name}</Link>
                        <div className="text-muted-foreground text-xs">{[c.class_name, c.section_name].filter(Boolean).join(" · ")}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                      <TableCell><Meter value={c.rate} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="py-4"><CardTitle className="text-base">By class and section</CardTitle></CardHeader>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="w-40 text-right">Attendance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState empty={data.sections.length === 0} colSpan={4} emptyText="No attendance taken this month" />
                {data.sections.map((s) => (
                  <TableRow key={`${s.class_id}-${s.section_id}`}>
                    <TableCell className="font-medium">{s.class_name}{s.section_name && ` · ${s.section_name}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.present}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                    <TableCell><Meter value={s.rate} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// --- exams --------------------------------------------------------------------------------------

function Ranked({ title, rows }: { title: string; rows: ExamAnalytics["top"] }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="py-4"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <Table>
        <TableBody>
          <TableState empty={rows.length === 0} colSpan={3} emptyText="Not enough complete results" />
          {rows.map((r) => (
            <TableRow key={r.student_id}>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-muted-foreground text-xs">{r.class_name}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtPct(r.percentage)}</TableCell>
              <TableCell className="w-20 text-right">
                <Badge variant="outline" className={r.result === "Fail" ? "text-destructive" : ""}>{r.result}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ExamsTab() {
  const [examId, setExamId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const { data, isLoading, isError } = useGet<ExamAnalytics>("/analytics/exams", { exam_id: examId ?? undefined, class_id: classId ?? undefined });
  const current = data?.exam_id ? String(data.exam_id) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Exam" className="w-52">
          <Combobox data={toOptions(data?.exams, "exam_id", "name")} value={examId ?? current} onChange={setExamId} placeholder="Latest exam" />
        </Field>
        <ClassFilter value={classId} onChange={setClassId} />
      </div>
      {isError && <EmptyState title="You can only see classes you teach" />}
      {isLoading ? (
        <TileSkeleton />
      ) : data && !data.exam_id ? (
        <EmptyState icon={ClipboardListIcon} title="No marks entered this year yet" />
      ) : (
        data && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Average result by class"
                description="Students with every mark entered"
                table={<TableView head={["Class", "Average", "Pass rate", "Complete"]} rows={data.classes.map((c) => [c.class_name, fmtPct(c.average), fmtPct(c.pass_rate), `${c.complete} of ${c.students}`])} />}
              >
                <ResponsiveContainer>
                  <BarChart data={data.classes} margin={{ top: 20 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="class_name" {...AXIS} />
                    <YAxis {...AXIS} width={40} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(p) => <ChartTip {...p} format={(v) => `${v}%`} />} />
                    <Bar dataKey="average" name="Average" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard
                title="Grade distribution"
                description="Every subject mark in the exam"
                table={<TableView head={["Grade", "Marks"]} rows={data.grades.map((g) => [g.grade, g.count])} />}
              >
                <ResponsiveContainer>
                  <BarChart data={data.grades} margin={{ top: 20 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="grade" {...AXIS} />
                    <YAxis {...AXIS} width={40} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(p) => <ChartTip {...p} format={(v) => String(v)} labelFormat={(l) => `Grade ${l}`} />} />
                    <Bar dataKey="count" name="Marks" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className="py-4">
                <CardTitle className="text-base">Subjects</CardTitle>
                <CardDescription>Lowest pass rate first</CardDescription>
              </CardHeader>
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Marks</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="w-40 text-right">Pass rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableState empty={data.subjects.length === 0} colSpan={5} emptyText="No marks" />
                  {data.subjects.map((s) => (
                    <TableRow key={`${s.class_id}-${s.subject_id}`}>
                      <TableCell className="font-medium">{s.subject}</TableCell>
                      <TableCell>{s.class_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.marks}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(s.average)}</TableCell>
                      <TableCell><Meter value={s.pass_rate} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Ranked title="Top performers" rows={data.top} />
              <Ranked title="Need the most help" rows={data.bottom} />
            </div>
          </>
        )
      )}
    </div>
  );
}

// --- workload -------------------------------------------------------------------------------------

function WorkloadTab() {
  const { data, isLoading } = useGet<TeacherWorkload[]>("/analytics/workload");
  const rows = data ?? [];
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-[860px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Teacher</TableHead>
            <TableHead className="text-right">Periods / week</TableHead>
            <TableHead className="text-right">Subjects</TableHead>
            <TableHead className="text-right">Classes</TableHead>
            <TableHead className="text-right">Homework set</TableHead>
            <TableHead className="text-right">To mark</TableHead>
            <TableHead className="text-right">Meetings</TableHead>
            <TableHead className="text-right">Leave days</TableHead>
            <TableHead className="w-36 text-right">Attendance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={9} emptyText="No teachers" />
          {rows.map((t) => (
            <TableRow key={t.teacher_id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-right tabular-nums">{t.periods_per_week}</TableCell>
              <TableCell className="text-right tabular-nums">{t.subjects}</TableCell>
              <TableCell className="text-right tabular-nums">{t.classes}</TableCell>
              <TableCell className="text-right tabular-nums">{t.homework_set}</TableCell>
              <TableCell className="text-right tabular-nums">
                {t.ungraded > 20 ? <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">{t.ungraded}</Badge> : t.ungraded}
              </TableCell>
              <TableCell className="text-right tabular-nums">{t.meetings}</TableCell>
              <TableCell className="text-right tabular-nums">{t.leave_days}</TableCell>
              <TableCell><Meter value={t.attendance_rate} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// --- page -----------------------------------------------------------------------------------------

const TABS = [
  { value: "risk", label: "At risk", roles: ["admin", "teacher"], body: <AtRiskTab /> },
  { value: "fees", label: "Fees", roles: ["admin", "accountant"], body: <FeesTab /> },
  { value: "attendance", label: "Attendance", roles: ["admin", "teacher"], body: <AttendanceTab /> },
  { value: "exams", label: "Exams", roles: ["admin", "teacher"], body: <ExamsTab /> },
  { value: "workload", label: "Workload", roles: ["admin", "teacher"], body: <WorkloadTab /> },
];

export function AnalyticsPage() {
  const user = useUser();
  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={user.role === "teacher" ? "Your classes and your own workload, for the running year." : "Students who need attention, fee collection, attendance, results and workload for the running year."}
      />
      <Tabs defaultValue={tabs[0]?.value} className="gap-6">
        <TabsList>
          {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map((t) => <TabsContent key={t.value} value={t.value}>{t.body}</TabsContent>)}
      </Tabs>
    </>
  );  // prettier-ignore
}
