import { useEffect } from "react";

/**
 * Polls while the tab is visible so the dashboard reflects new checks without
 * a manual reload. Hidden tabs skip ticks; deletions are cheap either way.
 */
export function useAutoRefresh(
  callback: () => void | Promise<unknown>,
  intervalMs = 60_000,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void callback();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [callback, intervalMs, enabled]);
}
