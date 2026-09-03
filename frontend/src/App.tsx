import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { BorrowerView } from "./components/BorrowerView";
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
import { LenderView } from "./components/LenderView";
import { SiteFooter } from "./components/SiteFooter";
import { WalletActionDialog } from "./components/WalletActionDialog";
import {
  resolveView,
  VIEW_DESCRIPTIONS,
  VIEW_PATHS,
  VIEW_TITLES,
  type SiteView,
} from "./config/navigation";
import { PRODUCT_CONFIG } from "./config/product";
import {
  evaluatePolicy,
  getCapitalOffers,
  getTotalRepayment,
  INITIAL_DEMO_STATE,
  type AppView,
  type DemoState,
  type WalletActionKind,
  type WalletActionState,
} from "./state/demo";

export default function App() {
  const [view, setView] = useState<SiteView>(() => resolveView(window.location.pathname));
  const [demo, setDemo] = useState<DemoState>(INITIAL_DEMO_STATE);
  const [walletAction, setWalletAction] = useState<WalletActionState | null>(null);

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
    const normalizedPath = window.location.pathname.length > 1
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
        if (current.proofStatus === "expired") {
          return { ...current, verificationStatus: "expired" };
        }
        const policy = current.challengePolicy ?? current.policy;
        const eligible = evaluatePolicy(policy).every((result) => result.passed);
        return {
          ...current,
          verificationStatus: eligible ? "eligible" : "ineligible",
          noQualifyingOffers: !eligible,
        };
      });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [demo.verificationStatus]);

  const confirmingAction = walletAction?.status === "confirming" ? walletAction.kind : null;

  useEffect(() => {
    if (!confirmingAction) return;
    const timer = window.setTimeout(() => {
      setDemo((current) => {
        switch (confirmingAction) {
          case "connect-applicant":
            return {
              ...current,
              applicantWalletConnected: true,
              ensVerified: true,
              connectedSources: current.connectedSources.includes("wallets")
                ? current.connectedSources
                : [...current.connectedSources, "wallets"],
            };
          case "connect-provider":
            return { ...current, providerWalletConnected: true };
          case "publish-request":
            return { ...current, requestPublished: true };
          case "fund-offer":
            return {
              ...current,
              offerStatus: "funded",
              offersAvailable: true,
              noQualifyingOffers: false,
            };
          case "accept-offer":
            return { ...current, offerStatus: "accepted", loanStatus: "funded" };
          case "draw-loan":
            return { ...current, loanStatus: "active" };
          case "repay-loan":
            return { ...current, loanStatus: "repaid" };
        }
      });
      setWalletAction((current) => current ? { ...current, status: "confirmed" } : null);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [confirmingAction]);

  const beginWalletAction = useCallback((kind: WalletActionKind) => {
    setWalletAction({
      kind,
      status: demo.walletNetwork === "sepolia" ? "awaiting_signature" : "wrong_network",
    });
  }, [demo.walletNetwork]);

  const disconnectWallet = () => {
    if (view === "lender") {
      setDemo((current) => ({ ...current, providerWalletConnected: false }));
      return;
    }
    setDemo((current) => ({
      ...INITIAL_DEMO_STATE,
      providerWalletConnected: current.providerWalletConnected,
      walletNetwork: current.walletNetwork,
    }));
  };

  const loadSampleRequest = () => {
    setDemo({
      ...INITIAL_DEMO_STATE,
      applicantWalletConnected: true,
      providerWalletConnected: true,
      walletNetwork: "sepolia",
      ensVerified: true,
      identityConfirmed: true,
      connectedSources: ["wallets", "lending", "exchange"],
      passportReady: true,
      requestPublished: true,
    });
    navigate("lender");
  };

  const startFromOverview = (nextView: Extract<AppView, "borrower" | "lender">) => {
    if (nextView === "lender" && !demo.requestPublished) {
      loadSampleRequest();
      return;
    }
    navigate(nextView);
  };

  const resetDemo = () => {
    setDemo(INITIAL_DEMO_STATE);
    setWalletAction(null);
    navigate("overview");
  };

  const isProviderView = view === "lender";
  const walletConnected = isProviderView
    ? demo.providerWalletConnected
    : demo.applicantWalletConnected;
  const walletIdentity = isProviderView ? PRODUCT_CONFIG.lender : PRODUCT_CONFIG.borrower;
  const offers = getCapitalOffers(demo);
  const selectedOffer = offers.find((offer) => offer.id === demo.selectedOfferId) ?? offers[0];
  const walletActionAmount = walletAction?.kind === "repay-loan"
    ? getTotalRepayment(demo.amount, selectedOffer.apr, demo.termDays, selectedOffer.fee)
    : demo.amount;

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        walletConnected={walletConnected}
        walletIdentity={walletIdentity}
        onNavigate={navigate}
        onConnect={() => beginWalletAction(isProviderView ? "connect-provider" : "connect-applicant")}
        onDisconnect={disconnectWallet}
        onReset={resetDemo}
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
          <BorrowerView
            demo={demo}
            setDemo={setDemo}
            onWalletAction={beginWalletAction}
            onOpenLender={() => navigate("lender")}
          />
        ) : null}
        {view === "lender" ? (
          <LenderView
            demo={demo}
            setDemo={setDemo}
            onLoadSample={loadSampleRequest}
            onOpenBorrower={() => navigate("borrower")}
            onWalletAction={beginWalletAction}
          />
        ) : null}
      </main>

      <SiteFooter onNavigate={navigate} />

      {walletAction ? (
        <WalletActionDialog
          action={walletAction}
          amount={walletActionAmount}
          onSwitchNetwork={() => {
            setDemo((current) => ({ ...current, walletNetwork: "sepolia" }));
            setWalletAction((current) => current ? { ...current, status: "awaiting_signature" } : null);
          }}
          onConfirm={() => setWalletAction((current) => current ? { ...current, status: "confirming" } : null)}
          onReject={() => setWalletAction((current) => current ? { ...current, status: "rejected" } : null)}
          onFail={() => setWalletAction((current) => current ? { ...current, status: "failed" } : null)}
          onRetry={() => setWalletAction((current) => current ? { ...current, status: "awaiting_signature" } : null)}
          onClose={() => setWalletAction(null)}
        />
      ) : null}
    </div>
  );
}
