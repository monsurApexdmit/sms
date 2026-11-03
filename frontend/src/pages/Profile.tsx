import { CameraIcon, KeyRoundIcon, SaveIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import { api } from "../api/client";
import { useAction } from "../api/hooks";
import type { User } from "../api/types";
import { useAuth, useUser } from "../auth/AuthContext";
import { Field } from "../components/field";
import { FileButton } from "../components/file-button";
import { PageHeader } from "../components/PageHeader";
import { TwoFactorCard } from "../components/TwoFactor";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { initials, titleCase } from "../utils";
import { bind, PasswordInput } from "./Auth";
import { NotificationSettingsCard } from "./Notifications";

export function ProfilePage() {
  const user = useUser();
  const { setUser } = useAuth();
  const info = useForm({ defaultValues: { name: user.name, email: user.email, phone: "", address: "" } });
  const pw = useForm({ defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const infoErrors = info.formState.errors;
  const pwErrors = pw.formState.errors;

  const saveInfo = useAction(
    (v: { name: string; email: string; phone: string; address: string }) =>
      api.put<User>("/auth/me", { ...v, phone: v.phone || null, address: v.address || null }),
    { success: "Profile updated", onSuccess: (r) => setUser(r.data) },
  );
  const savePw = useAction(
    (v: { current_password: string; new_password: string; confirm: string }) =>
      api.put("/auth/me/password", { current_password: v.current_password, new_password: v.new_password }),
    { success: "Password changed", onSuccess: () => pw.reset() },
  );
  const upload = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post<User>("/auth/me/photo", body);
    },
    { success: "Photo updated", onSuccess: (r) => setUser(r.data) },
  );

  return (
    <>
      <PageHeader title="My profile" subtitle="Your account details, password and notifications" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile information</CardTitle>
            <CardDescription>How you appear to others in the school portal.</CardDescription>
          </CardHeader>
          <form onSubmit={info.handleSubmit((v) => saveInfo.mutate(v))} className="flex flex-col gap-6">
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <Avatar className="size-20">
                  <AvatarImage src={user.image_url ?? undefined} alt="" className="object-cover" />
                  <AvatarFallback className="text-xl">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <div>
                    <div className="font-medium">{user.name}</div>
                    <Badge variant="secondary">{titleCase(user.role)}</Badge>
                  </div>
                  <FileButton onChange={(f) => f && upload.mutate(f)} accept="image/png,image/jpeg,image/webp">
                    {(props) => (
                      <Button type="button" variant="outline" size="sm" loading={upload.isPending} {...props}>
                        <CameraIcon />
                        Change photo
                      </Button>
                    )}
                  </FileButton>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="p-name" required error={infoErrors.name?.message}>
                  <Controller
                    control={info.control}
                    name="name"
                    rules={{ required: "Name is required" }}
                    render={({ field }) => <Input id="p-name" aria-invalid={!!infoErrors.name || undefined} {...bind(field)} />}
                  />
                </Field>
                <Field label="Email" htmlFor="p-email" required error={infoErrors.email?.message}>
                  <Controller
                    control={info.control}
                    name="email"
                    rules={{ required: "Email is required" }}
                    render={({ field }) => <Input id="p-email" type="email" aria-invalid={!!infoErrors.email || undefined} {...bind(field)} />}
                  />
                </Field>
                {["admin", "teacher", "parent", "student"].includes(user.role) && (
                  <>
                    <Field label="Phone" htmlFor="p-phone">
                      <Controller control={info.control} name="phone" render={({ field }) => <Input id="p-phone" type="tel" {...bind(field)} />} />
                    </Field>
                    <Field label="Address" htmlFor="p-address">
                      <Controller control={info.control} name="address" render={({ field }) => <Input id="p-address" {...bind(field)} />} />
                    </Field>
                  </>
                )}
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t">
              <Button type="submit" loading={saveInfo.isPending}>
                <SaveIcon />
                Save changes
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Use at least 8 characters. You stay signed in on this device.</CardDescription>
          </CardHeader>
          <form onSubmit={pw.handleSubmit((v) => savePw.mutate(v))} className="flex flex-col gap-6">
            <CardContent className="grid gap-4">
              <Field label="Current password" htmlFor="pw-current">
                <Controller
                  control={pw.control}
                  name="current_password"
                  render={({ field }) => <PasswordInput id="pw-current" autoComplete="current-password" {...bind(field)} />}
                />
              </Field>
              <Field label="New password" htmlFor="pw-new" error={pwErrors.new_password?.message}>
                <Controller
                  control={pw.control}
                  name="new_password"
                  rules={{ validate: (v) => (v.length >= 8 ? true : "At least 8 characters") }}
                  render={({ field }) => (
                    <PasswordInput id="pw-new" autoComplete="new-password" aria-invalid={!!pwErrors.new_password || undefined} {...bind(field)} />
                  )}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="pw-confirm" error={pwErrors.confirm?.message}>
                <Controller
                  control={pw.control}
                  name="confirm"
                  rules={{ validate: (v, all) => (v === all.new_password ? true : "Passwords do not match") }}
                  render={({ field }) => (
                    <PasswordInput id="pw-confirm" autoComplete="new-password" aria-invalid={!!pwErrors.confirm || undefined} {...bind(field)} />
                  )}
                />
              </Field>
            </CardContent>
            <CardFooter className="justify-end border-t">
              <Button type="submit" loading={savePw.isPending}>
                <KeyRoundIcon />
                Change password
              </Button>
            </CardFooter>
          </form>
        </Card>
        <TwoFactorCard />
        <div className="lg:col-span-2">
          <NotificationSettingsCard />
        </div>
      </div>
    </>
  );
}
