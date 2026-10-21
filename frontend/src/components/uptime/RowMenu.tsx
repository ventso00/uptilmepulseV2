import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export type RowAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

/**
 * Row action menu with the keyboard behaviour the previous inline `<div>`
 * lacked: `aria-expanded`/`aria-haspopup`, Escape to close, outside-click
 * dismissal, and focus returned to the trigger on close.
 */
export function RowMenu({
  label,
  actions,
}: {
  label: string;
  actions: RowAction[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function moveFocus(step: number) {
    const items = itemRefs.current.filter(Boolean);
    if (items.length === 0) return;
    const index = items.findIndex(item => item === document.activeElement);
    const next = (index + step + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(value => !value)}
        className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
          className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-line bg-surface p-1 shadow-medium"
        >
          {actions.map((action, index) => {
            const shared =
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs disabled:opacity-50";
            const tone =
              action.tone === "danger"
                ? "text-state-down hover:bg-state-down/10"
                : "text-ink-soft hover:bg-surface-2";
            return (
              <button
                key={action.label}
                role="menuitem"
                ref={element => {
                  itemRefs.current[index] = element as HTMLButtonElement;
                }}
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  action.onSelect();
                }}
                className={`${shared} ${tone}`}
              >
                {action.icon}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
