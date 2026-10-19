import {
  Bell,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  api,
  errorMessage,
  UnauthorizedError,
  type NotificationChannel,
  type StatusPage,
  type User,
} from "@/lib/api";
import { AppShell } from "@/components/uptime/AppShell";
import { ErrorState, FullLoader } from "@/components/uptime/PageState";
import { ConfirmDialog } from "@/components/uptime/ConfirmDialog";
import { useLocation } from "wouter";
import { INCIDENT_RULES } from "@shared/contracts";

export default function Settings() {
  const [, navigate] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rowPending, setRowPending] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [pageSlug, setPageSlug] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [pageDescription, setPageDescription] = useState("");
  const [pagePending, setPagePending] = useState(false);
  const [pageError, setPageError] = useState("");

  const load = useCallback(async () => {
    try {
      const [auth, channelList, pageResult] = await Promise.all([
        api.me(),
        api.channels(),
        api.statusPage(),
      ]);
      setUser(auth.user);
      setChannels(channelList.channels);
      setStatusPage(pageResult.statusPage);
      setPageSlug(pageResult.statusPage?.slug ?? "");
      setPageTitle(pageResult.statusPage?.title ?? "");
      setPageDescription(pageResult.statusPage?.description ?? "");
      setLoadError("");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        navigate("/login");
        return;
      }
      setLoadError(errorMessage(err, "Impossible de charger les paramètres"));
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addChannel(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.createChannel({ type: "telegram", botToken, chatId });
      setBotToken("");
      setChatId("");
      toast.success("Canal Telegram ajouté. Vous pouvez envoyer un test.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Impossible d’ajouter le canal"));
    } finally {
      setPending(false);
    }
  }

  async function testChannel(id: number) {
    setError("");
    // Per-row pending state: without it a double click sent two notifications.
    setRowPending(id);
    try {
      await api.testChannel(id);
      toast.success("Notification de test envoyée.");
    } catch (err) {
      setError(errorMessage(err, "Le test a échoué"));
    } finally {
      setRowPending(null);
    }
  }

  async function deleteChannel(id: number) {
    setError("");
    setRowPending(id);
    try {
      await api.deleteChannel(id);
      toast.success("Canal Telegram supprimé.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Impossible de supprimer le canal"));
    } finally {
      setRowPending(null);
    }
  }

  async function saveStatusPage(event: React.FormEvent) {
    event.preventDefault();
    setPagePending(true);
    setPageError("");
    try {
      const result = await api.saveStatusPage({
        slug: pageSlug.trim().toLowerCase(),
        title: pageTitle.trim(),
        description:
          pageDescription.trim() === "" ? null : pageDescription.trim(),
      });
      setStatusPage(result.statusPage);
      toast.success("Page de statut enregistrée.", {
        action: {
          label: "Ouvrir",
          onClick: () =>
            window.open(
              `/status/${result.statusPage?.slug}`,
              "_blank",
              "noopener"
            ),
        },
      });
    } catch (err) {
      setPageError(errorMessage(err, "Impossible d’enregistrer la page"));
    } finally {
      setPagePending(false);
    }
  }

  async function removeStatusPage() {
    setPagePending(true);
    setPageError("");
    try {
      await api.deleteStatusPage();
      setStatusPage(null);
      toast.success("Page de statut supprimée.");
    } catch (err) {
      setPageError(errorMessage(err, "Impossible de supprimer la page"));
    } finally {
      setPagePending(false);
    }
  }

  if (loading) return <FullLoader label="Chargement des paramètres…" />;
  if (!user)
    return (
      <ErrorState
        title="Paramètres indisponibles"
        message={loadError || "Les paramètres n’ont pas pu être chargés."}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      />
    );

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <div className="flex items-center gap-2 text-sm text-brand-glow">
            <Bell className="h-4 w-4" aria-hidden="true" />
            Paramètres
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
            Vos canaux de confiance.
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            UptimePulse vous alerte uniquement quand un incident est confirmé.
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-state-down/30 bg-state-down/10 px-4 py-3 text-sm text-state-down"
          >
            {error}
          </p>
        )}
        <section className="rounded-2xl border border-line bg-surface shadow-soft">
          <div className="border-b border-line px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-subtle text-brand-glow">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-ink">Telegram</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Alertes de panne confirmée et de rétablissement
                </p>
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            {channels.length > 0 && (
              <div className="space-y-3">
                {channels.map(channel => (
                  <div
                    key={channel.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-state-up/25 bg-state-up/[0.06] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-state-up/10">
                        <CheckCircle2
                          className="h-4 w-4 text-state-up"
                          aria-hidden="true"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">
                          Bot Telegram configuré
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          Token chiffré · canal actif
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void testChannel(channel.id)}
                        disabled={rowPending === channel.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-60"
                      >
                        {rowPending === channel.id ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Tester
                      </button>
                      <button
                        onClick={() => setConfirmDelete(channel.id)}
                        disabled={rowPending === channel.id}
                        className="rounded-full p-2 text-ink-muted hover:bg-state-down/10 hover:text-state-down disabled:opacity-60"
                        aria-label="Supprimer le canal"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {channels.length === 0 && (
              <div className="mb-6 rounded-xl border border-state-warn/25 bg-state-warn/[0.06] p-4">
                <div className="flex gap-3">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-state-warn"
                    aria-hidden="true"
                  />
                  <p className="text-xs leading-5 text-ink-muted">
                    Vos identifiants Telegram sont chiffrés côté serveur et ne
                    seront jamais affichés dans le dashboard ou les logs.
                  </p>
                </div>
              </div>
            )}
            <form
              onSubmit={addChannel}
              className="mt-5 grid gap-4 border-t border-line pt-6 sm:grid-cols-2"
            >
              <fieldset className="sm:col-span-2">
                <legend className="sr-only">
                  Identifiants du bot Telegram
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-soft">
                      <KeyRound
                        className="h-3.5 w-3.5 text-ink-muted"
                        aria-hidden="true"
                      />
                      Bot token
                    </span>
                    <input
                      required
                      minLength={10}
                      value={botToken}
                      onChange={e => setBotToken(e.target.value)}
                      placeholder="123456789:AA…"
                      aria-describedby="bot-token-hint"
                      className="auth-input font-mono text-xs"
                    />
                    <span
                      id="bot-token-hint"
                      className="mt-2 block text-[11px] text-ink-muted"
                    >
                      Créé avec BotFather · jamais stocké en clair
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-soft">
                      <MessageCircle
                        className="h-3.5 w-3.5 text-ink-muted"
                        aria-hidden="true"
                      />
                      Chat ID
                    </span>
                    <input
                      required
                      value={chatId}
                      onChange={e => setChatId(e.target.value)}
                      placeholder="-1001234567890"
                      aria-describedby="chat-id-hint"
                      className="auth-input font-mono text-xs"
                    />
                    <span
                      id="chat-id-hint"
                      className="mt-2 block text-[11px] text-ink-muted"
                    >
                      ID du canal ou de la conversation cible
                    </span>
                  </label>
                </div>
              </fieldset>
              <div className="sm:col-span-2">
                <button
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {pending ? "Enregistrement…" : "Ajouter le canal"}
                </button>
              </div>
            </form>
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface shadow-soft">
          <div className="border-b border-line px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-subtle text-brand-glow">
                <Globe className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-ink">
                  Page de statut publique
                </h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Montrez l’uptime de vos services à vos clients, sans compte
                </p>
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            {statusPage && (
              <div className="mb-6 flex flex-col justify-between gap-3 rounded-xl border border-state-up/25 bg-state-up/[0.06] p-4 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Page en ligne
                  </p>
                  <a
                    href={`/status/${statusPage.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1.5 truncate font-mono text-xs text-brand-strong hover:text-brand-glow"
                  >
                    /status/{statusPage.slug}
                    <ExternalLink
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                  </a>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/status/${statusPage.slug}`;
                      void navigator.clipboard
                        .writeText(url)
                        .then(() => toast.success("URL copiée."))
                        .catch(() =>
                          toast.error("Copie impossible dans ce navigateur.")
                        );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface-2"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copier l’URL
                  </button>
                  <button
                    onClick={() => void removeStatusPage()}
                    disabled={pagePending}
                    className="rounded-full p-2 text-ink-muted hover:bg-state-down/10 hover:text-state-down disabled:opacity-60"
                    aria-label="Supprimer la page de statut"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            {pageError && (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-state-down/30 bg-state-down/10 px-4 py-3 text-sm text-state-down"
              >
                {pageError}
              </p>
            )}
            <form
              onSubmit={saveStatusPage}
              className="grid gap-4 border-line sm:grid-cols-2"
            >
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-soft">
                  Identifiant (slug)
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-ink-muted">/status/</span>
                  <input
                    required
                    value={pageSlug}
                    onChange={e => setPageSlug(e.target.value)}
                    placeholder="mes-services"
                    pattern="(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])|[a-z0-9])"
                    aria-describedby="slug-hint"
                    className="auth-input font-mono text-xs"
                  />
                </div>
                <span
                  id="slug-hint"
                  className="mt-2 block text-[11px] text-ink-muted"
                >
                  Minuscules, chiffres et tirets · 2 à 64 caractères
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-ink-soft">
                  Titre de la page
                </span>
                <input
                  required
                  maxLength={120}
                  value={pageTitle}
                  onChange={e => setPageTitle(e.target.value)}
                  placeholder="Statut de mes services"
                  className="auth-input text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-xs font-medium text-ink-soft">
                  Description (optionnelle)
                </span>
                <textarea
                  maxLength={500}
                  rows={2}
                  value={pageDescription}
                  onChange={e => setPageDescription(e.target.value)}
                  placeholder="Visible publiquement en haut de votre page de statut."
                  className="auth-input text-sm"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  disabled={pagePending}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
                >
                  {pagePending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Globe className="h-4 w-4" aria-hidden="true" />
                  )}
                  {pagePending
                    ? "Enregistrement…"
                    : statusPage
                      ? "Mettre à jour la page"
                      : "Créer ma page de statut"}
                </button>
              </div>
            </form>
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 text-brand-glow"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-ink">
                Règle de notification
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Un incident n’est confirmé qu’après{" "}
                {INCIDENT_RULES.failureThreshold} échecs consécutifs. Le
                rétablissement est confirmé après{" "}
                {INCIDENT_RULES.recoveryThreshold} succès consécutifs. Cette
                logique évite les faux positifs et les notifications répétées.
              </p>
            </div>
          </div>
        </section>
      </div>
      {confirmDelete !== null && (
        <ConfirmDialog
          title="Supprimer ce canal ?"
          description="Vous ne recevrez plus d’alertes Telegram. Le canal peut être réajouté à tout moment."
          confirmLabel="Supprimer"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            void deleteChannel(target);
          }}
        />
      )}
    </AppShell>
  );
}
