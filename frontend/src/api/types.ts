import type { Page } from "./client";

export type Role = "admin" | "teacher" | "student" | "parent" | "librarian" | "accountant";

export interface User {
  role: Role;
  id: number;
  name: string;
  email: string;
  image_url: string | null;
}

export interface TokenResponse {
  access_token: string;
  user: User;
}

export interface PublicSettings {
  system_name: string;
  system_title: string;
  currency: string;
  running_year: string;
  address: string;
  phone: string;
  system_email: string;
  stripe_enabled: boolean;
  paypal_enabled: boolean;
  logo_url: string | null;
  disable_frontend: string;
}

export interface SchoolClass {
  class_id: number;
  name: string;
  name_numeric: string | null;
  teacher_id: number | null;
}

export interface Section {
  section_id: number;
  name: string;
  nick_name: string | null;
  class_id: number;
  teacher_id: number | null;
}

export interface Subject {
  subject_id: number;
  name: string;
  class_id: number;
  teacher_id: number | null;
  year: string | null;
}

export interface Student {
  student_id: number;
  student_code: string | null;
  name: string;
  email: string | null;
  birthday: string | null;
  sex: string | null;
  religion: string | null;
  blood_group: string | null;
  address: string | null;
  phone: string | null;
  parent_id: number | null;
  dormitory_id: number | null;
  transport_id: number | null;
  dormitory_room_number: string | null;
  enroll_id: number | null;
  class_id: number | null;
  section_id: number | null;
  roll: number | null;
  year: string | null;
  class_name: string | null;
  section_name: string | null;
  parent_name: string | null;
  image_url: string | null;
}

export interface Exam {
  exam_id: number;
  name: string;
  date: string | null;
  year: string | null;
  comment: string | null;
}

export interface Invoice {
  invoice_id: number;
  student_id: number;
  student_name: string | null;
  title: string;
  description: string | null;
  amount: number;
  amount_paid: string | null;
  due: string | null;
  creation_timestamp: number | null;
  payment_timestamp: string | null;
  payment_method: string | null;
  status: "paid" | "unpaid" | string;
  year: string | null;
}

export interface Payment {
  payment_id: number;
  title: string | null;
  payment_type: "income" | "expense" | string;
  invoice_id: number | null;
  student_id: number | null;
  student_name?: string | null;
  category_name?: string | null;
  expense_category_id: number | null;
  method: string | null;
  description: string | null;
  amount: string | null;
  timestamp: string | null;
  year: string | null;
}

export interface Notice {
  notice_id: number;
  notice_title: string;
  notice: string | null;
  create_timestamp: string | null;
  status: number | null;
  show_on_website: number | null;
  image_url: string | null;
}

export interface FileItem {
  title: string;
  description: string | null;
  class_id: number | string | null;
  subject_id: number | null;
  timestamp: string | null;
  file_name: string | null;
  download_url: string | null;
}

export interface Contact {
  ref: string;
  role: Role;
  name: string;
}

export interface Thread {
  code: string;
  other: string;
  other_name: string;
  last_message: string | null;
  last_timestamp: string | null;
  unread: number;
}

export interface ChatMessage {
  message_id: number;
  sender: string;
  sender_name: string;
  message: string;
  timestamp: string | null;
  attachment_name: string | null;
  attachment_url: string | null;
  mine: boolean;
}

export interface Group {
  code: string;
  group_name: string;
  members: string[];
  member_names: string[];
  last_timestamp: string | null;
}

export interface OnlineExam {
  online_exam_id: number;
  code: string;
  title: string;
  class_id: number;
  section_id: number;
  subject_id: number;
  subject_name: string | null;
  exam_date: number;
  time_start: string;
  time_end: string;
  duration: string | null;
  minimum_percentage: string;
  instruction: string | null;
  status: "pending" | "published" | "expired";
  question_count: number;
  total_mark: number;
  my_status: string | null;
}

export interface Question {
  question_bank_id: number;
  online_exam_id: number;
  question_title: string;
  type: "multiple_choice" | "true_false" | "fill_in_the_blanks";
  number_of_options: number | null;
  options: string | null;
  correct_answers: string | null;
  mark: string;
}

export interface InvoicePage extends Page<Invoice> {
  summary: { billed: number; collected: number; outstanding: number; open: number; partial: number };
}

export interface PaymentPage extends Page<Payment> {
  amount_total: number;
}

export interface AuditEntry {
  audit_id: number;
  created_at: string;
  actor: string | null;
  actor_name: string | null;
  action: "insert" | "update" | "delete";
  table_name: string;
  row_id: string;
  changes: Record<string, unknown>;
}
