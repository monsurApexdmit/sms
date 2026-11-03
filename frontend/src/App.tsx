import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { canAccess } from "./nav";

// Each page module loads on first visit so the initial bundle stays small.
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
  lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));

const ClassesPage = page(() => import("./pages/Academic"), "ClassesPage");
const MyRoutinePage = page(() => import("./pages/Academic"), "MyRoutinePage");
const RoutinePage = page(() => import("./pages/Academic"), "RoutinePage");
const StudyMaterialPage = page(() => import("./pages/Academic"), "StudyMaterialPage");
const SubjectsPage = page(() => import("./pages/Academic"), "SubjectsPage");
const SyllabusPage = page(() => import("./pages/Academic"), "SyllabusPage");
const AttendancePage = page(() => import("./pages/Attendance"), "AttendancePage");
const CalendarPage = page(() => import("./pages/Calendar"), "CalendarPage");
const SchoolYearsPage = page(() => import("./pages/Calendar"), "SchoolYearsPage");
const AttendanceReportPage = page(() => import("./pages/Attendance"), "AttendanceReportPage");
const LeavePage = page(() => import("./pages/Leave"), "LeavePage");
const ForgotPasswordPage = page(() => import("./pages/Auth"), "ForgotPasswordPage");
const LoginPage = page(() => import("./pages/Auth"), "LoginPage");
const ResetPasswordPage = page(() => import("./pages/Auth"), "ResetPasswordPage");
const FacilitiesPage = page(() => import("./pages/Campus"), "FacilitiesPage");
const HomeworkPage = page(() => import("./pages/Homework"), "HomeworkPage");
const LibraryPage = page(() => import("./pages/Campus"), "LibraryPage");
const NoticesPage = page(() => import("./pages/Campus"), "NoticesPage");
const DashboardPage = page(() => import("./pages/Dashboard"), "DashboardPage");
const ExamSmsPage = page(() => import("./pages/Exams"), "ExamSmsPage");
const ExamsPage = page(() => import("./pages/Exams"), "ExamsPage");
const MarksheetPage = page(() => import("./pages/Exams"), "MarksheetPage");
const MarksPage = page(() => import("./pages/Exams"), "MarksPage");
const QuestionPapersPage = page(() => import("./pages/Exams"), "QuestionPapersPage");
const TabulationPage = page(() => import("./pages/Exams"), "TabulationPage");
const AccountingPage = page(() => import("./pages/Finance"), "AccountingPage");
const InvoicesPage = page(() => import("./pages/Finance"), "InvoicesPage");
const MyInvoicesPage = page(() => import("./pages/Finance"), "MyInvoicesPage");
const FeeSetupPage = page(() => import("./pages/Fees"), "FeeSetupPage");
const ReceiptPage = page(() => import("./pages/Fees"), "ReceiptPage");
const MessagesPage = page(() => import("./pages/Messages"), "MessagesPage");
const BookMeetingPage = page(() => import("./pages/Meetings"), "BookMeetingPage");
const MeetingSessionsPage = page(() => import("./pages/Meetings"), "MeetingSessionsPage");
const MyMeetingsPage = page(() => import("./pages/Meetings"), "MyMeetingsPage");
const AnswerScriptPage = page(() => import("./pages/OnlineExams"), "AnswerScriptPage");
const MyOnlineExamsPage = page(() => import("./pages/OnlineExams"), "MyOnlineExamsPage");
const OnlineExamDetailPage = page(() => import("./pages/OnlineExams"), "OnlineExamDetailPage");
const OnlineExamsPage = page(() => import("./pages/OnlineExams"), "OnlineExamsPage");
const TakeExamPage = page(() => import("./pages/OnlineExams"), "TakeExamPage");
const ParentsPage = page(() => import("./pages/People"), "ParentsPage");
const StaffPage = page(() => import("./pages/People"), "StaffPage");
const TeachersPage = page(() => import("./pages/People"), "TeachersPage");
const ProfilePage = page(() => import("./pages/Profile"), "ProfilePage");
const ExamTimetablePage = page(() => import("./pages/ReportCards"), "ExamTimetablePage");
const ReportCardsPage = page(() => import("./pages/ReportCards"), "ReportCardsPage");
const AuditLogPage = page(() => import("./pages/Settings"), "AuditLogPage");
const SystemSettingsPage = page(() => import("./pages/Settings"), "SystemSettingsPage");
const WebsitePage = page(() => import("./pages/Settings"), "WebsitePage");
const MyPayslipsPage = page(() => import("./pages/Hr"), "MyPayslipsPage");
const PayrollPage = page(() => import("./pages/Hr"), "PayrollPage");
const PayslipPage = page(() => import("./pages/Hr"), "PayslipPage");
const SalaryStructuresPage = page(() => import("./pages/Hr"), "SalaryStructuresPage");
const StaffAttendancePage = page(() => import("./pages/Hr"), "StaffAttendancePage");
const IdCardsPage = page(() => import("./pages/Students"), "IdCardsPage");
const PromotionPage = page(() => import("./pages/Students"), "PromotionPage");
const StudentsPage = page(() => import("./pages/Students"), "StudentsPage");
const HomePage = page(() => import("./pages/public/Public"), "HomePage");
const PublicAdmissionPage = page(() => import("./pages/public/Public"), "PublicAdmissionPage");
const PublicContactPage = page(() => import("./pages/public/Public"), "PublicContactPage");
const PublicEventsPage = page(() => import("./pages/public/Public"), "PublicEventsPage");
const PublicGalleryItemPage = page(() => import("./pages/public/Public"), "PublicGalleryItemPage");
const PublicGalleryPage = page(() => import("./pages/public/Public"), "PublicGalleryPage");
const PublicLayout = page(() => import("./pages/public/Public"), "PublicLayout");
const PublicNewsItemPage = page(() => import("./pages/public/Public"), "PublicNewsItemPage");
const PublicNewsPage = page(() => import("./pages/public/Public"), "PublicNewsPage");
const PublicNoticePage = page(() => import("./pages/public/Public"), "PublicNoticePage");
const PublicNoticesPage = page(() => import("./pages/public/Public"), "PublicNoticesPage");
const PublicTeachersPage = page(() => import("./pages/public/Public"), "PublicTeachersPage");
const PublicTextPage = page(() => import("./pages/public/Public"), "PublicTextPage");

