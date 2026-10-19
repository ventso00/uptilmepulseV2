import { createRoot } from "react-dom/client";
import App from "./App";
import { installEvidenceCapture } from "./lib/qaContext";
import "./index.css";

/**
 * Data access goes through the typed REST client in `@/lib/api`. The previous
 * entry point mounted a tRPC client, a React Query client and a superjson
 * transformer that no routed page ever called, shipping that payload to every
 * visitor for nothing.
 */
const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing");

// Before the first render, so a crash during mounting is still captured.
installEvidenceCapture();

createRoot(container).render(<App />);
