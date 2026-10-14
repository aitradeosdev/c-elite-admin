# CardElite Admin — Target-State Implementation Checklist

Living traceability matrix for `master.md` + `newui.md`.
Every requirement is one row. Nothing is marked done until the workflow works end to end:
UI → API → authorization → business logic → database → audit.

**Status key**

| Mark | Meaning |
|---|---|
| `DONE` | Works end to end, server-enforced, audited where required |
| `PART` | Exists but incomplete against the spec (reason stated) |
| `TODO` | Not started |
| `BLOCK` | Blocked by a named external dependency |
| `N/A` | Deliberately out of scope (reason stated) |

Last updated: 2026-09-30 — Phase 1 (audit) complete; foundation libraries, dashboard + withdrawal correctness, the confirmation/error/session layer, the shared-component consolidation and the login rebuild have landed.

---

## 0. As-built baseline (verified 2026-09-30)

Next.js 16.2.2 App Router · React 19 · Supabase service-role server-side · Tailwind v4 + CSS Modules.

| Metric | Count |
|---|---|
| Dashboard pages | 27 |
| API route files | 40 |
| Total `app/` TS/TSX/CSS lines | 16,351 |
| Shared UI primitives | 12 files in `app/_ui/` |
| Admin DB tables | `admin_users`, `audit_log` (partitioned, append-only), `admin_alerts`, `admin_alert_delivery`, `admin_push_tokens`, `admin_notification_preferences` |

**What already meets the target and must be preserved, not rebuilt:**

- `app/_ui/tokens.css` — semantic light/dark tokens, Inter + JetBrains Mono, 4px scale, indigo accent.
  `newui.md` §67 explicitly says to consolidate these rather than replace them.
- `proxy.ts` — CSP with per-request nonce + `strict-dynamic`, cross-origin POST rejection, mobile-admin bearer exemption.
- `next.config.ts` — HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy.
- `app/lib/jwt.ts` — every request is checked through `admin_auth_state` (the admin row, `token_version`, and since
  1.7s the device session and two-step state), so deactivation and session revocation take effect immediately; an
  outage is a 500, never a sign-out. Dual cookie / `x-client: mobile-admin`
  bearer support — the mobile admin app depends on this (`master.md` §38).
- `audit_log` is range-partitioned by month with an append-only trigger, `mask_audit_jsonb` account masking,
  automatic partition creation and pruning. Schema is thin but the substrate is sound.
- `app/lib/redact.ts` — redaction allowlist used before writing audit rows.
- Working business RPCs: `admin_approve_withdrawal`, plus the `resume-withdrawal` edge function.

---

## 1. Confirmed gap register

Each row verified against the source at the cited location. Ordered by severity.

### 1.1 Financial correctness

| # | Finding | Evidence | Spec |
|---|---|---|---|
| F-1 | ~~Withdrawal approval loses its audit trail on gateway failure.~~ **FIXED.** The RPC commits the state transition first; if `resume-withdrawal` then failed, the route returned 500 and the `audit_log` insert was never reached. Worse, the `fetch` had no `try`/`catch`, so a network timeout threw an unhandled rejection: no audit, no state report, withdrawal stranded in `processing`. Now: timeout-bounded fetch, always audited with `result` + `error`, and the response reports the withdrawal's actual post-call status and whether the provider was reached. | `app/api/withdrawals/[id]/approve/route.ts` | master §26, §40 |
| F-2 | ~~No idempotency on approve/reject.~~ **NOT A DEFECT — verified.** `admin_approve_withdrawal` takes `SELECT ... FOR UPDATE` and re-checks status inside the transaction, and `resume-withdrawal` claims the row with a compare-and-swap (`update status='processing' where status='initiated'`). Two concurrent approvals cannot both reach the provider. The route pre-check is a nicety, not the guard. Residual: no idempotency key on the admin→edge hop, so a network retry after an unacknowledged success is caught by the CAS rather than by a key — adequate, provided the admin is told the resulting state, which the F-1 fix now does. | `schema.sql`, `supabase/functions/resume-withdrawal/index.ts:58-70` | master §7, §40 |
| F-3 | ~~Dashboard money summed in the Node process from downloaded rows.~~ **FIXED.** Replaced by the `admin_dashboard_metrics(from, to, online_from, groups)` SQL function — one round trip, all aggregation in Postgres, scoped per permission group. | `schema.sql`, `app/lib/dashboard.ts` | master §7.3, §30 |
| F-4 | ~~Every dashboard query swallowed its error into `0`.~~ **FIXED.** A failed aggregate surfaces as `metrics_error`; the page renders `Unavailable` per KPI plus a banner, and `/api/dashboard` returns `INTERNAL_ERROR` instead of a body of zeros. | `app/lib/dashboard.ts`, `app/(dashboard)/dashboard/page.tsx`, `app/_ui/Misc.tsx` | master §27, newui §3.7 |
| F-5 | ~~Wrong pending-withdrawal count.~~ **FIXED.** The dashboard counted `status='initiated'`, which `admin_approve_withdrawal` sets *after* approval — so the "pending" KPI was counting in-flight payouts while the real review queue (`pending_review`, `held`) was never shown at all. Now split into `pendingWithdrawals` (review queue), `pendingWithdrawalValue` and `processingWithdrawals` (in flight). | `schema.sql` | master §7 |
| F-6 | ~~No wallet adjustment capability at all.~~ **FIXED (1.7p):** single-admin, audited adjustments through `admin_adjust_wallet` with an append-only `wallet_adjustments` record (D-27, D-28, D-31). A full ledger with an opening balance per wallet stays with reconciliation (F-7). | `schema.sql` `admin_adjust_wallet`, `app/api/users/[id]/wallet-adjustments/route.ts` | master §10.2 |
| F-7 | No reconciliation of any kind. | absent | master §8.6 |
| F-9 | **Freeze/unfreeze reported success even when the database write failed.** The `update` result was never checked, so a failed write still returned `{success:true}` **and** wrote a `FREEZE_USER` audit row for a freeze that never happened — a false audit record, which is worse than a missing one. **FIXED**: the update is now a guarded compare-and-swap, the result is checked, and audit records `result: failure` with the error. | `app/api/users/[id]/route.ts` | master §14, §36 |
| F-8 | **Card rejection is a 4-step non-atomic sequence.** Submission flips to `rejected`, then the `giftcard_credit` transaction is updated or inserted, then a notification is emitted, then the audit row is written. A failure after step 1 leaves a rejected submission with a stale credit transaction. Same shape in the `uphold` branch. | `app/api/card-queue/route.ts:190-262` | master §26 |
| F-10 | ~~**Freezing an account did not stop an admin approving its pending withdrawals.**~~ **FIXED (owner decision D-14).** `admin_approve_withdrawal` checked status only; `resume-withdrawal` checks nothing about the account. A frozen user's `pending_review` / `held` payout could be approved and sent. Now the function reads `users.is_frozen` under `FOR SHARE` after locking the withdrawal and raises `Account is frozen`; the approve route maps that to `STATE_CONFLICT` with an actionable message; the withdrawals page marks frozen accounts (row badge, mobile row flag, drawer callout) and refuses before the confirmation opens, using a fresh read. Rejection still works and refunds the frozen wallet. Lock order verified deadlock-free: `process_withdrawal_debit` and `finalize_account_deletion` lock `users` first but never lock an existing withdrawal row, and no trigger fired by approval (canonical or live, incl. the two admin-alert triggers) writes to `users`, so the share lock is never upgraded. Live body matched canonical before the edit. **Residual:** a freeze does not recall payouts already `initiated` / `processing`; `resume-withdrawal` has no freeze check, but its only caller is the approve route immediately after the RPC. | `schema.sql` `admin_approve_withdrawal`, `app/api/withdrawals/[id]/approve/route.ts`, `app/api/withdrawals/route.ts`, `app/(dashboard)/withdrawals/*`, `app/(dashboard)/users/[id]/*` | master §7, §14 |
| F-11 | ~~**Approving a withdrawal from the mobile admin app could strand the payout.**~~ **FIXED (wave-1 migration review).** The approve route forwarded only the `admin_token` cookie to `resume-withdrawal`. The mobile app authenticates with a Bearer header and sends no cookie, so the edge function refused ('Admin JWT required') after `admin_approve_withdrawal` had already moved the row to `initiated` — no payout, no refund. Now the route forwards the credential that authenticated the request, chosen exactly as `verifyAdminFromRequest` chooses it (a mobile Bearer only if it verifies, otherwise the cookie), and refuses with `AUTH_REQUIRED` before the state change if there is none. **Never hit production:** checked live 2026-10-02 — no withdrawal is `initiated` or `processing` and no admin approval has ever been recorded. | `app/api/withdrawals/[id]/approve/route.ts` | master §7, §40 |

### 1.2 Timezone

| # | Finding | Evidence | Spec |
|---|---|---|---|
| T-1 | ~~"Today" was the Node process's local midnight, not Africa/Lagos.~~ **FIXED** for the dashboard. `app/lib/time.ts` derives Lagos day boundaries through `Intl`, covered by 21 tests, and matches the existing `app_config.alert_timezone`. | `app/lib/time.ts`, `app/lib/dashboard.ts` | master §31 |
| T-2 | Remaining pages format timestamps with `toLocaleDateString()` in the viewer's timezone and CSV exports emit raw ISO. To migrate onto `formatBusinessDate` / `formatBusinessDateTime`. | 11 pages | master §31 |

### 1.3 Sensitive data

| # | Finding | Evidence | Spec |
|---|---|---|---|
| S-1 | **Submitted card values are shared externally with no permission check and no audit event.** WhatsApp, Telegram, mailto, clipboard and `navigator.share` with image files, from the web card panel **and the mobile card-detail screen** (`CardEliteAdmin/lib/shareSubmission.ts`). **Owner decision 2026-10-01: option 2 — keep sharing, gate it behind a permission, audit every share.** Built: new permission `sensitive_data.share` (critical; **no legacy key grants it** — pinned by tests), image download stays on `sensitive_data.download`; `GET/POST /api/card-queue/share` — GET reports what the caller may do, POST requires `cards.read` + the channel's permission, builds the share text **server-side** in the exact pre-existing format, signs images for 5 minutes, writes `SHARE_CARD_SUBMISSION` / `DOWNLOAD_CARD_IMAGES` (labels only, never the codes) and **fails closed** if the audit write fails. Mobile wired (Share button only when permitted; text/images from the server). **Web card-queue wiring pending** until the wave-1 rebuild of that page lands. **Grant UI pending** — wave 2 admin-accounts; until then only super admins can share. Deploy the web admin before the mobile update, or mobile sharing fails. | `app/lib/cardShare.ts`, `app/api/card-queue/share/route.ts`, `CardEliteAdmin/app/card-detail.tsx` | master §41, newui §4.7 |
| S-2 | Submitted card fields render in clear by default — no masking, no reveal gate, no reveal audit. | `app/(dashboard)/card-queue/page.tsx` detail panel | master §41 |
| S-3 | Card images are fetched by URL from the client; no signed-URL expiry contract on this path. | same | master §41, newui §70 |

### 1.4 Authorization

