# Desktop localisation (Korean first)

The customer-facing Electron **Desktop** supports Korean (`ko`, default) and
English (`en`). This deliberately does not affect the English-only Admin
application, platform API, provider identifiers, official third-party sites
or ticketing automation rules.

## Architecture

- `src/i18n/index.ts`: locale registry, persistent reactive store, `tx()`
  and `tr()`, date/number formatters. English is the source-language fallback.
- `src/i18n/*-ko.ts`: separate Korean translations for common UI, booking
  plans, live control room, provider options and Cityline rehearsal. Long text
  and risk/financial wording should be human-reviewed.
- `i18n-vite.ts`: Desktop-only Vite plugin safely translates static JSX text,
  placeholders, accessible labels and visible conditional strings. It **does
  not** rewrite arbitrary strings such as provider IDs, payment statuses,
  program state, URLs or class names. Dynamic copy uses `tx()` explicitly.
- `electron/language.cjs`: supported-language validation and atomic local
  persistence in the Electron user-data directory.
- The dashboard and independently sandboxed rehearsal window receive native
  locale-change notifications, and both offer a language selector. The
  Settings selector applies the change instantly without losing work.
- Important Electron-owned queue-close/quit confirmation dialogs are bilingual.

## User experience

The first installation defaults to **한국어**. Go to **설정 → 앱 언어** and
choose **한국어** or **English**. The setting is on this device and persists
across restarts. A rehearsal window follows the same selection.

Date/time wording follows the display language, but a performance's official
IANA time zone is unchanged. Amounts remain in the original ticketing
currency. Locale changes must not convert HKD to NZD, modify payment amounts,
change eligibility rules or touch persistent provider cookies.

## Adding another language

1. Add a locale entry to `LANGUAGES` and its language type.
2. Create separate translated catalogues for that language, reusing stable
   English source phrases as keys, and select that catalogue in `tx()`.
3. Extend Electron's supported language-code validator and add native
   confirmation dialog copy where relevant.
4. Cover new plural/number/date rules with tests, then verify the dashboard,
   My Bookings, Discover, provider options, live safety alerts, Cityline
   rehearsal, error messages and native dialogs.
5. Keep unknown/new phrases in English until reviewed: untranslated strings
   must never substitute guesses for ticketing prices, legal conditions or
   payment states.

## Verification

`npm test --workspace @tixbam/desktop` checks language persistence,
Korean-first defaults and critical translation keys. The Desktop Vite build
also exercises the JSX transform. A packaged macOS manual QA pass remains
necessary for OS-native dialog language and simultaneous rehearsal windows.

*Note:* Third-party/remote error messages and official provider website
content are controlled by their respective services. The Desktop only
localises application-owned text; it does not translate or modify an external
ticketing page.
