import { useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { levelFor, type Level } from "../nav";

/** The signed-in user's level for the page at the current address: full, view or none. */
export function usePageLevel(): Level {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const page = pathname.replace(/^\/app\//, "").split("/")[0];
  return levelFor(page, user?.permissions);
}
