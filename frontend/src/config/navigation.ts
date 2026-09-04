import type { AppView } from "../state/types";

export type ContentView =
  | "how-it-works"
  | "security"
  | "for-borrowers"
  | "for-capital-providers"
  | "faq"
  | "about"
  | "privacy"
  | "terms"
  | "risk-disclosures";

export type SiteView = AppView | ContentView;

export type NavigationItem = {
  view: SiteView;
  label: string;
};

export const APP_NAVIGATION = [
  { view: "overview", label: "Market" },
  { view: "borrower", label: "Borrow" },
  { view: "lender", label: "Lend" },
] satisfies Array<{ view: AppView; label: string }>;

export const PUBLIC_NAVIGATION: NavigationItem[] = [
  { view: "how-it-works", label: "How it works" },
  { view: "security", label: "Security" },
  { view: "for-borrowers", label: "Borrowers" },
  { view: "for-capital-providers", label: "Capital providers" },
  { view: "faq", label: "FAQ" },
];

export const FOOTER_NAVIGATION = {
  Product: [
    { view: "how-it-works", label: "How it works" },
    { view: "for-borrowers", label: "For borrowers" },
    { view: "for-capital-providers", label: "For capital providers" },
  ],
  Resources: [
    { view: "security", label: "Security & trust" },
    { view: "faq", label: "FAQ" },
    { view: "about", label: "About" },
  ],
  Legal: [
    { view: "privacy", label: "Privacy" },
    { view: "terms", label: "Terms" },
    { view: "risk-disclosures", label: "Risk disclosures" },
  ],
} satisfies Record<string, NavigationItem[]>;

export const VIEW_PATHS: Record<SiteView, string> = {
  overview: "/",
  borrower: "/request-credit",
  lender: "/provide-capital",
  "how-it-works": "/how-it-works",
  security: "/security",
  "for-borrowers": "/for-borrowers",
  "for-capital-providers": "/for-capital-providers",
  faq: "/faq",
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  "risk-disclosures": "/risk-disclosures",
};

const PATH_VIEWS = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as SiteView]),
);

export const VIEW_TITLES: Record<SiteView, string> = {
  overview: "Private Credit — Marketplace",
  borrower: "Borrow | Private Credit",
  lender: "Lend | Private Credit",
  "how-it-works": "How it works | Private Credit",
  security: "Security & trust | Private Credit",
  "for-borrowers": "For borrowers | Private Credit",
  "for-capital-providers": "For capital providers | Private Credit",
  faq: "FAQ | Private Credit",
  about: "About | Private Credit",
  privacy: "Privacy notice | Private Credit",
  terms: "Terms of use | Private Credit",
  "risk-disclosures": "Risk disclosures | Private Credit",
};

export const VIEW_DESCRIPTIONS: Record<SiteView, string> = {
  overview: "A private credit marketplace: prove eligibility with a zero-knowledge passport, get paid to an ENS-derived address on Solana.",
  borrower: "Create a private credit request backed by a sealed eligibility proof.",
  lender: "Review a credit request and verify policy claims without receiving raw portfolio data.",
  "how-it-works": "Follow a private credit request from ENS identity and portfolio inputs to proof verification and an offer.",
  security: "Understand the privacy boundary, trust assumptions, limitations, and prototype security status.",
  "for-borrowers": "Learn how applicants can prove eligibility, request credit, compare offers, and protect portfolio details.",
  "for-capital-providers": "Learn how providers configure policies, verify sealed claims, price risk, and integrate.",
  faq: "Answers about wallets, networks, proof expiration, privacy, decisions, costs, and settlement.",
  about: "The mission, team, and hackathon context behind Private Credit.",
  privacy: "How the Private Credit prototype handles data and where metadata may remain observable.",
  terms: "Terms for using the experimental Private Credit prototype.",
  "risk-disclosures": "Important technical, financial, privacy, and regulatory risks of the prototype.",
};

export function resolveView(pathname: string): SiteView {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/trust") return "security";
  return PATH_VIEWS.get(normalized) ?? "overview";
}

export function isApplicationView(view: SiteView): view is Extract<AppView, "borrower" | "lender"> {
  return view === "borrower" || view === "lender";
}
