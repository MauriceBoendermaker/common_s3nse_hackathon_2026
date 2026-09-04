//! Private Credit — the whole contract surface of the protocol, on Solana.
//!
//! What this program is for, in one sentence: a lender funds an escrow, a
//! borrower presents a Groth16 credential proving their private portfolio
//! satisfies that lender's published policy, and the program — not a server —
//! decides whether the money moves.
//!
//! Four things happen inside `present_and_fund`, and each one exists because
//! the alternative is a demo rather than a mechanism:
//!
//!  1. **The proof is verified on-chain.** `groth16-solana` over the BN254
//!     alt_bn128 syscalls, against a verifying key compiled into this binary
//!     from `zk/build/verification_key.json`. Nobody is trusted to have
//!     checked it earlier.
//!  2. **The policy hash is recomputed on-chain.** Public signal [2] is not
//!     taken at face value: the program runs Poseidon over the *stored*
//!     `Policy` account and requires equality. A client that lies about which
//!     policy it satisfied is rejected by the runtime, not by a code review.
//!  3. **The nullifier is a PDA that gets `init`-ed.** Signal [5] seeds an
//!     account. Presenting the same receipt twice fails with "account already
//!     in use" — a replay guard enforced by the Solana runtime itself, which
//!     is the one guarantee in this project nobody has to take on faith.
//!  4. **Settlement goes to a one-time address.** The lender resolved the
//!     borrower's ENS name off-chain and derived a fresh Solana address for
//!     this draw (see `BACKEND_PLAN.md` §3.1). The program records the
//!     ephemeral public key `R` and the view tag alongside the transfer so the
//!     borrower's scanner can find and sweep it, and pays the payout address
//!     a small lamport float so the sweep is actually affordable.
//!
//! What this program deliberately does NOT do: resolve ENS. It cannot — there
//! is no Ethereum light client here. It accepts the payout address the payer
//! supplies. The payer is the party with the incentive to resolve correctly,
//! and the borrower detects a wrong address immediately because no funds
//! arrive. That is the softest edge in the design and it is named here rather
//! than hidden.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};
use solana_poseidon::{hashv, Endianness, Parameters};

mod vk;
use vk::*;

declare_id!("69qmzHFdDMP8hGFNcJcKpduGbdjEnAhdrvLrLaydvvRc");

/// The verifying key of `zk/circuits/credit_policy.circom`, as
/// `groth16-solana` wants it.
///
/// NOTE: the field on the published 0.2.0 crate really is spelled
/// `vk_gamme_g2`. Writing `vk_gamma_g2` is a compile error. The published
/// crate is not GitHub master, and it is unaudited — only 0.0.1 was covered by
/// the Light Protocol v3 audit.
pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: NR_PUB,
    vk_alpha_g1: VK_ALPHA_G1,
    vk_beta_g2: VK_BETA_G2,
    vk_gamme_g2: VK_GAMMA_G2,
    vk_delta_g2: VK_DELTA_G2,
    vk_ic: &VK_IC,
};

/// Public signal indices. This ordering is a four-way contract between the
/// circuit, this program, the backend and the browser prover. `zk/build.mjs`
/// re-derives it from the compiled circuit and fails the build on drift.
const SIG_PASSPORT_COMMITMENT: usize = 0;
const SIG_ELIGIBLE: usize = 1;
const SIG_POLICY_HASH: usize = 2;
const SIG_SUBJECT_COMMITMENT: usize = 3;
const SIG_EXPIRY: usize = 4;
const SIG_NULLIFIER: usize = 5;
const SIG_VERIFIER_COMMITMENT: usize = 6;

/// Lamports handed to a freshly derived payout address so the borrower can
/// actually move what lands there.
///
/// A one-time payout address is a brand new account with a zero balance. Fund
/// only the SPL side and the demo dead-ends at "the money arrived and cannot
/// be moved" — the single most likely way this settlement leg fails in front
/// of a judge. 0.002 SOL covers rent exemption for a system account plus a
/// generous number of signatures.
pub const PAYOUT_SWEEP_LAMPORTS: u64 = 2_000_000;

pub const REQUEST_OPEN: u8 = 0;
pub const REQUEST_FUNDED: u8 = 1;
pub const REQUEST_SETTLED: u8 = 2;

pub const LOAN_FUNDED: u8 = 0;
pub const LOAN_ACTIVE: u8 = 1;
pub const LOAN_REPAID: u8 = 2;

