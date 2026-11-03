import {
  AwardIcon,
  BookOpenIcon,
  BuildingIcon,
  BusIcon,
  CalendarCogIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  GlobeIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HistoryIcon,
  HouseIcon,
  IdCardIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  PresentationIcon,
  SettingsIcon,
  UserCogIcon,
  UserIcon,
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

  { label: "Students", path: "students", icon: GraduationCapIcon, roles: ["admin", "teacher"], group: "People" },
  { label: "Teachers", path: "teachers", icon: PresentationIcon, roles: ["admin", "student", "parent", "teacher"], group: "People" },
  { label: "Parents", path: "parents", icon: UsersIcon, roles: ["admin"], group: "People" },
  { label: "Staff accounts", path: "staff", icon: UserCogIcon, roles: ["admin"], group: "People" },
  { label: "Promotion", path: "promotion", icon: AwardIcon, roles: ["admin"], group: "People" },
  { label: "ID cards", path: "id-cards", icon: IdCardIcon, roles: ["admin"], group: "People" },

  { label: "School years", path: "school-years", icon: CalendarCogIcon, roles: ["admin"], group: "Academic" },
  { label: "Classes & sections", path: "classes", icon: BuildingIcon, roles: ["admin"], group: "Academic" },
  { label: "Subjects", path: "subjects", icon: BookOpenIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Class routine", path: "routine", icon: CalendarDaysIcon, roles: ["admin", "teacher"], group: "Academic" },
  { label: "My routine", path: "my-routine", icon: CalendarDaysIcon, roles: ["teacher", "student", "parent"], group: "Academic" },
  { label: "Syllabus", path: "syllabus", icon: FileTextIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Study material", path: "study-material", icon: NotebookPenIcon, roles: ["admin", "teacher", "student", "parent"], group: "Academic" },
  { label: "Academic calendar", path: "calendar", icon: CalendarRangeIcon, roles: ALL, group: "Academic" },

  { label: "Exams & grades", path: "exams", icon: ClipboardListIcon, roles: ["admin"], group: "Exams" },
  { label: "Marks entry", path: "marks", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Marksheet", path: "marksheet", icon: ChartColumnIcon, roles: ["admin", "teacher", "student", "parent"], group: "Exams" },
  { label: "Tabulation sheet", path: "tabulation", icon: ChartColumnIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Online exams", path: "online-exams", icon: ClipboardListIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Online exams", path: "my-online-exams", icon: ClipboardListIcon, roles: ["student", "parent"], group: "Exams" },
  { label: "Question papers", path: "question-papers", icon: FileTextIcon, roles: ["admin", "teacher"], group: "Exams" },
  { label: "Marks by SMS", path: "exam-sms", icon: MessageSquareTextIcon, roles: ["admin"], group: "Exams" },

  { label: "Daily attendance", path: "attendance", icon: ClipboardCheckIcon, roles: ["admin", "teacher"], group: "Attendance" },
  { label: "Attendance report", path: "attendance-report", icon: CalendarDaysIcon, roles: ["admin", "teacher", "student", "parent"], group: "Attendance" },

  { label: "Invoices", path: "invoices", icon: WalletIcon, roles: ["admin", "accountant"], group: "Finance" },
  { label: "Payments", path: "my-invoices", icon: WalletIcon, roles: ["student", "parent"], group: "Finance" },
  { label: "Income & expenses", path: "accounting", icon: ChartColumnIcon, roles: ["admin", "accountant"], group: "Finance" },

  { label: "Library", path: "library", icon: LibraryIcon, roles: ALL, group: "Campus" },
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
