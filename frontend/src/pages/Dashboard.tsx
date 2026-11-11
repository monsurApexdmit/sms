import {
  BookOpenIcon,
  BookUpIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClipboardListIcon,
  CreditCardIcon,
  GraduationCapIcon,
  InboxIcon,
  LaptopIcon,
  SparklesIcon,
  MegaphoneIcon,
  PresentationIcon,
  ReceiptIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UserXIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import dayjs from "dayjs";
import { Link } from "react-router-dom";

import { useGet, usePublicSettings } from "../api/hooks";
import { useUser } from "../auth/AuthContext";
import { AiProgressSummary } from "../components/Ai";
import { AnalyticsTiles } from "../components/AnalyticsTiles";
import { EmptyState } from "../components/states";
import { TransportExpiryAlert } from "../components/TransportExpiryAlert";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { navFor } from "../nav";
import { fromUnix, initials, money, titleCase } from "../utils";
import { t, tn, tp } from "../i18n";

interface StudentSummary {
  student_id: number;
  name: string;
  roll: number | null;
  attendance_this_month: { present: number; absent: number };
  unpaid_invoices: number;
  due: number;
  upcoming_online_exams: number;
}

interface DashboardData {
  running_year: string;
  notices: { notice_id: number; notice_title: string; create_timestamp: string }[];
  events: { title: string; timestamp: number }[];
  counts?: Record<string, number>;
  finance?: { income: number; expense: number; unpaid_invoices: number; currency: string };
  student?: StudentSummary;
  children?: StudentSummary[];
}

type Tone = "primary" | "success" | "danger" | "warning" | "info" | "violet";

const TONES: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/20 text-amber-700 dark:text-amber-300",
  info: "bg-chart-2/15 text-chart-2",
  violet: "bg-chart-5/15 text-chart-5",
};

const BARS: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-chart-2",
  violet: "bg-chart-5",
};

function Stat({ label, value, icon: Icon, tone = "primary" }: { label: string; value: string | number; icon: LucideIcon; tone?: Tone }) {
  return (
    <Card className="group relative overflow-hidden py-5 transition-shadow hover:shadow-md">
      <div className={cn("absolute inset-y-0 left-0 w-1", BARS[tone])} />
      <div className={cn("absolute -right-6 -bottom-6 size-24 rounded-full opacity-60 transition-transform group-hover:scale-110", TONES[tone])} />
      <CardContent className="relative flex items-center justify-between gap-4 px-5">
        <div className="min-w-0">
          <div className="text-muted-foreground truncate text-xs font-semibold tracking-wide uppercase">{label}</div>
          <div className="mt-1.5 truncate text-[1.7rem] leading-none font-bold tracking-tight tabular-nums">{value}</div>
        </div>
        <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", TONES[tone])}>
          <Icon className="size-[22px]" />
        </div>
      </CardContent>
    </Card>
  );
}

// Shortcuts on the welcome banner: the first of these the user's role can open.
const SHORTCUTS = ["admissions", "students", "attendance", "invoices", "marks", "homework", "my-routine", "notices", "messages"];

function greeting(name: string) {
  const h = new Date().getHours();
  if (h < 12) return t("Good morning, {name}", { name });
  if (h < 17) return t("Good afternoon, {name}", { name });
  return t("Good evening, {name}", { name });
}

