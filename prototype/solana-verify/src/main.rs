mod vk_data;
use vk_data::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

pub const VK: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: NR_PUB,
    vk_alpha_g1: VK_ALPHA_G1,
    vk_beta_g2: VK_BETA_G2,
    vk_gamme_g2: VK_GAMMA_G2,
    vk_delta_g2: VK_DELTA_G2,
    vk_ic: &VK_IC,
};

fn run(label: &str, a: &[u8; 64]) {
    match Groth16Verifier::new(a, &PROOF_B, &PROOF_C, &PUBLIC_INPUTS, &VK) {
        Ok(mut v) => match v.verify() {
            Ok(()) => println!("{label}: VERIFIED"),
            Err(e) => println!("{label}: rejected ({e:?})"),
        },
        Err(e) => println!("{label}: construct error ({e:?})"),
    }
}

fn main() {
    println!("groth16-solana 0.2.0 | public inputs = {}", PUBLIC_INPUTS.len());
    run("proof.A NEGATED ", &PROOF_A_NEG);
    run("proof.A as-is   ", &PROOF_A_RAW);

    // tamper check: flip the eligible flag (public input index 1) and expect rejection
    let mut tampered = PUBLIC_INPUTS;
    tampered[1][31] = 0u8; // eligible 1 -> 0
    match Groth16Verifier::new(&PROOF_A_NEG, &PROOF_B, &PROOF_C, &tampered, &VK) {
        Ok(mut v) => match v.verify() {
            Ok(()) => println!("TAMPERED inputs: VERIFIED  <-- BAD, soundness broken"),
            Err(e) => println!("TAMPERED inputs: correctly rejected ({e:?})"),
        },
        Err(e) => println!("TAMPERED inputs: construct error ({e:?})"),
    }
}
