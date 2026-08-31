# Footprint judging walkthrough

## Ninety-second version

| Time   | Show                                                                       | Say                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–12s  | The profile and its readable evidence map                                  | “Your ENS name is a useful public identity. But do you know what changing its records actually exposes?”                                             |
| 12–25s | Select a wallet; show token contracts and source information               | “Footprint connects ENS records to Mobula observations. Each connection has evidence. A token symbol alone is not identity.”                         |
| 25–47s | Publishing preview: clear Base; point at the surviving Default explanation | “Here I remove a chain override. The address stays discoverable through Default. Hiding a line in a dashboard would miss the actual behavior.”       |
| 47–60s | Clear Default too, or replace Base with the configured demo wallet         | “Now the checked route changes. We explain what remains, including other records and name-control connections. Unknown data stays unknown.”          |
| 60–77s | Compare the before and after snapshots                                     | “After I make my own edit in ENS, Footprint can re-read a newer block. It compares stored values and resolution, not a changing dollar balance.”     |
| 77–90s | Data mode, source block and privacy disclosure                             | “This is deliberate disclosure, not an anonymity score. No wallet signatures, no stored report database, and no claim that deletion erases history.” |

If recording only the built-in scenario, explicitly say **“This is the synthetic rehearsal”** before the after-state. Replace the sentence about making an ENS edit with “The rehearsal shows how the comparison works.” Never imply a fixture is a real onchain update.

## Strongest real-profile sequence

Use a team-owned/consenting name on the supported public resolver. Check resolver compatibility before preparing the recording; do not change resolver or payment records casually for a demo.

1. Prepare one low-risk profile edit and establish its current source block.
2. Demonstrate actual ENS reads and actual Mobula portfolio output. If available, open the optional activity sample and show a transaction hash and chain.
3. Make a local draft. Show source records, route reasoning and consequences for payment resolution.
4. Review the exact operation in the official ENS app yourself. Footprint does not sign or submit transactions. A cleared byte string and a stored zero address have different semantics.
5. After your transaction confirms, choose **Re-audit & compare**. Record the newer block and exact changed row. If it mismatches or remains unknown, explain that outcome instead of claiming success.
6. Keep the current report and original report visibly distinct. Explain that earlier onchain records may remain discoverable forever.

If no real ENS edit is safe, demonstrate live reads and clearly switch to the synthetic rehearsal for the counterfactual. A truthful mixed demo is preferable to claiming unsupported behavior.

## Three-minute live walkthrough

Spend the extra time on one new-wallet preview and one failure boundary. Show a proposed wallet's evidence only after the explicit provider disclosure. Show that a custom resolver or failed lookup leads to unknown consequences. Open coverage to explain the ten keys, known resolver implementation and separate name-control observations. Finish with export/import and the unverified-import label.

## Technical questions to be ready for

- **How do you know a value is inherited?** Supported immutable resolver address, `hasAddr` at the same block, independently read Default, and consistency checks. Identical address strings are insufficient.
- **What if the provider fails?** Unknown/error evidence, sanitized diagnostics and no synthetic fallback. The original snapshot stays visible.
- **What does “verified” mean?** Requested stored values observed at a newer block, with the same resolver semantics. It does not identify a transaction sender, prove finality or erase past exposure.
- **Who sees the query?** Footprint's API, the RPC operator and Mobula as disclosed; hosting logs are a separate operational consideration.
- **Why Mobula?** It supplies the financial evidence that makes a publishing decision concrete, with contract provenance and an optional bounded activity sample.
- **Why ENS?** It is both the public identity layer and the place where the user decides what to publish. The core feature depends on real resolver behavior.
- **Why no signing?** Payment addresses and name-management roles can differ. This build keeps edits in the official ENS application and independently inspects the result.

## Recording and submission checklist

- Prepare a 90-second video and optionally a longer live recording; confirm the final organizer format.
- Use Present mode. Keep the synthetic/live/imported label in frame.
- Hide terminals, `.env`, API dashboards and any unrelated personal information.
- Test video, repo and deployment links in a private browser window.
- Confirm the project-specific source and lockfile are committed in genuine hack-week history.
- Confirm sponsor-specific requirements and whether both bounties can be entered.
- Plan to submit before **September 5, 2026 at 09:00 CEST (Amsterdam local time)**; resolve any organizer discrepancy directly.
- Add the real recording/deployment links to `SUBMISSION.md`. This file is a script, not a recorded video or submitted entry.
