import dayjs from "dayjs";
import {
  CameraIcon,
  CameraOffIcon,
  CheckIcon,
  ClipboardListIcon,
  ClockIcon,
  CopyIcon,
  KeyRoundIcon,
  MaximizeIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ScanLineIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useGet, useList, usePagedList } from "../api/hooks";
import type { AttendanceDeviceInfo, AttendancePunchInfo, IdCardInfo, PeriodInfo, PeriodSheet, PeriodStatus, ScanResult, StaffMember, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { initials, toOptions } from "../utils";

// --- per-period attendance ------------------------------------------------------------------

const PERIOD_STATUS: { value: PeriodStatus; label: string; on: string; badge: string }[] = [
  { value: "present", label: "Present", on: "data-[state=on]:bg-success/15 data-[state=on]:text-success", badge: "bg-success/15 text-success" },
  { value: "absent", label: "Absent", on: "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive", badge: "bg-destructive/10 text-destructive" },
  { value: "late", label: "Late", on: "data-[state=on]:bg-warning/20 data-[state=on]:text-amber-700", badge: "bg-warning/20 text-amber-700 dark:text-amber-300" },
  { value: "excused", label: "Excused", on: "data-[state=on]:bg-muted data-[state=on]:text-foreground", badge: "bg-muted text-foreground" },
];
const SHORT: Record<PeriodStatus, string> = { present: "P", absent: "A", late: "L", excused: "E" };
const statusBadge = (s: PeriodStatus) => PERIOD_STATUS.find((x) => x.value === s)?.badge;

function PeriodSheetCard({ period, date, onClose }: { period: PeriodInfo; date: string; onClose: () => void }) {
  const sheet = useGet<PeriodSheet>("/period-attendance/sheet", { class_routine_id: period.class_routine_id, date });
  const [marks, setMarks] = useState<Record<number, PeriodStatus>>({});
  useEffect(() => {
    // unmarked students default to present: tap only the exceptions
    setMarks(Object.fromEntries((sheet.data?.rows ?? []).map((r) => [r.student_id, r.status ?? "present"])));
  }, [sheet.data]);
  const save = useAction(
    () => api.put("/period-attendance/sheet", { class_routine_id: period.class_routine_id, date, items: Object.entries(marks).map(([id, status]) => ({ student_id: Number(id), status })) }),
    { success: "Period attendance saved", invalidate: [["/period-attendance/sheet"], ["/period-attendance/periods"], ["/period-attendance/day"]] },
  );
  const rows = sheet.data?.rows ?? [];
  const count = (s: PeriodStatus) => Object.values(marks).filter((m) => m === s).length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div>
          <div className="font-semibold">
            {period.subject_name ?? "Subject"} · Class {period.class_name}
            {period.section_name ? ` ${period.section_name}` : ""}
          </div>
          <div className="text-muted-foreground text-sm">
            {dayjs(date).format("dddd, DD MMM YYYY")} · {period.start}–{period.end}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIOD_STATUS.map((s) => (
            <Badge key={s.value} className={cn("border-transparent", s.badge)}>
              {s.label} {count(s.value)}
            </Badge>
          ))}
        </div>
      </div>
      <Table className="min-w-[520px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-16">Roll</TableHead>
            <TableHead>Student</TableHead>
            <TableHead className="w-80">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={sheet.isLoading} empty={!sheet.isLoading && rows.length === 0} colSpan={3} emptyText="No students enrolled in this section" />
          {rows.map((r) => (
            <TableRow key={r.student_id}>
              <TableCell className="text-muted-foreground">{r.roll ?? <Dash />}</TableCell>
              <TableCell className="font-medium">
                {r.name}
                {r.on_leave && <Badge variant="secondary" className="ml-2">On leave</Badge>}
              </TableCell>
              <TableCell>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-label={`Period attendance for ${r.name}`}
                  value={marks[r.student_id] ?? "present"}
                  onValueChange={(v) => v && setMarks((m) => ({ ...m, [r.student_id]: v as PeriodStatus }))}
                >
                  {PERIOD_STATUS.map((s) => (
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
      <CardFooter className="bg-muted/30 justify-end gap-2 border-t px-4 py-3 [.border-t]:pt-3">
        <Button variant="outline" onClick={onClose}>Back to periods</Button>
        <Button loading={save.isPending} disabled={rows.length === 0} onClick={() => save.mutate(undefined)}>
          <SaveIcon />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function PeriodList({ date, onOpen }: { date: string; onOpen: (p: PeriodInfo) => void }) {
  const user = useUser();
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const periods = useGet<PeriodInfo[]>("/period-attendance/periods", { date, class_id: sel.classId || undefined, section_id: sel.sectionId || undefined });
  return (
    <div className="space-y-4">
      {user.role === "admin" && (
        <Card className="py-4">
          <CardContent className="px-4">
            <ClassPicker value={sel} onChange={setSel} />
          </CardContent>
        </Card>
      )}
      {periods.isLoading ? null : (periods.data ?? []).length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title="No periods on this day">
          {user.role === "teacher" ? "None of your subjects is on the class routine for this weekday." : "Nothing on the class routine for this weekday."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(periods.data ?? []).map((p) => (
            <button
              key={p.class_routine_id}
              type="button"
              onClick={() => onOpen(p)}
              className="hover:border-primary bg-card flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors"
            >
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <ClockIcon className="size-3.5" />
                {p.start}–{p.end}
              </div>
              <div className="font-semibold">{p.subject_name ?? "Subject"}</div>
              <div className="text-muted-foreground text-sm">
                Class {p.class_name}
                {p.section_name ? ` · Section ${p.section_name}` : ""}
              </div>
              <div className="mt-1">
                {p.marked ? (
                  <Badge className="bg-success/15 text-success border-transparent">
                    <CheckIcon />
                    Taken ({p.marked})
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not taken</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DayGrid {
  periods: PeriodInfo[];
  rows: { student_id: number; name: string | null; roll: number | null; statuses: Record<string, PeriodStatus> }[];
}

function SectionDay({ date }: { date: string }) {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [overwrite, setOverwrite] = useState(false);
  const ready = sel.classId && sel.sectionId;
  const grid = useGet<DayGrid>(ready ? "/period-attendance/day" : null, { class_id: sel.classId, section_id: sel.sectionId, date });
  const fill = useAction(
    () => api.post<{ updated: number; kept: number; skipped: number }>("/period-attendance/fill-daily", { class_id: Number(sel.classId), section_id: Number(sel.sectionId), date, overwrite }),
    {
      invalidate: [["/attendance/sheet"], ["/attendance/report"]],
      onSuccess: (r) => toast.success(`Daily attendance: ${r.data.updated} updated, ${r.data.kept} already marked, ${r.data.skipped} without periods`),
    },
  );
  const periods = grid.data?.periods ?? [];
  return (
    <div className="space-y-4">
      <Card className="py-4">
        <CardContent className="px-4">
          <ClassPicker value={sel} onChange={setSel} />
        </CardContent>
      </Card>
      {ready && grid.data && (
        <Card className="gap-0 overflow-hidden py-0">
          <Table className="border-collapse text-xs [&_td]:border [&_th]:border">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="min-w-44">Student</TableHead>
                {periods.map((p) => (
                  <TableHead key={p.class_routine_id} className="h-auto px-2 py-1 text-center">
                    <div className="text-[10px] font-normal">{p.start}</div>
                    <div>{p.subject_name}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState empty={grid.data.rows.length === 0} colSpan={periods.length + 1} emptyText="No students enrolled in this section" />
              {grid.data.rows.map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="font-medium">
                    {r.roll ? <span className="text-muted-foreground">{r.roll}. </span> : null}
                    {r.name}
                  </TableCell>
                  {periods.map((p) => {
                    const s = r.statuses[String(p.class_routine_id)];
                    return (
                      <TableCell key={p.class_routine_id} className={cn("text-center font-semibold", s && statusBadge(s))}>
                        {s ? SHORT[s] : ""}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <CardFooter className="bg-muted/30 flex-wrap justify-between gap-3 border-t px-4 py-3 [.border-t]:pt-3">
            <p className="text-muted-foreground max-w-xl text-sm">
              Daily attendance is the official record. Filling it from periods marks a student present if they were present or late in at least one period, and absent if
              absent in every marked period.
            </p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)} />
                Replace days already marked
              </label>
              <Button
                disabled={periods.every((p) => !p.marked)}
                loading={fill.isPending}
                onClick={() =>
                  confirmAction({
                    title: "Fill daily attendance from periods?",
                    description: overwrite ? "Daily attendance already taken for this day will be replaced." : "Students already marked in the daily sheet are kept. No absence SMS is sent.",
                    onConfirm: () => fill.mutate(undefined),
                  })
                }
              >
                <WandSparklesIcon />
                Fill daily attendance
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export function PeriodAttendancePage() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [open, setOpen] = useState<PeriodInfo | null>(null);
  const pickDate = (v: string) => {
    if (v && dayjs(v).isAfter(dayjs(), "day")) {
      toast.error("Attendance can't be taken for a future date");
      return;
    }
    setDate(v);
    setOpen(null);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Period attendance"
        subtitle="Take attendance for each period of the class routine. Everyone starts as present; tap the exceptions."
        actions={
          <Field label="Date" className="w-48">
            <DatePicker value={date} onChange={pickDate} clearable={false} />
          </Field>
        }
      />
      <Tabs defaultValue="periods" className="gap-6">
        <TabsList>
          <TabsTrigger value="periods">Periods</TabsTrigger>
          <TabsTrigger value="day">Section day</TabsTrigger>
        </TabsList>
        <TabsContent value="periods">
          {open ? <PeriodSheetCard key={`${open.class_routine_id}-${date}`} period={open} date={date} onClose={() => setOpen(null)} /> : <PeriodList date={date} onOpen={setOpen} />}
        </TabsContent>
        <TabsContent value="day">
          <SectionDay date={date} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- check-in kiosk ---------------------------------------------------------------------------

const RESULT_STYLE: Record<string, string> = {
  marked_present: "border-success bg-success/10 text-success",
  checked_out: "border-success bg-success/10 text-success",
  marked_late: "border-warning bg-warning/15 text-amber-700 dark:text-amber-300",
  already_marked: "border-primary bg-primary/10 text-primary",
  duplicate: "border-primary bg-primary/10 text-primary",
};
const resultStyle = (r: string) => RESULT_STYLE[r] ?? "border-destructive bg-destructive/10 text-destructive";

// Minimal typing for the Shape Detection API (Chromium, Android, Safari 17+).
interface DetectedCode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedCode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
const barcodeDetector = () => (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        timer = window.setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          try {
            const [code] = await detector.detect(video.current);
            const now = Date.now();
            // the same card held in front of the camera is read once every few seconds
            if (code?.rawValue && (code.rawValue !== last.current.code || now - last.current.at > 4000)) {
              last.current = { code: code.rawValue, at: now };
              onCode(code.rawValue);
            }
          } catch {
            /* frame not ready */
          }
        }, 400);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Camera not available"));
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  if (error) return <p className="text-destructive text-sm">{error}</p>;
  return <video ref={video} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />;
}

export function KioskPage() {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<ScanResult[]>([]);
  const canCamera = !!barcodeDetector() && !!navigator.mediaDevices?.getUserMedia;

  const scan = useRef(async (value: string, source: "qr" | "rfid" | "manual") => {
    const uid = value.trim();
    if (!uid) return;
    try {
      const { data } = await api.post<ScanResult>("/attendance-kiosk/scan", { card_uid: uid, source });
      setLast(data);
      setRecent((r) => [data, ...r].slice(0, 12));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }).current;
  const onCameraCode = useRef((value: string) => void scan(value, "qr")).current;

  // keep the reader input focused: USB barcode/RFID readers type the code followed by Enter
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT" || document.activeElement === document.body) input.current?.focus();
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-in kiosk"
        subtitle="Scan an ID card with a barcode/QR or RFID reader, or the camera. Students are marked present for the day; staff check in and out."
        actions={
          <>
            {canCamera && (
              <Button variant="outline" onClick={() => setCamera((c) => !c)}>
                {camera ? <CameraOffIcon /> : <CameraIcon />}
                {camera ? "Stop camera" : "Use camera"}
              </Button>
            )}
            <Button variant="outline" onClick={() => void document.documentElement.requestFullscreen?.()}>
              <MaximizeIcon />
              Full screen
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void scan(code, "rfid");
              setCode("");
            }}
          >
            <div className="relative">
              <ScanLineIcon className="text-muted-foreground absolute top-1/2 left-4 size-6 -translate-y-1/2" />
              <Input
                ref={input}
                autoFocus
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan a card…"
                aria-label="Card code"
                className="h-16 pl-14 text-2xl"
              />
            </div>
          </form>
          {camera && <CameraScanner onCode={onCameraCode} />}
          <div className={cn("flex min-h-64 items-center gap-6 rounded-2xl border-2 p-6 transition-colors", last ? resultStyle(last.result) : "border-dashed")}>
            {last ? (
              <>
                <div className="bg-muted text-muted-foreground flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-full text-4xl font-semibold">
                  {last.image_url ? <img src={last.image_url} alt="" className="size-full object-cover" /> : initials(last.name ?? "?")}
                </div>
                <div className="min-w-0">
                  <div className="text-foreground truncate text-3xl font-bold">{last.name ?? last.card_uid}</div>
                  <div className="mt-1 text-2xl font-semibold">{last.message}</div>
                  <div className="text-muted-foreground mt-2 text-sm">
                    {last.holder_role ? `${last.holder_role} · ` : ""}
                    {last.punched_at ? dayjs(last.punched_at).format("HH:mm") : ""}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground m-auto text-lg">Waiting for the first scan</p>
            )}
          </div>
        </div>
        <Card className="gap-0 py-0">
          <div className="border-b p-3 font-semibold">Recent scans</div>
          <ul className="divide-y">
            {recent.length === 0 && <li className="text-muted-foreground p-3 text-sm">None yet</li>}
            {recent.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="truncate font-medium">{r.name ?? r.card_uid}</span>
                <Badge className={cn("shrink-0 border-transparent", resultStyle(r.result))}>{r.message}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// --- ID cards, devices and settings (admin) ---------------------------------------------------

const ROLES = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "librarian", label: "Librarian" },
  { value: "accountant", label: "Accountant" },
];

interface CardValues {
  holder_role: string;
  holder_id: string | null;
  card_uid: string;
}

function IssueCardForm({ onDone }: { onDone: () => void }) {
  const form = useForm<CardValues>({ defaultValues: { holder_role: "student", holder_id: null, card_uid: "" } });
  const role = form.watch("holder_role");
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const students = useList<Student>(role === "student" && sel.classId ? "/students" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined, limit: 1000 });
  const staff = useGet<StaffMember[]>(role !== "student" ? "/hr/staff" : null);
  const holders =
    role === "student"
      ? toOptions(students.data?.items, "student_id", "name")
      : (staff.data ?? []).filter((s) => s.staff_role === role).map((s) => ({ value: String(s.staff_id), label: s.name }));
  const save = useAction(
    (v: CardValues) => api.post("/id-cards", { holder_role: v.holder_role, holder_id: Number(v.holder_id), card_uid: v.card_uid.trim() || null }),
    { success: "Card issued", invalidate: [["/id-cards"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Controller control={form.control} name="holder_role" render={({ field }) => (
        <Field label="Card for">
          <Combobox data={ROLES} value={field.value} onChange={(v) => { field.onChange(v ?? "student"); form.setValue("holder_id", null); }} />
        </Field>
      )} />
      {role === "student" && <ClassPicker value={sel} onChange={setSel} />}
      <Controller control={form.control} name="holder_id" rules={{ required: "Required" }} render={({ field, fieldState }) => (
        <Field label="Person" required error={fieldState.error?.message}>
          <Combobox data={holders} value={field.value} onChange={field.onChange} placeholder="Choose…" />
        </Field>
      )} />
      <Field label="Card code" htmlFor="card-uid" description="Scan the RFID card or type its UID. Leave empty to generate a barcode code.">
        <Input id="card-uid" autoComplete="off" {...form.register("card_uid")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Issue card</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function CardsTab() {
  const [role, setRole] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const [showRevoked, setShowRevoked] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const { data, isLoading, page, setPage, pageSize } = usePagedList<IdCardInfo>("/id-cards", {
    holder_role: role ?? undefined, class_id: sel.classId || undefined, section_id: sel.sectionId || undefined, active: showRevoked ? undefined : true,
  });  // prettier-ignore
  const bulk = useAction(() => api.post<{ created: number }>("/id-cards/bulk", { class_id: Number(sel.classId), section_id: sel.sectionId ? Number(sel.sectionId) : null }), {
    invalidate: [["/id-cards"]],
    onSuccess: (r) => toast.success(`${r.data.created} card(s) created`),
  });
  const revoke = useAction((id: number) => api.post(`/id-cards/${id}/revoke`), { success: "Card revoked", invalidate: [["/id-cards"]] });
  const rows = data?.items ?? [];
  return (
    <div className="space-y-4">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <Field label="Holder" className="w-44">
            <Combobox data={ROLES} value={role} onChange={setRole} clearable placeholder="Everyone" />
          </Field>
          <ClassPicker value={sel} onChange={setSel} />
          <label className="flex h-9 items-center gap-2 text-sm">
            <Switch checked={showRevoked} onCheckedChange={setShowRevoked} />
            Include revoked
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              disabled={!sel.classId}
              loading={bulk.isPending}
              onClick={() => confirmAction({ title: "Create cards for this class?", description: "Students without an active card get one (their student code is used when set).", onConfirm: () => bulk.mutate(undefined) })}
            >
              <WandSparklesIcon />
              Cards for whole class
            </Button>
            <Button onClick={() => setIssuing(true)}>
              <PlusIcon />
              Issue card
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Holder</TableHead>
              <TableHead className="w-32">Role</TableHead>
              <TableHead>Card code</TableHead>
              <TableHead className="w-32">Issued</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={5} emptyText="No cards" />
            {rows.map((c) => (
              <TableRow key={c.card_id} className={cn(!c.active && "opacity-60")}>
                <TableCell className="font-medium">{c.holder_name ?? <Dash />}</TableCell>
                <TableCell className="capitalize">{c.holder_role}</TableCell>
                <TableCell className="font-mono text-xs">
                  {c.card_uid}
                  {!c.active && <Badge variant="secondary" className="ml-2">Revoked</Badge>}
                </TableCell>
                <TableCell>{dayjs(c.issued_on).format("DD MMM YYYY")}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    {c.active && (
                      <IconAction label="Revoke" destructive onClick={() => confirmAction({ title: `Revoke card ${c.card_uid}?`, description: "It stops working at once.", onConfirm: () => revoke.mutate(c.card_id) })}>
                        <Trash2Icon />
                      </IconAction>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </Card>
      <Dialog open={issuing} onOpenChange={setIssuing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue a card</DialogTitle>
            <DialogDescription>A person has one active card; issuing a new one revokes the old one.</DialogDescription>
          </DialogHeader>
          {issuing && <IssueCardForm onDone={() => setIssuing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DevicesTab() {
  const devices = useGet<AttendanceDeviceInfo[]>("/attendance-devices");
  const [editing, setEditing] = useState<AttendanceDeviceInfo | "new" | null>(null);
  const [key, setKey] = useState<AttendanceDeviceInfo | null>(null);
  const form = useForm<{ name: string; location: string; active: boolean }>();
  const open = (d: AttendanceDeviceInfo | "new") => {
    setEditing(d);
    form.reset(d === "new" ? { name: "", location: "", active: true } : { name: d.name, location: d.location ?? "", active: d.active });
  };
  const save = useAction(
    async (v: { name: string; location: string; active: boolean }) => {
      const body = { ...v, location: v.location || null };
      if (editing && editing !== "new") return (await api.put<AttendanceDeviceInfo>(`/attendance-devices/${editing.device_id}`, body)).data;
      return (await api.post<AttendanceDeviceInfo>("/attendance-devices", body)).data;
    },
    { success: "Saved", invalidate: [["/attendance-devices"]], onSuccess: (d) => { setEditing(null); if (d.api_key) setKey(d); } },
  );  // prettier-ignore
  const rotate = useAction((id: number) => api.post<AttendanceDeviceInfo>(`/attendance-devices/${id}/rotate-key`), { invalidate: [["/attendance-devices"]], onSuccess: (r) => setKey(r.data) });
  const remove = useAction((id: number) => api.delete(`/attendance-devices/${id}`), { success: "Deleted", invalidate: [["/attendance-devices"]] });
  const punchUrl = `${window.location.origin}/api/attendance-devices/punch`;

  return (
    <div className="space-y-4">
      <Alert>
        <KeyRoundIcon />
        <AlertTitle>Connecting a terminal</AlertTitle>
        <AlertDescription>
          RFID or biometric terminals (or the middleware that reads them) send <code>POST {punchUrl}</code> with the header <code>X-Device-Key</code> and a JSON body{" "}
          <code>{'{"card_uid": "…", "timestamp": "2026-03-09T07:45:00"}'}</code> or <code>{'{"punches": [...]}'}</code> for a backlog.
        </AlertDescription>
      </Alert>
      <div className="flex justify-end">
        <Button onClick={() => open("new")}>
          <PlusIcon />
          Add device
        </Button>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-44">Last seen</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={devices.isLoading} empty={!devices.isLoading && (devices.data ?? []).length === 0} colSpan={5} emptyText="No devices" />
            {(devices.data ?? []).map((d) => (
              <TableRow key={d.device_id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.location ?? <Dash />}</TableCell>
                <TableCell>{d.active ? <Badge className="bg-success/15 text-success border-transparent">Active</Badge> : <Badge variant="secondary">Disabled</Badge>}</TableCell>
                <TableCell>{d.last_seen_at ? dayjs(d.last_seen_at).format("DD MMM YYYY HH:mm") : <Dash />}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction label="Edit" onClick={() => open(d)}><PencilIcon /></IconAction>
                    <IconAction label="New key" onClick={() => confirmAction({ title: `Replace the key of ${d.name}?`, description: "The old key stops working at once.", onConfirm: () => rotate.mutate(d.device_id) })}>
                      <RefreshCwIcon />
                    </IconAction>
                    <IconAction label="Delete" destructive onClick={() => confirmAction({ title: `Delete ${d.name}?`, onConfirm: () => remove.mutate(d.device_id) })}>
                      <Trash2Icon />
                    </IconAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add device" : "Edit device"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
            <Field label="Name" htmlFor="dev-name" required error={form.formState.errors.name?.message}>
              <Input id="dev-name" {...form.register("name", { required: "Required" })} />
            </Field>
            <Field label="Location" htmlFor="dev-loc">
              <Input id="dev-loc" placeholder="Main gate" {...form.register("location")} />
            </Field>
            <Controller control={form.control} name="active" render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                Active
              </label>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={key !== null} onOpenChange={(o) => !o && setKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Device key for {key?.name}</DialogTitle>
            <DialogDescription>Copy it into the device now. It is shown only once; if it is lost, create a new key.</DialogDescription>
          </DialogHeader>
          <div className="bg-muted flex items-center gap-2 rounded-md p-3 font-mono text-xs break-all">
            <span className="flex-1">{key?.api_key}</span>
            <IconAction label="Copy" onClick={() => void navigator.clipboard?.writeText(key?.api_key ?? "").then(() => toast.success("Copied"))}>
              <CopyIcon />
            </IconAction>
          </div>
          <DialogFooter>
            <Button onClick={() => setKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );  // prettier-ignore
}

function SettingsTab() {
  const { data } = useGet<{ late_after: string | null; duplicate_minutes: number }>("/attendance-capture/settings");
  const [lateAfter, setLateAfter] = useState("");
  const [dup, setDup] = useState("10");
  useEffect(() => {
    if (!data) return;
    setLateAfter(data.late_after ?? "");
    setDup(String(data.duplicate_minutes));
  }, [data]);
  const save = useAction(() => api.put("/attendance-capture/settings", { late_after: lateAfter || null, duplicate_minutes: Number(dup) || 0 }), {
    success: "Settings saved",
    invalidate: [["/attendance-capture/settings"]],
  });
  return (
    <Card className="max-w-xl gap-4">
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Late after" htmlFor="late-after" description="Scans after this time count as late. Empty = never late.">
          <Input id="late-after" type="time" value={lateAfter} onChange={(e) => setLateAfter(e.target.value)} />
        </Field>
        <Field label="Ignore repeat scans for (minutes)" htmlFor="dup-min">
          <Input id="dup-min" type="number" min={0} max={240} value={dup} onChange={(e) => setDup(e.target.value)} />
        </Field>
      </CardContent>
      <CardFooter className="justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          <SaveIcon />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

const RESULT_LABEL: Record<string, string> = {
  marked_present: "Present",
  marked_late: "Late",
  checked_out: "Checked out",
  already_marked: "Already marked",
  duplicate: "Repeat scan",
  unknown_card: "Unknown card",
  not_enrolled: "Not enrolled",
  invalid_time: "Future time",
};

function ScanLogTab() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const { data, isLoading, page, setPage, pageSize } = usePagedList<AttendancePunchInfo>("/attendance-punches", { date: date || undefined });
  const rows = data?.items ?? [];
  return (
    <div className="space-y-4">
      <Field label="Date" className="w-48">
        <DatePicker value={date} onChange={setDate} />
      </Field>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-40">Time</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Card</TableHead>
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-36">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={5} emptyText="No scans" />
            {rows.map((p) => (
              <TableRow key={p.punch_id}>
                <TableCell className="tabular-nums">{dayjs(p.punched_at).format("DD MMM HH:mm:ss")}</TableCell>
                <TableCell className="font-medium">
                  {p.name ?? <Dash />}
                  {p.holder_role && <span className="text-muted-foreground ml-1 text-xs capitalize">{p.holder_role}</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.card_uid}</TableCell>
                <TableCell className="capitalize">{p.source}</TableCell>
                <TableCell>
                  <Badge className={cn("border-transparent", resultStyle(p.result))}>{RESULT_LABEL[p.result] ?? p.result}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </Card>
    </div>
  );
}

export function CardsDevicesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="ID cards & devices" subtitle="Cards people scan at the kiosk or at RFID/biometric terminals, the terminals themselves, and the scan log." />
      <Tabs defaultValue="cards" className="gap-6">
        <TabsList>
          <TabsTrigger value="cards">Cards</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="log">Scan log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="cards"><CardsTab /></TabsContent>
        <TabsContent value="devices"><DevicesTab /></TabsContent>
        <TabsContent value="log"><ScanLogTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );  // prettier-ignore
}
