import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  CreditCard,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/uptime/AppShell";
import { ErrorState, FullLoader } from "@/components/uptime/PageState";
import {
  api,
  errorMessage,
  UnauthorizedError,
  type AdminOverview,
  type PlanAdmin,
  type User,
} from "@/lib/api";
import type { PlanUpsertInput } from "@shared/contracts";

/** A plan row being edited locally before it is sent back to the server. */
type Draft = PlanUpsertInput;

/** The slug is validated but not editable: it is what every assigned account
 * points at, so renaming it would silently retier whole customers. The server
 * refuses the same thing for the `free` fallback row. */
function toDraft(plan: PlanAdmin): Draft {
  return {
    // slug is validated but never rewritten: it keys the plan-assignment
    // dropdowns and the seeded `free` fallback, so the console treats it as
    // immutable for existing tiers.
    slug: plan.slug,
    name: plan.name,
    maxMonitors: plan.maxMonitors,
    minIntervalSeconds: plan.minIntervalSeconds,
    maxTimeoutMs: plan.maxTimeoutMs,
    maxChannels: plan.maxChannels,
    allowKeyword: plan.allowKeyword,
    priceCents: plan.priceCents,
    trialDays: plan.trialDays,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
  };
}

const numericFields: {
  key: keyof Draft;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}[] = [
  { key: "maxMonitors", label: "Monitors", min: 1, max: 10_000 },
  {
    key: "minIntervalSeconds",
    label: "Intervalle min (s)",
    hint: "Plancher 300 s",
    min: 300,
    max: 86_400,
    step: 60,
  },
  {
    key: "maxTimeoutMs",
    label: "Timeout max (ms)",
    min: 1_000,
    max: 30_000,
    step: 500,
  },
  { key: "maxChannels", label: "Canaux", min: 1, max: 50 },
  {
    key: "priceCents",
    label: "Prix (centimes/mois)",
    hint: "0 = gratuit",
    min: 0,
    max: 1_000_000,
    step: 100,
  },
  { key: "trialDays", label: "Essai (jours)", min: 0, max: 365 },
  { key: "sortOrder", label: "Ordre", min: 0, max: 100 },
];

