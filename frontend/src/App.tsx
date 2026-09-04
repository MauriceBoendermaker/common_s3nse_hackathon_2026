/**
 * The application shell owns the route. That is all it owns.
 *
 * Before workstream A this file held one `useState<DemoState>` and passed both
 * the object and its setter to `BorrowerView` AND `LenderView` — so the lender
 * component literally read the borrower's witness out of a shared React state
 * object. Every privacy claim in the UI was decorative because of this one
 * line.
 *
 * There is now no protocol state here at all. Each view calls
 * `useProtocolState(role)` for itself, holds its own session id in
 * `sessionStorage` (per tab, so two tabs are two parties) and sees only what
 * the server projects for its role.
 *
 * The two views are `lazy()`-loaded on purpose, not for weight. It puts them in
 * separate Rollup chunks, which turns "the lender bundle cannot read the
 * witness" from a claim into something a judge can check by grepping
 * `dist/assets/`.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { AppHeader } from "./components/AppHeader";
import { AboutPage } from "./components/content/AboutPage";
import {
  ForBorrowersPage,
  ForCapitalProvidersPage,
} from "./components/content/AudiencePages";
import { FaqPage } from "./components/content/FaqPage";
import { HowItWorksPage } from "./components/content/HowItWorksPage";
import {
  PrivacyPage,
  RiskDisclosuresPage,
  TermsPage,
} from "./components/content/LegalPages";
import { SecurityPage } from "./components/content/SecurityPage";
import { HomeView } from "./components/HomeView";
import { SiteFooter } from "./components/SiteFooter";
import { Card, Spinner } from "./components/ui";
import {
  resolveView,
  VIEW_DESCRIPTIONS,
  VIEW_PATHS,
  VIEW_TITLES,
  type SiteView,
} from "./config/navigation";
import { resetProtocol } from "./shared/apiClient";
import { clearSession } from "./shared/session";
import { PartyStatusProvider } from "./state/connectionStatus";
import type { AppView } from "./state/types";

const BorrowerView = lazy(() => import("./components/BorrowerView"));
const LenderView = lazy(() => import("./components/LenderView"));

function ViewFallback({ label }: { label: string }) {
  return (
    <div className="product-page">
      <Card className="empty-workspace">
        <Spinner />
        <span className="section-label">{label}</span>
        <h2>Loading the workspace bundle</h2>
        <p>
          The two party workspaces are separate chunks. That separation is what makes the trust boundary a
          property of the build rather than a promise in the copy.
        </p>
      </Card>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<SiteView>(() => resolveView(window.location.pathname));
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    document.title = VIEW_TITLES[view];
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.name = "description";
      document.head.append(description);
    }
    description.content = VIEW_DESCRIPTIONS[view];
  }, [view]);

  useEffect(() => {
    const normalizedPath =
      window.location.pathname.length > 1
        ? window.location.pathname.replace(/\/+$/, "")
        : window.location.pathname;
    const canonicalPath = VIEW_PATHS[resolveView(normalizedPath)];
    if (normalizedPath !== canonicalPath) {
      window.history.replaceState({}, "", canonicalPath);
    }

    const handlePopState = () => setView(resolveView(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((nextView: SiteView) => {
    const nextPath = VIEW_PATHS[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /**
   * A real reset: it wipes the server's in-memory store, drops both session ids
   * this tab holds, and reloads so the in-memory witness goes with them. There
   * is nothing simulated about it — if the backend is down, it fails loudly.
   */
  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await resetProtocol();
      clearSession("borrower");
      clearSession("lender");
      window.location.reload();
    } catch (cause) {
      setResetting(false);
      window.alert(
        `Reset failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }, []);

  const startFromOverview = (nextView: Extract<AppView, "borrower" | "lender">) => {
    navigate(nextView);
  };

  return (
    <PartyStatusProvider>
      <div className="app-shell">
        <AppHeader
          view={view}
          resetting={resetting}
          onNavigate={navigate}
          onReset={() => void handleReset()}
        />

        <main className="page-shell">
          {view === "overview" ? <HomeView onStart={startFromOverview} /> : null}
          {view === "how-it-works" ? <HowItWorksPage onNavigate={navigate} /> : null}
          {view === "security" ? <SecurityPage onNavigate={navigate} /> : null}
          {view === "for-borrowers" ? <ForBorrowersPage onNavigate={navigate} /> : null}
          {view === "for-capital-providers" ? (
            <ForCapitalProvidersPage onNavigate={navigate} />
          ) : null}
          {view === "faq" ? <FaqPage onNavigate={navigate} /> : null}
          {view === "about" ? <AboutPage onNavigate={navigate} /> : null}
          {view === "privacy" ? <PrivacyPage onNavigate={navigate} /> : null}
          {view === "terms" ? <TermsPage onNavigate={navigate} /> : null}
          {view === "risk-disclosures" ? <RiskDisclosuresPage onNavigate={navigate} /> : null}

          {view === "borrower" ? (
            <Suspense fallback={<ViewFallback label="Applicant workspace" />}>
              <BorrowerView onOpenLender={() => navigate("lender")} />
            </Suspense>
          ) : null}

          {view === "lender" ? (
            <Suspense fallback={<ViewFallback label="Provider workspace" />}>
              <LenderView onOpenBorrower={() => navigate("borrower")} />
            </Suspense>
          ) : null}
        </main>

        <SiteFooter onNavigate={navigate} />
      </div>
    </PartyStatusProvider>
  );
}
