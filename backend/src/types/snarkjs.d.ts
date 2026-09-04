/**
 * Minimal ambient types for snarkjs 0.7.6, which ships no declarations.
 *
 * Deliberately narrow: this backend calls exactly one snarkjs function,
 * `groth16.verify`, and declaring only that keeps a future "let's just prove on
 * the server" shortcut from compiling by accident. Browser proving is the
 * property the security page claims (the private snapshot never leaves the
 * device); a server-side `fullProve` would quietly make that copy false.
 *
 * `frontend/src/borrower/snarkjs.d.ts` is the browser-side twin and declares
 * `fullProve` instead, because that is what the prover worker calls.
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
     * `publicSignals` is an ARRAY of decimal strings in the circuit's wire
     * order. Its order is part of the statement being verified: the same
     * values in a different order verify against a different claim, which is
     * why `verifier.ts` re-encodes them from the generated signal layout
     * rather than trusting the array a client sent.
     */
    verify(
      verificationKey: unknown,
      publicSignals: readonly string[],
      proof: unknown,
    ): Promise<boolean>;
  };
}
