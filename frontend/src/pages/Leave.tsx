import dayjs from "dayjs";
import { CheckIcon, PlaneIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useGet, useList, usePagedList } from "../api/hooks";
import type { LeaveRequest, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, TableState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { toOptions } from "../utils";
import { t, tn, tp } from "../i18n";

const KINDS = [
  { value: "sick", label: t("Sick") },
  { value: "casual", label: t("Casual") },
  { value: "family", label: t("Family") },
  { value: "other", label: t("Other") },
];
const kindLabel = (k: string) => KINDS.find((o) => o.value === k)?.label ?? k;

const STATUS: Record<LeaveRequest["status"], [string, string]> = {
  pending: [t("Pending"), "bg-warning/20 text-amber-700 dark:text-amber-300"],
  approved: [t("Approved"), "bg-success/15 text-success"],
  rejected: [t("Rejected"), "bg-destructive/10 text-destructive"],
  cancelled: [t("Cancelled"), "bg-muted text-muted-foreground"],
};

const STAFF_ROLES = [
  { value: "teacher", label: t("Teacher") },
  { value: "librarian", label: t("Librarian") },
  { value: "accountant", label: t("Accountant") },
];

const fmtSpan = (r: Pick<LeaveRequest, "from_date" | "to_date">) =>
  r.from_date === r.to_date ? dayjs(r.from_date).format("DD MMM YYYY") : `${dayjs(r.from_date).format("DD MMM")} – ${dayjs(r.to_date).format("DD MMM YYYY")}`;

// --- apply ------------------------------------------------------------------------

interface ApplyValues {
  student_id: string | null;
  staff_role: string | null;
  staff_id: string | null;
  kind: string;
  from_date: string;
  to_date: string;
  reason: string;
}

/** Admins pick a student (by class) or a member of staff to record leave for. */
function AdminPersonPicker({ who, form }: { who: "student" | "staff"; form: ReturnType<typeof useForm<ApplyValues>> }) {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const students = useList<Student>(who === "student" && sel.classId ? "/students" : null, { class_id: sel.classId, limit: 1000 });
  const role = form.watch("staff_role");
  const staff = useList<Record<string, unknown>>(who === "staff" && role ? `/${role}s` : null, { limit: 2000 });
  if (who === "student")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <ClassPicker value={sel} onChange={(v) => { setSel(v); form.setValue("student_id", null); }} withSection={false} />
        <Controller control={form.control} name="student_id" rules={{ required: t("Choose a student") }} render={({ field, fieldState }) => (
          <Field label={t("Student")} required error={fieldState.error?.message}>
            <Combobox disabled={!sel.classId} data={toOptions(students.data?.items, "student_id", "name")} value={field.value} onChange={field.onChange} placeholder={t("Choose student")} />
          </Field>
        )} />
      </div>
    );  // prettier-ignore
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Controller control={form.control} name="staff_role" render={({ field }) => (
        <Field label={t("Role")}>
          <Combobox data={STAFF_ROLES} value={field.value} onChange={(v) => { field.onChange(v); form.setValue("staff_id", null); }} />
        </Field>
      )} />
      <Controller control={form.control} name="staff_id" rules={{ required: t("Choose a person") }} render={({ field, fieldState }) => (
        <Field label={t("Staff member")} required error={fieldState.error?.message}>
          <Combobox disabled={!role} data={toOptions(staff.data?.items, `${role}_id`, "name")} value={field.value} onChange={field.onChange} placeholder={t("Choose person")} />
        </Field>
      )} />
    </div>
  );  // prettier-ignore
}

