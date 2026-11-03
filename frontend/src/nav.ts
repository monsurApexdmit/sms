import {
  AwardIcon,
  BookCheckIcon,
  BanknoteIcon,
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
  UserCheckIcon,
  UserCogIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "./api/types";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  roles: Role[];
  group?: string;
}

const ALL: Role[] = ["admin", "teacher", "student", "parent", "librarian", "accountant"];

export const NAV: NavItem[] = [
  { label: "Dashboard", path: "dashboard", icon: LayoutDashboardIcon, roles: ALL },
  { label: "Analytics", path: "analytics", icon: ChartLineIcon, roles: ["admin", "teacher", "accountant"] },

  { label: "Students", path: "students", icon: GraduationCapIcon, roles: ["admin", "teacher"], group: "People" },
  { label: "Teachers", path: "teachers", icon: PresentationIcon, roles: ["admin", "student", "parent", "teacher"], group: "People" },
  { label: "Parents", path: "parents", icon: UsersIcon, roles: ["admin"], group: "People" },
  { label: "Staff accounts", path: "staff", icon: UserCogIcon, roles: ["admin"], group: "People" },
  { label: "Promotion", path: "promotion", icon: AwardIcon, roles: ["admin"], group: "People" },
  { label: "ID cards", path: "id-cards", icon: IdCardIcon, roles: ["admin"], group: "People" },
  { label: "Certificates", path: "certificates", icon: ScrollTextIcon, roles: ["admin"], group: "People" },
  { label: "Health & certificates", path: "my-records", icon: HeartPulseIcon, roles: ["student", "parent"], group: "People" },
  { label: "Admissions", path: "admissions", icon: UserPlusIcon, roles: ["admin", "accountant"], group: "People" },

  { label: "School years", path: "school-years", icon: CalendarCogIcon, roles: ["admin"], group: "Academic" },
  { label: "Classes & sections", path: "classes", icon: BuildingIcon, roles: ["admin"], group: "Academic" },
  { label: "Subjects", path: "subjects", icon: BookOpenIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Class routine", path: "routine", icon: CalendarDaysIcon, roles: ["admin", "teacher"], group: "Academic" },
  { label: "My routine", path: "my-routine", icon: CalendarDaysIcon, roles: ["teacher", "student", "parent"], group: "Academic" },
  { label: "Syllabus", path: "syllabus", icon: FileTextIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Study material", path: "study-material", icon: NotebookPenIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Homework", path: "homework", icon: BookCheckIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Academic calendar", path: "calendar", icon: CalendarRangeIcon, roles: ALL, group: "Academic" },

  { label: "Exams & grades", path: "exams", icon: ClipboardListIcon, roles: ["admin"], group: "Exams" },
  { label: "Marks entry", path: "marks", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Marksheet", path: "marksheet", icon: ChartColumnIcon, roles: ["admin", "teacher", "student", "parent"], group: "Exams" },
  { label: "Tabulation sheet", path: "tabulation", icon: ChartColumnIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Exam timetable", path: "exam-timetable", icon: CalendarClockIcon, roles: ["admin", "teacher", "student", "parent"], group: "Exams" },
  { label: "Report cards", path: "report-cards", icon: FileBadgeIcon, roles: ["admin", "teacher", "student", "parent"], group: "Exams" },
  { label: "Online exams", path: "online-exams", icon: ClipboardListIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Online exams", path: "my-online-exams", icon: ClipboardListIcon, roles: ["student", "parent"], group: "Exams" },
  { label: "Question papers", path: "question-papers", icon: FileTextIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Marks by SMS", path: "exam-sms", icon: MessageSquareTextIcon, roles: ["admin"], group: "Exams" },

  { label: "Daily attendance", path: "attendance", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: "Attendance" },
  { label: "Attendance report", path: "attendance-report", icon: CalendarDaysIcon, roles: ["admin", "teacher", "student", "parent"], group: "Attendance" },
  { label: "Leave", path: "leave", icon: PlaneIcon, roles: ALL, group: "Attendance" },
  { label: "Period attendance", path: "period-attendance", icon: ListChecksIcon, roles: ["admin", "teacher"], group: "Attendance" },
  { label: "Check-in kiosk", path: "kiosk", icon: ScanLineIcon, roles: ["admin", "teacher", "librarian", "accountant"], group: "Attendance" },
  { label: "ID cards & devices", path: "cards-devices", icon: NfcIcon, roles: ["admin"], group: "Attendance" },

  { label: "Invoices", path: "invoices", icon: WalletIcon, roles: ["admin", "accountant"], group: "Finance" },
  { label: "Payments", path: "my-invoices", icon: WalletIcon, roles: ["student", "parent"], group: "Finance" },
  { label: "Income & expenses", path: "accounting", icon: ChartColumnIcon, roles: ["admin", "accountant"], group: "Finance" },
  { label: "Fee setup", path: "fee-setup", icon: FileCogIcon, roles: ["admin", "accountant"], group: "Finance" },

  { label: "Staff attendance", path: "staff-attendance", icon: UserCheckIcon, roles: ["admin"], group: "HR" },
  { label: "Payroll", path: "payroll", icon: BanknoteIcon, roles: ["admin", "accountant"], group: "HR" },
  { label: "Salary structures", path: "salary-structures", icon: HandCoinsIcon, roles: ["admin"], group: "HR" },
  { label: "My payslips", path: "my-payslips", icon: ReceiptTextIcon, roles: ["teacher", "librarian", "accountant"], group: "HR" },

  { label: "Library", path: "library", icon: LibraryIcon, roles: ALL, group: "Campus" },
  { label: "Transport", path: "transport", icon: BusFrontIcon, roles: ["admin", "teacher", "student", "parent"], group: "Campus" },
  { label: "Transport & dormitory", path: "facilities", icon: BusIcon, roles: ["admin", "student", "parent", "teacher"], group: "Campus" },
  { label: "Noticeboard", path: "notices", icon: MegaphoneIcon, roles: ALL, group: "Campus" },
  { label: "Messages", path: "messages", icon: MessagesSquareIcon, roles: ALL, group: "Campus" },
  { label: "Parent-teacher meetings", path: "meetings", icon: HandshakeIcon, roles: ["admin"], group: "Campus" },
  { label: "My meeting slots", path: "my-meetings", icon: HandshakeIcon, roles: ["teacher"], group: "Campus" },
  { label: "Book a meeting", path: "book-meeting", icon: HandshakeIcon, roles: ["parent"], group: "Campus" },

  { label: "Website", path: "website", icon: GlobeIcon, roles: ["admin"], group: "Settings" },
  { label: "System settings", path: "settings", icon: SettingsIcon, roles: ["admin"], group: "Settings" },
  { label: "Audit log", path: "audit-log", icon: HistoryIcon, roles: ["admin"], group: "Settings" },
  { label: "My profile", path: "profile", icon: UserIcon, roles: ALL, group: "Settings" },
  { label: "Public website", path: "/", icon: HouseIcon, roles: ALL, group: "Settings" },
];

export const navFor = (role: Role) => NAV.filter((n) => n.roles.includes(role));
export const canAccess = (role: Role, path: string) => NAV.some((n) => n.path === path && n.roles.includes(role));