| # | Finding | Evidence | Spec |
|---|---|---|---|
| A-1 | **Permission model is page-level only.** `admin_users.page_permissions text[]` holds one key per page. Read and approve are the same grant: `withdrawals` permits both viewing and approving a payout. | `schema.sql` `admin_users`, all `app/api/*/route.ts` | master §15.2, §15.3, §39 |
| A-2 | The standalone flag list and its Clear / Escalate / Reject actions were super-admin-only (`/api/flagged-transactions`, verified in the 21 Sept commit) with no page. Admins with Withdrawals access always saw each flag on the withdrawals they review (web drawer, mobile detail) and got flag alerts on mobile, and approving or rejecting a withdrawal resolves its flag. **FIXED (D-23, D-24):** Withdrawals admins can read the flag list, so the mobile flag list works for them. There is no standalone page: the Withdrawals Review tab shows every flag, and approving or rejecting resolves it. | `app/api/flagged-transactions/route.ts` | master §8.4 |
| A-3 | ~~`users_freeze` could only be granted by typing it into the admin-accounts form.~~ **FIXED (wave 2):** it is a checkbox in the admin-accounts grant grid, after Users. | `app/(dashboard)/admin-accounts/` | master §34 |
| A-4 | Page guard is client-side: `Shell` renders `AdminNotFound` based on props. Server components do not re-check per-page permission; protection rests entirely on the API. Correct in effect today, but there is no `AccessDenied` screen and no server page gate. | `app/(dashboard)/_shell/Shell.tsx:96-100` | newui §74 |
| A-5 | No roles. `role_title` is free text with no permission meaning. | `schema.sql` `admin_users` | master §15.1 |
| A-6 | Card queue returns `401 Unauthorized` for a *permission* failure; every other route returns `403`. The mobile admin client signs the user out on any 401, so a missing permission silently logs them out instead of showing access denied. | `app/api/card-queue/route.ts:35-37, 146-148`, `CardEliteAdmin/lib/api.ts:19-29` | master §33, newui §74 |
| A-7 | **Granular grants would strand payouts and hide mobile screens.** `resume-withdrawal` authorizes on the legacy `withdrawals` key only (`page_permissions.includes('withdrawals')`). If admin-accounts stores catalog keys, an admin granted `withdrawals.approve` without the legacy key passes the web guard, the RPC moves the withdrawal to `initiated`, and the edge function then returns 403, leaving it stranded. The mobile admin app also gates every screen, the dashboard widgets and alert routing on legacy keys (`hasPermission('card_management')`, `page_permissions.includes(k)`). **Constraint for wave 2 (admin-accounts):** legacy page keys stay the stored grant; catalog keys are only additive extras (e.g. `sensitive_data.share`). Before any catalog-only grant can be saved, `resume-withdrawal` must accept `withdrawals.approve` (edge deploy) and the mobile app must resolve catalog keys (mobile release; no OTA without the owner's instruction). | `supabase/functions/resume-withdrawal/index.ts:53`, `CardEliteAdmin/app/(tabs)/pages.tsx:80`, `CardEliteAdmin/app/(tabs)/dashboard.tsx:80` | master §15, §38 |

### 1.5 Audit

| # | Finding | Evidence | Spec |
|---|---|---|---|
| U-1 | `audit_log` lacks `admin_role`, `user_agent`, `request_id`, `reason`, `result`, `error`, `sensitivity`. Cannot answer "did it succeed" or "why". | `schema.sql` `audit_log` | master §16.1 |
| U-2 | Audit inserts are fire-and-forget — the return value is never checked, so a failed insert is invisible. | e.g. `app/api/withdrawals/[id]/approve/route.ts:70` | master §14 |
| U-3 | ~~Exports audited on only 3 routes.~~ **FIXED:** all four export routes (activity, transactions, users, withdrawals) audit CSV and PDF exports. | `app/api/*/route.ts` | master §22 |
| U-4 | No sensitive-data reveal events and no card-image access/share events. (Login, failed login, logout, auto-deactivation, card decisions and withdrawal decisions **are** audited — 30 distinct actions verified.) | `logAction` helpers across `app/api` | master §16.2 |

### 1.6 Admin identity & security

| # | Finding | Evidence | Spec |
|---|---|---|---|
| I-1 | ~~No MFA.~~ **FIXED in code (1.7s), not deployed yet:** authenticator-app two-step sign-in with recovery codes, a required-for-all switch with a 14-day grace, super-admin and break-glass resets. | `app/lib/mfa.ts`, `app/api/auth/mfa/*`, `schema_admin_app.sql` | master §15.5 |
| I-2 | No password reset, no invitations. Super admin types a password into a form and transmits it out of band. (Self-service password change: built in 1.7r.) | `app/api/admin-accounts/route.ts:62-85` | master §15.4 |
| I-3 | ~~**No per-session records.**~~ **FIXED in code (1.7s), not deployed yet:** a database session per device (`admin_sessions`), listed on Profile and in Admin accounts, ended one at a time, all others, or everywhere. | `app/lib/session.ts`, `app/api/account/sessions/*`, `schema_admin_app.sql` | master §13, newui §53 |

### 1.7 UX consistency

| # | Finding | Evidence | Spec |
|---|---|---|---|
| X-11 | **15 competing toast implementations.** Two inline renderers plus 13 copy-pasted fixed-position divs across the settings/rewards pages. All 13 rendered `color: var(--bg-base)` — **a token defined nowhere in the codebase** — so the text fell back to inherited colour on a `var(--fg-primary)` background: dark-on-dark, effectively invisible in light mode. **FIXED**: all 15 removed, all 20 pages on `useToast` (72 call sites), `--bg-base` no longer referenced. Every call now carries a tone, so a failure no longer looks identical to a success. | 15 pages | master §3.5, §23 |
| X-1 | ~~13 native `alert()` / `confirm()` calls across 6 pages.~~ **FIXED.** All 13 removed; `grep` for native dialogs now returns nothing. Replaced by the shared toast, inline field errors, or the new confirm system. The `ToastProvider` was mounted but **used by zero pages** — it is now live. | 6 pages | master §3.5, newui §59 |
| X-2 | ~~No confirmation dialog component; broadcast sent on one click.~~ **FIXED.** `app/_ui/Confirm.tsx` implements all five spec tones (normal / destructive / financial / sensitive / high-risk) with reason capture, preset reasons, acknowledgement checkbox and typed-phrase confirmation. Broadcast now shows audience, recipient count, title and body, and "send to all" requires typing `SEND TO ALL`. The page's second private toast implementation was deleted. | `app/_ui/Confirm.tsx`, broadcast page | newui §25, §59 |
| X-3 | Card queue is capped at 200 rows, filtered in memory, and polls every 5s with no pagination, no bulk actions, no server-side search. | `app/api/card-queue/route.ts:124` · `page.tsx:177` | newui §1, §4 |
| X-4 | ~~One literal `Coming Soon` (leaderboards).~~ **FIXED (wave 3):** the tile is removed; there is no leaderboard feature. | `app/(dashboard)/bonuses-rewards/` | master §12.6, §35 |
| X-5 | ~~Currency code selectable but never persisted.~~ **FIXED (wave 2):** the unsaved "Currency name" field is gone; the Combobox country picker sets code, name and symbol, and the currency code is shown read-only as derived from the country. Storing a code would need a nullable `card_countries.currency_code` column — nothing reads one today. | `app/(dashboard)/cards/` | master §11.2 |
| X-6 | No global search, no command palette, no saved views, no URL-synced filters, no column config, no density control. | absent | master §5.3, §5.4, §23 |
| X-7 | ~~No error boundary, session-expired handler, `ErrorState` or `AccessDenied`.~~ **FIXED.** `app/global-error.tsx` (token-free by design — it replaces the root layout, so it cannot assume the stylesheet loaded), `app/(dashboard)/error.tsx`, `app/_ui/States.tsx`, `app/_ui/SessionExpired.tsx`. A 401 from any `/api/*` route now raises the session-expired dialog and returns the admin to the page they were on. Permission denial renders `AccessDenied`, not a 404. | 5 files | master §27, newui §77, §78 |
| X-8 | ~~No data-fetching layer.~~ **Built in kit round 4** (`apiRequest`, `useResource`, `useUrlState`) and adopted by the six wave-1 pages. Wave-2/3 pages still hand-roll `fetch` + `useState` until they are rebuilt. | `app/lib/apiClient.ts`, `app/_ui/useResource.ts`, `app/_ui/useUrlState.ts` | master §31 |
| X-9 | No tests, no lint script. `package.json` has only `dev`, `build`, `start`. | `package.json` | master §43, prompt §40 |
| X-10 | ~~No-op `⠿` drag handle; reorder APIs unused.~~ **FIXED (wave 2):** cards and field builder both have real, keyboard-operable Move up / Move down ordering (optimistic, rolled back and refetched on failure, announced). Reorder is not atomic (no RPC): partial failures are reported and audited as `partial`. | `app/(dashboard)/cards/`, `app/(dashboard)/field-builder/` | master §35 |

### 1.7b Found by the second audit round (2026-09-30)

Eleven-agent audit of all 28 surfaces plus an adversarial verifier re-checking earlier fixes.
Average page score 5.6/10. Synthesis: `master.md`-grade quality is mostly **adoption debt** in a
sound token foundation, concentrated in a handful of root causes.

| # | Finding | Evidence | Status |
|---|---|---|---|
| R-1 | **Monospace was dead in production.** `layout.tsx` published next/font's JetBrains Mono as `--font-mono`; `tokens.css` then declared `--font-mono: var(--font-mono), …` on `:root`. Confirmed in the built stylesheet: the self-referencing rule sits later with equal specificity, wins, forms a cycle, and becomes invalid — so every `font-family: var(--font-mono)` fell back to Inter. Every ID, amount and reference meant to render in JetBrains Mono rendered in the body font. | `.next/static/chunks/*.css` positions 12581 vs 22559 | **FIXED** — font published as `--font-jetbrains`; `tokens.css` and the Tailwind `@theme` block point at it |
| R-2 | **Dark-mode toasts and danger/success buttons were unreadable.** White text on the dark-theme `--tone-*-fg` pastels measured 1.56–2.40:1 (AA needs 4.5). Giving every toast a tone in the previous round routed all of them into this. | measured contrast | **FIXED** — `--tone-{success,danger,warning}-on` (white light / near-black dark): 5.9–7.8:1 light, 8.2–12.6:1 dark |
| R-3 | **Overlay regressions introduced by the ImageViewer.** Stacked overlays (viewer over drawer, confirm over drawer) left the page permanently unscrollable when the outer layer closed first, closed **both** layers on one Escape, and ran two focus traps that fought. | adversarial verifier | **FIXED** — module-level overlay stack: ref-counted scroll lock, Escape to the topmost layer only, focus containment by the top trap. 13 tests including both regressions |
| R-4 | **Every labelled field was an orphan label.** 75 `FieldShell` sites, zero `htmlFor`, label rendered as a sibling — clicking a label did nothing and screen readers never connected label to input. | 75 sites / 16 files | **FIXED** centrally — `useId` + context; also wires help/error text into `aria-describedby` and `aria-invalid` |
| R-5 | **Withdrawals silently showed 100 of N.** Page asked for 200, `clampPagination` capped at 100, footer printed the true total, no pager. | `lib/sanitize.ts:9`, `withdrawals/page.tsx:61` | **FIXED** — shared `Pagination`, 50 per page, every row reachable |
| R-6 | Card queue: `openDetail` had no error path (drawer spun forever); `doAction` set `busy` with no `finally` (a network drop disabled Approve/Reject permanently); the mobile branch never showed load errors; the image viewer titled dispute evidence as the card. | adversarial verifier | **FIXED** |
| R-7 | Status kit lived outside the kit in `_shared/`, imported by 19 files, with two remaining local duplicates (dashboard, activity). | | **FIXED** — moved to `app/_ui/Status.tsx`, exported from the index, duplicates removed |
| R-8 | Date filters treat a bare date as UTC midnight, so "30 Sep" misses the first hour of the Lagos business day. | `api/withdrawals/route.ts` `dateTo + 'T23:59:59.999Z'` | Open — part of the T-2 timezone sweep; Lagos-aware date helpers being built |
| R-9 | `NoZoom` / `maximumScale: 1` / `userScalable: false` is a WCAG 1.4.4 failure on a console with 11–12px metadata text. | `app/_ui/NoZoom.tsx`, `app/layout.tsx` | **Not changed — owner decision.** Deliberately added in commit `f9fa946`. Flagged for the owner rather than reverted |

Fake functionality confirmed by the audit (spec §35 violations — each must be implemented or removed):
cards `⠿` drag handle with no drag logic (reorder API unused) · cards required "Currency name" field
never persisted · bonuses "Leaderboard — Coming Soon" tile · referrals hardcoded "Trigger: First Trade"
line styled as a setting · collapsed-sidebar tooltip that can never render (clipped) · field-builder
reorder API with no caller · platform-balance Static/Live switch whose clicks are silently swallowed
while saving · bonuses `iconOnly` delete button that renders empty · `app/_shared/RuleBuilder.tsx` is
dead code while `bonuses-rewards` carries a drifted private copy.

### 1.7c Kit build, round 1 (2026-09-30)

Eight builders with disjoint file ownership, each followed by an adversarial reviewer. The run hit the
owner's session limit: **3 builds completed, 8 agents died, including every reviewer.** The reviews that
did not run were done by hand instead (hard-rule scan + full read of each component).

| Component | State | Review |
|---|---|---|
| `Checkbox` | **Built, exported** | Real visually-hidden native input, `indeterminate` via the DOM property, `aria-describedby`/`aria-invalid`. Passes |
| `RadioGroup` | **Built, exported** | `fieldset` + `legend`, native arrow keys preserved. `Confirm.tsx` reason presets migrated onto it, public API unchanged. Passes |
| Sortable `Th` + `useTableSort` + sticky header | **Built, exported** | Non-sortable `Th` renders exactly as before. `Table.tsx` is now a client component — verified the only two server components rendering it (dashboard page + loading) pass no function props across the boundary. Passes |
| `MobileDataList` | **Built, exported** | Rows are `Link`/`button` with actions as siblings (no nested interactives); flag carries screen-reader text. Passes |
| `Popover` | **Built, exported** — written by the agent that died | Complete, not partial. Fixed-position probe corrects for transformed ancestors (the drawer). Focus return traced through React's commit order. Passes |
| Overlay stack options (`lockScroll`, `trapFocus`) | **Built** — same dead agent, **shipped with zero tests** | 7 tests added by hand (non-locking popover, popover inside drawer in both close orders, Escape priority, focus fall-through, defaults unchanged). All 20 overlay tests pass, including the original two regressions |
| `Menu`, `Combobox` | **Built and reviewed (round 3)**, on the existing `Popover` | Reviewer fixed 3 — the material one: a parent re-render while the list was open snapped a scrolled list back to the active option |
| `Money` / `Ref` / `Percent` | **Built (round 2), reviewed (round 3)** | See 1.7e |
| `ConfigForm` + four config pages | **Built and reviewed (round 2)** — see 1.7d | Reviewer fixed 3 (save bar misaligned after sidebar collapse; ambiguous server-error field names; focused field hidden behind the save bar) |
| Shell repair | **Built and reviewed (round 2)** — see 1.7d | Reviewer fixed 3 (`role=dialog` on `<aside>` is invalid ARIA; drawer stayed open when tapping the current page; collapsed-rail centring) |
| `FilterBar` / `SearchInput` / `DateRangePicker` + Lagos date helpers | **Built (round 2), reviewed (round 3)** | See 1.7e |

Hard-rule scan over every file the builders touched: zero literal colours, zero raw z-index values, zero
prose comments, `'use client'` present on every interactive module.

### 1.7d Kit build, round 2 (2026-09-30 → 10-01)

**Independent re-review of the four components the integrator had passed by hand found 9 issues; 8 fixed.**
The hand review missed them — recorded here so the review gap is visible, not buried:

| Sev | Issue | Fix |
|---|---|---|
| High | `MobileDataList`: a failed refresh with rows already loaded replaced the whole list with an error panel — on the 30-second auto-refresh pages, one network blip wiped every row. The integrator had considered this case and wrongly judged it acceptable | Rows stay; compact "could not be refreshed" notice with retry above them |
| Medium | `Confirm`: calling `confirm()` while another dialog was open overwrote the pending promise without resolving it — the first caller's `await` hung forever. **Integrator's own original code** | Earlier dialog resolves `null` before the next opens |
| Medium | `Confirm`: preset radios hid their legend, so sighted users saw options with no question | Legend visible |
| Medium | `Table.module.css`: `calc(var(--z-raised) ± 1)` — arithmetic on a z token is a raw value; the hard-rule scan missed it | Bare scale tokens + `isolation: isolate` on the wrapper |
| Low ×4 | dead `stopPropagation`; `Spinner` named without a role; toast/Kpi/spinner ignored reduced motion; linked Kpi had no own focus style | Fixed |
| Low | 17 tables have no `aria-label`, so an overflowing table's scroll wrapper is an unnamed tab stop | **Open** — per-page fix for the page sweep |

Outside that reviewer's files, fixed by the integrator: **every Modal/SidePanel dialog had no accessible
name** (now `aria-labelledby` its title); the Modal's `role="dialog"` sat on the **backdrop**, not the panel
holding focus (moved); compact `ErrorState` rendered a second `<h1>` (now `<h2>`). Also
`.content { overflow-x: hidden }` made the content area a scroll container, silently disabling
`position: sticky` on every page — now `overflow-x: clip`.

**Shell (built + reviewed):** collapsed-rail labels and an unclipped fixed tooltip; mobile drawer `inert`
when closed and focus-trapped when open, `aria-expanded`/`aria-controls` on the hamburger; collapse state
in a cookie read server-side, so no animation on load (admins who had collapsed it via the old
localStorage key see it expanded once); skip link to `#main-content`; longest-prefix nav matching (fixes
two items active on Levels); dead theme-switch CSS removed; brand mark kept when collapsed; content capped
at `--content-max`; breadcrumb as `nav > ol > li`; logout pending state + confirmation; tablet band
auto-collapses the rail from first paint. **Not verified in a browser** — agents were barred from running
the dev server.

**Settings pages → `ConfigForm` (built + reviewed):** limits-fees, bill-settings, anomaly-alerts and
security-limits are now thin declarations over one form. API contract unchanged — still
`PATCH { changes }` with only changed keys; all 64 original label/hint/title strings verified against git.
New: 20-second load timeout into `ErrorState`; 403 renders `AccessDenied`; per-field validation on changed
fields only; floating save bar; **Review changes re-fetches live values first and flags collisions with
another admin's concurrent edit**; confirmation lists every change as old → new with verified consequence
notes (e.g. emptying a webhook IP list makes every webhook from that provider return 403); unsaved-changes
guard on in-app links and page unload (not on browser back/forward). **Behaviour change:** some bounds
are tighter — min/max withdrawal ≥ ₦1 and ≤ ₦1bn, daily cap ≤ ₦10bn, fee ≤ ₦100,000 — chosen because
`process-withdrawal` silently replaces out-of-range values with defaults, so the old UI accepted values
that never took effect. 70 new tests.

### 1.7e Kit build, round 3 — re-reviews of Value and filters (2026-10-01)

| Piece | Reviewer result | Integrator follow-up |
|---|---|---|
| `Money` / `Ref` / `Percent` | Fixed: `Money` could render sub-kobo amounts (`₦18.519`) and keep a minus sign on tiny negatives | Root cause was **`formatNaira` itself** — `minimumFractionDigits: 2` with no maximum, so every one of its **33 call sites** could show three decimals. Fixed at the source (`app/_ui/money.ts`, re-exported through `Status.tsx` so no caller changes): two decimals always, no `-0.00`, non-finite renders `—` instead of `₦NaN`. 7 tests |
| `FilterBar` / `SearchInput` / `DateRangePicker` | Fixed 3: `onClear` alone never showed "Clear filters"; focus jumped on clear when the button stayed visible; a test asserted the old behaviour | — |

Open items handed to the page sweep:
- **Date filters still use UTC day boundaries** in `/api/transactions`, `/api/users` and `/api/withdrawals` (`date_to + 'T23:59:59.999Z'`). Fix each client and its route together with `lagosDateToRangeStart` / `lagosDateToRangeEnd` and `.gte(start).lt(end)`.
- `Ref` copies its full value to the clipboard and exposes it in `title`/`aria-label` — **never use it for bank account numbers or card codes**.
- `Ref` shares its name with React's `Ref` type; alias one where both are imported.
- `Value.tsx` is a client module, so server components cannot call `formatMoney` / `formatPercent` / `truncateRef`. Move them into a non-client module if a server page needs them (the test harness only resolves `./` siblings inside `app/_ui`).
- `DateRangePicker` presets are computed at render, so a render straddling Lagos midnight can log a hydration warning. No functional impact.
- `isBusinessDateKey` is typed `value is string`; called on a value already typed `string`, its false branch narrows to `never`.

**Kit status after round 3 (2026-10-01): complete.** Every component the audit's foundation plan called for
is built, adversarially reviewed and exported from `app/_ui/index.ts`. Gate: 0 type errors, 441 tests.
Remaining `Combobox` notes for the sweep: `aria-selected` marks the chosen value rather than the active
option (valid, but VoiceOver may say "not selected" while arrowing); with no matches the panel shows the
empty text with `aria-expanded=false`; interaction behaviour is verified by reading plus a builder's
throwaway headless harness — the repo has no interaction-test setup. Integrator also replaced the last
z-token arithmetic (`Overlay.module.css` side panel) with a named `--z-drawer` layer.

### 1.7f Mobile admin app contract (verified 2026-10-01, before the page sweep)

`CardEliteAdmin/lib/api.ts` defines helpers for **11 routes that do not exist** on the web admin:
`/admin-accounts/[id]`, `/cards/[id]`, `/field-builder/[id]`, `/rates/[id]`, `/coupons/[id]`,
`/referrals/settings`, `/notification-templates/[key]`, `/email-templates/[key]`, `/notifications`,
`/feature-overrides`, `/feature-overrides/[id]` — and `users.update` / `users.freeze` / `users.unfreeze` send
PATCH / POST to `/api/users`, which only implements GET. **No mobile screen calls any of these helpers**:
the screens call the real web paths directly via `callWeb('/api/...')`. So this is dead code in the mobile
client, not broken mobile features. Low-priority cleanup in `CardEliteAdmin/lib/api.ts`.

The live contract the page sweep must preserve is what the screens actually call: `/api/dashboard`,
`/api/card-queue` (list, `?id=`, POST approve/overturn/reject/uphold), `/api/withdrawals` (+ approve/reject),
`/api/transactions`, `/api/users`, `/api/users/[id]`, `/api/flagged-transactions`, `/api/activity`,
`/api/user-activity-monitor`, and direct `callWeb` use of `/api/field-builder`, `/api/cards`,
`/api/admin-accounts`, `/api/giftbox`, `/api/coupons`, `/api/app-config`, `/api/rates`,
`/api/platform-balance`, `/api/notifications/broadcast`, `/api/notification-templates`, `/api/limits-fees`,
`/api/levels`, `/api/email-templates`, `/api/admin-settings`, `/api/referrals`,
`/api/notifications/user-search`, `/api/notifications/recipient-count`, `/api/bonuses`.

### 1.7g Kit build, round 4 — the gaps wave 1 hit (2026-10-01)

Nine units, each built then adversarially reviewed. All nine reviews returned `fixed`; none `fail`.
Gate after integration: 0 type errors, **1,109 tests** (was 457). New shared test loader:
`test/support/uiHarness.ts` (transpiles any `app/` file, resolves `app/lib` and `next/navigation`).

| Unit | Built | Reviewer fixed | Left open |
|---|---|---|---|
| Data layer | `app/lib/apiClient.ts` (`apiRequest` never throws; `ApiFailure` with kind/status/code/requestId/`outcomeUnknown`; 20 s read / 45 s write timeouts; 401 → session-expired via `configureApiClient`), `useResource`, `useUrlState` + codecs | Endless loading after a foreign abort; a late `set()` after unmount rewriting another page's URL; timeout overflow firing at once; two wrong migration recipes | `SessionExpiredHandler` still patches `window.fetch` for every `/api/*` 401 until all pages use `apiRequest` |
| Lists | `Table busy`, `Tr onActivate` + `RowOpen`, `TableEmpty` slots, `TableState`, per-column `TableSkeleton`, controlled `useTableSort`, `MobileDataList` sort / error titles / no flip back to skeleton, `Pagination scrollTargetRef`, `ResponsiveView` | Two failing tests left by an interrupted review run | card-queue mobile must pass `initialLoading` at migration. `ResponsiveView` renders both trees (CSS hides one) |
| Dialogs | `useConfirm` pending mode (`action`: dialog stays open, inline error, retry), `returnFocusTo` on `Modal` / `SidePanel` / confirm | Focus-return recipe that depended on render timing; unknown-outcome guidance | No `beforeunload` guard while an action is pending |
| Display | `StatusDot label`, `StatStrip`/`StatCell` href/hint/unavailable/loading/tone, `SectionLabel` id/as/flush, `Kpi tone`/`hintTone`, inline `Skeleton`, `EmptyState variant`, `PageHeaderSkeleton`, `LinkButton`, toasts (errors ~8 s, pause on hover/focus, dismiss) | Toast pause stuck after a mouse dismiss; focus jumping to the next toast's close button | Icon-only buttons are now square (28/34/40) at 12 sites — check by eye. `StatStrip` keys cells by label |
| Sensitive display | `app/lib/mask.ts`, `MaskedValue`, `JsonViewer`, `--code-*` tokens | 4 low, all fixed | — |
| Feedback | `Notice` (banner/callout; `announce` opt-in, nested notices never double-announce), `Avatar` (initials fallback, neutral tile) | Nested live regions double-announcing | — |
| States & forms | `ErrorState retrying/retryLabel/backLabel`, `AccessDenied backLabel`, WAI-ARIA `Tabs` (ids, `aria-controls`, roving tabindex, arrows/Home/End, `TabPanel`), `Select`/`Input` `size`, `Select inline` | — | Underline tabs now inset 8px — check alignment by eye |
| Export | `exportRangeDates` / `EXPORT_RANGE_OPTIONS` (Lagos), `rangeToDates` now Lagos, `ExportModal` rebuilt with "Current filters", Lagos window line, row-limit and sensitive notes | — | The window line can go stale if the dialog stays open across Lagos midnight (the export resolves at click). `activity` keeps its own browser-local export until wave 3 |
| Permissions | `PermissionsProvider`, `usePermissions`, `useCan`, `<Can>`; the layout resolves permissions server-side from the fresh DB read and the Shell provides them | — | UX only: a mid-session change shows after a refresh; the API enforces immediately |

Integrator fixes after review:
- The session-expired dialog now renders after the confirm provider. A 401 during a pending payout
  confirmation used to open the sign-in dialog underneath it while its focus trap was topmost, trapping
  keyboard users in a dialog they could not see.
- `SessionExpired.tsx`'s static inline style moved to `SessionExpired.module.css`.
- `Select` chevron: was a `currentColor` data-URI, which renders black (invisible in dark mode) and was
  wiped on disabled selects by a `background` shorthand. Now per-theme `--select-chevron` /
  `--select-chevron-disabled` tokens, and `.control:disabled` sets only `background-color`.
- Barrel: every public export added to `app/_ui/index.ts`; test seams stay module-level.
- Pre-existing residuals left alone: `Toggle.module.css` knob shadow is a literal `rgba` (no matching token,
  replacing it changes the knob's look); `bonuses-rewards/page.tsx:453` renders an empty icon-only close
  button with no name (wave 3).

### 1.7h Wave-1 pages moved onto the round-4 kit (2026-10-02)

Card queue, withdrawals, transactions, users, user detail and dashboard: local workarounds deleted, actions
permission-gated with `useCan` (server checks unchanged), data and URL state on the shared layer. Six
migrators + six adversarial reviewers (verdicts: 3 `fixed`, 3 `pass`, none `fail`). Gate: 0 type errors,
**1,275 tests**. One interrupted run (network) was resumed with a "finish from the current state" note.

Owner-visible changes:
- Approve/reject/freeze/uphold dialogs stay open while the request runs and show definite refusals inline
  with Retry/Cancel; unknown outcomes and provider errors close the dialog and show a persistent notice with
  the message verbatim (never retried automatically).
- Withdrawals: the approve dialog shows the provider that will actually send the payout (the active one,
  resolved exactly like `resume-withdrawal`, in `app/lib/gateway.ts`) and says so when it differs from the
  provider the request came in through; the approve audit records it.
- Exports open on "Current filters" (exactly what is on screen) instead of "Last 7 days", with the row cap
  and a sensitive-data note stated before the click (D-13 unchanged: full account numbers in exports).
- Phones get the mobile list straight from the server render (no desktop-table flash); mobile lists gain the
  sort control.

Follow-ups outside the console (not done):
- `resume-withdrawal` never writes back the provider it actually paid through, so `withdrawals.gateway`
  keeps the request-time provider. Needs an edge-function change (and possibly a `payout_gateway` column).
- Mobile `withdrawal-detail` still says "Pay via <request-time gateway>"; it can read the new
  `payout_gateway` field (mobile release).
- `resume-withdrawal` checks the legacy `withdrawals` key (A-7).
- Small residuals from review: transactions/withdrawals drawers opened by a mouse click on a plain row area
  return focus to `<body>` on close; the dashboard's desktop skeleton announces "loading" twice; card-queue
  dispute text collapses runs of spaces (kit callout uses `pre-line`).

### 1.7i Page sweep wave 2 — catalog, rates, admin and platform settings (2026-10-02)

Cards, field builder, rates, admin accounts, admin settings and platform balance rebuilt on the kit; routes on
the guard, the additive envelope and `writeAudit`. Six builders + six adversarial reviewers, all `fixed`
(admin accounts reviewed twice). Interrupted three times (PC off, network, two session limits) and resumed
each time with "finish from the current state" notes for the units that had partial edits. Gate after
integration: 0 type errors, **1,596 tests**.

Integrator fixes after review: the cards ↔ field-builder access widening (D-15) and the `/api/app-config`
secret write path (D-16).

Owner-visible changes worth knowing:
- Rates are staged with an unsaved-changes bar; Review re-reads live rates and refuses a range another admin
  changed meanwhile; the financial confirmation lists every change before → after with the percentage, and the
  save reports exactly which ranges saved. Strict input: no more `parseFloat || 0` turning typos into ₦0.
- Admin accounts: real permission grid (incl. `users_freeze` and the S-1 sharing permissions), every change
  needs a reason and confirms a grant diff with risk levels; deactivate/reactivate also signs the admin out
  everywhere; saving without changing access no longer signs them out; an admin's email can no longer be
  blanked (both logins match on it); lost-update protection (409 if another super admin changed the account).
- Admin settings: emergency mode needs the typed phrase and a reason on the web; the Chatwoot identity key is
  never sent to any client in clear (web or mobile — mobile round-trips a mask safely); the server now refuses
  turning off the primary payout gateway / bill provider and malformed app versions (a bad version could force
  every user onto the update screen).
- Cards: activate/deactivate and country changes confirm with consequences; new brands start inactive at the end
  of the order; duplicate brand names are refused (also from mobile).
- Field builder: adding a card type to a country can no longer leave a live type that asks users for nothing;
  every write is checked and audited; a builder-only admin now sees the brand list (it used to say "No cards yet").
- Platform balance: the Live/Static switch works and confirms; inputs validated; a conflicting save is refused.

Follow-ups (not done):
- ~~Atomicity needs RPCs: rate saves, card/field reorders, add-card-type-to-country, the last-super-admin guard,
  and the config compare-and-set are per-row or read-then-write today.~~ Done in 1.7o.
- ~~Emergency mode does not stop approving withdrawals already in review.~~ Decided D-18: it does (database check in `admin_approve_withdrawal`; console refuses up front and shows a notice).
- Mobile (release, no OTA without instruction): send a reason with emergency toggles; validate rates; the
  field-builder screen still reads `GET /api/cards`, which builder-only admins cannot.
- Coupons (web and mobile) read `GET /api/cards` for brand names; coupon-only admins get an empty dropdown —
  wave 3 should give coupons its own brand list rather than widening `/api/cards`.
- `platform_balance.write`'s description says "and refresh it from providers", but no admin route can trigger
  the refresh; reword or build it.

### 1.7j Page sweep wave 3 — rewards, coupons, referrals, communications, monitoring, audit (2026-10-04)

Activity, bonuses/levels/gift boxes, coupons, referrals + `/api/app-config`, broadcast, notification and
email templates, user activity monitor. Seven builders + seven adversarial reviewers (6 `fixed`, 1 `pass`).
Interrupted by PC shutdowns and two network outages over ~2 days; resumed from the journal each time. Gate:
0 type errors, **2,009 tests**. `app/_shared/RuleBuilder.tsx` (dead code) deleted; one rule builder remains in
`bonuses-rewards/`. Every audit write in these routes goes through `writeAudit`.

Access kept exactly as before (two briefs misstated the old rule; the agents checked HEAD and kept the real one):
- Activity: super admin OR the legacy `activity` grant (`requireActivityAccess`), as the old route and the
  `list_admin_activity` RPC enforce — not super-admin only.
- Broadcast user search: requires BOTH `communications.read` AND `users.read` (the M-13 tightening), not either.

Owner-visible changes worth knowing:
- Broadcast: a repeat guard refuses the same message to the same audience within 10 minutes (fails closed);
  send-to-all needs a typed phrase; the confirm re-fetches the live recipient count.
- Templates: placeholders are validated against what each sender substitutes; previews render in a sandboxed
  frame with link targets stripped and remote images off by default; every change confirms a full diff.
- Coupons: brand names come from `/api/coupons` (coupon-only admins no longer get an empty brand list);
  deleting a coupon is refused while trades that use it await review.
- Referrals: non-super admins with `referrals.read` now SEE the five referral settings read-only (a visibility
  widening the reviewer flagged — owner decision). `/api/app-config` gained an `expected` compare-and-set.
- User activity: "Terminate sessions" copy now says honestly that existing access tokens keep working until
  they expire.

**Fix batch (owner-approved 2026-10-04, live 2026-10-08):** `evaluate_giftbox_rules` (lifetime-withdrawals rule counts successful withdrawals incl. fees; maxed-out users pass `min_level` only up to their highest claimed tier), `claim_giftbox_item` and `redeem_coupon` (expiry on the Lagos date), `terminate_user_sessions` (also deletes `auth.sessions`: refresh and every GoTrue-validated call stop at once; an unexpired access token still works with PostgREST for up to an hour), `admin_approve_withdrawal` (refused while emergency mode is on, D-18) — all five verified identical to canonical on live. Edge functions deployed: `get-active-promos` v14 (gift boxes without an end date listed; Lagos 'today'), `broadcast-notification` v53 (audience paged past 1,000; inbox insert errors reported). The console re-offers the "Lifetime withdrawals" gift-box rule. User app: `lib/prefetch.ts` updated, ships with the next app update (also: `giftboxCache`/`couponsCache` reject null expiry dates; `promosClient.isPromoLive` still uses UTC).

Remaining follow-ups (not done):
- `max_claims_per_user` / `cooldown_days` gift-box rules contradict `UNIQUE(item_id, user_id)` on `giftbox_claims`
  (a second claim shows the user a raw database error); `exact_level` treats maxed-out users as having no level;
  `consecutive_days_active` groups trade days by UTC date; `admin_dashboard_metrics` counts active coupons with the
  UTC date.
- `approve_card_submission` matches coupons by code text: renaming a coupon zeroes the bonus on trades awaiting
  review (the console now refuses deletes in that state and warns on renames).
- Ending a user's sessions is immediate for refresh and every GoTrue-validated call, but an unexpired access token
  still works with PostgREST for up to an hour; no index on `users.last_active_at` for the monitor poll.
- ~~Atomic RPCs still wanted: rate saves, reorders, add-card-type-to-country, app-config compare-and-set, the
  last-super-admin guard.~~ Done in 1.7o.

Owner decisions (resolved 2026-10-04): Activity keeps the grant (D-19); referral settings stay visible read-only (D-20); "Users online" is 5 minutes everywhere (D-21). Still open: the user activity nav item is shown to grant holders who then hit Access denied (every route there is super-admin only).

### 1.7k Wave 4 — the last legacy routes, Activity labels, config conflict check (2026-10-08)

Login, logout, session check, admin theme and the four config routes (limits & fees, bill settings, anomaly
alerts, security limits) are on the guard, the additive envelope and `writeAudit`; access is identical to
before (verified against git HEAD), and login behaviour (rate limits, constant-time compare, cookies, token
lifetimes, auto-deactivation) is unchanged. Every audited action has a curated Activity label; the test that
enforces it now scans the source. The shared config form sends the raw values it reviewed as `expected`, so a
save that would overwrite another admin's change is refused (409) and the form reloads the live values,
keeping the other edits. Gate: 0 type errors, **2,193 tests**.

Left as they are (described for later): logout's `token_version` bump is read-then-write (done in 1.7o); the login burst
alert insert does not match the canonical `admin_alerts` columns, so it has probably never been saved; the
login rate limit fails open if its RPC errors; mobile sign-in failures (edge function) do not count toward
the web lockout; config numeric validation stays as loose as before (`''`, `null` pass and are stored as text).

### 1.7l Global search, command palette, keyboard shortcuts, Flagged page (2026-10-09)

Three units (search API, palette + shell, Flagged page), each adversarially reviewed (search: pass; palette and
Flagged page: fixed). Gate: 0 type errors, **2,384 tests**. One run was lost to a PC shutdown and network outage and
relaunched; the owner corrected the flag access model mid-way (D-23).

Reviewer catches: recent palette records stayed visible after an admin lost the permission for that record type
(now filtered per group); the Flagged drawer's frozen-account note could be read as "rejecting the flag refunds
the wallet" (reworded); a non-withdrawal flag's related record lookup was not scoped to the flag's user (fixed).

Integrator fixes: the flag list again returns up to 200 rows when no page size is sent (the mobile app relies on the
21 Sept behaviour); search results link "See all" to the Flagged page filtered by the same text.

Left as they are: the search text filters use the same unindexed `ilike` columns as the list pages (bounded by
limits and a time budget; trigram indexes would need a schema change); the mobile flag list shows Clear/Escalate
only for status `pending`, but the database value is `pending_review`, so mobile admins cannot resolve flags until
a mobile release fixes the check; flag history shows only the latest review (one reviewed_by / reviewed_at per row);
the dashboard "Open flags" tile still needs `flags.read` to appear (superseded, see 1.7m).

### 1.7m Flagged page removed, Held folded into Review (2026-10-10)

Owner decisions D-24 and D-25. Two units ran side by side, each adversarially reviewed (Flagged removal: fixed;
Held fold: pass). Gate: 0 type errors, **2,365 tests**.

Removal: the Flagged page, its sidebar item, its search group and its palette records are gone. Old "flags" palette
recents in a viewer's browser are dropped on the next save. The helpers the flags API needs moved unchanged into
`app/lib/flags.ts`. The API keeps the contract the mobile flag list relies on: read with `flags.read` or
`withdrawals.read`, 200 rows by default and at most, and `flags.resolve` to clear or escalate. The sidebar's
alternative-key rule, which only the Flagged item used, is removed again. A test fails if anything links to the old
page path.

Held fold: Review lists `pending_review` and `held` withdrawals through the route's existing `review=1` filter, the
same one the mobile app sends. A held withdrawal shows a "Held" pill in the table row, the narrow-screen list and the
drawer. `?tab=held` lands on Review. Approve and Reject are unchanged. A test pins the route's review statuses to the
tab's statuses. Builder fix: switching between Review and All no longer briefly shows the other tab's rows.

Dashboard: the "Open flags" tile links to the Withdrawals Review tab, so it and its server-side count now need
`withdrawals.read`. A `flags.read`-only admin would otherwise have been sent to a page they cannot open.

Left as they are: a Review export's audit entry records `review: true` where it used to record
`status: 'pending_review'`; visiting `?tab=held` keeps the old parameter in the address bar until the next tab
change or row open (cosmetic). On the web, `flags.read` and `flags.resolve` no longer show anything on their own.
Flags appear on Withdrawals, which needs `withdrawals.read`, and approving or rejecting resolves them. The API keeps
both grants for the mobile app; the mobile rebuild decides whether they stay.

### 1.7n Scoping: wallet adjustments and admin security (2026-10-10)

Two read-only scoping passes (code plus aggregate and catalog probes of live); every claim below was re-checked.

- **Platform email is failing at the mail-server step, and both templates are now switched off** (verified 2026-10-10
  from the template audit history, live query statistics and pg_net responses). `new_device_login` has been off since
  17 May, which alone explains the missing new-device emails. `admin_security_alert` was on from its 16 May seed until the
  sole super admin switched it off on 8 October (from a local run of the rebuilt console). In that period about 1.39
  million attempts passed the template and recipient checks and failed in the SMTP block of `send-email`; none was
  marked sent or audited. The last successful sends were 17 alerts between 14 April and 16 May. Likely cause, unverified:
  `SMTP_PORT` defaults to 587 and only 465 uses implicit TLS, while Supabase edge functions cannot connect out on 25 or
  587. Four flagged-transaction alerts (1 October and three on 10 October) are retried every 5 minutes with no backoff.
  Password reset and invitations need this fixed first; they also need a recipient rule that admits invitees, lowercase
  admin emails, visible link text (the plain-text part strips links) and server-side calls that report failures.
- **Wallet balances do not all come from the ledger.** 7 of 43 wallets hold money with no transactions at all, and
  one deleted account still has a balance. Adjustments therefore record balance before and after themselves.
- **The shipped user app shows bonus transactions as a red minus** (only three types count as money in). The wallet
  user-app update fixes this alongside the new types.
- **The login burst alert has never been saved** (its insert does not match `admin_alerts`); fixed with the security work.
- **`/api/auth` with `x-client: mobile-admin` is an unused second bearer-token login** (the mobile app signs in through
  the `admin-mobile-api` edge function); it is removed together with two-step sign-in so it cannot bypass it.
- Rejected: the claim that canonical `schema.sql` lacks REVOKEs for `terminate_user_sessions`, `clear_flagged`,
  `escalate_flagged` and the withdrawal approve/reject functions. A bulk block and explicit lines cover all five.

### 1.7o Atomic database functions and the route switch (2026-10-10)

Eight functions plus a trigger in canonical `schema.sql`: `app_config_compare_and_set`, `admin_bump_token_version`,
`admin_save_rates`, `admin_reorder_cards`, `admin_reorder_card_type_templates`, `admin_reorder_template_fields`,
`admin_add_card_type_to_country`, and `enforce_last_super_admin` with `trg_enforce_last_super_admin`. Adversarially
reviewed against live (pass); 126 PGlite assertions. One fix after review: rows the config function creates are public
unless listed as private, like the column default and the old upserts (private-on-create would have hidden new keys such
as `min_data_amount` from the user app). Handed over in chat, copied from the canonical lines (202-239, 523-641,
3352-4006); the console changes below need these functions on live before they deploy.

Route switch, four units with strict file ownership, each adversarially reviewed (rates and identity pass, catalog and
config fixed), then an integrator. Gate: 0 type errors, **2,486 tests**. The mobile app's requests to every switched
route were checked and still work.
- Rates: a save is all-or-nothing; on a conflict or a missing range nothing is saved and the page says so, keeps the
  staged edits and lists the conflicting rows. The "N of M saved" outcome is gone.
- Cards and field builder: each reorder and the add-card-type-to-country step is one call; the half-copied and
  "could not be switched on" outcomes are gone.
- Logout bumps `token_version` in one statement. The trigger refuses removing the last active super admin;
  admin-accounts maps it to a 409, and the automatic lock after failed sign-ins skips that account and records
  `ADMIN_AUTO_DEACTIVATION_SKIPPED` once per lockout window (sign-in still answers invalid credentials).
- The seven config writers (limits & fees, bill settings, anomaly alerts, security limits, app config, admin settings,
  platform balance) save through `app/lib/configCas.ts`; admin settings seals secret keys on every save.

Left as they are: a transport failure after commit is reported as "could not be confirmed, reload" on the config
routes and as "not saved" on the catalog routes (saving again is safe); a no-op admin-settings save that seals a public
secret does not clear the public config cache (as before); the add-country error names the country code, not the card
type; the skip audit's duplicate check is not atomic (at worst two rows); admin-accounts PATCH still bumps
`token_version` itself, guarded by a compare-and-set.

### 1.7p Wallet adjustments (2026-10-10 → 10-11)

Database (canonical `schema.sql` 4008-4313 and 4694-4703, `schema_admin_app.sql` 577-612; live and verified
identical on 2026-10-11): the append-only `wallet_adjustments` record (service-role read only, no edit, delete or
truncate), `admin_adjust_wallet` (one transaction: admin and permission check, input validation, a per-key lock with
replay of an identical retry and refusal of a mismatched one, deleted-account, self-adjustment and emergency-mode
refusals, per-adjustment and per-admin Lagos-day limits read from private config with safe fallbacks, wallet row lock,
optional expected-balance check, never below zero, then the wallet update, a `wallet_credit` / `wallet_debit` transaction
whose metadata the user sees holds only the note, the record, the audit row and the user notification), the two private
limit settings (₦500,000 and ₦2,000,000), the `wallet_credited` / `wallet_debited` templates and the super-admin alert.
SQL reviewed adversarially (fixed: a malformed limit could raise instead of falling back; the limits are forced private);
179 PGlite assertions.

Console: "Adjust wallet" on the user page (users.read and wallets.adjust; hidden for accounts being deleted) opens a side
panel with the live balance, limits and today's remaining allowance, frozen / emergency / pending-withdrawal notices,
credit or debit, a kobo-exact preview, reason, reference and the message the user sees; a financial confirm (typed
amount from ₦100,000); one idempotency key per panel session, and an unknown outcome locks the panel to "Retry safely"
with the same key. Limits & Fees gains the two limits (always saved private). `wallets.adjust` is enforced; Activity
labels `CREDIT_WALLET` / `DEBIT_WALLET`; the transactions explorer labels and filters the new types. Reviewed
adversarially (fixed: the notification preview now matches the database's amount format; the limit parser matches the
database; an ambiguous connection loss is treated as unknown, never as "nothing changed"). Gate: 0 type errors,
**2,592 tests**. User app: the history labels ship with the next app update (D-27), which must go out before the first
adjustment.

Left as they are: `list_admin_activity` has no `wallet_adjustments` branch, so the legacy activity list (used by the
mobile app) shows no target label for adjustment rows; concurrency was argued from the locks, not exercised with real
parallel sessions; the request IP is stored as "unknown" when no forwarding header is present, as elsewhere.

### 1.7q Withdrawal redesign (user app) and its backend (2026-10-11)

Owner decisions D-33 to D-38. Backend in canonical `schema.sql`: saved-account defaults (765-813: `is_default`, one default
per user, a BEFORE INSERT trigger that makes the first account the default and pins a sole legacy row, and
`set_default_beneficiary` for authenticated users only); `evaluate_giftbox_rules` with the `has_bank_account` branch as a
no-op, its stray GRANT to authenticated replaced by a REVOKE, and a cleanup of boxes holding the rule (2659-2892);
`finalize_account_deletion` deleting the user's saved accounts plus a cleanup of rows left by deleted users (5056-5118).
Reviewed adversarially (pass); 57 + 28 + 43 PGlite assertions. `process-withdrawal` v60 deployed 2026-10-11 with the
Lagos-day pre-check (D-37); the live bundle was confirmed to match the local sources line for line before the deploy.
User app (not yet published): a new amount pad with its own keypad (`app/withdraw.tsx`), a new Add Account page
(`app/withdraw/add-account.tsx`), shared `components/withdrawUi.tsx`, `components/AmountKeypad.tsx`,
`lib/withdrawRules.ts` and the extended `lib/beneficiariesCache.ts`; Confirm, success, failed, PinSheet and navNonce are
byte-identical. Reviewed adversarially (fixed: two cache races); user-app typecheck 0. Console (D-36): the rule is retired
in `rewardRules.ts` (rewards tests 50/50, admin typecheck 0).

Left as they are: device checks on a small Android (360×740: footer, compact keys, 9-digit amount, the custom narration
input above the keyboard, swipe-to-remove, the three-line "bank unavailable" row) before publishing; the three users with
a saved account today will see "bank unavailable" once (their bank names come from an earlier provider's list); a deleted
user's still-valid access token could re-insert a saved account until it expires (re-running the cleanup removes it);
`fetchBankLogos` keeps an empty bank list in memory until the app restarts (pre-existing).

### 1.7r Admin Profile page, phase 1 (2026-10-11 → 10-12)

D-29, no SQL. Clicking the avatar, name and role at the bottom of the sidebar opens `/profile` (every admin; no nav key),
with a "Profile" crumb in the top bar and a "Profile" command in the palette. The page shows the admin's own account
(username, email, role, super-admin badge, last sign-in and created date in WAT, fresh from `GET /api/auth/me`) and a
Change password form (three fields with show/hide, a live checklist of the rules, a confirm that says other devices
including the mobile app are signed out). `POST /api/account/password`: own account only, 5 attempts per 15 minutes
failing closed, a wrong current password is a 400 (never 401), policy = the existing rules plus at most 72 UTF-8 bytes,
not the current password, not containing the username or email local part (shared `app/lib/passwordPolicy.ts`); one
compare-and-set update of the hash and `token_version`, then this web session's cookie is re-issued so only the other
sessions end; `PASSWORD_CHANGED` / `PASSWORD_CHANGE_FAILED` audited without password material. Fixes: the failed
sign-in burst alert is finally saved (through `emit_admin_alert`, super admins only, no email or IP, once per 30-minute
window even under concurrent attempts); the session-expired text no longer mentions inactivity. Reviewed adversarially
(fixed the concurrent burst-alert duplicate). Gate: 0 type errors, **2,659 tests** (plus the crumb and palette follow-up:
225 targeted tests, typecheck clean).

Left as they are: a password change starts a fresh 8-hour session for the current browser; revoked devices keep their
push tokens until they sign in again (the sessions phase handles it); admin-accounts (a super admin setting another
admin's password) does not yet apply the 72-byte rule; the mobile app has no deep link for the alert's `/activity` target.

### 1.7s Admin security phase 2: signed-in devices and two-step sign-in (2026-10-12 → 10-14)

D-29, D-30, D-39, D-40. **SQL live** (run 2026-10-13; the statements the SQL editor ran were checked against
`schema_admin_app.sql` byte for byte): five service-only tables (`admin_security_policy`, `admin_sessions`, `admin_mfa`,
`admin_mfa_recovery_codes`, `admin_auth_challenges`), 26 functions, a trigger that releases an admin's push tokens when
`token_version` changes, `get_admin_alert_recipients` limited to admins signed in on the phone, and the nightly
`prune-admin-auth` job. **Edge functions live** (2026-10-14 10:32 WAT, after a read-only pre-deploy gate on the live
database, the secrets, the installed mobile app and the deployed console): `admin-mobile-api` v29 and
`register-admin-push` v43, live code checked equal to the repo, both booted; `ADMIN_MFA_ENCRYPTION_KEY` was set on
Supabase by the owner and checked by fingerprint against `admin/.env.local` (and copied into `supabase.env`). The console
is built, reviewed and tested but **not deployed**: until it is, the live web console ignores two-step sign-in, while
the phone already enforces it. The superadmin turned two-step sign-in on through a local copy of the new console
(2026-10-13 21:57 WAT).

Sessions: every sign-in opens a database session per device (web 8 h, mobile 24 h, never sliding) whose id rides in the
token; each request checks it with one `admin_auth_state` call, and an outage is a 500, never a sign-out. Log out ends
this device only; Profile → Signed-in devices lists the admin's devices with "Sign out other devices" and "Sign out
everywhere"; a super admin can end one device of another admin (Admin accounts → Security). Two-step sign-in: an
authenticator app (TOTP, ±1 step, each code usable once), set up from Profile, or at sign-in once it is required; 10
single-use recovery codes (web only, shown once, copy and download); the security actions re-check identity with a code
(or the password before two-step is on) within 5 minutes. 10 wrong codes in 15 minutes lock it for 15 minutes and 30 in
24 hours for 24 hours (D-40); web and mobile show the same unlock time in WAT, with the date when it ends on another
day. On the phone the code is typed straight after the password (D-30). Admin settings: a super admin who has two-step
sign-in turns "required for all admins" on, which starts the 14-day grace (banner and alerts), and can turn it off. A
super admin can reset another admin's two-step sign-in (never their own); when no other super admin can help, the
SQL-editor break-glass reset is the way back in (README §10.4). The key is `ADMIN_MFA_ENCRYPTION_KEY` (README §10.1 and
§10.6, PRODUCTION_CUTOVER §3). Gate: 0 type errors (incremental and cache-free), **3,161 tests**. The adversarial review
of the sign-in core and routes passed with no change; the screens review fixed three things (the code-step error is
announced to screen readers, the lock sentence clears when the lock ends, a too-short reason no longer uses up the
step-up code).

Ship order (D-39, each step on the owner's instruction): ~~set `ADMIN_MFA_ENCRYPTION_KEY` as the `admin-mobile-api`
secret~~, ~~deploy `admin-mobile-api` and `register-admin-push`~~ (done 2026-10-14), set the same key on the admin host
(Vercel), deploy the console, run the smoke test, then switch the requirement on. Phone alerts reach only admins signed
in through the new `admin-mobile-api`, so every admin signs in on the phone again after the edge deploy (no phone was
registered on 2026-10-13). 24 hours after the console deploy, a follow-up release refuses tokens without a session id
(D6).

Follow-ups from the reviews (D-41, 2026-10-14): `GET /api/auth/me` answers a failed account read with 500 (the guard's
"Your session could not be checked" wording), not 401; the withdrawal approve route forwards the token the guard has
just verified (`sessionTokenFromRequest()` in `app/lib/jwt.ts`, shared with the guard) instead of re-checking it, so an
outage can no longer sign the phone out, and a mobile approval can no longer forward a different web cookie; replacing
recovery codes has the fail-closed limit `admin_mfa_recovery_codes`, 5 per 15 minutes, checked before any code work like
the identity check's `admin_reauth`; a root `app/error.tsx` keeps errors from the console layout inside the console's
look and retries the server render (`unstable_retry`). Adversarial review passed with each fix reverted to prove its
test; gate: 0 type errors (cache-free), **3,177 tests**.

Left as they are: a step-up code is used up when the identity check passes but the action after it fails with a
retryable error (the admin waits for the next code); `verifyAdminJWT` is still exported but unused by routes (it turns an
outage into a sign-out, so new code must use the session helpers); `(dashboard)/error.tsx` still retries with `reset()`; a cookie stolen within 5 minutes of sign-in passes the identity
re-check (by design, D3/D9); no browser pass was possible on this machine, so the smoke test covers the new screens at
360, 375 and 390 px in light and dark before the requirement is switched on; click flows are pinned by source patterns
because the test harness renders on the server only; the grace banner's days-left count refreshes on reload; if setup
at sign-in turns two-step on but the session then fails to open, the admin never saw the recovery codes and makes new
ones on Profile.

### 1.8 Missing database infrastructure

Required by the target, absent from `schema.sql` / `schema_admin_app.sql`:

`admin_roles` · `admin_role_permissions` · ~~`admin_sessions`~~ · ~~`admin_mfa`~~ (built in 1.7s) · `admin_invitations` ·
`admin_password_resets` · `risk_cases` · `risk_case_events` · `user_notes` · `user_tags` ·
`saved_views` · `config_versions` · `approval_requests` · `wallet_adjustments` · `wallet_ledger` ·
`reconciliation_runs` · `reconciliation_items` · `provider_events` · `provider_health` ·
`background_jobs` · `export_jobs` · `notification_campaigns` · `template_versions` ·
`card_submission_assignments` · `rate_history`

Plus columns on `audit_log` (U-1) and a set of server-side aggregate functions to replace F-3.

---

## 2. Requirement traceability

### Phase 2 — Foundation (`master.md` §6, §45.1 · `newui.md` §83 "Foundation")

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FND-01 | Design tokens, light + dark, semantic | `DONE` | `app/_ui/tokens.css` — pre-existing, meets §67 |
| FND-02 | Typography — Inter + JetBrains Mono | `DONE` | `app/layout.tsx` |
| FND-03 | App shell, sidebar, collapse, mobile drawer | `PART` | Exists; needs target IA, alert badges, account menu |
| FND-04 | Topbar — search, palette trigger, notifications, status, theme, account | `PART` | Search / palette trigger (with the platform's shortcut hint; the way in on phones) and theme. Notifications and status still to build |
| FND-05 | Breadcrumbs | `PART` | Two-level from nav table; no deep-link trail |
| FND-06 | Permission catalog `resource.action` | `DONE` | `app/lib/permissions.ts` — 68 permissions, 12 categories, risk levels, legacy expansion map. 21 tests |
| FND-07 | Server authorization helper | `DONE` | `app/lib/guard.ts`. 39 of 41 routes use it; the other two are sign-in and sign-out, which run before a session exists (wave 4, 2026-10-08) |
| FND-08 | API response envelope + stable error codes | `DONE` | `app/lib/api.ts` — 11 codes, additive so the mobile admin app keeps working. Every route returns it; the client reads it through `app/lib/apiClient.ts` |
| FND-09 | Request IDs | `DONE` | `proxy.ts` mints `x-request-id` per request; echoed on every enveloped response and written to the audit row |
| FND-10 | Audit writer with full schema + failure handling | `DONE` | `app/lib/audit.ts` (result, request_id, user_agent, reason, sensitivity — columns live). No route inserts into `audit_log` directly any more; every write goes through `writeAudit`, and `test/activityLog.test.ts` derives the action list from the source so a new action without an Activity label fails the suite |
| FND-11 | Business timezone (Africa/Lagos) helpers | `DONE` | `app/lib/time.ts`, 21 tests |
| FND-12 | `DataTable` — server pagination, sort, selection, columns, density, sticky | `PART` | Built: `Pagination` (+ `scrollTargetRef`), sortable `Th` with `aria-sort`, `useTableSort` (uncontrolled or controlled), sticky header via `maxHeight`, focusable scroll regions, `busy`, `Tr onActivate` + `RowOpen` keyboard path, `TableEmpty` slots, `TableState`, per-column `TableSkeleton`, `ResponsiveView`. Wave-1 pages sort server-side. Row selection and column visibility still to build |
| FND-13 | `FilterBar` + URL sync | `PART` | `FilterBar`, `SearchInput` (debounced), `DateRangePicker` (Lagos presets) built; `useUrlState` + codecs built in round 4. Wave-1 pages each hand-rolled URL sync — they move onto `useUrlState` in the migration step |
| FND-14 | Saved views | `TODO` | newui §63; needs `saved_views` table |
| FND-15 | `ConfirmDialog` / destructive / financial / sensitive / high-risk | `DONE` | `app/_ui/Confirm.tsx` — promise-based `useConfirm()`, five tones, reason + presets (now a `RadioGroup`) + acknowledge + typed phrase. Concurrent-call hang fixed; dialogs now carry an accessible name |
| FND-16 | Unified toast | `PART` | `ToastProvider`: errors and warnings stay ~8 s, timers pause on hover/focus, every toast has a dismiss button, errors announced assertively (round 4). Action/retry buttons not built; persistent outcomes use `Notice` |
| FND-17 | `Drawer` with focus trap + return focus | `DONE` | `app/_ui/useFocusTrap.ts` — Tab cycling, focus-in guard, body scroll lock, focus returned to the trigger. Applied to `Modal`, `SidePanel` and `ImageViewer` |
| FND-18 | `ErrorState`, `EmptyState`, `LoadingState`, `Skeleton` | `PART` | All exist; round 4 added `ErrorState retrying`, `EmptyState variant="plain"`, inline `Skeleton`, `PageHeaderSkeleton`, per-column `TableSkeleton`, `TableState`. `MobileDataList` is on the six wave-1 pages; private `*Mobile` copies remain on wave-2/3 pages |
| FND-19 | Global error boundary | `DONE` | Root + dashboard segment, both with a retry and the digest as request ID |
| FND-20 | Session-expired handler | `DONE` | Observes 401s on `/api/*` and preserves the route across re-login via `?next=` |
| FND-21 | `AccessDenied` screen | `DONE` | Replaces the old "404 or you lack permission" page, which leaked ambiguity |
| FND-22 | Data-fetching layer — keys, cache, invalidation, cancel | `PART` | Round 4: `app/lib/apiClient.ts` (`apiRequest`, never throws, typed failures incl. `outcomeUnknown`, read/write timeouts, session-expiry hook) and `useResource` (keyed, abort superseded, stale-response guard, keep previous data, polling paused while hidden, `refresh`/`mutate`). No shared cache across components (D-3). No page adopted yet — X-8 |
| FND-23 | Form system — validation, dirty, unsaved warning, server errors | `PART` | `FieldShell` now auto-associates label ↔ control and wires `aria-describedby` / `aria-invalid` at all 75 sites. `Textarea` gained `mono`. Checkbox, RadioGroup and a `ConfigForm` with dirty guard + review-diff-confirm in progress |
| FND-24 | `MoneyDisplay`, `StatusBadge`, `StatusDot`, `EntityLink` | `PART` | `app/_ui/Status.tsx` is the single source (`formatNaira`, `statusTone`, `StatusDot` + `label`, `StatStrip`/`StatCell` with href/hint/unavailable/loading/tone, `DetailRow`, `SectionLabel` id/as/flush). Round 4 also added `Kpi tone`/`hintTone`, `LinkButton`, `Avatar`, `Notice`. `EntityLink` still to build |
| FND-25 | `SensitiveField` — mask, reveal, audit, auto-hide | `PART` | Round 4: `app/lib/mask.ts` (single masking implementation, spoken form for screen readers, metadata masking identical to the two route copies) and `MaskedValue`. Reveal + audit + auto-hide not built (needs a `sensitive_data.reveal` route). `Ref` must NOT be used as a stand-in — it exposes the full value |
| FND-26 | `ImageViewer` — zoom, rotate, gated download | `PART` | `app/_ui/ImageViewer.tsx` — zoom, rotate, prev/next, dots, focus trap, full keyboard map, permission-gated download hook, all tokenised. Signed-URL expiry still outstanding (S-3) |
| FND-27 | `AuditTimeline` / `ActivityTimeline` | `TODO` | newui §71 |
| FND-28 | `JsonViewer` + audit diff | `PART` | Round 4: `JsonViewer` (collapsible, keyboard toggles, masked keys, copies the masked form). Audit before/after diff not built |
| FND-29 | `BulkActionBar` | `TODO` | newui §2 |
| FND-30 | `ExportDialog` — columns, sensitivity, row count, audit | `PART` | Round 4: `ExportModal` rebuilt on tokens with Lagos windows (`exportRangeDates`), a "Current filters" option, row-limit and sensitive-data notes. Column choice not built; audit stays server-side in each export route |
| FND-31 | Global search | `DONE` | `GET /api/search` (`app/lib/search.ts`): users, withdrawals, transactions, card submissions, coupons and flags, each group only with its read permission; recognises ids, emails, phones, usernames and account numbers; account numbers masked, card codes never returned; groups run in parallel with a 4 s budget and fail independently |
| FND-32 | Command palette | `DONE` | `app/_ui/CommandPalette.tsx`: Cmd/Ctrl+K or the top-bar button; recent items (per viewer, permission-filtered), every page the admin can open, theme / shortcuts / sign-out actions, live grouped search with "See all"; full-screen on phones |
| FND-33 | Notification center | `TODO` | master §36 |
| FND-34 | Keyboard — `/`, `Esc`, `Cmd+K`, `?` | `DONE` | `app/_ui/useHotkeys.ts`: `/` focuses the page search (or opens the palette), `?` lists the shortcuts, Cmd/Ctrl+K toggles the palette, Esc through the overlay stack |
| FND-35 | Lint + typecheck + test scripts | `PART` | `npm run typecheck` and `npm test` both work (36 tests, Node native runner, no new dependency). `lint` is declared but ESLint is not installed |

### Phase 3 — Security (`master.md` §15, §16, §25 · §45.4)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| SEC-01 | Roles as first-class records | `TODO` | A-5; needs `admin_roles` |
| SEC-02 | `resource.action` permissions with server enforcement | `TODO` | A-1 |
| SEC-03 | Role editor with impact preview | `TODO` | newui §51 |
| SEC-04 | Permission catalog page | `TODO` | newui §52 |
| SEC-05 | Admin directory | `PART` | `/admin-accounts` exists |
| SEC-06 | Admin invitations | `TODO` | I-2 |
| SEC-07 | Password change (self) | `DONE` | Profile → Change password (1.7r); not deployed yet |
| SEC-08 | Password reset | `TODO` | I-2 |
| SEC-09 | MFA | `DONE` | Two-step sign-in with an authenticator app and recovery codes (1.7s, I-1); not deployed yet |
| SEC-10 | Per-session records + listing | `DONE` | `admin_sessions`; Profile → Signed-in devices, Admin accounts → Security (1.7s, I-3); not deployed yet |
| SEC-11 | Per-session revoke | `DONE` | One device, other devices or everywhere, own or (super admin) another admin's (1.7s); not deployed yet |
| SEC-12 | Revoke-all per admin | `DONE` | `token_version` bump, which also ends every device session |
| SEC-13 | Login / failed-login / logout audit events | `DONE` | `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `ADMIN_AUTO_DEACTIVATED` written through `writeAudit` with result, request id and user agent (wave 4) |
| SEC-14 | Access policies page | `TODO` | newui §56 |
| SEC-15 | Audit schema extension | `DONE` | `audit_log` gained `admin_role`, `user_agent`, `request_id`, `reason`, `result`, `error`, `sensitivity` + 5 indexes — live, verified 2026-10-01. `app/lib/audit.ts` writes them; 31 unmigrated routes still insert the legacy columns directly |
| SEC-16 | Audit explorer with diff + JSON | `PART` | `/activity` is grouped + filtered; not the §55 explorer |
| SEC-17 | Sensitive-data reveal permission + audit | `TODO` | S-2 |
| SEC-18 | Export audit everywhere | `DONE` | Every export (activity, transactions, users, withdrawals — CSV and PDF) writes `EXPORT_CSV` / `EXPORT_PDF` through `writeAudit` and is blocked if the audit write fails |
| SEC-19 | Remove unrestricted external card sharing | `DONE` | Owner chose S-1 option 2: sharing kept, gated by `sensitive_data.share` / `sensitive_data.download`, every share audited and blocked if the audit write fails. Web live in code; the mobile change ships with the next mobile release — until then the installed mobile app still shares without the gate |
| SEC-20 | Login rate limiting / brute-force protection | `DONE` | Per-IP (20/10min) + per-account (10/30min) via `check_rate_limit_by_key`, constant-time dummy compare, burst alert at 5 fails/30min, auto-deactivation at 25 fails/24h. Phase 2 (1.7s): identity check `admin_reauth` 5/15min, setup `admin_mfa_enroll` 10/15min, recovery codes `admin_mfa_recovery_codes` 5/15min, all failing closed; two-step locks 10 wrong codes/15min → 15 min and 30/24h → 24 h (D-40) |

### Phase 4 — Core operations (`master.md` §7–§9 · `newui.md` §3–§10)

| ID | Requirement | Status | Notes |
|---|---|---|---|
| OPS-01 | Dashboard — server-side aggregation | `DONE` | `admin_dashboard_metrics` |
| OPS-02 | Dashboard — `Unavailable` not `0` | `DONE` | Per-KPI plus a failure banner |
| OPS-03 | Dashboard — business timezone | `DONE` | Header states the Lagos date and `WAT` |
| OPS-04 | Dashboard — date range + comparison | `PART` | Backend takes `?days=` and `?compare=1` and returns a `previous` block; no UI control yet |
| OPS-05 | Dashboard — clickable drill-down KPIs | `DONE` | Every KPI links to its filtered page; `Kpi` gained `href` and `unavailable` |
| OPS-06 | Dashboard — status strip | `TODO` | newui §3.2 |
| OPS-07 | Dashboard — charts | `TODO` | newui §3.5 |
| OPS-08 | Dashboard — permission-aware metrics | `DONE` | `buildCan` gates each query |
| OPS-09 | Card review — server pagination / search / filters | `TODO` | X-3 |
| OPS-10 | Card review — tabs + saved views | `TODO` | newui §4.3 |
| OPS-11 | Card review — assignment / reviewer / SLA | `TODO` | needs `card_submission_assignments` |
| OPS-12 | Card review — detail drawer per §4.7 | `PART` | Side panel exists |
| OPS-13 | Card review — approve dialog with wallet impact | `TODO` | newui §4.8 |
| OPS-14 | Card review — reject dialog with preset reasons | `PART` | Reason exists; native `alert` validation |
| OPS-15 | Card review — bulk assign / flag / note / export | `TODO` | newui §4.6 |
| OPS-16 | Withdrawals — status tabs + summary cards | `PART` | |
| OPS-17 | Withdrawals — atomic approve + audit on failure | `DONE` | See F-1 |
| OPS-18 | Withdrawals — idempotency | `DONE` | Already enforced in the DB and edge function — see F-2 |
| OPS-19 | Withdrawals — failure recovery (retry, re-route, mark paid/refunded) | `TODO` | newui §5.9 |
| OPS-20 | Withdrawals — hold / release | `TODO` | |
| OPS-21 | Transaction explorer + detail page | `PART` | List exists; no detail route |
| OPS-22 | Flagged transactions UI | `N/A` | Owner decision D-24: flagged withdrawals are handled on the Withdrawals page; no standalone page. The API remains for the mobile app |
| OPS-23 | Operations queue | `TODO` | master §8.5 |
| OPS-24 | Reconciliation | `TODO` | F-7 |
| OPS-25 | User directory — server search, filters, bulk, export | `PART` | |
| OPS-26 | User 360 — 10 tabs | `PART` | 3 tabs today |
| OPS-27 | User notes + tags | `TODO` | needs `user_notes`, `user_tags` |
| OPS-28 | Freeze / unfreeze | `PART` | Freeze now also blocks approving the account's pending withdrawals (F-10, D-14). Verify `users_freeze` coherence (A-3) |
| OPS-29 | User data export / anonymization workflow | `TODO` | |

### Phase 5 — Catalog & rewards · Phase 6 — Communications · Phase 7 — Risk/Integrations/System · Phase 8 — Analytics

Expanded when their phase starts. Headline status:

| Area | Status | Note |
|---|---|---|
| Gift card brands / countries / types / fields / denominations | `PART` | Pages exist; X-5, X-10 open; no versioning or overlap validation |
| Rates | `PART` | No history, no effective dates, no overlap check, no approval, no rollback |
| Bonuses / levels / giftbox / coupons / referrals | `PART` | Pages exist |
| Leaderboards | `TODO` | X-4 |
| Campaigns | `TODO` | |
| Broadcasts | `PART` | X-2 — no confirmation |
| Push / email templates | `PART` | No versioning, no rollback, no test send |
| Delivery history | `TODO` | |
| Risk dashboard / cases / alerts / security events | `TODO` | Data exists in `security_alerts`, `flagged_transactions`, `admin_alerts` |
| Integrations — payments / bills / messaging / webhooks / events / health | `PART` | Scattered across `bill-settings`, `admin-settings`, `security-limits` |
| System health / jobs / configuration history / emergency | `TODO` | |
| Analytics — business / operations / financial / user / risk | `TODO` | |
| Reports / export center | `TODO` | |

---

## 2b. Visual direction addendum

Added by the owner after the first audit. Functional authority stays with `master.md` + `newui.md`;
this raises the **quality bar** and makes it app-wide.

> "OpenAI-level developer-console polish + CardElite-specific administrative workflows."

A quality and product-design benchmark, **not** a request to copy anyone's branding, layouts,
colours, icons or visual identity. CardElite keeps its own identity.

The standing rule from the addendum: *"Do not create a polished dashboard while leaving secondary
pages visually outdated. The entire application must feel like one deliberately designed product."*
That makes every surface below in scope, including login, empty/loading/error states and mobile.

| ID | Requirement | Status | Notes |
|---|---|---|---|
| VIS-01 | One coherent visual language across all 27 pages + login | `TODO` | The addendum's central demand |
| VIS-02 | Compact professional sidebar, grouped nav, active state, collapsed tooltips | `PART` | Exists and is decent; needs target IA + alert badges |
| VIS-03 | Restrained top bar: breadcrumb, global search, palette, notifications, theme, account menu | `PART` | Breadcrumb + theme only |
| VIS-04 | Theme selector — Light / Dark / System, persisted, integrated in the shell | `DONE` | `app/_ui/theme.tsx` + `app/_ui/ThemeSwitcher.tsx`. Cookie **and** server (`admin_users.theme_preference`), no-flash inline script in `app/layout.tsx`, live `prefers-color-scheme` following. Moved out of `_shell/` so login shares one implementation |
| VIS-05 | Theme applies consistently everywhere; no hardcoded light-only colour | `PART` | Added `--overlay-scrim`, `--overlay-scrim-heavy`, `--overlay-control-*` and `--z-lightbox`. Card queue and login are now clean. Remaining concentrations: `coupons/TermsOfUseManager.tsx` (18), `_shared/RuleBuilder.tsx` (17), `activity/page.tsx` (11). `global-error.tsx` keeps literals deliberately |
| VIS-06 | Login as part of the product: same type, spacing, tokens, quality | `DONE` | Rebuilt on tokens + a CSS module. Was 100% inline styles with 15 hardcoded colours and no dark mode at all |
| VIS-07 | Login: visibility toggle, validation, auth errors, loading, responsive, keyboard | `PART` | Per-field validation on blur with `aria-invalid` + `aria-describedby`, `role="alert"` form error, distinct 429 copy, network-failure copy, disabled-while-submitting, autofocus, reduced-motion, `?next=` return with an open-redirect guard. Two-step code, recovery-code and set-up-at-sign-in steps built (1.7s) |
| VIS-08 | Information density — compact tables, restrained whitespace, strong alignment | `TODO` | |
| VIS-09 | No oversized cards / giant headings / decorative illustration / generic SaaS look | `TODO` | |
| VIS-10 | Tables: compact rows, sortable headers, sticky header, selection, bulk, column visibility, row actions | `PART` | `Table` primitive has density + sticky; no sort/selection/bulk/columns |
| VIS-11 | Detail experience: tabs + drawers + timelines + metadata + activity + audit | `PART` | Drawers exist; timelines/audit views do not |
| VIS-12 | Drawers for inspection; modals only for focused/confirm/destructive | `PART` | Now true for confirmations; some pages still use modals as pages |
| VIS-13 | Typographic hierarchy consistent app-wide; monospace used selectively | `TODO` | |
| VIS-14 | Restrained semantic palette; colour carries meaning, never decoration | `PART` | Tokens are right; usage to audit |
| VIS-15 | Interaction states: hover, focus, pressed, loading, disabled, skeleton, transitions | `PART` | Buttons/tables good; uneven elsewhere |
| VIS-16 | Global search + command palette as first-class features | `TODO` | FND-31, FND-32 |
| VIS-17 | Responsive: deliberate per breakpoint, not a shrunken desktop | `PART` | `useIsMobile` rewritten on `useSyncExternalStore` — it previously seeded `false`, so all 14 consuming pages rendered the **desktop** branch on first paint and flipped after mount. Added `useIsDesktop` / `useBreakpoint` for the 3 tiers the spec requires. Mobile card layouts still need the density pass |
| VIS-18 | Polished loading / empty / error states everywhere | `PART` | Card queue, withdrawals and transactions had **no** `try`/`catch` in `load()` — a failed API left the page on an infinite skeleton while a 5s poll threw unhandled forever. All three now distinguish loading / error / empty and offer retry. Mobile skeletons are still `opacity: 0.5` boxes on 3 pages |
| VIS-19 | Notifications surface in the shell | `TODO` | FND-33 |
| VIS-20 | Whole-app coherence pass against the addendum's 13 quality questions | `TODO` | Final gate |

**Visual audit (2026-09-30).** Six page-group inventories plus four cross-cutting probes
(token violations, shared-component gaps, responsive/accessibility, density/typography),
consolidated into one ordered plan. Results folded into the rows above and into §3.

---

## 3. Sequencing

Dependency-ordered. Each step lands green (`build` + `typecheck` pass) before the next starts.

| Step | Contents | Gates |
|---|---|---|
| **1** | FND-06 permission catalog · FND-07 guard · FND-08 envelope · FND-09 request IDs · FND-10 audit writer · FND-11 timezone · FND-35 scripts | Everything else |
| **2** | Migrate all 40 API routes onto the guard + envelope. Fix A-2, A-3. | Phase 3, 4 |
| **3** | F-1, F-2, F-4, F-5, T-1 · OPS-01–03 server aggregates | Dashboard |
| **4** | FND-15 confirm system · remove all 13 native dialogs (X-1) · broadcast confirmation (X-2) | Every mutating page |
| **5** | FND-12/13 DataTable + FilterBar · FND-19/20/21 error, session, denied | Every list page |
| **6** | DB migration 1: `admin_roles`, `admin_sessions`, `audit_log` columns, `saved_views` | SEC-01, 10, 11, 15 |
| **7** | SEC-01–04, 10, 11, 13, 15, 16 | |
| **8** | S-1, S-2, S-3, FND-25, FND-26, SEC-17, SEC-19 | Card review |
| **9** | OPS-09–20 card review + withdrawals rebuild | |
| **10** | Remaining phases in `master.md` §45 order | |

---

## 4. Decisions

Recorded as they are made, per prompt §42.

| # | Decision | Rationale |
|---|---|---|
| D-1 | Keep `admin_users.page_permissions text[]` as the storage substrate for the new `resource.action` catalog rather than migrating to a join table immediately. | The mobile admin app reads this column through the same JWT (`master.md` §38). A legacy-key → action-set expansion map preserves every existing grant with zero downtime. The `admin_roles` join table lands in step 6 on top of the same column. |
| D-2 | Keep the existing `app/_ui` primitives and token file; extend rather than replace. | `newui.md` §67 says to consolidate the existing tokens. Replacing them would churn 27 pages for no gain. |
| D-3 | Do not introduce a client data-fetching library (React Query etc.) as a dependency. | The repo has 10 runtime dependencies and no build tooling beyond Next. A ~150-line typed fetch layer covers keys, cache, dedupe, invalidation and cancellation without adding a dependency. Revisit if it proves insufficient. |
| D-4 | Business timezone is `Africa/Lagos`, fixed, with the boundary computed via `Intl` rather than a fixed +01:00 offset. | `master.md` §31. Nigeria has no DST, but `Intl` keeps it correct if that ever changes and documents intent. |
| D-5 | The API envelope is **additive**: `ok()` spreads the payload at the top level and adds `success` + `request_id`; `fail()` keeps `error` as the human string and adds `code` + `message` + `request_id`. | `master.md` §33 requires success, data, error, code, message, request id and pagination. Moving data under a `data` key would break all 27 pages and the mobile admin app in one step. Additive satisfies the spec and lets routes migrate one at a time. |
| D-6 | `requireAdmin(p)` takes a single permission; `requireAdminAny([...])` and `requireAdminAll([...])` are explicit. No variadic any/all. | A variadic form that silently means "any" is the kind of ambiguity that produces an authorization hole. Explicit at every call site. |
| D-7 | `/api/dashboard` keeps emitting the legacy `*Today` stat keys as aliases whenever the window is one day. | `CardEliteAdmin/app/(tabs)/dashboard.tsx` reads `cardsToday`, `todayPayouts`, `txToday`, `txVolumeToday`, `newUsersToday`, `giftboxToday`, `referralsToday` by name. `master.md` §38 requires preserving compatibility; aliasing decouples the web deploy from the mobile release. |
| D-8 | `totalUsers` and `bonusLiability` now exclude `deleted_at IS NOT NULL`. | Deleted accounts are anonymized; counting them as platform users overstates the figure. **This changes a number the owner watches** — noted here deliberately rather than shipped silently. |
| D-9 | Tests run on the Node native runner against `.ts` sources, no test framework dependency. | The repo has 10 runtime dependencies and no build tooling beyond Next. Node 24 strips types natively. Cost of the testing requirement: one `test/package.json` and one tsconfig flag. |
| D-10 | Pure HTTP/pagination logic lives in `app/lib/http.ts`; `app/lib/api.ts` is the thin Next adapter over it. | `next/server` does not resolve under the plain Node test runner, so anything importing it is untestable. Splitting the pure core made 28 envelope/pagination/UUID tests possible with no test-environment shim. |
| D-11 | `held` withdrawals render **amber**, not red. | The withdrawals page mapped `held` to danger while every other page mapped it to warning, so one status had two colours. `held` and `pending_review` are both "awaiting an admin decision" — the same class — and the shared module already said warning, so the shared behaviour won. **This changes the colour of held withdrawals on that page.** |
| D-12 | The image lightbox stays dark in both themes (`--overlay-scrim-heavy`). | A light scrim behind a gift-card photo makes the card harder to read, which is the whole point of the surface. Deliberate, and tokenised so it is still a single decision. |
| D-13 | **Owner decision (2026-10-01): CSV and print exports keep FULL bank account numbers.** On screen they are masked (`•••• 1234`) in lists, drawers and confirmation dialogs; exports are left unmasked and are **not** gated behind `sensitive_data.export`. | The owner reconciles payouts from exports and needs the full numbers. This deliberately departs from `newui.md` §75 (sensitive export columns behind an extra permission). Do not mask exports or add an export permission check for account numbers without asking the owner. Exports remain audited. |
| D-14 | **Owner decision (2026-10-01): freezing an account blocks approval of its pending withdrawals.** Approval is refused while the account is frozen; rejection, which refunds the wallet, still works; an admin unfreezes first if the payout should genuinely go out. | Enforced in the database (`admin_approve_withdrawal`), so the web console, the mobile admin app and any future caller get the same rule. The UI check is a convenience on top, not the guard. |
| D-15 | Field builder access is its own permission pair, `card_types.read` / `card_types.write`, granted by the legacy `card_type_builder` key. `catalog.*` now covers brands, countries and logos only (granted by `card_management`). | Wave 2 put both pages on `catalog.*`, and both legacy keys expanded to it, so each key silently opened the other page's API (cards ↔ field builder). The old routes gated `/api/cards` and `/api/cards/upload` on `card_management` and `/api/field-builder` on `card_type_builder`; the split restores exactly that. |
| D-16 | `chatwoot_identity_key` and `emergency_mode` can only be written through `/api/admin-settings`. `/api/app-config` refuses them (400, naming Admin Settings), never returns secret keys from GET, and the shared audit redaction list now covers the identity key (`app/lib/configSecrets.ts` is the single list). | `/api/app-config` was a second, weaker write path: it saved without forcing secret rows private (`app_config.is_public` defaults to **true**), wrote the key into audit rows unredacted, returned it in clear, and let emergency mode be switched without the typed phrase and reason. Nothing — web or mobile — writes either key through it. Live check 2026-10-02: the key row is private (`is_public=false`). |
| D-17 | Push notification templates and email templates have their own permission pairs (`notification_templates.*`, `email_templates.*`); `communications.*` now means broadcasts only. **No two legacy page keys share any action** — `test/permissions.test.ts` enforces it. | Same trap as D-15, caught before wave 3 built on it: both template keys expanded to `communications.read/write`, which the broadcast key also held, so a template-only admin could have edited the other template set and a broadcast admin could have edited both. The old routes gated each page on its own key; the split keeps exactly that. |
| D-18 | **Owner decision (2026-10-04): emergency mode blocks approving withdrawals**, like a freeze (D-14). Rejection still works. | Enforced in `admin_approve_withdrawal` (database), so web and mobile get the same rule; the console refuses up front and shows a notice while it is on. |
| D-19 | **Owner decision (2026-10-04): Activity stays open to super admins and holders of the Activity grant** (today's rule), not super-admin only. | Nobody loses access; the route keeps `requireActivityAccess`. |
| D-20 | **Owner decision (2026-10-04): admins with `referrals.read` see the five referral settings read-only.** | They manage referrals and the values are not secrets; only super admins can change them (through `/api/app-config`). |
| D-21 | **Owner decision (2026-10-04): "Users online" means active in the last 5 minutes** on the dashboard and the user activity monitor. | The monitor used 90 seconds, so the two numbers disagreed. |
| D-22 | **Owner decision (2026-10-04): audit history is kept for 7 years** (`prune_audit_log_partitions(2557)` in `cron_jobs.sql`), matching transaction records. | The 90-day prune would have deleted who approved which payout from 1 November 2026. |
| D-23 | **Owner direction (2026-10-09): the Flagged page is viewable by admins with Withdrawals access** (plus super admins and `flags.read` holders); clearing, escalating or rejecting a flag directly stays `flags.resolve`. | Every flag in the system is a withdrawal flag, and Withdrawals admins already see each one on the withdrawals they review; approving or rejecting the withdrawal resolves its flag. This also fixes the mobile flag list, which refused them. |
| D-24 | **Owner decision (2026-10-10): no standalone Flagged page.** Flagged withdrawals are handled on the Withdrawals page (Held later folded into Review, D-25); the page, its sidebar item and the search group are removed, and the dashboard "Open flags" tile links to the Withdrawals review tab. Supersedes the page part of D-23. | Every flag is a withdrawal flag and the Withdrawals page already shows each one and resolves it on approve/reject. The flags API stays (with Withdrawals-admin read access) because the mobile app's flag list uses it. |
| D-25 | **Owner decision (2026-10-10): the Withdrawals Held tab is folded into Review.** Review lists pending-review and held withdrawals (held ones marked "Held"); `?tab=held` lands on Review. | Nothing ever moves a withdrawal to `held` (only the uncalled `escalate_flagged`), so the tab was always empty; folding it in means a held withdrawal can never be hidden, and the dashboard's "Pending withdrawals" count (both statuses) now matches the page it links to. |
| D-26 | **Owner decision (2026-10-10): live admin pages move from polling to realtime signals** (queued after the atomic SQL, wallet adjustments and admin security). Database triggers send "changed" signals (table + id + status, never card codes or account numbers) on private, permission-scoped Realtime channels; pages refetch through their existing API routes; a slow safety refresh stays. Admins get short-lived Realtime passes from the console server. | Withdrawals polls every 5 s and other live pages every 30–60 s; signals make updates instant with near-zero idle load. Signal-only keeps sensitive data and permission checks in the API. Admin-only broadcast does not reopen the user-app decision to keep feeds off postgres_changes. Needs one SQL handover and two host settings (public URL/anon key; server-only signing key). |
| D-27 | **Owner decision (2026-10-10): wallet adjustments get their own history types, `wallet_credit` and `wallet_debit`, shipped with a user-app update the owner publishes.** | The shipped app shows only `giftcard_credit`, `bonus_redeem` and `withdrawal_refund` as money in and prints any other type's raw name. Until a user updates, a credit shows as a red minus with the raw label, so the update should be published before the first adjustment. |
| D-28 | **Owner decision (2026-10-10): adjustment limits are ₦500,000 per adjustment and ₦2,000,000 per admin per day**, for every admin including super admins, held in private config and editable in Limits & Fees. | One admin acts alone (no second approver), so the limits are the compensating control. |
| D-29 | **Owner decision (2026-10-10): two-step sign-in (authenticator app) is required for every admin after a 14-day grace period.** Each admin's own settings (account details, change password, two-step sign-in and recovery codes, signed-in devices) live on a new Profile page, opened by clicking the avatar, name and role at the bottom of the sidebar; Log out stays a separate button there. Actions on other admins stay in Admin accounts. | The owner wants one place for per-admin settings, reachable by every admin without a permission. |
| D-30 | **Owner decision (2026-10-10): until the mobile admin app is rebuilt, mobile sign-in takes the 6-digit code typed straight after the password.** | Keeps two-step sign-in effective with no mobile release; exempting mobile would let a stolen password in through the phone app. |
| D-31 | Wallet adjustment defaults (2026-10-10). The user is notified of every credit and debit by push and in-app (two editable templates are the global switch). The user sees only a short message (presets or up to 140 characters, default "Balance adjustment by CardElite support."), never the internal reason or reference. A wallet never goes below zero. Deleted accounts are refused; frozen accounts are allowed with a warning and the state is recorded; emergency mode refuses credits and allows debits. An admin cannot adjust the user account that has their own email. The route needs `users.read` and `wallets.adjust`. Mistakes are corrected with an opposite adjustment, never edited. Every adjustment raises a super-admin alert. | One approver means the controls sit in the database function. Emergency mode mirrors D-18; debits stay possible so a clawback is never blocked. The transaction row is readable by the user, so internal notes live in a separate service-only table. |
| D-33 | **Owner decision (2026-10-10): the user app's withdrawal flow is redesigned in the light theme** (the app has no dark mode): a big amount with its own keypad, the default account and narration in one card, limits behind an info button; "Saved Beneficiaries" becomes a dedicated Add Account page where users add accounts and pick a default; Confirm Withdrawal is unchanged. Mock-up: the "Withdrawal Redesign" canvas. | Owner-requested; the light flow never switches theme between Withdraw, Confirm and the PIN sheet. |
| D-34 | **Owner decision (2026-10-10): the minimum withdrawal stays checked after the fee.** With a ₦50 fee the smallest amount that goes through is ₦1,050, and the pad says so. | `process-withdrawal` checks `min_withdrawal_amount` against the payout (amount minus fee); the pad now matches it, so nothing fails after the PIN. |
| D-35 | **Owner decision (2026-10-10): the withdrawal narration defaults to "Personal".** | One tap fewer for a repeat withdrawal; users can still pick another preset or write their own. |
| D-36 | **Owner decision (2026-10-10): the "has a saved bank account" gift-box rule is removed.** The console no longer offers it (a box that still has it shows it as removed), the database treats it as no requirement so it can never block a claim, and it is stripped from any box that has it (none on live, checked 2026-10-10). | With the Add Account page users can save an account without withdrawing, so the rule no longer means anything. The database keeps a harmless branch because `evaluate_giftbox_rules` raises on unknown rule types and the deployed console still offers the rule until the new one ships. |
| D-37 | **Owner decision (2026-10-11): `process-withdrawal`'s quick daily-limit check uses the Lagos day**, like `process_withdrawal_debit` and `get_withdrawal_daily_status`, and the function is redeployed with the withdrawal redesign. | It started the day at UTC midnight (01:00 Lagos), so between 00:00 and 01:00 Lagos a user who had reached the previous day's limit was refused after entering the PIN. |
| D-38 | **Owner decision (2026-10-11): deleting a user account also deletes that user's saved bank accounts**, and the saved accounts already left behind by deleted users are removed. | Saved accounts are convenience data; the withdrawal records, which audits rely on, keep the payout details for 7 years. `finalize_account_deletion` left them in place (one live row belonged to a deleted user). |
| D-39 | Admin security phase 2 design (2026-10-12, from the verified plan). Sessions are per device: web 8 h, mobile 24 h, never sliding; a session is live only while its token_version matches the admin's, so every existing "sign out everywhere" path still ends all of them. "Log out" ends this device only; Profile offers "Sign out other devices" and "Sign out everywhere"; a super admin can end any one device of another admin. Two-step sign-in: TOTP (RFC 6238, ±1 step, replay guard), 10 single-use recovery codes (web only), secrets encrypted with AES-256-GCM under one key, `ADMIN_MFA_ENCRYPTION_KEY`, held identically by the console hosts, `admin/.env.local` and the `admin-mobile-api` function secret; a missing key fails closed. No self-service authenticator replacement: a lost phone means a recovery code then a super-admin reset, or the SQL-editor break-glass reset for the sole super admin. The QR is drawn server-side with `qrcode-generator@2.0.4` (pinned, MIT, no dependencies). Enforcement is off until a super admin with two-step sign-in switches "required for all admins" on in Admin settings, which starts the 14-day grace (D-29). Ship order: SQL, secret, edge functions, console, then enforcement; each deploy on the owner's instruction. | Verified plan (four read-only verifications and a lead review); "share, never reimplement": the sign-in failure policy moves into SQL so the web and mobile paths count the same failures. |
| D-41 | Phase-2 review follow-ups (2026-10-14, owner's standing instruction): a database outage never signs anyone out on `/api/auth/me` or the mobile withdrawal approve (500, D8); recovery-code replacement gets the same fail-closed 5-per-15-minutes limit as the identity check (D10); a root error page keeps layout errors inside the console. Left: a step-up code is spent when the action after a passed identity check fails with a retryable error. | The reviews flagged these as the remaining ways an outage could sign an admin out or a code could be guessed without a count; the spent-code case is rare and fixing it would weaken the 5-minute re-check. |
| D-40 | **Owner decision (2026-10-12): code guessing has a daily cap.** Besides the 15-minute lock after 10 wrong codes, 30 wrong codes in 24 hours lock two-step sign-in for 24 hours; it unlocks by itself and a super admin can reset it sooner. | With only the 15-minute lock, an attacker who already has the password could keep guessing at about an 8% chance a month; the cap cuts that to about 0.3% while a lock can never outlast a day. |
| D-32 | Admin security defaults (2026-10-10). Invite links last 72 hours, reset links 30 minutes and sign-in challenges 5 minutes, all single use. Password policy: the current rules, plus at most 72 bytes and not the username, email or current password; no expiry. On the web, new admins join by invitation and reset links; the API keeps accepting passwords from the mobile app until its rebuild. `admin_*` email templates are editable by super admins only. Re-authentication applies to admin-security actions first. Idle timeout is deferred and the session-expired text corrected. A two-step reset does not force a password reset; the admin and the other super admins are notified. | Taken from the scoping report; each follows the specs where they speak and the safer common choice where they are silent. |

---

## 5. Blocked

| # | Item | Blocker |
|---|---|---|
| B-1 | ~~MFA (SEC-09)~~ | **Resolved:** self-hosted TOTP (D-29, D-39), recovery codes and a break-glass reset for a locked-out super admin, built in 1.7s. |
| B-2 | Password reset (SEC-08) | Needs a sending identity. The user-app SMTP config in `app_config` may be reusable — to confirm before building. |
| B-3 | Provider health / latency (integrations) | Requires either provider status endpoints or a health-probe job. No probe infrastructure exists. |
| B-4 | Reconciliation against Paystack / Monnify / Novac / VTPass | Requires provider settlement/transaction-list API access. Not present in the repo. |
