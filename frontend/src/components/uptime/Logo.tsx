/**
 * Inline logo. The previous implementation loaded a WebP from a remote Manus
 * storage URL with `alt=""`, so the brand was invisible to screen readers and
 * the app depended on an external asset at runtime. The mark follows the
 * "pulse" direction recorded in ideas.md: an ECG trace on a rounded tile.
 *
 * Colours run through the design tokens (`--logo-tile` / `--logo-mark`) so the
 * same component reads correctly on the cream light regime — ink tile, vermillion
 * pulse — and inverts cleanly if the dark regime is ever re-enabled.
 */
export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="UptimePulse"
      focusable="false"
    >
      <rect width="40" height="40" rx="10" fill="var(--logo-tile, #141414)" />
      <path
        d="M8 22h5l3-8 5 14 4-11 2.5 5H32"
        fill="none"
        stroke="var(--logo-mark, #e8503a)"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoWordmark({
  className = "h-9 w-9",
}: {
  className?: string;
}) {
  return (
    <span className="flex items-center gap-3">
      <Logo className={className} />
      <span className="font-semibold tracking-tight text-ink">
        Uptime<span className="text-brand-glow">Pulse</span>
      </span>
    </span>
  );
}
