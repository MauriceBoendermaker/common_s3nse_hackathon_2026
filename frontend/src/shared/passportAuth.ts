/**
 * The message Phantom signs to authorise a passport read. MIRRORED in
 * `backend/src/routes/passport.ts` — change both or neither.
 */
export function portfolioAuthMessage(address: string, issuedAt: string): string {
  return [
    "ZKredit - portfolio read authorisation (v1)",
    "",
    `Address: ${address}`,
    `Issued: ${issuedAt}`,
    "",
    "This signature proves you control this address so a private credit",
    "passport can be read for it. It authorises no transaction and moves no funds.",
  ].join("\n");
}
