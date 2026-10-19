import { useRef, useState } from "react";
import { BellRing, Globe2, SquareActivity, TriangleAlert } from "lucide-react";
import { INCIDENT_RULES } from "@shared/contracts";

/**
 * Fixed sample values, never presented as live measurements: the card carries
 * an explicit "valeurs de démonstration" label.
 */
const checks = [
  { name: "api.exemple.com", status: "UP", latency: "182 ms" },
  { name: "site-exemple.com", status: "UP", latency: "94 ms" },
  { name: "auth.exemple.com", status: "DOWN", latency: "timeout" },
  { name: "cdn.exemple.net", status: "UP", latency: "311 ms" },
];

const phases = [
  { label: "DNS", value: 12, color: "bg-brand-glow" },
  { label: "TCP", value: 26, color: "bg-brand" },
  { label: "TLS", value: 41, color: "bg-brand-strong" },
  { label: "Serveur", value: 103, color: "bg-ink-muted" },
];

const tabs = [
  { id: "services", label: "Services", icon: SquareActivity },
  { id: "analyse", label: "Analyse", icon: Globe2 },
  { id: "regles", label: "Règles", icon: BellRing },
] as const;

type TabId = (typeof tabs)[number]["id"];

/**
 * Mirrors `decideIncidentTransition` on the server so the widget cannot drift
 * from the engine it illustrates. Only the reachable branches are shown.
 */
function verdict(failures: number, successes: number) {
  if (failures === 0 && successes === 0)
    return {
      state: "idle" as const,
      title: "Auc check simulé",
      text: "Faites glisser les compteurs pour voir exactement ce que le moteur déclenche — et ce qu'il ne déclenche pas.",
    };
  if (failures === 1)
    return {
      state: "suspect" as const,
      title: "Incident ouvert en statut suspect",
      text: "Un échec isolé n'est jamais une alerte : c'est ce qui empêche une panne de dix secondes de réveiller quelqu'un.",
    };
  if (failures === 2)
    return {
      state: "suspect" as const,
      title: "Toujours suspect",
      text: `Deux échecs consécutifs ne suffisent pas. La confirmation demande ${INCIDENT_RULES.failureThreshold} échecs.`,
    };
  if (successes >= INCIDENT_RULES.recoveryThreshold)
    return {
      state: "resolved" as const,
      title: "Incident résolu, rétablissement notifié",
      text: `${INCIDENT_RULES.recoveryThreshold} succès consécutifs referment le dossier et envoient la seconde notification.`,
    };
  if (failures >= INCIDENT_RULES.failureThreshold && successes > 0)
    return {
      state: "down" as const,
      title: "Incident confirmé, service DOWN",
      text: `Un succès ne suffit pas à refermer : le moteur en attend ${INCIDENT_RULES.recoveryThreshold}.`,
    };
  return {
    state: "down" as const,
    title: `Incident confirmé dès le ${INCIDENT_RULES.failureThreshold}ᵉ échec`,
    text: "Le service passe DOWN et l'alerte Telegram part à cette passe, pas avant.",
  };
}

function Counter({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  max: number;
}) {
  return (
    <div>
      <label
        htmlFor={`sim-${label}`}
        className="text-xs font-medium text-ink-soft"
      >
        {label}
      </label>
      <input
        id={`sim-${label}`}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-brand"
      />
      <output
        htmlFor={`sim-${label}`}
        className="metric mt-1 block text-sm font-semibold text-brand-strong"
      >
        {value}
      </output>
    </div>
  );
}

