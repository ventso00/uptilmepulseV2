import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowUp,
  Check,
  Github,
  Globe2,
  Mail,
  TriangleAlert,
} from "lucide-react";
import { Logo } from "@/components/uptime/Logo";

/**
 * Closing plate, in the register of the hero it mirrors: near-black band, one
 * giant outlined wordmark cropped by the page edge, then the only destinations
 * this site actually has. Nothing here links to a page that does not exist —
 * there is no blog, docs or legal route, so no column pretends otherwise.
 */
const author = {
  handle: "ventso00",
  github: "https://github.com/ventso00",
  portfolio: "https://ventso.netlify.app/",
  email: "rajaomanjatoventso@gmail.com",
};

const columns: Array<{
  title: string;
  links: Array<{ label: string; href: string; hash?: boolean }>;
}> = [
  {
    title: "Produit",
    links: [
      { label: "Connexion", href: "/login" },
      { label: "Ouvrir un espace", href: "/register" },
      { label: "Tableau de bord", href: "/dashboard" },
    ],
  },
  {
    title: "La méthode",
    links: [
      { label: "Comment ça marche", href: "#how-heading", hash: true },
      { label: "Les vérifications", href: "#verifications", hash: true },
      { label: "Ce que lit un client", href: "#lecture-client", hash: true },
      { label: "Formules", href: "#formules", hash: true },
    ],
  },
  {
    title: "L’auteur",
    links: [
      { label: "GitHub", href: author.github },
      { label: "Portfolio", href: author.portfolio },
      { label: "Écrire un message", href: `mailto:${author.email}` },
    ],
  },
];

type Probe = "checking" | "up" | "degraded" | "down";

function EntryProbe() {
  const [probe, setProbe] = useState<Probe>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    fetch("/api/health", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          if (alive) setProbe("down");
          return;
        }
        // A 200 alone proves the process answers; the payload says whether it
        // can actually store anything.
        const body = (await response.json()) as { database?: string };
        if (alive) setProbe(body.database === "ready" ? "up" : "degraded");
      })
      .catch(() => {
        if (alive) setProbe("down");
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const label =
    probe === "up"
      ? "Point d’entrée : opérationnel"
      : probe === "degraded"
        ? "Point d’entrée : sans base de données"
        : probe === "down"
          ? "Point d’entrée injoignable"
          : "Sonde du point d’entrée…";

  return (
    <div className="mt-6">
      <p
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] ${
          probe === "down"
            ? "border-state-down/40 bg-state-down/10 text-page"
            : probe === "degraded"
              ? "border-state-warn/40 bg-state-warn/10 text-page"
              : "border-page/15 bg-page/5 text-page/80"
        }`}
      >
        {probe === "down" ? (
          <TriangleAlert
            className="h-3.5 w-3.5 shrink-0 text-state-down"
            aria-hidden="true"
          />
        ) : probe === "degraded" ? (
          <TriangleAlert
            className="h-3.5 w-3.5 shrink-0 text-state-warn"
            aria-hidden="true"
          />
        ) : (
          <span
            className="relative flex h-1.5 w-1.5 shrink-0"
            aria-hidden="true"
          >
            {probe === "up" && (
              <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                probe === "up" ? "bg-state-up" : "bg-page/40"
              }`}
            />
          </span>
        )}
        {label}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-page/55">
        Sonde <code className="font-mono">/api/health</code> de ce service — pas
        l’état des sites surveillés par ses clients.
      </p>
    </div>
  );
}

function SocialTile({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-page/15 text-page/70 transition duration-300 hover:border-page/40 hover:bg-page/10 hover:text-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-page/60"
    >
      {children}
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink text-page">
      {/* Giant outlined wordmark, cropped by the bottom edge like a plate mark.
          Decorative: the accessible name is the <footer> landmark itself. */}
      <div
        className="overflow-hidden border-b border-page/10 px-4 pt-10 sm:px-6"
        aria-hidden="true"
      >
        <p
          className="hollow-ink mx-auto -mb-[0.09em] block w-fit font-display text-[clamp(2.75rem,13.5vw,9.5rem)] font-bold uppercase leading-[0.72] tracking-[-0.05em] select-none"
          style={{
            ["--hollow-stroke" as string]: "rgb(244 243 238 / 0.26)",
            ["--hollow-stroke-width" as string]: "1.5px",
          }}
        >
          UptimePulse
        </p>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-x-10">
          <div>
            <span className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-page">
              <Logo className="h-7 w-7 shrink-0" />
              <span>
                Uptime<span className="text-page/60">Pulse</span>
              </span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-page/70">
              Signal clair sur vos services&nbsp;: des checks réellement
              horodatés, des incidents confirmés avant d’être annoncés, une page
              publique que vos clients ouvrent sans compte.
            </p>
            <EntryProbe />
            <div className="mt-6 flex items-center gap-2.5">
              <SocialTile href={author.github} label="GitHub de ventso00">
                <Github className="h-4 w-4" aria-hidden="true" />
              </SocialTile>
              <SocialTile href={author.portfolio} label="Portfolio de ventso00">
                <Globe2 className="h-4 w-4" aria-hidden="true" />
              </SocialTile>
              <SocialTile
                href={`mailto:${author.email}`}
                label="Écrire un message à l’auteur"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
              </SocialTile>
            </div>
          </div>

          {columns.map(column => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-page/55">
                {column.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map(link => (
                  <li key={link.label}>
                    {link.href.startsWith("/") && !link.hash ? (
                      <Link
                        href={link.href}
                        className="inline-flex min-h-6 items-center gap-1.5 text-sm text-page/80 transition hover:text-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-page/60"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        target={
                          link.href.startsWith("http") ? "_blank" : undefined
                        }
                        rel={
                          link.href.startsWith("http")
                            ? "noopener noreferrer"
                            : undefined
                        }
                        className="group inline-flex min-h-6 items-center gap-1.5 text-sm text-page/80 transition hover:text-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-page/60"
                      >
                        {link.label}
                        {link.href.startsWith("http") && (
                          <ArrowUp
                            className="h-3 w-3 -rotate-45 text-page/45 transition group-hover:text-page/80"
                            aria-hidden="true"
                          />
                        )}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-page/10 pt-6">
          <div className="flex flex-col gap-4 text-xs text-page/60 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} UptimePulse — exploité par{" "}
              <a
                href={author.github}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-page/25 underline-offset-2 transition hover:text-page hover:decoration-page/60"
              >
                {author.handle}
              </a>
              . Aucun traceur ni cookie de mesure d’audience.
            </p>
            <button
              type="button"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                  ).matches
                    ? "auto"
                    : "smooth",
                })
              }
              className="group inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-page/15 py-1.5 pr-4 pl-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-page/70 transition hover:border-page/35 hover:text-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-page/60"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-page/10 transition-transform duration-300 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              Haut de page
            </button>
          </div>
          <p className="mt-4 flex items-start gap-2 leading-relaxed text-page/55">
            <Check
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-up"
              aria-hidden="true"
            />
            Chaque chiffre affiché sur cette page vient d’un check enregistré ou
            d’une règle du contrat&nbsp;; aucune preuve n’est simulée.
          </p>
        </div>
      </div>
    </footer>
  );
}
