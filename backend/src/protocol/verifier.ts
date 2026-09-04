/**
 * The Groth16 verifier. Workstream C, part 2.
 *
 * Until this file existed, `POST /api/proofs/:id/verify` recorded
 * `groth16_verified` as NOT PERFORMED, because a check that cannot be run must
 * never be reported as one that passed. It can be run now: the verifying key
 * produced by `zk/build.mjs` is loaded at boot and every submitted proof is
 * checked against it with `snarkjs.groth16.verify`.
 *
 * THREE RULES, each of them the difference between a verifier and a rubber
 * stamp:
 *
 *  1. FAIL CLOSED, ALWAYS. If the verifying key is missing, unparseable, or
 *     disagrees with the copy the browser proves against, every verification
 *     returns `ok: false` with a detail that names the reason. There is no
 *     branch in this file that returns `ok: true` without snarkjs having said
 *     so first. A verifier that passes by default is worse than no verifier,
 *     because it looks like one.
 *
 *  2. THE ARRAY ORDER IS PART OF THE STATEMENT. snarkjs verifies a proof
 *     against an ORDERED array of field elements. The same seven values in a
 *     different order are a different claim. The wire carries `PublicSignals`
 *     as a named object, so this file re-encodes that object into the array
 *     using the order in `zk/build/signal_layout.json` — the file the build
 *     DERIVED from the compiled `.r1cs` and `.sym` — and requires the array
 *     the prover sent to be identical to it. A client cannot renumber the
 *     statement it is proving.
 *
 *  3. ONE BUILD, TWO OUTPUTS. `zk/build/verification_key.json` (what this
 *     server verifies against) and `frontend/public/zk/verification_key.json`
 *     (what the browser's zkey was generated alongside) come from a single
 *     ceremony. Regenerating the zkey changes both. If they ever differ, every
 *     proof fails with no useful error, so the mismatch is detected at boot,
 *     shouted about, and turned into an explicit fail-closed reason rather
 *     than a mystery.
 *
 * Node 22 runs this under native type stripping: no `enum`, no `namespace`,
 * `import type` for type-only imports, `.ts` on every relative import.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as snarkjs from "snarkjs";

import type { PublicSignals } from "./types.ts";

/* ------------------------------------------------------------------ paths */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * `backend/src/protocol` in dev and `backend/dist/protocol` after `tsc`; the
 * repo root is three levels up either way, so one expression works in both and
 * there is no build-mode branch to get wrong.
 */
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** The key this server verifies against. Emitted by `zk/build.mjs`. */
export const VKEY_PATH = path.join(REPO_ROOT, "zk", "build", "verification_key.json");

/** The copy the browser's proving key was generated with. Must be identical. */
export const BROWSER_VKEY_PATH = path.join(
  REPO_ROOT,
  "frontend",
  "public",
  "zk",
  "verification_key.json",
);

/**
 * The copy inside the BUILT SPA — the bytes a browser actually downloads when
 * this server is serving `frontend/dist` statically.
 *
 * `frontend/public/zk` is only an input to `vite build`; it is not on the wire.
 * Running `npm run zk:build` AFTER `npm run build` leaves this file behind at
 * the previous ceremony, and the result is the worst failure mode in the
 * project: every proof is well formed, every proof fails, and both the server
 * and `frontend/public` insist the artifacts agree. Hashing the served copy is
 * the only way to catch it.
 */
export const SERVED_VKEY_PATH = path.join(
  REPO_ROOT,
  "frontend",
  "dist",
  "zk",
  "verification_key.json",
);

/** The generated public-signal layout, derived from the compiled circuit. */
export const LAYOUT_PATH = path.join(REPO_ROOT, "zk", "build", "signal_layout.json");

/** Where `zk/make-fixtures.mjs` writes the proofs this file's self-test uses. */
const FIXTURES_DIR = path.join(REPO_ROOT, "zk", "build", "fixtures");

/* ------------------------------------------------------------------ state */

export type CeremonyNote = { kind: string; trusted: boolean; note: string };

