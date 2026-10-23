import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Landing from "./pages/Landing";

/**
 * Only the landing page ships in the entry chunk. Every other route carries
 * its own code — including the 400 kB charting library the landing never
 * displays — so the page a crawler measures first stays the lightest one.
 */
const NotFound = lazy(() => import("./pages/NotFound"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const MonitorDetail = lazy(() => import("./pages/MonitorDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const PublicStatus = lazy(() => import("./pages/PublicStatus"));
const QaQueue = lazy(() => import("./pages/QaQueue"));
const AdminConsole = lazy(() => import("./pages/AdminConsole"));
const SupportTicket = lazy(() => import("./pages/SupportTicket"));

/**
 * One full-viewport block, the height the pages it replaces start with: a
 * fallback that collapses and then grows is a layout shift on first paint.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <p className="font-mono text-xs text-ink-muted">Chargement de la page…</p>
    </div>
  );
}

/**
 * One visual regime for the whole product: the warm light design now spans the
 * public pages and the operator console alike, so a reader and the operator
 * share the same surfaces. The `.dark` token block is kept in the stylesheet
 * (and ThemeProvider still supports it) should a dark regime be re-enabled —
 * the route no longer flips it behind the user's back.
 */
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/status/:slug" component={PublicStatus} />
              <Route path="/support/:token" component={SupportTicket} />
              <Route path="/qa" component={QaQueue} />
              <Route path="/console" component={AdminConsole} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/login" component={Login} />
              <Route path="/register" component={Register} />
              <Route path="/monitors/:id" component={MonitorDetail} />
              <Route path="/settings" component={Settings} />
              <Route path="/404" component={NotFound} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
export default App;
