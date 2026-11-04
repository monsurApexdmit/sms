import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { BellIcon, BellOffIcon, BellRingIcon, CheckCheckIcon, KeyRoundIcon, SaveIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useGet, usePagedList } from "../api/hooks";
import type { AppNotification, NotificationPreferences } from "../api/types";
import { useUser } from "../auth/AuthContext";
import { Combobox } from "../components/combobox";
import { confirmAction } from "../components/confirm";
import { Field } from "../components/field";
import { PageHeader } from "../components/PageHeader";
import { Pager } from "../components/Pager";
import { EmptyState } from "../components/states";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import { disablePush, enablePush, pushState, type PushState } from "../lib/push";
import { t, tn } from "../i18n";

const CHANNELS = [
  { key: "in_app", label: t("In app") },
  { key: "email", label: t("Email") },
  { key: "sms", label: t("SMS") },
  { key: "push", label: t("Push") },
  { key: "whatsapp", label: t("WhatsApp") },
] as const;
type Channel = (typeof CHANNELS)[number]["key"];

const MASK = "********";

// --- list -----------------------------------------------------------------------------

function NotificationList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const prefs = useGet<NotificationPreferences>("/notifications/preferences");
  const [show, setShow] = useState("all");
  const [category, setCategory] = useState<string | null>(null);
  const { data, isLoading, page, setPage, pageSize } = usePagedList<AppNotification>(
    "/notifications",
    { unread_only: show === "unread" || undefined, category: category ?? undefined },
    20,
  );
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["/notifications"] }), qc.invalidateQueries({ queryKey: ["/notifications/unread-count"] })]);
  const readAll = useAction(() => api.post("/notifications/read-all"), { onSuccess: refresh });
  const open = async (n: AppNotification) => {
    if (!n.read_at) await api.post(`/notifications/${n.notification_id}/read`).catch(() => undefined);
    await refresh();
    if (n.link) navigate(n.link);
  };
  const label = (c: string) => prefs.data?.items.find((i) => i.category === c)?.label ?? c;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={(v) => v && setShow(v)}>
            <ToggleGroupItem value="all">{t("All")}</ToggleGroupItem>
            <ToggleGroupItem value="unread">{t("Unread")}</ToggleGroupItem>
          </ToggleGroup>
          <Combobox
            className="w-52"
            clearable
            placeholder={t("All categories")}
            data={(prefs.data?.items ?? []).map((i) => ({ value: i.category, label: i.label }))}
            value={category}
            onChange={setCategory}
          />
        </div>
        <Button size="sm" variant="outline" loading={readAll.isPending} onClick={() => readAll.mutate(undefined)}>
          <CheckCheckIcon />
          {t("Mark all read")}</Button>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState icon={BellIcon} title={t("No notifications")} className="m-4 border-0" />
      ) : (
        <ul>
          {data!.items.map((n) => (
            <li key={n.notification_id} className="border-b last:border-0">
              <button type="button" onClick={() => open(n)} className={cn("hover:bg-muted/50 flex w-full gap-3 px-4 py-3 text-left", !n.read_at && "bg-primary/5")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium", !n.read_at && "font-semibold")}>{n.title}</span>
                    <Badge variant="secondary">{label(n.category)}</Badge>
                  </span>
                  {n.body && <span className="text-muted-foreground mt-0.5 block text-sm whitespace-pre-line">{n.body}</span>}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{dayjs(n.created_at).format("DD MMM YYYY, HH:mm")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
    </Card>
  );
}

// --- my preferences (also shown on My profile) -----------------------------------------------

function PushControls() {
  const key = useGet<{ public_key: string | null }>("/notifications/push/public-key");
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState);
  }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      if (state === "on") await disablePush();
      else await enablePush(key.data!.public_key!);
      setState(await pushState());
      toast.success(state === "on" ? t("Push notifications turned off on this device") : t("Push notifications turned on for this device"));
    } catch (e) {
      toast.error(e instanceof Error && !("isAxiosError" in e) ? e.message : errorMessage(e));
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  };
  if (!key.data || state === null) return null;
  if (!key.data.public_key) return <p className="text-muted-foreground text-sm">{t("Push notifications are not set up by the school yet.")}</p>;
  if (state === "unsupported") return <p className="text-muted-foreground text-sm">{t("This browser does not support push notifications. On iPhone, add the portal to your Home Screen first.")}</p>;
  if (state === "dev") return <p className="text-muted-foreground text-sm">{t("Push notifications work in the installed (production) app only.")}</p>;
  if (state === "denied") return <p className="text-muted-foreground text-sm">{t("Notifications are blocked for this site. Allow them in the browser's site settings.")}</p>;
  return (
    <Button variant="outline" size="sm" loading={busy} onClick={toggle}>
      {state === "on" ? <BellOffIcon /> : <BellRingIcon />}
      {state === "on" ? t("Turn off push on this device") : t("Enable push on this device")}
    </Button>
  );
}

export function NotificationSettingsCard() {
  const { data, isLoading } = useGet<NotificationPreferences>("/notifications/preferences");
  const [items, setItems] = useState<NotificationPreferences["items"]>([]);
  useEffect(() => setItems(data?.items ?? []), [data]);
  const save = useAction(
    () => api.put("/notifications/preferences", { items: items.map(({ label: _label, ...rest }) => rest) }),
    { success: t("Notification settings saved"), invalidate: [["/notifications/preferences"]] },
  );
  const test = useAction(() => api.post<{ channels: string[] }>("/notifications/test"), {
    onSuccess: (r) => toast.success(t("Test sent ({value})", { value: r.data.channels.join(", ") || t("no channels") })),
    invalidate: [["/notifications"], ["/notifications/unread-count"]],
  });
  const set = (category: string, channel: Channel, value: boolean) =>
    setItems((rows) => rows.map((r) => (r.category === category ? { ...r, [channel]: value } : r)));
  const available = data?.available;
  const dirty = JSON.stringify(items) !== JSON.stringify(data?.items ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Notifications")}</CardTitle>
        <CardDescription>{t("Choose how you hear about each kind of update. Channels the school hasn't set up are greyed out.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PushControls />
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[560px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("Category")}</TableHead>
                  {CHANNELS.map((c) => (
                    <TableHead key={c.key} className={cn("text-center", available && !available[c.key] && "text-muted-foreground/60")}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    {CHANNELS.map((c) => (
                      <TableCell key={c.key} className="text-center">
                        <Switch
                          aria-label={t("{label}: {label2}", { label: row.label, label2: c.label })}
                          checked={row[c.key]}
                          disabled={available ? !available[c.key] : false}
                          onCheckedChange={(v) => set(row.category, c.key, v)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t">
        <Button variant="ghost" loading={test.isPending} onClick={() => test.mutate(undefined)}>
          <SendIcon />
          {t("Send me a test")}</Button>
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined)}>
          <SaveIcon />
          {t("Save")}</Button>
      </CardFooter>
    </Card>
  );
}

// --- admin: delivery channels ------------------------------------------------------------------

type ChannelSettings = Record<
  "whatsapp_token" | "whatsapp_phone_number_id" | "whatsapp_template" | "whatsapp_template_language" | "vapid_public_key" | "vapid_private_key" | "vapid_subject",
  string
> & { subscriptions: number };

function ChannelSettingsCard() {
  const { data } = useGet<ChannelSettings>("/notifications/settings");
  const [values, setValues] = useState<Partial<ChannelSettings>>({});
  useEffect(() => setValues(data ?? {}), [data]);
  const invalidate = [["/notifications/settings"], ["/notifications/preferences"], ["/notifications/push/public-key"]];
  const save = useAction(
    () =>
      api.put("/notifications/settings", {
        whatsapp_token: values.whatsapp_token ?? "",
        whatsapp_phone_number_id: values.whatsapp_phone_number_id ?? "",
        whatsapp_template: values.whatsapp_template ?? "",
        whatsapp_template_language: values.whatsapp_template_language ?? "",
        vapid_subject: values.vapid_subject ?? "",
      }),
    { success: t("Saved"), invalidate },
  );
  const generate = useAction(() => api.post("/notifications/settings/vapid"), { success: t("New push keys created"), invalidate });
  const field = (key: keyof ChannelSettings, label: string, hint?: string, secret = false) => (
    <Field label={label} htmlFor={`ch-${key}`} description={secret && values[key] === MASK ? t("Saved; type to replace") : hint}>
      <Input id={`ch-${key}`} type={secret ? "password" : "text"} autoComplete="off" value={String(values[key] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
    </Field>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("Web push")}</CardTitle>
          <CardDescription>{t("Notifications on phones and computers that installed or opened the portal and turned push on.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label={t("Public key")}>
            <Input readOnly value={data?.vapid_public_key || t("Not created yet")} className="font-mono text-xs" />
          </Field>
          {field("vapid_subject", t("Contact"), t("Sent to push services, e.g. \"mailto:office@school.edu\". Defaults to the system email."))}
          <p className="text-muted-foreground text-sm">{tn("{value} device(s) subscribed.", { value: data?.subscriptions ?? 0 })}</p>
        </CardContent>
        <CardFooter className="justify-between gap-2 border-t">
          <Button
            variant="outline"
            loading={generate.isPending}
            onClick={() =>
              confirmAction({
                title: data?.vapid_public_key ? t("Replace the push keys?") : t("Create push keys?"),
                description: data?.vapid_public_key ? t("Every device has to turn push on again.") : t("Users can then turn on push notifications."),
                confirmLabel: data?.vapid_public_key ? t("Replace keys") : t("Create keys"),
                destructive: !!data?.vapid_public_key,
                onConfirm: () => generate.mutate(undefined),
              })
            }
          >
            <KeyRoundIcon />
            {data?.vapid_public_key ? t("Replace keys") : t("Create keys")}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <SaveIcon />
            {t("Save")}</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("WhatsApp")}</CardTitle>
          <CardDescription>{t("Meta WhatsApp Cloud API. Messages go to the phone number on each account.")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {field("whatsapp_phone_number_id", t("Phone number ID"), t("WhatsApp Manager → API setup"))}
          {field("whatsapp_token", t("Access token"), t("A permanent system-user token"), true)}
          {field("whatsapp_template", t("Message template"), "Approved template with one body variable {{1}}. Needed to message people who haven't written to the school in the last 24 hours.")}
          {field("whatsapp_template_language", t("Template language"), t("Default \"en\""))}
          <Alert>
            <AlertDescription>{t("Leave the token empty to turn WhatsApp off.")}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <SaveIcon />
            {t("Save")}</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function NotificationsPage() {
  const user = useUser();
  return (
    <>
      <PageHeader title={t("Notifications")} subtitle={t("Updates about attendance, homework, leave, fees, meetings and notices.")} />
      <Tabs defaultValue="inbox" className="gap-6">
        <TabsList>
          <TabsTrigger value="inbox">{t("Inbox")}</TabsTrigger>
          <TabsTrigger value="settings">{t("My settings")}</TabsTrigger>
          {user.role === "admin" && <TabsTrigger value="channels">{t("Delivery channels")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="inbox">
          <NotificationList />
        </TabsContent>
        <TabsContent value="settings">
          <NotificationSettingsCard />
        </TabsContent>
        {user.role === "admin" && (
          <TabsContent value="channels">
            <ChannelSettingsCard />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
