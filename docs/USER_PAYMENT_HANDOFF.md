# Provider selection and payment handoff

Level 2 (seat/order assistance) and level 3 (payment automation) are separate
permissions. A payment restriction alone must not prohibit permitted selection.
Cityline currently restricts both; this change does not authorize Cityline bots.

The current host has no enabled live payment executor. A validated payment-stage
order without a verified executor enters MANUAL_PAYMENT. It clears preparation,
keeps the original window/run ownership while active, and does not resume any
adapter actions even when a caller explicitly requests confirmation. The user
finishes payment in the original provider window, with its existing session.
Rehearsal automatic payment continues to use its existing mock executor.

The legacy payment-stage handoff does NOT establish that seats are held, that a hold has an expiry, or
that a purchase succeeded. No completed status or synthetic receipt is inferred.
Stop does not cancel provider reservations or user payments. Active-run/lease
protection is not a durable cross-restart guard for manual payment: after an app
restart or explicit stop the user must check the provider order history first.

The Express reservation contract now has a separate pre-allocation request,
strict post-allocation cart/hold verification and durable before-dispatch intent.
The rehearsal lab exposes five Express scenarios (verified synthetic hold,
response lost, separated seats, expired hold, and missing hold). Successful
synthetic verification enters MANUAL_PAYMENT without any payment executor.
No real Cityline reservation driver is attached. The two-minute rehearsal hold
is a mock value, NOT a Cityline concert deadline.

Remaining provider integration work: a host-reviewed reservation observer with
verified seat/order identifiers and hold expiry, real reservation driver and
authorized release, passive receipt observer, durable manual-handoff recovery.
Do not enable a provider merely because its manifest advertises level 2 or 3.
