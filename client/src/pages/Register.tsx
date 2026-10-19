import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Link, useLocation } from "wouter";
import { FormEvent, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthLayout } from "./Login";

export default function Register() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation)
      return setError("Les mots de passe ne correspondent pas.");
    setPending(true);
    try {
      await api.register({ email, password });
      navigate("/dashboard");
    } catch (err) {
      setError(errorMessage(err, "Création impossible"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Accès du créateur"
      title="Un seul compte ouvre cette application."
      subtitle="Cette page sert à réclamer ce compte unique et à en choisir le mot de passe. Une fois réclamé, plus aucune inscription n'est acceptée : les propriétaires de site consultent la page d'analyse publique, sans compte."
    >
      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Adresse email
          </span>
          <input
            required
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            className="auth-input"
          />
        </label>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            Mot de passe
          </span>
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
              aria-label={
                show ? "Masquer le mot de passe" : "Afficher le mot de passe"
              }
            >
              {show ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <span className="mt-1.5 block text-xs text-ink-muted">
            12 caractères minimum.
          </span>
        </label>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            Confirmer le mot de passe
          </span>
          <input
            required
            minLength={12}
            type={show ? "text" : "password"}
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            placeholder="Retapez votre mot de passe"
            className="auth-input"
          />
        </label>

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
          {pending ? "Réclamation…" : "Réclamer mon accès"}
        </button>

        <p className="flex items-start gap-2 rounded-2xl border border-line bg-page px-3.5 py-3 text-xs leading-5 text-ink-soft">
          <span
            className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-glow"
            aria-hidden="true"
          />
          Un seul accès d'exploitation, le vôtre. Vos clients n'auront jamais de
          compte à créer.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Déjà inscrit ?{" "}
        <Link
          href="/login"
          className="font-medium text-ink underline decoration-brand-glow/50 underline-offset-4 transition hover:text-brand-glow"
        >
          Se connecter
        </Link>
      </p>
    </AuthLayout>
  );
}
