import { CopyIcon, DownloadIcon, KeyRoundIcon, RotateCcwIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api, errorMessage } from "../api/client";
import { useAction, useGet } from "../api/hooks";
import type { MfaConfirm, MfaEnrolledUser, MfaSetup, MfaStatus } from "../api/types";
import { PasswordInput } from "../pages/Auth";
import { titleCase } from "../utils";
import { confirmAction } from "./confirm";
import { IconAction } from "./CrudPage";
import { Field } from "./field";
import { Dash, TableState } from "./states";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/** Six-digit authenticator code input. */
export function CodeInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      maxLength={6}
      autoFocus={autoFocus}
      className="font-mono text-lg tracking-[0.3em]"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  );
}

/** Recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Copy failed. Select the codes and copy them by hand.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Recovery codes (each works once)\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-3">
      <Alert>
        <KeyRoundIcon />
        <AlertDescription>
          Keep these somewhere safe. Each code signs you in once if you lose your phone. They won't be shown again.
        </AlertDescription>
      </Alert>
      <div className="bg-muted/40 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <CopyIcon />
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadIcon />
          Download
        </Button>
      </div>
    </div>
  );
}

/**
 * Scan-and-confirm step. `token` is the enroll-only token from a forced setup at sign-in;
 * without it the signed-in session is used.
 */
