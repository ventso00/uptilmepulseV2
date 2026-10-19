import { useEffect, useId, useRef } from "react";
import { Modal } from "./Modal";

/**
 * Explicit confirmation for destructive actions. Replaces `window.confirm`,
 * which is a blocking native dialog that cannot be styled, localised
 * consistently, or exercised in tests.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <Modal title={title} onClose={onCancel}>
      <p id={descriptionId} className="mt-3 text-sm leading-6 text-ink-muted">
        {description}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-full px-4 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          Annuler
        </button>
        <button
          ref={confirmRef}
          onClick={onConfirm}
          className="rounded-full bg-state-down px-4 py-2.5 text-sm font-semibold text-white hover:bg-state-down/90"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
