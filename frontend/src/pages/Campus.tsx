import dayjs from "dayjs";
import {
  BookUpIcon,
  CheckIcon,
  ImageIcon,
  MegaphoneIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UndoIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useClasses, useList } from "../api/hooks";
import type { Notice, Student } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Dash, EmptyState, TableState } from "../components/states";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { fromUnix, initials, toOptions } from "../utils";
import { t, tn } from "../i18n";

// --- library ------------------------------------------------------------------

interface BookRequest {
  book_request_id: number;
  book_id: number;
  book_name: string | null;
  student_name: string | null;
  issue_start_date: string;
  issue_end_date: string;
  status: number;
}

const REQUEST_STATUS: Record<number, [string, string]> = {
  0: [t("Pending"), "border-transparent bg-warning/20 text-amber-700 dark:text-amber-300"],
  1: [t("Issued"), "border-transparent bg-success/15 text-success"],
  2: [t("Rejected"), "border-destructive/50 text-destructive"],
  3: [t("Returned"), "border-transparent bg-secondary text-secondary-foreground"],
};

function RequestBook({ bookId, onDone }: { bookId: number; onDone: () => void }) {
  const form = useForm({ defaultValues: { start: dayjs().format("YYYY-MM-DD"), end: dayjs().add(14, "day").format("YYYY-MM-DD") } });
  const send = useAction(
    (v: { start: string; end: string }) => api.post("/book-requests", { book_id: bookId, issue_start_date: v.start, issue_end_date: v.end }),
    { success: t("Request sent to the librarian"), invalidate: [["/book-requests"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => send.mutate(v))} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="start"
          rules={{ required: t("Pick a date") }}
          render={({ field, fieldState }) => (
            <Field label={t("From")} required error={fieldState.error?.message}>
              <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="end"
          rules={{
            required: t("Pick a date"),
            validate: (v, all) => (dayjs(v).isBefore(dayjs(all.start)) ? t("Must be after the start date") : true),
          }}
          render={({ field, fieldState }) => (
            <Field label={t("Until")} required error={fieldState.error?.message}>
              <DatePicker value={field.value} onChange={field.onChange} clearable={false} />
            </Field>
          )}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={send.isPending}>
          <BookUpIcon />
          {t("Send request")}</Button>
      </DialogFooter>
    </form>
  );
}

function Requests({ manage }: { manage: boolean }) {
  const { data, isLoading } = useList<BookRequest>("/book-requests");
  const setStatus = useAction(({ id, status }: { id: number; status: number }) => api.put(`/book-requests/${id}/status`, { status }), {
    success: t("Updated"), invalidate: [["/book-requests"], ["/books"]],
  });  // prettier-ignore
  const giveBack = useAction((id: number) => api.post(`/book-requests/${id}/return`), { success: t("Book returned"), invalidate: [["/book-requests"], ["/books"]] });
  const colSpan = manage ? 6 : 4;
  const pending = data?.items.filter((r) => (r.status ?? 0) === 0).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{manage ? t("Book requests") : t("My requests")}</h2>
          <p className="text-muted-foreground text-sm">
            {manage ? t("Issue or reject requests from students, then mark books as returned.") : t("Track the books you asked the librarian for.")}
          </p>
        </div>
        {pending > 0 && (
          <Badge variant="outline" className={REQUEST_STATUS[0][1]}>
            {tn("{pending} pending", { pending })}</Badge>
        )}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("Book")}</TableHead>
              {manage && <TableHead>{t("Student")}</TableHead>}
              <TableHead>{t("From")}</TableHead>
              <TableHead>{t("Until")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              {manage && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={data?.items.length === 0} colSpan={colSpan} emptyText={t("No requests")} />
            {data?.items.map((r) => {
              const [label, className] = REQUEST_STATUS[r.status ?? 0] ?? [t("Unknown"), ""];
              return (
                <TableRow key={r.book_request_id}>
                  <TableCell className="font-medium">{r.book_name ?? <Dash />}</TableCell>
                  {manage && <TableCell>{r.student_name ?? <Dash />}</TableCell>}
                  <TableCell>{r.issue_start_date}</TableCell>
                  <TableCell>{r.issue_end_date}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={className}>{label}</Badge>
                  </TableCell>
                  {manage && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {(r.status ?? 0) === 0 && (
                          <>
                            <IconAction label={t("Issue")} onClick={() => setStatus.mutate({ id: r.book_request_id, status: 1 })}>
                              <CheckIcon className="text-success" />
                            </IconAction>
                            <IconAction label={t("Reject")} destructive onClick={() => setStatus.mutate({ id: r.book_request_id, status: 2 })}>
                              <XIcon />
                            </IconAction>
                          </>
                        )}
                        {r.status === 1 && (
                          <IconAction label={t("Mark returned")} loading={giveBack.isPending && giveBack.variables === r.book_request_id} onClick={() => giveBack.mutate(r.book_request_id)}>
                            <UndoIcon />
                          </IconAction>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export function LibraryPage() {
  const user = useUser();
  const manage = user.role === "admin" || user.role === "librarian";
  const classes = useClasses();
  const [requesting, setRequesting] = useState<number | null>(null);
  return (
    <Tabs defaultValue="books" className="gap-6">
      {(manage || user.role === "student") && (
        <TabsList>
          <TabsTrigger value="books">{t("Books")}</TabsTrigger>
          <TabsTrigger value="requests">{manage ? t("Book requests") : t("My requests")}</TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="books">
        <CrudPage
          title={t("Library")}
          subtitle={t("Books in the school library and how many copies are out.")}
          path="/books"
          idField="book_id"
          canWrite={manage}
          extraActions={
            user.role === "student"
              ? (row) =>
                  Number(row.total_copies ?? 0) - Number(row.issued_copies ?? 0) > 0 ? (
                    <Button size="xs" variant="secondary" onClick={() => setRequesting(Number(row.book_id))}>
                      <BookUpIcon />
                      {t("Request")}</Button>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">{t("Not available")}</Badge>
                  )
              : undefined
          }
          fields={[
            { name: "name", label: t("Title"), required: true },
            { name: "author", label: t("Author") },
            { name: "class_id", label: t("Class"), type: "select", options: toOptions(classes.data?.items, "class_id", "name") },
            { name: "price", label: t("Price") },
            { name: "total_copies", label: t("Copies"), type: "number" },
            {
              name: "issued_copies",
              label: t("Available"),
              type: "number",
              tableOnly: true,
              render: (row) => {
                const total = Number(row.total_copies ?? 0);
                const left = total - Number(row.issued_copies ?? 0);
                return (
                  <Badge variant="outline" className={left > 0 ? "border-transparent bg-success/15 text-success" : "text-muted-foreground"}>
                    {left} / {total}
                  </Badge>
                );
              },
            },
            { name: "description", label: t("Description"), type: "textarea", formOnly: true },
          ]}
        />
        <Dialog open={requesting !== null} onOpenChange={(open) => !open && setRequesting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Request book")}</DialogTitle>
              <DialogDescription>{t("The librarian will issue the book or let you know if it is not available.")}</DialogDescription>
            </DialogHeader>
            {requesting !== null && <RequestBook bookId={requesting} onDone={() => setRequesting(null)} />}
          </DialogContent>
        </Dialog>
      </TabsContent>
      <TabsContent value="requests">
        <Requests manage={manage} />
      </TabsContent>
    </Tabs>
  );
}

// --- transport & dormitory ------------------------------------------------------

type Residents = { kind: "transport" | "dormitory"; id: number; name: string } | null;

function ResidentsSheet({ target, onClose }: { target: Residents; onClose: () => void }) {
  const dorm = target?.kind === "dormitory";
  const { data, isLoading } = useList<Student>(target ? "/students" : null, {
    [dorm ? "dormitory_id" : "transport_id"]: target?.id,
    limit: 1000,
  });
  const colSpan = dorm ? 4 : 3;
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{target?.name}</SheetTitle>
          <SheetDescription>
            {dorm ? t("Students staying in this dormitory") : t("Students using this route")}
            {data && " " + t("· {length}", { length: data.items.length })}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("Student")}</TableHead>
                  <TableHead>{t("Class")}</TableHead>
                  <TableHead>{t("Roll")}</TableHead>
                  {dorm && <TableHead>{t("Room")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState loading={isLoading} empty={data?.items.length === 0} colSpan={colSpan} emptyText={t("No students assigned")} />
                {data?.items.map((s) => (
                  <TableRow key={s.student_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="size-7">
                          <AvatarImage src={s.image_url ?? undefined} alt="" />
                          <AvatarFallback className="text-[10px]">{initials(s.name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{s.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{s.class_name ? [s.class_name, s.section_name].filter(Boolean).join(" · ") : <Dash />}</TableCell>
                    <TableCell>{s.roll ?? <Dash />}</TableCell>
                    {dorm && <TableCell>{s.dormitory_room_number || <Dash />}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function FacilitiesPage() {
  const user = useUser();
  const admin = user.role === "admin";
  const staff = admin || user.role === "teacher";
  const [residents, setResidents] = useState<Residents>(null);
  return (
    <>
      <Tabs defaultValue="transport" className="gap-6">
        <TabsList>
          <TabsTrigger value="transport">{t("Transport")}</TabsTrigger>
          <TabsTrigger value="dormitory">{t("Dormitory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="transport">
          <CrudPage
            title={t("Transport routes")}
            subtitle={t("School bus routes, vehicles and fares.")}
            path="/transports"
            idField="transport_id"
            canWrite={admin}
            extraActions={
              staff
                ? (row) => (
                    <IconAction label={t("Students")} onClick={() => setResidents({ kind: "transport", id: Number(row.transport_id), name: String(row.route_name ?? t("Route")) })}>
                      <UsersIcon />
                    </IconAction>
                  )
                : undefined
            }
            fields={[
              { name: "route_name", label: t("Route"), required: true },
              { name: "number_of_vehicle", label: t("Vehicles") },
              { name: "route_fare", label: t("Fare") },
              { name: "description", label: t("Description"), type: "textarea" },
            ]}
          />
        </TabsContent>
        <TabsContent value="dormitory">
          <CrudPage
            title={t("Dormitories")}
            subtitle={t("Boarding houses and their rooms.")}
            path="/dormitories"
            idField="dormitory_id"
            canWrite={admin}
            extraActions={
              staff
                ? (row) => (
                    <IconAction label={t("Students")} onClick={() => setResidents({ kind: "dormitory", id: Number(row.dormitory_id), name: String(row.name ?? t("Dormitory")) })}>
                      <UsersIcon />
                    </IconAction>
                  )
                : undefined
            }
            fields={[
              { name: "name", label: t("Name"), required: true },
              { name: "number_of_room", label: t("Rooms") },
              { name: "description", label: t("Description"), type: "textarea" },
            ]}
          />
        </TabsContent>
      </Tabs>
      {staff && <ResidentsSheet target={residents} onClose={() => setResidents(null)} />}
    </>
  );
}

// --- noticeboard --------------------------------------------------------------

// Same split as the legacy running/archived noticeboard: status 1 is running, 0 is archived.
const isArchived = (n: Notice) => n.status !== 1;

interface NoticeValues {
  notice_title: string;
  notice: string;
  show_on_website: boolean;
  status: boolean;
  send_sms: boolean;
  image: File | null;
}

function NoticeForm({ notice, onDone }: { notice: Notice | null; onDone: () => void }) {
  const form = useForm<NoticeValues>({
    defaultValues: {
      notice_title: notice?.notice_title ?? "",
      notice: notice?.notice ?? "",
      show_on_website: notice?.show_on_website === 1,
      status: notice ? notice.status === 1 : true,
      send_sms: false,
      image: null,
    },
  });
  const { errors } = form.formState;
  const save = useAction(
    (v: NoticeValues) => {
      const body = new FormData();
      body.append("notice_title", v.notice_title);
      body.append("notice", v.notice);
      body.append("show_on_website", v.show_on_website ? "1" : "0");
      body.append("status", v.status ? "1" : "0");
      body.append("send_sms", v.send_sms ? "1" : "0");
      if (v.image) body.append("image", v.image);
      return notice ? api.put(`/notices/${notice.notice_id}`, body) : api.post("/notices", body);
    },
    { success: t("Notice saved"), invalidate: [["/notices"], ["/notices/all"]], onSuccess: onDone },
  );
  const switches: { name: "status" | "show_on_website" | "send_sms"; label: string; description: string }[] = [
    { name: "status", label: t("Published"), description: t("Off moves the notice to Archived") },
    { name: "show_on_website", label: t("Show on public website"), description: t("Listed on the school website's notice page") },
    { name: "send_sms", label: t("Also send as SMS"), description: t("Texts the title and date to everyone with a phone number") },
  ];

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label={t("Title")} htmlFor="notice-title" required error={errors.notice_title?.message}>
        <Input id="notice-title" aria-invalid={!!errors.notice_title} {...form.register("notice_title", { required: t("Required") })} />
      </Field>
      <Field label={t("Notice")} htmlFor="notice-body">
        <Textarea id="notice-body" rows={6} {...form.register("notice")} />
      </Field>
      <Controller
        control={form.control}
        name="image"
        render={({ field }) => (
          <Field label={t("Image")} htmlFor="notice-image" description={notice?.image_url && !field.value ? t("Leave empty to keep the current image") : undefined}>
            <Input id="notice-image" type="file" accept="image/*" onChange={(e) => field.onChange(e.target.files?.[0] ?? null)} />
          </Field>
        )}
      />
      <div className="divide-y rounded-lg border">
        {switches.map((s) => (
          <Controller
            key={s.name}
            control={form.control}
            name={s.name}
            render={({ field }) => (
              <label htmlFor={`notice-${s.name}`} className="flex cursor-pointer items-center justify-between gap-4 p-3">
                <span>
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="text-muted-foreground block text-xs">{s.description}</span>
                </span>
                <Switch id={`notice-${s.name}`} checked={field.value} onCheckedChange={field.onChange} />
              </label>
            )}
          />
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );
}

function NoticeCard({ notice: n, admin, onEdit, onDelete }: { notice: Notice; admin: boolean; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const ts = Number(n.create_timestamp);
  const long = (n.notice ?? "").length > 280;
  return (
    <Card className="py-4">
      <CardContent className="flex gap-4 px-4 sm:px-5">
        <div className="bg-primary/10 text-primary flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg">
          {ts ? (
            <>
              <span className="text-lg leading-none font-semibold">{dayjs.unix(ts).format("DD")}</span>
              <span className="text-[10px] font-medium tracking-wide uppercase">{dayjs.unix(ts).format("MMM")}</span>
            </>
          ) : (
            <MegaphoneIcon className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold break-words">{n.notice_title}</h3>
                {admin && n.status !== 1 && <Badge variant="secondary">{t("Hidden")}</Badge>}
                {admin && n.show_on_website === 1 && <Badge variant="outline">{t("Website")}</Badge>}
              </div>
              <p className="text-muted-foreground text-xs">{fromUnix(n.create_timestamp, "dddd, DD MMM YYYY")}</p>
            </div>
            {admin && (
              <div className="flex shrink-0 items-center gap-1">
                <IconAction label={t("Edit")} onClick={onEdit}><PencilIcon /></IconAction>
                <IconAction label={t("Delete")} destructive onClick={onDelete}><Trash2Icon /></IconAction>
              </div>
            )}
          </div>
          {n.notice && (
            <div>
              <p className={expanded ? "text-sm whitespace-pre-wrap" : "line-clamp-3 text-sm whitespace-pre-wrap"}>{n.notice}</p>
              {long && (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setExpanded((e) => !e)}>
                  {expanded ? t("Show less") : t("Read more")}
                </Button>
              )}
            </div>
          )}
          {n.image_url && (
            <div className="space-y-2">
              {expanded && <img src={n.image_url} alt="" className="max-h-60 w-auto rounded-md border object-contain" />}
              <a href={n.image_url} target="_blank" rel="noopener" className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline">
                <ImageIcon className="size-4" />
                {t("View attachment")}</a>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function NoticesPage() {
  const user = useUser();
  const admin = user.role === "admin";
  const { data, isLoading } = useList<Notice>(admin ? "/notices/all" : "/notices");
  const [editing, setEditing] = useState<Notice | null>(null);
  const [opened, setOpened] = useState(false);
  const remove = useAction((id: number) => api.delete(`/notices/${id}`), { success: t("Deleted"), invalidate: [["/notices"], ["/notices/all"]] });

  const notices = data?.items ?? [];
  const current = notices.filter((n) => !isArchived(n));
  const archived = notices.filter(isArchived);

  const list = (items: Notice[], empty: string) =>
    isLoading ? (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    ) : items.length === 0 ? (
      <EmptyState icon={MegaphoneIcon} title={empty} />
    ) : (
      <div className="space-y-3">
        {items.map((n) => (
          <NoticeCard
            key={n.notice_id}
            notice={n}
            admin={admin}
            onEdit={() => {
              setEditing(n);
              setOpened(true);
            }}
            onDelete={() => confirmAction({ title: t("Delete notice?"), onConfirm: () => remove.mutate(n.notice_id) })}
          />
        ))}
      </div>
    );

  return (
    <>
      <PageHeader
        title={t("Noticeboard")}
        subtitle={t("School announcements and circulars.")}
        actions={
          admin && (
            <Button
              onClick={() => {
                setEditing(null);
                setOpened(true);
              }}
            >
              <PlusIcon />
              {t("New notice")}</Button>
          )
        }
      />
      {admin ? (
        <Tabs defaultValue="current" className="gap-6">
          <TabsList>
            <TabsTrigger value="current">
              {t("Running")}{!isLoading && <Badge variant="secondary" className="ml-1 px-1.5">{current.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="archived">
              {t("Archived")}{!isLoading && <Badge variant="secondary" className="ml-1 px-1.5">{archived.length}</Badge>}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="current">{list(current, t("No running notices"))}</TabsContent>
          <TabsContent value="archived">{list(archived, t("No archived notices"))}</TabsContent>
        </Tabs>
      ) : (
        list(current, t("No notices"))
      )}
      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("Edit notice") : t("New notice")}</DialogTitle>
            <DialogDescription>
              {t("Unpublished notices are archived and hidden from students, parents and staff.")}</DialogDescription>
          </DialogHeader>
          {opened && <NoticeForm key={editing?.notice_id ?? "new"} notice={editing} onDone={() => setOpened(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
