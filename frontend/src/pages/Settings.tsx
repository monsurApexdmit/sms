import dayjs from "dayjs";
import { ImageIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api } from "../api/client";
import { useAction, useGet, usePagedList, usePublicSettings } from "../api/hooks";
import type { AuditEntry, LocalGateway, LocalGatewaySettings } from "../api/types";
import { Combobox, MultiCombobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { IconAction } from "../components/CrudPage";
import { DatePicker } from "../components/date-picker";
import { ExportButton } from "../components/ExportButton";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { GATEWAY_LABELS } from "../components/LocalGateways";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { Dash, TableState } from "../components/states";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Separator } from "../components/ui/separator";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { fromUnix } from "../utils";

type Dict = Record<string, string | null>;
const MASK = "********";

function useSettingsForm(source: Dict | undefined, path: string, invalidate: string[][]) {
  const [values, setValues] = useState<Dict>({});
  useEffect(() => {
    if (source) setValues(source);
  }, [source]);
  const save = useAction((keys: string[]) => api.put(path, Object.fromEntries(keys.map((k) => [k, values[k] ?? null]))), {
    success: "Settings saved",
    invalidate,
  });
  const set = (key: string, value: string | null) => setValues((v) => ({ ...v, [key]: value }));
  return { values, set, save };
}

/** Legacy JSON-list settings (stripe_keys, paypal) come as a string, a list or an object. */
function parseConfig(raw: unknown): Dict {
  if (typeof raw === "string") {
    try {
      return parseConfig(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw)) return parseConfig(raw[0]);
  if (raw && typeof raw === "object") return raw as Dict;
  return {};
}

function SettingsCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer && <CardFooter className="justify-end border-t pt-6">{footer}</CardFooter>}
    </Card>
  );
}

function SaveButton({ loading, onClick, label = "Save" }: { loading: boolean; onClick: () => void; label?: string }) {
  return (
    <Button loading={loading} onClick={onClick}>
      <SaveIcon />
      {label}
    </Button>
  );
}

/** Password input for masked secrets: the server sends "********" for a stored value and keeps it when sent back. */
function SecretInput({ id, value, onChange }: { id: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      value={value ?? ""}
      placeholder="Not set"
      onFocus={(e) => value === MASK && e.target.select()}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// API weekday numbers: Monday = 0
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, i) => ({ value: String(i), label }));

const secretHint = (value: string | null | undefined) => (value === MASK ? "Saved; type to replace" : undefined);