export type VerifierStatus = {
  /** True only when a verification could actually succeed. */
  ready: boolean;
  circuit: string | null;
  /** sha256 of the verifying key bytes. */
  vkeyHash: string | null;
  /** First 16 hex of `vkeyHash` — short enough for a UI, long enough to tie. */
  vkeyShortHash: string | null;
  /** sha256 of `frontend/public/zk/verification_key.json`. */
  browserVkeyHash: string | null;
  artifactsAgree: boolean;
  /**
   * sha256 of `frontend/dist/zk/verification_key.json`, or null when no SPA
   * has been built. This is the copy a browser downloads from this server.
   */
  servedVkeyHash: string | null;
  /**
   * True when the built SPA carries the same ceremony this server verifies
   * against. Null when there is no built SPA to check — not the same thing as
   * false, and the UI must not render "no" for "not applicable".
   */
  servedArtifactsAgree: boolean | null;
  nPublic: number | null;
  signalOrder: readonly string[];
  ceremony: CeremonyNote | null;
  /** Human-readable reasons the verifier is not ready. Empty when it is. */
  problems: string[];
};

let verifyingKey: unknown = null;

const status: VerifierStatus = {
  ready: false,
  circuit: null,
  vkeyHash: null,
  vkeyShortHash: null,
  browserVkeyHash: null,
  artifactsAgree: false,
  servedVkeyHash: null,
  servedArtifactsAgree: null,
  nPublic: null,
  signalOrder: [],
  ceremony: null,
  problems: [],
};

function sha256File(file: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * How each named public signal becomes its decimal wire value.
 *
 * Keyed by the names in `signal_layout.json`. A layout naming a signal that is
 * not in this table throws, which is the correct behaviour: the circuit grew a
 * public signal the protocol type does not carry, and guessing an encoding
 * would produce proofs that verify against the wrong statement.
 */
const ENCODERS: Record<string, (signals: PublicSignals) => string> = {
  passportCommitment: (s) => BigInt(s.passportCommitment).toString(),
  eligible: (s) => (s.eligible ? "1" : "0"),
  policyHash: (s) => BigInt(s.policyHash).toString(),
  subjectCommitment: (s) => BigInt(s.subjectCommitment).toString(),
  expiry: (s) => String(s.expiry),
  nullifier: (s) => BigInt(s.nullifier).toString(),
  verifierCommitment: (s) => BigInt(s.verifierCommitment).toString(),
};

function loadLayout(): void {
  try {
    const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, "utf8")) as {
      circuit?: string;
      nPublic?: number;
      order?: string[];
      ceremony?: CeremonyNote;
    };

    if (!Array.isArray(layout.order) || layout.order.length === 0) {
      throw new Error("signal_layout.json has no `order` array");
    }
    for (const name of layout.order) {
      if (!(name in ENCODERS)) {
        throw new Error(
          'signal_layout.json names public signal "' +
            name +
            '", which PublicSignals in protocol/types.ts does not carry. Regenerate the types or the ' +
            "circuit; do not guess an encoding.",
        );
      }
    }
    if (typeof layout.nPublic === "number" && layout.nPublic !== layout.order.length) {
      throw new Error(
        "signal_layout.json is self-inconsistent: nPublic=" +
          layout.nPublic +
          " but `order` has " +
          layout.order.length +
          " entries",
      );
    }

    status.circuit = layout.circuit ?? null;
    status.nPublic = layout.order.length;
    status.signalOrder = Object.freeze([...layout.order]);
    status.ceremony = layout.ceremony ?? null;
  } catch (cause) {
    status.problems.push(
      "cannot read " +
        LAYOUT_PATH +
        " (" +
        (cause instanceof Error ? cause.message : String(cause)) +
        ") — run `npm run zk:build`",
    );
  }
}

