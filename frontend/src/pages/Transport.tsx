import dayjs from "dayjs";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  BusIcon,
  ClipboardListIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  PrinterIcon,
  Trash2Icon,
  UserMinusIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../api/client";
import { useAction, useGet, usePublicSettings } from "../api/hooks";
import type { MyTransport, RouteCapacity, RouteStop, TransportAssignment, TransportRoster, TransportRoute } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { CrudPage, IconAction } from "../components/CrudPage";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { ClassPicker, type Selection } from "../components/Pickers";
import { Dash, EmptyState, TableState } from "../components/states";
import { TransportExpiryAlert } from "../components/TransportExpiryAlert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import { money, toOptions } from "../utils";
import { PrintHeader, useChildSelect } from "./Academic";
import { t, tn, tp } from "../i18n";

const ROUTES_KEY = ["/transport/routes"];

function CapacityBadge({ c }: { c: RouteCapacity }) {
  return (
    <Badge
      title={c.over_capacity ? t("More students than seats on this route's vehicles") : undefined}
      className={cn("border-transparent tabular-nums", c.over_capacity ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success")}
    >
      <UsersIcon />
      {tp(c.capacity, "{assigned} / {count} seat", "{assigned} / {count} seats", { assigned: c.assigned })}
    </Badge>
  );
}

const times = (s: Pick<RouteStop, "pickup_time" | "drop_time">) =>
  [s.pickup_time && t("pick-up {pickup_time}", { pickup_time: s.pickup_time }), s.drop_time && t("drop-off {drop_time}", { drop_time: s.drop_time })].filter(Boolean).join(" · ");

// --- stops ------------------------------------------------------------------------

interface StopValues {
  name: string;
  pickup_time: string;
  drop_time: string;
  fare: string;
}

function StopForm({ routeId, stop, onDone }: { routeId: number; stop: RouteStop | null; onDone: () => void }) {
  const form = useForm<StopValues>({
    defaultValues: { name: stop?.name ?? "", pickup_time: stop?.pickup_time ?? "", drop_time: stop?.drop_time ?? "", fare: stop?.fare ?? "" },
  });
  const { errors } = form.formState;
  const save = useAction(
    (v: StopValues) => {
      const body = { name: v.name.trim(), pickup_time: v.pickup_time || null, drop_time: v.drop_time || null, fare: v.fare.trim() || null };
      return stop ? api.put(`/transport/stops/${stop.stop_id}`, body) : api.post(`/transport/routes/${routeId}/stops`, body);
    },
    { success: t("Saved"), invalidate: [ROUTES_KEY], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label={t("Stop")} htmlFor="stop-name" required error={errors.name?.message}>
        <Input id="stop-name" aria-invalid={!!errors.name} {...form.register("name", { required: t("Required") })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Pick-up")} htmlFor="stop-pickup">
          <Input id="stop-pickup" type="time" {...form.register("pickup_time")} />
        </Field>
        <Field label={t("Drop-off")} htmlFor="stop-drop">
          <Input id="stop-drop" type="time" {...form.register("drop_time")} />
        </Field>
        <Field label={t("Fare")} htmlFor="stop-fare" description={t("Empty: route fare")} error={errors.fare?.message}>
          <Input id="stop-fare" inputMode="decimal" {...form.register("fare", { pattern: { value: /^\d{1,8}(\.\d{1,2})?$/, message: t("A number like 650 or 650.50") } })} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function RouteForm({ onDone }: { onDone: () => void }) {
  const form = useForm<{ route_name: string; route_fare: string }>({ defaultValues: { route_name: "", route_fare: "" } });
  const save = useAction(
    (v: { route_name: string; route_fare: string }) => api.post("/transports", { route_name: v.route_name.trim(), route_fare: v.route_fare.trim() || null }),
    { success: t("Route added"), invalidate: [ROUTES_KEY, ["/transports"]], onSuccess: onDone },
  );
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <Field label={t("Route")} htmlFor="route-name" required error={form.formState.errors.route_name?.message}>
        <Input id="route-name" {...form.register("route_name", { required: t("Required") })} />
      </Field>
      <Field label={t("Fare")} htmlFor="route-fare">
        <Input id="route-fare" inputMode="decimal" {...form.register("route_fare")} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("Save")}</Button>
      </DialogFooter>
    </form>
  );  // prettier-ignore
}

function RouteCard({ route, admin, currency, onRoster }: { route: TransportRoute; admin: boolean; currency: string; onRoster: () => void }) {
  const [editing, setEditing] = useState<RouteStop | "new" | null>(null);
  const reorder = useAction((ids: number[]) => api.put(`/transport/routes/${route.transport_id}/stop-order`, { stop_ids: ids }), { invalidate: [ROUTES_KEY] });
  const remove = useAction((id: number) => api.delete(`/transport/stops/${id}`), { success: t("Stop deleted"), invalidate: [ROUTES_KEY] });
  const move = (i: number, by: number) => {
    const ids = route.stops.map((s) => s.stop_id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BusIcon className="text-muted-foreground size-4" />
            {route.route_name ?? t("Route")}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {route.route_fare && <span>{tn("Fare {route_fare}", { route_fare: money(route.route_fare, currency) })}</span>}
            <CapacityBadge c={route} />
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onRoster}>
          <ClipboardListIcon />
          {t("Roster")}</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
          {route.vehicles.length === 0 ? (
            <span>{t("No vehicle on this route")}</span>
          ) : (
            route.vehicles.map((v) => (
              <Badge key={v.vehicle_id} variant="outline" className={cn(!v.active && "opacity-50")}>
                {v.registration_no} · {tp(v.capacity, "{count} seat", "{count} seats")}{v.driver_name ? " " + t("· {driver_name}", { driver_name: v.driver_name }) : ""}
              </Badge>
            ))
          )}
        </div>
        <ol className="space-y-1.5">
          {route.stops.length === 0 && <li className="text-muted-foreground text-sm">{t("No stops yet")}</li>}
          {route.stops.map((s, i) => (
            <li key={s.stop_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {times(s) || t("No times set")}
                    {s.fare && " " + t("· fare {fare}", { fare: money(s.fare, currency) })}
                  </div>
                </div>
              </div>
              {admin && (
                <div className="flex shrink-0 gap-1">
                  <IconAction label={t("Move up")} onClick={() => i > 0 && move(i, -1)}><ArrowUpIcon className={cn(i === 0 && "opacity-30")} /></IconAction>
                  <IconAction label={t("Move down")} onClick={() => i < route.stops.length - 1 && move(i, 1)}><ArrowDownIcon className={cn(i === route.stops.length - 1 && "opacity-30")} /></IconAction>
                  <IconAction label={t("Edit stop")} onClick={() => setEditing(s)}><PencilIcon /></IconAction>
                  <IconAction label={t("Delete stop")} destructive onClick={() => confirmAction({ title: t("Delete stop \"{name}\"?", { name: s.name }), description: t("Students at this stop keep the route without a stop."), onConfirm: () => remove.mutate(s.stop_id) })}>
                    <Trash2Icon />
                  </IconAction>
                </div>
              )}
            </li>
          ))}
        </ol>
        {admin && (
          <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("Add stop")}</Button>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("New stop on {value}", { value: route.route_name ?? "route" }) : t("Edit stop")}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <StopForm key={editing === "new" ? "new" : editing.stop_id} routeId={route.transport_id} stop={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RoutesTab({ admin, currency, onRoster }: { admin: boolean; currency: string; onRoster: (id: number) => void }) {
  const { data, isLoading } = useGet<TransportRoute[]>("/transport/routes");
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {admin && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            {t("New route")}</Button>
        </div>
      )}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data ?? []).length === 0 ? (
        <EmptyState icon={BusIcon} title={t("No routes yet")} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(data ?? []).map((r) => (
            <RouteCard key={r.transport_id} route={r} admin={admin} currency={currency} onRoster={() => onRoster(r.transport_id)} />
          ))}
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("New route")}</DialogTitle>
          </DialogHeader>
          {adding && <RouteForm onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- assignments ------------------------------------------------------------------

function AssignmentsTab({ admin }: { admin: boolean }) {
  const [sel, setSel] = useState<Selection>({ classId: null, sectionId: null });
  const routes = useGet<TransportRoute[]>("/transport/routes");
  const rows = useGet<TransportAssignment[]>(sel.classId ? "/transport/assignments" : null, { class_id: sel.classId, section_id: sel.sectionId || undefined });
  const [bulk, setBulk] = useState<{ route: string | null; stop: string | null }>({ route: null, stop: null });
  const invalidate = [["/transport/assignments"], ROUTES_KEY, ["/students"]];
  const warn = (r: { data: { capacity: RouteCapacity } }) => {
    const c = r.data.capacity;
    if (c.over_capacity) toast.warning(t("Route is over capacity: {assigned} students for {capacity} seats", { assigned: c.assigned, capacity: c.capacity }));
  };
  const assign = useAction(
    (v: { studentId: number; routeId: number; stopId: number | null }) => api.put(`/transport/assignments/${v.studentId}`, { route_id: v.routeId, stop_id: v.stopId }),
    { success: t("Saved"), invalidate, onSuccess: warn },
  );
  const assignAll = useAction(
    () => api.post("/transport/assignments/bulk", { route_id: Number(bulk.route), stop_id: bulk.stop ? Number(bulk.stop) : null, class_id: Number(sel.classId), section_id: sel.sectionId ? Number(sel.sectionId) : null }),
    { success: t("Assigned"), invalidate, onSuccess: warn },
  );
  const unassign = useAction((id: number) => api.delete(`/transport/assignments/${id}`), { success: t("Removed from transport"), invalidate });

  const routeOptions = toOptions(routes.data, "transport_id", "route_name");
  const stopOptions = (routeId: number | string | null) =>
    toOptions(routes.data?.find((r) => String(r.transport_id) === String(routeId))?.stops, "stop_id", "name");

  return (
    <div className="space-y-4">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <ClassPicker value={sel} onChange={setSel} />
          {admin && sel.classId && (
            <>
              <Field label={t("Route")} className="w-52">
                <Combobox data={routeOptions} value={bulk.route} onChange={(v) => setBulk({ route: v, stop: null })} placeholder={t("Choose route")} />
              </Field>
              <Field label={t("Stop")} className="w-52">
                <Combobox data={stopOptions(bulk.route)} value={bulk.stop} onChange={(v) => setBulk({ ...bulk, stop: v })} clearable disabled={!bulk.route} placeholder={t("No stop")} />
              </Field>
              <Button
                disabled={!bulk.route}
                loading={assignAll.isPending}
                onClick={() => confirmAction({ title: t("Assign every student of this {value} to the route?", { value: sel.sectionId ? "section" : "class" }), description: t("Students already on another route are moved."), onConfirm: () => assignAll.mutate(undefined) })}
              >
                {t("Assign all")}</Button>
            </>
          )}
        </CardContent>
      </Card>
      {!sel.classId ? (
        <EmptyState icon={UsersIcon} title={t("Choose a class")}>{t("Its students and their routes appear here.")}</EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table className="min-w-[720px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-16">{t("Roll")}</TableHead>
                <TableHead>{t("Student")}</TableHead>
                <TableHead className="w-56">{t("Route")}</TableHead>
                <TableHead className="w-56">{t("Stop")}</TableHead>
                {admin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState loading={rows.isLoading} empty={!rows.isLoading && (rows.data ?? []).length === 0} colSpan={admin ? 5 : 4} emptyText={t("No students enrolled")} />
              {(rows.data ?? []).map((r) => (
                <TableRow key={r.student_id}>
                  <TableCell className="text-muted-foreground">{r.roll ?? <Dash />}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    {r.section_name && <div className="text-muted-foreground text-xs">{tn("Section {section_name}", { section_name: r.section_name })}</div>}
                  </TableCell>
                  <TableCell>
                    {admin ? (
                      <Combobox
                        data={routeOptions}
                        value={r.route_id ? String(r.route_id) : null}
                        placeholder={t("No transport")}
                        onChange={(v) => v && assign.mutate({ studentId: r.student_id, routeId: Number(v), stopId: null })}
                      />
                    ) : (r.route_name ?? <Dash />)}
                  </TableCell>
                  <TableCell>
                    {admin && r.route_id ? (
                      <Combobox
                        data={stopOptions(r.route_id)}
                        value={r.stop_id ? String(r.stop_id) : null}
                        placeholder={t("No stop")}
                        clearable
                        onChange={(v) => assign.mutate({ studentId: r.student_id, routeId: r.route_id!, stopId: v ? Number(v) : null })}
                      />
                    ) : (r.stop_name ?? <Dash />)}
                  </TableCell>
                  {admin && (
                    <TableCell>
                      {r.route_id && (
                        <IconAction label={t("Remove from transport")} destructive onClick={() => unassign.mutate(r.student_id)}>
                          <UserMinusIcon />
                        </IconAction>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );  // prettier-ignore
}

// --- roster -----------------------------------------------------------------------

function Roster({ routeId, onBack }: { routeId: number; onBack: () => void }) {
  const { data, isLoading } = useGet<TransportRoster>(`/transport/routes/${routeId}/roster`);
  const total = data?.stops.reduce((n, g) => n + g.students.length, 0) ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Roster: {value}", { value: data?.route_name ?? t("Route") })}
        subtitle={t("Students on the route by stop, in route order")}
        actions={
          <>
            <Button variant="outline" onClick={onBack}>
              <ArrowLeftIcon />
              {t("Back")}</Button>
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>
              <PrinterIcon />
              {t("Print")}</Button>
          </>
        }
      />
      <PrintHeader
        title={t("Transport roster")}
        lines={[data?.route_name, data?.vehicles.map((v) => `${v.registration_no}${v.driver_name ? ` – ${v.driver_name}${v.driver_phone ? ` (${v.driver_phone})` : ""}` : ""}`).join(", "), t("{total} students", { total })]}
      />
      {data && (
        <div className="no-print flex flex-wrap gap-2">
          <CapacityBadge c={data} />
          {data.vehicles.map((v) => (
            <Badge key={v.vehicle_id} variant="outline">
              {v.registration_no}
              {v.driver_name && " " + t("· {driver_name}", { driver_name: v.driver_name })}
              {v.driver_phone && " " + t("· {driver_phone}", { driver_phone: v.driver_phone })}
            </Badge>
          ))}
        </div>
      )}
      {isLoading && <Skeleton className="h-48 w-full" />}
      {data?.stops.map((g) => (
        <Card key={g.stop?.stop_id ?? "none"} className="gap-0 overflow-hidden py-0 break-inside-avoid print:rounded-none print:shadow-none">
          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
            <div className="flex items-center gap-2 font-medium">
              <MapPinIcon className="text-muted-foreground size-4" />
              {g.stop ? t("{sequence}. {name}", { sequence: g.stop.sequence, name: g.stop.name }) : t("No stop chosen")}
            </div>
            <div className="text-muted-foreground text-xs">{tn("{value} · {length} students", { value: g.stop ? times(g.stop) : null, length: g.students.length })}</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Student")}</TableHead>
                <TableHead className="w-40">{t("Class")}</TableHead>
                <TableHead className="w-28">{t("Trips")}</TableHead>
                <TableHead className="w-44">{t("Parent phone")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState empty={g.students.length === 0} colSpan={4} emptyText={t("Nobody at this stop")} />
              {g.students.map((s) => (
                <TableRow key={s.student_id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.class_name ? [s.class_name, s.section_name].filter(Boolean).join(" · ") : <Dash />}{s.roll ? " " + t("({roll})", { roll: s.roll }) : ""}</TableCell>
                  <TableCell>{s.pickup && s.drop ? t("Both") : s.pickup ? t("Pick-up") : s.drop ? t("Drop-off") : <Dash />}</TableCell>
                  <TableCell className="tabular-nums">{s.parent_phone ?? <Dash />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  );
}

// --- my transport (students and parents) ---------------------------------------------

function MyTransportCard({ studentId, currency }: { studentId: string | null; currency: string }) {
  const user = useUser();
  const { data, isLoading } = useGet<MyTransport>(user.role === "parent" && !studentId ? null : "/transport/mine", { student_id: studentId || undefined });
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return null;
  if (!data.route_id)
    return (
      <EmptyState icon={BusIcon} title={t("Not using school transport")}>
        {user.role === "parent"
          ? t("{name} is not assigned to a route. Ask the school office to arrange it.", { name: data.student_name ?? t("Your child") })
          : t("You are not assigned to a route. Ask the school office to arrange it.")}</EmptyState>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BusIcon className="text-muted-foreground size-4" />
            {data.route_name}
          </CardTitle>
          {data.route_description && <CardDescription>{data.route_description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-xs">{t("Stop")}</div>
            <div className="font-medium">{data.stop?.name ?? t("Not chosen yet")}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t("Fare")}</div>
            <div className="font-medium">{data.fare ? money(data.fare, currency) : <Dash />}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t("Pick-up")}</div>
            <div className="font-medium">{data.pickup ? (data.stop?.pickup_time ?? t("Time not set")) : t("Not using")}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t("Drop-off")}</div>
            <div className="font-medium">{data.drop ? (data.stop?.drop_time ?? t("Time not set")) : t("Not using")}</div>
          </div>
          {data.since && (
            <div>
              <div className="text-muted-foreground text-xs">{t("Since")}</div>
              <div className="font-medium">{dayjs(data.since).format("DD MMM YYYY")}</div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("Vehicle and driver")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data.vehicles.length === 0 && <p className="text-muted-foreground">{t("No vehicle assigned to this route yet.")}</p>}
          {data.vehicles.map((v) => (
            <div key={v.registration_no} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div>
                <div className="font-medium">{v.registration_no}</div>
                {v.model && <div className="text-muted-foreground text-xs">{v.model}</div>}
              </div>
              {v.driver_name && (
                <div className="text-right">
                  <div>{v.driver_name}</div>
                  {v.driver_phone && (
                    <a href={`tel:${v.driver_phone}`} className="text-primary inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">
                      <PhoneIcon className="size-3" />
                      {v.driver_phone}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// --- page -------------------------------------------------------------------------

export function TransportPage() {
  const user = useUser();
  const admin = user.role === "admin";
  const currency = usePublicSettings().data?.currency ?? "usd";
  const { childId, select } = useChildSelect();
  const [roster, setRoster] = useState<number | null>(null);
  const routes = useGet<TransportRoute[]>(admin ? "/transport/routes" : null);
  const drivers = useGet<{ items: { driver_id: number; name: string }[] }>(admin ? "/transport/drivers" : null);

  if (user.role === "student" || user.role === "parent")
    return (
      <div className="space-y-6">
        <PageHeader title={t("My transport")} subtitle={t("Route, stop, times and who to call")} actions={select} />
        <MyTransportCard studentId={childId} currency={currency} />
      </div>
    );

  if (roster !== null) return <Roster routeId={roster} onBack={() => setRoster(null)} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Transport")}
        subtitle={
          <>
            {t("Routes, stops, vehicles, drivers and who rides where. Students' route also shows on")}{" "}
            <Link to="/app/facilities" className="text-primary underline-offset-4 hover:underline">{t("Transport & dormitory")}</Link>.
          </>
        }
      />
      {admin && <TransportExpiryAlert linkToPage={false} />}
      <Tabs defaultValue="routes" className="gap-6">
        <TabsList>
          <TabsTrigger value="routes">{t("Routes & stops")}</TabsTrigger>
          <TabsTrigger value="assignments">{t("Students")}</TabsTrigger>
          <TabsTrigger value="vehicles">{t("Vehicles")}</TabsTrigger>
          <TabsTrigger value="drivers">{t("Drivers")}</TabsTrigger>
        </TabsList>
        <TabsContent value="routes">
          <RoutesTab admin={admin} currency={currency} onRoster={setRoster} />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentsTab admin={admin} />
        </TabsContent>
        <TabsContent value="vehicles">
          <CrudPage
            title={t("Vehicles")}
            subtitle={t("Seats count towards each route's capacity. Insurance and fitness dates feed the renewal alert.")}
            path="/transport/vehicles"
            idField="vehicle_id"
            canWrite={admin}
            fields={[
              { name: "registration_no", label: t("Registration"), required: true },
              { name: "model", label: t("Model") },
              { name: "capacity", label: t("Seats"), type: "number", required: true },
              { name: "route_id", label: t("Route"), type: "select", options: toOptions(routes.data, "transport_id", "route_name"), formOnly: true },
              { name: "route_name", label: t("Route"), tableOnly: true },
              { name: "driver_id", label: t("Driver"), type: "select", options: toOptions(drivers.data?.items, "driver_id", "name"), formOnly: true },
              { name: "driver_name", label: t("Driver"), tableOnly: true },
              { name: "insurance_expiry", label: t("Insurance until"), type: "date" },
              { name: "fitness_expiry", label: t("Fitness until"), type: "date" },
              { name: "active", label: t("In service"), type: "switch", defaultOn: true },
              { name: "notes", label: t("Notes"), type: "textarea", formOnly: true },
            ]}
          />
        </TabsContent>
        <TabsContent value="drivers">
          <CrudPage
            title={t("Drivers")}
            subtitle={t("Contact details shown to parents of students on the driver's route.")}
            path="/transport/drivers"
            idField="driver_id"
            canWrite={admin}
            fields={[
              { name: "name", label: t("Name"), required: true },
              { name: "phone", label: t("Phone") },
              { name: "licence_no", label: t("Licence no.") },
              { name: "licence_expiry", label: t("Licence until"), type: "date" },
              { name: "active", label: t("Active"), type: "switch", defaultOn: true },
              { name: "address", label: t("Address"), type: "textarea", formOnly: true },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