function ApplyForm({ onDone }: { onDone: () => void }) {
  const user = useUser();
  const [who, setWho] = useState<"student" | "staff">("student");
  const children = useGet<{ student_id: number; name: string }[]>(user.role === "parent" ? "/students/children" : null);
  const today = dayjs().format("YYYY-MM-DD");
  const form = useForm<ApplyValues>({
    defaultValues: { student_id: null, staff_role: "teacher", staff_id: null, kind: "sick", from_date: today, to_date: today, reason: "" },
  });
  const { errors } = form.formState;
  const [from, to] = form.watch(["from_date", "to_date"]);
  const rangeOk = from && to && !dayjs(to).isBefore(from);
  const days = useGet<{ days: number }>(rangeOk ? "/leave/days" : null, { from, to });

  const save = useAction(
    (v: ApplyValues) => {
      const body: Record<string, unknown> = { kind: v.kind, from_date: v.from_date, to_date: v.to_date, reason: v.reason };
      if (user.role === "parent" || (user.role === "admin" && who === "student")) body.student_id = Number(v.student_id);
      if (user.role === "admin" && who === "staff") Object.assign(body, { staff_role: v.staff_role, staff_id: Number(v.staff_id) });
      return api.post("/leave", body);
    },
    { success: user.role === "admin" ? t("Leave recorded") : t("Leave request sent"), invalidate: [["/leave/mine"], ["/leave/approvals"]], onSuccess: onDone },
  );

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      {user.role === "admin" && (
        <>
          <ToggleGroup type="single" variant="outline" size="sm" value={who} onValueChange={(v) => v && setWho(v as "student" | "staff")} className="justify-start">
            <ToggleGroupItem value="student">{t("Student")}</ToggleGroupItem>
            <ToggleGroupItem value="staff">{t("Staff")}</ToggleGroupItem>
          </ToggleGroup>
          <AdminPersonPicker key={who} who={who} form={form} />
        </>
      )}
      {user.role === "parent" && (
        <Controller control={form.control} name="student_id" rules={{ required: t("Choose a child") }} render={({ field }) => (
          <Field label={t("Child")} required error={errors.student_id?.message}>
            <Combobox data={toOptions(children.data, "student_id", "name")} value={field.value} onChange={field.onChange} placeholder={t("Choose child")} />
          </Field>
        )} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Controller control={form.control} name="kind" render={({ field }) => (
          <Field label={t("Type")}>
            <Combobox data={KINDS} value={field.value} onChange={(v) => field.onChange(v ?? "other")} />
          </Field>
        )} />
        <Controller control={form.control} name="from_date" rules={{ required: t("Required") }} render={({ field }) => (
          <Field label={t("From")} required error={errors.from_date?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
        <Controller control={form.control} name="to_date" rules={{ required: t("Required"), validate: (v) => !dayjs(v).isBefore(form.getValues("from_date")) || t("Ends before it starts") }} render={({ field }) => (
          <Field label={t("To")} required error={errors.to_date?.message}>
            <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
          </Field>
        )} />
      </div>
      <p className="text-muted-foreground text-sm">
        {!rangeOk ? t("Choose the dates") : days.data ? tp(days.data.days, "{count} school day (holidays and weekly days off are not counted)", "{count} school days (holidays and weekly days off are not counted)") : days.isError ? t("That range is too long") : "…"}
      </p>
      <Field label={t("Reason")} htmlFor="leave-reason" required error={errors.reason?.message}>
        <Textarea id="leave-reason" rows={3} aria-invalid={!!errors.reason} {...form.register("reason", { required: t("Required"), maxLength: { value: 2000, message: t("Too long") } })} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={days.data?.days === 0}>{user.role === "admin" ? t("Record leave") : t("Send request")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

// --- decide -----------------------------------------------------------------------

function DecideForm({ request, approve, onDone }: { request: LeaveRequest; approve: boolean; onDone: () => void }) {
  const [note, setNote] = useState("");
  const decide = useAction(() => api.post(`/leave/${request.leave_id}/decision`, { approve, note: note || null }), {
    success: approve ? t("Leave approved") : t("Leave rejected"),
    invalidate: [["/leave/approvals"], ["/leave/mine"], ["/attendance/sheet"]],
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4">
      <div className="bg-muted/40 rounded-md border p-3 text-sm">
        <div className="font-medium">{request.person_name}{request.class_name && <span className="text-muted-foreground font-normal"> · {request.class_name}</span>}</div>
        <div>{fmtSpan(request)} · {tp(request.days, "{count} school day", "{count} school days")} · {kindLabel(request.kind)}</div>
        {request.reason && <div className="text-muted-foreground mt-1 whitespace-pre-wrap">{request.reason}</div>}
      </div>
      <Field label={t("Note to the applicant (optional)")} htmlFor="leave-note">
        <Textarea id="leave-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button variant={approve ? "default" : "destructive"} loading={decide.isPending} onClick={() => decide.mutate(undefined)}>
          {approve ? <CheckIcon /> : <XIcon />}
          {approve ? t("Approve") : t("Reject")}
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- tables -----------------------------------------------------------------------

function LeaveTable({ path, params, showPerson, emptyText, onDecide }: {
  path: string; params: Record<string, unknown>; showPerson: boolean; emptyText: string;
  onDecide?: (r: LeaveRequest, approve: boolean) => void;
}) {  // prettier-ignore
  const { data, isLoading, page, setPage, pageSize } = usePagedList<LeaveRequest>(path, params);
  const cancel = useAction((id: number) => api.post(`/leave/${id}/cancel`), { success: t("Request cancelled"), invalidate: [["/leave/mine"], ["/leave/approvals"]] });
  const rows = data?.items ?? [];
  const cols = showPerson ? 7 : 6;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-[760px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            {showPerson && <TableHead>{t("Who")}</TableHead>}
            <TableHead className="w-44">{t("Dates")}</TableHead>
            <TableHead className="w-16 text-right">{t("Days")}</TableHead>
            <TableHead className="w-24">{t("Type")}</TableHead>
            <TableHead>{t("Reason")}</TableHead>
            <TableHead className="w-48">{t("Status")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={cols} emptyText={emptyText} />
          {rows.map((r) => {
            const [label, style] = STATUS[r.status] ?? [r.status, ""];
            return (
              <TableRow key={r.leave_id} className="align-top">
                {showPerson && (
                  <TableCell>
                    <div className="font-medium">{r.person_name}</div>
                    <div className="text-muted-foreground text-xs capitalize">{r.class_name ?? r.person_role}</div>
                  </TableCell>
                )}
                <TableCell className="tabular-nums">{fmtSpan(r)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                <TableCell>{kindLabel(r.kind)}</TableCell>
                <TableCell className="whitespace-normal">
                  {r.reason ?? <Dash />}
                  {r.applicant_role !== r.person_role && <div className="text-muted-foreground text-xs">{tn("By {applicant_name} ({applicant_role})", { applicant_name: r.applicant_name, applicant_role: r.applicant_role })}</div>}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Badge className={cn("border-transparent", style)}>{label}</Badge>
                  {r.decided_by_name && <div className="text-muted-foreground mt-1 text-xs">{tn("by {decided_by_name}", { decided_by_name: r.decided_by_name })}</div>}
                  {r.decision_note && <div className="mt-1 text-xs">“{r.decision_note}”</div>}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {r.can_decide && onDecide && (
                      <>
                        <IconAction label={t("Approve")} onClick={() => onDecide(r, true)}><CheckIcon className="text-success" /></IconAction>
                        <IconAction label={t("Reject")} destructive onClick={() => onDecide(r, false)}><XIcon /></IconAction>
                      </>
                    )}
                    {r.can_cancel && (
                      <Button size="sm" variant="ghost" onClick={() => confirmAction({ title: t("Cancel this leave request?"), onConfirm: () => cancel.mutate(r.leave_id) })}>
                        {t("Cancel")}</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
    </Card>
  );
}

// --- page -------------------------------------------------------------------------

export function LeavePage() {
  const user = useUser();
  const canDecide = user.role === "admin" || user.role === "teacher";
  const [applying, setApplying] = useState(false);
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; approve: boolean } | null>(null);
  const [status, setStatus] = useState("pending");
  const [who, setWho] = useState("all");

  const mineTitle = user.role === "parent" ? t("My children") : user.role === "admin" ? t("Recorded by me") : t("My requests");
  const subtitle =
    user.role === "admin"
      ? t("Approve leave requests, or record leave for a student or member of staff.")
      : user.role === "teacher"
        ? t("Apply for your own leave and decide leave requests from students in your classes.")
        : user.role === "parent"
          ? t("Apply for leave for your children. Their class teacher or the school office decides.")
          : t("Apply for leave. Approved leave is shown on the attendance sheet.");

  const mine = (
    <LeaveTable path="/leave/mine" params={{}} showPerson={user.role === "parent" || user.role === "admin"} emptyText={t("No leave requests yet")} />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Leave")}
        subtitle={subtitle}
        actions={
          <Button onClick={() => setApplying(true)}>
            <PlusIcon />
            {user.role === "admin" ? t("Record leave") : t("Apply for leave")}
          </Button>
        }
      />
      {canDecide ? (
        <Tabs defaultValue="approvals" className="gap-4">
          <TabsList>
            <TabsTrigger value="approvals">{t("Approvals")}</TabsTrigger>
            <TabsTrigger value="mine">{mineTitle}</TabsTrigger>
          </TabsList>
          <TabsContent value="approvals" className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v)}>
                <ToggleGroupItem value="pending">{t("Pending")}</ToggleGroupItem>
                <ToggleGroupItem value="approved">{t("Approved")}</ToggleGroupItem>
                <ToggleGroupItem value="rejected">{t("Rejected")}</ToggleGroupItem>
                <ToggleGroupItem value="all">{t("All")}</ToggleGroupItem>
              </ToggleGroup>
              {user.role === "admin" && (
                <ToggleGroup type="single" variant="outline" size="sm" value={who} onValueChange={(v) => v && setWho(v)}>
                  <ToggleGroupItem value="all">{t("Everyone")}</ToggleGroupItem>
                  <ToggleGroupItem value="students">{t("Students")}</ToggleGroupItem>
                  <ToggleGroupItem value="staff">{t("Staff")}</ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
            <LeaveTable
              path="/leave/approvals"
              params={{ status: status === "all" ? undefined : status, who: who === "all" ? undefined : who }}
              showPerson
              emptyText={status === "pending" ? t("Nothing waiting for a decision") : t("No requests")}
              onDecide={(request, approve) => setDeciding({ request, approve })}
            />
          </TabsContent>
          <TabsContent value="mine">{mine}</TabsContent>
        </Tabs>
      ) : (
        mine
      )}

      <Dialog open={applying} onOpenChange={setApplying}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlaneIcon className="size-5" />
              {user.role === "admin" ? t("Record leave") : t("Apply for leave")}
            </DialogTitle>
            {user.role === "admin" && <DialogDescription>{t("Leave you record is approved straight away.")}</DialogDescription>}
          </DialogHeader>
          {applying && <ApplyForm onDone={() => setApplying(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!deciding} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.approve ? t("Approve leave") : t("Reject leave")}</DialogTitle>
          </DialogHeader>
          {deciding && <DecideForm request={deciding.request} approve={deciding.approve} onDone={() => setDeciding(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