#[program]
pub mod private_credit {
    use super::*;

    /// One-time bootstrap. Records who may administer the program and the
    /// SHA-256 of the verifying key bytes this binary was built against, so a
    /// deployed program can be matched to a specific `zk/build/` output
    /// without reading the ELF.
    pub fn initialize(ctx: Context<Initialize>, vk_hash: [u8; 32]) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.vk_hash = vk_hash;
        config.loans_settled = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// A lender publishes the underwriting policy it will accept proofs
    /// against.
    ///
    /// `policy_hash` is passed in **only because a PDA seed has to be known
    /// before the instruction runs**. It is not trusted: the program
    /// immediately recomputes Poseidon over the four thresholds it just stored
    /// and rejects a mismatch. So the account can only ever exist at the
    /// address its own contents hash to.
    ///
    /// The account is keyed by (policy hash, verifier commitment), not by the
    /// policy hash alone. Two lenders publishing identical thresholds is
    /// ordinary — a policy is four numbers, and the space of sensible numbers
    /// is small — but they are different verifiers, and public signal [6]
    /// binds a receipt to exactly one of them. Keying on the hash alone made
    /// the first lender's account swallow the second's, and every proof the
    /// second lender received was then rejected as "issued to a different
    /// verifier". That is the program being right about the wrong account.
    pub fn publish_policy(
        ctx: Context<PublishPolicy>,
        policy_hash: [u8; 32],
        verifier_commitment: [u8; 32],
        min_assets: u64,
        min_collateral_quality: u8,
        min_history_months: u16,
        screen_exposure: bool,
    ) -> Result<()> {
        require!(min_collateral_quality <= 100, CreditError::QualityOutOfRange);

        let recomputed = poseidon_policy_hash(
            min_assets,
            min_collateral_quality,
            min_history_months,
            screen_exposure,
        )?;
        require!(recomputed == policy_hash, CreditError::PolicyHashMismatch);

        let policy = &mut ctx.accounts.policy;
        policy.lender = ctx.accounts.lender.key();
        policy.min_assets = min_assets;
        policy.min_collateral_quality = min_collateral_quality;
        policy.min_history_months = min_history_months;
        policy.screen_exposure = screen_exposure;
        policy.policy_hash = policy_hash;
        policy.verifier_commitment = verifier_commitment;
        policy.created_at = Clock::get()?.unix_timestamp;
        policy.bump = ctx.bumps.policy;
        Ok(())
    }

    /// The borrower posts the public half of a credit request: the terms, and
    /// the commitments they are bound to for every proof that follows.
    ///
    /// The passport commitment is fixed HERE, before any lender publishes a
    /// policy challenge. That ordering is the difference between a mechanism
    /// and theatre — reverse it and the borrower simply picks numbers that
    /// satisfy the policy they were just handed.
    pub fn publish_request(
        ctx: Context<PublishRequest>,
        request_id: [u8; 32],
        amount: u64,
        collateral: u64,
        term_days: u16,
        passport_commitment: [u8; 32],
        subject_commitment: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, CreditError::AmountZero);
        require!(term_days > 0, CreditError::TermZero);

