import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import MonitorDetail from "./pages/MonitorDetail";
import Settings from "./pages/Settings";
import Landing from "./pages/Landing";
import PublicStatus from "./pages/PublicStatus";
import QaQueue from "./pages/QaQueue";
import AdminConsole from "./pages/AdminConsole";
import SupportTicket from "./pages/SupportTicket";

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
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
export default App;