export function SystemSettingsPage() {
  const { data } = useGet<Dict>("/settings");
  const years = useGet<{ years: string[] }>("/academic-years");
  const pub = usePublicSettings();
  const { values, set, save } = useSettingsForm(data, "/settings", [["/settings"], ["/settings/public"], ["/academic-years"]]);
  const [stripe, setStripe] = useState<Dict>({});
  const [paypal, setPaypal] = useState<Dict>({});
  useEffect(() => {
    setStripe(parseConfig(data?.stripe_keys ?? "[{}]"));
    setPaypal(parseConfig((data as Record<string, unknown> | undefined)?.paypal));
  }, [data]);
  const saveStripe = useAction(() => api.put("/settings", { stripe_keys: JSON.stringify([stripe]) }), {
    success: "Stripe settings saved",
    invalidate: [["/settings"], ["/settings/public"]],
  });
  const savePaypal = useAction(
    () =>
      api.put("/settings", {
        paypal: {
          active: paypal.active === "1" ? "1" : "0",
          mode: paypal.mode === "production" ? "production" : "sandbox",
          sandbox_client_id: paypal.sandbox_client_id ?? "",
          sandbox_secret_key: paypal.sandbox_secret_key ?? "",
          production_client_id: paypal.production_client_id ?? "",
          production_secret_key: paypal.production_secret_key ?? "",
        },
      }),
    { success: "PayPal settings saved", invalidate: [["/settings"], ["/settings/public"]] },
  );
  const logo = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post("/settings/logo", body);
    },
    { success: "Logo updated", invalidate: [["/settings/public"]] },
  );

  const field = (key: string, label: string, secret = false) => {
    const id = `setting-${key}`;
    return (
      <Field key={key} label={label} htmlFor={id} description={secret ? secretHint(values[key]) : undefined}>
        {secret ? (
          <SecretInput id={id} value={values[key]} onChange={(v) => set(key, v)} />
        ) : (
          <Input id={id} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
        )}
      </Field>
    );
  };
  const saveBtn = (keys: string[]) => <SaveButton loading={save.isPending} onClick={() => save.mutate(keys)} />;
  const sms = values.active_sms_service || "disabled";
  const providerTitle = (name: string, key: string) => (
    <div className="flex items-center gap-2">
      <h3 className="font-medium">{name}</h3>
      {sms === key && <Badge className="bg-success/15 text-success border-transparent">Active</Badge>}
    </div>
  );

  return (
    <>
      <PageHeader title="System settings" subtitle="School details, messaging, email and online payments" />
      <Tabs defaultValue="general" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="email">Email (SMTP)</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="logo">Logo</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general">
          <SettingsCard
            title="General"
            description="Basic information shown across the system"
            footer={saveBtn(["system_name", "system_title", "address", "phone", "system_email", "currency", "running_year", "disable_frontend", "weekly_off_days"])}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {field("system_name", "School name")}
              {field("system_title", "System title")}
              {field("address", "Address")}
              {field("phone", "Phone")}
              {field("system_email", "System email")}
              {field("currency", "Currency code (e.g. usd, bdt)")}
              <Field label="Running academic year" description="Changing this switches every screen to the new year">
                <Combobox
                  data={(years.data?.years ?? []).map((y) => ({ value: y, label: y }))}
                  value={values.running_year ?? null}
                  onChange={(v) => set("running_year", v)}
                />
              </Field>
              <Field label="Weekly days off" description="Not counted as school days in attendance">
                <MultiCombobox
                  data={WEEKDAYS}
                  value={(values.weekly_off_days ?? "").split(",").filter(Boolean)}
                  onChange={(v) => set("weekly_off_days", [...v].sort().join(","))}
                  placeholder="None"
                />
              </Field>
              <Field label="Public website">
                <Combobox
                  data={[
                    { value: "0", label: "Enabled" },
                    { value: "1", label: "Disabled" },
                  ]}
                  value={values.disable_frontend ?? "0"}
                  onChange={(v) => set("disable_frontend", v)}
                />
              </Field>
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="sms">
          <SettingsCard
            title="SMS"
            description="Gateway used for notices, attendance and exam result messages"
            footer={saveBtn([
              "active_sms_service",
              "clickatell_user",
              "clickatell_password",
              "clickatell_api_id",
              "twilio_account_sid",
              "twilio_auth_token",
              "twilio_sender_phone_number",
              "msg91_authentication_key",
              "msg91_sender_ID",
              "msg91_route",
              "msg91_country_code",
            ])}
          >
            <Field label="Active SMS service" className="sm:max-w-xs">
              <Combobox
                data={[
                  { value: "disabled", label: "Disabled" },
                  { value: "clickatell", label: "Clickatell" },
                  { value: "twilio", label: "Twilio" },
                  { value: "msg91", label: "MSG91" },
                ]}
                value={sms}
                onChange={(v) => set("active_sms_service", v ?? "disabled")}
              />
            </Field>
            <Separator />
            {providerTitle("Clickatell", "clickatell")}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("clickatell_user", "Username")}
              {field("clickatell_password", "Password", true)}
              {field("clickatell_api_id", "API ID")}
            </div>
            <Separator />
            {providerTitle("Twilio", "twilio")}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("twilio_account_sid", "Account SID")}
              {field("twilio_auth_token", "Auth token", true)}
              {field("twilio_sender_phone_number", "Sender number")}
            </div>
            <Separator />
            {providerTitle("MSG91", "msg91")}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {field("msg91_authentication_key", "Auth key", true)}
              {field("msg91_sender_ID", "Sender ID")}
              {field("msg91_route", "Route")}
              {field("msg91_country_code", "Country code")}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="email">
          <SettingsCard title="Email (SMTP)" description="Outgoing mail server for password resets and notifications" footer={saveBtn(["smtp_host", "smtp_port", "smtp_user", "smtp_pass"])}>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("smtp_host", "SMTP host (prefix ssl:// for SSL)")}
              {field("smtp_port", "SMTP port")}
              {field("smtp_user", "SMTP user")}
              {field("smtp_pass", "SMTP password", true)}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="payments" className="space-y-6">
          <SettingsCard
            title="Stripe"
            description="Card payments through Stripe Checkout"
            footer={<SaveButton loading={saveStripe.isPending} onClick={() => saveStripe.mutate(undefined)} />}
          >
            <Alert>
              <AlertTitle>Webhook required</AlertTitle>
              <AlertDescription>
                <p>
                  Invoices are marked paid only by Stripe's signed webhook; set STRIPE_WEBHOOK_SECRET on the server and point the webhook at{" "}
                  <code className="bg-muted rounded px-1">/api/payments/stripe/webhook</code>.
                </p>
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-6">
              <SwitchRow id="stripe-active" label="Enable Stripe" checked={stripe.active === "1"} onChange={(c) => setStripe({ ...stripe, active: c ? "1" : "0" })} />
              <SwitchRow id="stripe-test" label="Test mode" checked={stripe.testmode === "on"} onChange={(c) => setStripe({ ...stripe, testmode: c ? "on" : "off" })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Test publishable key" htmlFor="stripe-pk">
                <Input id="stripe-pk" value={stripe.public_key ?? ""} onChange={(e) => setStripe({ ...stripe, public_key: e.target.value })} />
              </Field>
              <Field label="Test secret key" htmlFor="stripe-sk" description={secretHint(stripe.secret_key)}>
                <SecretInput id="stripe-sk" value={stripe.secret_key} onChange={(v) => setStripe({ ...stripe, secret_key: v })} />
              </Field>
              <Field label="Live publishable key" htmlFor="stripe-lpk">
                <Input id="stripe-lpk" value={stripe.public_live_key ?? ""} onChange={(e) => setStripe({ ...stripe, public_live_key: e.target.value })} />
              </Field>
              <Field label="Live secret key" htmlFor="stripe-lsk" description={secretHint(stripe.secret_live_key)}>
                <SecretInput id="stripe-lsk" value={stripe.secret_live_key} onChange={(v) => setStripe({ ...stripe, secret_live_key: v })} />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            title="PayPal"
            description="Parents and students pay invoices through PayPal; the server captures and verifies each order"
            footer={<SaveButton loading={savePaypal.isPending} onClick={() => savePaypal.mutate(undefined)} />}
          >
            <div className="flex flex-wrap items-end gap-6">
              <SwitchRow id="paypal-active" label="Enable PayPal" checked={paypal.active === "1"} onChange={(c) => setPaypal({ ...paypal, active: c ? "1" : "0" })} />
              <Field label="Mode" className="w-48">
                <Combobox
                  data={[
                    { value: "sandbox", label: "Sandbox (testing)" },
                    { value: "production", label: "Production (live)" },
                  ]}
                  value={paypal.mode === "production" ? "production" : "sandbox"}
                  onChange={(v) => setPaypal({ ...paypal, mode: v ?? "sandbox" })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sandbox client ID" htmlFor="pp-sci">
                <Input id="pp-sci" value={paypal.sandbox_client_id ?? ""} onChange={(e) => setPaypal({ ...paypal, sandbox_client_id: e.target.value })} />
              </Field>
              <Field label="Sandbox secret key" htmlFor="pp-ssk" description={secretHint(paypal.sandbox_secret_key)}>
                <SecretInput id="pp-ssk" value={paypal.sandbox_secret_key} onChange={(v) => setPaypal({ ...paypal, sandbox_secret_key: v })} />
              </Field>
              <Field label="Production client ID" htmlFor="pp-pci">
                <Input id="pp-pci" value={paypal.production_client_id ?? ""} onChange={(e) => setPaypal({ ...paypal, production_client_id: e.target.value })} />
              </Field>
              <Field label="Production secret key" htmlFor="pp-psk" description={secretHint(paypal.production_secret_key)}>
                <SecretInput id="pp-psk" value={paypal.production_secret_key} onChange={(v) => setPaypal({ ...paypal, production_secret_key: v })} />
              </Field>
            </div>
          </SettingsCard>

          <LocalGatewayCards />
        </TabsContent>

        <TabsContent value="logo">
          <SettingsCard title="Logo" description="Shown on the login page, sidebar and printed documents. PNG or JPG, ideally square.">
            <div className="flex flex-wrap items-center gap-6">
              <div className="bg-muted/40 flex size-28 items-center justify-center overflow-hidden rounded-lg border">
                {pub.data?.logo_url ? (
                  <img src={pub.data.logo_url} alt="School logo" className="max-h-full max-w-full object-contain p-2" />
                ) : (
                  <ImageIcon className="text-muted-foreground size-8" />
                )}
              </div>
              <FileButton onChange={(f) => f && logo.mutate(f)} accept="image/*">
                {(props) => (
                  <Button variant="secondary" loading={logo.isPending} {...props}>
                    <UploadIcon />
                    Upload logo
                  </Button>
                )}
              </FileButton>
            </div>
          </SettingsCard>
        </TabsContent>
      </Tabs>
    </>
  );
}

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

