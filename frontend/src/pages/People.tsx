import { ImageIcon } from "lucide-react";

import { api } from "../api/client";
import { useAction } from "../api/hooks";
import { useUser } from "../auth/AuthContext";
import { CrudPage, IconAction, type FieldDef } from "../components/CrudPage";
import { FileButton } from "../components/file-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

const GENDER = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));

const account = (extra: FieldDef[] = []): FieldDef[] => [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  ...extra,
  { name: "password", label: "Password", type: "password", formOnly: true, createOnlyRequired: true },
];

function PhotoButton({ path, id }: { path: string; id: unknown }) {
  const upload = useAction(
    (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`${path}/${id}/photo`, body);
    },
    { success: "Photo updated", invalidate: [[path]] },
  );
  return (
    <FileButton onChange={(f) => f && upload.mutate(f)} accept="image/png,image/jpeg,image/webp">
      {(props) => (
        <IconAction label="Upload photo" loading={upload.isPending} {...props}>
          <ImageIcon />
        </IconAction>
      )}
    </FileButton>
  );
}

export function TeachersPage() {
  const user = useUser();
  const admin = user.role === "admin";
  return (
    <CrudPage
      title="Teachers"
      path="/teachers"
      idField="teacher_id"
      canWrite={admin}
      searchable
      avatar
      extraActions={admin ? (row) => <PhotoButton path="/teachers" id={row.teacher_id} /> : undefined}
      fields={account([
        { name: "designation", label: "Designation" },
        { name: "phone", label: "Phone" },
        { name: "sex", label: "Gender", type: "select", options: GENDER, formOnly: true },
        { name: "birthday", label: "Birthday", type: "date", formOnly: true },
        { name: "blood_group", label: "Blood group", type: "select", options: BLOOD, formOnly: true },
        { name: "religion", label: "Religion", formOnly: true },
        { name: "address", label: "Address", formOnly: true },
        { name: "about", label: "About (shown on website)", type: "textarea", formOnly: true },
        { name: "show_on_website", label: "Show on public website", type: "switch", formOnly: !admin },
      ]).filter((f) => admin || ["name", "email", "designation", "phone"].includes(f.name))}
    />
  );
}

export function ParentsPage() {
  return (
    <CrudPage
      title="Parents"
      path="/parents"
      idField="parent_id"
      searchable
      fields={account([
        { name: "phone", label: "Phone" },
        { name: "profession", label: "Profession" },
        { name: "address", label: "Address", formOnly: true },
      ])}
    />
  );
}

export function StaffPage() {
  return (
    <Tabs defaultValue="admins" className="gap-4">
      <TabsList>
        <TabsTrigger value="admins">Admins</TabsTrigger>
        <TabsTrigger value="librarians">Librarians</TabsTrigger>
        <TabsTrigger value="accountants">Accountants</TabsTrigger>
      </TabsList>
      <TabsContent value="admins">
        <CrudPage title="Admins" path="/admins" idField="admin_id" searchable fields={account([{ name: "phone", label: "Phone" }])} />
      </TabsContent>
      <TabsContent value="librarians">
        <CrudPage title="Librarians" path="/librarians" idField="librarian_id" searchable fields={account()} />
      </TabsContent>
      <TabsContent value="accountants">
        <CrudPage title="Accountants" path="/accountants" idField="accountant_id" searchable fields={account()} />
      </TabsContent>
    </Tabs>
  );
}

export { GENDER, BLOOD, PhotoButton };
