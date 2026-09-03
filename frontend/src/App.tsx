import { useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { BorrowerView } from "./components/BorrowerView";
import { HomeView } from "./components/HomeView";
import { LenderView } from "./components/LenderView";
import { SiteFooter } from "./components/SiteFooter";
import { PRODUCT_CONFIG } from "./config/product";
import {
  evaluatePolicy,
  INITIAL_DEMO_STATE,
  type AppView,
  type DemoState,
} from "./state/demo";

export default function App() {
  const [view, setView] = useState<AppView>("overview");
  const [demo, setDemo] = useState<DemoState>(INITIAL_DEMO_STATE);

  useEffect(() => {
    document.title = PRODUCT_CONFIG.name;
  }, []);

  useEffect(() => {
    if (demo.proofStatus !== "generating") return;
    const timer = window.setTimeout(() => {
      setDemo((current) => ({ ...current, proofStatus: "ready" }));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [demo.proofStatus]);

  useEffect(() => {
    if (demo.verificationStatus !== "verifying") return;
    const timer = window.setTimeout(() => {
      setDemo((current) => {
        const eligible = evaluatePolicy(current.policy).every((result) => result.passed);
        return {
          ...current,
          verificationStatus: eligible ? "eligible" : "ineligible",
        };
      });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [demo.verificationStatus]);

  const connectWallet = () => {
    setDemo((current) => ({ ...current, walletConnected: true }));
  };

  const disconnectWallet = () => {
    setDemo((current) => ({
      ...current,
      walletConnected: false,
      termsConfirmed: false,
      proofStatus: "idle",
      requestPublished: false,
      verificationStatus: "idle",
      offerStatus: "none",
    }));
  };

  const loadSampleRequest = () => {
    setDemo((current) => ({
      ...current,
      walletConnected: true,
      termsConfirmed: true,
      proofStatus: "ready",
      requestPublished: true,
      verificationStatus: "idle",
      offerStatus: "none",
    }));
    setView("lender");
  };

  const startFromOverview = (nextView: Extract<AppView, "borrower" | "lender">) => {
    if (nextView === "lender" && !demo.requestPublished) {
      loadSampleRequest();
      return;
    }
    setView(nextView);
  };

  const resetDemo = () => {
    setDemo(INITIAL_DEMO_STATE);
    setView("overview");
  };

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        walletConnected={demo.walletConnected}
        onNavigate={setView}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        onReset={resetDemo}
      />

      <main className="page-shell">
        {view === "overview" ? <HomeView onStart={startFromOverview} /> : null}
        {view === "borrower" ? (
          <BorrowerView
            demo={demo}
            setDemo={setDemo}
            onConnect={connectWallet}
            onOpenLender={() => setView("lender")}
          />
        ) : null}
        {view === "lender" ? (
          <LenderView
            demo={demo}
            setDemo={setDemo}
            onLoadSample={loadSampleRequest}
            onOpenBorrower={() => setView("borrower")}
          />
        ) : null}
      </main>

      <SiteFooter onNavigate={setView} />
    </div>
  );
}
