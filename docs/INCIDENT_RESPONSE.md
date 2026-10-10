# AB-15 Incident response & safe rollback — TixBam

The incident policy for ticketing is **unknown charge = potentially charged**, not "safe to try again".

## Immediate containment

1. Stop active autonomous booking/recovery actions and disable any server AI Planner enable switch. The immutable host live release flag remains false in the current version.
2. Record UTC timestamps, provider/country, release SHA, hashed scope/attempt ID, non-secret lease/fencing reference and scenario. **Never** copy PAN/CVV, OAuth codes, bearer tokens, cookies, raw HTML or full seat/payment descriptions to telemetry.
3. If a journal is corrupt, poisoned or locked, leave it intact. Do not unlink locks or edit records during triage. Keep \`PAYMENT_UNKNOWN\` and the server \`claimed\` lease blocked.
4. Direct the user to the official order history and provider support; manual "not paid" is *not* proof that retrying will not double-charge.
5. Reconcile against authoritative **merchant** receipt only when an approved API exists (not implemented for live in AB-15).

## Operator triage

- **SEV-1**: unauthorized live purchase attempt, OAuth/session leakage, unreviewed addon execution, journal bypass. Disable new workflow requests and revoke credentials; preserve evidence and initiate security incident response.
- **SEV-2**: persistent unknown payment, lease/fencing mismatch, recurrent PlannerV1 malformed outputs. Stop the run, retain evidence and transfer to manual support.
- **SEV-3**: isolated offline rehearsal defect or malformed untrusted URL blocked by the host. Fix in \`dev\`, add negative regression, do not unblock production.

## Rollback checklist

- Verify the last known good signed build and Railway/Vercel deployment configuration. Preserve encrypted account storage and the purchase safety Journal.
- Apply the server's kill switch and provider-specific revocations as a defense in depth; these are **not** a substitute for the host release gate.
- Record the affected claimed leases and open manual reconciliation tickets **before** restarting any host application. A process restart is not an authorization reset.
- Roll back source/build with Git fast-forward policy and deployment-specific approved rollback procedure (never automatically reset the shared source \`main\`).
- Run the full offline suite and require independent incident closure and vendor permission recertification.

## Dry-run proof

\`node scripts/release-readiness.cjs\` must report all source checks passed, gates A–D HOLD and \`livePaymentEnabled=false\`. The release E2E suite must prove malicious payment APIs and cross-window requests do not reach a live executor, and confirm known \`payment_unknown\` remains blocked after restart.

**No automatic production incident alerting or live runbook integrations are claimed in this version.**
