# Live Booking Control Room — implementation and acceptance criteria

## User goal

The operator needs to know which ticket sale is active, keep the correct
browser alive, follow their non-negotiable buying conditions and avoid an
accidental refresh, duplicated charge or false success message.

This is a **booking assistance workspace**, NOT a seat-monitoring service, queue
priority service or fan-content view.

## Current release

- The Electron host (not the React UI) binds newly launched official browser
  windows to an opaque Booking Plan ID and validated installed provider.
- Reopening a Plan **focuses its existing window without a new navigation**.
  If a payment/login popup survived after its parent closed, focus the remaining
  popup instead of opening a new attempt.
- Browser popups (login or payment handoff) are tracked with their parent plan
  association, sandbox, isolated context and persistent provider partition.
- The Control Room shows the official domain, loading/network-failure status,
  provider, plan quantity, currency-specific all-in budget, hard seat conditions
  and any active host booking run. It shows **no queue position, current seats,
  successful payment or sold-out status unless established by the provider**.
- The operator may **manually** select a stage (Preparing / Waiting room /
  In queue / Selecting / Checkout / Verify). This controls coaching text only,
  never manipulates the provider page or creates evidence of checkout.
- Return to Live Booking remains available in the header while any plan-linked
  browser is open. The focused browser, not the promoter's original page, is
  selected when there has been an official ticket-agent handoff.
- Plan launch automatically selects the exact plan, while standalone/manual
  provider windows stay visually separate. Linked windows from another or
  unavailable TIXBAM account remain focusable and closable without falsely
  attaching them to the current user's plan.
- Native close of a plan-linked browser displays a queue/order loss warning.
  Native dashboard close while a live plan window exists hides the dashboard
  rather than killing in-flight host automation. The dashboard reappears on
  application activation. App Quit warns about destroying sessions.
- A small atomic local recovery journal contains only plan ID, provider ID,
  user-reported stage, timestamp and interrupted/closed marker (no URLs, page
  text, account email, cookies, queue tokens, seat data or payment secrets).
  Restart **never auto-reopens a queue or retries a purchase**; the app shows
  an interrupted/closed session reminder that can be dismissed without claiming
  purchase success.
- A provider-specific option-read in the live booking controller requires its
  browser to be bound to the exact Booking Plan. Generic watchlist options
  cannot act upon an unrelated plan-bound window.
- Provider currency mismatches and ticket quantity over provider limit are
  rejected rather than silently converted, truncated or guessed. Monetary
  values support zero-decimal currencies such as KRW/JPY.

## Security / truth boundaries

- The Electron main process is the source of truth for plan-window linkage.
  Generic open-window calls cannot set planId. The host validates add-on
  hostnames and refuses uninstalled providers.
- The site itself owns login, CAPTCHA, waiting room, bank authentication,
  orders and receipts; do not infer those states from page titles/URLs.
- Plan windows do not grant any new automated seat booking or payment rights.
  Existing Cityline public performance/price selection is unchanged. Real
  seat selection and payment remain unverified.
- Review confirmation requires an explicit user decision. Unknown payment
  outcomes never resume payment automatically.
- The host does not log or persist full navigation URLs from the booking
  workspace. The UI displays only the HTTPS hostname (not URL paths/queries).
- Closing a tab or quitting can lose provider queue state; there is no promise
  that TIXBAM can restore it after a crash.

## Manual QA scenarios (must be checked in a real packaged Electron app)

1. Create a Booking Plan directly from Dashboard. Also create one in Discover.
   Plan creation must not require favoriting or watching an artist first.
2. Launch a Cityline plan. Start a waiting room manually. Press Book again:
   the original window is focused, not reloaded, and cookies are preserved.
3. Create two plans for different Cityline performances. Open both. The
   Control Room shows distinct plan/window IDs and does not let one plan
   read booking options from the other plan's window.
4. From a Live Nation promoter page, use official Ticket Agent handoff.
   Confirm the new agent browser is linked to the same plan and can be
   selected/focused independently without reopening the promoter page.
5. Open an authorized provider popup; focus it from Control Room. Close the
   primary window and verify the popup is reused rather than starting a
   duplicate checkout.
6. Choose the Queue stage manually: it must be labelled **user-reported**,
   never displayed as an automatically detected queue position.
7. Try closing the native plan browser and cancel the warning. The window and
   phase remain unchanged. Then close explicitly and check recovery guidance.
8. While a ticket window is active, close the dashboard. It should hide
   without stopping host automation; activate TIXBAM to restore the dashboard.
9. Quit during an active session and cancel. Then quit intentionally, relaunch:
   no ticket pages, carts, queues or payments should auto-restart. A non-secret
   interrupted session reminder should be visible.
10. In provider booking settings, select a different plan's window: it is
    excluded/rejected. Enter a mismatched currency or excess quantity: live
    preferences must be rejected with a correction request.
11. Check review, awaiting-user, failed and payment-unknown booking runner
    messages. Confirm no unsupported automatic retry path is presented.
12. Sign out of one account with local windows still open, sign in to another:
    stale linked windows should remain manageable, but must not be assigned
    to a different account's plan.

Automated CI covers unit tests and builds, not the native OS dialogs and
real provider browser/queue integration. Actual third-party session behavior
requires manual verification with permission and appropriate test accounts.

## Deferred provider work

Validated queue states/offer lists from authorized APIs, event-specific
rehearsal fixtures, site-change diagnostics, provider receipts and legitimate
provider-supported automation remain future work. None are claimed by the
current Control Room.
