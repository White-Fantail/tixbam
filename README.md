# TIXBAM

**Your ticketing command center.** A desktop prototype for fans who use several official concert and fan-meeting ticket providers.

> Prototype only. TIXBAM does not sell tickets, guarantee successful purchases, scrape inventory, bypass queues, or solve CAPTCHA. All logins, verification steps, seat selection and payments are completed manually on the provider's site.

## Get started

Requires **Node.js 22+**, npm and a desktop computer (macOS, Windows or Linux).

```bash
npm install
npm run dev
```

The command starts the Vite UI and the Electron application. To preview the dashboard in a regular browser (ticketing windows unavailable), use `npm run dev:web`.

```bash
npm test       # domain / navigation safety tests
npm run check  # TypeScript typecheck
npm run build  # production Vite renderer
npm run desktop # opens production renderer after npm run build
```

## What works in v0.1

- **Six built-in installable add-ons:** Cityline, NOL World (formerly Interpark Global), YES24 Ticket, Ticketmaster, AXS, and KKTIX.
- **Real provider browser windows:** opens official HTTPS sites inside sandboxed Electron BrowserWindows.
- **Per-provider persistent sessions:** windows for the same provider share cookies and storage across app launches; different providers have separate storage partitions.
- **Multiple windows:** up to six provider windows concurrently, with window focus, close and clear-storage controls.
- **Manual ticketing workflow:** log in yourself, complete CAPTCHA yourself, and follow each provider's queue / transaction rules.
- **Event watchlist:** add your own events with provider, city, on-sale date and deep link, saved locally in the dashboard.
- **Responsive dashboard:** overview, events, sessions, provider directory and settings, plus demo events clearly marked as fictional.

## Security and limitations

- The **main dashboard** uses an isolated preload bridge and only exposes narrowly scoped IPC operations.
- **Ticket pages** run with Node integration disabled, sandbox enabled and an isolated provider-specific persistent storage partition.
- Opening a new provider window validates its first URL against an explicit HTTPS provider domain list. No general arbitrary-URL navigation is exposed through the dashboard.
- Once a real provider page has opened, user-driven cross-domain HTTPS navigation can occur (necessary for identity and payment redirects). Provider pages do not receive the dashboard preload.
- Authentication state is **not detected or promised** by TIXBAM; a window being open is not evidence of login.
- Opening multiple windows **does not create independent queue positions** when they share a session. Some providers may invalidate sessions, block Electron browsers, disallow simultaneous windows, or prohibit certain uses. Always follow official rules.
- Event details in demo cards are **fictional**, not current sale announcements or live availability.
- No cloud accounts, checkout integration, payment card collection, bot automation, or CAPTCHA bypass are included.
- The initial watchlist is kept in the renderer's local storage, so it is device-local, not synced.

## Project layout

```
electron/            Electron main process, limited IPC, isolated browser sessions, safety tests
src/                 React + TypeScript dashboard
addons/catalog.json  Versioned built-in add-on catalog
 electron/addon-manager.cjs  Local installation state and launch authorization
.github/workflows/   CI for tests, typecheck and renderer build
```

## Next milestones

Provider-specific launch / login compatibility testing, dedicated multi-pane WebContentsView workspace, event notifications, secure preference storage and macOS/Windows packaging. Provider support should be validated against site terms and security constraints before release.

## Add-ons (v0.2)

Open **Add-on Store** from the dashboard to install or remove Cityline, NOL World, YES24 Ticket, Ticketmaster, AXS, and KKTIX. The add-on manager saves the enabled IDs in Electron userData/addons.json, and the main process rejects launching disabled add-ons even if the UI is bypassed. On first upgrade, all six are enabled to preserve the previous setup. Removing an add-on requires closing its open windows and **does not remove sign-in cookies or saved events**; use Settings to erase provider storage separately. Quick Launch shows installed add-ons only.

The bundled catalog is the first manifest format: each record declares id, version, official URL, allowedHosts, display metadata, and capabilities. This release installs/removes bundled provider adapters rather than downloading untrusted code. Future independently packaged add-ons must use signature verification, a capability-based API, and explicit per-host permission validation before introducing remote downloads or third-party scripts. No automation, queue circumvention, or unattended checkout is present.

## Add-on automation levels (capability manifest)

The built-in `addons/catalog.json` registry now records `automation.level1`, `level2` and `level3` for every provider, with `status`, a reason, optional official policy link and `reviewedAt`. Add-on Store displays this three-level matrix.

- **L1 — Assistant (available prototype):** event watchlist, official provider windows and locally persisted per-provider sessions. Ticket-drop notifications are **not** implemented yet.
- **L2 — Assisted selection:** seat/type and quantity assistance where explicitly authorized by the provider.
- **L3 — Full auto checkout:** only when a documented, authorized provider integration allows checkout.
- **restricted:** public terms impose relevant limits (for example Ticketmaster, AXS, NOL); this is not an assessment of separately approved partner integrations.
- **unverified:** provider permission is not established; this is **not** a supported or enabled feature.

**No L2 or L3 automation is currently implemented, enabled or tested for any add-on.** The capability matrix reports current limitations honestly and does not enable automated workflows. Site terms vary by jurisdiction, event and date; published conditions must be reviewed before any capability is upgraded. Review date for initial catalog: October 8, 2026. Any future promotion to an available status should require verified provider authorization, tested implementation, and an enforcement gate in the Electron main process (not only a UI badge).

References used to classify restrictions: [Ticketmaster NZ terms](https://www.ticketmaster.co.nz/h/terms.html), [Ticketmaster NZ purchase rules](https://www.ticketmaster.co.nz/h/purchase.html), [AXS NZ terms](https://www.axs.com/nz/about-terms-of-use_NZ_v1.html?staticDetails=staticDetails), [AXS purchase agreement](https://www.axs.com/about-purchase-agreement_US_v6.html), [NOL World terms](https://world.nol.com/en/pages/tos.html). Other providers remain unverified.