// --- bKash / Nagad / SSLCommerz ---------------------------------------------------------

const LOCAL_GATEWAYS: { key: LocalGateway; description: string; fields: [string, string, "text" | "secret" | "key"][] }[] = [
  {
    key: "bkash",
    description: "bKash tokenized checkout. The server executes each payment and checks the amount with bKash before recording it.",
    fields: [["app_key", "App key", "text"], ["app_secret", "App secret", "secret"], ["username", "Username", "text"], ["password", "Password", "secret"]],
  },
  {
    key: "nagad",
    description: "Nagad merchant checkout. Requests are signed with your merchant private key; each payment is verified with Nagad before recording.",
    fields: [
      ["merchant_id", "Merchant ID", "text"], ["merchant_number", "Merchant mobile number", "text"],
      ["merchant_private_key", "Merchant private key", "secret"], ["nagad_public_key", "Nagad public key", "key"],
    ],
  },
  {
    key: "sslcommerz",
    description: "SSLCommerz hosted checkout (cards, mobile banking, net banking). Payments are confirmed with the SSLCommerz validation API.",
    fields: [["store_id", "Store ID", "text"], ["store_password", "Store password", "secret"]],
  },
];  // prettier-ignore

function LocalGatewayCards() {
  const { data } = useGet<LocalGatewaySettings>("/payment-gateways/settings");
  const [values, setValues] = useState<Partial<Record<LocalGateway, Dict>>>({});
  useEffect(() => {
    if (data) setValues({ bkash: data.bkash, nagad: data.nagad, sslcommerz: data.sslcommerz });
  }, [data]);
  const save = useAction((gateway: LocalGateway) => api.put("/payment-gateways/settings", { [gateway]: values[gateway] }), {
    success: "Payment gateway saved",
    invalidate: [["/payment-gateways/settings"], ["/settings/public"]],
  });
  const set = (gateway: LocalGateway, key: string, value: string) => setValues((v) => ({ ...v, [gateway]: { ...v[gateway], [key]: value } }));

  return (
    <>
      {data && !data.currency_is_bdt && (
        <Alert>
          <AlertTitle>BDT only</AlertTitle>
          <AlertDescription>bKash, Nagad and SSLCommerz are offered to parents only when the currency in General settings is bdt.</AlertDescription>
        </Alert>
      )}
      {LOCAL_GATEWAYS.map(({ key, description, fields }) => {
        const cfg = values[key] ?? {};
        return (
          <SettingsCard
            key={key}
            title={GATEWAY_LABELS[key]}
            description={description}
            footer={<SaveButton loading={save.isPending && save.variables === key} onClick={() => save.mutate(key)} />}
          >
            <div className="flex flex-wrap items-end gap-6">
              <SwitchRow id={`${key}-active`} label={`Enable ${GATEWAY_LABELS[key]}`} checked={cfg.active === "1"} onChange={(c) => set(key, "active", c ? "1" : "0")} />
              <Field label="Mode" className="w-48">
                <Combobox
                  data={[
                    { value: "sandbox", label: "Sandbox (testing)" },
                    { value: "live", label: "Live" },
                  ]}
                  value={cfg.mode === "live" ? "live" : "sandbox"}
                  onChange={(v) => set(key, "mode", v ?? "sandbox")}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(([name, label, kind]) => (
                <Field key={name} label={label} htmlFor={`${key}-${name}`} description={kind === "secret" ? secretHint(cfg[name]) : undefined} className={kind === "key" ? "sm:col-span-2" : undefined}>
                  {kind === "secret" ? (
                    <SecretInput id={`${key}-${name}`} value={cfg[name]} onChange={(v) => set(key, name, v)} />
                  ) : kind === "key" ? (
                    <Textarea id={`${key}-${name}`} rows={3} className="font-mono text-xs" value={cfg[name] ?? ""} onChange={(e) => set(key, name, e.target.value)} />
                  ) : (
                    <Input id={`${key}-${name}`} value={cfg[name] ?? ""} onChange={(e) => set(key, name, e.target.value)} />
                  )}
                </Field>
              ))}
            </div>
          </SettingsCard>
        );
      })}
    </>
  );
}