function loadKey(): void {
  try {
    const raw = fs.readFileSync(VKEY_PATH, "utf8");
    const key = JSON.parse(raw) as {
      protocol?: string;
      curve?: string;
      nPublic?: number;
      IC?: unknown[];
    };

    if (key.protocol !== "groth16") {
      throw new Error('verifying key protocol is "' + String(key.protocol) + '", expected groth16');
    }
    if (!Array.isArray(key.IC)) {
      throw new Error("verifying key has no IC array");
    }
    if (status.nPublic !== null && key.IC.length !== status.nPublic + 1) {
      throw new Error(
        "verifying key IC has " +
          key.IC.length +
          " points; the layout declares " +
          status.nPublic +
          " public signals, so IC must have " +
          (status.nPublic + 1) +
          ". The key and the layout came from different builds.",
      );
    }

    verifyingKey = key;
    status.vkeyHash = createHash("sha256").update(raw, "utf8").digest("hex");
    status.vkeyShortHash = status.vkeyHash.slice(0, 16);
  } catch (cause) {
    status.problems.push(
      "cannot load " +
        VKEY_PATH +
        " (" +
        (cause instanceof Error ? cause.message : String(cause)) +
        ") — run `npm run zk:build`",
    );
  }
}

/**
 * Rule 3: the browser's artifacts and the server's key must come from ONE
 * build. This is the single most confusing failure mode in the whole
 * workstream — a stale zkey produces proofs that are perfectly well formed and
 * verify against nothing — so it is checked before any proof arrives.
 */
function checkArtifactsAgree(): void {
  status.browserVkeyHash = sha256File(BROWSER_VKEY_PATH);

  if (status.browserVkeyHash === null) {
    status.problems.push(
      "cannot read " +
        BROWSER_VKEY_PATH +
        " — the browser has no artifacts to prove against, so no proof could ever arrive",
    );
    return;
  }
  if (status.vkeyHash !== null && status.browserVkeyHash !== status.vkeyHash) {
    status.problems.push(
      "STALE ARTIFACTS: " +
        VKEY_PATH +
        " hashes sha256:" +
        status.vkeyHash.slice(0, 16) +
        " but " +
        BROWSER_VKEY_PATH +
        " hashes sha256:" +
        status.browserVkeyHash.slice(0, 16) +
        ". The browser would be proving against a different ceremony than this server verifies " +
        "against, and every proof would fail with no useful error. Re-run `npm run zk:build`.",
    );
    return;
  }
  status.artifactsAgree = true;
}

/**
 * And the same question again about the copy that is actually SERVED.
 *
 * Not fatal, deliberately. When the API runs behind the Vite dev server the
 * browser fetches `frontend/public/zk` and a stale `dist/` is irrelevant, so
 * refusing to verify here would be a false alarm. When this process IS serving
 * the SPA the mismatch matters enormously, and `index.ts` turns this field into
 * a loud startup warning at the one moment it knows which mode it is in.
 */
function checkServedArtifacts(): void {
  const hash = sha256File(SERVED_VKEY_PATH);
  if (hash === null) {
    // No built SPA. Nothing is being served, so there is nothing to be stale.
    status.servedVkeyHash = null;
    status.servedArtifactsAgree = null;
    return;
  }
  status.servedVkeyHash = hash;
  status.servedArtifactsAgree = status.vkeyHash !== null && hash === status.vkeyHash;
}

/** The sentence `index.ts` prints when the built SPA is behind the ceremony. */
export function staleBuiltSpaWarning(): string {
  return (
    "STALE BUILT SPA: this server verifies against sha256:" +
    String(status.vkeyShortHash) +
    " but " +
    SERVED_VKEY_PATH +
    " carries sha256:" +
    String(status.servedVkeyHash?.slice(0, 16)) +
    ". Browsers loading the SPA from THIS server would download the older proving key and every " +
    "proof would be rejected. Re-run `npm run build` (zk:build was run after the last SPA build)."
  );
}

function loadVerifier(): void {
  loadLayout();
  loadKey();
  checkArtifactsAgree();
  checkServedArtifacts();

  status.ready = status.problems.length === 0 && verifyingKey !== null;

  if (!status.ready) {
    // Loud on purpose. This must not scroll past as a one-line notice.
    console.error("");
    console.error("############################################################");
    console.error("##  GROTH16 VERIFIER NOT READY — VERIFICATION FAILS CLOSED");
    for (const problem of status.problems) {
      console.error("##  - " + problem);
    }
    console.error("##  Every groth16_verified check reports false until this is fixed.");
    console.error("############################################################");
    console.error("");
  }
}

loadVerifier();

export const verifierStatus: Readonly<VerifierStatus> = status;