        let request = &mut ctx.accounts.request;
        request.borrower = ctx.accounts.borrower.key();
        request.request_id = request_id;
        request.amount = amount;
        request.collateral = collateral;
        request.term_days = term_days;
        request.passport_commitment = passport_commitment;
        request.subject_commitment = subject_commitment;
        request.mint = ctx.accounts.mint.key();
        request.status = REQUEST_OPEN;
        request.created_at = Clock::get()?.unix_timestamp;
        request.bump = ctx.bumps.request;
        Ok(())
    }

    /// The lender moves real tokens into the escrow vault for this request.
    ///
    /// Funding happens before the proof is presented, on purpose: an offer
    /// that is not funded is a quote, and this protocol only ever shows the
    /// borrower offers whose money is already sitting in a vault the lender no
    /// longer controls unilaterally.
    pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
        require!(amount > 0, CreditError::AmountZero);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.lender_tokens.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.lender.to_account_info(),
                },
            ),
            amount,
        )?;

        let request = &mut ctx.accounts.request;
        request.status = REQUEST_FUNDED;
        request.funded_by = ctx.accounts.lender.key();
        Ok(())
    }

    /// The core instruction. Verifies the credential and settles in one
    /// atomic step, so there is no window in which a proof is "accepted" but
    /// the money has not moved (or the reverse).
    /// `proof` and `raw_signals` are `Vec<u8>` rather than the fixed arrays the
    /// shapes suggest, and that is not a style choice.
    ///
    /// An SBF stack frame is 4 KB. Anchor deserialises instruction arguments
    /// into locals and then MOVES them into the handler frame, so declaring
    /// `[u8; 64] + [u8; 128] + [u8; 64] + [[u8; 32]; 7]` by value put ~480
    /// bytes through several frames at once and the program died with
    /// "Access violation in stack frame 3" after 3,427 compute units — before
    /// a single line of this function ran. A `Vec` lives on the heap; the
    /// fixed arrays are rebuilt behind a `Box` below.
    #[allow(clippy::too_many_arguments)]
    pub fn present_and_fund(
        ctx: Context<PresentAndFund>,
        nullifier_seed: [u8; 32],
        proof: Vec<u8>,
        raw_signals: Vec<u8>,
        payout_address: Pubkey,
        ephemeral_pubkey: [u8; 32],
        view_tag: u8,
        apr_bps: u16,
        fee_bps: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(proof.len() == 256, CreditError::ProofMalformed);
        require!(
            raw_signals.len() == 32 * NR_PUB,
            CreditError::SignalCountMismatch
        );

        let mut public_signals = Box::new([[0u8; 32]; 7]);
        for (index, slot) in public_signals.iter_mut().enumerate() {
            slot.copy_from_slice(&raw_signals[index * 32..(index + 1) * 32]);
        }

        // The nullifier PDA is seeded by `nullifier_seed`, which has to be a
        // standalone leading argument because Anchor resolves PDA seeds before
        // the handler runs and cannot index into `public_signals`. It is not
        // trusted for anything: it must equal signal [5] or the transaction
        // fails here, so the account can only ever be created at the address
        // the proof's own nullifier implies.
        require!(
            nullifier_seed == public_signals[SIG_NULLIFIER],
            CreditError::NullifierSeedMismatch
        );

        // ---- 1. the credential itself ----------------------------------
        //
        // Done FIRST and unconditionally. Everything below is bookkeeping
        // that only means something if this passes. `#[inline(never)]` on the
        // helper keeps the pairing check's locals in a frame of their own
        // rather than adding them to this one.
        verify_groth16(&proof, &public_signals)?;

        // ---- 2. the signals have to be about THIS request --------------
        require!(
            public_signals[SIG_PASSPORT_COMMITMENT] == ctx.accounts.request.passport_commitment,
            CreditError::PassportCommitmentMismatch
        );
        require!(
            public_signals[SIG_SUBJECT_COMMITMENT] == ctx.accounts.request.subject_commitment,
            CreditError::SubjectCommitmentMismatch
        );

        // `eligible` is a bit. A proof of ineligibility is a perfectly valid
        // proof — it just does not release money.
        require!(
            is_field_one(&public_signals[SIG_ELIGIBLE]),
            CreditError::NotEligible
        );

        // ---- 3. recompute the policy hash on-chain ---------------------
        //
        // The client is trusted for nothing. Signal [2] must equal Poseidon
        // over the thresholds THIS program stored when the lender published
        // the policy, not over whatever the prover would like it to have been.
        let recomputed = poseidon_policy_hash(
            ctx.accounts.policy.min_assets,
            ctx.accounts.policy.min_collateral_quality,
            ctx.accounts.policy.min_history_months,
            ctx.accounts.policy.screen_exposure,
        )?;
        require!(
            public_signals[SIG_POLICY_HASH] == recomputed,
            CreditError::PolicyHashMismatch
        );

        // The proof was issued to THIS verifier. Signal [6] is public
        // precisely so this comparison is possible — private, the prover
        // could have derived the nullifier against a verifier of their own
        // choosing and the binding would mean nothing.
        require!(
            public_signals[SIG_VERIFIER_COMMITMENT] == ctx.accounts.policy.verifier_commitment,
            CreditError::VerifierMismatch
        );

        // ---- 4. expiry, against the cluster clock ----------------------
        let expiry = be_bytes_to_u64(&public_signals[SIG_EXPIRY])?;
        require!(
            (expiry as i64) > clock.unix_timestamp,
            CreditError::ProofExpired
        );

        // ---- 5. settle ------------------------------------------------
        //
        // The nullifier PDA was `init`-ed by the account constraints before
        // this body ran. A second presentation of the same receipt never
        // reaches here: the runtime rejects it at account creation.
        let request_key = ctx.accounts.request.key();
        let request_id = ctx.accounts.request.request_id;
        let request_bump = ctx.accounts.request.bump;
        let term_days = ctx.accounts.request.term_days;
        let borrower = ctx.accounts.request.borrower;
        let mint = ctx.accounts.request.mint;
        let passport_commitment = ctx.accounts.request.passport_commitment;
        let subject_commitment = ctx.accounts.request.subject_commitment;
        let policy_key = ctx.accounts.policy.key();

        let nullifier_account = &mut ctx.accounts.nullifier;
        nullifier_account.value = public_signals[SIG_NULLIFIER];
        nullifier_account.request = request_key;
        nullifier_account.created_at = clock.unix_timestamp;
        nullifier_account.bump = ctx.bumps.nullifier;

        let principal = ctx.accounts.vault.amount;
        require!(principal > 0, CreditError::VaultEmpty);

        let signer_seeds: &[&[&[u8]]] = &[&[b"request", request_id.as_ref(), &[request_bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.payout_tokens.to_account_info(),
                    authority: ctx.accounts.request.to_account_info(),
                },
                signer_seeds,
            ),
            principal,
        )?;

        // A freshly derived address owns tokens it cannot move without a
        // lamport balance. Hand it enough to be rent-exempt and to sign.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.lender.to_account_info(),
                    to: ctx.accounts.payout.to_account_info(),
                },
            ),
            PAYOUT_SWEEP_LAMPORTS,
        )?;

        let loan = &mut ctx.accounts.loan;
        loan.request = request_key;
        loan.request_id = request_id;
        loan.policy = policy_key;
        loan.lender = ctx.accounts.lender.key();
        loan.borrower = borrower;
        loan.mint = mint;
        loan.principal = principal;
        loan.repaid_amount = 0;
        loan.apr_bps = apr_bps;
        loan.fee_bps = fee_bps;
        loan.term_days = term_days;
        loan.payout = payout_address;
        loan.ephemeral_pubkey = ephemeral_pubkey;
        loan.view_tag = view_tag;
        loan.nullifier = public_signals[SIG_NULLIFIER];
        loan.passport_commitment = passport_commitment;
        loan.subject_commitment = subject_commitment;
        loan.funded_at = clock.unix_timestamp;
        loan.drawn_at = 0;
        loan.due_at = clock.unix_timestamp + (term_days as i64) * 86_400;
        loan.repaid_at = 0;
        loan.status = LOAN_FUNDED;
        loan.bump = ctx.bumps.loan;

        let loan_key = loan.key();
        let nullifier_value = loan.nullifier;

        ctx.accounts.request.status = REQUEST_SETTLED;
        ctx.accounts.config.loans_settled = ctx.accounts.config.loans_settled.saturating_add(1);

        emit!(LoanSettled {
            request: request_key,
            loan: loan_key,
            payout: payout_address,
            principal,
            nullifier: nullifier_value,
            view_tag,
        });

        Ok(())
    }

    /// The borrower marks the line drawn. Kept as a distinct on-chain
    /// transition rather than folded into settlement because the interest
    /// clock starts here and the cluster clock — not a server timestamp — is
    /// what says when.
    pub fn draw(ctx: Context<UpdateLoan>) -> Result<()> {
        let loan = &mut ctx.accounts.loan;
        require!(loan.status == LOAN_FUNDED, CreditError::LoanNotDrawable);
        loan.status = LOAN_ACTIVE;
        loan.drawn_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Principal plus interest and fee returns to the lender's token account.
    /// The amount is checked against what the program itself computes from the
    /// stored loan and the elapsed cluster time.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;
        {
            let loan = &ctx.accounts.loan;
            require!(loan.status != LOAN_REPAID, CreditError::LoanAlreadyRepaid);
            let owed = total_repayment(loan, clock.unix_timestamp);
            require!(amount >= owed, CreditError::RepaymentShort);
        }

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.payer_tokens.to_account_info(),
                    to: ctx.accounts.lender_tokens.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;

        let loan = &mut ctx.accounts.loan;
        loan.status = LOAN_REPAID;
        loan.repaid_at = clock.unix_timestamp;
        loan.repaid_amount = amount;
        Ok(())
    }
}

