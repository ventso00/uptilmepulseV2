import { useState } from "react";
import { ArrowRight, CircleCheck, CircleX, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DiagnosticResult } from "@shared/contracts";

const PHASES = [
  { key: "dnsMs", label: "DNS" },
  { key: "tcpMs", label: "TCP" },
  { key: "tlsMs", label: "TLS" },
  { key: "ttfbMs", label: "TTFB" },
] as const;

function milliseconds(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

/**
 * The only measurement the landing page can actually make: one anonymous probe
 * through the same checker a monitor uses. Everything else on this page is a
 * sample the page says is a sample; this row is not.
 */
export function HeroProbe() {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !url.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.diagnose(url.trim()));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cette mesure a échoué."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto mt-8 max-w-xl text-left"
      aria-labelledby="probe-heading"
    >
      <label
        id="probe-heading"
        htmlFor="probe-url"
        className="block font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft"
      >
        Tester une URL tout de suite
      </label>
      <div className="mt-2.5 flex gap-2">
        <input
          id="probe-url"
          type="url"
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://votre-site.fr"
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-sm text-ink shadow-soft outline-none transition placeholder:text-ink-soft/60 focus:border-ink/30"
        />
        <button
          type="submit"
          disabled={pending || !url.trim()}
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-page transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? "Mesure…" : "Mesurer"}
        </button>
      </div>

      <div aria-live="polite" className="mt-3">
        {error && (
          <p className="flex items-start gap-2 text-sm text-state-down">
            <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {!error && !result && !pending && (
          <p className="text-sm text-ink-soft">
            Une seule mesure, à la volée, par le même moteur que les checks
            planifiés. Rien n'est enregistré et aucun compte n'est nécessaire.
          </p>
        )}

        {result && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {result.isUp ? (
                <CircleCheck
                  className="h-4 w-4 text-state-up"
                  aria-hidden="true"
                />
              ) : (
                <CircleX
                  className="h-4 w-4 text-state-down"
                  aria-hidden="true"
                />
              )}
              <span className={result.isUp ? "text-state-up" : "text-state-down"}>
                {result.isUp ? "Répond" : "Ne répond pas"}
              </span>
              <span className="metric font-mono text-xs text-ink-soft">
                {result.statusCode ?? "—"} · {milliseconds(result.responseTimeMs)}
              </span>
            </p>

            <dl className="metric mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-4">
              {PHASES.map(phase => (
                <div key={phase.key} className="flex justify-between gap-2">
                  <dt className="text-ink-soft uppercase">{phase.label}</dt>
                  <dd className="text-ink">
                    {milliseconds(result.phases?.[phase.key] ?? null)}
                  </dd>
                </div>
              ))}
            </dl>

            {result.certificate && (
              <p className="mt-3 font-mono text-xs text-ink-soft">
                TLS {result.certificate.issuer} · expire{" "}
                {result.certificate.validTo
                  ? new Intl.DateTimeFormat("fr-FR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(result.certificate.validTo))
                  : "—"}
              </p>
            )}

            {!result.isUp && (result.errorMessage || result.classification) && (
              <p className="mt-3 text-xs text-ink-soft">
                Erreur mesurée&nbsp;: {result.errorMessage ?? result.classification}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
