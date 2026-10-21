import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

/** Shown while a page is fetching its first payload. */
export function FullLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-sm text-ink-muted">
      <div className="flex items-center gap-3">
        <Loader2
          className="h-4 w-4 animate-spin text-brand-glow"
          aria-hidden="true"
        />
        <span role="status">{label}</span>
      </div>
    </div>
  );
}

/**
 * Terminal error state with a retry affordance. Previously a non-401 failure
 * left `loading` false while the data stayed null, so the guard re-rendered the
 * spinner forever and the user had no way forward.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-5">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-state-down/30 bg-surface p-6 text-center shadow-soft"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-state-down/10 text-state-down">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}