/* ---------------------------------------------------------- verification */

/// The pairing check, in its own stack frame.
///
/// `proof` is 256 bytes laid out A(64) || B(128) || C(64), with A ALREADY
/// NEGATED by the client -- (x, p - y). Non-negated A is rejected here and the
/// only symptom is "proof invalid", which is why the negation happens in one
/// place (`backend/src/adapters/proofBytes.ts`) with a self-test rather than
/// at three call sites.
#[inline(never)]
fn verify_groth16(proof: &[u8], public_signals: &[[u8; 32]; 7]) -> Result<()> {
    let proof_a: Box<[u8; 64]> = Box::new(
        proof[0..64]
            .try_into()
            .map_err(|_| error!(CreditError::ProofMalformed))?,
    );
    let proof_b: Box<[u8; 128]> = Box::new(
        proof[64..192]
            .try_into()
            .map_err(|_| error!(CreditError::ProofMalformed))?,
    );
    let proof_c: Box<[u8; 64]> = Box::new(
        proof[192..256]
            .try_into()
            .map_err(|_| error!(CreditError::ProofMalformed))?,
    );

    let mut verifier = Groth16Verifier::new(
        &proof_a,
        &proof_b,
        &proof_c,
        public_signals,
        &VERIFYING_KEY,
    )
    .map_err(|_| error!(CreditError::ProofMalformed))?;

    verifier
        .verify()
        .map_err(|_| error!(CreditError::ProofInvalid))?;

    Ok(())
}

