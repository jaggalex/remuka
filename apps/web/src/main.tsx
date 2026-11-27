import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@remo/ui";
import { App } from "./App";
import { OperatorConsole } from "./operator/OperatorConsole";
import { ConsentProvider } from "./ConsentProvider";
import { HelpPage } from "./help/HelpPage";
import { I18nProvider } from "./i18n";
import { StageBanner } from "./StageBanner";
// Design-system tokens, self-hosted Inter and component styles. The product's own
// stylesheet comes second and stays unlayered, so it can override the package
// without specificity games (ADR-078).
import "@remo/ui/styles.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

// Public help is rendered before the board shell, so it works without a session
// (ADR-081). It is a static, bundled page, not a second application.
if (window.location.pathname === "/help" || window.location.pathname.startsWith("/help/")) {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <StageBanner />
        {/* The notice, the banner and «Настройки cookie» belong to every public screen
            of one zone, help included (ADR-255 §6.3). */}
        <ConsentProvider>
          <HelpPage />
        </ConsentProvider>
      </I18nProvider>
    </StrictMode>,
  );
} else if (
  window.location.pathname === "/operator" ||
  window.location.pathname.startsWith("/operator/")
) {
  // The installation operator's console (ADR-259 §5). It is its own shell: a room and a
  // workspace never mount here, and the service answers 404 to anyone without the role.
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <StageBanner />
        <OperatorConsole />
      </I18nProvider>
    </StrictMode>,
  );
} else if (import.meta.env.DEV && window.location.pathname.startsWith("/__ds")) {
  // The design-system catalogue is a dev-only route (spec/design-system.md §9): it never
  // ships in a production build, and loading it does not pull @remo/ui styles into the app.
  void import("./ds/Catalog").then(({ mountCatalog }) => mountCatalog(container));
} else {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <StageBanner />
        {/* One toaster for the workspace and the rooms: floating messages (ADR-319). */}
        <ToastProvider>
          <ConsentProvider>
            <App />
          </ConsentProvider>
        </ToastProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
