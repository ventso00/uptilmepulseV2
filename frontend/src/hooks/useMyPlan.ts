import { useCallback, useEffect, useState } from "react";
import { api, type MyPlanResponse } from "@/lib/api";

/**
 * The plan drives quota copy and which fields the monitor form offers, so every
 * surface reads the same value. One request per mount: the shell and the
 * dashboard ask at the same moment and must not pay twice.
 */
let cached: MyPlanResponse | null = null;

export function useMyPlan() {
  const [plan, setPlan] = useState<MyPlanResponse | null>(cached);

  const load = useCallback(async (force = false) => {
    if (cached && !force) {
      setPlan(cached);
      return;
    }
    try {
      const next = await api.myPlan();
      cached = next;
      setPlan(next);
    } catch {
      // Quota enforcement lives server-side; a stale or absent card is not a
      // reason to block the rest of the interface.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { plan, refresh: () => load(true) };
}
