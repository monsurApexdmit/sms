import dayjs from "dayjs";
import { ImageIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api } from "../api/client";
import { useAction, useGet, usePagedList, usePublicSettings } from "../api/hooks";
import type { AuditEntry, LocalGateway, LocalGatewaySettings } from "../api/types";
import { AiSettingsCard } from "../components/Ai";
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
import { TwoFactorUsers } from "../components/TwoFactor";
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
import { normalizeLanguage, t as tr } from "../i18n";

type Dict = Record<string, string | null>;
const MASK = "********";

function useSettingsForm(source: Dict | undefined, path: string, invalidate: string[][]) {
  const [values, setValues] = useState<Dict>({});
  useEffect(() => {
    if (source) setValues(source);
  }, [source]);
  const save = useAction((keys: string[]) => api.put(path, Object.fromEntries(keys.map((k) => [k, values[k] ?? null]))), {
    success: tr("Settings saved"),
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

function SaveButton({ loading, onClick, label = tr("Save") }: { loading: boolean; onClick: () => void; label?: string }) {
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
      placeholder={tr("Not set")}
      onFocus={(e) => value === MASK && e.target.select()}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// API weekday numbers: Monday = 0
const WEEKDAYS = [tr("Monday"), tr("Tuesday"), tr("Wednesday"), tr("Thursday"), tr("Friday"), tr("Saturday"), tr("Sunday")].map((label, i) => ({ value: String(i), label }));
const MFA_ROLES = ["admin", "accountant", "librarian", "teacher", "parent", "student"].map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }));

const secretHint = (value: string | null | undefined) => (value === MASK ? tr("Saved; type to replace") : undefined);

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
    success: tr("Stripe settings saved"),
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
    { success: tr("PayPal settings saved"), invalidate: [["/settings"], ["/settings/public"]] },
  );
  const logo = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post("/settings/logo", body);
    },
    { success: tr("Logo updated"), invalidate: [["/settings/public"]] },
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
      {sms === key && <Badge className="bg-success/15 text-success border-transparent">{tr("Active")}</Badge>}
    </div>
  );

  return (
    <>
      <PageHeader title={tr("System settings")} subtitle={tr("School details, messaging, email and online payments")} />
      <Tabs defaultValue="general" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="general">{tr("General")}</TabsTrigger>
            <TabsTrigger value="sms">{tr("SMS")}</TabsTrigger>
            <TabsTrigger value="email">{tr("Email (SMTP)")}</TabsTrigger>
            <TabsTrigger value="payments">{tr("Payments")}</TabsTrigger>
            <TabsTrigger value="logo">{tr("Logo")}</TabsTrigger>
            <TabsTrigger value="ai">{tr("AI assistant")}</TabsTrigger>
            <TabsTrigger value="security">{tr("Security")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="ai">
          <AiSettingsCard />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SettingsCard
            title={tr("Two-factor authentication")}
            description={tr("Roles that must use an authenticator app at sign-in. Their users set it up the next time they sign in.")}
            footer={saveBtn(["mfa_required_roles"])}
          >
            <Field label={tr("Required for")} className="max-w-md">
              <MultiCombobox
                data={MFA_ROLES}
                value={(values.mfa_required_roles ?? "").split(",").filter(Boolean)}
                onChange={(v) => set("mfa_required_roles", [...v].sort().join(","))}
                placeholder={tr("Nobody (optional for everyone)")}
              />
            </Field>
          </SettingsCard>
          <SettingsCard title={tr("Accounts using two-factor authentication")} description={tr("Reset someone who lost their phone so they can sign in again.")}>
            <TwoFactorUsers />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="general">
          <SettingsCard
            title={tr("General")}
            description={tr("Basic information shown across the system")}
            footer={saveBtn(["system_name", "system_title", "address", "phone", "system_email", "currency", "running_year", "disable_frontend", "weekly_off_days", "language"])}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {field("system_name", tr("School name"))}
              {field("system_title", tr("System title"))}
              {field("address", tr("Address"))}
              {field("phone", tr("Phone"))}
              {field("system_email", tr("System email"))}
              {field("currency", tr("Currency code (e.g. usd, bdt)"))}
              <Field label={tr("Running academic year")} description={tr("Changing this switches every screen to the new year")}>
                <Combobox
                  data={(years.data?.years ?? []).map((y) => ({ value: y, label: y }))}
                  value={values.running_year ?? null}
                  onChange={(v) => set("running_year", v)}
                />
              </Field>
              <Field label={tr("Weekly days off")} description={tr("Not counted as school days in attendance")}>
                <MultiCombobox
                  data={WEEKDAYS}
                  value={(values.weekly_off_days ?? "").split(",").filter(Boolean)}
                  onChange={(v) => set("weekly_off_days", [...v].sort().join(","))}
                  placeholder={tr("None")}
                />
              </Field>
              <Field label={tr("Default language")} description={tr("For everyone who has not picked a language in the menu")}>
                <Combobox
                  // the old app reads application/language/<value>.json, so these are its file names
                  data={[
                    { value: "english", label: "English" },
                    { value: "bengali", label: "বাংলা" },
                  ]}
                  value={normalizeLanguage(values.language) === "bn" ? "bengali" : "english"}
                  onChange={(v) => set("language", v ?? "english")}
                />
              </Field>
              <Field label={tr("Public website")}>
                <Combobox
                  data={[
                    { value: "0", label: tr("Enabled") },
                    { value: "1", label: tr("Disabled") },
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
            title={tr("SMS")}
            description={tr("Gateway used for notices, attendance and exam result messages")}
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
            <Field label={tr("Active SMS service")} className="sm:max-w-xs">
              <Combobox
                data={[
                  { value: "disabled", label: tr("Disabled") },
                  { value: "clickatell", label: tr("Clickatell") },
                  { value: "twilio", label: tr("Twilio") },
                  { value: "msg91", label: tr("MSG91") },
                ]}
                value={sms}
                onChange={(v) => set("active_sms_service", v ?? "disabled")}
              />
            </Field>
            <Separator />
            {providerTitle(tr("Clickatell"), "clickatell")}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("clickatell_user", tr("Username"))}
              {field("clickatell_password", tr("Password"), true)}
              {field("clickatell_api_id", tr("API ID"))}
            </div>
            <Separator />
            {providerTitle(tr("Twilio"), "twilio")}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("twilio_account_sid", tr("Account SID"))}
              {field("twilio_auth_token", tr("Auth token"), true)}
              {field("twilio_sender_phone_number", tr("Sender number"))}
            </div>
            <Separator />
            {providerTitle(tr("MSG91"), "msg91")}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {field("msg91_authentication_key", tr("Auth key"), true)}
              {field("msg91_sender_ID", tr("Sender ID"))}
              {field("msg91_route", tr("Route"))}
              {field("msg91_country_code", tr("Country code"))}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="email">
          <SettingsCard title={tr("Email (SMTP)")} description={tr("Outgoing mail server for password resets and notifications")} footer={saveBtn(["smtp_host", "smtp_port", "smtp_user", "smtp_pass"])}>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("smtp_host", "SMTP host (prefix ssl:// for SSL)")}
              {field("smtp_port", tr("SMTP port"))}
              {field("smtp_user", tr("SMTP user"))}
              {field("smtp_pass", tr("SMTP password"), true)}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="payments" className="space-y-6">
          <SettingsCard
            title={tr("Stripe")}
            description={tr("Card payments through Stripe Checkout")}
            footer={<SaveButton loading={saveStripe.isPending} onClick={() => saveStripe.mutate(undefined)} />}
          >
            <Alert>
              <AlertTitle>{tr("Webhook required")}</AlertTitle>
              <AlertDescription>
                <p>
                  {tr("Invoices are marked paid only by Stripe's signed webhook; set STRIPE_WEBHOOK_SECRET on the server and point the webhook at")}{" "}
                  <code className="bg-muted rounded px-1">/api/payments/stripe/webhook</code>.
                </p>
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-6">
              <SwitchRow id="stripe-active" label={tr("Enable Stripe")} checked={stripe.active === "1"} onChange={(c) => setStripe({ ...stripe, active: c ? "1" : "0" })} />
              <SwitchRow id="stripe-test" label={tr("Test mode")} checked={stripe.testmode === "on"} onChange={(c) => setStripe({ ...stripe, testmode: c ? "on" : "off" })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("Test publishable key")} htmlFor="stripe-pk">
                <Input id="stripe-pk" value={stripe.public_key ?? ""} onChange={(e) => setStripe({ ...stripe, public_key: e.target.value })} />
              </Field>
              <Field label={tr("Test secret key")} htmlFor="stripe-sk" description={secretHint(stripe.secret_key)}>
                <SecretInput id="stripe-sk" value={stripe.secret_key} onChange={(v) => setStripe({ ...stripe, secret_key: v })} />
              </Field>
              <Field label={tr("Live publishable key")} htmlFor="stripe-lpk">
                <Input id="stripe-lpk" value={stripe.public_live_key ?? ""} onChange={(e) => setStripe({ ...stripe, public_live_key: e.target.value })} />
              </Field>
              <Field label={tr("Live secret key")} htmlFor="stripe-lsk" description={secretHint(stripe.secret_live_key)}>
                <SecretInput id="stripe-lsk" value={stripe.secret_live_key} onChange={(v) => setStripe({ ...stripe, secret_live_key: v })} />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            title={tr("PayPal")}
            description={tr("Parents and students pay invoices through PayPal; the server captures and verifies each order")}
            footer={<SaveButton loading={savePaypal.isPending} onClick={() => savePaypal.mutate(undefined)} />}
          >
            <div className="flex flex-wrap items-end gap-6">
              <SwitchRow id="paypal-active" label={tr("Enable PayPal")} checked={paypal.active === "1"} onChange={(c) => setPaypal({ ...paypal, active: c ? "1" : "0" })} />
              <Field label={tr("Mode")} className="w-48">
                <Combobox
                  data={[
                    { value: "sandbox", label: tr("Sandbox (testing)") },
                    { value: "production", label: tr("Production (live)") },
                  ]}
                  value={paypal.mode === "production" ? "production" : "sandbox"}
                  onChange={(v) => setPaypal({ ...paypal, mode: v ?? "sandbox" })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("Sandbox client ID")} htmlFor="pp-sci">
                <Input id="pp-sci" value={paypal.sandbox_client_id ?? ""} onChange={(e) => setPaypal({ ...paypal, sandbox_client_id: e.target.value })} />
              </Field>
              <Field label={tr("Sandbox secret key")} htmlFor="pp-ssk" description={secretHint(paypal.sandbox_secret_key)}>
                <SecretInput id="pp-ssk" value={paypal.sandbox_secret_key} onChange={(v) => setPaypal({ ...paypal, sandbox_secret_key: v })} />
              </Field>
              <Field label={tr("Production client ID")} htmlFor="pp-pci">
                <Input id="pp-pci" value={paypal.production_client_id ?? ""} onChange={(e) => setPaypal({ ...paypal, production_client_id: e.target.value })} />
              </Field>
              <Field label={tr("Production secret key")} htmlFor="pp-psk" description={secretHint(paypal.production_secret_key)}>
                <SecretInput id="pp-psk" value={paypal.production_secret_key} onChange={(v) => setPaypal({ ...paypal, production_secret_key: v })} />
              </Field>
            </div>
          </SettingsCard>

          <LocalGatewayCards />
        </TabsContent>

        <TabsContent value="logo">
          <SettingsCard title={tr("Logo")} description={tr("Shown on the login page, sidebar and printed documents. PNG or JPG, ideally square.")}>
            <div className="flex flex-wrap items-center gap-6">
              <div className="bg-muted/40 flex size-28 items-center justify-center overflow-hidden rounded-lg border">
                {pub.data?.logo_url ? (
                  <img src={pub.data.logo_url} alt={tr("School logo")} className="max-h-full max-w-full object-contain p-2" />
                ) : (
                  <ImageIcon className="text-muted-foreground size-8" />
                )}
              </div>
              <FileButton onChange={(f) => f && logo.mutate(f)} accept="image/*">
                {(props) => (
                  <Button variant="secondary" loading={logo.isPending} {...props}>
                    <UploadIcon />
                    {tr("Upload logo")}</Button>
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
    description: tr("bKash tokenized checkout. The server executes each payment and checks the amount with bKash before recording it."),
    fields: [["app_key", tr("App key"), "text"], ["app_secret", tr("App secret"), "secret"], ["username", tr("Username"), "text"], ["password", tr("Password"), "secret"]],
  },
  {
    key: "nagad",
    description: tr("Nagad merchant checkout. Requests are signed with your merchant private key; each payment is verified with Nagad before recording."),
    fields: [
      ["merchant_id", tr("Merchant ID"), "text"], ["merchant_number", tr("Merchant mobile number"), "text"],
      ["merchant_private_key", tr("Merchant private key"), "secret"], ["nagad_public_key", tr("Nagad public key"), "key"],
    ],
  },
  {
    key: "sslcommerz",
    description: tr("SSLCommerz hosted checkout (cards, mobile banking, net banking). Payments are confirmed with the SSLCommerz validation API."),
    fields: [["store_id", tr("Store ID"), "text"], ["store_password", tr("Store password"), "secret"]],
  },
];  // prettier-ignore

function LocalGatewayCards() {
  const { data } = useGet<LocalGatewaySettings>("/payment-gateways/settings");
  const [values, setValues] = useState<Partial<Record<LocalGateway, Dict>>>({});
  useEffect(() => {
    if (data) setValues({ bkash: data.bkash, nagad: data.nagad, sslcommerz: data.sslcommerz });
  }, [data]);
  const save = useAction((gateway: LocalGateway) => api.put("/payment-gateways/settings", { [gateway]: values[gateway] }), {
    success: tr("Payment gateway saved"),
    invalidate: [["/payment-gateways/settings"], ["/settings/public"]],
  });
  const set = (gateway: LocalGateway, key: string, value: string) => setValues((v) => ({ ...v, [gateway]: { ...v[gateway], [key]: value } }));

  return (
    <>
      {data && !data.currency_is_bdt && (
        <Alert>
          <AlertTitle>{tr("BDT only")}</AlertTitle>
          <AlertDescription>{tr("bKash, Nagad and SSLCommerz are offered to parents only when the currency in General settings is bdt.")}</AlertDescription>
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
              <SwitchRow id={`${key}-active`} label={tr("Enable {value}", { value: GATEWAY_LABELS[key] })} checked={cfg.active === "1"} onChange={(c) => set(key, "active", c ? "1" : "0")} />
              <Field label={tr("Mode")} className="w-48">
                <Combobox
                  data={[
                    { value: "sandbox", label: tr("Sandbox (testing)") },
                    { value: "live", label: tr("Live") },
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
  { value: "default", label: tr("Default"), description: tr("Full-width photo hero with a dark overlay") },
  { value: "ultimate", label: tr("Ultimate"), description: tr("Split hero with a coloured panel beside the photo") },
];

function ImageUpload({ label, url, path, invalidate }: { label: string; url?: string | null; path: string; invalidate: string[][] }) {
  const up = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(path, body);
    },
    { success: tr("{label} updated", { label }), invalidate },
  );
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="bg-muted/40 flex h-24 items-center justify-center overflow-hidden rounded-md border">
          {url ? <img src={url} alt={label} className="max-h-full max-w-full object-contain p-2" /> : <span className="text-muted-foreground text-sm">{tr("Not set")}</span>}
        </div>
        <FileButton onChange={(f) => f && up.mutate(f)} accept="image/*">
          {(props) => (
            <Button size="sm" variant="secondary" loading={up.isPending} {...props}>
              <UploadIcon />
              {tr("Upload")}</Button>
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
  const del = useAction((id: unknown) => api.delete(`${path}/${id}`), { success: tr("Deleted"), invalidate: [[path]] });
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <span className="text-muted-foreground text-sm">{data ? tr("{length} items", { length: data.length }) : ""}</span>
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon />
          {tr("Add")}</Button>
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
                  <IconAction label={tr("Edit")} onClick={() => setEditing(r)}>
                    <PencilIcon />
                  </IconAction>
                  <IconAction label={tr("Delete")} destructive onClick={() => confirmAction({ title: tr("Delete?"), onConfirm: () => del.mutate(r[idField]) })}>
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
              {editing === "new" ? tr("Add") : tr("Edit")} {title}
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
        {tr("Cancel")}</Button>
      <Button type="submit" loading={loading}>
        {tr("Save")}</Button>
    </DialogFooter>
  );
}

const Thumb = ({ url }: { url: string | null }) => (url ? <img src={url} alt="" className="h-8 w-12 rounded object-cover" /> : <Dash />);

type NewsRow = { frontend_news_id: number; title: string; description: string; date_added: number; image_url: string | null };
function NewsForm({ item, onDone }: { item: NewsRow | null; onDone: () => void }) {
  const [v, setV] = useState({ title: item?.title ?? "", description: item?.description ?? "", image: null as File | null });
  const save = useAction((v: Record<string, unknown>) => (item ? api.put(`/cms/news/${item.frontend_news_id}`, multipart(v)) : api.post("/cms/news", multipart(v))), {
    success: tr("Saved"),
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
      <Field label={tr("Title")} htmlFor="news-title" required>
        <Input id="news-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label={tr("Text")} htmlFor="news-text">
        <Textarea id="news-text" rows={8} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <Field label={tr("Image")} htmlFor="news-image" description={item?.image_url ? tr("Leave empty to keep the current image") : undefined}>
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
    { success: tr("Saved"), invalidate: [["/cms/events"]], onSuccess: onDone },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
      className="grid gap-4"
    >
      <Field label={tr("Title")} htmlFor="event-title" required>
        <Input id="event-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label={tr("Date")}>
        <DatePicker value={v.date} onChange={(date) => setV({ ...v, date })} clearable={false} />
      </Field>
      <SwitchRow id="event-status" label={tr("Show on website")} checked={v.status} onChange={(status) => setV({ ...v, status })} />
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
    { success: tr("Saved"), invalidate: [["/cms/gallery"]], onSuccess: onDone },
  );
  const detail = useGet<{ images: { frontend_gallery_image_id: number; image_url: string }[] }>(item ? `/cms/gallery/${item.frontend_gallery_id}` : null);
  const addImages = useAction(
    (files: File[]) => {
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      return api.post(`/cms/gallery/${item!.frontend_gallery_id}/images`, body);
    },
    { success: tr("Images added"), invalidate: [[`/cms/gallery/${item?.frontend_gallery_id}`]] },
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
        <Field label={tr("Title")} htmlFor="gallery-title" required>
          <Input id="gallery-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label={tr("Description")} htmlFor="gallery-desc">
          <Textarea id="gallery-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <Field label={tr("Cover image")} htmlFor="gallery-cover" description={item?.image_url ? tr("Leave empty to keep the current cover") : undefined}>
          <ImageInput id="gallery-cover" onChange={(image) => setV({ ...v, image })} />
        </Field>
        <SwitchRow id="gallery-show" label={tr("Show on website")} checked={v.show_on_website} onChange={(show_on_website) => setV({ ...v, show_on_website })} />
        <FormFooter onCancel={onDone} loading={save.isPending} />
      </form>
      {item && (
        <div className="grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{tr("Photos")}</h3>
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
              {tr("Add photos")}</Button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {detail.data?.images.map((img) => (
              <div key={img.frontend_gallery_image_id} className="group relative">
                <img src={img.image_url} alt="" className="aspect-square w-full rounded-md object-cover" />
                <Button
                  size="icon-xs"
                  variant="destructive"
                  aria-label={tr("Remove photo")}
                  className="absolute top-1 right-1 opacity-90"
                  onClick={() => delImage.mutate(img.frontend_gallery_image_id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
          {detail.data?.images.length === 0 && <p className="text-muted-foreground text-sm">{tr("No photos in this album yet.")}</p>}
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
    success: tr("Slider saved"),
    invalidate: [["/cms/settings"]],
  });
  const saveSocial = useAction(() => api.put("/cms/settings", { social_links: JSON.stringify([social]) }), {
    success: tr("Social links saved"),
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
      <PageHeader title={tr("Website")} subtitle={tr("Content of the public school website")} />
      <Tabs defaultValue="general" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="general">{tr("General")}</TabsTrigger>
            <TabsTrigger value="social">{tr("Social links")}</TabsTrigger>
            <TabsTrigger value="pages">{tr("Pages")}</TabsTrigger>
            <TabsTrigger value="images">{tr("Images & slider")}</TabsTrigger>
            <TabsTrigger value="news">{tr("News")}</TabsTrigger>
            <TabsTrigger value="events">{tr("Events")}</TabsTrigger>
            <TabsTrigger value="gallery">{tr("Gallery")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="space-y-6">
          <SettingsCard
            title={tr("School information")}
            description={tr("Contact details and the homepage note")}
            footer={saveBtn(TEXT_KEYS.slice(0, 9))}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text("school_title", tr("School title"))}
              {text("email", tr("Email"))}
              {text("phone", tr("Phone"))}
              {text("fax", tr("Fax"))}
              {text("address", tr("Address"))}
              {text("school_location", tr("Map location (lat,lng)"), { placeholder: "23.8103,90.4125" })}
              {text("copyright_text", tr("Copyright text"))}
              {text("homepage_note_title", tr("Homepage note title"))}
            </div>
            {text("homepage_note_description", tr("Homepage note"), { area: true, rows: 3 })}
          </SettingsCard>

          <SettingsCard title={tr("Theme")} description={tr("Look of the public website's homepage")} footer={saveBtn(["theme"])}>
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
            title={tr("Spam protection (reCAPTCHA)")}
            description={
              <>
                {tr("Protects the contact form. Create v2 checkbox keys in the")}{" "}
                <a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {tr("reCAPTCHA admin console")}</a>
                .
              </>
            }
            footer={saveBtn(hasSecret ? ["recaptcha_site_key", "recaptcha_secret_key"] : ["recaptcha_site_key"])}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {text("recaptcha_site_key", tr("Site key"))}
              {hasSecret && (
                <Field label={tr("Secret key")} htmlFor="site-recaptcha_secret_key" description={secretHint(values.recaptcha_secret_key)}>
                  <SecretInput id="site-recaptcha_secret_key" value={values.recaptcha_secret_key} onChange={(v) => set("recaptcha_secret_key", v)} />
                </Field>
              )}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="social">
          <SettingsCard
            title={tr("Social links")}
            description={tr("Shown in the website footer. Use full addresses starting with https://")}
            footer={<SaveButton loading={saveSocial.isPending} onClick={() => saveSocial.mutate(undefined)} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL.map((k) => (
                <Field key={k} label={k === "twitter" ? tr("Twitter / X") : k[0]!.toUpperCase() + k.slice(1)} htmlFor={`social-${k}`}>
                  <Input
                    id={`social-${k}`}
                    type="url"
                    placeholder={tr("https://{value}/…", { value: k === "google" ? "g.page" : `${k}.com` })}
                    value={social[k] ?? ""}
                    onChange={(e) => setSocial({ ...social, [k]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="pages">
          <SettingsCard title={tr("Pages")} description={tr("Plain text; line breaks are kept")} footer={saveBtn(["about_us", "terms_conditions", "privacy_policy"])}>
            {text("about_us", tr("About us"), { area: true, rows: 8 })}
            {text("terms_conditions", tr("Terms & conditions"), { area: true, rows: 8 })}
            {text("privacy_policy", tr("Privacy policy"), { area: true, rows: 8 })}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="images" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <ImageUpload label={tr("Header logo")} url={data?.header_logo_url} path="/cms/images/header_logo" invalidate={inv} />
            <ImageUpload label={tr("Footer logo")} url={data?.footer_logo_url} path="/cms/images/footer_logo" invalidate={inv} />
            <ImageUpload label={tr("About us image")} url={data?.about_us_image_url} path="/cms/images/about_us_image" invalidate={inv} />
          </div>
          <SettingsCard
            title={tr("Homepage slider")}
            description={tr("Large images at the top of the homepage. Wide photos (16:9) work best.")}
            footer={
              <div className="flex flex-wrap gap-2">
                <FileButton onChange={(f) => f && uploadSlide.mutate(f)} accept="image/*">
                  {(props) => (
                    <Button variant="secondary" loading={uploadSlide.isPending} {...props}>
                      <PlusIcon />
                      {tr("Add slide")}</Button>
                  )}
                </FileButton>
                <SaveButton label={tr("Save slider")} loading={saveSlides.isPending} onClick={() => saveSlides.mutate(undefined)} />
              </div>
            }
          >
            {slides.length === 0 && <p className="text-muted-foreground text-sm">{tr("No slides yet.")}</p>}
            {slides.map((s, i) => (
              <div key={i} className="grid grid-cols-[5rem_1fr_auto] items-start gap-3 sm:grid-cols-[6rem_1fr_1fr_auto] sm:items-center">
                <div className="bg-muted aspect-video overflow-hidden rounded-md">{s.image_url && <img src={s.image_url} alt="" className="size-full object-cover" />}</div>
                <Input
                  placeholder={tr("Title")}
                  aria-label={tr("Slide title")}
                  value={s.title}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlides((all) => all.map((x, j) => (j === i ? { ...x, title: v } : x)));
                  }}
                />
                <Input
                  placeholder={tr("Description")}
                  aria-label={tr("Slide description")}
                  className="col-start-2 sm:col-start-auto"
                  value={s.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlides((all) => all.map((x, j) => (j === i ? { ...x, description: v } : x)));
                  }}
                />
                <div className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">
                  <IconAction label={tr("Remove slide")} destructive onClick={() => setSlides((all) => all.filter((_, j) => j !== i))}>
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
            title={tr("news")}
            form={NewsForm}
            columns={[
              [tr("Title"), (r) => <span className="font-medium">{r.title}</span>],
              [tr("Date"), (r) => fromUnix(r.date_added)],
              [tr("Image"), (r) => <Thumb url={r.image_url} />],
            ]}
          />
        </TabsContent>
        <TabsContent value="events">
          <SimpleList<EventRow>
            path="/cms/events"
            idField="frontend_events_id"
            title={tr("event")}
            form={EventForm}
            columns={[
              [tr("Title"), (r) => <span className="font-medium">{r.title}</span>],
              [tr("Date"), (r) => fromUnix(r.timestamp)],
              [tr("Visible"), (r) => <VisibleBadge on={r.status === 1} />],
            ]}
          />
        </TabsContent>
        <TabsContent value="gallery">
          <SimpleList<GalleryRow>
            path="/cms/gallery"
            idField="frontend_gallery_id"
            title={tr("album")}
            form={GalleryForm}
            columns={[
              [tr("Title"), (r) => <span className="font-medium">{r.title}</span>],
              [tr("Cover"), (r) => <Thumb url={r.image_url} />],
              [tr("Visible"), (r) => <VisibleBadge on={r.show_on_website === 1} />],
            ]}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function VisibleBadge({ on }: { on: boolean }) {
  return on ? <Badge className="bg-success/15 text-success border-transparent">{tr("Yes")}</Badge> : <Badge variant="secondary">{tr("No")}</Badge>;
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
  insert: [tr("Added"), "border-transparent bg-success/15 text-success"],
  update: [tr("Changed"), "border-transparent bg-warning/20 text-amber-700 dark:text-amber-300"],
  delete: [tr("Deleted"), "border-transparent bg-destructive/15 text-destructive"],
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
        title={tr("Audit log")}
        subtitle={tr("Who changed marks, attendance, invoices, payments, enrolments, accounts and settings in this system, and what changed.")}
        actions={<ExportButton size="default" path="/export/audit-log.xlsx" params={filters} />}
      />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Combobox data={(tables.data ?? []).map((t) => ({ value: t, label: t }))} value={table} onChange={setTable} clearable placeholder={tr("All tables")} />
          <Combobox data={Object.entries(AUDIT_ACTIONS).map(([value, [label]]) => ({ value, label }))} value={action} onChange={setAction} clearable placeholder={tr("All actions")} />
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder={tr("From date")} />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder={tr("To date")} />
        </div>
        <Table className="min-w-[800px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-40">{tr("When")}</TableHead>
              <TableHead className="w-44">{tr("By")}</TableHead>
              <TableHead className="w-28">{tr("Action")}</TableHead>
              <TableHead className="w-40">{tr("Record")}</TableHead>
              <TableHead>{tr("Changes")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} empty={!isLoading && rows.length === 0} colSpan={5} emptyText={tr("No changes recorded")} />
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
                      <span className="text-muted-foreground">{tr("System")}</span>
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
