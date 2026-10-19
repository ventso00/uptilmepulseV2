import {
  Activity,
  Bell,
  ChevronRight,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
  Radio,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { User } from "@/lib/api";
import { api } from "@/lib/api";
import { useState } from "react";
import { LogoWordmark } from "./Logo";
import { ReportIssueDialog } from "./ReportIssueDialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMyPlan } from "@/hooks/useMyPlan";

const navItems = [
  { href: "/dashboard", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/qa", label: "Qualité & support", icon: ShieldCheck },
  { href: "/settings", label: "Notifications & statut", icon: Bell },
];

/** Only ever shown when the server says this account is an administrator. */
const adminNavItem = {
  href: "/console",
  label: "Console créateur",
  icon: Gauge,
};

export function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  // Read from the server so the meter cannot drift from what enforcement allows.
  const { plan } = useMyPlan();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // Off-canvas navigation stays out of the tab order while hidden.
  const sidebarHidden = !isDesktop && !mobileOpen;
  const initials = (user.email ?? "U").slice(0, 1).toUpperCase();

  const items = user.role === "admin" ? [...navItems, adminNavItem] : navItems;

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await api.logout();
      window.location.href = "/login";
    } catch {
      // The session may already be gone server-side. The user still needs to
      // leave the shell, but must be told the logout did not complete.
      setLogoutError("La déconnexion n’a pas abouti. Réessayez.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-page text-ink selection:bg-brand/15">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-line bg-surface px-5 py-6 transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        // Off-canvas navigation was transform-hidden only, so it stayed in the
        // tab order and the accessibility tree while "closed" on mobile.
        aria-hidden={sidebarHidden}
        inert={sidebarHidden}
      >
        <div className="flex items-center justify-between px-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-3"
            onClick={() => setMobileOpen(false)}
          >
            <LogoWordmark />
          </Link>
          <button
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-10 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
          Espace de travail
        </div>
        <nav className="mt-3 space-y-1">
          {items.map(item => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                // Active state was signalled by colour alone.
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${active ? "bg-brand-subtle text-brand-strong ring-1 ring-line" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? "text-brand-glow" : "text-ink-muted group-hover:text-ink-soft"}`}
                />
                <span>{item.label}</span>
                {active && (
                  <ChevronRight className="ml-auto h-4 w-4 text-brand-glow/60" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-4">
          {plan && (
            <div className="rounded-2xl border border-brand-glow/25 bg-brand-muted p-4 shadow-soft">
              <div className="flex items-center gap-2 text-xs font-medium text-brand-glow">
                <Radio className="h-3.5 w-3.5" />
                Plan {plan.plan.name}
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {plan.usage.monitors} / {plan.plan.maxMonitors} monitors ·
                checks toutes les{" "}
                {Math.round(plan.plan.minIntervalSeconds / 60)} minutes
              </p>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={plan.plan.maxMonitors}
                aria-valuenow={plan.usage.monitors}
                aria-label={`Monitors utilisés sur le plan ${plan.plan.name}`}
              >
                <div
                  className="h-full rounded-full bg-brand-glow"
                  style={{
                    width: `${Math.min(
                      100,
                      (plan.usage.monitors / plan.plan.maxMonitors) * 100
                    )}%`,
                  }}
                />
              </div>
              {plan.trialEndsAt && (
                <p className="mt-2 text-[11px] text-brand-glow/80">
                  Essai jusqu’au{" "}
                  {new Intl.DateTimeFormat("fr-FR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  }).format(new Date(plan.trialEndsAt))}
                </p>
              )}
              {!plan.trialEndsAt && (
                <p className="mt-2 text-[11px] text-ink-muted">
                  {plan.plan.priceCents > 0
                    ? `${(plan.plan.priceCents / 100).toLocaleString("fr-FR")} € / mois`
                    : "Validation du produit en cours"}
                </p>
              )}
            </div>
          )}
          <Link
            href="/settings"
            aria-current={location === "/settings" ? "page" : undefined}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Settings className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            Paramètres
          </Link>
          {logoutError && (
            <p role="alert" className="text-xs text-state-down">
              {logoutError}
            </p>
          )}
          <button
            onClick={logout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink-muted hover:bg-state-down/10 hover:text-state-down disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            {loggingOut ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        />
      )}
      <main className="lg:pl-72">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-line bg-page/85 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden items-center gap-2 text-xs text-ink-muted sm:flex">
              <Activity className="h-4 w-4 text-brand-glow" />
              Système de surveillance <span className="text-ink-muted">
                /
              </span>{" "}
              Live
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-state-up/15 bg-state-up/[0.06] px-3 py-1.5 text-xs text-state-up sm:flex">
              <span
                className="h-1.5 w-1.5 rounded-full bg-state-up shadow-[0_0_10px_rgba(52,211,153,0.8)]"
                aria-hidden="true"
              />
              Surveillance active
            </div>
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-strong">
                {initials}
              </div>
              <span className="hidden max-w-[180px] truncate text-sm text-ink-soft sm:inline">
                {user.email}
              </span>
            </div>
            <button
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-xs text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
              Signaler un problème
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8">
          {children}
        </div>
      </main>
      {reportOpen && <ReportIssueDialog onClose={() => setReportOpen(false)} />}
    </div>
  );
}