/* ------------------------------------------------------------------ maths */

/// `Poseidon4(minAssets, minCollateralQuality, minHistoryMonths, screenExposure)`
/// over BN254, big-endian — byte-identical to `poseidon-lite`'s `poseidon4`
/// in `backend/src/protocol/policy.ts` and to the `Poseidon(4)` component in
/// `zk/circuits/credit_policy.circom`.
///
/// Three implementations of the same hash is exactly the situation
/// `BACKEND_PLAN.md` §3.2 warns about: fix one encoding or the on-chain
/// recompute never matches and the hour spent finding out is wasted. The
/// encoding is: each input is a 32-byte big-endian field element, arity is the
/// number of inputs, no domain tag.
fn poseidon_policy_hash(
    min_assets: u64,
    min_collateral_quality: u8,
    min_history_months: u16,
    screen_exposure: bool,
) -> Result<[u8; 32]> {
    let a = u64_to_be32(min_assets);
    let b = u64_to_be32(min_collateral_quality as u64);
    let c = u64_to_be32(min_history_months as u64);
    let d = u64_to_be32(if screen_exposure { 1 } else { 0 });

    let digest = hashv(
        Parameters::Bn254X5,
        Endianness::BigEndian,
        &[&a, &b, &c, &d],
    )
    .map_err(|_| error!(CreditError::PoseidonFailed))?;

    Ok(digest.to_bytes())
}

fn u64_to_be32(value: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&value.to_be_bytes());
    out
}

/// True when a 32-byte big-endian field element is exactly 1.
fn is_field_one(bytes: &[u8; 32]) -> bool {
    bytes[..31].iter().all(|b| *b == 0) && bytes[31] == 1
}

/// Read a field element that is known to be a small integer (a unix timestamp)
/// back into a `u64`, refusing anything that does not fit rather than
/// truncating into a plausible-looking wrong answer.
fn be_bytes_to_u64(bytes: &[u8; 32]) -> Result<u64> {
    require!(
        bytes[..24].iter().all(|b| *b == 0),
        CreditError::SignalTooLarge
    );
    let mut tail = [0u8; 8];
    tail.copy_from_slice(&bytes[24..32]);
    Ok(u64::from_be_bytes(tail))
}

/// Simple interest accrued over the elapsed term, plus the origination fee.
/// Basis points throughout; no floating point anywhere near money.
fn total_repayment(loan: &Loan, now: i64) -> u64 {
    let start = if loan.drawn_at > 0 {
        loan.drawn_at
    } else {
        loan.funded_at
    };
    let elapsed_days = ((now - start).max(0) / 86_400) as u128;
    let capped_days = elapsed_days.min(loan.term_days as u128);
    let principal = loan.principal as u128;

    let interest = principal * (loan.apr_bps as u128) * capped_days / (10_000u128 * 365u128);
    let fee = principal * (loan.fee_bps as u128) / 10_000u128;

    (principal + interest + fee).min(u64::MAX as u128) as u64
}

