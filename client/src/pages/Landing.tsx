import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  ArrowRight,
  BellRing,
  Check,
  Clock,
  Eye,
  Gauge,
  Globe2,
  Lock,
  MoonStar,
  Radar,
  SearchCheck,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { Logo } from "@/components/uptime/Logo";
import { CountUp } from "@/components/uptime/CountUp";
import { ProductPreview } from "@/components/uptime/ProductPreview";
import { HeroCircuit } from "@/components/uptime/HeroCircuit";
import { HeroDeck } from "@/components/uptime/HeroDeck";
import { Reveal } from "@/components/uptime/Reveal";
import { SiteFooter } from "@/components/uptime/SiteFooter";
import { ClientReadsShowcase } from "@/components/uptime/ClientReadsShowcase";
import { INCIDENT_RULES } from "@shared/contracts";
import { api, type PlanPublic } from "@/lib/api";

/** CAD-style crosshair used to pin the corners of the hero plate. */
function RegistrationMark({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={`pointer-events-none absolute ${className}`}
      aria-hidden="true"
    >
      <path d="M12 1v9M12 14v9M1 12h9M14 12h9" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

const steps = [
  {
    icon: Activity,
    title: "Checks périodiques",
    text: "Disponibilité, temps de réponse et code HTTP, toutes les 5 minutes. Chaque réponse est horodatée et conservée comme preuve.",
  },
  {
    icon: TriangleAlert,
    title: "Incidents confirmés",
    text: "Une erreur isolée n'est pas un incident. Après trois échecs consécutifs, l'incident est confirmé ; deux succès le referment.",
  },
  {
    icon: BellRing,
    title: "Alertes Telegram",
    text: "Notification à la confirmation, notification au rétablissement. Les canaux sont chiffrés et les alertes dédupliquées.",
  },
];

const metrics = [
  { value: "3", suffix: "échecs", label: "avant incident confirmé" },
  { value: "2", suffix: "succès", label: "pour un rétablissement" },
  { value: "5", suffix: "min", label: "intervalle de vérification" },
  { value: "90", suffix: "j", label: "d’historique et de calendrier public" },
];

/** A plan can quote a single monitor or a single channel; the copy must follow. */
function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function Landing() {
  // Read from the same rows the console edits, so the page cannot advertise a
  // tier the server refuses to grant.
  const [plans, setPlans] = useState<PlanPublic[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .plans()
      .then(response => {
        if (!cancelled) setPlans(response.plans);
      })
      .catch(() => {
        // Pricing is supporting content: a failed read hides the strip rather
        // than showing numbers nobody committed to.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-page/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <Logo className="h-7 w-7 shrink-0" />
            <span>
              Uptime<span className="text-ink-muted">Pulse</span>
            </span>
          </span>
          <nav
            aria-label="Navigation principale"
            className="hidden items-center gap-1 md:flex"
          >
            <a
              href="#verifications"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              Vérifications
            </a>
            <a
              href="#lecture-client"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              Page client
            </a>
            <a
              href="#formules"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              Formules
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              Connexion
            </Link>
            <Link
              href="/register"
              className="group inline-flex whitespace-nowrap items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-strong motion-reduce:translate-y-0"
            >
              Ouvrir mon espace
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:translate-x-0"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ============================ HERO ============================ */}
        <div className="relative overflow-hidden border-b border-line bg-surface-2">
          <div
            className="grid-paper pointer-events-none absolute inset-x-0 top-0 h-[34rem]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[20rem] w-[32rem] -translate-x-1/2 rounded-full bg-brand-glow/[0.07] blur-3xl"
            aria-hidden="true"
          />
          {/* CAD-style registration marks pinned to the four corners of the plate */}
          <RegistrationMark className="left-4 top-4 h-5 w-5 text-line-strong sm:left-6 sm:top-6" />
          <RegistrationMark className="right-4 top-4 h-5 w-5 text-line-strong sm:right-6 sm:top-6" />
          <RegistrationMark className="bottom-4 left-4 h-5 w-5 text-line-strong sm:bottom-6 sm:left-6" />
          <RegistrationMark className="bottom-4 right-4 h-5 w-5 text-line-strong sm:bottom-6 sm:right-6" />

          <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 lg:pt-20">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                Surveillance de statut
              </p>
              <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                Checks horodatés en UTC
              </p>
            </div>

            <div className="mt-10 text-center lg:mt-12">
              <h1
                className="animate-rise mx-auto w-fit"
                style={{ animationDelay: "120ms" }}
              >
                <span className="sr-only">
                  UptimePulse — checks horodatés, incidents confirmés avant
                  alerte, page de statut publique.
                </span>
                <span aria-hidden="true" className="block">
                  <span className="font-display relative block text-[clamp(3.25rem,12vw,8rem)] font-bold uppercase leading-[0.86] tracking-[-0.045em] text-ink">
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 h-[1.5em] w-[0.12em] -translate-x-1/2 -translate-y-1/2 bg-brand-glow"
                      aria-hidden="true"
                    />
                    <span className="relative block">Uptime</span>
                  </span>
                  <span className="hollow-ink font-display mt-1 block text-[clamp(3.25rem,12vw,8rem)] font-bold uppercase leading-[0.86] tracking-[-0.045em]">
                    Pulse
                  </span>
                </span>
              </h1>

              <div
                className="animate-rise mx-auto mt-9 flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-line-strong/70 py-3"
                style={{ animationDelay: "180ms" }}
              >
                <p className="flex items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-brand-glow"
                    aria-hidden="true"
                  />
                  {INCIDENT_RULES.failureThreshold} échecs&nbsp;: incident
                  confirmé · {INCIDENT_RULES.recoveryThreshold} succès&nbsp;:{" "}
                  rétablissement
                </p>
                <p className="metric whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                  Intervalle 5 min · historique 90 j
                </p>
              </div>

              <p
                className="animate-rise mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-soft"
                style={{ animationDelay: "200ms" }}
              >
                UptimePulse apporte à votre infrastructure l'exigence du code :
                chaque incident est reconstruit à partir de mesures réelles —
                statuts, latences, horodatages — et notifié seulement quand il
                compte.
              </p>

              <div
                className="animate-rise mt-8 flex flex-wrap items-center justify-center gap-3"
                style={{ animationDelay: "280ms" }}
              >
                <Link
                  href="/register"
                  className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand py-1.5 pl-2 pr-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-strong motion-reduce:translate-y-0 motion-reduce:hover:translate-y-0"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-glow text-white">
                    <Activity className="h-4 w-4" aria-hidden="true" />
                  </span>
                  Ouvrir mon espace
                </Link>
                <a
                  href="#lecture-client"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 text-sm font-medium text-ink-soft shadow-soft transition hover:border-ink/25 hover:text-ink"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Voir ce que lit un client
                </a>
              </div>

              <p
                className="animate-rise mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-ink-soft"
                style={{ animationDelay: "340ms" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck
                    className="h-4 w-4 text-state-up"
                    aria-hidden="true"
                  />
                  Aucune carte bancaire — le plan gratuit est réellement gratuit
                </span>
                <span aria-hidden="true">·</span>
                <span>Un seul accès d'exploitation, le vôtre</span>
              </p>
            </div>

            {/* One check, four readings — fanned in depth */}
            <div className="mt-12 lg:mt-16">
              <Reveal delay={200}>
                <HeroDeck />
              </Reveal>
            </div>

            <Reveal delay={280}>
              <div className="mx-auto mt-12 max-w-3xl">
                <ProductPreview />
              </div>
            </Reveal>
          </section>
        </div>

        {/* ==================== SOCIAL PROOF CARD ==================== */}
        <section aria-labelledby="metrics-heading" className="px-4 sm:px-6">
          <h2 id="metrics-heading" className="sr-only">
            Règles de mesure d'UptimePulse
          </h2>
          <Reveal>
            <div className="mx-auto grid max-w-6xl gap-y-8 rounded-[2rem] border border-line bg-surface px-6 py-9 shadow-soft sm:px-8 lg:grid-cols-4 lg:gap-x-8">
              {metrics.map((metric, index) => (
                <div
                  key={metric.label}
                  className={
                    index > 0 ? "lg:border-l lg:border-line lg:pl-8" : undefined
                  }
                >
                  <p className="dotmatrix metric text-4xl font-bold tracking-tight text-ink">
                    <CountUp to={Number(metric.value)} />
                    <span className="ml-1.5 font-sans text-sm font-medium text-ink-muted">
                      {metric.suffix}
                    </span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    {metric.label}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ==================== HOW IT WORKS ==================== */}
        <section
          aria-labelledby="how-heading"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <Reveal>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
                  Comment ça marche
                </p>
                <h2
                  id="how-heading"
                  className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
                >
                  De l'observation à l'action,
                  <span className="text-ink-muted"> sans bruit.</span>
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
                Trois étapes automatiques, aucune fausse alerte, aucune cause
                inventée : uniquement ce qui a été mesuré.
              </p>
            </div>
          </Reveal>
          <div className="relative mt-12 grid gap-5 md:grid-cols-3">
            <svg
              className="pointer-events-none absolute left-[18%] top-12 hidden h-px w-[64%] text-line-strong md:block"
              viewBox="0 0 100 1"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                className="dash-flow"
                x1="0"
                y1="0.5"
                x2="100"
                y2="0.5"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            {steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 110}>
                <article className="group h-full rounded-3xl border border-line bg-surface p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-ink/20 hover:shadow-glow motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-page text-ink transition group-hover:border-brand-glow/40 group-hover:bg-brand-glow group-hover:text-white">
                    <step.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                    Étape {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1.5 text-base font-semibold">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {step.text}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <ClientReadsShowcase />

        {/* ============ INTRODUCING-STYLE FEATURE SECTION ============ */}
        <section
          id="verifications"
          aria-labelledby="checks-heading"
          className="relative overflow-hidden px-4 pb-20 pt-20 sm:px-6"
        >
          <div
            className="halftone pointer-events-none absolute right-0 top-16 h-72 w-1/2 opacity-70"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl">
            <Reveal direction="left">
              <h2
                id="checks-heading"
                className="max-w-2xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl"
              >
                Ce qu'UptimePulse vérifie&nbsp;:
                <span className="block text-ink-muted">
                  <span className="text-ink">du DNS</span> jusqu'au{" "}
                  <span className="text-ink">certificat</span>, à chaque check.
                </span>
              </h2>
            </Reveal>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink-soft">
              Pas seulement « le site répond ». Chaque check documente ce qui se
              passe réellement, phase par phase.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Globe2,
                  title: "Réponse HTTP complète",
                  text: "Code de statut, redirections suivies, contenu accessible : le service répond-il vraiment ?",
                },
                {
                  icon: SearchCheck,
                  title: "Contenu vérifié",
                  text: "Le mot-clé que vous attendez est-il présent — ou absent — dans la réponse ? Une page qui affiche « service indisponible » en vert cesse de passer pour un succès.",
                },
                {
                  icon: Timer,
                  title: "Latences phase par phase",
                  text: "Résolution DNS, connexion TCP, handshake TLS, premier octet : vous savez où le temps part.",
                },
                {
                  icon: Clock,
                  title: "Certificat TLS",
                  text: "Émetteur, sujet et date d'expiration surveillés à chaque check HTTPS, avec compte à rebours.",
                },
                {
                  icon: Radar,
                  title: "Incidents prouvés",
                  text: "Horodatage exact, durée, statut au moment du déclenchement : rien n'est deviné.",
                },
                {
                  icon: Gauge,
                  title: "Disponibilité chiffrée",
                  text: "Uptime calculé sur 90 jours d'historique, agrégé par jour, exporté visuellement.",
                },
                {
                  icon: ShieldCheck,
                  title: "Page de statut publique",
                  text: "Un lien /status/votre-slug à partager avec vos clients : votre uptime, en temps réel, sans compte.",
                },
              ].map((item, index) => (
                <Reveal key={item.title} delay={index * 70}>
                  <div className="group h-full rounded-3xl border border-line bg-surface p-5 shadow-soft transition duration-300 hover:-translate-y-1 hover:border-ink/20 hover:shadow-glow motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                    <item.icon
                      className="h-5 w-5 text-ink transition group-hover:text-brand-glow"
                      aria-hidden="true"
                    />
                    <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                      {item.text}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* The signal circuit: probes → hub → alert */}
            <Reveal delay={120}>
              <div className="mt-16">
                <HeroCircuit />
              </div>
            </Reveal>
          </div>
        </section>

        <section
          id="formules"
          aria-labelledby="pricing-heading"
          className="border-y border-line bg-surface-2/60"
        >
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal>
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
                    Formules
                  </p>
                  <h2
                    id="pricing-heading"
                    className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
                  >
                    Des limites lisibles,
                    <span className="text-ink-muted"> pas de surprises.</span>
                  </h2>
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
                  Chaque plan annonce exactement ce que le serveur applique. Le
                  quota affiché ici est le quota refusé au-delà — il n'y a pas
                  de bride cachée.
                </p>
              </div>
            </Reveal>
            {plans.length > 0 ? (
              <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan, index) => {
                  const featured = index === 1;
                  return (
                    <Reveal key={plan.slug} delay={index * 90}>
                      <div
                        className={`flex h-full flex-col rounded-3xl border p-6 transition duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                          featured
                            ? "border-transparent bg-brand text-white shadow-glow"
                            : "border-line bg-surface text-ink shadow-soft hover:border-ink/20 hover:shadow-glow"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <h3
                            className={`text-sm font-semibold ${featured ? "text-white" : ""}`}
                          >
                            {plan.name}
                          </h3>
                          {featured && (
                            <span className="rounded-full bg-brand-glow px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
                              Recommandé
                            </span>
                          )}
                        </div>
                        <p
                          className={`metric mt-3 text-3xl font-bold ${featured ? "text-white" : "text-ink"}`}
                        >
                          {plan.priceCents === 0
                            ? "Gratuit"
                            : `${(plan.priceCents / 100).toLocaleString("fr-FR")} €`}
                          {plan.priceCents > 0 && (
                            <span
                              className={`text-sm font-medium ${featured ? "text-white/70" : "text-ink-muted"}`}
                            >
                              {" "}
                              / mois
                            </span>
                          )}
                        </p>
                        {plan.trialDays > 0 && (
                          <p
                            className={`mt-1.5 text-[11px] ${featured ? "text-white/70" : "text-ink-muted"}`}
                          >
                            {countLabel(plan.trialDays, "jour", "jours")}{" "}
                            d'essai
                          </p>
                        )}
                        <ul
                          className={`mt-5 space-y-2.5 text-sm ${featured ? "text-white/85" : "text-ink-soft"}`}
                        >
                          {[
                            countLabel(plan.maxMonitors, "monitor", "monitors"),
                            `Vérification toutes les ${Math.round(plan.minIntervalSeconds / 60)} minutes`,
                            `${countLabel(plan.maxChannels, "canal", "canaux")} de notification`,
                            plan.allowKeyword
                              ? "Assertion de contenu (mot-clé)"
                              : "Code HTTP uniquement",
                          ].map(feature => (
                            <li
                              key={feature}
                              className="flex items-start gap-2"
                            >
                              <Check
                                className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-brand-glow" : "text-state-up"}`}
                                aria-hidden="true"
                              />
                              {feature}
                            </li>
                          ))}
                        </ul>
                        <Link
                          href="/register"
                          className={`mt-6 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                            featured
                              ? "bg-white text-brand hover:bg-white/90"
                              : "border border-line bg-page text-ink hover:border-ink/25"
                          }`}
                        >
                          Ouvrir cet espace
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            ) : (
              <p className="mt-10 text-center text-sm text-ink-muted">
                Tarifs en cours de publication.
              </p>
            )}
          </div>
        </section>

        {/* ==================== TRUST ==================== */}
        <section
          aria-labelledby="trust-heading"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <h2 id="trust-heading" className="sr-only">
            Garanties techniques
          </h2>
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "SSRF bloqué par défaut",
                text: "Les cibles privées, loopback et metadata cloud sont refusées à la création et à chaque redirect.",
              },
              {
                icon: Gauge,
                title: "Évidence, pas d'intuition",
                text: "Chaque incident s'appuie sur les checks réellement enregistrés : statuts, latences, erreurs.",
              },
              {
                icon: MoonStar,
                title: "Deux lectures, deux interfaces",
                text: "Page client claire et immédiate, console d'exploitation dense pour celui qui pilote.",
              },
            ].map((point, index) => (
              <Reveal key={point.title} delay={index * 110}>
                <div className="h-full rounded-3xl border border-line bg-surface p-6 shadow-soft transition duration-300 hover:border-ink/20 motion-reduce:transition-none">
                  <point.icon
                    className="h-5 w-5 text-brand-glow"
                    aria-hidden="true"
                  />
                  <h3 className="mt-4 text-sm font-semibold">{point.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {point.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ==================== FINAL CTA ==================== */}
        <section className="px-4 pb-20 sm:px-6">
          <Reveal>
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-16 text-center shadow-soft">
              <div
                className="grid-paper pointer-events-none absolute inset-0 opacity-60"
                aria-hidden="true"
              />
              <div className="relative">
                <Logo className="mx-auto h-12 w-12" />
                <h2 className="mx-auto mt-6 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
                  Surveillez votre premier service
                  <span className="text-ink-muted">
                    {" "}
                    en moins de deux minutes.
                  </span>
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
                  L'accès d'exploitation est unique et réservé au créateur de
                  l'espace. Vos clients, eux, n'ont rien à installer ni à
                  connecter.
                </p>
                <Link
                  href="/register"
                  className="group mx-auto mt-8 inline-flex items-center gap-3 rounded-full bg-brand py-1.5 pl-2 pr-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-strong motion-reduce:translate-y-0"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-glow text-white">
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:translate-x-0"
                      aria-hidden="true"
                    />
                  </span>
                  Ouvrir mon espace
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
