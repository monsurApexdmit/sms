import dayjs from "dayjs";
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction, useList } from "../api/hooks";
import { usePageLevel } from "../hooks/use-access";
import { initials } from "../utils";
import { Combobox, type Option } from "./combobox";
import { confirmAction } from "./confirm";
import { DatePicker } from "./date-picker";
import { Field } from "./field";
import { PageHeader } from "./PageHeader";
import { Dash, TableState } from "./states";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { t } from "../i18n";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select" | "date" | "switch" | "password" | "email";
  required?: boolean;
  options?: Option[];
  /** shown in the form only (not as a table column) */
  formOnly?: boolean;
  /** shown in the table only */
  tableOnly?: boolean;
  /** password-style fields: required on create, optional on edit */
  createOnlyRequired?: boolean;
  render?: (row: Record<string, unknown>) => ReactNode;
  placeholder?: string;
  /** switch fields: start switched on when creating */
  defaultOn?: boolean;
}

interface CrudPageProps {
  title: string;
  subtitle?: string;
  path: string;
  idField: string;
  fields: FieldDef[];
  canWrite?: boolean;
  params?: Record<string, unknown>;
  searchable?: boolean;
  avatar?: boolean;
  extraActions?: (row: Record<string, unknown>) => ReactNode;
  headerExtra?: ReactNode;
  /** fixed values merged into every create/update payload */
  fixed?: Record<string, unknown>;
}

type Values = Record<string, unknown>;

function emptyValue(f: FieldDef) {
  if (f.type === "switch") return f.defaultOn ?? false;
  if (f.type === "select") return null;
  return "";
}