/** One line for the startup banner. */
export function verifierBanner(): string {
  if (!status.ready) {
    return "NOT READY — fails closed (" + status.problems.length + " problem(s), logged above)";
  }
  return (
    status.circuit +
    " · vkey sha256:" +
    status.vkeyShortHash +
    " · " +
    status.nPublic +
    " public signals · browser artifacts agree · ceremony: " +
    (status.ceremony
      ? status.ceremony.kind + " (trusted=" + String(status.ceremony.trusted) + ")"
      : "unknown")
  );
}

/* ------------------------------------------------------------- the payload */

/**
 * What a `groth16-bn254` submission carries in `ProofSubmission["proof"]`.
 *
 * `SubmitProofBody.proof` is a single string, so the proof and its ORDERED
 * public-signal array travel as JSON inside it. That is not a workaround: it
 * keeps the array — the thing snarkjs actually verifies — on the wire next to
 * the named object the lender's UI reads, so the server can require the two to
 * agree instead of reconstructing the array and hoping.
 */
export type Groth16Payload = {
  proof: unknown;
  publicSignals: string[];
};

const DECIMAL = /^[0-9]+$/;

/** Parse and shape-check a submitted payload. Returns a reason, never throws. */
export function parseProofPayload(
  raw: string | null | undefined,
): { ok: true; payload: Groth16Payload } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "the submission carries no proof bytes" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      ok: false,
      reason:
        "proof payload is not JSON (" + (cause instanceof Error ? cause.message : "unparseable") + ")",
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "proof payload is not an object" };
  }

  const candidate = parsed as { proof?: unknown; publicSignals?: unknown };
  const proof = candidate.proof as
    | { pi_a?: unknown; pi_b?: unknown; pi_c?: unknown; protocol?: unknown; curve?: unknown }
    | undefined;

  if (typeof proof !== "object" || proof === null) {
    return { ok: false, reason: "proof payload has no `proof` object" };
  }
  if (!Array.isArray(proof.pi_a) || !Array.isArray(proof.pi_b) || !Array.isArray(proof.pi_c)) {
    return { ok: false, reason: "proof is missing pi_a / pi_b / pi_c" };
  }
  if (proof.protocol !== "groth16") {
    return {
      ok: false,
      reason: 'proof.protocol is "' + String(proof.protocol) + '", expected groth16',
    };
  }
  if (proof.curve !== "bn128") {
    // snarkjs spells BN254 "bn128"; our protocol name is groth16-bn254. Same
    // curve, two spellings, and worth an explicit sentence rather than a
    // puzzling rejection at 3am.
    return {
      ok: false,
      reason:
        'proof.curve is "' +
        String(proof.curve) +
        "\", expected bn128 (snarkjs' spelling of BN254)",
    };
  }

  const signals = candidate.publicSignals;
  if (!Array.isArray(signals)) {
    return { ok: false, reason: "proof payload has no `publicSignals` array" };
  }
  if (!signals.every((value) => typeof value === "string" && DECIMAL.test(value))) {
    return { ok: false, reason: "publicSignals must be an array of decimal strings" };
  }

  return { ok: true, payload: { proof, publicSignals: signals as string[] } };
}

/**
 * `PublicSignals` -> the ordered decimal array snarkjs verifies against, using
 * the GENERATED layout order rather than a hand-written index list.
 */
export function encodePublicSignals(signals: PublicSignals): string[] {
  if (status.signalOrder.length === 0) {
    throw new Error("signal layout is not loaded");
  }
  return status.signalOrder.map((name) => {
    const encode = ENCODERS[name];
    if (!encode) {
      throw new Error('no encoder for public signal "' + name + '"');
    }
    return encode(signals);
  });
}

/**
 * Does the array the prover submitted match the named object it submitted,
 * slot for slot, in the order the compiled circuit uses?
 */
