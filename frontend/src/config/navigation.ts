import type { AppView } from "../state/demo";

export const PRIMARY_NAVIGATION: Array<{ view: AppView; label: string }> = [
  { view: "overview", label: "Overview" },
  { view: "borrower", label: "Request credit" },
  { view: "lender", label: "Provide capital" },
];
