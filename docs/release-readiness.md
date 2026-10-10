# TixBam AB-15 — Security & E2E Release Readiness

**Decision: HOLD / NO-GO for live autonomous ticketing and payments.**

This assessment applies to the \`dev\` branch (10 October 2026, NZDT). It is a code and **offline fixture** audit. It does **not** claim vendor authorisation, merchant-receipt verification, macOS notarisation, penetration testing or packaged hardware QA. Desktop manual ticket-site browsing and entirely synthetic no-charge rehearsal can remain available.

Run \`npm run release:check\` from repository root to produce a machine-readable JSON status for gates A–D. This evaluates fail-closed **source invariants**, not production evidence; even with all checks passing its result is \`HOLD\`. The new E2E tests, Python API tests and CI provide supporting automated regression evidence.

## A. Vendor permissions and provider capabilities — HOLD

| Scope | Offline verification / authority | Production booking decision |
| --- | --- | --- |
| Cityline HK | Current terms §21 prohibit automated access/interaction/transactions; option fixtures are offline only | **RESTRICTED**. Separate authorized integration and verified checkout/receipt required |
| Ticketmaster | Existing restricted-provider policy | **BLOCKED** |
| NOL World | Existing restricted-provider policy | **BLOCKED** |
| AXS | Existing restricted-provider policy | **BLOCKED** |
| Live Nation | Promoter/event URL; ticket agent handoff | **NO standalone checkout** |
| Other providers | No independently reviewed live profile + official permission | **BLOCKED** |

Admin's \`fixture_verified\` records only attest *claimed offline testing*; they do not grant production permissions. Validate signed provider documentation, actual vendor identity and authorized domains/countries/versions out of band. Maintain read-only evidence with expiry, reviewer, checksums and withdrawal. The host release switch is hardcoded **off** and a server policy cannot turn it on.

## B. Payments, account/session and durable idempotency — HOLD

See [Cityline live checkout](CITYLINE_LIVE_CHECKOUT.md) for the restored identity v2 contract, one-shot host transaction and typed receipt proof. These are not a live provider integration: permission, verified mapping, actual driver and runner bridge remain missing.

**Automated offline evidence** (CI): authenticated lease owner and server-side fencing tests, account-bound login and API origin allowlist, sandboxed Electron windows, AB-10 canonical offer and fee checks, AB-05 append-only fsynced Journal, AB-13 one-shot \`GatedMockPaymentExecutor\`, AB-14 synthetic reconciliation and restart recovery. Duplicate intent/failed fsync/timeout/crash after commit intent **must never automatically retry**. Live official receipt lookup is deliberately unimplemented; claimed server lease is never merchant proof.

**Missing before GO**: official authorized tokenized/hosted payment provider integration, verified merchant order/receipt reconciliation and idempotency keys across all devices, no duplicate-charge incident response, PCI/3DS scope assessment, independent payment security audit, refund/chargeback support and production canary without real-money surprises. Never store/send CVV/PAN to OpenRouter or to TixBam API. No auto-retry on UNKNOWN even when human says not paid.

## C. AI, authentication, privacy and operational readiness — HOLD

**Automated offline evidence**: OAuth PKCE origin-bound main-process account flow, no renderer access to bearer tokens, account-scoped server leases/admin key checks, AI \`extra=forbid\` observation schema and strict JSON, ephemeral proposal/target bindings, output codes allowlist, no arbitrary JS/shell/tool invocation, human approvals, token/time/rate budgets and model failure fallback. The executor accepts only the exact synthetic \`ScenarioAdapter\`; actual payment remains unconnected. The API's strict technical-fixture record cannot be mistaken for live permission.

**Missing before GO**: third-party penetration and threat-model signoff (OAuth redirect/state, Electron preload/IPC, cookies, origin redirects, provider JavaScript, dependency supply chain, token exposure, replay/race, billing abuse); privacy review and data retention/deletion DPIA as applicable; live logging redaction review; on-call operator and support ticket procedure; secure account/secret rotation, emergency revocation drills; provider-specific challenge handoff acceptance.

Proposed production metrics must remain **no-op until an approved deployment**:
- \`booking_lease_conflict\`, \`lease_lost\`, \`stale_fencing_denied\` and global kill-switch decisions, by provider (no account IDs)
- \`payment_unknown\`, \`journal_locked\`, \`duplicate_purchase_blocked\`, \`reconciliation_manual_review\` and time-to-resolution (opaque attempt hashes only)
- \`ai_planner_request\` / timeout / strict-schema rejection / no-op fallback, privacy-safe per-provider aggregate, model cost and latency percentiles
- \`provider_profile_version_changed\`, permission-revoked, expiry, CI dependency advisory findings

Alerts: any unexpectedly attempted production payment or release-switch flip → **SEV-1 immediately disable autonomy**; journal poisoning/unknown charge → stop workflow and human reconciliation, no auto replay; abnormal AI leakage/failures → disable PlannerV1 and purge pending proposals. Agree thresholds, on-call ownership and alerts before production.

## D. Distribution, CI and rollback — HOLD

**Automated checks**: Node CI uses committed \`package-lock.json\` via \`npm ci\`; GitHub checkout/setup actions are pinned to reviewed SHA, Python dependency consistency is checked, npm production advisory scan is run as a **non-release signal** (scan failures MUST be reviewed), existing desktop/API/crawler suites and Railway Docker build run, plus the read-only release HOLD assertion. Security E2E tests include tampered runtime capability, phishing URLs, PII/model injection, account origin rejection, durable mock checkout, crash recovery, ambiguity, and pricing drift. The test suite **never connects to a live payment provider**.

**Remaining blockers**: exact transitive Python constraints/SBOM and vulnerability triage, npm advisory results/remediation, trusted reproducible desktop installer provenance, **macOS signed/notarized packaged app** and real device QA including queue/CAPTCHA, screen readers and Korean/English, independent production/rollback and DB backup/restore drills, environment separation and release protection approvals, uptime/latency load tests. Desktop renderer CSP and site-specific permissions also require independent review. The API Docker base digest and production secrets/rotation are not yet attested.

## Safe deployment / rollback procedure

1. Default feature: **autonomous booking OFF**, AI suggestion limited to opted-in rehearsal. Never expose a payment-enable toggle in Admin/renderer, do not merge unreviewed release flag code. Preserve manual/official provider browsing.
2. CI and security signoff must complete. Get provider permission by capability/region, payment credentials issued only for the documented official flow, and supervised pilot signoff. Do **not** treat this document as signoff.
3. Operator performs explicit GO/NO-GO with named approvers, immutable build hash, artifact signatures, rollback target, metrics baseline, and customer/merchant escalation contact. Require two independent human approvers for a future payment release.
4. On incident: disable AI Planner and host-autonomy distribution, revoke vendor authorization/leases, freeze affected purchase intents; **never** delete local Journal or manually remove an orphan lock without reconciliation. Preserve audit and ask customers to verify official provider receipts.
5. Deploy rollback only after checking claimed server leases, \`PAYMENT_UNKNOWN\` attempts, application window ownership, and merchant order history. Never roll back by replaying a purchase.

## Acceptance evidence matrix

| Automated category | How to verify | Meaning |
| --- | --- | --- |
| Source HOLD invariants | \`npm run release:check\` (prints JSON) | An accidental release flag change fails CI. A green result is still HOLD |
| Desktop security/E2E | \`npm test\` | Offline auth origin, phish URLs, isolation, AI redaction, offer/fee, journal, fencing, one-shot mock payment, restart |
| API + MCP ownership | \`python -m pytest services/api/tests -q\` | Server authenticated lease ownership/fencing, scoped reconciliation, Admin policy, OpenRouter strict schemas |
| Crawler | \`python -m pytest services/crawler/tests -q\` | Basic crawler regressions |
| Build/dependency | CI Docker + \`npm ci\` + \`npm audit\` + \`pip check\` | Compilation and preliminary supply-chain diagnostics, **not** complete SBOM attestations |
| Packaged macOS, signer, distribution, live vendor acceptance | Manual/offline review and official provider evidence | **NOT VERIFIED — hard GO blockers** |

**Release decision remains HOLD, not GO.** The AB-15 deliverable is a credible stop/go checklist and tested fail-closed implementation, *not* production activation.

## AB-15 implementation notes

The Electron host now denies unreviewed `<webview>` attachments on every window, refuses camera/location/microphone permission requests for Dashboard and rehearsal sessions, and limits pop-ups within `MAX_WINDOWS`. The safe HTTPS URL parser also rejects nonstandard TLS ports, raw/percent-encoded control characters and backslash URL normalization tricks.

The production-only Node advisory scan is designed to fail the CI job on high-severity advisories. This does not replace a full SBOM/dependency audit (Python dependencies remain ranged, dev-only Node packages are not covered by this command).