// --- website ------------------------------------------------------------------

interface Slide {
  title: string;
  description: string;
  image: string;
  image_url?: string | null;
}

const SOCIAL = ["facebook", "twitter", "google", "instagram", "linkedin", "youtube"] as const;
const THEMES = [
  { value: "default", label: "Default", description: "Full-width photo hero with a dark overlay" },
  { value: "ultimate", label: "Ultimate", description: "Split hero with a coloured panel beside the photo" },
];

function ImageUpload({ label, url, path, invalidate }: { label: string; url?: string | null; path: string; invalidate: string[][] }) {
  const up = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(path, body);
    },
    { success: `${label} updated`, invalidate },
  );
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="bg-muted/40 flex h-24 items-center justify-center overflow-hidden rounded-md border">
          {url ? <img src={url} alt={label} className="max-h-full max-w-full object-contain p-2" /> : <span className="text-muted-foreground text-sm">Not set</span>}
        </div>
        <FileButton onChange={(f) => f && up.mutate(f)} accept="image/*">
          {(props) => (
            <Button size="sm" variant="secondary" loading={up.isPending} {...props}>
              <UploadIcon />
              Upload
            </Button>
          )}
        </FileButton>
      </CardContent>
    </Card>
  );
}

function SimpleList<T extends Record<string, unknown>>({
  path, idField, title, columns, form: FormComp,
}: { path: string; idField: string; title: string; columns: [string, (r: T) => ReactNode][]; form: (p: { item: T | null; onDone: () => void }) => ReactNode }) {  // prettier-ignore
  const { data, isLoading } = useGet<T[]>(path);
  const [editing, setEditing] = useState<T | null | "new">(null);
  const del = useAction((id: unknown) => api.delete(`${path}/${id}`), { success: "Deleted", invalidate: [[path]] });
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <span className="text-muted-foreground text-sm">{data ? `${data.length} items` : ""}</span>
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon />
          Add
        </Button>
      </div>
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map(([h]) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState loading={isLoading} empty={data?.length === 0} colSpan={columns.length + 1} />
          {data?.map((r) => (
            <TableRow key={String(r[idField])}>
              {columns.map(([h, render]) => (
                <TableCell key={h}>{render(r)}</TableCell>
              ))}
              <TableCell>
                <div className="flex justify-end gap-1">
                  <IconAction label="Edit" onClick={() => setEditing(r)}>
                    <PencilIcon />
                  </IconAction>
                  <IconAction label="Delete" destructive onClick={() => confirmAction({ title: "Delete?", onConfirm: () => del.mutate(r[idField]) })}>
                    <Trash2Icon />
                  </IconAction>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Add" : "Edit"} {title}
            </DialogTitle>
          </DialogHeader>
          {editing !== null && <FormComp item={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function multipart(values: Record<string, unknown>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v instanceof File) body.append(k, v);
    else if (v !== null && v !== undefined) body.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return body;
}

function ImageInput({ id, onChange }: { id: string; onChange: (file: File | null) => void }) {
  return <Input id={id} type="file" accept="image/*" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />;
}

function FormFooter({ onCancel, loading }: { onCancel: () => void; loading: boolean }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={loading}>
        Save
      </Button>
    </DialogFooter>
  );
}

const Thumb = ({ url }: { url: string | null }) => (url ? <img src={url} alt="" className="h-8 w-12 rounded object-cover" /> : <Dash />);

type NewsRow = { frontend_news_id: number; title: string; description: string; date_added: number; image_url: string | null };
function NewsForm({ item, onDone }: { item: NewsRow | null; onDone: () => void }) {
  const [v, setV] = useState({ title: item?.title ?? "", description: item?.description ?? "", image: null as File | null });
  const save = useAction((v: Record<string, unknown>) => (item ? api.put(`/cms/news/${item.frontend_news_id}`, multipart(v)) : api.post("/cms/news", multipart(v))), {
    success: "Saved",
    invalidate: [["/cms/news"]],
    onSuccess: onDone,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(v);
      }}
      className="grid gap-4"
    >
      <Field label="Title" htmlFor="news-title" required>
        <Input id="news-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label="Text" htmlFor="news-text">
        <Textarea id="news-text" rows={8} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <Field label="Image" htmlFor="news-image" description={item?.image_url ? "Leave empty to keep the current image" : undefined}>
        <ImageInput id="news-image" onChange={(image) => setV({ ...v, image })} />
      </Field>
      <FormFooter onCancel={onDone} loading={save.isPending} />
    </form>
  );
}

type EventRow = { frontend_events_id: number; title: string; timestamp: number; status: number };
function EventForm({ item, onDone }: { item: EventRow | null; onDone: () => void }) {
  const [v, setV] = useState({
    title: item?.title ?? "",
    date: item ? dayjs.unix(item.timestamp).format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"),
    status: item ? item.status === 1 : true,
  });
  const save = useAction(
    () => {
      const body = { title: v.title, date: v.date || dayjs().format("YYYY-MM-DD"), status: v.status ? 1 : 0 };
      return item ? api.put(`/cms/events/${item.frontend_events_id}`, body) : api.post("/cms/events", body);
    },
    { success: "Saved", invalidate: [["/cms/events"]], onSuccess: onDone },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
      className="grid gap-4"
    >
      <Field label="Title" htmlFor="event-title" required>
        <Input id="event-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label="Date">
        <DatePicker value={v.date} onChange={(date) => setV({ ...v, date })} clearable={false} />
      </Field>
      <SwitchRow id="event-status" label="Show on website" checked={v.status} onChange={(status) => setV({ ...v, status })} />
      <FormFooter onCancel={onDone} loading={save.isPending} />
    </form>
  );
}

type GalleryRow = { frontend_gallery_id: number; title: string; description: string; show_on_website: number; image_url: string | null };
function GalleryForm({ item, onDone }: { item: GalleryRow | null; onDone: () => void }) {
  const [v, setV] = useState({
    title: item?.title ?? "",
    description: item?.description ?? "",
    show_on_website: item ? item.show_on_website === 1 : true,
    image: null as File | null,
  });
  const save = useAction(
    (v: Record<string, unknown>) => (item ? api.put(`/cms/gallery/${item.frontend_gallery_id}`, multipart(v)) : api.post("/cms/gallery", multipart(v))),
    { success: "Saved", invalidate: [["/cms/gallery"]], onSuccess: onDone },
  );
  const detail = useGet<{ images: { frontend_gallery_image_id: number; image_url: string }[] }>(item ? `/cms/gallery/${item.frontend_gallery_id}` : null);
  const addImages = useAction(
    (files: File[]) => {
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      return api.post(`/cms/gallery/${item!.frontend_gallery_id}/images`, body);
    },
    { success: "Images added", invalidate: [[`/cms/gallery/${item?.frontend_gallery_id}`]] },
  );
  const delImage = useAction((id: number) => api.delete(`/cms/gallery-images/${id}`), { invalidate: [[`/cms/gallery/${item?.frontend_gallery_id}`]] });
  const photos = useRef<HTMLInputElement>(null);

  return (
    <div className="grid gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(v);
        }}
        className="grid gap-4"
      >
        <Field label="Title" htmlFor="gallery-title" required>
          <Input id="gallery-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="gallery-desc">
          <Textarea id="gallery-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <Field label="Cover image" htmlFor="gallery-cover" description={item?.image_url ? "Leave empty to keep the current cover" : undefined}>
          <ImageInput id="gallery-cover" onChange={(image) => setV({ ...v, image })} />
        </Field>
        <SwitchRow id="gallery-show" label="Show on website" checked={v.show_on_website} onChange={(show_on_website) => setV({ ...v, show_on_website })} />
        <FormFooter onCancel={onDone} loading={save.isPending} />
      </form>
      {item && (
        <div className="grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Photos</h3>
            <input
              ref={photos}
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                if (files.length) addImages.mutate(files);
                e.currentTarget.value = "";
              }}
            />
            <Button size="sm" variant="secondary" loading={addImages.isPending} onClick={() => photos.current?.click()}>
              <UploadIcon />
              Add photos
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {detail.data?.images.map((img) => (
              <div key={img.frontend_gallery_image_id} className="group relative">
                <img src={img.image_url} alt="" className="aspect-square w-full rounded-md object-cover" />
                <Button
                  size="icon-xs"
                  variant="destructive"
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 opacity-90"
                  onClick={() => delImage.mutate(img.frontend_gallery_image_id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
          {detail.data?.images.length === 0 && <p className="text-muted-foreground text-sm">No photos in this album yet.</p>}
        </div>
      )}
    </div>
  );
}

const TEXT_KEYS = [
  "school_title", "address", "phone", "email", "fax", "copyright_text", "school_location", "homepage_note_title",
  "homepage_note_description", "about_us", "terms_conditions", "privacy_policy", "theme", "recaptcha_site_key", "recaptcha_secret_key",
];  // prettier-ignore

export function WebsitePage() {
  const { data } = useGet<Dict & { slider: Slide[] }>("/cms/settings");
  const source = useMemo(() => (data ? (Object.fromEntries(TEXT_KEYS.map((k) => [k, (data[k] as string) ?? ""])) as Dict) : undefined), [data]);
  const { values, set, save } = useSettingsForm(source, "/cms/settings", [["/cms/settings"]]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [social, setSocial] = useState<Dict>({});
  useEffect(() => {
    setSlides(data?.slider ?? []);
    setSocial(parseConfig(data?.social_links));
  }, [data]);
  const saveSlides = useAction(() => api.put("/cms/slider", slides.map(({ title, description, image }) => ({ title, description, image }))), {
    success: "Slider saved",
    invalidate: [["/cms/settings"]],
  });
  const saveSocial = useAction(() => api.put("/cms/settings", { social_links: JSON.stringify([social]) }), {
    success: "Social links saved",
    invalidate: [["/cms/settings"]],
  });
  const uploadSlide = useAction(
    async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return (await api.post<{ image: string; image_url: string }>("/cms/slider/image", body)).data;
    },
    { onSuccess: (r) => setSlides((s) => [...s, { title: "", description: "", image: r.image, image_url: r.image_url }]) },
  );
  const inv = [["/cms/settings"]];
  // the secret is only editable when the backend exposes it (it comes back masked)
  const hasSecret = !!data && "recaptcha_secret_key" in data;

  const text = (key: string, label: string, opts: { area?: boolean; rows?: number; placeholder?: string; className?: string } = {}) => {
    const id = `site-${key}`;
    return (
      <Field key={key} label={label} htmlFor={id} className={opts.className}>
        {opts.area ? (
          <Textarea id={id} rows={opts.rows ?? 4} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
        ) : (
          <Input id={id} placeholder={opts.placeholder} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
        )}
      </Field>
    );
  };
  const saveBtn = (keys: string[]) => <SaveButton loading={save.isPending} onClick={() => save.mutate(keys)} />;
  const theme = values.theme === "ultimate" ? "ultimate" : "default";

  return (
    <>
      <PageHeader title="Website" subtitle="Content of the public school website" />
      <Tabs defaultValue="general" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="social">Social links</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="images">Images & slider</TabsTrigger>
            <TabsTrigger value="news">News</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="space-y-6">
          <SettingsCard
            title="School information"
            description="Contact details and the homepage note"
            footer={saveBtn(TEXT_KEYS.slice(0, 9))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text("school_title", "School title")}
              {text("email", "Email")}
              {text("phone", "Phone")}
              {text("fax", "Fax")}
              {text("address", "Address")}
              {text("school_location", "Map location (lat,lng)", { placeholder: "23.8103,90.4125" })}
              {text("copyright_text", "Copyright text")}
              {text("homepage_note_title", "Homepage note title")}
            </div>
            {text("homepage_note_description", "Homepage note", { area: true, rows: 3 })}
          </SettingsCard>

          <SettingsCard title="Theme" description="Look of the public website's homepage" footer={saveBtn(["theme"])}>
            <RadioGroup value={theme} onValueChange={(v) => set("theme", v)} className="grid gap-3 sm:grid-cols-2">
              {THEMES.map((t) => (
                <Label
                  key={t.value}
                  htmlFor={`theme-${t.value}`}
                  className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal", theme === t.value && "border-primary bg-primary/5")}
                >
                  <RadioGroupItem id={`theme-${t.value}`} value={t.value} className="mt-0.5" />
                  <div className="grid flex-1 gap-3">
                    <div>
                      <p className="font-medium">{t.label}</p>
                      <p className="text-muted-foreground text-sm">{t.description}</p>
                    </div>
                    <ThemePreview variant={t.value} />
                  </div>
                </Label>
              ))}
            </RadioGroup>
          </SettingsCard>

          <SettingsCard
            title="Spam protection (reCAPTCHA)"
            description={
              <>
                Protects the contact form. Create v2 checkbox keys in the{" "}
                <a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  reCAPTCHA admin console
                </a>
                .
              </>
            }
            footer={saveBtn(hasSecret ? ["recaptcha_site_key", "recaptcha_secret_key"] : ["recaptcha_site_key"])}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text("recaptcha_site_key", "Site key")}
              {hasSecret && (
                <Field label="Secret key" htmlFor="site-recaptcha_secret_key" description={secretHint(values.recaptcha_secret_key)}>
                  <SecretInput id="site-recaptcha_secret_key" value={values.recaptcha_secret_key} onChange={(v) => set("recaptcha_secret_key", v)} />
                </Field>
              )}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="social">
          <SettingsCard
            title="Social links"
            description="Shown in the website footer. Use full addresses starting with https://"
            footer={<SaveButton loading={saveSocial.isPending} onClick={() => saveSocial.mutate(undefined)} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL.map((k) => (
                <Field key={k} label={k === "twitter" ? "Twitter / X" : k[0]!.toUpperCase() + k.slice(1)} htmlFor={`social-${k}`}>
                  <Input
                    id={`social-${k}`}
                    type="url"
                    placeholder={`https://${k === "google" ? "g.page" : `${k}.com`}/…`}
                    value={social[k] ?? ""}
                    onChange={(e) => setSocial({ ...social, [k]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="pages">
          <SettingsCard title="Pages" description="Plain text; line breaks are kept" footer={saveBtn(["about_us", "terms_conditions", "privacy_policy"])}>
            {text("about_us", "About us", { area: true, rows: 8 })}
            {text("terms_conditions", "Terms & conditions", { area: true, rows: 8 })}
            {text("privacy_policy", "Privacy policy", { area: true, rows: 8 })}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="images" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <ImageUpload label="Header logo" url={data?.header_logo_url} path="/cms/images/header_logo" invalidate={inv} />
            <ImageUpload label="Footer logo" url={data?.footer_logo_url} path="/cms/images/footer_logo" invalidate={inv} />
            <ImageUpload label="About us image" url={data?.about_us_image_url} path="/cms/images/about_us_image" invalidate={inv} />
          </div>
          <SettingsCard
            title="Homepage slider"
            description="Large images at the top of the homepage. Wide photos (16:9) work best."
            footer={
              <div className="flex flex-wrap gap-2">
                <FileButton onChange={(f) => f && uploadSlide.mutate(f)} accept="image/*">
                  {(props) => (
                    <Button variant="secondary" loading={uploadSlide.isPending} {...props}>
                      <PlusIcon />
                      Add slide
                    </Button>
                  )}
                </FileButton>
                <SaveButton label="Save slider" loading={saveSlides.isPending} onClick={() => saveSlides.mutate(undefined)} />
              </div>
            }
          >
            {slides.length === 0 && <p className="text-muted-foreground text-sm">No slides yet.</p>}
            {slides.map((s, i) => (
              <div key={i} className="grid grid-cols-[5rem_1fr_auto] items-start gap-3 sm:grid-cols-[6rem_1fr_1fr_auto] sm:items-center">
                <div className="bg-muted aspect-video overflow-hidden rounded-md">{s.image_url && <img src={s.image_url} alt="" className="size-full object-cover" />}</div>
                <Input
                  placeholder="Title"
                  aria-label="Slide title"
                  value={s.title}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlides((all) => all.map((x, j) => (j === i ? { ...x, title: v } : x)));
                  }}
                />
                <Input
                  placeholder="Description"
                  aria-label="Slide description"
                  className="col-start-2 sm:col-start-auto"
                  value={s.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlides((all) => all.map((x, j) => (j === i ? { ...x, description: v } : x)));
                  }}
                />
                <div className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">
                  <IconAction label="Remove slide" destructive onClick={() => setSlides((all) => all.filter((_, j) => j !== i))}>
                    <Trash2Icon />
                  </IconAction>
                </div>
              </div>
            ))}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="news">
          <SimpleList<NewsRow>
            path="/cms/news"
            idField="frontend_news_id"
            title="news"
            form={NewsForm}
            columns={[
              ["Title", (r) => <span className="font-medium">{r.title}</span>],
              ["Date", (r) => fromUnix(r.date_added)],
              ["Image", (r) => <Thumb url={r.image_url} />],
            ]}
          />
        </TabsContent>
        <TabsContent value="events">
          <SimpleList<EventRow>
            path="/cms/events"
            idField="frontend_events_id"
            title="event"
            form={EventForm}
            columns={[
              ["Title", (r) => <span className="font-medium">{r.title}</span>],
              ["Date", (r) => fromUnix(r.timestamp)],
              ["Visible", (r) => <VisibleBadge on={r.status === 1} />],
            ]}
          />
        </TabsContent>
        <TabsContent value="gallery">
          <SimpleList<GalleryRow>
            path="/cms/gallery"
            idField="frontend_gallery_id"
            title="album"
            form={GalleryForm}
            columns={[
              ["Title", (r) => <span className="font-medium">{r.title}</span>],
              ["Cover", (r) => <Thumb url={r.image_url} />],
              ["Visible", (r) => <VisibleBadge on={r.show_on_website === 1} />],
            ]}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function VisibleBadge({ on }: { on: boolean }) {
  return on ? <Badge className="bg-success/15 text-success border-transparent">Yes</Badge> : <Badge variant="secondary">No</Badge>;
}

/** Tiny wireframe of the two homepage hero styles. */
function ThemePreview({ variant }: { variant: string }) {
  if (variant === "ultimate")
    return (
      <div className="grid h-16 grid-cols-2 overflow-hidden rounded-md border">
        <div className="bg-primary flex flex-col justify-center gap-1 p-2">
          <div className="bg-primary-foreground/80 h-1.5 w-3/4 rounded" />
          <div className="bg-primary-foreground/50 h-1 w-1/2 rounded" />
        </div>
        <div className="from-muted-foreground/30 to-muted bg-gradient-to-br" />
      </div>
    );
  return (
    <div className="from-muted-foreground/40 to-muted-foreground/20 flex h-16 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-gradient-to-br">
      <div className="h-1.5 w-1/2 rounded bg-white/90" />
      <div className="h-1 w-1/3 rounded bg-white/60" />
    </div>
  );
}

// --- audit log ----------------------------------------------------------------

const AUDIT_ACTIONS: Record<AuditEntry["action"], [string, string]> = {
  insert: ["Added", "border-transparent bg-success/15 text-success"],
  update: ["Changed", "border-transparent bg-warning/20 text-amber-700 dark:text-amber-300"],
  delete: ["Deleted", "border-transparent bg-destructive/15 text-destructive"],
};

const auditValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function AuditChanges({ entry }: { entry: AuditEntry }) {
  const fields = Object.entries(entry.changes);
  if (fields.length === 0) return <Dash />;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {fields.map(([field, value]) => (
        <div key={field} className="contents">
          <dt className="text-muted-foreground font-mono">{field}</dt>
          <dd className="break-all">
            {entry.action === "update" && Array.isArray(value) ? (
              <>
                <span className="text-muted-foreground line-through">{auditValue(value[0])}</span> → {auditValue(value[1])}
              </>
            ) : (
              auditValue(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditLogPage() {
  const tables = useGet<string[]>("/audit-log/tables");
  const [table, setTable] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filters = {
    table_name: table ?? undefined, action: action ?? undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined,
  };  // prettier-ignore
  const { data, isLoading, page, setPage, pageSize } = usePagedList<AuditEntry>("/audit-log", filters);
  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who changed marks, attendance, invoices, payments, enrolments, accounts and settings in this system, and what changed."
        actions={<ExportButton size="default" path="/export/audit-log.xlsx" params={filters} />}
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Combobox data={(tables.data ?? []).map((t) => ({ value: t, label: t }))} value={table} onChange={setTable} clearable placeholder="All tables" />
          <Combobox data={Object.entries(AUDIT_ACTIONS).map(([value, [label]]) => ({ value, label }))} value={action} onChange={setAction} clearable placeholder="All actions" />
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="From date" />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="To date" />
        </div>
        <Table className="min-w-[800px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-40">When</TableHead>
              <TableHead className="w-44">By</TableHead>
              <TableHead className="w-28">Action</TableHead>
              <TableHead className="w-40">Record</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={5} emptyText="No changes recorded" />
            {rows.map((entry) => {
              const [label, style] = AUDIT_ACTIONS[entry.action] ?? [entry.action, ""];
              return (
                <TableRow key={entry.audit_id} className="align-top">
                  <TableCell className="tabular-nums">{dayjs(entry.created_at).format("YYYY-MM-DD HH:mm:ss")}</TableCell>
                  <TableCell>
                    {entry.actor ? (
                      <>
                        <div className="font-medium">{entry.actor_name ?? entry.actor}</div>
                        <div className="text-muted-foreground text-xs">{entry.actor}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell><Badge className={style}>{label}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{entry.table_name} #{entry.row_id}</TableCell>
                  <TableCell className="whitespace-normal"><AuditChanges entry={entry} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </Card>
    </>
  );
}
