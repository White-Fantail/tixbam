# Provider onboarding — AB-12

## Trust boundaries

AB-12 **does not** enable live bot ticket purchases, provider checkout or unattended payments. It distinguishes three separate facts:

1. **Vendor permission evidence** (`ProviderAutomationPolicy`) — contractual/legal restrictions by provider, country and capability; NOL/Ticketmaster/AXS remain protected; a Live Nation event page is not a ticket agent.
2. **Fixture verification evidence** (`ProviderCapabilityVerification`) — an Admin-reviewed *claim* of successful local simulation, with version/profile/suite/digest/reviewer/expiry/CAS revision. Reviewers must link a trusted CI run or test report. The API does not independently verify an arbitrary submitted SHA-256.
3. **Trusted host release** — a separately reviewed build, immutable host-executed observer/adapter, proven vendor authorization, owner/plan binding and release gate. AB-12 leaves this **disabled**.

## How to onboard a new provider

1. Record official allowed hosts/URL, country and provider terms in the catalog. Never mark a protected provider as live-automation permitted by changing an Admin checkbox.
2. Introduce an independent, reviewed, **data-only** fixture profile (provider, version, adapter ID, capability statuses, route, event identity). It must match the bundled catalog. Unreviewed add-on JS, arbitrary selectors/URLs/JS and payment scripts are not allowed.
3. Build a self-contained offline fixture for each relevant capability, with stable event identity, selected stage and no CAPTCHA, queue or payment. Run `node --test apps/desktop/electron/provider-verification.test.cjs` as part of CI. Keep seat/checkout capabilities pending until separately implemented and tested.
4. Compute/check the **local** `fixtureSha256` for passing synthetic fixtures. In Admin → Automation Policy → Provider, save the test suite ID, reviewed version, expiry and CI/evidence link using the current revision; a conflicting reviewer gets HTTP 409.
5. If terms change, a bug is found, the bundled version changes or evidence expires, set the corresponding technical record to **revoked** and/or revoke the provider permission. Do not re-enable with a normal toggle. Independently re-review in a new release process.

## Negative tests

- Unknown/uninstalled provider or add-on upgrade: denied.
- Ticket-agency promoter page (e.g. Live Nation) as Cityline source: denied.
- HTTP, credentials in URL, phishing suffix, repeated `event` param, changed performance/event, redirects: denied.
- Unknown fixture suite, unsupported operation, hidden provider, restricted provider, fake AI commands, corrupted evidence: denied.
- Updated revocation/expiry/country/version, concurrent stale revision: denied.
- Synthetic Payment fixture or server `permitted=true` claim: **never** authorizes a real charge.

**Evidence is not authority.** AB-13/14 add mock Payment Executor and reconciliation; future production activation requires explicit independent provider and host approval.