/** Generic table + dialog form for simple tables served by the backend crud_router. */
export function CrudPage({
  title, subtitle, path, idField, fields, canWrite: roleCanWrite = true, params, searchable, avatar,
  extraActions, headerExtra, fixed,
}: CrudPageProps) {  // prettier-ignore
  const pageLevel = usePageLevel();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Values | null>(null);
  const [opened, setOpened] = useState(false);
  const { data, isLoading } = useList<Values>(path, { ...params, ...(search ? { q: search } : {}) });

  const formFields = fields.filter((f) => !f.tableOnly);
  const columns = fields.filter((f) => !f.formOnly);
  const singular = title.replace(/s$/, "");

  const form = useForm<Values>({ defaultValues: Object.fromEntries(formFields.map((f) => [f.name, emptyValue(f)])) });

  const save = useAction(
    (values: Values) => {
      const payload: Values = { ...fixed };
      for (const f of formFields) {
        let v = values[f.name];
        if (f.type === "number") v = v === "" || v === null ? null : Number(v);
        else if (f.type === "select") v = v === "" || v === null ? null : /^\d+$/.test(String(v)) && f.name.endsWith("_id") ? Number(v) : v;
        else if (f.type === "switch") v = v ? 1 : 0;
        else if (f.type === "date") v = v || null;
        else if (v === "") v = f.type === "password" ? undefined : null;
        if (v !== undefined) payload[f.name] = v;
      }
      return editing ? api.put(`${path}/${editing[idField]}`, payload) : api.post(path, payload);
    },
    {
      success: editing ? t("Saved") : t("Created"),
      invalidate: [[path]],
      onSuccess: () => setOpened(false),
    },
  );

  const remove = useAction((id: unknown) => api.delete(`${path}/${id}`), { success: t("Deleted"), invalidate: [[path]] });

  const startCreate = () => {
    setEditing(null);
    form.reset(Object.fromEntries(formFields.map((f) => [f.name, emptyValue(f)])));
    setOpened(true);
  };

  const startEdit = (row: Values) => {
    setEditing(row);
    form.reset(
      Object.fromEntries(
        formFields.map((f) => {
          const v = row[f.name];
          if (f.type === "switch") return [f.name, Number(v) === 1];
          if (f.type === "password") return [f.name, ""];
          if (f.type === "select") return [f.name, v === null || v === undefined || v === "" ? null : String(v)];
          // legacy dates are free text; drop anything dayjs cannot parse
          if (f.type === "date") return [f.name, v && dayjs(String(v)).isValid() ? dayjs(String(v)).format("YYYY-MM-DD") : ""];
          return [f.name, v === null || v === undefined ? "" : String(v)];
        }),
      ),
    );
    setOpened(true);
  };

  const confirmDelete = (row: Values) =>
    confirmAction({ title: t("Delete {toLowerCase}?", { toLowerCase: singular.toLowerCase() }), onConfirm: () => remove.mutate(row[idField]) });

  const optionLabel = useMemo(() => {
    const maps: Record<string, Map<string, string>> = {};
    for (const f of fields) if (f.options) maps[f.name] = new Map(f.options.map((o) => [o.value, o.label]));
    return maps;
  }, [fields]);

  const cell = (row: Values, f: FieldDef): ReactNode => {
    if (f.render) return f.render(row);
    const v = row[f.name];
    if (v === null || v === undefined || v === "") return <Dash />;
    if (f.type === "switch") return Number(v) === 1 ? t("Yes") : t("No");
    if (optionLabel[f.name]) return optionLabel[f.name].get(String(v)) ?? String(v);
    return String(v);
  };

  // a role with view-only access to this page sees the list without add, edit or delete
  const canWrite = roleCanWrite && pageLevel === "full";
  const hasActions = canWrite || !!extraActions;
  const colSpan = columns.length + (avatar ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            {canWrite && (
              <Button onClick={startCreate}>
                <PlusIcon />
                {t("Add")}{" "}{singular.toLowerCase()}
              </Button>
            )}
          </>
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        {searchable && (
          <div className="border-b p-3">
            <div className="relative w-full max-w-xs">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input placeholder={t("Search name or email")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </div>
        )}
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              {avatar && <TableHead className="w-12" />}
              {columns.map((c) => (
                <TableHead key={c.name}>{c.label}</TableHead>
              ))}
              {hasActions && <TableHead className="w-32" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={data?.items.length === 0} colSpan={colSpan} />
            {data?.items.map((row) => (
              <TableRow key={String(row[idField])}>
                {avatar && (
                  <TableCell>
                    <Avatar className="size-8">
                      <AvatarImage src={(row.image_url as string) ?? undefined} alt="" />
                      <AvatarFallback className="text-xs">{initials(row.name as string)}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.name}>{cell(row, c)}</TableCell>
                ))}
                {hasActions && (
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {extraActions?.(row)}
                      {canWrite && (
                        <>
                          <IconAction label={t("Edit")} onClick={() => startEdit(row)}>
                            <PencilIcon />
                          </IconAction>
                          <IconAction label={t("Delete")} destructive onClick={() => confirmDelete(row)}>
                            <Trash2Icon />
                          </IconAction>
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={opened} onOpenChange={setOpened}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("Edit {toLowerCase}", { toLowerCase: singular.toLowerCase() }) : t("Add {toLowerCase}", { toLowerCase: singular.toLowerCase() })}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
            {formFields.map((f) => (
              <Controller
                key={f.name}
                control={form.control}
                name={f.name}
                rules={{
                  validate: (v) =>
                    (f.required || (f.createOnlyRequired && !editing)) && (v === "" || v === null || v === undefined)
                      ? t("{label} is required", { label: f.label })
                      : true,
                }}
                render={({ field, fieldState }) => (
                  <FormField def={f} editing={!!editing} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
                )}
              />
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpened(false)}>
                {t("Cancel")}</Button>
              <Button type="submit" loading={save.isPending}>
                {t("Save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Small icon-only table action with a tooltip. */
export function IconAction({
  label, onClick, destructive, disabled, loading, children,
}: { label: string; onClick?: () => void; destructive?: boolean; disabled?: boolean; loading?: boolean; children: ReactNode }) {  // prettier-ignore
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          loading={loading}
          className={destructive ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : undefined}
        >
          {!loading && children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FormField({
  def: f, editing, value, onChange, error,
}: { def: FieldDef; editing: boolean; value: unknown; onChange: (v: unknown) => void; error?: string }) {  // prettier-ignore
  const id = `field-${f.name}`;
  const required = f.required || (f.createOnlyRequired && !editing);
  const invalid = !!error || undefined;

  if (f.type === "switch")
    return (
      <div className="flex items-center gap-3">
        <Switch id={id} checked={!!value} onCheckedChange={onChange} />
        <label htmlFor={id} className="text-sm">
          {f.label}
        </label>
      </div>
    );

  let control: ReactNode;
  switch (f.type) {
    case "textarea":
      control = <Textarea id={id} rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} aria-invalid={invalid} />;
      break;
    case "select":
      control = <Combobox id={id} data={f.options ?? []} value={(value as string | null) ?? null} onChange={onChange} placeholder={f.placeholder} clearable aria-invalid={invalid} />;
      break;
    case "date":
      control = <DatePicker id={id} value={String(value ?? "")} onChange={onChange} aria-invalid={invalid} />;
      break;
    default:
      control = (
        <Input
          id={id}
          type={f.type === "email" ? "email" : f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
          step={f.type === "number" ? "any" : undefined}
          autoComplete={f.type === "password" ? "new-password" : undefined}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
          aria-invalid={invalid}
        />
      );
  }

  return (
    <Field
      label={f.label}
      htmlFor={id}
      required={required}
      error={error}
      description={f.type === "password" ? (editing ? t("Leave empty to keep the current password") : t("At least 8 characters")) : undefined}
    >
      {control}
    </Field>
  );
}
