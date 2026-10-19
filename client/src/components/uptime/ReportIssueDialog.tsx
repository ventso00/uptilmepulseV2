import { CheckCircle2, Copy, Loader2, Send, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { captureEvidence } from "@/lib/qaContext";
import { Modal } from "./Modal";
import { qaTicketKindLabels, type QaTicketKind } from "@shared/contracts";

/**
 * The public intake form. Everything the reporter cannot be asked to type —
 * route, browser, viewport, JavaScript errors and failed API calls of the
 * session — is attached automatically by `captureEvidence()`, and the dialog
 * says so out loud: a reporter must know what leaves their browser.
 */
export function ReportIssueDialog({
  statusSlug = null,
  onClose,
}: {
  statusSlug?: string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<QaTicketKind>("bug");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pageUrl, setPageUrl] = useState(
    typeof window === "undefined" ? "" : window.location.href
  );
  const [honeypot, setHoneypot] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    reference: string;
    link: string;
  } | null>(null);

  const evidence = captureEvidence();
  const capturedCount =
    evidence.javaScriptErrors.length + evidence.failedRequests.length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await api.reportIssue({
        title,
        clientMessage: message,
        kind,
        steps: steps.trim() ? steps : null,
        expected: expected.trim() ? expected : null,
        actual: actual.trim() ? actual : null,
        reporterName: name.trim() ? name : null,
        reporterEmail: email.trim() ? email : null,
        pageUrl: pageUrl.trim() ? pageUrl : null,
        statusSlug,
        evidence,
        // The honeypot must stay empty; a filled one is a bot and is dropped.
        website: honeypot,
      });
      setCreated({
        reference: result.reference,
        link: `${window.location.origin}/support/${result.reporterToken}`,
      });
    } catch (cause) {
      setError(errorMessage(cause, "Envoi impossible, réessayez."));
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <Modal title="Signalement enregistré" onClose={onClose}>
        <div className="mt-5 space-y-4 text-sm text-ink-soft">
          <p className="flex items-center gap-2 font-semibold text-state-up">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Référence {created.reference}
          </p>
          <p className="leading-6 text-ink-soft">
            Notre équipe qualité lit chaque signalement et revient vers vous
            avec une réponse concrète. Conservez le lien ci-dessous : il ouvre à
            tout moment l’avancement de votre dossier, sans compte ni mot de
            passe.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={created.link}
              onFocus={event => event.currentTarget.select()}
              aria-label="Lien de suivi de votre signalement"
              className="field-input flex-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(created.link)
                  .catch(() => undefined);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-ink-soft hover:bg-surface-2"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copier
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Signaler un problème"
      description="Décrivez ce que vous avez constaté. Les détails techniques visibles par votre navigateur sont joints automatiquement."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Nature du problème
            </span>
            <select
              value={kind}
              onChange={event =>
                setKind(event.currentTarget.value as QaTicketKind)
              }
              className="field-input text-sm"
            >
              {(Object.keys(qaTicketKindLabels) as QaTicketKind[]).map(
                value => (
                  <option key={value} value={value}>
                    {qaTicketKindLabels[value]}
                  </option>
                )
              )}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Page concernée
            </span>
            <input
              type="url"
              value={pageUrl}
              onChange={event => setPageUrl(event.currentTarget.value)}
              maxLength={2048}
              className="field-input text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">
            Titre (résumé en une ligne)
          </span>
          <input
            required
            minLength={5}
            maxLength={160}
            value={title}
            onChange={event => setTitle(event.currentTarget.value)}
            placeholder="Ex. le graphique de latence reste vide"
            className="field-input text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-medium text-ink-soft">
            Ce que vous avez constaté
          </span>
          <textarea
            required
            minLength={10}
            maxLength={4000}
            rows={4}
            value={message}
            onChange={event => setMessage(event.currentTarget.value)}
            placeholder="Écrivez avec vos mots : le texte exact est conservé tel quel dans le rapport interne."
            className="field-input text-sm"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Étapes pour reproduire (optionnel)
            </span>
            <textarea
              maxLength={2000}
              rows={3}
              value={steps}
              onChange={event => setSteps(event.currentTarget.value)}
              placeholder={"1. Ouvrir la page\n2. Cliquer sur…\n3. Constater…"}
              className="field-input text-sm"
            />
          </label>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-ink-soft">
                Résultat attendu (optionnel)
              </span>
              <input
                maxLength={1000}
                value={expected}
                onChange={event => setExpected(event.currentTarget.value)}
                placeholder="Ex. une courbe sur 7 jours"
                className="field-input text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-ink-soft">
                Résultat observé (optionnel)
              </span>
              <input
                maxLength={1000}
                value={actual}
                onChange={event => setActual(event.currentTarget.value)}
                placeholder="Ex. aucun point tracé"
                className="field-input text-sm"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Votre prénom (optionnel)
            </span>
            <input
              maxLength={120}
              value={name}
              onChange={event => setName(event.currentTarget.value)}
              className="field-input text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink-soft">
              Votre e-mail (optionnel)
            </span>
            <input
              type="email"
              maxLength={320}
              value={email}
              onChange={event => setEmail(event.currentTarget.value)}
              aria-describedby="reporter-email-hint"
              className="field-input text-sm"
            />
            <span
              id="reporter-email-hint"
              className="mt-2 block text-[11px] text-ink-muted"
            >
              Utilisé uniquement pour vous répondre · le lien de suivi suffit
              aussi
            </span>
          </label>
        </div>

        {/* Honeypot: invisible for humans, autofill bait for bots. */}
        <div aria-hidden="true" className="hidden">
          <label htmlFor="qa-website">Ne pas remplir</label>
          <input
            id="qa-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={event => setHoneypot(event.currentTarget.value)}
          />
        </div>

        <p className="flex items-start gap-2 rounded-xl border border-line bg-page px-3 py-2.5 text-[11px] leading-5 text-ink-muted">
          <ShieldAlert
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Preuves jointes automatiquement : route, navigateur, fenêtre,
            {capturedCount === 0
              ? " aucune erreur technique relevée dans cette session."
              : ` ${capturedCount} erreur(s) technique(s) relevée(s) dans cette session.`}{" "}
            Aucune donnée de votre compte n’est envoyée.
          </span>
        </p>

        {error && (
          <p role="alert" className="text-sm text-state-down">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink-soft hover:bg-surface-2"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Envoyer le signalement
          </button>
        </div>
      </form>
    </Modal>
  );
}
