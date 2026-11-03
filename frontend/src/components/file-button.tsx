import { useRef, type ReactElement } from "react";

/** Opens a file chooser from any button. Mirrors Mantine's FileButton render-prop API. */
export function FileButton({
  onChange,
  accept,
  multiple,
  children,
}: {
  onChange: (file: File | null) => void;
  accept?: string;
  multiple?: false;
  children: (props: { onClick: () => void }) => ReactElement;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onChange(e.currentTarget.files?.[0] ?? null);
          e.currentTarget.value = "";
        }}
      />
      {children({ onClick: () => ref.current?.click() })}
    </>
  );
}
