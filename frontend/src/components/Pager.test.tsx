import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Pager } from "./Pager";

describe("Pager", () => {
  it("is hidden when everything fits on one page", () => {
    const { container } = render(<Pager page={0} pageSize={50} total={50} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the range and moves between pages", () => {
    const onPage = vi.fn();
    render(<Pager page={1} pageSize={50} total={120} onPage={onPage} />);
    expect(screen.getByText(/51–100/)).toBeInTheDocument();
    expect(screen.getByText(/of 120/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage.mock.calls).toEqual([[0], [2]]);
  });

  it("disables the buttons at either end", () => {
    const { rerender } = render(<Pager page={0} pageSize={50} total={120} onPage={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    rerender(<Pager page={2} pageSize={50} total={120} onPage={() => {}} />);
    expect(screen.getByText(/101–120/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