export function checkSignalOrder(
  submitted: readonly string[],
  signals: PublicSignals,
): { ok: boolean; detail: string } {
  let expected: string[];
  try {
    expected = encodePublicSignals(signals);
  } catch (cause) {
    return {
      ok: false,
      detail:
        "FAILED CLOSED: the generated public-signal layout could not be applied (" +
        (cause instanceof Error ? cause.message : String(cause)) +
        ").",
    };
  }

  const rendered = status.signalOrder.map((name, i) => "[" + i + "] " + name).join(", ");

  if (submitted.length !== expected.length) {
    return {
      ok: false,
      detail:
        "The proof was verified against " +
        submitted.length +
        " public signals; circuit " +
        String(status.circuit) +
        " has " +
        expected.length +
        " (" +
        rendered +
        "). A proof over a different number of public inputs proves a different statement.",
    };
  }

  const wrong: string[] = [];
  for (let i = 0; i < expected.length; i += 1) {
    if (submitted[i] !== expected[i]) {
      wrong.push("[" + i + "] " + String(status.signalOrder[i]));
    }
  }

  if (wrong.length > 0) {
    return {
      ok: false,
      detail:
        "The verified array disagrees with the named receipt at " +
        wrong.join(", ") +
        ". The array is what snarkjs actually checks, so a receipt whose fields say one thing while " +
        "its array says another is claiming a statement the lender never read. The order is derived " +
        "from the COMPILED circuit (zk/build/signal_layout.json): " +
        rendered +
        ".",
    };
  }

  return {
    ok: true,
    detail:
      "All " +
      expected.length +
      " public signals re-encode — in the order derived from the COMPILED circuit, not from anybody's " +
      "assumption about how snarkjs orders them (" +
      rendered +
      ") — to exactly the array this proof was verified against. The receipt the lender reads and the " +
      "statement the pairing check accepted are the same object; a client cannot renumber what it is " +
      "proving.",
  };
}

/* --------------------------------------------------------------- verifying */

/**
 * Verify a Groth16 proof against the committed verifying key.
 *
 * Never throws: a malformed proof, a snarkjs internal error and a missing key
 * all come back as `{ ok: false }` with a detail a human can read on screen.
 * No path through this function returns `ok: true` unless
 * `snarkjs.groth16.verify` returned `true`.
 */
export async function verifyGroth16(
  proof: unknown,
  publicSignals: readonly string[],
): Promise<{ ok: boolean; detail: string }> {
  if (!status.ready || verifyingKey === null) {
    return {
      ok: false,
      detail:
        "FAILED CLOSED: this server has no usable verifying key, so nothing was checked and nothing " +
        "is accepted. " +
        status.problems.join(" | "),
    };
  }

  const startedAt = Date.now();
  let ok: boolean;
  try {
    ok = await snarkjs.groth16.verify(verifyingKey, publicSignals, proof);
  } catch (cause) {
    return {
      ok: false,
      detail:
        "REJECTED: snarkjs.groth16.verify threw against verifying key sha256:" +
        String(status.vkeyShortHash) +
        " (" +
        (cause instanceof Error ? cause.message : String(cause)) +
        "). A proof the verifier cannot even parse is not a proof.",
    };
  }
  const ms = Date.now() - startedAt;

  if (!ok) {
    return {
      ok: false,
      detail:
        "REJECTED: snarkjs.groth16.verify returned false in " +
        ms +
        "ms against verifying key sha256:" +
        String(status.vkeyShortHash) +
        " for circuit " +
        String(status.circuit) +
        ". The BN254 pairing check does not hold for these public signals, so this proof does not " +
        "attest to this statement.",
    };
  }

  return {
    ok: true,
    detail:
      "VERIFIED: snarkjs.groth16.verify returned true in " +
      ms +
      "ms. The BN254 pairing check holds for all " +
      publicSignals.length +
      " public signals against verifying key sha256:" +
      String(status.vkeyShortHash) +
      " (zk/build/verification_key.json, circuit " +
      String(status.circuit) +
      "), which this server confirmed at boot is byte-identical to " +
      "frontend/public/zk/verification_key.json — the key the applicant's browser proved against. " +
      "The proof itself was produced in that browser from a portfolio snapshot this server never " +
      "received and cannot reconstruct. TRUST NOTE, stated rather than buried: the phase-2 setup " +
      "behind this key is a " +
      (status.ceremony ? status.ceremony.kind : "development") +
      " ceremony run by one person on one machine, not a real multi-party ceremony — whoever ran it " +
      "could forge proofs. Transcript: zk/build/ceremony-transcript.md.",
  };
}

