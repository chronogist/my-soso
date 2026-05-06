# ADR 0004 — Privy for auth + Wave 3 signing

**Status:** Accepted
**Date:** 2026-05-07
**Supersedes:** earlier "Proposed: Turnkey or Privy" version

## Context

We had two decisions to make:

1. **Wave 1 auth.** Originally email magic link via Resend.
2. **Wave 3 signing.** SoDEX requires EIP-712 signatures from an EVM address; we must not custody raw private keys.

We were going to need a hardware-enclave key-management provider (Turnkey or Privy) for Wave 3 anyway. Picking it now and using it for Wave 1 auth as well consolidates two integrations into one and means no migration when execution lands.

## Decision

Use **Privy** for both Wave 1 authentication and Wave 3 signing.

Rationale:
- Privy combines email login + auto-provisioned embedded wallet in one flow. A user signs up with email and gets a wallet address with no extra UX step.
- Embedded wallet keys live in Privy's TEEs / MPC sharded enclaves. Raw keys never touch our infrastructure.
- Sub-organization-per-user model (also offered by Turnkey) — clean tenant boundary at the custody layer.
- Free tier covers hackathon and early traction. Pricing scales reasonably with MAU.
- Removes Resend from the stack; Privy handles the email magic-link UX itself.

Turnkey is comparable on the security model but does not bundle email login + wallet provisioning the way Privy does. For our combined Wave 1/Wave 3 use case, Privy is the better fit.

## How signing works in Wave 3

1. User authorizes a **session key** scoped to SoDEX, with spending caps and a 7-day expiry.
2. The session key occupies one of SoDEX's 5 API-keys-per-master-account slots; SoDEX itself enforces scope on its side.
3. Worker calls Privy SDK ("sign this EIP-712 payload") → Privy enclave signs → Worker submits signature + payload to SoDEX.
4. We store only the session-key public address in our DB.

Two layers of containment: Privy enforces scope from our side; SoDEX enforces scope from its side.

## Consequences

**Good**
- One vendor for auth + custody. One billing relationship, one SDK, one SLA.
- Raw private keys never enter our infra. A full DB breach exposes wallet addresses, not signing power.
- Spending limits and allowlists enforceable both at Privy (signing layer) and SoDEX (account layer).
- Embedded wallet by default = every Wave 1 user is Wave 3-ready with no migration.

**Bad / accepted**
- External dependency. Privy downtime = our login + Wave 3 execution downtime. Mitigation: Wave 1 chat answers don't depend on Privy after login (session JWTs are long-lived enough); execution is gated but Q&A keeps working.
- Vendor lock-in on user identity + custody. Migration off Privy is non-trivial. Pick once, deliberately.
- Pricing scales per MAU. Need to model before paid tier launch.

**Trigger to revisit**
- Privy raises prices materially or sunsets a feature we depend on.
- Privy can't support a chain we add later.
- A different provider (Turnkey, Dynamic, Magic, etc.) ships a meaningfully better security or UX guarantee.

## Open before Wave 3 build starts

- Confirm Privy's policy engine supports SoDEX EIP-712 payloads cleanly (typed-data signing, not raw bytes).
- Confirm session-key UX in Privy — server-side calls without per-trade user interaction.
- Confirm Privy's pricing tier we'll occupy at expected scale.
