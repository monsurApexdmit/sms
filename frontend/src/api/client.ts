import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

import type { TokenResponse } from "./types";
import { t } from "../i18n";

/** Access token lives in memory only; the refresh token is an httpOnly cookie. */
let accessToken: string | null = null;
let onSessionExpired: () => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export const api = axios.create({ baseURL: "/api", withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

export function refreshSession(): Promise<string | null> {
  refreshing ??= axios
    .post<TokenResponse>("/api/auth/refresh", null, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.access_token);
      return r.data.access_token;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  const isAuthCall = original?.url?.startsWith("/auth/");
  if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
    original._retry = true;
    const token = await refreshSession();
    if (token) return api(original);
    setAccessToken(null);
    onSessionExpired();
  }
  return Promise.reject(error);
});

/** Human-readable message from a FastAPI error response. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map((d: { loc?: (string | number)[]; msg?: string }) => {
          const field = d.loc?.filter((p) => p !== "body").join(".");
          return field ? `${field}: ${d.msg}` : d.msg;
        })
        .join("\n");
    }
    if (error.response?.status === 403) return t("You are not allowed to do that.");
    return error.message;
  }
  return String(error);
}

export interface Page<T> {
  items: T[];
  total: number;
}