export function TotpSetup({ token, onConfirmed }: { token?: string; onConfirmed: (result: MfaConfirm) => void }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one secret per dialog, also under StrictMode's double effect
    started.current = true;
    api
      .post<MfaSetup>("/auth/mfa/setup", null, { headers })
      .then((r) => setSetup(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConfirmed((await api.post<MfaConfirm>("/auth/mfa/confirm", { code }, { headers })).data);
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (!setup) return error ? <p className="text-destructive text-sm">{error}</p> : <Skeleton className="mx-auto size-48" />;
  return (
    <form onSubmit={confirm} className="grid gap-4">
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
        <li>Scan this code, or type the key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto size-48 rounded-md border bg-white p-1" />
      <div className="text-center">
        <div className="text-muted-foreground text-xs">Key</div>
        <code className="font-mono text-sm break-all select-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
      </div>
      <Field label="Code from the app" htmlFor="totp-confirm" error={error ?? undefined}>
        <CodeInput id="totp-confirm" value={code} onChange={setCode} autoFocus />
      </Field>
      <Button type="submit" loading={busy} disabled={code.length !== 6}>
        <ShieldCheckIcon />
        Turn on
      </Button>
    </form>
  );
}

type Dialogs = "enable" | "codes" | "regenerate" | "disable" | null;

/** "Two-factor authentication" card on My profile. */
export function TwoFactorCard() {
  const status = useGet<MfaStatus>("/auth/mfa");
  const [open, setOpen] = useState<Dialogs>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const close = () => {
    setOpen(null);
    setCode("");
    setPassword("");
  };
  const showCodes = (r: MfaConfirm) => {
    setCodes(r.recovery_codes);
    setOpen("codes");
    void status.refetch();
  };
  const regenerate = useAction((c: string) => api.post<MfaConfirm>("/auth/mfa/recovery-codes", { code: c }), {
    invalidate: [["/auth/mfa"]],
    onSuccess: (r) => showCodes(r.data),
  });
  const disable = useAction(() => api.post("/auth/mfa/disable", { password, code }), {
    success: "Two-factor authentication turned off",
    invalidate: [["/auth/mfa"]],
    onSuccess: close,
  });
  const s = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          {s?.enabled ? (
            <Badge className="bg-success/15 text-success border-transparent">On</Badge>
          ) : (
            <Badge variant="secondary">Off</Badge>
          )}
        </CardTitle>
        <CardDescription>After your password, also ask for a code from an authenticator app on your phone.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {!s ? (
          <Skeleton className="h-5 w-48" />
        ) : s.enabled ? (
          <p className="text-muted-foreground">
            {s.recovery_codes_left} of 10 recovery codes left.
            {s.required && " Your school requires two-factor authentication for your role."}
          </p>
        ) : (
          <p className="text-muted-foreground">{s.required ? "Your school requires it for your role." : "Recommended for staff accounts."}</p>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t">
        {s?.enabled ? (
          <>
            <Button variant="outline" onClick={() => setOpen("regenerate")}>
              <RotateCcwIcon />
              New recovery codes
            </Button>
            {!s.required && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setOpen("disable")}>
                <ShieldOffIcon />
                Turn off
              </Button>
            )}
          </>
        ) : (
          <Button onClick={() => setOpen("enable")} disabled={!s}>
            <ShieldCheckIcon />
            Turn on
          </Button>
        )}
      </CardFooter>

      <Dialog open={open !== null} onOpenChange={(o) => !o && open !== "codes" && close()}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => open === "codes" && e.preventDefault()}>
          {open === "enable" && (
            <>
              <DialogHeader>
                <DialogTitle>Turn on two-factor authentication</DialogTitle>
              </DialogHeader>
              <TotpSetup onConfirmed={showCodes} />
            </>
          )}
          {open === "codes" && (
            <>
              <DialogHeader>
                <DialogTitle>Your recovery codes</DialogTitle>
              </DialogHeader>
              <RecoveryCodes codes={codes} />
              <DialogFooter>
                <Button onClick={close}>I've saved them</Button>
              </DialogFooter>
            </>
          )}
          {open === "regenerate" && (
            <form onSubmit={(e) => { e.preventDefault(); regenerate.mutate(code); }} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>New recovery codes</DialogTitle>
                <DialogDescription>Your old recovery codes stop working.</DialogDescription>
              </DialogHeader>
              <Field label="Code from your authenticator app" htmlFor="totp-regen">
                <CodeInput id="totp-regen" value={code} onChange={setCode} autoFocus />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" loading={regenerate.isPending} disabled={code.length !== 6}>Create codes</Button>
              </DialogFooter>
            </form>
          )}
          {open === "disable" && (
            <form onSubmit={(e) => { e.preventDefault(); disable.mutate(undefined); }} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Turn off two-factor authentication</DialogTitle>
              </DialogHeader>
              <Field label="Password" htmlFor="totp-off-pw">
                <PasswordInput id="totp-off-pw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Code from your app, or a recovery code" htmlFor="totp-off-code">
                <Input id="totp-off-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.trim())} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" variant="destructive" loading={disable.isPending} disabled={!password || code.length < 6}>Turn off</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );  // prettier-ignore
}

/** Admin list of accounts with two-factor authentication, with a reset for lost phones. */
export function TwoFactorUsers() {
  const { data, isLoading } = useGet<MfaEnrolledUser[]>("/auth/mfa/users");
  const reset = useAction((u: MfaEnrolledUser) => api.delete(`/auth/mfa/users/${u.role}/${u.user_id}`), {
    success: "Two-factor authentication reset",
    invalidate: [["/auth/mfa/users"]],
  });
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Since</TableHead>
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableState loading={isLoading} empty={!isLoading && (data ?? []).length === 0} colSpan={4} emptyText="Nobody has turned it on yet" />
        {(data ?? []).map((u) => (
          <TableRow key={`${u.role}-${u.user_id}`}>
            <TableCell>
              <div className="font-medium">{u.name ?? <Dash />}</div>
              <div className="text-muted-foreground text-xs">{u.email}</div>
            </TableCell>
            <TableCell>{titleCase(u.role)}</TableCell>
            <TableCell>{u.confirmed_at ? new Date(u.confirmed_at).toLocaleDateString() : <Badge variant="secondary">Setting up</Badge>}</TableCell>
            <TableCell>
              <IconAction
                label="Reset"
                destructive
                onClick={() =>
                  confirmAction({
                    title: `Reset two-factor authentication for ${u.name ?? u.email}?`,
                    description: "They can sign in with the password alone (or must set it up again if their role requires it). Use this when a phone is lost.",
                    onConfirm: () => reset.mutate(u),
                  })
                }
              >
                <ShieldOffIcon />
              </IconAction>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