function WelcomeBanner({ year }: { year?: string }) {
  const user = useUser();
  const school = usePublicSettings().data?.system_name;
  const links = navFor(user.role, user.permissions)
    .filter((n) => SHORTCUTS.includes(n.path))
    .sort((a, b) => SHORTCUTS.indexOf(a.path) - SHORTCUTS.indexOf(b.path))
    .slice(0, 4);
  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(120deg,var(--site-ink),color-mix(in_oklch,var(--primary),var(--site-ink)_35%))] p-6 text-white shadow-lg md:p-8">
      <div className="site-dots absolute inset-0 -z-10 text-white/[0.07]" />
      <div className="bg-gold/25 absolute -top-24 -right-16 -z-10 size-72 rounded-full blur-3xl" />
      <GraduationCapIcon className="absolute -right-6 -bottom-10 -z-10 size-56 text-white/[0.06]" strokeWidth={1.2} />
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl space-y-2">
          <p className="text-gold inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.18em] uppercase">
            <SparklesIcon className="size-3.5" />
            {dayjs().format("dddd, D MMMM YYYY")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting(user.name.split(" ")[0] || user.name)}</h1>
          <p className="text-sm text-white/70">
            {[school, tn("{titleCase} portal", { titleCase: titleCase(user.role) }), year && t("Academic year {running_year}", { running_year: year })].filter(Boolean).join(" · ")}
          </p>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link
                key={l.path}
                to={`/app/${l.path}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/20"
              >
                <l.icon className="text-gold size-4" />
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const COUNTS: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  students: { label: t("Students"), icon: GraduationCapIcon, tone: "primary" },
  teachers: { label: t("Teachers"), icon: PresentationIcon, tone: "info" },
  parents: { label: t("Parents"), icon: UsersIcon, tone: "violet" },
  present_today: { label: t("Present today"), icon: UserCheckIcon, tone: "success" },
  absent_today: { label: t("Absent today"), icon: UserXIcon, tone: "danger" },
  subjects: { label: t("My subjects"), icon: BookOpenIcon, tone: "info" },
  online_exams: { label: t("Online exams"), icon: LaptopIcon, tone: "violet" },
  books: { label: t("Books"), icon: BookOpenIcon, tone: "primary" },
  copies_issued: { label: t("Copies issued"), icon: BookUpIcon, tone: "info" },
  pending_requests: { label: t("Pending requests"), icon: ClipboardListIcon, tone: "warning" },
};

const GRID_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

function StudentCard({ s, currency }: { s: StudentSummary; currency: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full text-sm font-semibold">
          {initials(s.name)}
        </div>
        <div className="space-y-1">
          <CardTitle>{s.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {s.roll && <Badge variant="secondary">{tn("Roll {roll}", { roll: s.roll })}</Badge>}
            {s.unpaid_invoices > 0 && (
              <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">
                {tp(s.unpaid_invoices, "{count} unpaid invoice", "{count} unpaid invoices")}
              </Badge>
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label={t("Present (month)")} value={s.attendance_this_month.present} icon={UserCheckIcon} tone="success" />
        <MiniStat label={t("Absent (month)")} value={s.attendance_this_month.absent} icon={UserXIcon} tone="danger" />
        <MiniStat label={t("Amount due")} value={money(s.due, currency)} icon={CreditCardIcon} tone="warning" />
        <MiniStat label={t("Online exams")} value={s.upcoming_online_exams} icon={LaptopIcon} tone="violet" />
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: LucideIcon; tone: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", TONES[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold tabular-nums">{value}</div>
        <div className="text-muted-foreground truncate text-xs">{label}</div>
      </div>
    </div>
  );
}

function StatSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="py-5">
          <CardContent className="flex items-center gap-4 px-5">
            <Skeleton className="size-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const user = useUser();
  const { data, isLoading } = useGet<DashboardData>("/dashboard");
  const currency = data?.finance?.currency ?? "usd";
  const countKeys = Object.keys(data?.counts ?? {});

  return (
    <>
      <div className="space-y-6">
        <WelcomeBanner year={data?.running_year} />
        {isLoading && <StatSkeletons />}
        {user.role === "admin" && <TransportExpiryAlert />}
        {user.role === "admin" && <AnalyticsTiles />}
        {data?.counts && (
          <div className={cn("grid gap-4 sm:grid-cols-2", GRID_COLS[Math.min(countKeys.length, 5)])}>
            {Object.entries(data.counts).map(([k, v]) => {
              const meta = COUNTS[k] ?? { label: k, icon: GraduationCapIcon, tone: "primary" as Tone };
              return <Stat key={k} label={meta.label} value={v} icon={meta.icon} tone={meta.tone} />;
            })}
          </div>
        )}
        {data?.finance && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t("Income this year")} value={money(data.finance.income, currency)} icon={TrendingUpIcon} tone="success" />
            <Stat label={t("Expenses this year")} value={money(data.finance.expense, currency)} icon={TrendingDownIcon} tone="danger" />
            <Stat label={t("Unpaid invoices")} value={data.finance.unpaid_invoices} icon={ReceiptIcon} tone="warning" />
          </div>
        )}
        {data?.student && <StudentCard s={data.student} currency={currency} />}
        {data?.children?.map((c) => (
          <div key={c.student_id} className="space-y-3">
            <StudentCard s={c} currency={currency} />
            <AiProgressSummary studentId={c.student_id} />
          </div>
        ))}
        {data?.children?.length === 0 && (
          <EmptyState icon={UsersIcon} title={t("No children linked yet")}>
            {t("No children are linked to your account yet.")}</EmptyState>
        )}

        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg"><MegaphoneIcon className="size-4" /></span>
                {t("Latest notices")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <ListSkeleton />
              ) : data?.notices.length ? (
                <ul className="divide-y">
                  {data.notices.map((n) => (
                    <li key={n.notice_id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="font-medium">{n.notice_title}</span>
                      <span className="text-muted-foreground shrink-0 text-sm">{fromUnix(n.create_timestamp)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={InboxIcon} title={t("No notices")} className="p-6" />
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="bg-chart-2/15 text-chart-2 flex size-8 items-center justify-center rounded-lg"><CalendarDaysIcon className="size-4" /></span>
                {t("Upcoming events")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <ListSkeleton />
              ) : data?.events.length ? (
                <ul className="space-y-3">
                  {data.events.map((e, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <div className="bg-primary/10 text-primary flex w-12 shrink-0 flex-col items-center rounded-md py-1 leading-tight">
                        <span className="text-[10px] font-medium uppercase">{fromUnix(e.timestamp, "MMM")}</span>
                        <span className="text-base font-semibold">{fromUnix(e.timestamp, "DD")}</span>
                      </div>
                      <span className="min-w-0 truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={CalendarIcon} title={t("No upcoming events")} className="p-6" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
