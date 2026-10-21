import { useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  ClipboardList,
  Gauge,
  SquareActivity,
  TriangleAlert,
} from "lucide-react";
import { Reveal } from "@/components/uptime/Reveal";

const DWELL_MS = 7000;

/**
 * Demo readings, always shown under the "valeurs de démonstration" chip. The
 * verdict is written in the exact shape `verdictOf()` produces on the real
 * page, so the preview cannot promise a sentence the product never renders.
 */
const reads = [
  {
    id: "verdict",
    icon: SquareActivity,
    title: "Une phrase de verdict",
    text: "Une seule ligne, sans jargon, qui dit si tout va bien ou ce qui coince — construite uniquement sur les agrégats déjà mesurés.",
  },
  {
    id: "problems",
    icon: ClipboardList,
    title: "La liste des problèmes",
    text: "Chaque anomalie avec son heure, sa durée, son statut au déclenchement et l’erreur mesurée. Jamais de cause inventée.",
  },
  {
    id: "graph",
    icon: Gauge,
    title: "Le graphe des erreurs",
    text: "Disponibilité par jour, latences et répartition des erreurs sur 90 jours : on voit l’origine du problème, pas seulement sa présence.",
  },
] as const;

/**
 * Severity is carried by a dot and a tint, never by small coloured text: state
 * colours on a five-percent tint of themselves fall under AA at 10px.
 */
const problems = [
  {
    severity: "Majeur",
    row: "border-state-down/25 bg-state-down/5",
    accent: "text-state-down",
    dot: "bg-state-down",
    icon: TriangleAlert,
    title: "auth.exemple.com ne répondait pas",
    detail:
      "22:41 → 22:55 · DOWN 14 min · timeout après 10 000 ms · incident confirmé après 3 échecs",
  },
  {
    severity: "Partiel",
    row: "border-state-warn/25 bg-state-warn/5",
    accent: "text-state-warn",
    dot: "bg-state-warn",
    icon: TriangleAlert,
    title: "cdn.exemple.net en échecs partiels",
    detail: "07:15 → 07:35 · 4 checks sur 8 en HTTP 503 · p95 mesuré 1,82 s",
  },
  {
    severity: "À surveiller",
    row: "border-line bg-page",
    accent: "text-ink-soft",
    dot: "bg-ink-soft",
    icon: CircleCheck,
    title: "Certificat TLS de api.exemple.com",
    detail:
      "Expire dans 71 jours · émetteur Let’s Encrypt · aucun impact mesuré",
  },
];

const errorSplit = [
  { label: "Timeout", value: 62, color: "bg-state-down" },
  { label: "HTTP 5xx", value: 24, color: "bg-state-warn" },
  { label: "Résolution DNS", value: 9, color: "bg-brand" },
  { label: "Autre", value: 5, color: "bg-ink-muted" },
];

const DOWN_DAYS = new Set([21, 58]);
const WARN_DAYS = new Set([34, 71, 72]);

function dayTone(index: number) {
  if (DOWN_DAYS.has(index)) return "bg-state-down";
  if (WARN_DAYS.has(index)) return "bg-state-warn";
  return "bg-state-up/80";
}

