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

export interface CalendarEvent {
  event_id: number;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  kind: "holiday" | "exam" | "event" | "meeting" | "other";
  audience: "all" | "staff" | "students" | "parents";
}

export interface SchoolYear {
  academic_year_id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  terms: { term_id: number; name: string; start_date: string | null; end_date: string | null }[];
}

export interface HomeworkSubmission {
  submission_id: number;
  student_id: number;
  text: string | null;
  file_url: string | null;
  submitted_at: string;
  is_late: boolean;
  marks: number | null;
  feedback: string | null;
  graded_at: string | null;
}

export interface Homework {
  homework_id: number;
  class_id: number;
  class_name: string | null;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  title: string;
  description: string | null;
  file_url: string | null;
  assigned_on: string;
  due_date: string;
  max_marks: number | null;
  allow_late: boolean;
  year: string;
  /** staff view */
  students: number | null;
  submitted: number | null;
  graded: number | null;
  /** student / parent view */
  submission: HomeworkSubmission | null;
}

export interface HomeworkRosterRow {
  student_id: number;
  name: string | null;
  roll: number | null;
  submission: HomeworkSubmission | null;
}

export interface LeaveRequest {
  leave_id: number;
  kind: "sick" | "casual" | "family" | "other";
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  person_role: string;
  person_name: string;
  student_id: number | null;
  class_name: string | null;
  applicant_role: string;
  applicant_name: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  can_cancel: boolean;
  can_decide: boolean;
}

export interface FeeHead {
  fee_head_id: number;
  name: string;
  description: string | null;
}

export interface FeeInstalment {
  fee_instalment_id: number;
  name: string;
  due_date: string;
  share_percent: number;
  amount: number;
  invoices: number;
}

export interface FeePlan {
  fee_plan_id: number;
  name: string;
  class_id: number;
  class_name: string | null;
  year: string;
  late_fine_type: "none" | "flat" | "per_day";
  late_fine_amount: number;
  grace_days: number;
  total: number;
  items: { fee_head_id: number; head: string | null; amount: number }[];
  instalments: FeeInstalment[];
}

export interface FeeDiscount {
  fee_discount_id: number;
  student_id: number;
  student_name: string | null;
  fee_plan_id: number | null;
  plan_name: string | null;
  year: string;
  kind: "percent" | "amount";
  value: number;
  reason: string | null;
}

export interface Receipt {
  school: { system_name: string; address: string; phone: string; system_email: string };
  currency: string;
  payment_id: number;
  title: string | null;
  amount: number;
  method: string | null;
  timestamp: string | null;
  description: string | null;
  year: string | null;
  student: { student_id: number; name: string | null; student_code: string | null } | null;
  class_name: string | null;
  section_name: string | null;
  roll: number | null;
  invoice: { invoice_id: number; title: string | null; amount: number; amount_paid: number; due: number } | null;
}

// --- report cards ---

export interface ExamPaper {
  exam_schedule_id: number;
  exam_id: number;
  class_id: number;
  subject_id: number;
  subject: string | null;
  exam_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
  /** ids of papers of the same class whose times overlap this one */
  clashes: number[];
}

export interface CardStudent {
  student_id: number;
  name: string | null;
  student_code: string | null;
  class_id: number | null;
  class_name: string | null;
  section_id: number | null;
  section_name: string | null;
  roll: number | null;
  image_url: string | null;
}

export interface AdmitCard {
  exam: { exam_id: number; name: string | null; year: string | null };
  student: CardStudent;
  schedule: ExamPaper[];
}

export interface ExamWeights {
  year: string;
  exams: { exam_id: number; name: string | null; weight: number | null }[];
  total: number;
  warnings: string[];
}

/** Exam cards fill mark_obtained … comment; annual cards fill marks (per exam id) and weighted_percentage. */
export interface ReportSubjectLine {
  subject_id: number;
  subject: string | null;
  mark_obtained?: number | null;
  full_marks?: number;
  grade?: string | null;
  grade_point?: number | null;
  comment?: string | null;
  marks?: Record<string, number | null>;
  weighted_percentage?: number | null;
}

export interface ReportCard {
  kind: "exam" | "annual";
  year: string;
  exam: { exam_id: number; name: string | null } | null;
  student: CardStudent;
  subjects: ReportSubjectLine[];
  total?: number;
  full_total?: number;
  /** annual cards: the weighted exams */
  exams: { exam_id: number; name: string | null; weight: number; percentage: number | null; gpa: number | null; result: string }[];
  percentage: number | null;
  /** GPA, or CGPA on annual cards */
  gpa: number | null;
  result: "Pass" | "Fail" | "Incomplete";
  position_class: number;
  position_section: number;
  class_size: number;
  section_size: number;
  warnings: string[];
  attendance: { present: number; absent: number; working_days: number; percent: number | null; from: string | null; to: string | null };
  remark: string | null;
}

