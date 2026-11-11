import { CheckIcon, EyeIcon, LockIcon, PlusIcon, SaveIcon, ShieldCheckIcon, Trash2Icon, UserCogIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { useAction, useGet } from "../api/hooks";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import type { Level } from "../nav";
import { initials } from "../utils";
import { t } from "../i18n";

interface Module {
  key: string;
  group: string;
  label: string;
  roles: string[];
}

interface Role {
  access_role_id: number;
  key: string;
  name: string;
  description: string | null;
  base_role: string;
  is_system: boolean;
  locked: boolean;
  members: number | null;
  permissions: Record<string, Level>;
}

interface AdminAccess {
  admin_id: number;
  name: string;
  email: string;
  access_role_id: number | null;
}

const INVALIDATE = [["/permissions"]];

const ROLE_NAMES: Record<string, string> = {
  admin: t("Administrator"),
  teacher: t("Teacher"),
  accountant: t("Accountant"),
  librarian: t("Librarian"),
  student: t("Student"),
  parent: t("Parent"),
};

const GROUPS: Record<string, string> = {
  People: t("People"),
  Academic: t("Academic"),
  Exams: t("Exams"),
  Attendance: t("Attendance"),
  Finance: t("Finance"),
  HR: t("HR"),
  Campus: t("Campus"),
  Settings: t("Settings"),
};

const MODULE_LABELS: Record<string, string> = {
  students: t("Students & promotion"),
  student_profile: t("Student profiles & health"),
  teachers: t("Teachers"),
  parents: t("Parents"),
  staff: t("Staff accounts"),
  id_cards: t("ID cards & devices"),
  certificates: t("Certificates"),
  admissions: t("Admissions & enquiries"),
  classes: t("School years, classes & sections"),
  subjects: t("Subjects"),
  routine: t("Class routine"),
  syllabus: t("Syllabus & study material"),
  homework: t("Homework"),
  calendar: t("Academic calendar"),
  exams: t("Exams, grades & timetable"),
  marks: t("Marks, marksheets & report cards"),
  online_exams: t("Online exams & question papers"),
  attendance: t("Student attendance"),
  kiosk: t("Check-in kiosk"),
  leave: t("Leave"),
  invoices: t("Invoices & payments"),
  accounting: t("Income & expenses"),
  fee_setup: t("Fee setup"),
  hr: t("Staff attendance & payroll"),
  library: t("Library"),
  transport: t("Transport & dormitory"),
  notices: t("Noticeboard"),
  messages: t("Messages"),
  meetings: t("Parent-teacher meetings"),
  analytics: t("Analytics"),
  ai: t("AI assistant"),
  website: t("Public website"),
  settings: t("System settings"),
  audit_log: t("Audit log"),
};

const LEVELS: { value: Level; label: string; icon: typeof CheckIcon; on: string }[] = [
  { value: "full", label: t("Full"), icon: CheckIcon, on: "bg-primary text-primary-foreground shadow-sm" },
  { value: "view", label: t("View"), icon: EyeIcon, on: "bg-amber-500 text-white shadow-sm" },
  { value: "none", label: t("None"), icon: XIcon, on: "bg-foreground/80 text-background shadow-sm" },
];

const roleName = (r: Role) => (r.is_system ? (ROLE_NAMES[r.key] ?? r.name) : r.name);
const moduleLabel = (m: Module) => MODULE_LABELS[m.key] ?? m.label;
const available = (r: Role, m: Module) => m.roles.includes(r.base_role);

function LevelPicker({ value, onChange, disabled }: { value: Level; onChange: (v: Level) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" className="bg-muted inline-flex rounded-lg p-0.5">
      {LEVELS.map((l) => (
        <button
          key={l.value}
          type="button"
          role="radio"
          aria-checked={value === l.value}
          disabled={disabled}
          onClick={() => onChange(l.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed",
            value === l.value ? l.on : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground",
          )}
        >
          <l.icon className="size-3.5" />
          {l.label}
        </button>
      ))}
    </div>
  );
}

function summary(r: Role) {
  const values = Object.values(r.permissions);
  return {
    full: values.filter((v) => v === "full").length,
    view: values.filter((v) => v === "view").length,
  };
}

function RoleEditor({ role, modules, onDeleted }: { role: Role; modules: Module[]; onDeleted: () => void }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [levels, setLevels] = useState(role.permissions);
  useEffect(() => {
    setName(role.name);
    setDescription(role.description ?? "");
    setLevels(role.permissions);
  }, [role]);

  const shown = modules.filter((m) => available(role, m));
  const hidden = modules.length - shown.length;
  const groups = [...new Set(shown.map((m) => m.group))];
  const dirty =
    name !== role.name || description !== (role.description ?? "") || shown.some((m) => levels[m.key] !== role.permissions[m.key]);

  const save = useAction(
    () => api.put(`/permissions/roles/${role.access_role_id}`, { name, description: description.trim() || null, permissions: levels }),
    { success: t("Role saved"), invalidate: INVALIDATE },
  );
  const remove = useAction(() => api.delete(`/permissions/roles/${role.access_role_id}`), {
    success: t("Role deleted"),
    invalidate: INVALIDATE,
    onSuccess: onDeleted,
  });
  const setGroup = (group: string, level: Level) =>
    setLevels((ls) => ({ ...ls, ...Object.fromEntries(shown.filter((m) => m.group === group).map((m) => [m.key, level])) }));

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {roleName(role)}
              <Badge variant={role.is_system ? "secondary" : "outline"}>{role.is_system ? t("Built-in") : t("Custom")}</Badge>
            </CardTitle>
            <CardDescription>
              {role.is_system
                ? t("Applies to every {role} account.", { role: (ROLE_NAMES[role.key] ?? role.name).toLowerCase() })
                : t("For administrator accounts given this role under Administrator accounts.")}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {!role.is_system && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => confirmAction({ title: t("Delete the role \"{name}\"?", { name: role.name }), onConfirm: () => remove.mutate(undefined) })}
              >
                <Trash2Icon />
                {t("Delete")}</Button>
            )}
            {!role.locked && (
              <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                <SaveIcon />
                {t("Save changes")}</Button>
            )}
          </div>
        </div>
        {!role.is_system && (
          <div className="grid gap-3 pt-4 sm:grid-cols-2">
            <Field label={t("Name")} htmlFor="role-name">
              <Input id="role-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("Description")} htmlFor="role-desc">
              <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6 px-0 py-5">
        {role.locked && (
          <div className="bg-accent text-accent-foreground mx-6 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm">
            <LockIcon className="size-4 shrink-0" />
            {t("Administrators always have full access, so nobody can be locked out. Use a custom role to limit an administrator account.")}
          </div>
        )}
        {groups.map((group) => (
          <section key={group}>
            <div className="flex items-center justify-between gap-2 px-6 pb-2">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{GROUPS[group] ?? group}</h3>
              {!role.locked && (
                <div className="flex gap-1">
                  {LEVELS.map((l) => (
                    <button key={l.value} type="button" className="text-muted-foreground hover:text-foreground rounded px-1.5 text-xs hover:underline" onClick={() => setGroup(group, l.value)}>
                      {t("All {level}", { level: l.label.toLowerCase() })}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="divide-y border-y">
              {shown
                .filter((m) => m.group === group)
                .map((m) => (
                  <li key={m.key} className="hover:bg-muted/40 flex flex-wrap items-center justify-between gap-3 px-6 py-2.5">
                    <span className="text-sm font-medium">{moduleLabel(m)}</span>
                    <LevelPicker value={levels[m.key] ?? "none"} disabled={role.locked} onChange={(v) => setLevels((ls) => ({ ...ls, [m.key]: v }))} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {hidden > 0 && (
          <p className="text-muted-foreground px-6 text-xs">
            {t("{count} other modules are not part of this role and cannot be given to it.", { count: hidden })}</p>
        )}
      </CardContent>
    </Card>
  );
}

function NewRoleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useAction(
    () => api.post<Role>("/permissions/roles", { name, description: description.trim() || null, permissions: {} }),
    {
      success: t("Role created"),
      invalidate: INVALIDATE,
      onSuccess: (r) => {
        onCreated(r.data.access_role_id);
        setName("");
        setDescription("");
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("New role")}</DialogTitle>
          <DialogDescription>{t("A custom role for administrator accounts, e.g. Office staff or Exam controller. It starts with no access: tick what it needs next.")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(undefined);
          }}
        >
          <Field label={t("Name")} htmlFor="new-role-name" required>
            <Input id="new-role-name" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("Description")} htmlFor="new-role-desc">
            <Textarea id="new-role-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("Cancel")}</Button>
            <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
              <PlusIcon />
              {t("Create role")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminAccounts({ roles }: { roles: Role[] }) {
  const me = useUser();
  const { data, isLoading } = useGet<AdminAccess[]>("/permissions/admins");
  const custom = roles.filter((r) => !r.is_system);
  const options = [{ value: "", label: t("Full administrator") }, ...custom.map((r) => ({ value: String(r.access_role_id), label: r.name }))];
  const assign = useAction(
    ({ id, roleId }: { id: number; roleId: string | null }) => api.put(`/permissions/admins/${id}`, { access_role_id: roleId ? Number(roleId) : null }),
    { success: t("Role updated"), invalidate: INVALIDATE },
  );
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-5">
        <CardTitle>{t("Administrator accounts")}</CardTitle>
        <CardDescription>{t("Give an administrator a custom role to limit what they can open. Full administrators can do everything, including this page.")}</CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Name")}</TableHead>
            <TableHead>{t("Role")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={2}><Skeleton className="h-8 w-full" /></TableCell>
            </TableRow>
          )}
          {data?.map((a) => {
            const self = a.admin_id === me.id;
            return (
              <TableRow key={a.admin_id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full text-xs font-semibold">{initials(a.name)}</div>
                    <div className="min-w-0">
                      <div className="font-medium">{a.name}{self && <span className="text-muted-foreground font-normal"> · {t("you")}</span>}</div>
                      <div className="text-muted-foreground truncate text-xs">{a.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-72">
                  {self ? (
                    <span className="text-muted-foreground text-sm">{t("Full administrator")}</span>
                  ) : (
                    <Combobox
                      data={options}
                      value={a.access_role_id ? String(a.access_role_id) : ""}
                      onChange={(v) => assign.mutate({ id: a.admin_id, roleId: v || null })}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {custom.length === 0 && (
        <p className="text-muted-foreground border-t px-6 py-3 text-xs">{t("Create a custom role first to limit an administrator.")}</p>
      )}
    </Card>
  );
}

export function RolesPage() {
  const roles = useGet<Role[]>("/permissions/roles");
  const modules = useGet<Module[]>("/permissions/modules");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => roles.data ?? [], [roles.data]);
  const current = list.find((r) => r.access_role_id === selected) ?? list[0];

  return (
    <>
      <PageHeader
        title={t("Roles & permissions")}
        subtitle={t("Choose what each role can open and change. View lets a role see a section without changing anything.")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("New role")}</Button>
        }
      />
      <Tabs defaultValue="roles">
        <TabsList className="mb-4">
          <TabsTrigger value="roles">
            <ShieldCheckIcon />
            {t("Roles")}</TabsTrigger>
          <TabsTrigger value="admins">
            <UserCogIcon />
            {t("Administrator accounts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="roles">
          {roles.isLoading || modules.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
            </div>
          ) : !current || !modules.data ? (
            <EmptyState icon={ShieldCheckIcon} title={t("No roles")} />
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[18rem_1fr]">
              <nav className="grid gap-1.5 lg:sticky lg:top-20">
                {[true, false].map((system) => {
                  const group = list.filter((r) => r.is_system === system);
                  if (!group.length) return null;
                  return (
                    <div key={String(system)} className="grid gap-1.5">
                      <p className="text-muted-foreground px-1 pt-2 text-xs font-semibold tracking-wide uppercase first:pt-0">
                        {system ? t("Built-in roles") : t("Custom roles")}</p>
                      {group.map((r) => {
                        const s = summary(r);
                        const active = r.access_role_id === current.access_role_id;
                        return (
                          <button
                            key={r.access_role_id}
                            type="button"
                            onClick={() => setSelected(r.access_role_id)}
                            className={cn(
                              "bg-card flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:shadow-sm",
                              active && "border-primary ring-primary/20 ring-2",
                            )}
                          >
                            <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                              {r.locked ? <LockIcon className="size-4" /> : r.is_system ? <UsersIcon className="size-4" /> : <ShieldCheckIcon className="size-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold">{roleName(r)}</div>
                              <div className="text-muted-foreground truncate text-xs">
                                {r.locked
                                  ? t("Full access")
                                  : t("{full} full · {view} view", { full: s.full, view: s.view })}
                                {r.members !== null && ` · ${t("{count} accounts", { count: r.members })}`}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
              <RoleEditor key={current.access_role_id} role={current} modules={modules.data} onDeleted={() => setSelected(null)} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="admins">
          <AdminAccounts roles={list} />
        </TabsContent>
      </Tabs>
      <NewRoleDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setSelected(id);
        }}
      />
    </>
  );
}