/* -------------------------------------------------------------- self-test
 *
 *   node backend/src/protocol/verifier.ts
 *
 * Drives this verifier against the fixtures `zk/make-fixtures.mjs` produced
 * with snarkjs in a separate process: a valid proof verifies, a tampered
 * public signal is rejected, and a proof from a different policy is rejected.
 * Same convention as `store.ts` and `policy.ts`, which are runnable the same
 * way.
 * ======================================================================== */

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const readFixture = (file: string): unknown => {
    const full = path.join(FIXTURES_DIR, file);
    if (!fs.existsSync(full)) {
      console.error("missing fixture " + full + " — run `npm run zk:fixtures` first");
      process.exit(1);
    }
    return JSON.parse(fs.readFileSync(full, "utf8"));
  };

  let failures = 0;
  const check = (label: string, condition: boolean, detail: string): void => {
    console.log((condition ? "  PASS  " : "  FAIL  ") + label);
    console.log("        " + detail.slice(0, 300) + (detail.length > 300 ? " …" : ""));
    console.log("");
    if (!condition) failures += 1;
  };

  console.log("verifier.ts self-test");
  console.log("  " + verifierBanner());
  console.log("  vkey        " + VKEY_PATH);
  console.log("  browser key " + BROWSER_VKEY_PATH);
  console.log("");

  if (!status.ready) {
    console.error("verifier is not ready; nothing to self-test");
    process.exit(1);
  }

  const proofA = readFixture("policy_a_proof.json");
  const signalsA = readFixture("policy_a_public.json") as string[];
  const proofB = readFixture("policy_b_proof.json");
  const signalsB = readFixture("policy_b_public.json") as string[];

  /* 1 — a valid proof verifies. */
  const valid = await verifyGroth16(proofA, signalsA);
  check("CASE 1  a valid proof verifies", valid.ok, valid.detail);

  /* 2 — a tampered public signal is rejected. */
  const eligibleAt = status.signalOrder.indexOf("eligible");
  const relabelled = [...signalsA];
  relabelled[eligibleAt] = signalsA[eligibleAt] === "1" ? "0" : "1";
  const flipped = await verifyGroth16(proofA, relabelled);
  check(
    "CASE 2a tampered public signal — eligible[" + eligibleAt + "] flipped — is rejected",
    !flipped.ok,
    flipped.detail,
  );

  const commitmentAt = status.signalOrder.indexOf("passportCommitment");
  const bumpedSignals = [...signalsA];
  bumpedSignals[commitmentAt] = (BigInt(signalsA[commitmentAt]) + 1n).toString();
  const bumped = await verifyGroth16(proofA, bumpedSignals);
  check(
    "CASE 2b tampered public signal — passportCommitment[" + commitmentAt + "] + 1 — is rejected",
    !bumped.ok,
    bumped.detail,
  );

  /* 3 — a proof from a different policy is rejected. */
  const grafted = await verifyGroth16(proofB, signalsA);
  check(
    "CASE 3a a proof produced under a DIFFERENT policy, presented against policy A's signals, is rejected",
    !grafted.ok,
    grafted.detail,
  );
  const crossed = await verifyGroth16(proofA, signalsB);
  check(
    "CASE 3b policy A's proof presented against policy B's signals is rejected",
    !crossed.ok,
    crossed.detail,
  );
  const ownB = await verifyGroth16(proofB, signalsB);
  check("CASE 3c policy B's own proof verifies (the control)", ownB.ok, ownB.detail);

  /* 4 — fail-closed shape checks around the payload. */
  const badPayload = parseProofPayload('{"proof":{"pi_a":[],"pi_b":[],"pi_c":[],"protocol":"plonk","curve":"bn128"},"publicSignals":[]}');
  check(
    "CASE 4  a non-groth16 payload is refused by parseProofPayload",
    !badPayload.ok,
    badPayload.ok ? "accepted, which is wrong" : badPayload.reason,
  );

  console.log(failures === 0 ? "verifier.ts OK" : "verifier.ts " + failures + " FAILURE(S)");
  // ffjavascript keeps a worker pool alive; without this the process hangs.
  process.stdout.write("", () => process.exit(failures === 0 ? 0 : 1));
}
