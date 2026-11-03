import { ArrowLeftIcon, CircleAlertIcon, EyeIcon, EyeOffIcon, GraduationCapIcon, MailCheckIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, errorMessage } from "../api/client";
import { usePublicSettings } from "../api/hooks";
import type { MfaChallenge, MfaConfirm, TokenResponse } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/field";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { CodeInput, RecoveryCodes, TotpSetup } from "../components/TwoFactor";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { t } from "../i18n";

/** Controller field props without the ref, which plain function inputs cannot take in React 18. */
export const bind = <T extends { ref: unknown }>({ ref: _ref, ...rest }: T) => rest;

/** Password field with a show/hide toggle. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("Hide password") : t("Show password")}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md outline-none"
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  const settings = usePublicSettings();
  return (
    <div className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl", className)}>
      {settings.data?.logo_url ? (
        <img src={settings.data.logo_url} alt="" className="size-full object-contain" />
      ) : (
        <GraduationCapIcon className="size-6" />
      )}
    </div>
  );
}

function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const settings = usePublicSettings();
  const name = settings.data?.system_name || t("School");
  return (
    <div className="bg-background grid min-h-svh lg:grid-cols-2">
      <aside className="from-primary via-primary/85 to-primary/60 text-primary-foreground relative hidden overflow-hidden bg-linear-to-br p-10 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo className="bg-white/15 backdrop-blur" />
          <span className="text-lg font-semibold">{name}</span>
        </div>
        <div className="relative mt-auto max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            {settings.data?.system_title || t("Everything your school runs on, in one place.")}
          </h2>
          <p className="text-primary-foreground/80">
            {t("Classes, attendance, exams, fees and messages for admins, teachers, students and parents.")}</p>
          {settings.data?.address && <p className="text-primary-foreground/70 text-sm">{settings.data.address}</p>}
        </div>
      </aside>
      <main className="relative flex items-center justify-center p-4 sm:p-8">
        <div className="absolute top-3 right-3">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2 text-center lg:hidden">
            <Logo className="bg-primary text-primary-foreground" />
            <span className="font-semibold">{name}</span>
          </div>
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription className="whitespace-pre-line">{message}</AlertDescription>
    </Alert>
  );
}

/** Second sign-in step: a code from the authenticator app, or a recovery code. */
function MfaStep({ token, onDone, onCancel }: { token: string; onDone: (data: TokenResponse) => void; onCancel: () => void }) {
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = recovery ? { mfa_token: token, recovery_code: value } : { mfa_token: token, code: value };
      onDone((await api.post<TokenResponse>("/auth/mfa/verify", body)).data);
    } catch (err) {
      setError(errorMessage(err));
      setValue("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell
      title={t("Two-factor authentication")}
      description={recovery ? t("Enter one of your recovery codes.") : t("Enter the 6-digit code from your authenticator app.")}
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <ErrorAlert message={error} />
        {recovery ? (
          <Field label={t("Recovery code")} htmlFor="mfa-recovery">
            <Input id="mfa-recovery" autoFocus autoComplete="off" placeholder={t("abcd-efgh")} className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        ) : (
          <Field label={t("Code")} htmlFor="mfa-code">
            <CodeInput id="mfa-code" value={value} onChange={setValue} autoFocus />
          </Field>
        )}
        <Button type="submit" loading={busy} className="w-full" disabled={recovery ? value.trim().length < 8 : value.length !== 6}>
          {t("Verify")}</Button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-primary hover:underline" onClick={() => { setRecovery(!recovery); setValue(""); setError(null); }}>
            {recovery ? t("Use the authenticator app") : t("Use a recovery code")}
          </button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={onCancel}>
            {t("Start over")}</button>
        </div>
      </form>
    </AuthShell>
  );  // prettier-ignore
}

