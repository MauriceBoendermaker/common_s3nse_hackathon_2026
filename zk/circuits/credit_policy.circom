pragma circom 2.1.6;

include "poseidon.circom";
include "comparators.circom";
include "bitify.circom";

/*
 * Private Credit - underwriting policy circuit.
 *
 * Proves that a private portfolio snapshot satisfies a lender's policy, and
 * binds the result to one policy, one intended verifier, one subject and one
 * expiry - WITHOUT revealing any of the numbers behind it.
 *
 * ---------------------------------------------------------------- contract
 * The public signal layout is a contract shared by four implementations:
 * this circuit, `backend/src/protocol/types.ts` (PublicSignals), the
 * frontend prover, and the future Solana program's VK_* constants.
 *
 *   [0] passportCommitment   output
 *   [1] eligible             output   (a BIT, never an assertion - see below)
 *   [2] policyHash           public input
 *   [3] subjectCommitment    public input
 *   [4] expiry               public input
 *   [5] nullifier            public input
 *   [6] verifierCommitment   public input
 *
 * snarkjs orders the public witness as [outputs..., public inputs...] in
 * declaration order, so the declaration order below IS the wire order.
 * `zk/build.mjs` re-derives the order from the compiled `.sym` and FAILS THE
 * BUILD if it stops matching the list above. Do not reorder the declarations
 * without re-running the build.
 *
 * Poseidon arities and argument order must match
 * `backend/src/protocol/policy.ts` EXACTLY:
 *   policyHash          = Poseidon4(minAssets, minCollateralQuality,
 *                                   minHistoryMonths, screenExposure)
 *   passportCommitment  = Poseidon5(assets, collateralQuality, historyMonths,
 *                                   restrictedExposure, passportSalt)
 *   nullifier           = Poseidon3(passportSalt, policyHash, verifierCommitment)
 *   subjectCommitment   = Poseidon2(subjectId, blindingFactor)
 * If they diverge, proofs fail verification with no useful error.
 *
 * ---------------------------------------------------- what changed vs. v0
 * `debtRatio` is gone. Real borrow positions cannot be honestly read from
 * Solana RPC in the time available, so workstream B replaced it with
 * `collateralQuality`: the percent of the portfolio held in allowlisted
 * stablecoins and liquid staking tokens. The comparison therefore FLIPS -
 * it was `debtRatio <= maxDebtRatio`, it is now
 * `collateralQuality >= minCollateralQuality`.
 */

