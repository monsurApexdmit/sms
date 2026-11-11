import {
  ArrowLeftIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  EyeIcon,
  EyeOffIcon,
  GraduationCapIcon,
  LibraryIcon,
  MailCheckIcon,
  MapPinIcon,
  MessageSquareIcon,
  PresentationIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
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
    <div className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full", className)}>
      {settings.data?.logo_url ? (
        <img src={settings.data.logo_url} alt="" className="size-full object-contain" />
      ) : (
        <GraduationCapIcon className="size-6" />
      )}
    </div>
  );
}

const FEATURES = [
  { icon: CalendarCheckIcon, label: t("Attendance") },
  { icon: BookOpenIcon, label: t("Homework") },
  { icon: ClipboardCheckIcon, label: t("Exams") },
  { icon: WalletIcon, label: t("Fees") },
  { icon: MessageSquareIcon, label: t("Messages") },
];

/** Sign-in, two-factor and password pages: a brand panel beside the form, in the public website's colours. */
function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const settings = usePublicSettings();
  const name = settings.data?.system_name || t("School");
  const website = settings.data && settings.data.disable_frontend !== "1";
  return (
    <div className="site-theme bg-background grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <aside className="bg-ink relative isolate hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="site-dots pointer-events-none absolute inset-0 text-white/[0.06]" />
        <div aria-hidden className="bg-primary pointer-events-none absolute -top-40 -left-32 size-[32rem] rounded-full opacity-70 blur-3xl" />
        <div aria-hidden className="bg-gold/25 pointer-events-none absolute -right-24 -bottom-32 size-[26rem] rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute top-1/2 -right-40 size-[30rem] -translate-y-1/2 rounded-full border border-white/10" />
        <div aria-hidden className="border-gold/25 pointer-events-none absolute top-1/2 -right-24 size-[22rem] -translate-y-1/2 rounded-full border border-dashed" />

        <div className="relative flex items-center gap-3">
          <Logo className="text-gold bg-white/10 ring-1 ring-white/20 backdrop-blur" />
          <span className="font-display text-xl font-semibold tracking-tight">{name}</span>
        </div>

        <div className="relative my-auto max-w-lg py-12">
          <span className="bg-gold mb-6 block h-1 w-12 rounded-full" />
          <h2 className="font-display text-4xl leading-[1.1] font-semibold tracking-tight text-balance xl:text-5xl">
            {settings.data?.system_title || t("Everything your school runs on, in one place.")}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-white/70">
            {t("Classes, attendance, exams, fees and messages for admins, teachers, students and parents.")}</p>
          <ul className="mt-10 flex flex-wrap gap-2.5">
            {FEATURES.map((f) => (
              <li key={f.label} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-sm text-white/90 backdrop-blur">
                <f.icon className="text-gold size-4" />
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        {settings.data?.address && (
          <p className="relative flex items-start gap-2 text-sm text-white/55">
            <MapPinIcon className="text-gold mt-0.5 size-4 shrink-0" />
            {settings.data.address}
          </p>
        )}
      </aside>

      <main className="relative isolate flex flex-col overflow-hidden p-4 sm:p-8">
        <div aria-hidden className="bg-primary/10 pointer-events-none absolute -top-32 -right-32 -z-10 size-96 rounded-full blur-3xl" />
        <div aria-hidden className="bg-gold/15 pointer-events-none absolute -bottom-32 -left-32 -z-10 size-96 rounded-full blur-3xl" />
        <div className="flex items-center justify-between gap-2">
          {website ? (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 rounded-full">
              <Link to="/">
                <ArrowLeftIcon />
                {t("Back to website")}</Link>
            </Button>
          ) : (
            <span />
          )}
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 py-10">
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <Logo className="bg-ink text-gold ring-gold/50 size-14 ring-2 ring-offset-2" />
            <span className="font-display text-xl font-semibold tracking-tight">{name}</span>
          </div>
          <Card className="relative gap-0 overflow-hidden rounded-2xl border-0 py-0 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.18)] ring-1 ring-black/5">
            <div aria-hidden className="from-primary via-gold to-primary h-1 bg-gradient-to-r" />
            <CardHeader className="gap-2 px-8 pt-8">
              <CardTitle className="font-display text-3xl font-semibold tracking-tight">{title}</CardTitle>
              {description && <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>}
            </CardHeader>
            <CardContent className="px-8 pt-6 pb-8">{children}</CardContent>
          </Card>
          <p className="text-muted-foreground text-center text-xs">{t("© {getFullYear} {name}. All rights reserved.", { getFullYear: new Date().getFullYear(), name })}</p>
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

// Accounts created by backend/scripts/seed_demo.py. Shown only by the Vite dev server
// (import.meta.env.DEV), so a production build leaves this out entirely.
const DEMO_PASSWORD = "Demo@12345";
const DEMO_ACCOUNTS = [
  { label: () => t("Admin"), email: "admin@demo.school", icon: ShieldCheckIcon },
  { label: () => t("Teacher"), email: "teacher@demo.school", icon: PresentationIcon },
  { label: () => t("Student"), email: "student@demo.school", icon: GraduationCapIcon },
  { label: () => t("Parent"), email: "parent@demo.school", icon: UsersIcon },
  { label: () => t("Accountant"), email: "accountant@demo.school", icon: WalletIcon },
  { label: () => t("Librarian"), email: "librarian@demo.school", icon: LibraryIcon },
] as const;

function DemoLogins({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <div className="mt-6 border-t border-dashed pt-5">
      <p className="text-muted-foreground mb-3 flex items-center justify-between text-xs">
        <span className="font-medium tracking-wide uppercase">{t("Demo accounts")}</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 uppercase">{t("Dev only")}</span>
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DEMO_ACCOUNTS.map(({ label, email, icon: Icon }) => (
          <Button key={email} type="button" variant="outline" size="sm" className="justify-start" title={email} onClick={() => onPick(email, DEMO_PASSWORD)}>
            <Icon className="text-primary" />
            {label()}
          </Button>
        ))}
      </div>
    </div>
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
      <form onSubmit={submit} className="grid gap-5" noValidate>
        <ErrorAlert message={error} />
        <Field label={t("Email")} htmlFor="email" error={errors.email?.message}>
          <Controller
            control={form.control}
            name="email"
            rules={{ required: t("Email is required") }}
            render={({ field }) => (
              <Input id="email" type="email" className="h-11" autoComplete="username" autoFocus aria-invalid={!!errors.email || undefined} {...bind(field)} />
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
              <PasswordInput id="password" className="h-11" autoComplete="current-password" aria-invalid={!!errors.password || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Button type="submit" loading={busy} size="lg" className="mt-2 h-11 w-full text-base shadow-md">
          {t("Sign in")}</Button>
      </form>
      {import.meta.env.DEV && (
        <DemoLogins
          onPick={(email, password) => {
            setError(null);
            form.setValue("email", email, { shouldValidate: true });
            form.setValue("password", password, { shouldValidate: true });
          }}
        />
      )}
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
