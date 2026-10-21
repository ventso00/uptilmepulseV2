import { useState } from "react";
import {
  ArrowUp,
  BadgeCheck,
  FileClock,
  Gauge,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { INCIDENT_RULES } from "@shared/contracts";

/**
 * Four readings from one check, fanned in depth. Every field here exists in
 * `ping_logs` or on the certificate the checker keeps: status code, per-phase
 * timings, keyword verdict, issuer/subject/expiry. The numbers themselves are
 * samples and the card says so — the page has no measurements of its own.
 */
const phases = [
  { label: "DNS", ms: 12 },
  { label: "TCP", ms: 26 },
  { label: "TLS", ms: 41 },
  { label: "TTFB", ms: 182 },
];
const TOTAL_MS = 182;

type CardId = "latence" | "http" | "incident" | "certificat";

const cards: Array<{
  id: CardId;
  title: string;
  surface: string;
  /** Arc offset from the grid track, in pixels and degrees. */
  dx: number;
  dy: number;
  dz: number;
  ry: number;
  z: number;
}> = [
  {
    id: "latence",
    title: "Latence, phase par phase",
    surface: "border-line bg-surface",
    dx: -6,
    dy: 16,
    dz: -60,
    ry: 15,
    z: 22,
  },
  {
    id: "http",
    title: "Réponse HTTP complète",
    surface: "border-line bg-surface",
    dx: -2,
    dy: -8,
    dz: 15,
    ry: 5,
    z: 28,
  },
  {
    id: "incident",
    title: "Incident prouvé",
    surface: "border-brand-glow/60 bg-brand-glow",
    dx: 2,
    dy: -4,
    dz: 30,
    ry: -5,
    z: 27,
  },
  {
    id: "certificat",
    title: "Certificat TLS",
    surface: "border-ink bg-ink",
    dx: 6,
    dy: 18,
    dz: -55,
    ry: -15,
    z: 22,
  },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="metric text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Face({ id }: { id: CardId }) {
  if (id === "latence") {
    return (
      <div>
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
          Latence
        </p>
        <ul className="mt-4 space-y-2.5">
          {phases.map(phase => (
            <li key={phase.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                  {phase.label}
                </span>
                <span className="metric text-xs font-semibold text-ink">
                  {phase.ms} ms
                </span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"
                aria-hidden="true"
              >
                <span
                  className="analysis-segment block h-full rounded-full bg-brand-glow"
                  style={{ width: `${(phase.ms / TOTAL_MS) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-soft">
          Serveur dérivé&nbsp;: TTFB − DNS − TCP − TLS ={" "}
          <span className="metric font-semibold text-ink">103 ms</span>
        </p>
      </div>
    );
  }

  if (id === "http") {
    return (
      <div>
        <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Réponse HTTP
        </p>
        <p className="metric mt-3 flex items-baseline gap-2 text-3xl font-bold tracking-tight text-ink">
          200
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-state-up">
            UP_HTTP_2XX
          </span>
        </p>
        <dl className="mt-4 space-y-2">
          <Row label="Redirections suivies" value="1 sur 3 max" />
          <Row label="Mot-clé attendu" value="« OK » trouvé" />
          <Row label="Latence totale" value="182 ms" />
          <Row label="Check horodaté" value="22:41:07 UTC" />
        </dl>
      </div>
    );
  }

  if (id === "incident") {
    return (
      <div className="text-ink">
        <p className="flex items-center justify-between gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
          Incident prouvé
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        </p>
        <p className="metric mt-3 text-2xl font-bold leading-tight tracking-tight">
          22:41 → 22:55
        </p>
        <p className="metric mt-1 text-sm font-semibold">DOWN 14 min</p>
        <ul className="mt-4 space-y-1.5 text-xs leading-relaxed">
          <li>
            Confirmé après {INCIDENT_RULES.failureThreshold} échecs consécutifs
          </li>
          <li>Résolu après {INCIDENT_RULES.recoveryThreshold} succès</li>
          <li>Erreur mesurée&nbsp;: timeout après 10 000 ms</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="text-page">
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-page/80">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Certificat TLS
      </p>
      <p className="metric mt-3 flex items-baseline gap-2 text-2xl font-bold tracking-tight">
        71
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-page/80">
          jours restants
        </span>
      </p>
      <dl className="mt-4 space-y-2 text-xs">
        <div>
          <dt className="text-page/70">Émetteur</dt>
          <dd className="metric mt-0.5 font-semibold">
            R12 · Let&apos;s Encrypt
          </dd>
        </div>
        <div>
          <dt className="text-page/70">Sujet</dt>
          <dd className="metric mt-0.5 font-semibold">api.exemple.com</dd>
        </div>
        <div>
          <dt className="text-page/70">Échéance</dt>
          <dd className="metric mt-0.5 font-semibold">26 déc. 2026</dd>
        </div>
      </dl>
      <p className="mt-4 flex items-center gap-1.5 border-t border-page/15 pt-3 text-[11px] text-page/75">
        <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
        Compteur recalculé à chaque check HTTPS
      </p>
    </div>
  );
}

/**
 * Hover, focus and tap all lift a card — the spread is emphasis, never the only
 * way to read a value, so the deck works on touch and with a keyboard. Below
 * 64rem the cards simply stack.
 */
export function HeroDeck() {
  const [lifted, setLifted] = useState<number | null>(null);

  function place(index: number) {
    const card = cards[index];
    const isLifted = lifted === index;
    const spread = lifted === null || isLifted ? 0 : 18;
    return {
      "--dx": `${card.dx + Math.sign(card.dx) * spread}px`,
      "--dy": `${card.dy + (isLifted ? -18 : 0)}px`,
      "--dz": `${card.dz + (isLifted ? 150 : lifted === null ? 0 : -40)}px`,
      "--ry": `${isLifted ? 0 : card.ry}deg`,
      "--sc": isLifted ? 1.04 : 1,
      zIndex: isLifted ? 40 : card.z,
    } as React.CSSProperties;
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
          Un check, quatre relevés
        </p>
        <p className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft">
          valeurs de démonstration
        </p>
      </div>

      <div
        className="deck-scene mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        onPointerLeave={() => setLifted(null)}
      >
        {cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            aria-pressed={lifted === index}
            onPointerEnter={() => setLifted(index)}
            onFocus={() => setLifted(index)}
            onClick={() =>
              setLifted(current => (current === index ? null : index))
            }
            style={place(index)}
            className={`deck-card rounded-2xl border p-5 text-left shadow-deck focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-glow ${card.surface}`}
          >
            <span
              className="deck-float block"
              style={{ animationDelay: `${index * 700}ms` }}
            >
              <p className="sr-only">{card.title}</p>
              <Face id={card.id} />
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <a
          href="#lecture-client"
          className="group inline-flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 shadow-soft transition hover:border-ink/25 hover:text-ink"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-page transition-transform duration-300 group-hover:rotate-180 motion-reduce:transition-none motion-reduce:group-hover:rotate-0">
            <ArrowUp className="h-4 w-4 text-ink" aria-hidden="true" />
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Statut public · 90 jours
          </span>
        </a>
      </div>
    </div>
  );
}