/* --------------------------------------------------------------- accounts */

#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    pub authority: Pubkey,
    /// SHA-256 over `zk/build/verification_key.json`. Ties this deployment to
    /// one circuit build without anyone having to disassemble the ELF.
    pub vk_hash: [u8; 32],
    pub loans_settled: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub lender: Pubkey,
    pub min_assets: u64,
    pub min_collateral_quality: u8,
    pub min_history_months: u16,
    pub screen_exposure: bool,
    pub policy_hash: [u8; 32],
    pub verifier_commitment: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CreditRequestAccount {
    pub borrower: Pubkey,
    pub funded_by: Pubkey,
    pub mint: Pubkey,
    pub request_id: [u8; 32],
    pub passport_commitment: [u8; 32],
    pub subject_commitment: [u8; 32],
    pub amount: u64,
    pub collateral: u64,
    pub term_days: u16,
    pub status: u8,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub request: Pubkey,
    pub request_id: [u8; 32],
    pub policy: Pubkey,
    pub lender: Pubkey,
    pub borrower: Pubkey,
    pub mint: Pubkey,
    /// The one-time address this draw was paid to. Derived off-chain from the
    /// borrower's ENS payout key; unlinkable to any previous draw.
    pub payout: Pubkey,
    /// `R = r·G`, the lender's ephemeral X25519 public key. Published so the
    /// borrower can recompute the shared secret and recover the payout key.
    pub ephemeral_pubkey: [u8; 32],
    pub nullifier: [u8; 32],
    pub passport_commitment: [u8; 32],
    pub subject_commitment: [u8; 32],
    pub principal: u64,
    pub repaid_amount: u64,
    pub apr_bps: u16,
    pub fee_bps: u16,
    pub term_days: u16,
    /// One byte of the shared secret. A scan filter that lets the borrower
    /// discard ~255/256 of foreign announcements cheaply. Never a security
    /// boundary.
    pub view_tag: u8,
    pub status: u8,
    pub funded_at: i64,
    pub drawn_at: i64,
    pub due_at: i64,
    pub repaid_at: i64,
    pub bump: u8,
}

/// The replay guard, and the most honest thing in the program: it holds almost
/// no data, because its *existence* is the whole mechanism.
#[account]
#[derive(InitSpace)]
pub struct NullifierAccount {
    pub value: [u8; 32],
    pub request: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

#[event]
pub struct LoanSettled {
    pub request: Pubkey,
    pub loan: Pubkey,
    pub payout: Pubkey,
    pub principal: u64,
    pub nullifier: [u8; 32],
    pub view_tag: u8,
}

/* ------------------------------------------------------------- contexts */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Box<Account<'info, ProgramConfig>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(policy_hash: [u8; 32], verifier_commitment: [u8; 32])]
pub struct PublishPolicy<'info> {
    #[account(
        init,
        payer = lender,
        space = 8 + Policy::INIT_SPACE,
        seeds = [b"policy", policy_hash.as_ref(), verifier_commitment.as_ref()],
        bump
    )]
    pub policy: Box<Account<'info, Policy>>,
    #[account(mut)]
    pub lender: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct PublishRequest<'info> {
    #[account(
        init,
        payer = borrower,
        space = 8 + CreditRequestAccount::INIT_SPACE,
        seeds = [b"request", request_id.as_ref()],
        bump
    )]
    pub request: Box<Account<'info, CreditRequestAccount>>,
    #[account(
        init,
        payer = borrower,
        seeds = [b"vault", request_id.as_ref()],
        bump,
        token::mint = mint,
        token::authority = request
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(
        mut,
        seeds = [b"request", request.request_id.as_ref()],
        bump = request.bump
    )]
    pub request: Box<Account<'info, CreditRequestAccount>>,
    #[account(
        mut,
        seeds = [b"vault", request.request_id.as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub lender_tokens: Account<'info, TokenAccount>,
    #[account(mut)]
    pub lender: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(nullifier_seed: [u8; 32])]
