import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { api } from "./client";
import { useDebounced, usePagedList } from "./hooks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePagedList", () => {
  it("asks for one page at a time and goes back to the first page when the filters change", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { items: [], total: 120 } });
    const { result, rerender } = renderHook(({ status }) => usePagedList("/invoices", { status }, 50), {
      wrapper,
      initialProps: { status: "unpaid" },
    });
    await waitFor(() => expect(result.current.data?.total).toBe(120));
    expect(get).toHaveBeenLastCalledWith("/invoices", { params: { status: "unpaid", limit: 50, offset: 0 } });

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/invoices", { params: { status: "unpaid", limit: 50, offset: 100 } }));

    rerender({ status: "paid" });
    expect(result.current.page).toBe(0);
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/invoices", { params: { status: "paid", limit: 50, offset: 0 } }));
    // the page-2 request is never repeated with the new filter
    expect(get).not.toHaveBeenCalledWith("/invoices", { params: { status: "paid", limit: 50, offset: 100 } });
  });

  it("does nothing without a path", () => {
    const get = vi.spyOn(api, "get");
    renderHook(() => usePagedList(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useDebounced", () => {
  it("only reports the value once it stops changing", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ v }) => useDebounced(v, 300), { initialProps: { v: "a" } });
      rerender({ v: "ab" });
      rerender({ v: "abc" });
      expect(result.current).toBe("a");
      act(() => vi.advanceTimersByTime(300));
      expect(result.current).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });
});