/** Forced setup at sign-in, for roles the school requires two-factor authentication for. */
function EnrollStep({ token, onDone, onCancel }: { token: string; onDone: (data: TokenResponse) => void; onCancel: () => void }) {
  const [confirmed, setConfirmed] = useState<MfaConfirm | null>(null);
  if (confirmed?.session) {
    const session = confirmed.session;
    return (
      <AuthShell title={t("Save your recovery codes")}>
        <div className="grid gap-4">
          <RecoveryCodes codes={confirmed.recovery_codes} />
          <Button className="w-full" onClick={() => onDone(session)}>
            {t("Continue")}</Button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("Set up two-factor authentication")} description={t("Your school requires a second step at sign-in for your account.")}>
      <div className="grid gap-4">
        <TotpSetup token={token} onConfirmed={setConfirmed} />
        <button type="button" className="text-muted-foreground text-sm hover:underline" onClick={onCancel}>
          {t("Start over")}</button>
      </div>
    </AuthShell>
  );
}

export function LoginPage() {
  const { user, login, finishLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const form = useForm({ defaultValues: { email: "", password: "" } });
  const errors = form.formState.errors;

  if (user) return <Navigate to="/app/dashboard" replace />;

  const goIn = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from.startsWith("/app") ? from : "/app/dashboard", { replace: true });
  };
  const finish = (data: TokenResponse) => {
    finishLogin(data);
    goIn();
  };
  const startOver = () => {
    setChallenge(null);
    form.setValue("password", "");
  };

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const result = await login(values.email.trim(), values.password);
      if (result.challenge) setChallenge(result.challenge);
      else goIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  if (challenge?.mfa_required) return <MfaStep token={challenge.mfa_token} onDone={finish} onCancel={startOver} />;
  if (challenge?.enroll_required) return <EnrollStep token={challenge.mfa_token} onDone={finish} onCancel={startOver} />;

  return (
    <AuthShell title={t("Sign in")} description={t("Use the email and password your school gave you.")}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <ErrorAlert message={error} />
        <Field label={t("Email")} htmlFor="email" error={errors.email?.message}>
          <Controller
            control={form.control}
            name="email"
            rules={{ required: t("Email is required") }}
            render={({ field }) => (
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              {t("Password")}<Link to="/forgot-password" className="text-primary text-xs font-normal hover:underline">
                {t("Forgot password?")}</Link>
            </span>
          }
          htmlFor="password"
          error={errors.password?.message}
        >
          <Controller
            control={form.control}
            name="password"
            rules={{ required: t("Password is required") }}
            render={({ field }) => (
              <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errors.password || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {t("Sign in")}</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t("Reset password")} description={sent ? undefined : t("Enter your account email and we'll send you a reset link.")}>
      <div className="grid gap-4">
        {sent ? (
          <Alert>
            <MailCheckIcon className="text-success" />
            <AlertTitle>{t("Check your inbox")}</AlertTitle>
            <AlertDescription>{t("If an account exists for that email, a reset link has been sent. It is valid for 30 minutes.")}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <ErrorAlert message={error} />
            <Field label={t("Email")} htmlFor="email" required>
              <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              {t("Send reset link")}</Button>
          </form>
        )}
        <Button variant="ghost" asChild className="w-full">
          <Link to="/login">
            <ArrowLeftIcon />
            {t("Back to sign in")}</Link>
        </Button>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ defaultValues: { password: "", confirm: "" } });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    try {
      await api.post("/auth/reset-password", { token: params.get("token"), new_password: values.password });
      navigate("/login", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthShell title={t("Choose a new password")} description={t("Use at least 8 characters.")}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <ErrorAlert message={error} />
        <Field label={t("New password")} htmlFor="password" error={errors.password?.message}>
          <Controller
            control={form.control}
            name="password"
            rules={{ validate: (v) => (v.length >= 8 ? true : t("At least 8 characters")) }}
            render={({ field }) => (
              <PasswordInput id="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Field label={t("Confirm password")} htmlFor="confirm" error={errors.confirm?.message}>
          <Controller
            control={form.control}
            name="confirm"
            rules={{ validate: (v, all) => (v === all.password ? true : t("Passwords do not match")) }}
            render={({ field }) => <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm || undefined} {...bind(field)} />}
          />
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full">
          {t("Save password")}</Button>
        <Button variant="ghost" asChild className="w-full">
          <Link to="/login">
            <ArrowLeftIcon />
            {t("Back to sign in")}</Link>
        </Button>
      </form>
    </AuthShell>
  );
}
