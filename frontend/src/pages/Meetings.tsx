import dayjs from "dayjs";
import { BanIcon, CalendarClockIcon, CheckIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon, UnlockIcon, UsersIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useClasses, useGet } from "../api/hooks";
import type { MeetingBooking, MeetingSession, MeetingSlot } from "../api/types";
import { Combobox, MultiCombobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";
import { useChildSelect } from "./Academic";
import { t as tr, tn } from "../i18n";

// --- shared -------------------------------------------------------------------------

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
const fmtDay = (d: string | null | undefined) => (d ? dayjs(d).format("ddd, DD MMM YYYY") : "");
const sessionWhen = (s: MeetingSession) => `${fmtDay(s.date)} · ${hm(s.start_time)}–${hm(s.end_time)}`;

const BOOKING_STATUS: Record<MeetingBooking["status"], [string, string]> = {
  booked: [tr("Booked"), "bg-primary/10 text-primary"],
  done: [tr("Done"), "bg-success/15 text-success"],
  no_show: ["No-show", "bg-warning/20 text-amber-700 dark:text-amber-300"],
  cancelled: [tr("Cancelled"), "bg-muted text-muted-foreground"],
};
const SLOT_STATUS: Record<MeetingSlot["status"], string> = {
  open: "border-dashed",
  booked: "border-primary/40 bg-primary/5",
  blocked: "bg-muted text-muted-foreground",
};

function BookingBadge({ status }: { status: MeetingBooking["status"] }) {
  const [label, style] = BOOKING_STATUS[status] ?? [status, ""];
  return <Badge className={cn("border-transparent", style)}>{label}</Badge>;
}

function SessionPicker({ sessions, value, onChange }: { sessions: MeetingSession[] | undefined; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Combobox
      className="w-72"
      placeholder={tr("Choose a meeting day")}
      data={(sessions ?? []).map((s) => ({ value: String(s.session_id), label: `${s.title} — ${fmtDay(s.date)}` }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** Slots grouped by teacher, as a timeline of chips; `action` renders per-slot controls. */
function SlotBoard({ slots, action }: { slots: MeetingSlot[]; action: (slot: MeetingSlot) => ReactNode }) {
  const byTeacher = new Map<number, MeetingSlot[]>();
  slots.forEach((s) => byTeacher.set(s.teacher_id, [...(byTeacher.get(s.teacher_id) ?? []), s]));
  return (
    <div className="space-y-4">
      {[...byTeacher.values()].map((list) => (
        <Card key={list[0].teacher_id} className="gap-3">
          <CardHeader>
            <CardTitle className="text-base">{list[0].teacher_name ?? tr("Teacher #{teacher_id}", { teacher_id: list[0].teacher_id })}</CardTitle>
            <CardDescription>
              {list.filter((s) => s.status === "booked").length} {" "}{tr("of")}{" "}{list.length} {" "}{tr("slots booked")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((s) => (
              <div key={s.slot_id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm", SLOT_STATUS[s.status])}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium tabular-nums">
                    {hm(s.start_time)}–{hm(s.end_time)}
                  </span>
                  {s.booking ? (
                    <span>
                      <span className="font-medium">{s.booking.student_name}</span>
                      <span className="text-muted-foreground"> · {s.booking.parent_name}{s.booking.parent_phone ? " " + tr("({parent_phone})", { parent_phone: s.booking.parent_phone }) : ""}</span>
                      {s.booking.note && <span className="text-muted-foreground block text-xs">{tn("Agenda: {note}", { note: s.booking.note })}</span>}
                      {s.booking.teacher_note && <span className="block text-xs italic">{tn("Note: {teacher_note}", { teacher_note: s.booking.teacher_note })}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{s.status === "blocked" ? tr("Blocked") : tr("Free")}</span>
                  )}
                  {s.booking && <BookingBadge status={s.booking.status} />}
                </div>
                <div className="flex gap-1">{action(s)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// --- admin: sessions ----------------------------------------------------------------

interface SessionValues {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  slot_minutes: string;
  location: string;
  class_id: string | null;
  teacher_ids: string[];
}

function SessionForm({ session, onDone }: { session: MeetingSession | null; onDone: () => void }) {
  const classes = useClasses();
  const form = useForm<SessionValues>({
    defaultValues: session
      ? {
          title: session.title, date: session.date, start_time: hm(session.start_time), end_time: hm(session.end_time),
          slot_minutes: String(session.slot_minutes), location: session.location ?? "",
          class_id: session.class_id ? String(session.class_id) : null, teacher_ids: session.teacher_ids.map(String),
        }
      : { title: "", date: "", start_time: "09:00", end_time: "13:00", slot_minutes: "15", location: "", class_id: null, teacher_ids: [] },
  });  // prettier-ignore
  const classId = form.watch("class_id");
  const teachers = useGet<{ teacher_id: number; name: string; teaches_class: boolean }[]>("/meetings/teachers", { class_id: classId || undefined });
  const { errors } = form.formState;
  const save = useAction(
    async (v: SessionValues) => {
      const body = {
        ...v, slot_minutes: Number(v.slot_minutes), location: v.location || null,
        class_id: v.class_id ? Number(v.class_id) : null, teacher_ids: v.teacher_ids.map(Number),
      };  // prettier-ignore
      if (session) await api.put(`/meetings/sessions/${session.session_id}`, body);
      else await api.post("/meetings/sessions", body);
    },
    { success: tr("Saved"), invalidate: [["/meetings/sessions"], ["/calendar"]], onSuccess: onDone },
  );
  const fillClassTeachers = () =>
    form.setValue("teacher_ids", (teachers.data ?? []).filter((t) => t.teaches_class).map((t) => String(t.teacher_id)));

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      {session && session.booked > 0 && (
        <p className="text-muted-foreground text-sm">{tr("Parents have booked slots, so only the title and location can change.")}</p>
      )}
      <Field label={tr("Title")} htmlFor="ms-title" required error={errors.title?.message}>
        <Input id="ms-title" placeholder={tr("Term 1 parent-teacher meeting")} aria-invalid={!!errors.title} {...form.register("title", { required: tr("Required") })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={form.control} name="date" rules={{ required: tr("Required") }} render={({ field }) => (
          <Field label={tr("Day")} required error={errors.date?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
        <Field label={tr("Minutes per meeting")} htmlFor="ms-len" required>
          <Input id="ms-len" type="number" min={5} max={120} {...form.register("slot_minutes", { required: true })} />
        </Field>
        <Field label={tr("From")} htmlFor="ms-start" required>
          <Input id="ms-start" type="time" {...form.register("start_time", { required: true })} />
        </Field>
        <Field label={tr("To")} htmlFor="ms-end" required>
          <Input id="ms-end" type="time" {...form.register("end_time", { required: true })} />
        </Field>
      </div>
      <Field label={tr("Location or meeting link")} htmlFor="ms-loc">
        <Input id="ms-loc" {...form.register("location")} />
      </Field>
      <Controller control={form.control} name="class_id" render={({ field }) => (
        <Field label={tr("Class")} description={tr("Only parents of this class can book. Leave empty for every class.")}>
          <Combobox data={toOptions(classes.data?.items, "class_id", "name")} value={field.value} onChange={field.onChange} clearable placeholder={tr("All classes")} />
        </Field>
      )} />
      <Controller control={form.control} name="teacher_ids" render={({ field }) => (
        <Field label={tr("Teachers")} description={classId ? tr("Empty: every teacher of the class") : tr("Choose who takes part")}>
          <div className="flex gap-2">
            <MultiCombobox className="flex-1" data={(teachers.data ?? []).map((t) => ({ value: String(t.teacher_id), label: t.name }))} value={field.value} onChange={field.onChange} placeholder={classId ? tr("Teachers of the class") : tr("Choose teachers")} />
            {classId && <Button type="button" variant="outline" onClick={fillClassTeachers}>{tr("Class teachers")}</Button>}
          </div>
        </Field>
      )} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{tr("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

export function MeetingSessionsPage() {
  const [includePast, setIncludePast] = useState(false);
  const { data: sessions, isLoading } = useGet<MeetingSession[]>("/meetings/sessions", { include_past: includePast });
  const [editing, setEditing] = useState<MeetingSession | "new" | null>(null);
  const [viewing, setViewing] = useState<MeetingSession | null>(null);
  const slots = useGet<MeetingSlot[]>(viewing ? `/meetings/sessions/${viewing.session_id}/slots` : null);
  const remove = useAction((id: number) => api.delete(`/meetings/sessions/${id}`), { success: tr("Deleted"), invalidate: [["/meetings/sessions"], ["/calendar"]] });
  const cancel = useAction((id: number) => api.post(`/meetings/bookings/${id}/cancel`), { success: tr("Booking cancelled"), invalidate: [["/meetings/sessions"]] });

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Parent-teacher meetings")}
        subtitle={tr("Meeting days with time slots per teacher. Parents book a slot for their child; each day also appears on the academic calendar.")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {tr("New meeting day")}</Button>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-end gap-2 border-b p-3">
          <Switch id="ms-past" checked={includePast} onCheckedChange={setIncludePast} />
          <Label htmlFor="ms-past">{tr("Show past days")}</Label>
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tr("Meeting")}</TableHead>
              <TableHead>{tr("When")}</TableHead>
              <TableHead>{tr("Class")}</TableHead>
              <TableHead className="text-right">{tr("Booked")}</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && (sessions ?? []).length === 0} colSpan={5} emptyText={tr("No meeting days planned")} />
            {(sessions ?? []).map((s) => (
              <TableRow key={s.session_id}>
                <TableCell>
                  <div className="font-medium">{s.title}</div>
                  {s.location && <div className="text-muted-foreground text-xs">{s.location}</div>}
                </TableCell>
                <TableCell className="tabular-nums">{sessionWhen(s)}</TableCell>
                <TableCell>{s.class_name ?? tr("All classes")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.booked} / {s.slots}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction label={tr("Slots and bookings")} onClick={() => setViewing(s)}><UsersIcon /></IconAction>
                    <IconAction label={tr("Edit")} onClick={() => setEditing(s)}><PencilIcon /></IconAction>
                    <IconAction
                      label={tr("Delete")}
                      destructive
                      onClick={() => confirmAction({ title: tr("Delete \"{title}\"?", { title: s.title }), description: s.booked ? tr("Parents with bookings are emailed that the meeting is cancelled.") : undefined, onConfirm: () => remove.mutate(s.session_id) })}
                    >
                      <Trash2Icon />
                    </IconAction>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? tr("New meeting day") : tr("Edit meeting day")}</DialogTitle>
          </DialogHeader>
          {editing !== null && <SessionForm key={editing === "new" ? "new" : editing.session_id} session={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title}</DialogTitle>
            <DialogDescription>{viewing && sessionWhen(viewing)}</DialogDescription>
          </DialogHeader>
          {slots.isLoading ? null : (
            <SlotBoard
              slots={slots.data ?? []}
              action={(s) =>
                s.booking?.status === "booked" && (
                  <IconAction label={tr("Cancel booking")} destructive onClick={() => confirmAction({ title: tr("Cancel this booking?"), description: tr("The parent and teacher are emailed."), onConfirm: () => cancel.mutate(s.booking!.booking_id, { onSuccess: () => slots.refetch() }) })}>
                    <XIcon />
                  </IconAction>
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- teacher: my slots ----------------------------------------------------------------

function OutcomeDialog({ booking, onDone }: { booking: MeetingBooking; onDone: () => void }) {
  const [status, setStatus] = useState<string>(booking.status === "booked" ? "done" : booking.status);
  const [note, setNote] = useState(booking.teacher_note ?? "");
  const save = useAction(() => api.put(`/meetings/bookings/${booking.booking_id}/outcome`, { status, teacher_note: note || null }), {
    success: tr("Saved"),
    invalidate: [["/meetings/sessions"]],
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4">
      <Field label={tr("Outcome")}>
        <Combobox
          data={[
            { value: "done", label: tr("Meeting held") },
            { value: "no_show", label: tr("Parent did not come") },
            { value: "booked", label: tr("Not held yet") },
          ]}
          value={status}
          onChange={(v) => v && setStatus(v)}
        />
      </Field>
      <Field label={tr("Private note")} description={tr("Only staff can see this")} htmlFor="mo-note">
        <Textarea id="mo-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{tr("Cancel")}</Button>
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{tr("Save")}</Button>
      </DialogFooter>
    </div>
  );
}

export function MyMeetingsPage() {
  const sessions = useGet<MeetingSession[]>("/meetings/sessions", { include_past: true });
  const upcoming = (sessions.data ?? []).find((s) => s.date >= dayjs().format("YYYY-MM-DD"));
  const [picked, setPicked] = useState<string | null>(null);
  const sessionId = picked ?? (upcoming ? String(upcoming.session_id) : null);
  const session = (sessions.data ?? []).find((s) => String(s.session_id) === sessionId);
  const slots = useGet<MeetingSlot[]>(sessionId ? `/meetings/sessions/${sessionId}/slots` : null);
  const [outcome, setOutcome] = useState<MeetingBooking | null>(null);
  const block = useAction((v: { id: number; blocked: boolean }) => api.put(`/meetings/slots/${v.id}/block`, { blocked: v.blocked }), {
    invalidate: [["/meetings/sessions"]],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("My meeting slots")}
        subtitle={session ? tr("{sessionWhen}{value}", { sessionWhen: sessionWhen(session), value: session.location ? ` · ${session.location}` : "" }) : tr("Parent-teacher meetings you take part in")}
        actions={<SessionPicker sessions={sessions.data} value={sessionId} onChange={setPicked} />}
      />
      {!sessionId ? (
        <EmptyState icon={CalendarClockIcon} title={tr("No meeting days")}>
          {tr("When the school plans a parent-teacher meeting with you, your slots appear here.")}</EmptyState>
      ) : (
        <SlotBoard
          slots={slots.data ?? []}
          action={(s) =>
            s.booking ? (
              <IconAction label={tr("Record outcome")} onClick={() => setOutcome(s.booking)}><CheckIcon /></IconAction>
            ) : s.status === "blocked" ? (
              <IconAction label={tr("Make available")} onClick={() => block.mutate({ id: s.slot_id, blocked: false })}><UnlockIcon /></IconAction>
            ) : (
              <IconAction label={tr("Block slot")} onClick={() => block.mutate({ id: s.slot_id, blocked: true })}><LockIcon /></IconAction>
            )
          }
        />
      )}
      <Dialog open={outcome !== null} onOpenChange={(open) => !open && setOutcome(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{outcome?.student_name}</DialogTitle>
            <DialogDescription>
              {outcome?.parent_name} · {hm(outcome?.start_time)}–{hm(outcome?.end_time)}
            </DialogDescription>
          </DialogHeader>
          {outcome && <OutcomeDialog key={outcome.booking_id} booking={outcome} onDone={() => { setOutcome(null); slots.refetch(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );  // prettier-ignore
}

// --- parent: book -------------------------------------------------------------------

interface TeacherOption {
  teacher_id: number;
  teacher_name: string;
  subjects: string[];
  already_booked: boolean;
  free_slots: { slot_id: number; start_time: string; end_time: string }[];
}

export function BookMeetingPage() {
  const { childId, select } = useChildSelect();
  const sessions = useGet<MeetingSession[]>("/meetings/sessions");
  const mine = useGet<MeetingBooking[]>("/meetings/bookings/mine");
  const [picked, setPicked] = useState<string | null>(null);
  const sessionId = picked ?? (sessions.data?.[0] ? String(sessions.data[0].session_id) : null);
  const options = useGet<TeacherOption[]>(sessionId && childId ? `/meetings/sessions/${sessionId}/options` : null, { student_id: childId });
  const [choice, setChoice] = useState<{ teacher: TeacherOption; slot: TeacherOption["free_slots"][number] } | null>(null);
  const [note, setNote] = useState("");
  const invalidate = [["/meetings/bookings/mine"], ["/meetings/sessions"]];
  const book = useAction(() => api.post("/meetings/bookings", { slot_id: choice!.slot.slot_id, student_id: Number(childId), note: note || null }), {
    success: tr("Meeting booked. A confirmation email is on its way."),
    invalidate,
    onSuccess: () => {
      setChoice(null);
      setNote("");
      options.refetch();
    },
  });
  const cancel = useAction((id: number) => api.post(`/meetings/bookings/${id}/cancel`), {
    success: tr("Booking cancelled"),
    invalidate,
    onSuccess: () => options.refetch(),
  });
  const session = (sessions.data ?? []).find((s) => String(s.session_id) === sessionId);

  return (
    <div className="space-y-6">
      <PageHeader title={tr("Parent-teacher meetings")} subtitle={tr("Book a time with your child's teachers")} actions={select} />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b p-3 font-medium">{tr("My bookings")}</div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tr("When")}</TableHead>
              <TableHead>{tr("Teacher")}</TableHead>
              <TableHead>{tr("Child")}</TableHead>
              <TableHead>{tr("Status")}</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={mine.isLoading} empty={!mine.isLoading && (mine.data ?? []).length === 0} colSpan={5} emptyText={tr("No upcoming meetings booked")} />
            {(mine.data ?? []).map((b) => (
              <TableRow key={b.booking_id}>
                <TableCell className="tabular-nums">
                  {fmtDay(b.date)}, {hm(b.start_time)}–{hm(b.end_time)}
                  {b.location && <div className="text-muted-foreground text-xs">{b.location}</div>}
                </TableCell>
                <TableCell>{b.teacher_name ?? <Dash />}</TableCell>
                <TableCell>{b.student_name}</TableCell>
                <TableCell><BookingBadge status={b.status} /></TableCell>
                <TableCell>
                  {b.status === "booked" && (
                    <IconAction label={tr("Cancel booking")} destructive onClick={() => confirmAction({ title: tr("Cancel this meeting?"), onConfirm: () => cancel.mutate(b.booking_id) })}>
                      <BanIcon />
                    </IconAction>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {(sessions.data ?? []).length === 0 ? (
        <EmptyState icon={CalendarClockIcon} title={tr("No meeting days open for booking")}>
          {tr("The school announces parent-teacher meetings on the academic calendar.")}</EmptyState>
      ) : (
        <Card className="gap-4">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{tr("Book a meeting")}</CardTitle>
              <CardDescription>
                {session && tr("{sessionWhen}{value}", { sessionWhen: sessionWhen(session), value: session.location ? ` · ${session.location}` : "" })}
              </CardDescription>
            </div>
            <SessionPicker sessions={sessions.data} value={sessionId} onChange={setPicked} />
          </CardHeader>
          <CardContent className="space-y-4">
            {options.isError && <p className="text-muted-foreground text-sm">{tr("This meeting day is not for your child's class.")}</p>}
            {(options.data ?? []).length === 0 && !options.isLoading && !options.isError && (
              <p className="text-muted-foreground text-sm">{tr("None of your child's teachers take part in this meeting.")}</p>
            )}
            {(options.data ?? []).map((t) => (
              <div key={t.teacher_id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.teacher_name}</span>
                  {t.subjects.length > 0 && <span className="text-muted-foreground text-sm">{t.subjects.join(", ")}</span>}
                  {t.already_booked && <Badge className="bg-primary/10 text-primary border-transparent">{tr("Booked")}</Badge>}
                </div>
                {t.already_booked ? null : t.free_slots.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{tr("No free slots")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {t.free_slots.map((s) => (
                      <Button key={s.slot_id} size="sm" variant="outline" className="tabular-nums" onClick={() => setChoice({ teacher: t, slot: s })}>
                        {hm(s.start_time)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={choice !== null} onOpenChange={(open) => !open && setChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tn("Meet {teacher_name}", { teacher_name: choice?.teacher.teacher_name })}</DialogTitle>
            <DialogDescription>
              {session && fmtDay(session.date)}, {hm(choice?.slot.start_time)}–{hm(choice?.slot.end_time)}
            </DialogDescription>
          </DialogHeader>
          <Field label={tr("What would you like to discuss? (optional)")} htmlFor="mb-note">
            <Textarea id="mb-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoice(null)}>{tr("Cancel")}</Button>
            <Button loading={book.isPending} onClick={() => book.mutate(undefined)}>{tr("Book")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