export interface MeetingSession {
  session_id: number;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  location: string | null;
  class_id: number | null;
  class_name: string | null;
  teacher_ids: number[];
  slots: number;
  booked: number;
}

export interface MeetingBooking {
  booking_id: number;
  slot_id: number;
  status: "booked" | "cancelled" | "done" | "no_show";
  note: string | null;
  teacher_note?: string | null;
  student_id: number;
  student_name: string | null;
  parent_id: number;
  parent_name: string | null;
  parent_phone: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  session_id: number | null;
  session_title: string | null;
  date: string | null;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface MeetingSlot {
  slot_id: number;
  teacher_id: number;
  teacher_name: string | null;
  start_time: string;
  end_time: string;
  status: "open" | "booked" | "blocked";
  booking: MeetingBooking | null;
}

export interface StaffMember {
  staff_role: "teacher" | "librarian" | "accountant";
  staff_id: number;
  name: string;
}

export interface StaffAttendanceRow extends StaffMember {
  status: "present" | "absent" | "late" | "half_day" | "leave" | null;
  check_in: string | null;
  check_out: string | null;
  note: string | null;
}

export interface PayItem {
  name: string;
  amount: number;
}

export interface SalaryStructure extends Omit<StaffMember, "name"> {
  salary_structure_id: number;
  name: string | null;
  basic: number;
  allowances: PayItem[];
  deductions: PayItem[];
  effective_from: string;
}

export interface PayrollRun {
  payroll_run_id: number;
  month: string;
  status: "draft" | "finalized" | "paid";
  created_by: string | null;
  created_at: string;
  finalized_at: string | null;
  paid_at: string | null;
  staff: number;
  gross: number;
  net: number;
}

export interface Payslip {
  payslip_id: number;
  payroll_run_id: number;
  month: string;
  run_status: PayrollRun["status"];
  staff_role: StaffMember["staff_role"];
  staff_id: number;
  name: string | null;
  basic: number;
  allowances: PayItem[];
  deductions: PayItem[];
  absence_deduction: number;
  gross: number;
  net: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  paid_on: string | null;
  payment_id: number | null;
}

// --- transport ---

export interface RouteStop {
  stop_id: number;
  route_id: number;
  name: string;
  sequence: number;
  pickup_time: string | null;
  drop_time: string | null;
  fare: string | null;
}

export interface Vehicle {
  vehicle_id: number;
  registration_no: string;
  model: string | null;
  capacity: number;
  route_id: number | null;
  route_name: string | null;
  driver_id: number | null;
  driver_name: string | null;
  driver_phone: string | null;
  insurance_expiry: string | null;
  fitness_expiry: string | null;
  notes: string | null;
  active: boolean;
}

export interface RouteCapacity {
  assigned: number;
  capacity: number;
  over_capacity: boolean;
}

export interface TransportRoute extends RouteCapacity {
  transport_id: number;
  route_name: string | null;
  route_fare: string | null;
  description: string | null;
  stops: RouteStop[];
  vehicles: Vehicle[];
}

export interface TransportAssignment {
  student_id: number;
  name: string | null;
  roll: number | null;
  class_name: string | null;
  section_name: string | null;
  route_id: number | null;
  route_name: string | null;
  stop_id: number | null;
  stop_name: string | null;
  pickup: boolean;
  drop: boolean;
  parent_phone: string | null;
}

export interface TransportRoster extends RouteCapacity {
  transport_id: number;
  route_name: string | null;
  vehicles: Vehicle[];
  stops: { stop: RouteStop | null; students: TransportAssignment[] }[];
}

export interface TransportExpiry {
  kind: "insurance" | "fitness" | "licence";
  label: string;
  item_id: number;
  expires_on: string;
  days_left: number;
}

export interface MyTransport {
  student_id: number;
  student_name: string | null;
  route_id: number | null;
  route_name: string | null;
  route_description: string | null;
  stop: RouteStop | null;
  pickup: boolean;
  drop: boolean;
  fare: string | null;
  since: string | null;
  vehicles: { registration_no: string; model: string | null; driver_name: string | null; driver_phone: string | null }[];
}
