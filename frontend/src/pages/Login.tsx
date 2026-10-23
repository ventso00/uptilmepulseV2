import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useRouteSeo } from "@/lib/seo";
import { FormEvent, useState } from "react";
import { api, errorMessage, UnauthorizedError } from "@/lib/api";
import { LogoWordmark } from "@/components/uptime/Logo";

export default function Login() {
  useRouteSeo({
    title: "Connexion",
    description:
      "Connectez-vous à UptimePulse pour retrouver l'état, le temps de réponse et les incidents de vos sites et APIs.",
    path: "/login",
  });
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await api.login({ email, password });
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof UnauthorizedError)
        setError("Email ou mot de passe incorrect.");
      else setError(errorMessage(err, "Connexion impossible"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Revenir au signal"
      title="Votre infrastructure, en un coup d’œil."
      subtitle="Connectez-vous pour retrouver l’état de vos services et vos alertes."
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="Adresse email" icon={<Mail className="h-4 w-4" />}>
          <input
            required
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            className="auth-input"
          />
        </Field>
        <Field label="Mot de passe" icon={<LockKeyhole className="h-4 w-4" />}>
          <div className="relative">
            <input
              required
              minLength={12}
              type={show ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="12 caractères minimum"
              className="auth-input pr-11"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted transition hover:text-ink"
              aria-label={show ? "Masquer" : "Afficher"}
            >
              {show ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </Field>
        {error && (
          <p
            className="rounded-2xl border border-state-down/30 bg-state-down/10 px-3 py-2.5 text-sm text-state-down"
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          disabled={pending}
          className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-brand py-1.5 pl-2 pr-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-strong disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:translate-y-0 motion-reduce:hover:translate-y-0"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-glow text-white">
            {pending ? (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
            ) : (
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:translate-x-0"
                aria-hidden="true"
              />
            )}
          </span>
          {pending ? "Connexion…" : "Ouvrir mon espace"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Pas encore de compte ?{" "}
        <Link
          href="/register"
          className="font-medium text-ink underline decoration-brand-glow/50 underline-offset-4 transition hover:text-brand-glow"
        >
          Créer un espace gratuit
        </Link>
      </p>
    </AuthLayout>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Shared login/register shell: a glass header, a two-panel rounded card —
 * warm blush brand panel on the left, form on the right — sitting on the cream
 * page with the technical grid behind it, mirroring the landing composition.
 */
export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-page/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center">
            <LogoWordmark className="h-7 w-7" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-soft shadow-soft transition hover:border-ink/25 hover:text-ink"
          >
            <span aria-hidden="true">←</span>
            Retour au site
          </Link>
        </div>
      </header>

      <main className="relative overflow-hidden">
        <div
          className="grid-paper pointer-events-none absolute inset-x-0 top-0 h-[30rem]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -top-32 left-1/2 h-[20rem] w-[32rem] -translate-x-1/2 rounded-full bg-brand-glow/[0.07] blur-3xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-10 sm:px-6">
          <div className="grid w-full overflow-hidden rounded-[2rem] border border-line bg-surface shadow-strong lg:grid-cols-[1.05fr_1fr]">
            {/* Brand panel */}
            <div className="relative hidden overflow-hidden border-r border-line bg-brand-muted p-12 lg:block">
              <div
                className="grid-paper pointer-events-none absolute inset-0 opacity-70"
                aria-hidden="true"
              />
              <div
                className="halftone pointer-events-none absolute -bottom-6 -right-6 h-56 w-56 opacity-60"
                aria-hidden="true"
              />
              <div className="relative">
                <Link href="/" className="inline-flex items-center">
                  <LogoWordmark className="h-10 w-10" />
                </Link>
                <div className="mt-24">
                  <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-glow/30 bg-white shadow-soft">
                    <ShieldCheck
                      className="h-6 w-6 text-brand-glow"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-brand-glow">
                    Signal clair, décisions rapides
                  </p>
                  <h2 className="mt-4 text-4xl font-bold leading-[1.12] tracking-tight text-ink">
                    Sachez qu’un service est en panne{" "}
                    <span className="text-ink-muted">
                      avant vos utilisateurs.
                    </span>
                  </h2>
                  <p className="mt-5 max-w-sm text-sm leading-6 text-ink-soft">
                    Historique, incidents confirmés et alertes sans bruit. Une
                    surveillance simple pour les équipes qui veulent rester
                    sereines.
                  </p>
                </div>
                <div className="mt-16 flex items-center gap-2.5 text-xs text-ink-muted">
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-state-up" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-state-up" />
                  </span>
                  Monitoring actif
                  <span aria-hidden="true">·</span>
                  Données privées par défaut
                </div>
              </div>
            </div>

            {/* Form panel */}
            <div className="p-6 sm:p-10 lg:p-12">
              <div className="max-w-md">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-brand-glow">
                  {eyebrow}
                </p>
                <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-ink">
                  {title}
                </h1>
                <p className="mt-3 text-sm leading-6 text-ink-soft">
                  {subtitle}
                </p>
                <div className="mt-9">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
