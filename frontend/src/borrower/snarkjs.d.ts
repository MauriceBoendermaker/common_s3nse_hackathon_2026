/**
 * Minimal ambient types for snarkjs 0.7.6, which ships no declarations.
 *
 * BORROWER-ONLY, and deliberately so. It declares `groth16.fullProve` and
 * nothing else: proving happens in the applicant's browser, in the borrower
 * chunk, and never on the lender side or on the server. The backend has its own
 * twin (`backend/src/types/snarkjs.d.ts`) that declares only `verify`, so a
 * "let's just prove it server-side" shortcut would not even compile — which is
 * the point, because it would quietly make the security page's central claim
 * (the portfolio snapshot never leaves the device) false.
 *
 * snarkjs resolves to `build/browser.esm.js` here via its `exports.browser`
 * condition, which Vite applies automatically. Verified in the built output:
 * `npm run build -w frontend` emits the prover worker as its own chunk with the
 * browser ESM build inlined.
 */
declare module "snarkjs" {
  /** A snarkjs Groth16 proof: decimal strings in projective coordinates. */
  export type Groth16Proof = {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };

  export const groth16: {
    /**
     * `wasm` and `zkey` accept a `Uint8Array` as well as a URL: fastfile wraps
     * a byte array as an in-memory file. That is what makes artifact reuse
     * across proofs possible — fetch 4.6 MB once, prove many times.
     *
     * `publicSignals` comes back as an ARRAY of decimal strings in the
     * circuit's wire order. The order is part of the statement; see
     * `frontend/src/shared/signalLayout.ts`, which is generated from the
     * compiled circuit.
     */
    fullProve(
      input: Record<string, string>,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
  };
}
