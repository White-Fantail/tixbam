# Purchase scope v2 — sale-independent duplicate protection

Live payment remains disabled. This change closes the AB-05/06 gap where a
presale/general sale or seller change created another purchase scope.

## Contract and behavior

A purchase goal is `(authenticated TixBam account, canonical Performance ID)`.
Seller, sale, event page, plan, quantity and budget are execution/approval terms,
not separate purchase goals. Another performance or account is independent.
Catalog identity must be verified by the host/server. Separate catalog rows that
actually describe the same show are not automatically inferred or merged.

Server execution leases stay sale/provider-specific. The permanent
`purchase_guards` row is unique by user/performance and is inserted in the SAME
transaction as the conditional lease claim. Concurrent unique conflicts return
409; stale owner/token/fence or a changed plan rolls back the inserted guard.
There is no guard unlock, deletion, expiration takeover or manual paid/unpaid API.
A valid guard is not vendor payment permission or merchant receipt proof.

Desktop memory ownership and local HMAC scope also ignore seller/sale/plan.
The journal scope is `HMAC(localKey, [purchase-scope-v2, accountId, performanceId])`.
Local keys are device-specific; cross-device protection depends on the server,
not comparing HMACs between devices. Offline rehearsal uses isolated storage.

Before a live claim request, the host records RUN_CREATED, OFFER_LOCKED and
CLAIM_REQUESTED under one exclusive Journal transaction and fsyncs them. This
blocks a replay even if the server response is lost or the application dies
before COMMIT_INTENT_RECORDED. Only the same run/permit/order can upgrade that
latch to commit, once. Claim-only records cannot accept submission/receipt events.
Unknown safety claims have `claimOnly`/`safetyRecoveryRequired` metadata; their
message explicitly states that payment submission is not established.

No caller can obtain live payment execution via these contracts: the release
switch remains OFF and the only production-attached payment implementation is
none. The mock executor still accepts only the bundled synthetic adapter.

## Legacy storage and rollout

The physical `journal-v1.ndjson`, key and lock filenames are intentionally kept.
New events have format version 2; mixed v1/v2 reads validate the original hash
chain. Old bytes are never rewritten and no empty replacement ledger is created.
Old software rejects the new format instead of interpreting it as a new wallet.
Unmappable v1 REAL attempts, including completed ones, quarantine new purchase
intents on that device (`legacy_scope_unresolved`). Synthetic v1 history remains
readable. There is no automatic unquarantine or digest-conversion API: old HMACs
cannot be inverted to recover a performance. Human not-paid reports never unlock.

Startup additively backfills guards from legacy claimed lease rows. Conflicting
legacy claims across sales/providers become `review_required`. The migration is
idempotent and retains all old leases/fences. Request-time checks also consult
legacy claims. Dangling historical performance references block new claims for
that account rather than being discarded. Guard history has no cascading FK to
the catalog; any performance with lease/guard history cannot be hard-deleted.
There is no automatic alias/merge workflow; this is still a release prerequisite
if duplicate catalog identities exist.

Deployment/rollback must preserve autonomy OFF. Drain old API workers before any
future live release: old binaries cannot enforce a table they do not know. All
new claim handlers enforce the guard, including requests from old clients; the
new Desktop rejects claim responses missing the v2 guard identity. Rolling back
to an old payment-capable worker is prohibited. Never drop the new guard table,
restore a pre-guard database snapshot or remove Journal locks to bypass debt.

## Verification

- Desktop scope regressions: different sale/provider/plan/event/quantity,
  independent session/account, restart, legacy bytes, mixed formats, fsync failure,
  lost claim response, exact one-shot claim-to-commit upgrade, fake guard replies.
- API regressions: presale/general sale and cross-seller existing leases, stale
  fence rollback, current plan validation, migration rerun/conflict/orphan debt,
  guarded performance deletion.
- PostgreSQL concurrency: `test_postgres_competing_workers_commit_exactly_one_guard`
  uses independent sessions and a barrier before guard insertion. It requires
  `TIXBAM_TEST_POSTGRES_URL`; CI supplies a disposable PostgreSQL 16 service.
  The test creates/drops only a generated schema, never production tables.
- Release hold script checks both local v2 scope and the server unique guard,
  as well as the existing no-live-payment invariants.

Official receipt integration, payment approval, operator signoff and signed macOS
packaged QA are still HOLD. This patch authorizes no real charge or deployment.
