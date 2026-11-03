import { ArrowLeftIcon, CircleAlertIcon, EyeIcon, EyeOffIcon, GraduationCapIcon, MailCheckIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, errorMessage } from "../api/client";
import { usePublicSettings } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/field";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";

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
        aria-label={visible ? "Hide password" : "Show password"}
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
  const name = settings.data?.system_name || "School";
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
            {settings.data?.system_title || "Everything your school runs on, in one place."}
          </h2>
          <p className="text-primary-foreground/80">
            Classes, attendance, exams, fees and messages for admins, teachers, students and parents.
          </p>
          {settings.data?.address && <p className="text-primary-foreground/70 text-sm">{settings.data.address}</p>}
        </div>
      </aside>
      <main className="flex items-center justify-center p-4 sm:p-8">
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

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({ defaultValues: { email: "", password: "" } });
  const errors = form.formState.errors;

  if (user) return <Navigate to="/app/dashboard" replace />;

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      await login(values.email.trim(), values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith("/app") ? from : "/app/dashboard", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthShell title="Sign in" description="Use the email and password your school gave you.">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <ErrorAlert message={error} />
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Controller
            control={form.control}
            name="email"
            rules={{ required: "Email is required" }}
            render={({ field }) => (
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              Password
              <Link to="/forgot-password" className="text-primary text-xs font-normal hover:underline">
                Forgot password?
              </Link>
            </span>
          }
          htmlFor="password"
          error={errors.password?.message}
        >
          <Controller
            control={form.control}
            name="password"
            rules={{ required: "Password is required" }}
            render={({ field }) => (
              <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errors.password || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
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
    <AuthShell title="Reset password" description={sent ? undefined : "Enter your account email and we'll send you a reset link."}>
      <div className="grid gap-4">
        {sent ? (
          <Alert>
            <MailCheckIcon className="text-success" />
            <AlertTitle>Check your inbox</AlertTitle>
            <AlertDescription>If an account exists for that email, a reset link has been sent. It is valid for 30 minutes.</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <ErrorAlert message={error} />
            <Field label="Email" htmlFor="email" required>
              <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              Send reset link
            </Button>
          </form>
        )}
        <Button variant="ghost" asChild className="w-full">
          <Link to="/login">
            <ArrowLeftIcon />
            Back to sign in
          </Link>
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
    <AuthShell title="Choose a new password" description="Use at least 8 characters.">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <ErrorAlert message={error} />
        <Field label="New password" htmlFor="password" error={errors.password?.message}>
          <Controller
            control={form.control}
            name="password"
            rules={{ validate: (v) => (v.length >= 8 ? true : "At least 8 characters") }}
            render={({ field }) => (
              <PasswordInput id="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password || undefined} {...bind(field)} />
            )}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <Controller
            control={form.control}
            name="confirm"
            rules={{ validate: (v, all) => (v === all.password ? true : "Passwords do not match") }}
            render={({ field }) => <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm || undefined} {...bind(field)} />}
          />
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting} className="w-full">
          Save password
        </Button>
        <Button variant="ghost" asChild className="w-full">
          <Link to="/login">
            <ArrowLeftIcon />
            Back to sign in
          </Link>
        </Button>
      </form>
    </AuthShell>
  );
}
