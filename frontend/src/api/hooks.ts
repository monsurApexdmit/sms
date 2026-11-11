import { keepPreviousData, partialMatchKey, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api, errorMessage, type Page } from "./client";
import type { Exam, PublicSettings, SchoolClass, Section, Subject } from "./types";

/**
 * For screens that other people change while you look at them (online applications arriving,
 * colleagues editing): refetch every 20 seconds while the tab is visible, and on focus.
 */
export const LIVE = { refetchInterval: 20_000, refetchOnWindowFocus: true } as const;
type Live = Partial<typeof LIVE>;

export function useList<T>(path: string | null, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: [path, params],
    queryFn: async () => (await api.get<Page<T>>(path!, { params })).data,
    enabled: !!path,
  });
}

/**
 * One page of a server-paged list. Goes back to the first page when `params` change and
 * keeps showing the previous page while the next one loads.
 */
export function usePagedList<T, P extends Page<T> = Page<T>>(path: string | null, params: Record<string, unknown> = {}, pageSize = 50, live?: Live) {
  const key = JSON.stringify(params);
  const [at, setAt] = useState({ key, page: 0 });
  const page = at.key === key ? at.page : 0;
  const setPage = (next: number) => setAt({ key, page: next });
  const query = useQuery({
    queryKey: [path, params, page, pageSize],
    queryFn: async () => (await api.get<P>(path!, { params: { ...params, limit: pageSize, offset: page * pageSize } })).data,
    enabled: !!path,
    placeholderData: keepPreviousData,
    ...live,
  });
  return { ...query, page, setPage, pageSize };
}

/** `value`, updated only after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useGet<T>(path: string | null, params?: Record<string, unknown>, live?: Live) {
  return useQuery({
    queryKey: [path, params],
    queryFn: async () => (await api.get<T>(path!, { params })).data,
    enabled: !!path,
    ...live,
  });
}

/**
 * Does query `key` fall under `prefix`? Like React Query's own prefix match, except the first
 * element is a URL path that also covers its sub-paths: ["/students"] matches ["/students", …]
 * and ["/students/5", …], so saving a student refreshes both the list and the open profile.
 */
export function underPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (partialMatchKey(key, prefix)) return true;
  const [head, ...rest] = prefix;
  const keyHead = key[0];
  // a sub-path has params of its own, so it only counts when the prefix is a bare path
  return rest.length === 0 && typeof head === "string" && typeof keyHead === "string" && keyHead.startsWith(`${head.replace(/\/$/, "")}/`);
}

/** Mutation that toasts success/failure and refreshes the given query prefixes (and their sub-paths). */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      if (opts.success) toast.success(opts.success);
      const keys = opts.invalidate ?? [];
      if (keys.length) qc.invalidateQueries({ predicate: (q) => keys.some((key) => underPrefix(q.queryKey, key)) });
      opts.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export const usePublicSettings = () => useGet<PublicSettings>("/settings/public");
export const useClasses = () => useList<SchoolClass>("/classes");
export const useSections = (classId?: string | number | null) =>
  useList<Section>(classId ? "/sections" : null, { class_id: classId });
export const useSubjects = (classId?: string | number | null, teacherId?: number) =>
  useList<Subject>(classId || teacherId ? "/subjects" : null, { class_id: classId || undefined, teacher_id: teacherId });
export const useExams = () => useList<Exam>("/exams");