export function ProductPreview() {
  const [tab, setTab] = useState<TabId>("services");
  const [failures, setFailures] = useState(1);
  const [successes, setSuccesses] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const result = verdict(failures, successes);

  // Written straight to CSS custom properties: a pointermove that re-rendered
  // React would cost more than the animation it drives.
  function track(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const card = frameRef.current;
    if (!card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = card.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    card.style.setProperty("--tilt-y", `${((x - 0.5) * 7).toFixed(2)}deg`);
    card.style.setProperty("--tilt-x", `${((0.5 - y) * 5).toFixed(2)}deg`);
  }

  function release() {
    frameRef.current?.style.removeProperty("--tilt-x");
    frameRef.current?.style.removeProperty("--tilt-y");
  }

  return (
    <div className="relative [perspective:1400px]">
      <div
        ref={frameRef}
        onPointerMove={track}
        onPointerLeave={release}
        role="group"
        aria-label="Aperçu interactif du produit, valeurs de démonstration"
        className="spotlight tilt-frame relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-brand/10"
      >
        <div className="relative flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Aperçu du produit
          </p>
          <p className="text-[11px] text-ink-soft">valeurs de démonstration</p>
        </div>

        <div
          role="tablist"
          aria-label="Ce que montre l'aperçu"
          className="relative mt-3 flex gap-1 rounded-xl bg-surface-2 p-1"
        >
          {tabs.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition ${
                tab === item.id
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        {tab === "services" && (
          <div className="relative mt-4">
            <ul className="space-y-3">
              {checks.map((check, index) => (
                <li
                  key={check.name}
                  className="animate-rise flex items-center justify-between rounded-xl border border-line bg-page px-4 py-3"
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="relative flex h-2.5 w-2.5"
                      aria-hidden="true"
                    >
                      {check.status === "UP" && (
                        <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
                      )}
                      <span
                        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                          check.status === "UP"
                            ? "bg-state-up"
                            : "bg-state-down"
                        }`}
                      />
                    </span>
                    <span className="metric text-sm text-ink-soft">
                      {check.name}
                    </span>
                  </span>
                  <span
                    className={`metric text-xs font-semibold ${
                      check.status === "UP" ? "text-state-up" : "text-ink"
                    }`}
                  >
                    {check.status} · {check.latency}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-state-down/25 bg-state-down/5 px-4 py-3 text-xs leading-relaxed text-ink">
              <TriangleAlert
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-down"
                aria-hidden="true"
              />
              Incident confirmé — {INCIDENT_RULES.failureThreshold} échecs
              consécutifs (timeout). Alerte Telegram envoyée, puis notification
              de rétablissement.
            </p>
          </div>
        )}

        {tab === "analyse" && (
          <div className="relative mt-4">
            <p className="text-sm font-semibold text-ink">
              api.exemple.com · 182 ms
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Où part le temps, mesuré à chaque check.
            </p>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-2">
              {phases.map(phase => (
                <span
                  key={phase.label}
                  style={{ width: `${(phase.value / 182) * 100}%` }}
                  className={`analysis-segment ${phase.color}`}
                  aria-hidden="true"
                />
              ))}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {phases.map(phase => (
                <li
                  key={phase.label}
                  className="rounded-xl border border-line bg-page px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-xs text-ink-soft">
                    <span
                      className={`h-2 w-2 rounded-full ${phase.color}`}
                      aria-hidden="true"
                    />
                    {phase.label}
                  </span>
                  <p className="metric mt-1 text-sm font-semibold text-ink">
                    {phase.value} ms
                  </p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-brand/15 bg-brand/[0.04] px-3 py-2">
                <dt className="text-ink-soft">Certificat</dt>
                <dd className="metric mt-1 font-semibold text-ink">
                  Expiration dans 71 j
                </dd>
              </div>
              <div className="rounded-xl border border-brand/15 bg-brand/[0.04] px-3 py-2">
                <dt className="text-ink-soft">Réponse</dt>
                <dd className="metric mt-1 font-semibold text-ink">
                  200 · texte/html
                </dd>
              </div>
            </dl>
          </div>
        )}

        {tab === "regles" && (
          <div className="relative mt-4">
            <p className="text-sm font-semibold text-ink">
              Simulez une série de checks
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Counter
                label="Échecs consécutifs"
                value={failures}
                max={5}
                onChange={setFailures}
              />
              <Counter
                label="Succès consécutifs"
                value={successes}
                max={3}
                onChange={setSuccesses}
              />
            </div>
            <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
              {Array.from({ length: failures }).map((_, index) => (
                <span
                  key={`f-${index}`}
                  className="h-6 flex-1 rounded-md bg-state-down/70"
                />
              ))}
              {Array.from({ length: successes }).map((_, index) => (
                <span
                  key={`s-${index}`}
                  className="h-6 flex-1 rounded-md bg-state-up/70"
                />
              ))}
              {failures + successes === 0 && (
                <span className="h-6 flex-1 rounded-md bg-surface-2" />
              )}
            </div>
            <p
              role="status"
              className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-xs leading-relaxed text-ink ${
                result.state === "down"
                  ? "border-state-down/25 bg-state-down/5"
                  : result.state === "resolved"
                    ? "border-state-up/25 bg-state-up/5"
                    : result.state === "suspect"
                      ? "border-state-warn/25 bg-state-warn/5"
                      : "border-line bg-page"
              }`}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  result.state === "down"
                    ? "bg-state-down"
                    : result.state === "resolved"
                      ? "bg-state-up"
                      : result.state === "suspect"
                        ? "bg-state-warn"
                        : "bg-line-strong"
                }`}
                aria-hidden="true"
              />
              <span>
                <span className="font-semibold">{result.title}.</span>{" "}
                {result.text}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