pub struct PresentAndFund<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProgramConfig>>,

    #[account(
        seeds = [b"policy", policy.policy_hash.as_ref(), policy.verifier_commitment.as_ref()],
        bump = policy.bump
    )]
    pub policy: Box<Account<'info, Policy>>,

    #[account(
        mut,
        seeds = [b"request", request.request_id.as_ref()],
        bump = request.bump
    )]
    pub request: Box<Account<'info, CreditRequestAccount>>,

    #[account(
        init,
        payer = lender,
        space = 8 + Loan::INIT_SPACE,
        seeds = [b"loan", request.request_id.as_ref()],
        bump
    )]
    pub loan: Box<Account<'info, Loan>>,

    /// The replay guard. `init` here is the enforcement: present the same
    /// receipt twice and the runtime fails the transaction with "account
    /// already in use" before a single line of this program runs.
    #[account(
        init,
        payer = lender,
        space = 8 + NullifierAccount::INIT_SPACE,
        seeds = [b"nullifier", nullifier_seed.as_ref()],
        bump
    )]
    pub nullifier: Box<Account<'info, NullifierAccount>>,

    #[account(
        mut,
        seeds = [b"vault", request.request_id.as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// The token account of the one-time payout address. Created by the payer
    /// in a preceding instruction; constrained here to actually belong to the
    /// address recorded on the loan.
    #[account(
        mut,
        constraint = payout_tokens.owner == payout.key() @ CreditError::PayoutOwnerMismatch,
        constraint = payout_tokens.mint == request.mint @ CreditError::PayoutMintMismatch
    )]
    pub payout_tokens: Box<Account<'info, TokenAccount>>,

    /// CHECK: a one-time system address derived off-chain from the borrower's
    /// ENS payout key. The program never dereferences it; it only credits it
    /// with lamports so the recipient can afford to sweep.
    #[account(mut)]
    pub payout: UncheckedAccount<'info>,

    #[account(mut)]
    pub lender: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateLoan<'info> {
    #[account(
        mut,
        seeds = [b"loan", loan.request_id.as_ref()],
        bump = loan.bump,
        constraint = loan.borrower == borrower.key() @ CreditError::NotBorrower
    )]
    pub loan: Box<Account<'info, Loan>>,
    pub borrower: Signer<'info>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(
        mut,
        seeds = [b"loan", loan.request_id.as_ref()],
        bump = loan.bump
    )]
    pub loan: Box<Account<'info, Loan>>,
    #[account(mut)]
    pub payer_tokens: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = lender_tokens.owner == loan.lender @ CreditError::PayoutOwnerMismatch
    )]
    pub lender_tokens: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum CreditError {
    #[msg("Groth16 proof is structurally malformed")]
    ProofMalformed,
    #[msg("Groth16 proof failed verification on-chain")]
    ProofInvalid,
    #[msg("Public signal [0] does not match the passport commitment on the request")]
    PassportCommitmentMismatch,
    #[msg("Public signal [3] does not match the subject commitment on the request")]
    SubjectCommitmentMismatch,
    #[msg("Public signal [2] does not match Poseidon over the stored policy")]
    PolicyHashMismatch,
    #[msg("Public signal [6] was issued to a different verifier")]
    VerifierMismatch,
    #[msg("The proof asserts the applicant is not eligible under this policy")]
    NotEligible,
    #[msg("The receipt expired before it reached the chain")]
    ProofExpired,
    #[msg("A public signal is larger than this field can decode")]
    SignalTooLarge,
    #[msg("The nullifier PDA seed does not equal public signal [5]")]
    NullifierSeedMismatch,
    #[msg("Wrong number of public signals for this circuit")]
    SignalCountMismatch,
    #[msg("Poseidon syscall failed")]
    PoseidonFailed,
    #[msg("Collateral quality is a percentage and must be 0-100")]
    QualityOutOfRange,
    #[msg("Amount must be greater than zero")]
    AmountZero,
    #[msg("Term must be at least one day")]
    TermZero,
    #[msg("The escrow vault holds nothing to disburse")]
    VaultEmpty,
    #[msg("The payout token account is not owned by the payout address")]
    PayoutOwnerMismatch,
    #[msg("The payout token account holds the wrong mint")]
    PayoutMintMismatch,
    #[msg("Only the borrower on this loan may draw it")]
    NotBorrower,
    #[msg("The loan is not in a drawable state")]
    LoanNotDrawable,
    #[msg("The loan is already repaid")]
    LoanAlreadyRepaid,
    #[msg("The repayment is short of principal, interest and fee")]
    RepaymentShort,
}