/** Hides pages the role has no menu entry for. The API enforces the same rules. */
function Guard({ page, children }: { page: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!canAccess(user.role, page)) return <Navigate to="/app/dashboard" replace />;
  return <>{children}</>;
}

const APP_PAGES: [string, ReactNode][] = [
  ["dashboard", <DashboardPage />],
  ["students", <StudentsPage />],
  ["teachers", <TeachersPage />],
  ["parents", <ParentsPage />],
  ["staff", <StaffPage />],
  ["promotion", <PromotionPage />],
  ["id-cards", <IdCardsPage />],
  ["school-years", <SchoolYearsPage />],
  ["classes", <ClassesPage />],
  ["subjects", <SubjectsPage />],
  ["routine", <RoutinePage />],
  ["my-routine", <MyRoutinePage />],
  ["syllabus", <SyllabusPage />],
  ["study-material", <StudyMaterialPage />],
  ["homework", <HomeworkPage />],
  ["calendar", <CalendarPage />],
  ["exams", <ExamsPage />],
  ["marks", <MarksPage />],
  ["marksheet", <MarksheetPage />],
  ["tabulation", <TabulationPage />],
  ["exam-timetable", <ExamTimetablePage />],
  ["report-cards", <ReportCardsPage />],
  ["online-exams", <OnlineExamsPage />],
  ["my-online-exams", <MyOnlineExamsPage />],
  ["question-papers", <QuestionPapersPage />],
  ["exam-sms", <ExamSmsPage />],
  ["attendance", <AttendancePage />],
  ["attendance-report", <AttendanceReportPage />],
  ["leave", <LeavePage />],
  ["invoices", <InvoicesPage />],
  ["my-invoices", <MyInvoicesPage />],
  ["accounting", <AccountingPage />],
  ["fee-setup", <FeeSetupPage />],

  ["staff-attendance", <StaffAttendancePage />],
  ["payroll", <PayrollPage />],
  ["salary-structures", <SalaryStructuresPage />],
  ["my-payslips", <MyPayslipsPage />],
  ["library", <LibraryPage />],
  ["facilities", <FacilitiesPage />],
  ["notices", <NoticesPage />],
  ["messages", <MessagesPage />],
  ["meetings", <MeetingSessionsPage />],
  ["my-meetings", <MyMeetingsPage />],
  ["book-meeting", <BookMeetingPage />],
  ["website", <WebsitePage />],
  ["settings", <SystemSettingsPage />],
  ["audit-log", <AuditLogPage />],
  ["profile", <ProfilePage />],
];

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-1">
      <h1 className="text-5xl font-bold tracking-tight">404</h1>
      <p className="text-muted-foreground">Page not found</p>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="notices" element={<PublicNoticesPage />} />
          <Route path="notices/:id" element={<PublicNoticePage />} />
          <Route path="news" element={<PublicNewsPage />} />
          <Route path="news/:id" element={<PublicNewsItemPage />} />
          <Route path="events" element={<PublicEventsPage />} />
          <Route path="gallery" element={<PublicGalleryPage />} />
          <Route path="gallery/:id" element={<PublicGalleryItemPage />} />
          <Route path="teachers" element={<PublicTeachersPage />} />
          <Route path="contact" element={<PublicContactPage />} />
          <Route path="admission" element={<PublicAdmissionPage />} />
          <Route path="about" element={<PublicTextPage field="about_us" title="About us" />} />
          <Route path="terms" element={<PublicTextPage field="terms_conditions" title="Terms & conditions" />} />
          <Route path="privacy" element={<PublicTextPage field="privacy_policy" title="Privacy policy" />} />
        </Route>

        <Route path="login" element={<LoginPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        <Route path="app" element={<AppLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          {APP_PAGES.map(([path, element]) => (
            <Route key={path} path={path} element={<Guard page={path}>{element}</Guard>} />
          ))}
          <Route path="online-exams/:id" element={<Guard page="online-exams"><OnlineExamDetailPage /></Guard>} />
          <Route path="online-exams/:id/script" element={<Guard page="online-exams"><AnswerScriptPage /></Guard>} />
          <Route path="take-exam/:id" element={<Guard page="my-online-exams"><TakeExamPage /></Guard>} />
          <Route path="my-online-exams/:id/script" element={<Guard page="my-online-exams"><AnswerScriptPage /></Guard>} />
          {/* staff, students and parents: the API decides which receipts each may see */}
          <Route path="receipts/:paymentId" element={<ReceiptPage />} />
          {/* admins and accountants reach payslips from Payroll, other staff from My payslips; the page checks the role */}
          <Route path="payslip/:id" element={<PayslipPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
