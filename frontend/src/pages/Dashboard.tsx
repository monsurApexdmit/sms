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

import { useGet } from "../api/hooks";
import { useUser } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/states";
import { TransportExpiryAlert } from "../components/TransportExpiryAlert";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { fromUnix, initials, money } from "../utils";

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

function Stat({ label, value, icon: Icon, tone = "primary" }: { label: string; value: string | number; icon: LucideIcon; tone?: Tone }) {
  return (
    <Card className="py-5">
      <CardContent className="flex items-center gap-4 px-5">
        <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-full", TONES[tone])}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-muted-foreground truncate text-sm">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const COUNTS: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  students: { label: "Students", icon: GraduationCapIcon, tone: "primary" },
  teachers: { label: "Teachers", icon: PresentationIcon, tone: "info" },
  parents: { label: "Parents", icon: UsersIcon, tone: "violet" },
  present_today: { label: "Present today", icon: UserCheckIcon, tone: "success" },
  absent_today: { label: "Absent today", icon: UserXIcon, tone: "danger" },
  subjects: { label: "My subjects", icon: BookOpenIcon, tone: "info" },
  online_exams: { label: "Online exams", icon: LaptopIcon, tone: "violet" },
  books: { label: "Books", icon: BookOpenIcon, tone: "primary" },
  copies_issued: { label: "Copies issued", icon: BookUpIcon, tone: "info" },
  pending_requests: { label: "Pending requests", icon: ClipboardListIcon, tone: "warning" },
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
            {s.roll && <Badge variant="secondary">Roll {s.roll}</Badge>}
            {s.unpaid_invoices > 0 && (
              <Badge className="bg-warning/20 border-transparent text-amber-700 dark:text-amber-300">
                {s.unpaid_invoices} unpaid invoice{s.unpaid_invoices === 1 ? "" : "s"}
              </Badge>
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Present (month)" value={s.attendance_this_month.present} icon={UserCheckIcon} tone="success" />
        <MiniStat label="Absent (month)" value={s.attendance_this_month.absent} icon={UserXIcon} tone="danger" />
        <MiniStat label="Amount due" value={money(s.due, currency)} icon={CreditCardIcon} tone="warning" />
        <MiniStat label="Online exams" value={s.upcoming_online_exams} icon={LaptopIcon} tone="violet" />
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
      <PageHeader title={`Welcome, ${user.name}`} subtitle={data ? `Academic year ${data.running_year}` : undefined} />
      <div className="space-y-6">
        {isLoading && <StatSkeletons />}
        {user.role === "admin" && <TransportExpiryAlert />}
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
            <Stat label="Income this year" value={money(data.finance.income, currency)} icon={TrendingUpIcon} tone="success" />
            <Stat label="Expenses this year" value={money(data.finance.expense, currency)} icon={TrendingDownIcon} tone="danger" />
            <Stat label="Unpaid invoices" value={data.finance.unpaid_invoices} icon={ReceiptIcon} tone="warning" />
          </div>
        )}
        {data?.student && <StudentCard s={data.student} currency={currency} />}
        {data?.children?.map((c) => <StudentCard key={c.student_id} s={c} currency={currency} />)}
        {data?.children?.length === 0 && (
          <EmptyState icon={UsersIcon} title="No children linked yet">
            No children are linked to your account yet.
          </EmptyState>
        )}

        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MegaphoneIcon className="text-muted-foreground size-4" />
                Latest notices
              </CardTitle>
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
                <EmptyState icon={InboxIcon} title="No notices" className="p-6" />
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDaysIcon className="text-muted-foreground size-4" />
                Upcoming events
              </CardTitle>
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
                <EmptyState icon={CalendarIcon} title="No upcoming events" className="p-6" />
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
