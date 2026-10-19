import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { recordJavaScriptError } from "@/lib/qaContext";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render errors so a single broken page does not blank the app.
 * Logs the error for diagnosis and no longer dumps the raw stack trace to the
 * user, which leaked internals and used a light theme the app never renders.
 * Colours come from the semantic tokens because this fallback renders for the
 * light client routes as much as for the dark operator ones.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Captured as report evidence: a render crash is exactly what a reporter
    // cannot describe in words.
    recordJavaScriptError(`${error.name}: ${error.message}`, "ErrorBoundary");
    console.error(
      JSON.stringify({
        event: "react_error_boundary",
        message: error.message,
        componentStack: info.componentStack ?? null,
      })
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-page px-5">
          <div
            role="alert"
            className="w-full max-w-md rounded-2xl border border-state-down/25 bg-surface p-8 text-center shadow-sm shadow-brand/5"
          >
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-state-down/10 text-state-down">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="font-display mt-4 text-xl font-semibold text-ink">
              Une erreur inattendue est survenue
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              L’interface n’a pas pu s’afficher. Rechargez la page pour
              reprendre, ou revenez à la page d’accueil.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Recharger
              </button>
              <button
                onClick={() => {
                  window.location.href = "/";
                }}
                className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink-soft hover:bg-surface-2"
              >
                Page d’accueil
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
