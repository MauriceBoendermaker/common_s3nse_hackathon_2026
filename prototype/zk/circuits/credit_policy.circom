pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Proves an applicant's private financial snapshot satisfies a lender's policy,
// binding the result to one policy, one intended verifier and one expiry.
template CreditPolicy(nBits) {
    // ---- private witness (never leaves the prover) ----
    signal input assets;              // total portfolio value, USD units
    signal input debtRatio;           // percent, 0..100
    signal input historyMonths;       // account age in months
    signal input restrictedExposure;  // 0 or 1
    signal input passportSalt;        // blinding factor for the commitment

    // ---- policy (private here, revealed only as a hash) ----
    signal input minAssets;
    signal input maxDebtRatio;
    signal input minHistoryMonths;
    signal input screenExposure;      // 0 or 1

    // ---- public inputs ----
    signal input policyHash;          // Poseidon(minAssets, maxDebtRatio, minHistoryMonths, screenExposure)
    signal input verifierCommitment;  // binds proof to one lender
    signal input expiry;              // unix seconds
    signal input nullifier;           // Poseidon(passportSalt, policyHash, verifierCommitment)

    // ---- public outputs ----
    signal output passportCommitment;
    signal output eligible;

    // booleans must actually be boolean
    restrictedExposure * (restrictedExposure - 1) === 0;
    screenExposure * (screenExposure - 1) === 0;

    // assets >= minAssets
    component assetsOk = GreaterEqThan(nBits);
    assetsOk.in[0] <== assets;
    assetsOk.in[1] <== minAssets;

    // debtRatio <= maxDebtRatio
    component debtOk = LessEqThan(nBits);
    debtOk.in[0] <== debtRatio;
    debtOk.in[1] <== maxDebtRatio;

    // historyMonths >= minHistoryMonths
    component historyOk = GreaterEqThan(nBits);
    historyOk.in[0] <== historyMonths;
    historyOk.in[1] <== minHistoryMonths;

    // exposure clean OR screen not requested  =>  1 - screenExposure*restrictedExposure
    signal exposureViolation;
    exposureViolation <== screenExposure * restrictedExposure;
    signal exposureOk;
    exposureOk <== 1 - exposureViolation;

    // the policy hash the lender sees must match the policy actually enforced
    component ph = Poseidon(4);
    ph.inputs[0] <== minAssets;
    ph.inputs[1] <== maxDebtRatio;
    ph.inputs[2] <== minHistoryMonths;
    ph.inputs[3] <== screenExposure;
    ph.out === policyHash;

    // nullifier binds this proof to (passport, policy, verifier) - stops replay elsewhere
    component nf = Poseidon(3);
    nf.inputs[0] <== passportSalt;
    nf.inputs[1] <== policyHash;
    nf.inputs[2] <== verifierCommitment;
    nf.out === nullifier;

    // commitment to the private snapshot, publishable without leaking it
    component pc = Poseidon(5);
    pc.inputs[0] <== assets;
    pc.inputs[1] <== debtRatio;
    pc.inputs[2] <== historyMonths;
    pc.inputs[3] <== restrictedExposure;
    pc.inputs[4] <== passportSalt;
    passportCommitment <== pc.out;

    // eligible = AND of all four checks
    signal a;  a  <== assetsOk.out * debtOk.out;
    signal b;  b  <== historyOk.out * exposureOk;
    eligible <== a * b;

    // expiry is a public input carried into the proof so it cannot be swapped
    signal expiryBinding;
    expiryBinding <== expiry * expiry;
}

component main {public [policyHash, verifierCommitment, expiry, nullifier]} = CreditPolicy(64);
