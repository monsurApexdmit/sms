import {
  AwardIcon,
  BookCheckIcon,
  BanknoteIcon,
  BellIcon,
  BookOpenIcon,
  BuildingIcon,
  BusFrontIcon,
  BusIcon,
  CalendarClockIcon,
  CalendarCogIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ChartLineIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FileBadgeIcon,
  FileTextIcon,
  FileCogIcon,
  GlobeIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HandCoinsIcon,
  HeartPulseIcon,
  HistoryIcon,
  HouseIcon,
  IdCardIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PlaneIcon,
  ListChecksIcon,
  NfcIcon,
  ScanLineIcon,
  PresentationIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserCogIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "./api/types";
import { t } from "./i18n";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  roles: Role[];
  group?: string;
  /** only for administrators without a restricting custom role */
  fullAdminOnly?: boolean;
}

const ALL: Role[] = ["admin", "teacher", "student", "parent", "librarian", "accountant"];

export const NAV: NavItem[] = [
  { label: t("Dashboard"), path: "dashboard", icon: LayoutDashboardIcon, roles: ALL },
  { label: t("Analytics"), path: "analytics", icon: ChartLineIcon, roles: ["admin", "teacher", "accountant"] },

  { label: t("Students"), path: "students", icon: GraduationCapIcon, roles: ["admin", "teacher"], group: t("People") },
  { label: t("Teachers"), path: "teachers", icon: PresentationIcon, roles: ["admin", "student", "parent", "teacher"], group: t("People") },
  { label: t("Parents"), path: "parents", icon: UsersIcon, roles: ["admin"], group: t("People") },
  { label: t("Staff accounts"), path: "staff", icon: UserCogIcon, roles: ["admin"], group: t("People") },
  { label: t("Promotion"), path: "promotion", icon: AwardIcon, roles: ["admin"], group: t("People") },
  { label: t("ID cards"), path: "id-cards", icon: IdCardIcon, roles: ["admin"], group: t("People") },
  { label: t("Certificates"), path: "certificates", icon: ScrollTextIcon, roles: ["admin"], group: t("People") },
  { label: t("Health & certificates"), path: "my-records", icon: HeartPulseIcon, roles: ["student", "parent"], group: t("People") },
  { label: t("Admissions"), path: "admissions", icon: UserPlusIcon, roles: ["admin", "accountant"], group: t("People") },

  { label: t("School years"), path: "school-years", icon: CalendarCogIcon, roles: ["admin"], group: t("Academic") },
  { label: t("Classes & sections"), path: "classes", icon: BuildingIcon, roles: ["admin"], group: t("Academic") },
  { label: t("Subjects"), path: "subjects", icon: BookOpenIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Academic") },
  { label: t("Class routine"), path: "routine", icon: CalendarDaysIcon, roles: ["admin", "teacher"], group: t("Academic") },
  { label: t("My routine"), path: "my-routine", icon: CalendarDaysIcon, roles: ["teacher", "student", "parent"], group: t("Academic") },
  { label: t("Syllabus"), path: "syllabus", icon: FileTextIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Academic") },
  { label: t("Study material"), path: "study-material", icon: NotebookPenIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Academic") },
  { label: t("Homework"), path: "homework", icon: BookCheckIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Academic") },
  { label: t("Academic calendar"), path: "calendar", icon: CalendarRangeIcon, roles: ALL, group: t("Academic") },

  { label: t("Exams & grades"), path: "exams", icon: ClipboardListIcon, roles: ["admin"], group: t("Exams") },
  { label: t("Marks entry"), path: "marks", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: t("Exams") },
  { label: t("Marksheet"), path: "marksheet", icon: ChartColumnIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Exams") },
  { label: t("Tabulation sheet"), path: "tabulation", icon: ChartColumnIcon, roles: ["admin", "teacher"], group: t("Exams") },
  { label: t("Exam timetable"), path: "exam-timetable", icon: CalendarClockIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Exams") },
  { label: t("Report cards"), path: "report-cards", icon: FileBadgeIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Exams") },
  { label: t("Online exams"), path: "online-exams", icon: ClipboardListIcon, roles: ["admin", "teacher"], group: t("Exams") },
  { label: t("Online exams"), path: "my-online-exams", icon: ClipboardListIcon, roles: ["student", "parent"], group: t("Exams") },
  { label: t("Question papers"), path: "question-papers", icon: FileTextIcon, roles: ["admin", "teacher"], group: t("Exams") },
  { label: t("Marks by SMS"), path: "exam-sms", icon: MessageSquareTextIcon, roles: ["admin"], group: t("Exams") },

  { label: t("Daily attendance"), path: "attendance", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: t("Attendance") },
  { label: t("Attendance report"), path: "attendance-report", icon: CalendarDaysIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Attendance") },
  { label: t("Leave"), path: "leave", icon: PlaneIcon, roles: ALL, group: t("Attendance") },
  { label: t("Period attendance"), path: "period-attendance", icon: ListChecksIcon, roles: ["admin", "teacher"], group: t("Attendance") },
  { label: t("Check-in kiosk"), path: "kiosk", icon: ScanLineIcon, roles: ["admin", "teacher", "librarian", "accountant"], group: t("Attendance") },
  { label: t("ID cards & devices"), path: "cards-devices", icon: NfcIcon, roles: ["admin"], group: t("Attendance") },

  { label: t("Invoices"), path: "invoices", icon: WalletIcon, roles: ["admin", "accountant"], group: t("Finance") },
  { label: t("Payments"), path: "my-invoices", icon: WalletIcon, roles: ["student", "parent"], group: t("Finance") },
  { label: t("Income & expenses"), path: "accounting", icon: ChartColumnIcon, roles: ["admin", "accountant"], group: t("Finance") },
  { label: t("Fee setup"), path: "fee-setup", icon: FileCogIcon, roles: ["admin", "accountant"], group: t("Finance") },

  { label: t("Staff attendance"), path: "staff-attendance", icon: UserCheckIcon, roles: ["admin"], group: t("HR") },
  { label: t("Payroll"), path: "payroll", icon: BanknoteIcon, roles: ["admin", "accountant"], group: t("HR") },
  { label: t("Salary structures"), path: "salary-structures", icon: HandCoinsIcon, roles: ["admin"], group: t("HR") },
  { label: t("My payslips"), path: "my-payslips", icon: ReceiptTextIcon, roles: ["teacher", "librarian", "accountant"], group: t("HR") },

  { label: t("Library"), path: "library", icon: LibraryIcon, roles: ALL, group: t("Campus") },
  { label: t("Transport"), path: "transport", icon: BusFrontIcon, roles: ["admin", "teacher", "student", "parent"], group: t("Campus") },
  { label: t("Transport & dormitory"), path: "facilities", icon: BusIcon, roles: ["admin", "student", "parent", "teacher"], group: t("Campus") },
  { label: t("Noticeboard"), path: "notices", icon: MegaphoneIcon, roles: ALL, group: t("Campus") },
  { label: t("Messages"), path: "messages", icon: MessagesSquareIcon, roles: ALL, group: t("Campus") },
  { label: t("Parent-teacher meetings"), path: "meetings", icon: HandshakeIcon, roles: ["admin"], group: t("Campus") },
  { label: t("My meeting slots"), path: "my-meetings", icon: HandshakeIcon, roles: ["teacher"], group: t("Campus") },
  { label: t("Book a meeting"), path: "book-meeting", icon: HandshakeIcon, roles: ["parent"], group: t("Campus") },

  { label: t("Website"), path: "website", icon: GlobeIcon, roles: ["admin"], group: t("Settings") },
  { label: t("System settings"), path: "settings", icon: SettingsIcon, roles: ["admin"], group: t("Settings") },
  { label: t("Roles & permissions"), path: "roles", icon: ShieldCheckIcon, roles: ["admin"], group: t("Settings"), fullAdminOnly: true },
  { label: t("Audit log"), path: "audit-log", icon: HistoryIcon, roles: ["admin"], group: t("Settings") },
  { label: t("Notifications"), path: "notifications", icon: BellIcon, roles: ALL, group: t("Settings") },
  { label: t("My profile"), path: "profile", icon: UserIcon, roles: ALL, group: t("Settings") },
  { label: t("Public website"), path: "/", icon: HouseIcon, roles: ALL, group: t("Settings") },
];

/**
 * Permission module (backend app/core/permissions.py) behind each page. Pages not listed are
 * personal (profile, my payslips, notifications) and follow the role alone.
 */
export const PAGE_MODULE: Record<string, string> = {
  analytics: "analytics", students: "students", promotion: "students", teachers: "teachers", parents: "parents",
  staff: "staff", "id-cards": "id_cards", "cards-devices": "id_cards", certificates: "certificates",
  "my-records": "student_profile", admissions: "admissions", "school-years": "classes", classes: "classes",
  subjects: "subjects", routine: "routine", "my-routine": "routine", syllabus: "syllabus", "study-material": "syllabus",
  homework: "homework", calendar: "calendar", exams: "exams", "exam-timetable": "exams", "exam-sms": "exams",
  marks: "marks", marksheet: "marks", tabulation: "marks", "report-cards": "marks", "online-exams": "online_exams",
  "my-online-exams": "online_exams", "question-papers": "online_exams", attendance: "attendance",
  "attendance-report": "attendance", "period-attendance": "attendance", kiosk: "kiosk", leave: "leave",
  invoices: "invoices", "my-invoices": "invoices", accounting: "accounting", "fee-setup": "fee_setup",
  "staff-attendance": "hr", payroll: "hr", "salary-structures": "hr", library: "library", transport: "transport",
  facilities: "transport", notices: "notices", messages: "messages", meetings: "meetings", "my-meetings": "meetings",
  "book-meeting": "meetings", website: "website", settings: "settings", "audit-log": "audit_log",
};  // prettier-ignore

export type Level = "full" | "view" | "none";
/** module -> level from /auth/me; null = full administrator; undefined = not known (allow by role) */
export type Permissions = Record<string, Level> | null | undefined;

export const levelFor = (path: string, permissions: Permissions): Level => {
  const module = PAGE_MODULE[path];
  if (!module || !permissions) return "full";
  return permissions[module] ?? "none";
};

const allowed = (n: NavItem, role: Role, permissions: Permissions) =>
  n.roles.includes(role) && !(n.fullAdminOnly && permissions) && levelFor(n.path, permissions) !== "none";

export const navFor = (role: Role, permissions?: Permissions) => NAV.filter((n) => allowed(n, role, permissions));
export const canAccess = (role: Role, path: string, permissions?: Permissions) => NAV.some((n) => n.path === path && allowed(n, role, permissions));