function useTiltFrame() {
  const ref = useRef<HTMLDivElement>(null);

  // Written straight to custom properties: re-rendering React on every pointer
  // move would cost more than the effect it drives.
  function track(event: React.PointerEvent<HTMLDivElement>) {
    const frame = ref.current;
    if (!frame || event.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = frame.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    frame.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    frame.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    frame.style.setProperty("--tilt-y", `${((x - 0.5) * 5).toFixed(2)}deg`);
    frame.style.setProperty("--tilt-x", `${((0.5 - y) * 3.5).toFixed(2)}deg`);
  }

  function release() {
    ref.current?.style.removeProperty("--tilt-x");
    ref.current?.style.removeProperty("--tilt-y");
  }

  return { ref, track, release };
}

function VerdictPanel() {
  return (
    <div key="verdict" className="animate-rise">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-state-up" />
        </span>
        Verdict
      </p>
      <p className="mt-3 text-xl leading-[1.35] font-semibold tracking-tight text-ink sm:text-[1.6rem]">
        Tout répond{" "}
        <span className="text-ink-soft">— 3 services contrôlés.</span>{" "}
        Disponibilité{" "}
        <span className="metric text-ink underline decoration-brand-glow decoration-2 underline-offset-4">
          99,86 %
        </span>{" "}
        sur <span className="metric">90 jours</span> (
        <span className="metric">8 621 mesures</span>), pire temps de réponse
        observé <span className="metric">412 ms</span>.
      </p>
      <p className="mt-4 text-xs text-ink-soft">
        Aucun incident confirmé en cours · dernier check il y a 42 s
      </p>
      <svg
        className="mt-5 h-10 w-full text-brand-glow/60"
        viewBox="0 0 320 40"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          className="ecg-line"
          d="M0 28h48l10-16 12 26 11-14h58l9-9 12 22 10-13h72l9-11 12 24 10-15h75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ProblemsPanel() {
  return (
    <div key="problems" className="animate-rise">
      <p className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
        <span>Problèmes rencontrés</span>
        <span className="metric normal-case tracking-normal text-ink-soft">
          3 relevés sur 90 jours
        </span>
      </p>
      <ul className="mt-3 space-y-2.5">
        {problems.map((problem, index) => (
          <li
            key={problem.title}
            className={`animate-rise rounded-xl border px-4 py-3 ${problem.row}`}
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              <problem.icon
                className={`h-4 w-4 shrink-0 ${problem.accent}`}
                aria-hidden="true"
              />
              {problem.title}
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${problem.dot}`}
                  aria-hidden="true"
                />
                {problem.severity}
              </span>
            </p>
            <p className="metric mt-1.5 text-[11px] leading-5 text-ink-soft">
              {problem.detail}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-5 text-ink-soft">
        La ligne cite l’erreur réellement mesurée. Elle n’annonce ni cause, ni
        date de correction, ni version.
      </p>
    </div>
  );
}

function GraphPanel() {
  return (
    <div key="graph" className="animate-rise">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
        90 derniers jours
      </p>
      <div
        className="mt-2 flex h-9 items-stretch gap-[2px]"
        role="img"
        aria-label="Historique d’uptime de démonstration sur 90 jours : 99,86 % d’uptime, deux jours en majorité d’échecs et trois jours en échecs partiels."
      >
        {Array.from({ length: 90 }).map((_, index) => (
          <span
            key={index}
            className={`uptime-bar min-w-0 flex-1 rounded-sm ${dayTone(index)}`}
            style={{ animationDelay: `${index * 7}ms` }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-soft">
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm bg-state-up/80"
            aria-hidden="true"
          />
          Sans échec
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm bg-state-warn"
            aria-hidden="true"
          />
          Échecs partiels
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm bg-state-down"
            aria-hidden="true"
          />
          Majorité d’échecs
        </li>
      </ul>

      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
        Répartition des erreurs
      </p>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-2">
        {errorSplit.map((slice, index) => (
          <span
            key={slice.label}
            style={{
              width: `${slice.value}%`,
              animationDelay: `${index * 80}ms`,
            }}
            className={`analysis-segment ${slice.color}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        {errorSplit.map(slice => (
          <li
            key={slice.label}
            className="rounded-lg border border-line bg-page px-2.5 py-1.5"
          >
            <span className="flex items-center gap-1.5 text-ink-soft">
              <span
                className={`h-2 w-2 rounded-full ${slice.color}`}
                aria-hidden="true"
              />
              {slice.label}
            </span>
            <p className="metric mt-0.5 text-sm font-semibold text-ink">
              {slice.value} %
            </p>
          </li>
        ))}
      </ul>

      <dl className="metric mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { term: "p50", value: "94 ms" },
          { term: "p95", value: "412 ms" },
          { term: "checks", value: "8 621" },
        ].map(stat => (
          <div
            key={stat.term}
            className="rounded-xl border border-line bg-page px-2 py-2"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              {stat.term}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const panels = [VerdictPanel, ProblemsPanel, GraphPanel];

/**
 * Marketing showcase for `/status/:slug`. The reader rail drives the framed
 * preview; the cycle pauses on hover, on keyboard focus and under
 * `prefers-reduced-motion`, where the first panel stays put.
 */
export function ClientReadsShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const { ref, track, release } = useTiltFrame();

  // A listener, not a one-off read: someone who flips the OS preference while
  // the page is open must not keep watching panels rotate.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (paused || reduced) return;
    const timer = window.setInterval(
      () => setActive(index => (index + 1) % reads.length),
      DWELL_MS
    );
    return () => window.clearInterval(timer);
  }, [paused, reduced]);

  const ActivePanel = panels[active];

  return (
    <section
      id="lecture-client"
      aria-labelledby="reads-heading"
      className="relative overflow-hidden border-y border-line bg-surface-2/50"
    >
      <div
        className="halftone pointer-events-none absolute -left-10 top-1/3 h-64 w-2/5 opacity-50"
        aria-hidden="true"
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-14 lg:py-24">
        <div>
          <Reveal>
            <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand-glow"
                aria-hidden="true"
              />
              La page que vous partagez
            </p>
            <h2
              id="reads-heading"
              className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl"
            >
              Ce qu’un client voit,
              <span className="hollow-ink mt-1 block">
                sans compte ni effort.
              </span>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-soft">
              À la place d’une équipe qui reteste le site à la main : une page
              publique, ouverte en deux secondes, qui répond aux trois questions
              de tout le monde.
            </p>
          </Reveal>

          <div
            role="tablist"
            aria-label="Ce que lit un client sur la page publique"
            className="mt-9 space-y-2.5"
            onMouseLeave={() => setPaused(false)}
            onPointerEnter={() => setPaused(true)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            {reads.map((item, index) => {
              const selected = index === active;
              return (
                <button
                  key={item.id}
                  id={`read-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="client-reads-preview"
                  onClick={() => setActive(index)}
                  className={`group relative flex w-full min-h-12 cursor-pointer items-start gap-4 overflow-hidden rounded-2xl border px-5 py-4 text-left transition duration-300 ${
                    selected
                      ? "border-ink/15 bg-surface shadow-glow"
                      : "border-line bg-transparent hover:border-ink/15 hover:bg-surface/70"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition duration-300 ${
                      selected
                        ? "border-transparent bg-brand text-page"
                        : "border-line bg-page text-ink-soft group-hover:text-ink"
                    }`}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="metric text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-base font-semibold tracking-tight text-ink">
                        {item.title}
                      </span>
                    </span>
                    <span
                      className={`mt-1 block text-sm leading-relaxed transition-colors ${
                        selected ? "text-ink-soft" : "text-ink-muted"
                      }`}
                    >
                      {item.text}
                    </span>
                  </span>
                  {selected && !paused && !reduced && (
                    <span
                      key={`progress-${active}`}
                      className="rail-progress absolute inset-x-0 bottom-0 h-[2px] bg-brand-glow"
                      style={{ animationDuration: `${DWELL_MS}ms` }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Reveal direction="right" className="lg:pt-4">
          <div className="relative [perspective:1400px]">
            <div
              ref={ref}
              onPointerMove={track}
              onPointerLeave={release}
              id="client-reads-preview"
              role="tabpanel"
              aria-labelledby={`read-${reads[active].id}`}
              className="spotlight tilt-frame relative overflow-hidden rounded-2xl border border-line bg-surface shadow-strong"
            >
              <div className="flex items-center gap-3 border-b border-line bg-page/70 px-4 py-3">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-glow/70" />
                </span>
                <p className="metric min-w-0 flex-1 truncate rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-ink-soft">
                  /status/votre-site
                </p>
                <p className="hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft sm:block">
                  valeurs de démonstration
                </p>
              </div>
              <div className="relative p-5 sm:p-6">
                <ActivePanel />
                <div
                  className="animate-sheen pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                  aria-hidden="true"
                />
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-ink-soft">
              Aperçu de la page publique réelle&nbsp;: mêmes composants, mêmes
              libellés. Les chiffres ci-dessus sont des valeurs de
              démonstration.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
