import { useEffect, useRef } from "react";

/**
 * Hero diagram: a central hub wired to six labelled probes, mirroring the
 * reference's "customer / code / bug / ticket" circuit — but telling our story:
 * the signal path of an uptime check, from DNS to the public status page.
 *
 * Geometry lives in a 100×56 user-space (wide, like the reference strip) while
 * strokes stay 1px on screen via `non-scaling-stroke`, so the wires never grow
 * into bars when the SVG scales up. Label pills are real HTML laid over the
 * wires with an opaque background, which is exactly how the reference embeds
 * its chips: the line visually passes behind them.
 *
 * Wires draw once on mount (stroke-dashoffset) and respect reduced motion.
 */
interface Probe {
  id: string;
  label: string;
  /** Pill centre, in viewBox units. */
  labelX: number;
  labelY: number;
  /** Wire origin (the dot at the outer end), in viewBox units. */
  dotX: number;
  dotY: number;
  /** Orthogonal wire from the dot to the hub ring. */
  d: string;
}

const HUB = { cx: 50, cy: 28, r: 11 };
/** Ring intersections computed from HUB: y=22/34 → x≈40.8/59.2, y=37 → x≈43.7/56.3. */
const probes: Probe[] = [
  {
    id: "dns",
    label: "DNS",
    labelX: 13,
    labelY: 10,
    dotX: 4,
    dotY: 10,
    d: "M4,10 H24 V22 H40.8",
  },
  {
    id: "http",
    label: "HTTP",
    labelX: 13,
    labelY: 46,
    dotX: 4,
    dotY: 46,
    d: "M4,46 H24 V34 H40.8",
  },
  {
    id: "tls",
    label: "TLS",
    labelX: 87,
    labelY: 10,
    dotX: 96,
    dotY: 10,
    d: "M96,10 H76 V22 H59.2",
  },
  {
    id: "latency",
    label: "LATENCE",
    labelX: 87,
    labelY: 46,
    dotX: 96,
    dotY: 46,
    d: "M96,46 H76 V34 H59.2",
  },
  {
    id: "incident",
    label: "INCIDENT",
    labelX: 36,
    labelY: 54,
    dotX: 28,
    dotY: 54,
    d: "M28,54 H43.7 V37",
  },
  {
    id: "alert",
    label: "ALERTE",
    labelX: 64,
    labelY: 54,
    dotX: 72,
    dotY: 54,
    d: "M72,54 H56.3 V37",
  },
];

const VB_W = 100;
const VB_H = 56;

export function HeroCircuit() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Respect reduced motion: skip the draw-in entirely, wires render solid.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const svg = ref.current;
    if (!svg) return;
    const wires = svg.querySelectorAll<SVGPathElement>(".wire");
    // Wires use `non-scaling-stroke`, so dash lengths are measured in screen
    // pixels, not viewBox units: the user-space path length must be scaled by
    // the current px-per-unit ratio or every wire renders as a dotted line.
    const scale = svg.getBoundingClientRect().width / VB_W;
    wires.forEach((wire, index) => {
      const screenLength = wire.getTotalLength() * scale;
      wire.style.strokeDasharray = String(screenLength);
      wire.style.strokeDashoffset = String(screenLength);
      wire.style.animation = `wire-draw 800ms cubic-bezier(0.22, 0.61, 0.36, 1) ${180 + index * 90}ms forwards`;
      // Once drawn, drop the dash entirely: a dash length captured at mount
      // would no longer match the path after a viewport resize.
      wire.addEventListener(
        "animationend",
        () => {
          wire.style.removeProperty("stroke-dasharray");
          wire.style.removeProperty("stroke-dashoffset");
          wire.style.removeProperty("animation");
        },
        { once: true }
      );
    });
  }, []);

  return (
    <div
      role="img"
      aria-label="Chaîne de mesure UptimePulse : DNS, HTTP, TLS et latence sont relevés à chaque check ; un incident confirmé déclenche une alerte et se publie sur la page de statut."
      className="relative mx-auto w-full max-w-3xl"
    >
      <svg
        ref={ref}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full overflow-visible"
        aria-hidden="true"
      >
        {/* hub rings */}
        <circle
          cx={HUB.cx}
          cy={HUB.cy}
          r={HUB.r + 3.5}
          fill="none"
          stroke="var(--line)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={HUB.cx}
          cy={HUB.cy}
          r={HUB.r}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {/* wires: probe dot → hub ring */}
        {probes.map(probe => (
          <path
            key={probe.id}
            className="circuit-line wire"
            d={probe.d}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* dots at the outer end of each wire */}
        {probes.map(probe => (
          <circle
            key={`${probe.id}-node`}
            cx={probe.dotX}
            cy={probe.dotY}
            r="0.6"
            fill="var(--ink)"
          />
        ))}
      </svg>

      {/* Central hub sits above the SVG so it can use real markup */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-line bg-surface shadow-strong sm:h-20 sm:w-20">
          <span className="relative flex h-3 w-3" aria-hidden="true">
            <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-brand-glow" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-glow" />
          </span>
        </div>
      </div>

      {/* probe labels: opaque pills sitting on the wires */}
      <ul className="absolute inset-0">
        {probes.map(probe => (
          <li
            key={`${probe.id}-label`}
            className="absolute"
            style={{
              left: `${(probe.labelX / VB_W) * 100}%`,
              top: `${(probe.labelY / VB_H) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <span className="block whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-soft shadow-soft">
              {probe.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