template CreditPolicy() {
    // Range-check widths. See the soundness note at section 1.
    var AMOUNT_BITS  = 40;   // USD units; 2^40 ~ $1.1 trillion
    var QUALITY_BITS = 7;    // percent 0..127, additionally asserted <= 100
    var MONTH_BITS   = 16;   // ~5461 years of account history
    var EXPIRY_BITS  = 40;   // unix seconds; 2^40 s ~ year 36812

    // ---- private witness (never leaves the prover's device) ----
    signal input assets;              // total allowlisted portfolio value, whole USD
    signal input collateralQuality;   // percent 0..100 in stables + LSTs
    signal input historyMonths;       // months of on-chain history (null commits as 0)
    signal input restrictedExposure;  // 0 or 1
    signal input passportSalt;        // blinding factor for the passport commitment

    // ---- the policy itself: private here, revealed only through its hash ----
    signal input minAssets;
    signal input minCollateralQuality;
    signal input minHistoryMonths;
    signal input screenExposure;      // 0 or 1

    // ---- private subject preimage ----
    signal input subjectId;           // utf8ToField(subjectId), computed outside the circuit
    signal input blindingFactor;      // what makes the subject commitment hiding

    // ---- public outputs (public signals [0] and [1]) ----
    signal output passportCommitment;
    signal output eligible;

    // ---- public inputs (public signals [2]..[6]) ----
    signal input policyHash;
    signal input subjectCommitment;
    signal input expiry;
    signal input nullifier;
    signal input verifierCommitment;

    // =====================================================================
    // 1. RANGE-CHECK EVERY AMOUNT BEFORE IT REACHES A COMPARATOR.
    //
    // THIS IS SOUNDNESS, NOT DECORATION. DO NOT DELETE IT AS A
    // "SIMPLIFICATION". circomlib's LessThan/GreaterEqThan are only sound
    // when both inputs are known to fit in n bits. Without these Num2Bits
    // gadgets a malicious prover supplies p-1 (the field's "-1"), the
    // comparator's internal Num2Bits overflows, and the comparison silently
    // flips - the circuit still compiles, still produces a proof, and the
    // proof still verifies. The forgery is invisible from the outside.
    //
    // The policy thresholds are range-checked too: they are private inputs
    // here (only their Poseidon hash is public), so the prover controls them
    // just as much as the witness values.
    // =====================================================================
    component rcAssets     = Num2Bits(AMOUNT_BITS);  rcAssets.in     <== assets;
    component rcQuality    = Num2Bits(QUALITY_BITS); rcQuality.in    <== collateralQuality;
    component rcHistory    = Num2Bits(MONTH_BITS);   rcHistory.in    <== historyMonths;
    component rcMinAssets  = Num2Bits(AMOUNT_BITS);  rcMinAssets.in  <== minAssets;
    component rcMinQuality = Num2Bits(QUALITY_BITS); rcMinQuality.in <== minCollateralQuality;
    component rcMinHistory = Num2Bits(MONTH_BITS);   rcMinHistory.in <== minHistoryMonths;

    // `expiry` is a public input that must appear in at least one constraint,
    // otherwise its IC coefficient is zero and the verifier accepts ANY
    // expiry - the binding would be cosmetic. A range check both binds it and
    // rejects nonsense timestamps.
    component rcExpiry = Num2Bits(EXPIRY_BITS); rcExpiry.in <== expiry;

    // Percentages are percentages. 7 bits allows 0..127, so clamp the top end.
    component qualityInRange = LessEqThan(QUALITY_BITS + 1);
    qualityInRange.in[0] <== collateralQuality;
    qualityInRange.in[1] <== 100;
    qualityInRange.out === 1;

    component minQualityInRange = LessEqThan(QUALITY_BITS + 1);
    minQualityInRange.in[0] <== minCollateralQuality;
    minQualityInRange.in[1] <== 100;
    minQualityInRange.out === 1;

    // Booleans must actually be boolean.
    restrictedExposure * (restrictedExposure - 1) === 0;
    screenExposure * (screenExposure - 1) === 0;

    // =====================================================================
    // 2. The four underwriting comparisons.
    //
    // Comparator width is range width + 1: GreaterEqThan(n) internally adds
    // 2^n to a difference, so an input that occupies all n bits would overflow
    // its own Num2Bits(n+1).
    // =====================================================================

    // assets >= minAssets
    component assetsOk = GreaterEqThan(AMOUNT_BITS + 1);
    assetsOk.in[0] <== assets;
    assetsOk.in[1] <== minAssets;

    // collateralQuality >= minCollateralQuality   (FLIPPED from the old debtRatio test)
    component qualityOk = GreaterEqThan(QUALITY_BITS + 1);
    qualityOk.in[0] <== collateralQuality;
    qualityOk.in[1] <== minCollateralQuality;

    // historyMonths >= minHistoryMonths
    component historyOk = GreaterEqThan(MONTH_BITS + 1);
    historyOk.in[0] <== historyMonths;
    historyOk.in[1] <== minHistoryMonths;

    // exposure clean OR screening not requested  =>  1 - screenExposure*restrictedExposure
    signal exposureViolation;
    exposureViolation <== screenExposure * restrictedExposure;
    signal exposureOk;
    exposureOk <== 1 - exposureViolation;

    // =====================================================================
    // 3. Bindings. Each of these makes one public input load-bearing.
    // =====================================================================

    // The policy hash the lender published must be the policy actually enforced.
    component ph = Poseidon(4);
    ph.inputs[0] <== minAssets;
    ph.inputs[1] <== minCollateralQuality;
    ph.inputs[2] <== minHistoryMonths;
    ph.inputs[3] <== screenExposure;
    ph.out === policyHash;

    // The nullifier binds (passport salt, policy, verifier) so a receipt
    // issued to lender A cannot be replayed at lender B, and is spendable once.
    // verifierCommitment is PUBLIC on purpose: were it private, a prover could
    // compute the nullifier against a verifier of their choosing and the
    // binding would mean nothing.
    component nf = Poseidon(3);
    nf.inputs[0] <== passportSalt;
    nf.inputs[1] <== policyHash;
    nf.inputs[2] <== verifierCommitment;
    nf.out === nullifier;

    // The subject commitment is SALTED. A raw ENS namehash is an unsalted,
    // publicly computable function of the name - a rainbow table inverts it
    // instantly and "the name never appears on-chain" would be false.
    component sc = Poseidon(2);
    sc.inputs[0] <== subjectId;
    sc.inputs[1] <== blindingFactor;
    sc.out === subjectCommitment;

    // Commitment to the private snapshot, published with the credit request
    // BEFORE any lender issues a policy challenge. Without that ordering the
    // borrower would simply pick numbers that satisfy the policy they were
    // just handed, and the proof would prove nothing.
    component pc = Poseidon(5);
    pc.inputs[0] <== assets;
    pc.inputs[1] <== collateralQuality;
    pc.inputs[2] <== historyMonths;
    pc.inputs[3] <== restrictedExposure;
    pc.inputs[4] <== passportSalt;
    passportCommitment <== pc.out;

    // =====================================================================
    // 4. eligible is an OUTPUT BIT, NOT AN ASSERTION.
    //
    // Do not "tighten" this into `=== 1`. The lender must be able to receive
    // a VALID proof that says "not eligible" - that is precisely the claim
    // "the provider only ever received failed public outputs, never the values
    // that caused them". Asserting eligibility instead would mean a rejected
    // applicant produces no proof at all, and the lender learns nothing it can
    // verify, which is a strictly worse privacy story and a strictly worse
    // product.
    // =====================================================================
    signal partA;  partA <== assetsOk.out * qualityOk.out;
    signal partB;  partB <== historyOk.out * exposureOk;
    eligible <== partA * partB;
}

component main {public [
    policyHash, subjectCommitment, expiry, nullifier, verifierCommitment
]} = CreditPolicy();