export default function AdminConsole() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<PlanAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await api.me();
      setUser(auth.user);
      if (auth.user.role !== "admin") {
        setError("La console est réservée aux administrateurs.");
        return;
      }
      const [nextOverview, nextPlans] = await Promise.all([
        api.adminOverview(),
        api.adminPlans(),
      ]);
      setOverview(nextOverview);
      setPlans(nextPlans.plans);
      setError("");
    } catch (cause) {
      if (cause instanceof UnauthorizedError) {
        navigate("/login");
        return;
      }
      setError(errorMessage(cause, "Console indisponible"));
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <FullLoader label="Chargement de la console…" />;
  if (!user)
    return (
      <ErrorState
        title="Console indisponible"
        message={error || "Session introuvable."}
        onRetry={() => void load()}
      />
    );

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-glow">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Console créateur
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-ink">
            Pilotage freemium
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Les limites modifiées ici s’appliquent immédiatement : le serveur
            relit le plan à chaque création de monitor et à chaque canal.
          </p>
        </div>

        {error && user.role !== "admin" && (
          <p
            role="alert"
            className="rounded-xl border border-state-down/30 bg-state-down/10 px-4 py-3 text-sm text-state-down"
          >
            {error}
          </p>
        )}

        {overview && (
          <>
            <section
              aria-label="Chiffres clés"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
            >
              <Kpi label="Comptes" value={overview.totals.users} />
              <Kpi label="Administrateurs" value={overview.totals.admins} />
              <Kpi label="Monitors" value={overview.totals.monitors} />
              <Kpi
                label="Incidents ouverts"
                value={overview.totals.openIncidents}
                tone={overview.totals.openIncidents > 0 ? "warn" : "ok"}
              />
              <Kpi
                label="Monitors avec mot-clé"
                value={overview.totals.keywordMonitors}
              />
            </section>

            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-sm font-semibold text-ink">
                  Répartition par plan
                </h2>
              </div>
              <div className="divide-y divide-line">
                {overview.plans.map(row => (
                  <div
                    key={row.slug}
                    className="grid grid-cols-2 gap-3 px-5 py-3 text-xs text-ink-muted sm:grid-cols-5"
                  >
                    <span className="font-medium text-ink">
                      {row.name}
                    </span>
                    <span>{row.slug}</span>
                    <span>
                      {(row.priceCents / 100).toLocaleString("fr-FR")} €
                    </span>
                    <span>{row.userCount} comptes</span>
                    <span>{row.monitorCount} monitors</span>
                  </div>
                ))}
              </div>
            </section>

            <PlansEditor
              plans={plans}
              onChanged={() => void load()}
              onPlansChange={setPlans}
            />

            <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
              <div className="flex items-center gap-2 border-b border-line px-5 py-4">
                <Users className="h-4 w-4 text-brand-glow" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-ink">
                  Affectation des comptes
                </h2>
              </div>
              <div className="divide-y divide-line">
                {overview.users.map(row => (
                  <UserAssignment
                    key={row.id}
                    row={row}
                    plans={plans}
                    onSaved={() => void load()}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "text-state-warn"
      : tone === "ok"
        ? "text-state-up"
        : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-4 shadow-soft">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function PlansEditor({
  plans,
  onPlansChange,
  onChanged,
}: {
  plans: PlanAdmin[];
  onPlansChange: (plans: PlanAdmin[]) => void;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    setDrafts(previous => {
      const next: Record<number, Draft> = {};
      for (const plan of plans)
        next[plan.id] = previous[plan.id] ?? toDraft(plan);
      return next;
    });
  }, [plans]);

  async function save(plan: PlanAdmin) {
    const draft = drafts[plan.id];
    if (!draft) return;
    setBusy(plan.id);
    try {
      const { plan: saved } = await api.updatePlan(plan.id, draft);
      onPlansChange(plans.map(row => (row.id === saved.id ? saved : row)));
      toast.success(`Plan « ${saved.name} » enregistré.`);
    } catch (cause) {
      toast.error(errorMessage(cause, "Enregistrement refusé"));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy(-1);
    try {
      await api.createPlan(newDraft);
      setCreating(false);
      setNewDraft(emptyDraft());
      toast.success("Plan créé.");
      onChanged();
    } catch (cause) {
      toast.error(errorMessage(cause, "Création refusée"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CreditCard className="h-4 w-4 text-brand-glow" aria-hidden="true" />
          Plans
        </h2>
        <button
          onClick={() => setCreating(value => !value)}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-xs text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          {creating ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {creating ? "Fermer" : "Nouveau plan"}
        </button>
      </div>

      {creating && (
        <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TextField
              label="Slug"
              value={newDraft.slug}
              onChange={value => setNewDraft({ ...newDraft, slug: value })}
            />
            <TextField
              label="Nom affiché"
              value={newDraft.name}
              onChange={value => setNewDraft({ ...newDraft, name: value })}
            />
            {numericFields.map(field => (
              <NumberField
                key={field.key}
                config={field}
                value={Number(newDraft[field.key])}
                onChange={value =>
                  setNewDraft({ ...newDraft, [field.key]: value } as Draft)
                }
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <ToggleField
              label="Mot-clé autorisé"
              checked={newDraft.allowKeyword}
              onChange={allowKeyword =>
                setNewDraft({ ...newDraft, allowKeyword })
              }
            />
            <ToggleField
              label="Affiché publiquement"
              checked={newDraft.isPublic}
              onChange={isPublic => setNewDraft({ ...newDraft, isPublic })}
            />
            <button
              onClick={() => void create()}
              disabled={busy === -1}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#07111d] hover:bg-cyan-200 disabled:opacity-60"
            >
              {busy === -1 && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Créer
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {plans.map(plan => {
          const draft = drafts[plan.id] ?? toDraft(plan);
          const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(plan));
          return (
            <div
              key={plan.id}
              className="rounded-2xl border border-white/[0.08] bg-[#0e192c] p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-white">
                  {plan.name}
                </span>
                <code className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                  {plan.slug}
                </code>
                {!plan.isPublic && (
                  <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
                    masqué
                  </span>
                )}
                <button
                  onClick={() => void save(plan)}
                  disabled={!dirty || busy === plan.id}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
                >
                  {busy === plan.id ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  Enregistrer
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <TextField
                  label="Nom affiché"
                  value={draft.name}
                  onChange={name =>
                    setDrafts(previous => ({
                      ...previous,
                      [plan.id]: { ...draft, name },
                    }))
                  }
                />
                {numericFields.map(field => (
                  <NumberField
                    key={field.key}
                    config={field}
                    value={Number(draft[field.key])}
                    onChange={value =>
                      setDrafts(previous => ({
                        ...previous,
                        [plan.id]: { ...draft, [field.key]: value } as Draft,
                      }))
                    }
                  />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-6">
                <ToggleField
                  label="Vérification de contenu"
                  checked={draft.allowKeyword}
                  onChange={allowKeyword =>
                    setDrafts(previous => ({
                      ...previous,
                      [plan.id]: { ...draft, allowKeyword },
                    }))
                  }
                />
                <ToggleField
                  label="Affiché publiquement"
                  checked={draft.isPublic}
                  onChange={isPublic =>
                    setDrafts(previous => ({
                      ...previous,
                      [plan.id]: { ...draft, isPublic },
                    }))
                  }
                />
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                Abaisser une limite ne supprime rien : les monitors déjà créés
                restent, seules les créations suivantes sont refusées.
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function emptyDraft(): Draft {
  return {
    slug: "",
    name: "",
    maxMonitors: 5,
    minIntervalSeconds: 300,
    maxTimeoutMs: 10_000,
    maxChannels: 1,
    allowKeyword: false,
    priceCents: 0,
    trialDays: 0,
    isPublic: true,
    sortOrder: 10,
  };
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1.5 block font-medium text-slate-300">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="auth-input"
      />
    </label>
  );
}

function NumberField({
  config,
  value,
  onChange,
}: {
  config: (typeof numericFields)[number];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1.5 block font-medium text-slate-300">
        {config.label}
        {config.hint && (
          <span className="ml-1 text-[10px] text-slate-500">{config.hint}</span>
        )}
      </span>
      <input
        type="number"
        min={config.min}
        max={config.max}
        step={config.step ?? 1}
        value={Number.isNaN(value) ? 0 : value}
        onChange={event => onChange(Number(event.target.value))}
        className="auth-input"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-white/20 bg-white/5 accent-cyan-300"
      />
      {label}
    </label>
  );
}

function UserAssignment({
  row,
  plans,
  onSaved,
}: {
  row: AdminOverview["users"][number];
  plans: PlanAdmin[];
  onSaved: () => void;
}) {
  const [planSlug, setPlanSlug] = useState(row.planSlug);
  const [trialDays, setTrialDays] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlanSlug(row.planSlug);
  }, [row.planSlug]);

  async function assign() {
    setBusy(true);
    try {
      await api.assignUserPlan(row.id, { planSlug, trialDays });
      toast.success(`Compte déplacé vers « ${planSlug} ».`);
      onSaved();
    } catch (cause) {
      toast.error(errorMessage(cause, "Affectation refusée"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-[220px] flex-1">
        <div className="truncate text-sm text-slate-200">
          {row.email ?? `compte #${row.id}`}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {row.monitorsUsed} / {row.maxMonitors} monitors ·{" "}
          {row.role === "admin" ? "administrateur" : "compte standard"}
          {row.trialEndsAt
            ? ` · essai jusqu’au ${new Intl.DateTimeFormat("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              }).format(new Date(row.trialEndsAt))}`
            : ""}
        </div>
      </div>
      <select
        value={planSlug}
        onChange={event => setPlanSlug(event.target.value)}
        aria-label={`Plan de ${row.email ?? `compte ${row.id}`}`}
        className="auth-input w-40"
      >
        {plans.map(plan => (
          <option key={plan.id} value={plan.slug}>
            {plan.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={365}
        value={trialDays}
        onChange={event => setTrialDays(Number(event.target.value))}
        aria-label="Jours d’essai"
        placeholder="essai (j)"
        className="auth-input w-28"
      />
      <button
        onClick={() => void assign()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        {busy && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        Appliquer
      </button>
    </div>
  );
}
