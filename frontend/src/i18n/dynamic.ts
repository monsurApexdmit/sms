// Values that come from the API and are shown through titleCase() / tDynamic(): roles, statuses,
// payment methods, sex. Listing them here makes them catalog keys so they get translated.
// Not imported at run time; scripts/i18n.mjs reads the t() calls in this file.
import { t } from "./index";

export const DYNAMIC_TEXT = [
  // roles
  t("Admin"), t("Teacher"), t("Student"), t("Parent"), t("Librarian"), t("Accountant"),
  // weekdays stored on the class routine
  t("Saturday"), t("Sunday"), t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday"),
  // invoice, payroll and request statuses
  t("Paid"), t("Unpaid"), t("Partially Paid"), t("Draft"), t("Finalized"), t("Pending"), t("Approved"), t("Rejected"), t("Cancelled"),
  // payment methods
  t("Cash"), t("Cheque"), t("Card"), t("Paypal"), t("Stripe"), t("Bkash"), t("Nagad"), t("Sslcommerz"), t("Bank Transfer"), t("Online"),
  // sex
  t("Male"), t("Female"), t("Other"),
];  // prettier-ignore
