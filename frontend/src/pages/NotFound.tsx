import { Compass, Home } from "lucide-react";
import { useLocation } from "wouter";
import { Logo } from "@/components/uptime/Logo";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-5">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-glow">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-5 font-mono text-sm text-ink-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          Cette page n’existe pas
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          Le lien est peut-être obsolète, ou le monitor a été supprimé.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            onClick={() => setLocation("/")}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Retour au dashboard
          </button>
          <a href="/" aria-label="Accueil UptimePulse" className="inline-block">
            <Logo className="h-10 w-10" />
          </a>
        </div>
      </div>
    </div>
  );
}
