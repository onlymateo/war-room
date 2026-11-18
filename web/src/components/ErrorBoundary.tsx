import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { t } from "@/i18n";

/** Keeps the shell usable when one page crashes, and shows a readable message. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-center">
        <AlertTriangle className="mx-auto size-6 text-danger" />
        <h2 className="mt-3 text-sm font-semibold">{t("Cette page a rencontré une erreur")}</h2>
        <p className="mt-1 break-words text-xs text-fg-muted">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })} className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2">
          {t("Réessayer")}
        </button>
      </div>
    );
  }
}
