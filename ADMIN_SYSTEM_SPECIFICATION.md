# CardElite Admin — Admin System Specification

> **Document type:** Implementation-grounded audit / "as-built" specification of the existing Admin System.
> **Repository:** `aitradeosdev/c-elite-admin` · audited at commit `1edddee` (branch `claude/stoic-planck-onvefr`, identical to `main` at audit time) · audit date 2026-09-30.
> **Scope:** every file in the repository (129 files, ~16.5k lines excluding `package-lock.json`). Every page, layout, component, API route handler, library helper and configuration file was read in full.
> **Purpose:** authoritative input for a future redesign/rebuild of the Admin UI and Admin functionality. **Nothing was changed in the code during this audit.**

## How to read this document

* **Evidence.** Claims reference source locations as `path:line` (paths relative to the repo root). Where a claim depends on something that is *not in this repository* (database schema, Postgres RPC bodies, Supabase Edge Functions, cron jobs, the mobile apps), it is explicitly marked **"(outside this repo — not verifiable here)"**.
* **Status vocabulary** used throughout:
  * **Complete** — implemented end-to-end in UI + backend with reasonable validation/audit.
  * **Partial** — exists but incomplete, inconsistent, or broken for some users/paths.
  * **Backend-only** — API/backend supports it, no admin UI calls it.
  * **UI-only / Placeholder** — represented in UI without working backend behavior.
  * **Missing** — reasonably expected given the existing application, not implemented.
  * **Orphaned** — code exists but nothing references it.
* **"Web admin" vs "mobile admin".** This repository is the web admin. The API also accepts a separate **mobile admin client** (Bearer token + `x-client: mobile-admin` header). That client is not in this repo; API endpoints with no web consumer may be used by it.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Application Context](#2-application-context)
3. [Admin System Overview](#3-admin-system-overview)
4. [Admin Architecture](#4-admin-architecture)
5. [Admin Navigation / Information Architecture](#5-admin-navigation--information-architecture)
6. [Complete Route Inventory](#6-complete-route-inventory)
7. [Complete Page Specifications](#7-complete-page-specifications)
8. [Dashboard Specification](#8-dashboard-specification)
9. [User & Account Management](#9-user--account-management)
10. [Roles & Permissions](#10-roles--permissions)
11. [Data Management](#11-data-management)
12. [Search & Filtering](#12-search--filtering)
13. [Analytics & Reporting](#13-analytics--reporting)
14. [Notifications](#14-notifications)
15. [Settings & Configuration](#15-settings--configuration)
16. [Integrations](#16-integrations)
17. [Files / Import / Export](#17-files--import--export)
18. [Background Jobs](#18-background-jobs)
19. [Audit Logs](#19-audit-logs)
20. [Security](#20-security)
21. [API / Backend Dependencies](#21-api--backend-dependencies)
22. [Database / Data Model](#22-database--data-model)
23. [Error Handling](#23-error-handling)
24. [Loading / Empty / Success States](#24-loading--empty--success-states)
25. [Responsive Behavior](#25-responsive-behavior)
26. [UI / Design System Audit](#26-ui--design-system-audit)
27. [Component Inventory](#27-component-inventory)
28. [Workflow Specifications](#28-workflow-specifications)
29. [Feature Completeness Matrix](#29-feature-completeness-matrix)
30. [Current Problems / Gaps](#30-current-problems--gaps)
31. [Missing Capabilities](#31-missing-capabilities)
32. [Technical Debt](#32-technical-debt)
33. [Recommendations for Admin Redesign](#33-recommendations-for-admin-redesign)
34. [Appendix — Complete Admin Page Inventory](#34-appendix--complete-admin-page-inventory)
35. [Appendix — Complete Admin Component Inventory](#35-appendix--complete-admin-component-inventory)

---

## 1. Executive Summary

**What it is.** The CardElite Admin is a Next.js (App Router, `next@16.2.2`, `react@19.2.4`) back-office for **CardElite**, a Nigerian gift-card-to-Naira trading app. Admins review gift-card submissions and credit user wallets, approve/reject bank withdrawals, manage users, maintain the card catalog and buy-rates, run reward programs (signup bonus, levels, giftbox, referrals, coupons), send push broadcasts, edit notification/email templates, and control platform configuration (payment gateways, bill providers, limits, fraud thresholds, webhook IP allowlists, emergency mode).

**How it is built.**

* A single Supabase project is the entire backend. Every API route in `app/api/**` uses one **service-role** Supabase client (`app/lib/supabase.ts:3-6`), so **Row-Level Security is bypassed** and all authorization happens in the Next.js route handlers.
* Admin authentication is **custom**: `admin_users` table + bcrypt password + HS256 JWT in an `httpOnly` cookie (`admin_token`, 8 h) for web, or a Bearer token (24 h) for the mobile admin client (`app/api/auth/route.ts`, `app/lib/jwt.ts`). Every authenticated request re-reads the admin row (active flag, permissions, token version), so revocation is immediate.
* Authorization is a **flat list of permission keys** in `admin_users.page_permissions` plus an `is_super_admin` flag. There are no roles (only a free-text `role_title` label), no teams, no organizations, no MFA.
* The UI is 25 authenticated pages (+ login, root redirect, 404). With the exception of the Dashboard (server component), every page is a client component that fetches from `/api/*` route handlers with `fetch`.
* There are 40 API route files. Mutations write to an `audit_log` table (with a key-based redaction helper), which is browsable on the **Admin Activity** page.

**Size and shape.** 7 navigation groups, 24 navigation items (one key is used twice), 1 non-nav detail route (`/users/[id]`). A small internal design system (`app/_ui/*`) exists. Many pages also re-implement their own helpers inline (formatters, status dots, toasts, detail rows): 14 local toasts, 4 extra `formatNaira` copies, 2 extra `StatusDot` components and 4 extra `statusTone` maps.

**Most important findings** (details in §20, §30–§32):

1. **The permission model is only partly real.** Several nav items can be granted to a non-super admin, but their API endpoints are **super-admin-only**. A delegated admin sees the page and then gets empty data or "Forbidden" errors. Affected: Limits & Fees, Settings, Activity Log (User Activity Monitor), Admins, and the settings parts of Bonuses, Referrals and Coupons' Terms-of-Use, which all call `/api/app-config` (super-admin-only). See §10.4.
2. **Cross-permission dependencies break pages.** Field Builder and Coupons load the card list from `/api/cards`, which requires `card_management`. An admin with only `card_type_builder` or `coupons` sees no cards. Field Builder becomes unusable, and Coupons cannot be created because a card type is required.
3. **`users_freeze` cannot be granted from the UI.** In practice only super admins can freeze or unfreeze users, but the Freeze button is shown to every admin with `users` access. Clicking it returns 403. The same applies to other keys that are accepted by the API but missing from the UI checklist: `manual_wallet_credit`, `field_builder`, `feature_overrides`, `flagged_transactions`, `giftbox`, `admin_accounts`.
4. **Page-level access control is client-side only.** The dashboard layout only checks that the admin is logged in. Per-page gating is done in the client `Shell` (`Shell.tsx:60-63`). Data is still protected by the APIs, which are the real security boundary.
5. **Backend capabilities with no UI**, as far as this repo shows: flagged-transaction review (list/clear/escalate), admin session revocation (`revoke_sessions`), card reordering, template-field reordering, `/api/auth/me` and `/api/dashboard` (likely used by the mobile admin), withdrawal "review" filter.
6. **UI with no working backend:** a drag handle on Cards that does nothing, a "Leaderboard — Coming Soon" card, a Referral "Pending payout" metric hard-coded to `0` on the server, and a "Currency name" field in the Cards › Countries form that is required but never saved.
7. **Money-risk UX gaps.**
   * Rates: clearing a rate input silently becomes `0` and can be batch-saved with no confirmation.
   * Broadcast: sending to all users has no confirmation.
   * Withdrawal approval: if the gateway call fails after the approval RPC succeeds, nothing is written to the audit log.
   * Card rejection: several dependent writes run non-transactionally.
8. **Sensitive-data egress.** The Card Queue "Share" menu can send submitted card fields (which may include redeemable codes) and card images to WhatsApp, Telegram, email or the clipboard, with no audit trail.
9. **Dashboard numbers can be wrong at scale.** "Today's payouts", "Transaction volume", "Total wallet balance" and "Reward pool" are computed by downloading rows and summing them in JavaScript. They are subject to Supabase/PostgREST row caps. "Today" is server-local midnight, not Nigerian time. The page auto-refreshes every **5 s** while its copy says "30 seconds".
10. **Audit gaps.**
    * No audit entries for: activity-log CSV export, withdrawal approvals whose gateway call failed, card image share/download, and PII views.
    * PDF exports are logged as `EXPORT_CSV`.
    * The transactions and withdrawals export audit inserts use a different shape (`diff`, no IP), which may not match the table.
    * Audit insert errors are never checked.
11. **No MFA, no admin password reset, no self-service password change.** Super admins cannot be created, edited or promoted from the UI; the README says this requires SQL.
12. **Inconsistent UX building blocks.** There are three toast systems (the shared `ToastProvider` is mounted but never used), native `alert()`/`confirm()` on some pages, two export modals, two rule builders (one orphaned), duplicated status/format helpers, and nav labels that differ from page titles.

---

## 2. Application Context

### 2.1 Application purpose (as evidenced by the code)

CardElite lets end users:

* sell gift cards (brand → country → card type → denomination range) for Naira credited to an in-app wallet (`card_submissions`, `denominations.rate_naira`, `approve_card_submission` RPC);
* withdraw wallet funds to Nigerian bank accounts through a payout gateway (Paystack, Monnify or Novac);
* buy airtime, data, cable and electricity through a bill provider (VTPass or Novac);
* earn rewards: signup bonus, level-tier bonuses, giftbox rewards, referral bonuses and coupon bonuses on card trades;
* receive push notifications and transactional emails, and chat with support through Chatwoot.

Currency is NGN (₦) for wallets, and foreign currency (e.g. USD) for card face values (`formatNaira` with `en-NG` locale everywhere).

### 2.2 Major application modules (inferred from admin code)

| Module | Evidence in admin | Notes |
|---|---|---|
| Gift-card trading | `card_submissions`, `cards`, `card_countries`, `card_types`, `card_type_fields`, `denominations`, `card_type_templates` | Admin reviews submissions and manages catalog + rates |
| Wallet & ledger | `wallets.balance`, `transactions` (types listed in §22) | Admin reads; no manual credit UI |
| Withdrawals / payouts | `withdrawals`, edge fn `resume-withdrawal`, RPCs `admin_approve_withdrawal`, `admin_reject_withdrawal` | Gateways: Paystack, Monnify, Novac |
| Bills | `transactions.type ∈ {airtime,data,cable,electricity}`, app_config bill keys | Providers: VTPass, Novac |
| Rewards | `level_tiers`, `user_level_claims`, `giftbox_items`, `giftbox_claims`, `referrals`, `coupons` | |
| Notifications | `notification_templates`, `email_templates`, `notification_broadcasts`, `user_push_tokens`, RPC `emit_notification`, edge fn `broadcast-notification` | |
| Security / fraud | `flagged_transactions`, `admin_alerts`, anomaly thresholds in `app_config`, `login_history`, `device_logs` | |
| Platform config | `app_config` key/value table + `edge_cache_delete('app_config:public')` | |
| Transfers (removed) | commit `529ccda` "Strip transfers feature" | Removed pages/APIs; legacy labels remain (`activity/page.tsx:81-82`) |

### 2.3 User types

| Type | Where it appears | Managed in admin? |
|---|---|---|
| **End user** (`users`) | Users, Activity Log, Card Queue, Withdrawals, Transactions | View + freeze/unfreeze + terminate sessions |
| **Anonymous app user** | Broadcast audience `all_anon` counts `user_push_tokens` with `user_id IS NULL` (`api/notifications/recipient-count/route.ts:22-28`); "anonymous signups" rate limit (`security-limits/page.tsx:13`) | Only as a broadcast audience |
| **Admin** (`admin_users`, `is_super_admin=false`) | Admins page | CRUD by super admin |
| **Super admin** (`is_super_admin=true`) | All pages | Not creatable/editable from UI (README: SQL bootstrap) |

### 2.4 Core entities and relationships (as used by the admin)

```
users 1─1 wallets(balance)
users 1─* transactions (type, amount, status, reference_id → card_submissions.id for giftcard_credit)
users 1─* withdrawals ──0..1 flagged_transactions (transaction_type='withdrawal', transaction_id)
users 1─* card_submissions ──* cards, card_types, denominations
users 1─* device_logs, login_history (sessions), user_push_tokens
users 1─* referrals (as referrer_id / referee_id)
users 1─* user_level_claims (tier_order) ; giftbox_claims (item_id)

cards 1─* card_countries (country_code, currency_symbol; unique per card)
cards 1─* card_type_templates 1─* card_type_template_fields
card_type_templates 1─* card_types (one per country_code, template_id; cloned) 1─* card_type_fields
card_types 1─* denominations (range_label, min_value, max_value, rate_naira)

coupons (code, type = card brand NAME string, eligibility_rules jsonb, terms_of_use text)
giftbox_items (eligibility_rules jsonb)
level_tiers (tier_order 1..6)

admin_users 1─* audit_log (admin_id) ; admin_alerts (admin_id)
app_config (key PK, value text, is_public, updated_at)
notification_templates (key PK) ; email_templates (key PK) ; notification_broadcasts
```

### 2.5 Authentication systems

* **Admin auth (this repo):** custom. See §9.3 and §20.1.
* **End-user auth:** not in this repo (outside this repo — not verifiable here). Admin can see `login_history` sessions and call `terminate_user_sessions` RPC.

### 2.6 Authorization system

Permission keys on `admin_users.page_permissions` (jsonb array) and `is_super_admin`. Checked in each route handler. See §10.

### 2.7 Data model / API architecture

* Postgres (Supabase) accessed via `@supabase/supabase-js` PostgREST client with the service-role key, plus 12 Postgres RPCs and 3 Edge Functions (§21.3).
* Next.js Route Handlers under `app/api/**` form a thin REST-ish JSON API. Most resources use `GET/POST/PATCH/DELETE` on a collection URL and a `type` discriminator in the body (e.g. `/api/cards` handles cards, countries and reorder).

### 2.8 External services (referenced)

Supabase (DB, Storage, Edge Functions, RPC), Paystack, Monnify, Novac (payouts and bills), VTPass (bills), Chatwoot (live chat), SMTP (transactional email, "sent via SMTP" – `email-templates/page.tsx:133`), a push provider for `user_push_tokens` (provider not visible), Google Fonts via `next/font` (Inter, JetBrains Mono), WhatsApp/Telegram share URLs (card queue).

### 2.9 File/storage systems

Supabase Storage buckets: `card-images` (private; signed URLs 1 h), `avatars` (private; signed URLs 1 h), `card-logos` (public URLs), `level-badges` (public URLs). See §17.

### 2.10 Notification systems

User-facing push (templates + broadcasts + `emit_notification` RPC), email templates (SMTP), admin security alerts (`admin_alerts` rows + "security alert emails per cron run"). Admin-facing in-UI toasts/alerts. See §14.

### 2.11 Payment systems

Payout gateways Paystack/Monnify/Novac (primary selectable + enable toggles), webhook IP allowlists, platform balance (static or "live" from gateway). Bill providers VTPass/Novac. See §16.

### 2.12 Analytics

No analytics platform. KPIs are computed on request (§13).

### 2.13 What is NOT in this repository

* Database schema, migrations, RLS policies, constraints, triggers.
* Bodies of all RPCs (`approve_card_submission`, `list_admin_activity`, …) and Edge Functions (`broadcast-notification`, `resume-withdrawal`, `get-active-promos`).
* Cron/scheduled jobs (platform balance refresh, security alert emails, anomaly flagging).
* The user mobile app and the mobile admin app.
* `create_admin.sql` and the "root README" that `README.md:33-45` links to (`../README.md`, `../create_admin.sql`). These links are broken in this standalone repo.

---

## 3. Admin System Overview

### 3.1 Capability map

| Domain | Pages | Core capabilities |
|---|---|---|
| Operations | Dashboard, Card Queue, Withdrawals, Transactions | KPIs; review/approve/correct/reject card submissions; resolve disputes; approve/reject withdrawals; browse the ledger; exports |
| People | Users, User detail, Activity Log (user monitor), Admin Activity, Admins | Browse/search users; freeze/unfreeze; view devices/logins/transactions; online presence; terminate user sessions; audit log; admin CRUD |
| Catalog | Cards, Field Builder, Rates | Card brands + logos + countries; card types (templates) and input fields per country; denomination ranges and Naira rates |
| Rewards | Bonuses, Levels, Coupons, Referrals | Signup bonus & levels toggles; giftbox items with rule-based eligibility; level tiers + badges; coupons + terms of use; referral settings and log |
| Communications | Broadcast, Push Templates, Email Templates | Push broadcasts with audiences/variables; edit push/email templates |
| Configuration | Balance, Limits & Fees, Bill Settings, Settings | Platform balance mode; withdrawal limits/fees; bill quick amounts; gateways, bill providers, Chatwoot, legal/store URLs, app version, max approval, emergency mode |
| Security | Anomaly & Alerts, Rate Limits & IPs | Fraud thresholds, alert email settings; signup rate limit; webhook IP allowlists |

### 3.2 Actor model

* **Super admin:** everything. Some endpoints are super-admin-only regardless of permissions (§10.3).
* **Scoped admin:** nav filtered by `page_permissions`; APIs check specific keys.

### 3.3 Interaction model

* List pages load via `fetch` on mount. Some poll: Card Queue and Withdrawals every 5 s, Activity Log every 30 s, Dashboard every 5 s via `router.refresh()`.
* Detail views are mostly **right-hand side panels** (`SidePanel`) or **modals** (`Modal`). The only full detail page is `/users/[id]`.
* Config pages use a **draft → diff → "Save Changes"** pattern, or per-card "Save" buttons (Admin Settings).

---

## 4. Admin Architecture

### 4.1 Technology stack (`package.json`)

| Concern | Choice |
|---|---|
| Framework | Next.js `16.2.2` App Router (uses `proxy.ts`, the Next 16 successor of `middleware.ts`) |
| UI runtime | React `19.2.4`, `react-dom 19.2.4` |
| Language | TypeScript 5 (`strict: true`), path alias `@/*` unused |
| Backend client | `@supabase/supabase-js ^2.102.1` (service role) |
| Auth | `bcryptjs ^3.0.3`, `jose ^6.2.2` (JWT). `jsonwebtoken ^9.0.3` is a dependency but **unused** |
| Icons | `lucide-react ^1.16.0` |
| Styling | CSS Modules + CSS custom properties (`app/_ui/tokens.css`) + heavy inline `style={{}}`. Tailwind v4 is imported (`globals.css:1`) with a `@theme inline` token bridge, but **no Tailwind utility classes are used anywhere** |
| Image processing | `sharp` via dynamic import (`api/levels/upload/route.ts:12`). Not a direct dependency; present transitively through `next` (package-lock) |
| Tests / lint | None (no test runner, no ESLint config, no CI files) |
| Scripts | `dev`, `build`, `start` only |

### 4.2 Directory structure

```
proxy.ts                       Edge proxy: CSP nonce + cross-origin (CSRF) guard for /api mutations
next.config.ts                 Static security headers
app/
  layout.tsx                   Root: fonts, theme cookie resolution, no-flash script, <NoZoom/>, ThemeProvider
  page.tsx                     "/" → redirect("/login")
  not-found.tsx                Global 404 → AdminNotFound
  login/page.tsx               Login form (client)
  (dashboard)/                 Route group for authenticated pages
    layout.tsx                 Server: cookie JWT verification → <Shell>
    _shell/                    Shell (sidebar/topbar), nav config, theme switcher, 404 component
    _shared/statusUi.tsx       formatNaira, statusTone, StatusDot, StatStrip
    <feature>/page.tsx         25 pages (client components, except dashboard)
  _ui/                         Mini design system (Button, Card, Badge, Field, Table, Tabs, Toggle, Modal, SidePanel, Misc, ExportModal, theme, NoZoom, tokens.css)
  _shared/RuleBuilder.tsx      ORPHANED (never imported)
  api/                         40 Route Handlers
  lib/                         jwt, supabase, dashboard, sanitize, redact, configUrls, uploadTypes, printExport, promoCacheBust, useIsMobile
public/                        Default Next.js SVGs (unused)
```

### 4.3 Request lifecycle

1. **`proxy.ts`** runs for all non-static paths (the matcher excludes `_next/static`, `_next/image`, `favicon.ico` and prefetches):
   * For non-GET/HEAD/OPTIONS `/api/*` requests, it rejects cross-origin requests with **403 `{error:'Origin not allowed'}`** unless:
     * the request has `Authorization: Bearer …` **and** `x-client: mobile-admin`, or
     * `Sec-Fetch-Site` is `same-origin` or `none`, or
     * the `Origin` host and protocol match the request URL (`proxy.ts:20-48`).
   * It generates a per-request nonce and sets a strict **CSP** (`proxy.ts:3-18`) on both the request (`x-nonce`) and the response.
2. **Page requests** under `(dashboard)`:
   * The server layout (`app/(dashboard)/layout.tsx:6-23`) reads the `admin_token` cookie and redirects to `/login` if it is missing or `verifyAdminJWT` fails.
   * It then renders the client `Shell` with `page_permissions`, `is_super_admin`, `username` and `role_title`.
3. **Per-page gating:** client-side in `Shell` (`Shell.tsx:59-63`). If the path maps to a nav key the admin lacks (and the path isn't `/dashboard`), the `AdminNotFound` component is rendered **instead of** the page.
4. **API requests:** each handler calls `verifyAdminFromRequest()` (`lib/jwt.ts:50-65`):
   * Mobile: Bearer token when `x-client: mobile-admin`, otherwise the cookie.
   * `verifyAdminJWT` verifies the HS256 signature and expiry, then **re-reads** `admin_users` (must be `is_active=true`, `token_version` must match) and **overrides** `is_super_admin` and `page_permissions` from the DB (`jwt.ts:29-44`).
   * The handler then checks permission keys and performs service-role DB operations, RPCs, storage calls or edge function calls, and writes `audit_log`.

### 4.4 Rendering model

| Page | Rendering | Data fetching |
|---|---|---|
| `/dashboard` | **Server Component** + `loading.tsx` skeleton + client `<AutoRefresh>` (`router.refresh()` every 5000 ms) | Direct Supabase queries in `lib/dashboard.ts` (does not call `/api/dashboard`) |
| All other `(dashboard)` pages | `'use client'` | `fetch('/api/...')` in `useEffect` |
| `/login` | client | `POST /api/auth` |

No data caching library (SWR/React Query) is used; state is local `useState`. There is no global store.

### 4.5 Environment variables actually read

| Variable | Used in | Purpose |
|---|---|---|
| `SUPABASE_URL` | `lib/supabase.ts:4`, `lib/promoCacheBust.ts:2`, `api/notifications/broadcast/route.ts:60`, `api/withdrawals/[id]/approve/route.ts:42` | Supabase REST + Edge Function base URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts:5` | Service-role key (bypasses RLS) |
| `ADMIN_JWT_SECRET` | `lib/jwt.ts:5` | HS256 signing secret for admin tokens |
| `ADMIN_FUNCTION_SECRET` | broadcast, approve-withdrawal, promo cache bust | Sent as `x-admin-secret` to Edge Functions |
| `NODE_ENV` | cookie `secure` flags, CSP `unsafe-eval` in dev | |

**Documentation drift:** `README.md:24-29` documents `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (never read) and omits `SUPABASE_URL` and `ADMIN_JWT_SECRET` (required). README also claims "Every page calls `requireAdmin([permission])`" and references `app/lib/session.ts`. Neither exists. It says "Tailwind CSS" (imported but unused) and "Next.js 15" (actually 16.2.2).

### 4.6 Static security headers (`next.config.ts:3-9`)

`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`.

### 4.7 CSP (`proxy.ts:3-18`)

`default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic' ('unsafe-eval' in dev); style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`.

---

## 5. Admin Navigation / Information Architecture

### 5.1 Global layout (Shell)

Defined in `app/(dashboard)/_shell/Shell.tsx` and styled by `Shell.module.css`.

```
┌────────── Sidebar (240px / 64px collapsed; drawer ≤768px) ──────────┬──────────────── Main ────────────────┐
│ [CE] CardElite / Admin                        [«] collapse           │ Top bar (56px, sticky):              │
│ ─────────────────────────────────────────────────────────────────── │  [☰ mobile]  Group / Item breadcrumb │
│ OPERATIONS  Dashboard · Card Queue · Withdrawals · Transactions      │                 [☀ ▭ ☾] theme switch │
│ PEOPLE      Users · Activity Log · Admin Activity · Admins           │──────────────────────────────────────│
│ CATALOG     Cards · Field Builder · Rates                            │ Content (padding 24px / 16px mobile) │
│ REWARDS     Bonuses · Levels · Coupons · Referrals                   │   page or AdminNotFound              │
│ COMMUNICATIONS Broadcast · Push Templates · Email Templates          │                                      │
│ CONFIGURATION Balance · Limits & Fees · Bill Settings · Settings     │                                      │
│ SECURITY    Anomaly & Alerts · Rate Limits & IPs                     │                                      │
│ ─────────────────────────────────────────────────────────────────── │                                      │
│ [U] username / role_title                       [⎋ logout]           │                                      │
└──────────────────────────────────────────────────────────────────────┴──────────────────────────────────────┘
```

* **Sidebar head:** brand mark "CE" (hidden when collapsed), wordmark "CardElite / Admin", and a collapse button (`ChevronsLeft`/`ChevronsRight`). Collapsed state is persisted to `localStorage['cardelite-admin-sidebar-collapsed']` (`Shell.tsx:13,34-49`).
* **Sidebar body:** nav groups with mono uppercase labels. Items have an icon and a label. In collapsed mode, labels are hidden and a CSS tooltip (`data-tooltip`, `::after`) appears on hover (`Shell.module.css:157-173`).
* **Sidebar foot (account area):**
  * avatar showing the first letter of the username;
  * username;
  * role title;
  * logout button (hidden when collapsed on desktop).
  * There is **no account menu**: no profile, password change or session list.
* **Top bar:**
  * hamburger (mobile only);
  * breadcrumb `Group / Item` (monospace), or "Admin" when the path matches no nav item;
  * theme switcher (Light / System / Dark radio group).
* **Content:** `overflow-x: hidden` (`Shell.module.css:282-287`). Wide content is clipped rather than scrolled unless the component provides its own scroll container (tables do).
* **Toasts:** `ToastProvider` wraps the Shell (`Shell.tsx:66`) but **no page calls `useToast()`**.

### 5.2 Navigation configuration (`_shell/nav.ts:27-88`)

| Group | Label | Route | Permission key | Icon |
|---|---|---|---|---|
| Operations | Dashboard | `/dashboard` | `dashboard` | LayoutDashboard |
| Operations | Card Queue | `/card-queue` | `card_queue` | ClipboardList |
| Operations | Withdrawals | `/withdrawals` | `withdrawals` | ArrowDownToLine |
| Operations | Transactions | `/transactions-overview` | `transactions_overview` | ClipboardList (duplicate icon) |
| People | Users | `/users` | `users` | Users |
| People | Activity Log | `/user-activity-monitor` | `user_activity_monitor` | Activity |
| People | Admin Activity | `/activity` | `activity` | Activity (duplicate icon) |
| People | Admins | `/admin-accounts` | `admin_accounts` | ShieldCheck |
| Catalog | Cards | `/cards` | `card_management` | CreditCard |
| Catalog | Field Builder | `/field-builder` | `card_type_builder` | Wrench |
| Catalog | Rates | `/rates` | `rates_management` | BadgePercent |
| Rewards | Bonuses | `/bonuses-rewards` | `bonuses_rewards` | Gift |
| Rewards | Levels | `/bonuses-rewards/levels` | `bonuses_rewards` (same key) | Trophy |
| Rewards | Coupons | `/coupons` | `coupons` | TicketPercent |
| Rewards | Referrals | `/referral-management` | `referral_management` | Share2 |
| Communications | Broadcast | `/notifications-broadcast` | `notifications_broadcast` | Megaphone |
| Communications | Push Templates | `/notification-templates` | `notification_templates` | Bell |
| Communications | Email Templates | `/email-templates` | `email_templates` | Mail |
| Configuration | Balance | `/platform-balance` | `platform_balance` | Wallet |
| Configuration | Limits & Fees | `/limits-fees` | `limits_fees` | SlidersHorizontal |
| Configuration | Bill Settings | `/bill-settings` | `bill_settings` | Receipt |
| Configuration | Settings | `/admin-settings` | `admin_settings` | Settings |
| Security | Anomaly & Alerts | `/anomaly-alerts` | `anomaly_alerts` | ShieldAlert |
| Security | Rate Limits & IPs | `/security-limits` | `security_limits` | Shield |

### 5.3 Complete hierarchy

```
Admin (CardElite)
├── /login  (unauthenticated)
├── /  → redirect /login
├── Operations
│   ├── Dashboard (/dashboard)                       [always reachable when logged in]
│   ├── Card Queue (/card-queue)
│   │   ├── Tabs: All · Pending · Approved · Rejected · Dispute queue
│   │   ├── Side panel: Card submission detail
│   │   │   ├── Share menu (popover)
│   │   │   ├── Inline Reject panel
│   │   │   └── Image lightbox (overlay)
│   │   └── Modal: Approve and credit (+ correction sub-form)
│   ├── Withdrawals (/withdrawals)
│   │   ├── Tabs: Review · Held · Processing · Success · Failed · Refunded · All
│   │   ├── Side panel: Withdrawal detail (+ inline approve/reject confirm boxes)
│   │   └── Modal: Export (time frame → CSV / Print-PDF)
│   └── Transactions (/transactions-overview)
│       ├── Filter bar (search, type group, status, from, to)
│       ├── Pagination
│       └── Modal: Export
├── People
│   ├── Users (/users)
│   │   ├── Modal: Export
│   │   └── User detail (/users/[id])          [not in nav; breadcrumb resolves to People / Users]
│   │       ├── Tabs: Recent transactions · Device logs · Login history
│   │       └── Modal: Freeze account
│   ├── Activity Log (/user-activity-monitor)  [page title "User activity monitor"]
│   │   └── Side panel: Activity detail (sessions, withdrawals, transactions, Terminate)
│   ├── Admin Activity (/activity)
│   │   ├── Modal: Activity entry detail
│   │   └── Modal: Export activity (custom, not ExportModal)
│   └── Admins (/admin-accounts)                [page title "Admin Accounts"]
│       ├── Side panel: Create / Edit admin
│       └── Modal: Delete admin (type DELETE)
├── Catalog
│   ├── Cards (/cards)                          [page title "Card & Country Management"]
│   │   ├── Modal: Add/Edit card brand (+ logo upload)
│   │   └── Side panel: <Brand> — Countries (+ country combobox)
│   ├── Field Builder (/field-builder)
│   │   ├── Brand list (left) → Card types (right, expandable)
│   │   └── Modal: Delete card type
│   └── Rates (/rates)
│       ├── Accordion: Card → Country → Type → Denominations
│       └── Modal: Add denomination range
├── Rewards
│   ├── Bonuses (/bonuses-rewards)              [page title "Bonuses & Rewards"]
│   │   ├── Cards: Levels (link) · Signup Bonus · Leaderboard (Coming Soon)
│   │   ├── Giftbox items table
│   │   └── Modal: Add/Edit giftbox item (+ rule builder)
│   ├── Levels (/bonuses-rewards/levels)        [page title "Level Tiers"; child of Bonuses]
│   ├── Coupons (/coupons)
│   │   ├── Inline card: Create/Edit coupon
│   │   └── Custom modal: Manage Terms of Use
│   └── Referrals (/referral-management)        [page title "Referral Management"]
├── Communications
│   ├── Broadcast (/notifications-broadcast)    [page title "Notifications Broadcast"]
│   ├── Push Templates (/notification-templates) [page title "Notification Templates"]
│   │   └── Side panel (wide): Edit template
│   └── Email Templates (/email-templates)
│       └── Side panel (wide): Edit email template (+ sandboxed iframe preview)
├── Configuration
│   ├── Balance (/platform-balance)             [page title "Platform Balance"; tabs Static · Live]
│   ├── Limits & Fees (/limits-fees)
│   ├── Bill Settings (/bill-settings)
│   └── Settings (/admin-settings)              [page title "Admin Settings"]
│       └── Modal: Enable/Disable Emergency Mode
├── Security
│   ├── Anomaly & Alerts (/anomaly-alerts)
│   └── Rate Limits & IPs (/security-limits)    [page title "Rate Limits & Webhook IPs"]
└── 404 (any unknown route, or permission-denied inside Shell)
```

### 5.4 Breadcrumbs, active states, sub-navigation

* **Breadcrumb** (`nav.ts:90-99`): two levels only, `<Group> / <Item>`, computed by the **first** nav leaf whose `href` equals the path or is a prefix (`startsWith(href + '/')`). The crumbs are not links. Consequences:
  * `/users/abc` → "People / Users" (fine; no crumb for the user).
  * `/bonuses-rewards/levels` → "Rewards / **Bonuses**". The Bonuses leaf is matched before Levels, so **the breadcrumb is wrong**.
  * Unknown path → "Admin".
* **Active state** (`Shell.tsx:94`): `pathname === href || pathname.startsWith(href + '/')`. On `/bonuses-rewards/levels`, **both "Bonuses" and "Levels" are highlighted**.
* **Permission key resolution** (`nav.ts:101-110`) uses the same first-match logic, so `/bonuses-rewards/levels` resolves to `bonuses_rewards`. That is harmless because both items share the key.
* **Secondary navigation:**
  * Tabs component (segmented or underline) used on Card Queue, Withdrawals, User detail and Platform Balance.
  * Status "tabs" are implemented as client state and are **not reflected in the URL**, so they cannot be deep-linked or bookmarked.
* **Back links:**
  * `/users/[id]` → "← BACK TO USERS" (a plain `<a>`, full reload).
  * `/bonuses-rewards/levels` → "← Back to Bonuses & Rewards" (`Link`).
  * The Bonuses page "Levels" card links to Levels.
* **Context menus:** only the Card Queue "Share" popover. No row action menus (all row actions are inline buttons).
* **Collapsed state:** desktop rail 64px, labels hidden, tooltips on hover; brand mark, user identity and logout hidden. **Logout is unreachable while collapsed on desktop** (`Shell.module.css:234`).
* **Mobile navigation (≤768px):**
  * The sidebar becomes an off-canvas drawer (272px, max 84vw) opened by the hamburger.
  * A scrim closes it. It auto-closes on route change (`Shell.tsx:41`).
  * The collapse button is hidden and the collapsed styles are neutralized.
* **User/account menu:** only the sidebar foot (identity + logout). No settings for the admin's own account other than theme.

### 5.5 Permission-based filtering

`filterNavByPermissions` (`nav.ts:112-118`): super admins see everything. Otherwise items are filtered by key and empty groups are dropped. **Dashboard** is itself a key (`dashboard`), so an admin without it does not see the Dashboard link, but `/dashboard` is still rendered (the Shell exempts it, `Shell.tsx:61`) and is the post-login landing page (`login/page.tsx:49`).

### 5.6 Hidden, orphaned and non-nav routes

| Route / file | Reachability | Notes |
|---|---|---|
| `/users/[id]` | From Users "View", mobile user cards, and Transactions user links | Not in nav (expected detail page) |
| `/` | Redirects to `/login`, even if already authenticated | |
| `/login` | Direct | Does not redirect already-authenticated admins to `/dashboard` |
| `app/_shared/RuleBuilder.tsx` | **Orphaned**, never imported | A light-theme hard-coded duplicate of the RuleBuilder inside `bonuses-rewards/page.tsx` |
| `public/*.svg` | Unused Next.js starter assets | |
| API-only features | See §6.2 "UI consumer" column | flagged-transactions, auth/me, dashboard API, revoke sessions, reorder |

---

## 6. Complete Route Inventory

### 6.1 Page routes

"UI gate" = the client-side Shell check (the key must be in `page_permissions`, or the admin is super admin). "Effective access" = what actually works after API checks.

| # | Route | File | Page title | Nav | UI gate key | Effective access (API) | Components (key) | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `/` | `app/page.tsx` | — | — | none | public | redirect | Complete |
| 2 | `/login` | `app/login/page.tsx` | CardElite / Admin Panel | — | none | public | inline-styled form | Complete (light-only) |
| 3 | `/dashboard` | `(dashboard)/dashboard/page.tsx` (+`loading.tsx`, `AutoRefresh.tsx`) | Overview | Operations › Dashboard | *(exempt)* | any admin; each KPI gated by its own key | PageHeader, KpiGrid/Kpi, Card, Table, StatusDot | Complete (accuracy issues §8) |
| 4 | `/card-queue` | `card-queue/page.tsx` | Card queue | Operations › Card Queue | `card_queue` | `card_queue` | Tabs, Input, Table, SidePanel, Modal, Textarea, Select, lightbox, share menu | Complete (search limited) |
| 5 | `/withdrawals` | `withdrawals/page.tsx`, `WithdrawalsMobile.tsx` | Withdrawals | Operations › Withdrawals | `withdrawals` | `withdrawals` | StatStrip(local), Tabs, Input, Table, SidePanel, ExportModal | Complete |
| 6 | `/transactions-overview` | `transactions-overview/page.tsx` | Transactions | Operations › Transactions | `transactions_overview` | `transactions_overview` | StatStrip, filter bar, Table, pagination, ExportModal | Complete (read-only) |
| 7 | `/users` | `users/page.tsx` | Users | People › Users | `users` | `users` | StatStrip, search, Table(sticky col), pagination, ExportModal | Complete |
| 8 | `/users/[id]` | `users/[id]/page.tsx` | (user name) | *(not in nav)* | `users` (prefix) | view: `users`; freeze: super admin or `users_freeze` | Card, InfoRow, StatStrip, Tabs, Table, Modal | Partial (freeze shown to all) |
| 9 | `/user-activity-monitor` | `user-activity-monitor/page.tsx` | User activity monitor | People › Activity Log | `user_activity_monitor` | **super admin only** | StatStrip, Input, Toggle, Table, SidePanel | Partial (delegation broken) |
| 10 | `/activity` | `activity/page.tsx` | Admin Activity | People › Admin Activity | `activity` | `activity` | StatStrip, Select, grouped Table, Modal×2 | Complete (limited filtering) |
| 11 | `/admin-accounts` | `admin-accounts/page.tsx` | Admin Accounts | People › Admins | `admin_accounts` | **super admin only** | StatStrip, Table, SidePanel form, Modal | Partial |
| 12 | `/cards` | `cards/page.tsx` | Card & Country Management | Catalog › Cards | `card_management` | `card_management` | StatStrip, Table, Modal, SidePanel, combobox | Partial (reorder UI fake; errors silent) |
| 13 | `/field-builder` | `field-builder/page.tsx` | Field Builder | Catalog › Field Builder | `card_type_builder` | `card_type_builder` **+ `card_management`** (brand list) | Card list, expandable Cards, FieldForm, Modal | Partial |
| 14 | `/rates` | `rates/page.tsx` | Rates | Catalog › Rates | `rates_management` | `rates_management` | Accordion, Input, Toggle, Modal, local toast | Partial (no range edit/delete) |
| 15 | `/bonuses-rewards` | `bonuses-rewards/page.tsx` | Bonuses & Rewards | Rewards › Bonuses | `bonuses_rewards` | stats/giftbox: `bonuses_rewards`; **toggles/config: super admin only** | Cards, Toggle, Table, Modal, RuleBuilder | Partial |
| 16 | `/bonuses-rewards/levels` | `bonuses-rewards/levels/page.tsx` | Level Tiers | Rewards › Levels | `bonuses_rewards` | `bonuses_rewards` (upload: cookie only) | Card grid, file input, Toggle | Complete (fixed 6 tiers) |
| 17 | `/coupons` | `coupons/page.tsx`, `TermsOfUseManager.tsx` | Coupons | Rewards › Coupons | `coupons` | coupons: `coupons`; card list: **`card_management`**; terms: **super admin** | Inline form Card, Table, custom modal | Partial |
| 18 | `/referral-management` | `referral-management/page.tsx` | Referral Management | Rewards › Referrals | `referral_management` | log: `referral_management`; **settings: super admin** | Card form, StatStrip, Table | Partial |
| 19 | `/notifications-broadcast` | `notifications-broadcast/page.tsx` | Notifications Broadcast | Communications › Broadcast | `notifications_broadcast` | `notifications_broadcast` (user search also needs `users`) | Compose Card, variable chips, Table | Complete (no confirm) |
| 20 | `/notification-templates` | `notification-templates/page.tsx` | Notification Templates | Communications › Push Templates | `notification_templates` | `notification_templates` | Table, SidePanel(wide), preview | Complete (edit only) |
| 21 | `/email-templates` | `email-templates/page.tsx` | Email Templates | Communications › Email Templates | `email_templates` | `email_templates` | Table, SidePanel(wide), iframe preview | Complete (edit only) |
| 22 | `/platform-balance` | `platform-balance/page.tsx` | Platform Balance | Configuration › Balance | `platform_balance` | `platform_balance` | Tabs(mode), Input, StatStrip | Complete (no manual refresh) |
| 23 | `/limits-fees` | `limits-fees/page.tsx` | Limits & Fees | Configuration › Limits & Fees | `limits_fees` | **super admin only** | Form cards | Partial (delegation broken) |
| 24 | `/bill-settings` | `bill-settings/page.tsx` | Bill Settings | Configuration › Bill Settings | `bill_settings` | `bill_settings` | Form cards | Complete |
| 25 | `/admin-settings` | `admin-settings/page.tsx` | Admin Settings | Configuration › Settings | `admin_settings` | **super admin only** (explicit "Super-admin access only." state) | Many Cards, Toggle, radio, Modal | Complete for super admin; key meaningless |
| 26 | `/anomaly-alerts` | `anomaly-alerts/page.tsx` | Anomaly & Alerts | Security › Anomaly & Alerts | `anomaly_alerts` | `anomaly_alerts` | Form cards | Complete |
| 27 | `/security-limits` | `security-limits/page.tsx` | Rate Limits & Webhook IPs | Security › Rate Limits & IPs | `security_limits` | `security_limits` | Form cards, Textarea | Complete |
| 28 | *(any unknown)* | `app/not-found.tsx` → `_shell/NotFound.tsx` | 404 Page not found | — | — | — | inline styled | Complete (rendered without Shell) |

### 6.2 API routes

`SA` = super admin only. "UI consumer" lists web pages that call the route. "—" means no web consumer (backend-only for the web; possibly used by the mobile admin app).

| # | Route | Methods | AuthZ | Purpose | UI consumer |
|---|---|---|---|---|---|
| 1 | `/api/auth` | POST | public (rate-limited) | Admin login | `/login` |
| 2 | `/api/auth/logout` | POST | cookie session | Logout; bumps `token_version` | Shell logout |
| 3 | `/api/auth/me` | GET | any admin | Current admin profile | — |
| 4 | `/api/admin/theme` | PATCH | any admin | Persist theme preference | ThemeProvider |
| 5 | `/api/dashboard` | GET | any admin | Dashboard stats + recent submissions JSON | — (web dashboard queries directly) |
| 6 | `/api/card-queue` | GET, POST | `card_queue` | List/detail submissions; approve/overturn/reject/uphold | Card Queue |
| 7 | `/api/withdrawals` | GET | `withdrawals` | List / detail (`?id`) / CSV / PDF-json | Withdrawals |
| 8 | `/api/withdrawals/[id]/approve` | POST | `withdrawals` | Approve + trigger gateway payout | Withdrawals |
| 9 | `/api/withdrawals/[id]/reject` | POST | `withdrawals` | Reject + refund | Withdrawals |
| 10 | `/api/transactions` | GET | `transactions_overview` | Ledger list + stats + CSV / PDF-json | Transactions |
| 11 | `/api/users` | GET | `users` | List + CSV / PDF-json | Users |
| 12 | `/api/users/[id]` | GET, PATCH | GET `users`; PATCH SA or `users_freeze` | Detail; freeze/unfreeze | User detail |
| 13 | `/api/user-activity-monitor` | GET | SA | Users by last activity + online count | Activity Log |
| 14 | `/api/user-activity-monitor/[id]` | GET | SA | Sessions, transactions, withdrawals | Activity Log panel |
| 15 | `/api/user-activity-monitor/[id]/terminate` | POST | SA | Terminate all user sessions | Activity Log panel |
| 16 | `/api/activity` | GET | `activity` | Audit log (JSON / CSV) + admin list | Admin Activity |
| 17 | `/api/admin-accounts` | GET, POST, PATCH, DELETE | SA | Admin CRUD, activate/deactivate, revoke sessions, soft delete | Admins (revoke: —) |
| 18 | `/api/cards` | GET, POST, PATCH, DELETE | `card_management` | Brands, countries, reorder | Cards, Field Builder, Coupons |
| 19 | `/api/cards/upload` | POST (multipart) | `card_management` | Upload brand logo | Cards |
| 20 | `/api/field-builder` | GET, POST, PATCH, DELETE | `card_type_builder` | Templates, fields, country install, toggles | Field Builder (reorder_fields: —) |
| 21 | `/api/rates` | GET, POST, PATCH | `rates_management` | Rate tree; add denomination; batch update | Rates |
| 22 | `/api/bonuses` | GET | `bonuses_rewards` | Bonus stats | Bonuses |
| 23 | `/api/giftbox` | GET, POST, PATCH | `bonuses_rewards` | Giftbox items CRUD (no delete) | Bonuses |
| 24 | `/api/levels` | GET, PATCH | `bonuses_rewards` | Level tiers | Levels |
| 25 | `/api/levels/upload` | POST (multipart) | `bonuses_rewards` (**cookie only**) | Upload badge (resized to WebP) | Levels |
| 26 | `/api/coupons` | GET, POST, PATCH | `coupons` | Coupons CRUD (no delete) | Coupons |
| 27 | `/api/referrals` | GET | `referral_management` | Referral log + stats | Referrals |
| 28 | `/api/notifications/broadcast` | GET, POST | `notifications_broadcast` | History; send via edge fn | Broadcast |
| 29 | `/api/notifications/recipient-count` | GET | `notifications_broadcast` | Audience size | Broadcast |
| 30 | `/api/notifications/user-search` | GET | SA or (`notifications_broadcast` AND `users`) | User picker (rate-limited) | Broadcast |
| 31 | `/api/notification-templates` | GET, PATCH | `notification_templates` | Push templates | Push Templates |
| 32 | `/api/email-templates` | GET, PATCH | `email_templates` | Email templates | Email Templates |
| 33 | `/api/app-config` | GET, PATCH | **SA** | Generic `app_config` read/write (allow-listed keys) | Bonuses, Referrals, Coupons (Terms of Use) |
| 34 | `/api/admin-settings` | GET, PATCH | **SA** | Gateways, bill providers, Chatwoot, URLs, version, emergency, max approval | Settings |
| 35 | `/api/limits-fees` | GET, PATCH | **SA** | Withdrawal limits & fee, large-withdrawal flag | Limits & Fees |
| 36 | `/api/bill-settings` | GET, PATCH | `bill_settings` | Airtime/electricity quick amounts & minimums | Bill Settings |
| 37 | `/api/platform-balance` | GET, PATCH | `platform_balance` | Balance mode/static value; live read-only | Balance |
| 38 | `/api/anomaly-alerts` | GET, PATCH | `anomaly_alerts` | Fraud thresholds, alert email settings | Anomaly & Alerts |
| 39 | `/api/security-limits` | GET, PATCH | `security_limits` | Signup rate limit, webhook IP allowlists | Rate Limits & IPs |
| 40 | `/api/flagged-transactions` | GET, POST | **SA** | List flags; clear/escalate | — (**no UI**) |

Full per-endpoint specifications are in §21.

---

## 7. Complete Page Specifications

Every page follows this template: **Identity → Layout → UI components → Data → Tables → Forms/Overlays → Actions → States → Responsive → Issues**. Shared behaviors:

* All `(dashboard)` pages render inside the Shell (§5.1) and use `PageHeader` (title h1 + subtitle + right-aligned actions; stacks vertically ≤768px).
* Dates use the **browser locale** (`toLocaleString()` / `toLocaleDateString()`), except the server-rendered Dashboard, which uses the **server** locale and timezone.
* Money uses `₦` + `toLocaleString('en-NG', {minimumFractionDigits: 2})`.
* "Mobile" means `useIsMobile()` is true (`max-width: 768px`, `lib/useIsMobile.ts`). This hook starts `false` on first render, so mobile devices briefly render the desktop table and then swap.

---

### 7.1 Login — `/login`

**Identity**

| | |
|---|---|
| File | `app/login/page.tsx` |
| Purpose | Authenticate an admin |
| Access | Public |
| Backend | `POST /api/auth` |

**Layout.** A full-height centered page on `#F7F7F7`. A 400px white card (radius 12, shadow) contains the wordmark "CardElite", the subtitle "Admin Panel", a divider and the form. All styles are **hard-coded inline light colors**, so the page ignores dark mode and the design tokens.

**Form**

| Field | Type | Required (client) | Validation | Default | Notes |
|---|---|---|---|---|---|
| EMAIL | `email` | yes (silent: submit ignored if empty) | browser email type only | "" | `autoComplete="email"` |
| USERNAME | `text` | yes (silent) | none | "" | `autoComplete="username"` |
| PASSWORD | `password`/`text` | yes (silent) | none | "" | Eye-icon toggle shows/hides; `autoComplete="current-password"` |

* **Submit** (`handleSubmit`, `login/page.tsx:29-50`):
  1. If any field is empty or a request is in flight, the submit silently does nothing (no message).
  2. It sets loading, clears the error, and POSTs `{email, username, password}`.
  3. On `!res.ok`, it shows the `data.error` text (red, centered) under the fields.
  4. On success, it calls `router.push('/dashboard')`.
* **Button states:** "Login" / "Logging in..." (opacity 0.7, disabled).

**Server behavior** (`app/api/auth/route.ts`), in order:

1. **400** if any of email/username/password is missing.
2. IP rate limit: `check_rate_limit_by_key(ip, 'admin_login', 20, 600s)`. The IP is the **last** `X-Forwarded-For` entry, falling back to `x-real-ip`. Returns **429 "Too many attempts. Try again later."**
3. Account rate limit: key `admin:<username>|<email>` (lowercased), `admin_login_account`, 10 per 1800 s → **429**.
4. Looks up `admin_users` by `username` AND `email` AND `is_active=true`. If not found, it runs a dummy bcrypt compare (timing equalization) and returns **401 "Invalid credentials"**.
5. On a password mismatch:
   * inserts `audit_log` `LOGIN_FAILED`;
   * counts failures for the last 30 min and 24 h;
   * if ≥5 in 30 min, inserts `admin_alerts` (`severity: high`, `event_type: admin_login_burst`);
   * if ≥25 in 24 h, sets `is_active=false` and logs `ADMIN_AUTO_DEACTIVATED`;
   * returns **401**.
6. On success:
   * updates `last_login_at` and logs `LOGIN`;
   * signs a JWT (`admin_id, role_title, is_super_admin, page_permissions, username, token_version`), valid **8 h** on web or **24 h** for `x-client: mobile-admin`.
   * Web: sets cookie `admin_token` (httpOnly, `secure` in production, `sameSite=strict`, 8 h) and cookie `admin_theme` (non-httpOnly, lax, 1 year) from `theme_preference`.
   * Mobile: returns `{token, admin{…}}` in JSON.

**States:** initial (empty) · submitting · error (server message) · success (navigate). **Missing states:**
* A network error or non-JSON response throws at `res.json()` (`login/page.tsx:41`). The button stays stuck on "Logging in..." with no message.
* There is no "already logged in" redirect.
* There are no field-level errors.

**Responsive:** the card is a fixed `width: 400` with no `max-width`, so it **overflows horizontally on phones narrower than 400px**. Inputs are forced to 16px on mobile by `tokens.css` to avoid iOS zoom.

**Issues:**
* Requires *both* email and username. That is unusual, and the error message doesn't tell the admin which field is wrong (by design).
* No "forgot password".
* No MFA.
* No CAPTCHA (rate limits only).
* The rate-limit RPC fails **open**: if it errors, `data` is `null`, which is not `false`, so the login proceeds.

---

### 7.2 Root redirect `/` and Not Found

* `/` (`app/page.tsx`) redirects server-side to `/login` unconditionally.
* **404** (`app/not-found.tsx` → `AdminNotFound`, `_shell/NotFound.tsx`):
  * Content: a large "404" in the accent color, the title "Page not found", the body "The page you're looking for doesn't exist, or you don't have permission to view it." and a pill button "Back to Dashboard" → `/dashboard`.
  * The same component is the **permission-denied state** inside the Shell (`Shell.tsx:164`). Permission denial is indistinguishable from a missing page, by design.
  * The global 404 renders without the Shell (no sidebar).

---

### 7.3 Dashboard — `/dashboard`

See **§8** for the element-by-element specification. Summary:
* A server component with a permission-filtered KPI grid (up to 16 KPIs) and a "Recent card submissions" table (latest 10), gated by `card_queue`.
* Auto-refreshes every 5 s.
* `loading.tsx` shows 8 KPI skeletons plus table skeleton rows.

---

### 7.4 Card Queue — `/card-queue`

**Identity**

| | |
|---|---|
| File | `app/(dashboard)/card-queue/page.tsx` (779 lines) |
| Nav | Operations › Card Queue |
| Purpose | Review user gift-card submissions: approve (optionally correcting type/amount), reject with reason, resolve disputes (overturn/uphold) |
| Access | UI key `card_queue`; API `GET/POST /api/card-queue` requires SA or `card_queue`. **Returns 401 (not 403) when the permission is missing** (`api/card-queue/route.ts:35-37,146-148`) |

**Layout**
1. PageHeader "Card queue" — "Live submissions — auto-refreshes every 5 seconds."
2. Toolbar row (wraps): underline **Tabs** (All · Pending · Approved · Rejected · Dispute queue), and a search **Input** "Search user or card brand" (min 260 / max 320px).
3. Desktop: Card with a flush **Table**. Mobile: card list (`CardQueueMobile`).
4. **SidePanel** "Card submission" (560px) for detail.
5. **Modal** "Approve and credit".
6. Full-screen **image lightbox**.

**Data**
* List:
  * `GET /api/card-queue?status=<tab>&search=<q>` returns the latest **200** submissions (`order created_at desc limit 200`), filtered by status when the tab isn't "all".
  * Fields: `id, amount_foreign, payout_naira, status, created_at, rejection_reason, dispute_message, users(id, full_name, username, email), cards(name), card_types(name, country_code)`.
  * Search is applied **in memory on those 200 rows**. It matches `users.username`, `users.full_name` or `cards.name` (case-insensitive substring). **Older submissions cannot be found.**
* Detail: `GET /api/card-queue?id=<uuid>` returns:
  * the submission plus `rate_at_submission, rejection_reason, submitted_fields (jsonb), card_images, dispute_message, dispute_images, coupon_code, coupon_bonus, card_id, card_type_id, users(...), cards(id,name), card_types(id,name,country_code), denominations(range_label)`;
  * `card_images` and `dispute_images` as **1-hour signed URLs** (bucket `card-images`, signed one at a time);
  * `country_name` (from `card_countries`);
  * `card_types_for_card` (active types of the same card with their active denominations, used for correction);
  * `field_labels` (map of `card_type_fields.id → label`, used to label `submitted_fields`).
* Polling: `load(true)` every **5000 ms** (silent, no skeleton), including while the detail panel is open.

**Table — submissions (desktop)**

| # | Column | Source | Format | Sort | Filter | Link/action |
|---|---|---|---|---|---|---|
| 1 | User | `users.username` | `@username`, primary emphasis | none (fixed created_at desc) | via search | — |
| 2 | Card | `cards.name` | text | — | via search | — |
| 3 | Country | `card_types.country_code` | code (e.g. US) | — | — | — |
| 4 | Type | `card_types.name` | text | — | — | — |
| 5 | Value | `amount_foreign` | raw number, right, mono (no currency symbol) | — | — | — |
| 6 | Payout | `payout_naira` | ₦ formatted, right, mono | — | — | — |
| 7 | Submitted | `created_at` | `toLocaleString()` | — | — | — |
| 8 | Status | `status` | StatusDot: pending/disputed = warning, approved/dispute_resolved = success ("Resolved"), rejected = danger | — | tabs | — |
| 9 | Actions | — | Pending rows: **Approve** (success sm) + **Reject** (dangerSubtle sm). Every row: **View** (ghost sm) | — | — | Approve/Reject open the detail panel **and** set the modal/inline reject flag |

* No pagination (hard cap 200), no page-size control, no column visibility, no row selection, no bulk actions, no export.
* Empty: "No submissions". Loading: `TableSkeleton` (9 cols, 6 rows) on non-silent loads.
* **No "Resolved" (dispute_resolved) tab.** Those rows are only visible under "All".

**Side panel — Card submission** (`page.tsx:315-489`)
* Title "Card submission", subtitle `@username`. Closes with ✕, Esc or scrim click. Shows `SkeletonLines` while loading, or when `detail.users` is missing (a failed load shows a skeleton forever).
* **Share** button (secondary sm, `Share2` icon) toggles a popover menu. A transparent full-screen click-catcher (z 55) closes it. Items:
  * "Share with images (native)" — only if there are images. Fetches each signed image as a blob and calls `navigator.share({text, title, files})`. Falls back to text with an `alert()`. Shows an `alert()` if the Web Share API is unsupported, or on error.
  * "WhatsApp (text only)" → `https://wa.me/?text=…`.
  * "Telegram (text only)" → `https://t.me/share/url?url=<text>&text=<text>`.
  * "Email (text only)" → `mailto:?subject=Card Submission - <card>&body=…`.
  * "Copy text" → clipboard, then `alert('Copied to clipboard')`.
  * "Download images" — only if there are images. Downloads each file sequentially as `card-<n>.<ext>`.
  * **Share text** includes Card, Country, Value, and every string-valued `submitted_fields` entry with its label (`buildShareText`, `page.tsx:80-92`). This can include **redeemable card codes/PINs**. **None of the share actions is audited.**
* User header: 44px accent square with the initial, full name, email, `@username`.
* **Detail rows** (label left, value right): Card, Country (name or code), Type, Denomination (`range_label`), Value (`amount_foreign`), Rate (`rate_at_submission`), **Payout** (bold ₦), Coupon (`code (+₦bonus)`, if present), Submitted (locale), Status (StatusDot).
* **Submitted fields** section: each key → label (`field_labels[key]` or the raw key) : `String(value)`.
* **Card images:** 120×100 thumbnails, cover-fit; click opens the lightbox at that index.
* **Dispute** (status `disputed`): a warning-toned box "Dispute message" with the text. "Dispute evidence" thumbnails open the lightbox.
* **Rejection reason** block when present and status ≠ pending.
* **Action bar:**
  * `pending` → **Approve** (success, flex 1) and **Reject** (dangerSubtle, flex 1).
  * `disputed` → **Overturn (approve + credit)** and **Uphold** (dangerSubtle). **Uphold fires immediately, with no confirmation.**
  * Other statuses → no actions (read-only).
* **Inline reject panel** (when "Reject" is clicked):
  * section label "Rejection reason";
  * 6 preset radio options: *Card already redeemed · Invalid card code · Card image unclear / unreadable · Wrong card type selected · Wrong denomination · Duplicate submission*;
  * a Textarea "Or enter a custom reason" (typing clears the radio and vice versa);
  * a full-width **"Confirm reject"** (danger) button.
  * Validation: if the reason is empty, `alert('Pick or enter a reason')`. No length limit (server has none either).

**Modal — Approve and credit** (`ApproveModal`, `page.tsx:663-779`)
* Opens when `showApprove && detail.users`. Size md. Footer: **Cancel** (secondary), **Confirm** (success; loading while busy; disabled when `!canConfirm`).
* Body: "Credit **₦X** to **@user**?" where X = (corrected payout or original `payout_naira`) + `coupon_bonus`.
* "+ Correct card type / amount" (dashed ghost button) expands the correction box:
  * **Card type** Select: active types of the same card (`name (CC)`).
  * **Foreign amount** Input (number, decimal).
  * **Note to user (required)**: 5 preset radios (*Card partially redeemed — credited the actual usable balance · Card face value differs from submitted amount · Wrong card type selected — corrected to the right one · Denomination mismatch — adjusted to match card value · Partial approval — unusable portion excluded*) plus a Textarea "Or enter a custom note".
  * **Reset** (ghost) restores the original type/amount and clears the note.
  * A computed summary: Rate (`rate_naira / unit` or "No matching denomination"), Denomination, Payout, Coupon bonus, **Total credit**.
  * Client-side denomination match: among the selected type's active denominations, those with `min ≤ amount ≤ max`, taking the one with the highest `min_value`. New payout = `round(amount × rate × 100) / 100`.
  * `canConfirm` is false when a correction differs from the original but there is no matching denomination, or the note is empty.
* **Submit:** POST `{action: 'approve'|'overturn', submission_id, card_type_id?, amount_foreign?, correction_note?}`. Only the fields that changed are sent.

**Actions**

| Action | Trigger | Confirm | API | Server validation | Backend operation | Success | Failure | Audit | User notification |
|---|---|---|---|---|---|---|---|---|---|
| Approve | Approve → modal Confirm | Modal (amount shown) | POST `action=approve` | `amount_foreign` finite > 0 if sent; submission exists | RPC `approve_card_submission(p_submission_id, p_admin_id, [p_card_type_id], [p_amount_foreign], [p_correction_note])`. Status checks, crediting, max-approval limit and notifications happen inside the RPC (outside this repo) | Close panel, reload list | `alert(json.error)` (the RPC error message is passed through verbatim, HTTP 500) | `APPROVE_CARD` with before = full row, after = `{status:'approved', ...rpcArgs}` | inside RPC (not visible) |
| Approve with correction | Correction box in modal | Modal + required note | same | same | same, with correction args | same | same | same action key (the activity page has an `APPROVE_CARD_CORRECTED` label that this route never emits) | inside RPC |
| Reject | Reject → inline panel → Confirm reject | Inline panel only | POST `action=reject, reason` | reason non-empty; `status === 'pending'` (400); conditional update `WHERE status='pending'` (409 if it lost a race) | 1) update submission → `rejected` + reason; 2) mark the existing `giftcard_credit` transaction (`reference_id` = submission) `failed`, or insert a failed one (`idempotency_key 'reject-card-<id>'`); 3) build a card label; 4) RPC `emit_notification(user, 'card_rejected', vars {card_label, reason})` | Close + reload | `alert` | `REJECT_CARD` | Push/in-app `card_rejected` template |
| Overturn dispute | Overturn → modal Confirm | Modal | POST `action=overturn` | as approve | same RPC `approve_card_submission` | Close + reload | `alert` | `OVERTURN_DISPUTE` (activity label map expects `OVERTURN_CARD_DISPUTE`) | inside RPC |
| Uphold dispute | Uphold button | **None** | POST `action=uphold` | `status === 'disputed'` (400); conditional update (409) | Status → `dispute_resolved`; `giftcard_credit` transactions → `failed`; `emit_notification('dispute_closed')` | Close + reload | `alert` | `UPHOLD_DISPUTE` (label map expects `UPHOLD_CARD_DISPUTE`) | `dispute_closed` template |
| View | View button / mobile card tap | — | GET `?id` | none (id not UUID-validated) | read | Panel populated | Perpetual skeleton | none | — |
| Share / copy / download | Share menu | none | none (client) | — | — | alert / new tab | alert | **none** | — |

**States**
* Initial: Pending tab.
* Loading: skeleton rows.
* Empty: "No submissions".
* Populated.
* Processing: action buttons disabled while `busy`; Confirm shows a spinner.
* Error: list fetch failures are **silent**. Non-OK responses lack `submissions`, so the list becomes empty and looks like "No submissions".
* Permission denied: the Shell shows 404. If the API returns 401 the page shows an empty list.
* Success: panel closes, list reloads (no toast).

**Responsive**
* ≤768px: `CardQueueMobile` renders one card per submission (card name bold; `@user · CC`; status dot; "value X · payout ₦Y · date"; Approve/Reject buttons for pending).
* Loading placeholders are 3 translucent blocks, not shimmer.
* The side panel is `max-width: 100vw`.
* The lightbox is full-screen with prev/next arrows.
* The toolbar wraps.

**Issues:** in-memory search limited to 200 rows; no pagination; no Resolved tab; Uphold without confirmation; `alert()`-based errors; 401 instead of 403; search refetches on every keystroke (no debounce) on top of 5 s polling; `rejectBody` computed but unused (`api/card-queue/route.ts:251`); reject flow is multi-step and not atomic; no audit for share/export of card data; after the main select, the detail endpoint re-queries `card_submissions` for `card_id` twice more (`route.ts:63,73-77`).

---

### 7.5 Withdrawals — `/withdrawals`

**Identity**

| | |
|---|---|
| Files | `withdrawals/page.tsx` (481), `withdrawals/WithdrawalsMobile.tsx` (110) |
| Nav | Operations › Withdrawals |
| Purpose | Monitor bank withdrawals, approve (fires gateway payout) or reject (refund) items in `pending_review`/`held` |
| Access | `withdrawals` (UI and API) |

**Layout:**
1. PageHeader "Withdrawals" — "Live withdrawal queue across all statuses. Auto-refreshes every 5 seconds." with an **Export** button (primary sm, Download icon).
2. Local **StatStrip**:
   * "In view" = rows.length;
   * "Amount in view" = sum of the amounts in view;
   * "Total in queue" = the server `total` for the current filter. The label is misleading on the Success/All tabs.
3. Toolbar: segmented **Tabs** and a search Input "Search user or account".
4. Desktop table or mobile cards.
5. The footer text "N total" (right-aligned) when total > 0.
6. **SidePanel** "Withdrawal".
7. **ExportModal**.

**Tabs** (value → label): `pending_review` Review (default) · `held` Held · `processing` Processing · `success` Success · `failed` Failed · `refunded` Refunded · `all` All.

**Data**
* List: `GET /api/withdrawals?status&search&limit=200`. **The server clamps `limit` to 100** (`clampPagination` max 100, `lib/sanitize.ts:9-13`), so the page shows **at most the 100 most recent** matching withdrawals.
  * Selects `id, user_id, amount, bank_name, account_number, account_name, gateway, gateway_reference, status, failure_reason, created_at`, ordered by created_at desc, range 0–99 (after clamping).
  * Users are joined in a second query (`id, username, full_name, email`).
  * Search:
    1. sanitizes the text (`[^a-zA-Z0-9 @._+-]` stripped, max 64);
    2. finds users whose full_name, username or email `ilike` it (**unbounded**);
    3. filters withdrawals `user_id IN (...)`.
  * The UI placeholder says "user **or account**", but **account number and name are not searched**.
* Detail: `GET /api/withdrawals?id=` returns `select *` plus the user (`username, full_name, email, phone`) plus the latest `flagged_transactions` row where `transaction_type='withdrawal'` and `transaction_id=id`.
* Polling: every 5 s (silent).
* The API also supports `review=1` (pending_review + held), `date_from`/`date_to` and `page`. **The UI uses neither pagination nor review.** The requested limit of 200 is clamped to 100.

**Table — withdrawals (desktop)**

| # | Column | Source | Format |
|---|---|---|---|
| 1 | User | `user.username`, falling back to full_name | `@x` primary |
| 2 | Amount | `amount` | ₦, right, mono, primary |
| 3 | Bank | `bank_name` | secondary |
| 4 | Account | `account_name` / `account_number` | two lines, number in xs tertiary |
| 5 | Gateway ref | `gateway_reference` | mono muted |
| 6 | Requested | `created_at` | locale datetime |
| 7 | Status | `status` | local StatusDot: success = green; processing/initiated/pending_review = amber; held/failed = red; refunded = purple |
| 8 | Actions | — | `pending_review`/`held` rows: **Approve**, **Reject**. All rows: **View**. The row itself is clickable (opens the detail) |

No sorting, no page size, no pagination (effective 100-row cap), no selection or bulk actions, no column visibility. Empty: "No withdrawals". Loading: TableSkeleton (8 cols).

**Side panel — Withdrawal**
* User header (initial avatar, full name, email, @username, phone).
* Rows: **Amount** (bold), Bank, Account name, Account number, Gateway, Gateway ref, Status, Reason (`failure_reason` if present), Requested.
* **Flag box** (if `flag`): warning tone, "⚠ Flagged", the `flag_reason`, "at &lt;created_at&gt;". **There is no action to clear or escalate the flag here** (the API exists at `/api/flagged-transactions`, SA only).
* Inline error banner (`err`).
* When `canAct(status)`:
  * **Approve** → ConfirmBox "Approve withdrawal of ₦X?" / "This will fire the gateway transfer to &lt;account_name&gt; (&lt;bank_name&gt;)." with [Cancel] [Confirm approve].
  * **Reject** → ConfirmBox "Reject withdrawal" / "Funds (₦X) will be refunded to the user's wallet." with 5 preset radios (*Suspicious activity · Account under review · Incorrect account details · Duplicate withdrawal · Gateway unavailable*), a custom Textarea (maxLength 500), and [Cancel] [Confirm reject].

**Modal — Export** (`ExportModal`): title "Withdrawals", subtitle "Choose a time frame, then download CSV or print PDF.", TIME FRAME select (Today, Yesterday, Last 7 days (default), Last 30 days, This month, All time), meta "up to 50,000 rows", buttons **Download CSV** and **Print / PDF**. See §17.

**Actions**

| Action | Trigger | Confirm | API | Server checks | Backend | Success | Failure | Audit |
|---|---|---|---|---|---|---|---|---|
| Approve | Approve → Confirm approve | Inline ConfirmBox | `POST /api/withdrawals/{id}/approve` | UUID; exists; status ∈ {pending_review, held} (409 otherwise) | 1) RPC `admin_approve_withdrawal(id, admin)`; 2) POST edge fn `resume-withdrawal` with `x-admin-secret` **and `Authorization: Bearer <admin cookie JWT>`**; 3) requires `success` in the response | Panel closes, list reloads | Inline error: "Could not approve" (RPC error; details only in server log), or the gateway's `message` / "Gateway failed" with the edge fn's HTTP status | `APPROVE_WITHDRAWAL` with `gateway_reference`. **Only written if the gateway succeeds.** An approval whose payout failed leaves the RPC-applied state change unaudited |
| Reject | Reject → Confirm reject | Inline ConfirmBox + reason required (client) | `POST /api/withdrawals/{id}/reject` `{reason}` | UUID; exists; status ∈ {pending_review, held, **initiated**}; reason truncated to 500 (**empty reason is allowed server-side**) | RPC `admin_reject_withdrawal(id, admin, reason)` (refund inside the RPC, outside this repo) | Close + reload | Inline "Could not reject" | `REJECT_WITHDRAWAL {reason}` |
| Export CSV/PDF | Export modal | none | `GET /api/withdrawals?csv=1` / `pdf=1` (with the current tab status, search, range) | same filters; cap 50,000 | Builds CSV with a formula-injection guard, or returns JSON rows for print | File download / print window | CSV: no `res.ok` check, so an error JSON body is saved as `.csv`. PDF: pop-up blocked → `alert` | `EXPORT_CSV` insert with **`diff`** (not `after_value`) and no `ip_address`; the insert error is ignored |

**States:**
* Loading skeleton.
* Empty "No withdrawals".
* Populated.
* Busy buttons.
* Inline error in the panel.
* List fetch errors are silent.
* **The detail's perpetual skeleton** if `detail.user` is null. This can happen legitimately if the user row was deleted.

**Responsive:**
* `WithdrawalsMobile` cards show the amount (large mono), @user, status, "bank · account number · datetime", and Approve/Reject buttons.
* The card left-border highlight for `w.flag` is **dead code**: the list rows don't include `flag`.
* The export modal fits (max-width 100%).

**Issues:**
* `initiated` has no tab, yet the Dashboard "Pending withdrawals" KPI counts `initiated` (not `pending_review`/`held`). The dashboard number doesn't match the "Review" queue.
* The search placeholder promises account search.
* No pagination: only the latest 100 rows per tab are reachable. The UI asks for 200, but the server clamps it to 100.
* The local StatusDot/StatStrip duplicate the shared ones.
* Flag review isn't actionable.
* The admin JWT is forwarded to the edge function.

---

### 7.6 Transactions — `/transactions-overview`

**Identity**

| | |
|---|---|
| File | `transactions-overview/page.tsx` (299) |
| Nav | Operations › Transactions |
| Purpose | Read-only ledger browser across all money movements + export |
| Access | `transactions_overview` |

**Layout:**
1. PageHeader "Transactions" — "Full audit-log view of every money movement on the platform." with **Export**.
2. **StatStrip**:
   * Total transactions;
   * Total volume (₦ mono);
   * Today transactions;
   * Today volume.
   * These come from RPC `admin_transactions_stats`, are unfiltered, and ignore the active filters.
3. Filter bar (wraps):
   * Search user (min 200 / max 240);
   * Type group Select;
   * Status Select;
   * date From and date To;
   * **Apply** (primary, Filter icon) and **Clear** (ghost, X icon).
4. Table / mobile cards.
5. Pagination.
6. ExportModal.

**Filters**

| Filter | Options / behavior |
|---|---|
| Search | user full_name / username / email `ilike` (sanitized) → `user_id IN (...)`. No match → empty result + stats |
| Type | "All types" · Giftcards (`giftcard_credit`) · Withdrawals (`withdrawal,withdrawal_refund`) · Bills (`airtime,data,cable,electricity`) · Bonuses (`signup_bonus,giftbox_bonus,referral_bonus,bonus_redeem,level_bonus`). Sent as CSV → `in()` |
| Status | All statuses · pending · pending review · success · failed (no `refunded`, `processing`, …) |
| From / To | `created_at >= from`, `<= to + 'T23:59:59.999Z'`. The "to" boundary is UTC end of day |
| Apply | Copies the draft into `applied` and resets page 1. Filters are **not** applied live |
| Clear | Resets draft + applied, page 1 |

**Table — transactions (desktop)**

| # | Column | Source | Format | Link |
|---|---|---|---|---|
| 1 | User | `users.username` | `@x` | **Link → `/users/{user_id}`** (the only cross-page drill-down in the admin) |
| 2 | Type | `type` | mono chip, underscores → spaces | — |
| 3 | Amount | `amount` | ₦ right mono | — |
| 4 | Status | `status` | shared StatusDot tones | — |
| 5 | Reference | `reference_id` | mono muted, ellipsis max 160px | — |
| 6 | Date | `created_at` | locale datetime, mono | — |

* Server pagination: page size **25** fixed; "Previous" / "PAGE x / y · N RESULTS" / "Next". Shown only if more than 1 page. No page-size selector, sorting, row click, detail view or metadata display.
* Empty "No transactions found"; loading TableSkeleton (6 cols).

**Export:** CSV columns `ID, User, Email, Type, Amount, Status, Reference, Date`; PDF via `printTable`. The export uses the **applied** filters, but the modal's time frame **overrides** the applied date range, except "All time", which keeps the applied dates. Audited as `EXPORT_CSV` with `diff` and `entity_id null`.

**States:**
* Loading on every page/filter change.
* Silent fetch errors.
* The stats remain the global totals even when filtered, which is confusing.

**Responsive:** mobile cards (amount, status, @user, type chip, reference · date). No link to the user on mobile. Pagination shared.

**Issues:** no transaction detail (metadata hidden); the search user-list lookup is unbounded (a large `in()` list); status options incomplete; stats don't reflect filters; the date semantics mix browser-local dates and a UTC end-of-day.

---

### 7.7 Users — `/users`

**Identity**

| | |
|---|---|
| File | `users/page.tsx` (264) |
| Nav | People › Users |
| Purpose | Browse and search registered customers; export; go to profile |
| Access | `users` |

**Layout:**
1. PageHeader "Users" — "Browse every registered customer, jump into individual profiles." with **Export**.
2. StatStrip: "Total users" = the `total` count of the current search (not all users).
3. Search input with a leading Search icon (max 360px), "Search name, username, or email".
4. Table / mobile list.
5. Pagination "PAGE x / y".
6. ExportModal.

**Data:**
* `GET /api/users?search&page&limit=25` → `users` (`id, full_name, username, email, phone, country, is_active, is_frozen, freeze_reason, created_at, avatar_path, wallets(balance)`), ordered by created_at desc with an exact count.
* Per page, the API also:
  * counts `transactions` rows per user (all types, labelled "Trades") via `select user_id in (…)`, without a count aggregate;
  * creates signed avatar URLs (bucket `avatars`, 1 h, batch).

**Table — users (desktop)**

| # | Column | Source | Format |
|---|---|---|---|
| 1 | User (**sticky left**) | avatar_url / full_name / username | 28px round avatar (or initial), name + `@username` (ellipsis, max 220px) |
| 2 | Email | email | secondary |
| 3 | Phone | phone | secondary |
| 4 | Balance | wallets.balance | ₦ right mono |
| 5 | Trades | count of `transactions` rows (**any type**, not only trades) | right mono |
| 6 | Status | is_frozen → "Frozen" (danger); else is_active → "Active"; else "Inactive" | StatusDot |
| 7 | Joined | created_at | locale date, mono |
| 8 | Actions | — | **View** → `/users/{id}` |

No sorting, no filters (the API supports `date_from`/`date_to`, but only export uses them), no status filter, no bulk actions. Page size 25.

**Search behavior:**
* Live on every keystroke. `useEffect([search])` sets page 1 and loads; `useEffect([page])` also loads, causing **double fetches and possible out-of-order responses** (no abort or debounce).
* Server-side `or(full_name.ilike, username.ilike, email.ilike)` with sanitized input. Phone is **not** searchable.

**Export:** CSV columns `ID, Name, Username, Email, Phone, Balance, Trades, Joined, Status` (up to 50,000 rows; the Trades count comes from RPC `count_user_transactions`). The PDF formats balance and date on the client. Audited `EXPORT_CSV` with `{rows, search, cap}` (both CSV and PDF).

**Responsive:** mobile list of link cards (avatar, name, @username, status, balance, "N trades · joined date").

**Issues:**
* "Trades" is mislabeled (it counts all transactions).
* The per-page trade count uses a row fetch, which is subject to row caps.
* No filter by status/country/date in the UI.
* No quick actions from the list.
* Double fetch.

---

### 7.8 User detail — `/users/[id]`

**Identity**

| | |
|---|---|
| File | `users/[id]/page.tsx` (264) |
| Nav | none (reached from Users / Transactions); breadcrumb "People / Users" |
| Purpose | Single customer profile: identity, balance, stats, recent transactions, devices, login history; freeze/unfreeze |
| Access | View: `users`. Freeze/unfreeze: **SA or `users_freeze`** (API only). The buttons are shown to everyone |

**Layout:**
1. "← BACK TO USERS" (plain `<a href="/users">`).
2. Profile Card:
   * 48px initial avatar (the avatar image is **not** shown here);
   * name and @username;
   * right side: status/actions.
   * Freeze-reason banner if frozen.
   * Info rows: Email, Phone, Country, **Balance** (bold mono), Referral code (mono), Joined.
3. StatStrip: Trades (count of all transactions), Withdrawals (count).
4. Underline Tabs: Recent transactions · Device logs · Login history.
5. The tab's table.
6. Freeze Modal.

**Header actions (state machine):**

| User state | Shown |
|---|---|
| `deleted_at` set | StatusDot "Deletion in progress" (danger); **no actions** |
| `is_frozen` | StatusDot "Frozen" + **Unfreeze** (success sm; "Unfreezing…") |
| otherwise | **Freeze account** (dangerSubtle sm) → modal |

**Tables**

| Tab | Columns | Source | Limit | Empty |
|---|---|---|---|---|
| Recent transactions | Type (chip) · Amount (₦) · Status · Date | `transactions` by user, desc | 10 | "No transactions" |
| Device logs | Device · OS · App version · IP address (mono) · First seen (`created_at`) · Last seen · Logins (`login_count ?? 1`) | `device_logs` desc | 20 | "No device logs" |
| Login history | Device · OS · App version · IP address · Date | `login_history` desc | 20 | "No login history" |

No pagination, links or filters. `metadata` is fetched but not displayed.

**Modal — Freeze account** (size sm):
* Text "Freezing **@user** will block all transactions and withdrawals."
* A REASON label and a Textarea (3 rows, "Why is this account being frozen?").
* Inline error text.
* Footer: [Cancel] [Freeze account (danger, loading)].

**Actions**

| Action | Confirm | API | Server validation | Backend | Success | Failure | Audit |
|---|---|---|---|---|---|---|---|
| Freeze | Modal + reason (client: required) | `PATCH /api/users/{id}` `{action:'freeze', reason}` | SA or `users_freeze` (403); UUID; user exists (404); **not in deletion (409)**; reason 1–500 chars | `users.is_frozen=true, freeze_reason` (update error not checked) | Modal closes, reload | Inline modal error (e.g. "Forbidden" for admins without `users_freeze`) | `FREEZE_USER` with before/after |
| Unfreeze | **None** | `PATCH {action:'unfreeze'}` | same guards | `is_frozen=false, freeze_reason=null` | Reload | **Error ignored**: the response isn't checked and the page just reloads unchanged | `UNFREEZE_USER` |

**States:**
* Loading: skeleton cards.
* Not found / any fetch failure: plain text "User not found". A 403 also shows this.
* The frozen banner.

**Responsive:** header row flex without wrap. Long names plus actions can squeeze on phones. Tables scroll horizontally.

**Issues:**
* No wallet adjustment, edit profile, delete/anonymize, PIN/2FA reset, notes, session termination (only on the Activity Log page), or links to the user's withdrawals/card submissions/referrals.
* Avatar not shown.
* Freeze shown to unauthorized admins.
* Unfreeze has no confirmation or error handling.

---

### 7.9 Activity Log (User Activity Monitor) — `/user-activity-monitor`

**Identity**

| | |
|---|---|
| File | `user-activity-monitor/page.tsx` (315) |
| Nav | People › **Activity Log** (page title "User activity monitor") |
| Purpose | Presence-oriented user list (online in the last 90 s), per-user session/transaction/withdrawal activity, force logout |
| Access | UI key `user_activity_monitor`; **all three APIs are super-admin only**. Delegated admins get the red banner "Forbidden (super-admin only)" and an empty list |

**Layout:**
1. PageHeader "User activity monitor". The subtitle is a live pill: green dot + "LIVE · N ONLINE · AUTO-REFRESH 30s".
2. StatStrip: "Online now", "Total users" (count for the current filters).
3. Error banner (page-level, hidden while the panel is open).
4. Toolbar: search Input (Enter applies), **Toggle "Online only"**, and **Apply** (primary).
5. Table / mobile cards.
6. Pagination.
7. SidePanel "Activity detail".

**Data:**
* `GET /api/user-activity-monitor?search&online=1&page&limit=25`:
  * users `id, username, full_name, email, phone, last_active_at, is_frozen, is_active, created_at`;
  * ordered by `last_active_at desc nulls last`;
  * `is_online` = last active within **90 s**;
  * `online_count` = total online.
* Refresh every **30 s** (a non-silent load, so the skeleton appears only when the list is empty).
* Detail `GET /api/user-activity-monitor/{id}`:
  * user;
  * `login_history` (30: `session_id, ip, device_model, os_version, app_version, device_fingerprint, created_at, ended_at`);
  * `transactions` (30);
  * `withdrawals` (20).

**Table (desktop)**

| # | Column | Format |
|---|---|---|
| 1 | User | green pulse dot if online (grey otherwise) + `@username` |
| 2 | Email | secondary |
| 3 | Last active | relative time ("12s ago", "5m ago", "3h ago", "2d ago") |
| 4 | Status | Frozen (danger) > Online (success) > Offline (neutral) |
| 5 | (chevron) | "›" |

Rows are interactive (click opens the panel); the selected row is highlighted.

**Side panel — Activity detail:**
* Header: initial avatar, @username, "email · phone", presence dot.
* **Terminate all sessions** (danger, full width).
* Error banner.
* **Sessions · N**: each row shows the start datetime and "Active" (success) or "Ended Xm ago", plus "device · os · app · IP".
* **Recent withdrawals**: MoneyRow (₦ amount, "bank · account name", status, relative time).
* **Recent transactions**: MoneyRow (₦, type, status, relative time).
* `device_fingerprint` and `session_id` are fetched but not shown.

**Actions**

| Action | Confirm | API | Backend | Success | Failure | Audit |
|---|---|---|---|---|---|---|
| Terminate all sessions | **native `confirm()`** "Force log out @x? All active sessions will be revoked." | `POST /api/user-activity-monitor/{id}/terminate` | RPC `terminate_user_sessions(p_user_id, p_admin_id)` | Detail reloads + list reloads (no toast) | Panel banner "Could not terminate sessions" | `TERMINATE_USER_SESSIONS` |
| Search / Online-only / page | Enter or Apply / toggle / pager | GET list | — | — | Silent (403 → banner) | — |

**States:**
* A detail load failure sets `err`, but the panel keeps showing its skeleton (DetailBody renders the skeleton when `!detail.user`), and the page-level banner is hidden while the panel is open. **The error is invisible.**

**Responsive:** mobile cards (dot, @user, presence, email, relative time).

**Issues:**
* Nav label, page title and permission name disagree ("Activity Log" vs "User activity monitor" vs `user_activity_monitor`).
* The online window is 90 s here vs **5 min** for the dashboard "Users online" KPI.
* Delegation is broken.
* Duplicates part of the User detail page.
* Uses `confirm()`.

---

### 7.10 Admin Activity — `/activity`

**Identity**

| | |
|---|---|
| File | `activity/page.tsx` (682) |
| Nav | People › Admin Activity |
| Purpose | Browse the admin audit log grouped by day; inspect before/after JSON; export |
| Access | `activity` (UI and API). The API passes `p_caller_admin_id` to RPC `list_admin_activity`; whether that RPC narrows visibility for non-super admins is **outside this repo** |

**Layout:**
1. PageHeader "Admin Activity" — "Audit log of every admin action across the platform." with **Export** (secondary) and **Refresh** (secondary).
2. StatStrip: "Actions in view" (row count), "Days" (group count).
3. Admin filter **Select** (min 260px): "All admins" plus one option per admin, `@username` with a "(deleted admin)" suffix.
4. Error text line.
5. Day-grouped table / mobile cards.
6. Entry detail Modal (lg).
7. Export Modal (custom).

**Data:**
* `GET /api/activity?limit=150[&admin_filter=<id>]` returns:
  * `activity`: RPC rows `id, admin_id, admin_username, admin_role_title, admin_is_super, action, entity, entity_id, ip_address, created_at, before_value, after_value, target_username, target_label`;
  * `admins`: `id, username, role_title, is_super_admin, is_active, last_login_at, deleted_at`, ordered by username.
* The client groups rows by **browser-local** day, labelled "Today", "Yesterday", "Mon, Sep 29" or "Sep 29, 2025".
* No auto-refresh (manual Refresh). **Hard limit 150 rows. No "load more"** (the API supports a `before` cursor, but it is not used for the view).

**Table — activity (desktop)**
* Day header rows: uppercase day label and a count.
* Rows:

| # | Column | Format |
|---|---|---|
| 1 | Admin | `@username`, a red "(deleted admin)" tag, and a **SUPER** warning Badge for super admins |
| 2 | Action | StatusDot with a humanized label (`ACTION_LABEL` map or auto title-case). Tone by prefix: APPROVE/OVERTURN/REACTIVATE/UNFREEZE = success; REJECT/UPHOLD/FREEZE/DEACTIVATE/DELETE/REVOKE/TERMINATE/REFUND/ESCALATE = danger; CREATE/GRANT/ADD/BROADCAST/CLEAR = info; else neutral |
| 3 | Target | `target_label`, else the humanized `entity`, plus "· @target_username" |
| 4 | When | relative time under 24 h, else locale datetime |
| 5 | Detail | **View** → modal |

No search, no action/entity/date filters in the view, no pagination.

**Modal — activity entry** (lg):
* Header: action dot, "· target_label", "for @target".
* Sections (DetailGrid cards):
  * **WHO**: Admin (+deleted), Role, Super-admin Yes/No.
  * **WHEN**: Time, Relative.
  * **TARGET**: Entity, Entity ID (mono), User, IP address (mono).
  * **CHANGES**: BEFORE and AFTER pretty JSON (`<pre>`, max-height 280, scroll).
  * **RAW**: Audit ID, Action key.

**Modal — Export activity** (a custom duplicate of `ExportModal`): TIME FRAME select (same six options, default Last 7 days), the meta "All admins | @x · up to 5,000 rows", **Download CSV** and **Print / PDF**.
* CSV: `GET /api/activity?format=csv&after&before&limit=5000[&admin_filter]`. Columns: `created_at, admin_username, admin_role_title, admin_is_super, action, entity, entity_id, target_username, target_label, ip_address, before_value, after_value, id` (JSON cells stringified; formula-injection prefixing).
* PDF: fetches JSON (the same query, `format=json`) and builds a print HTML grouped by day, with columns Time · Admin · Action · Target · IP. Opens `window.print()`.
* Date bounds use browser-local midnight (`rangeBounds`, `activity/page.tsx:13-36`). This differs from `lib/printExport.rangeToDates`, which returns `YYYY-MM-DD` strings.
* **The export itself is not audited.**

**Actions:** Refresh · filter by admin · View entry · Export CSV · Print/PDF. There are no mutations (audit rows cannot be edited or deleted from the admin).

**States:**
* Loading skeleton (first load only).
* Empty "No activity in this window." (**misleading**: there is no time window in the view).
* 403 → "You do not have permission to view the activity log."
* Other errors → the server error text.
* Export errors → `alert`.

**Responsive:** mobile groups with card buttons (admin + SUPER, action dot, target, relative time).

**Issues:**
* The label map has stale/mismatched keys (§19.3).
* Includes noisy entries (LOGIN, LOGOUT, UPDATE_ADMIN_THEME).
* `LOGIN_FAILED` rows are attributed to the *targeted* admin (`admin_id` = the account being attacked), so they look like actions that admin performed.
* No filtering by action, entity, target or date; 150-row cap.

---

### 7.11 Admins — `/admin-accounts`

**Identity**

| | |
|---|---|
| File | `admin-accounts/page.tsx` (439) |
| Nav | People › **Admins** (page title "Admin Accounts") |
| Purpose | Provision admins, scope their pages, deactivate/reactivate, soft-delete |
| Access | UI key `admin_accounts`, **which cannot be assigned from this page's checklist**. **The API is super-admin only** for all methods. A non-super admin with the key sees an empty table ("No admin accounts yet") because a 403 silently stops loading |

**Layout:**
1. PageHeader "Admin Accounts" — "Provision console operators, scope their page access, and revoke when needed." with **+ Create Admin** (primary).
2. StatStrip: Total accounts (including deleted), Active (active and not deleted).
3. Table / mobile cards.
4. SidePanel form (create/edit).
5. Delete Modal.

**Table — admins**

| # | Column | Source | Format |
|---|---|---|---|
| 1 | Username | username | primary; red "(deleted admin)" if `deleted_at` |
| 2 | Email | email | secondary; **red "— (no alerts)" when null** |
| 3 | Role Title | role_title | text |
| 4 | Assigned Pages | page_permissions | up to 3 labels, then "..." (max 200px) |
| 5 | Last Login | last_login_at | locale date or "Never" |
| 6 | Status | is_active | Active (success) / Inactive (neutral). *Deleted admins show Inactive* |
| 7 | Actions | — | Super admins and deleted admins show "—". Others: **Edit** (ghost), **Deactivate/Reactivate** (secondary), and **Delete** (dangerSubtle) only when inactive |

Ordering: `created_at asc` (server). No search, filter or pagination.

**Side panel form — Create / Edit Admin Account**

| Field | Type | Create | Edit | Client validation | Server validation |
|---|---|---|---|---|---|
| Username | text | required | **disabled** (immutable) | non-empty | 3–32 chars (create); unique (error "Username already taken") |
| Email "(receives security alerts)" | email | required | optional (**blank → saved as `null`**, which makes login impossible because login requires email) | email regex if non-empty | regex; `null` allowed on PATCH |
| Password "(leave blank to keep)" on edit | password + eye toggle | required | optional | must match Confirm | ≥12, ≤128, lower + upper + digit + symbol |
| Confirm Password | password + eye toggle | — | — | equals Password | — |
| Role Title | text ("e.g. Card Reviewer") | required | required | non-empty | 2–64 chars |
| Assigned Pages | 22 custom checkboxes (div-based, **not keyboard accessible**) | ≥1 | ≥1 | at least one | every key must be in `ALLOWED_PERMISSIONS` (29 keys) |

* Footer: a full-width primary **"Create Account" / "Save Changes"** ("Saving..."). Errors show inline in red above the footer.
* **Assignable pages in the UI (22):** dashboard, card_queue, card_management, card_type_builder, rates_management, withdrawals, users, transactions_overview, bonuses_rewards, referral_management, coupons, notifications_broadcast, notification_templates, email_templates, platform_balance, activity, limits_fees, admin_settings, bill_settings, anomaly_alerts, security_limits, user_activity_monitor.
* **Accepted by the API but not assignable in the UI (7):** `admin_accounts`, `manual_wallet_credit`, `field_builder`, `feature_overrides`, `flagged_transactions`, `giftbox`, `users_freeze` (`api/admin-accounts/route.ts:23-31`). Of these, only `users_freeze` is actually checked by any endpoint.

**Modal — Delete Admin Account** (sm): subtitle "This action cannot be undone. Type **DELETE** to confirm."; an Input; [Cancel] and [Delete] (danger, disabled until the input is exactly `DELETE`); inline server error.

**Actions**

| Action | Confirm | API | Server rules | DB effect | Audit | UI feedback |
|---|---|---|---|---|---|---|
| Create | none | POST | SA; required fields; formats; permission allow-list | insert `admin_users` (`is_super_admin=false, is_active=true`, bcrypt(12)) | `CREATE_ADMIN` (redacted) | panel closes; silent reload |
| Edit | none | PATCH `{id, username(ignored), email, password?, role_title, page_permissions}` | SA; not deleted; validations. **If the id doesn't exist, it still returns success** | update fields; **bumps `token_version`** if password, permissions or role changed (forces re-login) | `EDIT_ADMIN` with before/after (+`token_version_bumped`) | panel closes |
| Deactivate | **none** | PATCH `{id, is_active:false}` | not self; not the last active super admin (UI never offers it for super admins anyway) | `is_active=false` (existing sessions fail immediately because `verifyAdminJWT` requires active) | `DEACTIVATE_ADMIN` | **response ignored**; list reloads |
| Reactivate | none | PATCH `{id, is_active:true}` | not deleted | `is_active=true` | `REACTIVATE_ADMIN` | response ignored |
| Delete (soft) | type DELETE | DELETE `{id}` | SA; target must be non-super **and inactive** | `deleted_at=now, is_active=false` | `DELETE_ADMIN` (before=`{username,is_active,is_super_admin}`) | modal closes; errors inline |
| Revoke sessions | — | PATCH `{id, revoke_sessions:true}` | not self | bump `token_version` | `REVOKE_ADMIN_SESSIONS` | **No UI (backend-only)** |

**States:**
* Loading skeleton.
* Empty "No admin accounts yet" (**also shown on 403**).
* Saving.
* Inline form error.
* Delete error.

**Responsive:** mobile cards with the same data and actions.

**Issues:**
* Super admins can't be edited from the UI, including their **own password**. There is no self-service password change.
* No super-admin promotion or creation.
* No session list or revoke button.
* No last-login IP.
* No confirmation on deactivate.
* Errors on toggles are swallowed.
* Deleted admins can't be restored, and their usernames stay taken (unique).
* The custom checkboxes are inaccessible.
* Email can be blanked on edit, which locks the admin out.

---

### 7.12 Cards (Card & Country Management) — `/cards`

**Identity**

| | |
|---|---|
| File | `cards/page.tsx` (689; ~217-entry `ISO_COUNTRIES` list embedded) |
| Nav | Catalog › **Cards** (title "Card & Country Management") |
| Purpose | Manage gift-card brands (name, logo, active), and the countries/currencies each brand is available in |
| Access | `card_management` |

**Layout:**
1. PageHeader with **Add Card Brand** (primary, Plus).
2. StatStrip: Total brands, Active.
3. Table / mobile cards.
4. Brand Modal.
5. Countries SidePanel.

**Data:** `GET /api/cards` returns cards (`id, name, logo_url, is_active, sort_order, created_at`) ordered by `sort_order`. **Each card's countries are fetched in a separate query (N+1)** and include `id, country_code, country_name, currency_symbol, is_active`.

**Table — brands**

| # | Column | Format |
|---|---|---|
| 1 | Logo | 32px contain image, or a grey square |
| 2 | Card Name | primary |
| 3 | Countries | "N (A, B...)" (first 2 names) |
| 4 | Status | Active / Inactive |
| 5 | Sort Order | mono number (read-only) |
| 6 | Actions | **Edit**, **Countries**, **Deactivate/Activate**, and a **"⠿" drag handle that is non-functional** (no drag logic; `cursor: grab` only) |

**Modal — Add/Edit Card Brand:**

| Field | Type | Validation (client / server) |
|---|---|---|
| Card name | text | required / trimmed 1–80 |
| Logo | click-to-upload tile (100×100, dashed); hidden `<input type=file accept="image/*">` | server: extension png/jpg/jpeg/webp; ≤5 MB; magic bytes must match; uploaded to public bucket `card-logos` as `<uuid>.<ext>`; returns the public URL |
| Active | Toggle | — |

* The upload shows "Uploading..." inside the tile. **Upload errors are ignored** (no message; the preview doesn't change).
* The logo URL must be `https://` and ≤500 chars (server).
* Save: POST/PATCH `{type:'card', …}`. Errors show inline in red. `sort_order` is not editable (it defaults to 0 on create).

**Side panel — "&lt;Brand&gt; — Countries":**
* A list of the brand's countries: flag emoji + name, "(symbol)", an active **Toggle**, and **Remove** (dangerSubtle). **No confirmation; errors ignored.**
* "+ ADD COUNTRY" form:
  * **Country** combobox: a searchable dropdown of ~217 ISO countries, matching name, code or currency. `mousedown` selects and **auto-fills** the symbol and currency.
  * **Currency symbol** (maxLength 5 client; server ≤8).
  * **Currency name** (e.g. USD). **Required by the button's disabled logic but never sent to the API or stored** (UI-only field).
  * **Active** toggle.
  * **Add Country** (primary; a ref lock prevents double submits).
* Server: `country_code` must match `^[A-Z]{2,3}$`; name 1–80; symbol 1–8. A duplicate returns **409 "This country is already on this card."**, but the **UI ignores the response**, so nothing is shown.

**Actions & audit**

| Action | API | Audit |
|---|---|---|
| Create brand | POST `{type:'card'}` | `CREATE_CARD` |
| Edit brand / toggle active | PATCH `{type:'card', id, …}` (the toggle ignores errors) | `UPDATE_CARD` (before = full row) |
| Upload logo | POST `/api/cards/upload` | **not audited** (the URL is audited on save) |
| Add country | POST `{type:'country'}` | `ADD_CARD_COUNTRY` |
| Toggle country | PATCH `{type:'country', id, is_active}` | `UPDATE_CARD_COUNTRY` |
| Remove country (**hard delete**) | DELETE `{type:'country', id}` | `REMOVE_CARD_COUNTRY` (before snapshot) |
| Reorder brands | PATCH `{type:'reorder', ids[]}` (≤200) | `REORDER_CARDS`. **No UI (the drag handle is fake)** |
| Delete brand | — | **Missing** (no API) |

**Issues:**
* Removing a country has no confirmation or impact warning (card types for that country still exist in `card_types`, with denominations and submissions; the effect on the app is outside this repo).
* Currency name is not persisted.
* Errors are silent.
* N+1 queries.
* Deactivating a brand has no confirmation.

---

### 7.13 Field Builder — `/field-builder`

**Identity**

| | |
|---|---|
| File | `field-builder/page.tsx` (478) |
| Nav | Catalog › Field Builder |
| Purpose | Per brand: define card-type **templates** (e.g. "E-code", "Physical") with input fields (text/image/image+text, required flag), then **install** a template into countries (creating per-country `card_types` with copied fields) and toggle each country install |
| Access | UI key `card_type_builder`; API `card_type_builder`. **But the brand list comes from `GET /api/cards`, which requires `card_management`.** Without it the page shows "No cards yet" and is unusable |

**Layout:** a two-column flex (wraps).
* **Left:** Card "Card Brands" (220px): a button list with logo and name; the active item has an accent left border.
* **Right** (min 320px):
  * before selection: "Select a card brand to manage its card types."
  * after selection: header Card "&lt;Brand&gt; — Card Types" ("Create a card type once (with its fields), then add it to each country below.") with **Add Card Type**. When adding, an inline Input "Card type name (e.g. E-code)" with [Save] [Cancel].
  * a loading skeleton card;
  * one Card per template:
    * header row: name, "N countries" (active installs), active **Toggle**, ✏ edit (inline rename with Save/Cancel), 🗑 delete (modal), and ⌄/⌃ expand.
    * expanded body:
      * **COUNTRIES:** pill buttons for installed countries. Green "● name" = active, grey "○ name" = disabled; clicking toggles it. The pill's `busyCountry` guard compares against the card-type id.
      * "Add to:" secondary buttons "+ &lt;country&gt;" for the brand's active countries not yet installed.
      * **FIELDS:** rows of label + input-type Badge (info) + Required/Optional Badge (danger/neutral) + ✏ (inline edit form) + 🗑 (**immediate delete, no confirmation**).
      * "+ Add Field" opens the inline **FieldForm**.
  * Empty: "No card types yet. Add one above."

**FieldForm (inline):**

| Field | Control | Values | Validation |
|---|---|---|---|
| Field label | Input | text | non-empty (client). The server requires a label on create; update trims |
| Input type | 3 toggle buttons | `text` "Text", `image` "Image Upload", `image_text` "Image + Text" | **no server validation of `input_type`** |
| Required | Toggle | bool | default true |

Buttons: Save ("Saving..."), Cancel.

**Modal — Delete Card Type** (sm): "This deletes the card type and its fields. Countries already added keep working (they just unlink from this template). This cannot be undone." with [Cancel] [Delete].

**Backend semantics** (`api/field-builder/route.ts`):
* `GET ?card_id=` returns the templates (sorted), each with `fields` (template fields) and `countries` (the `card_types` rows with this `template_id`), plus the brand's **active** `card_countries`.
* **Install** (`POST type:'add_country'`):
  * if a `card_types` row exists for (card, country, template) and is inactive, it is reactivated (`REACTIVATE_CARD_TYPE_COUNTRY`);
  * otherwise a `card_types` row is inserted (name and sort from the template) and **all current template fields are copied** into `card_type_fields` (`ADD_CARD_TYPE_TO_COUNTRY`).
* **Rename template:** updates the template **and** the `name` of every installed `card_types`.
* **Edit/add/delete template fields:** changes **only** `card_type_template_fields`. **Existing installs keep the fields copied at install time.** The UI gives no hint of this, so edits appear to apply but don't affect countries already installed (unless a DB trigger syncs them; none is visible in this repo).
* **Delete template:** unlinks the installs (`template_id=null`), deletes the template fields, then deletes the template. This is not transactional.
* Toggle template `is_active` affects the template only. Toggle country updates `card_types.is_active`.
* `PATCH type:'reorder_fields'` exists; **no UI**.
* PATCH/DELETE ignore DB errors and always return success. Only some POSTs check errors.

**Audit:** `CREATE_CARD_TYPE_TEMPLATE`, `CREATE_TEMPLATE_FIELD`, `ADD_CARD_TYPE_TO_COUNTRY`, `REACTIVATE_CARD_TYPE_COUNTRY`, `UPDATE_CARD_TYPE_TEMPLATE`, `UPDATE_TEMPLATE_FIELD`, `REORDER_TEMPLATE_FIELDS`, `SET_CARD_TYPE_COUNTRY_ACTIVE`, `DELETE_CARD_TYPE_TEMPLATE`, `DELETE_TEMPLATE_FIELD`.

**States:**
* The brand list has no loading state.
* A template loading skeleton.
* Empty states as above.
* **All mutation errors are ignored.** Every handler awaits the fetch and then refreshes.

**Responsive:** the columns wrap. The brand list becomes full-row on narrow screens, but its fixed 220px width doesn't stretch. No mobile-specific view.

**Issues:**
* Cross-permission dependency.
* The template-to-install sync gap.
* No field reorder UI.
* Delete field without confirmation.
* No per-country field view (the actual `card_type_fields` that users see aren't displayed).
* No way to remove an install (only disable it).
* Uninstalled countries only show if the brand's `card_countries` row is active.

---

### 7.14 Rates — `/rates`

**Identity**

| | |
|---|---|
| File | `rates/page.tsx` (307) |
| Nav | Catalog › Rates |
| Purpose | Set Naira buy rates per denomination range, per card type, per country, per brand; activate/deactivate ranges; add ranges |
| Access | `rates_management` |

**Layout:**
1. PageHeader "Rates" — "Manage gift-card buy rates by card, country, type and denomination." with **"Save All Changes (N)"** (primary).
2. A single Card containing a 4-level accordion:
   * **Level 1 (brand):** logo, name, "N active rates", chevron.
   * **Level 2 (country):** name + currency badge (subtle background).
   * **Level 3 (card type).**
   * **Level 4 (denomination rows):** `range_label` · **rate Input** (number, mono, 130px) · active **Toggle**; then **"+ Add Range"** (ghost).
3. "Add Denomination Range" Modal.
4. A local toast (bottom-right).

**Data:** `GET /api/rates` returns the **active** cards → **active** countries → **active** card types → **all** denominations (ordered by `min_value`), with `activeRates` per card. **Deep N+1 querying** (one query per card, per country, per type). Inactive brands, countries and types are not shown, so their rates cannot be edited.

**Editing model:**
* Changes are kept in `changes[denomId] = {id, rate_naira, is_active}`.
* The input shows the draft value.
* **Rate parsing:** `parseFloat(value) || 0`. **Clearing the field sets the rate to 0**, and it can be saved.
* Save All:
  1. if nothing changed, shows the toast "No changes to save.";
  2. otherwise sends `PATCH /api/rates {changes:[…]}`. There is **no confirmation and no diff summary**.
  3. The server:
     * snapshots each row (one query per change);
     * validates `rate_naira` finite ≥ 0;
     * updates each row in parallel with `{rate_naira, is_active}`;
     * returns "Some updates failed" if any failed. **Partial updates may already be applied** (not transactional).
     * audit `BATCH_UPDATE_RATES` with the before map and the changes.
* Toasts: "All changes saved ✓" / "Failed to save changes."
* **No unsaved-changes warning** on navigation. Collapsing a section keeps its draft.

**Modal — Add Denomination Range** (sm):

| Field | Type | Client | Server |
|---|---|---|---|
| Range Label | text ("e.g. $25–$99") | required | none (any value, including empty) |
| Min Value | number | required | finite ≥ 0; ≤ max |
| Max Value | number | required | finite ≥ 0 |
| Rate in Naira (per unit) | number | required | finite ≥ 0 |
| Active | Toggle | — | — |

On Save it POSTs. **The response isn't checked**: validation errors like min > max are silently lost, the modal closes and the data reloads. Audit `CREATE_DENOMINATION`. There is no overlap check between ranges.

**Missing:** editing a range's label/min/max; deleting a range; bulk % adjustment; rate history; effective-dating; search/filter.

**Responsive:** there is no mobile variant. The nested indentation (up to 64px), a 130px input and a toggle fit a ≥360px screen but are cramped. The local toast uses `color: var(--bg-base)`, **a token that doesn't exist** (it falls back to inherited text color on a `--fg-primary` background, making the text low-contrast).

---

### 7.15 Bonuses & Rewards — `/bonuses-rewards`

**Identity**

| | |
|---|---|
| File | `bonuses-rewards/page.tsx` (512; includes a private RuleBuilder copy) |
| Nav | Rewards › **Bonuses** |
| Purpose | Toggle levels program, configure signup bonus, manage giftbox reward items with rule-based eligibility |
| Access | UI key `bonuses_rewards`. Stats (`/api/bonuses`) and giftbox (`/api/giftbox`) need `bonuses_rewards`. **Config read/write uses `/api/app-config` (super admin only).** For delegated admins the toggles show OFF and the amounts are blank, and saving shows "Failed to save settings." |

**Layout:**
1. PageHeader with **"Save All Bonus Settings (N)"** (primary).
2. A 2-column grid (1 column on mobile) with three cards:
   * **Levels** (the whole card is a link to `/bonuses-rewards/levels`): header Toggle `levels_active` (click-isolated); "Tiers" = `level_tier_count` (fallback **6**); "Claims today"; "Configure tiers & badges →".
   * **Signup Bonus:**
     * header Toggle `signup_bonus_active`;
     * Amount (₦) number input (`signup_bonus_amount`);
     * **Condition** Select (`signup_bonus_condition`): `click_activate` "Click Activate" · `first_trade` "First Trade" · `first_withdrawal` "First Withdrawal";
     * the footer text "Awarded today: N · Total: N".
   * **Leaderboard** (opacity 0.6): a "Coming Soon" badge and "Leaderboard config will be exposed in a later phase." **Placeholder.**
3. Card "Giftbox Items" with **+ Add Item** and a table/mobile list.
4. Item Modal.
5. A local toast.

**Config save:**
* `PATCH /api/app-config {changes: pending}`, keys `levels_active, signup_bonus_active, signup_bonus_amount, signup_bonus_condition`.
* The server allow-lists the keys but **does not validate values** (any string, e.g. a negative amount or an unknown condition).
* It clears `edge_cache_delete('app_config:public')` and audits `UPDATE_APP_CONFIG` with before/after.

**Stats** (`GET /api/bonuses`):
* `level_claims_today` = `user_level_claims.claimed_at ≥ today`;
* `level_tier_count` = active `level_tiers`;
* `signup_awarded_today` and `signup_awarded_total` = counts of `transactions.type='signup_bonus'` (**any status**).
* "Today" is server-local midnight.

**Table — giftbox items**

| # | Column | Format |
|---|---|---|
| 1 | Title | primary |
| 2 | Description | ellipsis 180px, `title` tooltip |
| 3 | Reward | ₦ |
| 4 | Expiry | raw `expiry_date` string, mono |
| 5 | Rules | "N rule(s)" with a tooltip listing the rule types, or "—" |
| 6 | Claims | count of `giftbox_claims` (a row fetch with `in(item_id…)`, subject to row caps) |
| 7 | Status | Active/Inactive |
| 8 | Actions | **Edit**, **Deactivate/Activate** (no confirmation) |

No delete. No claims drill-down.

**Modal — Add/Edit Giftbox Item** (md):

| Field | Type | Client | Server |
|---|---|---|---|
| Title | text | required (toast) | ≤120 |
| Description | textarea | — | ≤1000 |
| Reward (₦) | number | required (toast) | finite, 0–1e8 |
| Expiry Date | date | — | none (null if empty) |
| Display description (shown to user) → `eligibility_condition` | textarea | — | ≤200 |
| Eligibility rules | RuleBuilder | — | array (PATCH slices to 50; **POST does not slice**); rule shapes not validated |
| Active | Toggle | — | bool |

**RuleBuilder** ("ELIGIBILITY RULES (all must pass · empty = no restrictions)"):
* "+ Add Rule" appends `{type:'min_trades', value:1}`. Each row has a type Select, a value control depending on the input kind, and ✕ remove.
* The 27 rule types and their value shapes:

| Rule type | Label | Value shape |
|---|---|---|
| min_trades | Min approved trades | int |
| min_volume_usd | Min lifetime volume ($) | number |
| min_single_trade_usd | Single trade ≥ $X (optional card) | `{amount, card}` |
| trades_in_period | Trades in last N days | `{count, days}` |
| volume_in_period | Volume ($) in last N days | `{amount, days}` |
| min_card_categories | Min distinct card categories | int |
| specific_card_category | Has traded specific card | string |
| min_avg_trade_usd | Min avg trade size ($) | number |
| min_level / exact_level | Min / Exact level (1-6) | int |
| has_claimed_level_bonus | Has claimed any level bonus | none |
| min_account_age_days / max_account_age_days | Min/Max account age (days) | int |
| email_verified / has_set_pin / has_bank_account | flags | none |
| country_in | Country in (comma list) | string[] |
| min_referrals / min_successful_referrals | counts | int |
| max_claims_per_user / cooldown_days | limits | int |
| first_time_claimer | First-time giftbox claimer | none |
| min_balance_naira / min_withdrawn_total | ₦ thresholds | number |
| has_used_coupon | Has used a coupon | none |
| completed_task | Completed N tasks | int |
| consecutive_days_active | Consecutive active days | int |

* Rule evaluation happens outside this repo (presumably an edge function / RPC). Whether every rule type is implemented server-side is **not verifiable here**.
* Save: POST/PATCH `/api/giftbox`, then `bustPromoCache()` (fire-and-forget `POST <SUPABASE_URL>/functions/v1/get-active-promos` with `x-admin-secret`).
* Audit: `CREATE_GIFTBOX_ITEM` (after = the whole body) or `UPDATE_GIFTBOX_ITEM` (before/after).
* Errors: the toast "Failed to save item." (**the server message is discarded**).

**States:**
* A full-page skeleton while the three requests load (a failure of any one shows partial data).
* Empty giftbox "No giftbox items yet."

**Issues:**
* The permission split (config needs SA).
* The Leaderboard placeholder.
* No value validation on the bonus config.
* No delete.
* A duplicated RuleBuilder.
* The expiry shown raw.
* The Levels card nests a Toggle inside a Link (interaction conflict mitigated with `preventDefault`).

---

### 7.16 Levels (Level Tiers) — `/bonuses-rewards/levels`

**Identity**

| | |
|---|---|
| File | `bonuses-rewards/levels/page.tsx` (212) |
| Nav | Rewards › Levels (breadcrumb wrongly shows "Bonuses") |
| Purpose | Edit the 6 fixed level tiers: name, USD target, Naira bonus, active, badge image |
| Access | `bonuses_rewards`. The badge upload endpoint authenticates **by cookie only** (the mobile admin can't upload) |

**Layout:**
* "← Back to Bonuses & Rewards" link.
* PageHeader "Level Tiers" with the long subtitle about six tiers (Newbie → Legend) and the `level-badges` bucket.
* A responsive grid (`auto-fill minmax(300px, 1fr)`) of tier Cards:
  * header "Tier N" + active Toggle;
  * badge preview (72px) + "Upload Badge"/"Replace Badge" (secondary) + the hint "SVG, PNG, JPG, or WebP";
  * Name; Target ($) and Bonus (₦) (number inputs);
  * "CLAIMS n" + Active/Inactive dot;
  * footer: **Save Tier** (primary). It is disabled and labelled "No Changes" until edited.

**Behavior:**
* Edits are kept per tier. Save sends `PATCH /api/levels {id, …changedFields}`.
  * Server: `name` trimmed and sliced to 80 (an empty name is allowed); `target_usd` and `bonus_naira` 0–1e9; `badge_url` https ≤500; `is_active`; sets `updated_at`.
  * Audit `UPDATE_LEVEL_TIER`.
  * Toast "&lt;name&gt; saved ✓" or the server error.
* **Badge upload:**
  1. file pick → `POST /api/levels/upload` (multipart, `tier_order`);
  2. the server validates the extension (png/jpg/jpeg/webp), size ≤5 MB and magic bytes, resizes with `sharp` to ≤320px and WebP q92 (falling back to the original if sharp is unavailable), and uploads to the **public** bucket `level-badges` as `tier-<order>-<uuid>.<ext>`;
  3. then the page **immediately** PATCHes `badge_url`, bypassing the Save Tier button.
  * The UI hint and `accept` attribute include **SVG, which the server rejects** ("File type not allowed").
* No add/delete/reorder of tiers. Tier count and order are fixed by the DB.
* Claims = the count of `user_level_claims` per `tier_order` (a full-table row fetch, subject to row caps).

**States:**
* Skeleton.
* Per-tier saving/uploading spinners.
* Toast.
* No error state for the initial load (an empty grid).

**Issues:** the SVG mismatch; `Number('')` → 0 when a number field is cleared (saved as 0); no validation that targets increase with the tier order; the wrong breadcrumb; double-active nav.

---

### 7.17 Coupons — `/coupons`

**Identity**

| | |
|---|---|
| Files | `coupons/page.tsx` (384), `coupons/TermsOfUseManager.tsx` (106) |
| Nav | Rewards › Coupons |
| Purpose | Create/edit promo codes that add a flat Naira bonus to qualifying card trades; enable/disable; manage a master list of "Terms of Use" strings |
| Access | Coupons API: `coupons`. **The card list (`/api/cards`) needs `card_management`.** Without it the "Type of Card" select is empty and saving fails with "Card type is required.". **The Terms of Use list uses `/api/app-config` (super admin only)** |

**Layout:**
1. PageHeader with **Manage Terms of Use** (a custom pill button, hard-coded light styling) and **+ Create Coupon**.
2. An inline **Create/Edit Coupon** Card that appears above the table (not a modal).
3. Table / mobile cards.
4. A local toast.

**Form — Coupon**

| Field | Control | Default | Client | Server (`api/coupons/route.ts`) |
|---|---|---|---|---|
| Code | text, auto-uppercased | "" | required | trimmed, uppercased, `^[A-Z0-9_-]{3,32}$`. Uniqueness is DB-level (error surfaced as a toast) |
| Min Trade ($) → `min_trade_amount_usd` | number | "" → 0 | — | finite 0–1e7 |
| Expiry Date | date | "" | — | none |
| Type of Card → `type` | Select of **card brand names** (all brands, including inactive) | first card | required | `^[A-Za-z0-9 _\-&()]+$`, 1–80 chars. **Stored as the name string, not an FK** |
| Terms of Use → `terms_of_use` | Select from the master list + "— None —" | "" | — | ≤5000 |
| Bonus (₦ flat) → `bonus_rate_naira` | number | "" → 0 | — | finite 0–1e9 (the field name says "rate" but the UI says "flat") |
| Status | Toggle "Active/Disabled" | Active | — | bool |
| Eligibility (optional) | Select "No restriction (anyone eligible)" or "Has traded &lt;card&gt;" | none | — | becomes `eligibility_rules=[{type:'specific_card_category', value:<card>}]` |

* **Data-loss risk:** on edit, `eligibility_rules` is rebuilt from this single select and **overwrites any other rules** that exist on the coupon (the API supports up to 50).
* Footer: Cancel / **Save Coupon**. Success toast "Coupon created ✓" / "Coupon updated ✓". Errors toast the server message.
* Audit `CREATE_COUPON` (after = body) or `UPDATE_COUPON` (before/after). Then `bustPromoCache()`.

**Table — coupons**

| # | Column | Format |
|---|---|---|
| 1 | Code | mono primary |
| 2 | Min | `$N` right mono |
| 3 | Type | card name |
| 4 | Reward | ₦ |
| 5 | Expiry | locale date or — |
| 6 | Uses | `use_count` (maintained outside this repo) |
| 7 | Status | "Disabled" (neutral) if inactive; "Expired" (danger) if the expiry is before today (local); else "Active" |
| 8 | Actions | **Hidden for expired coupons**. Otherwise **Edit**, **Disable/Enable** (no confirmation) |

Ordering: created_at desc. No search, filter, pagination, delete, duplicate or redemption history.

**Custom modal — Terms of Use** (`TermsOfUseManager`):
* A backdrop plus a 480px white card (hard-coded colors; **no dark mode**; not the shared `Modal`).
* Help text; an Input "e.g. First-time users only" with Enter/**Add**; the list of terms, each with **Remove**; and **Done**.
* Stored as a JSON array string in `app_config.coupon_terms_of_use` via `PATCH /api/app-config`.
* **Optimistic.** The PATCH response is ignored, so a failure (e.g. a non-SA admin) looks successful until reload.
* Removing a term doesn't affect coupons that already copied the text (the coupon stores the full string).

**Issues:**
* Expired coupons can't be re-enabled or have their expiry extended. By design (commit `aba6dcd`), but it means **no lifecycle management after expiry**.
* The dashboard "Active coupons" KPI counts `is_active=true`, **including expired** coupons.
* Cross-permission dependencies.
* The eligibility overwrite.
* Toast-only errors.
* The inline form pushes the table down, with no scroll-to.

---

### 7.18 Referrals (Referral Management) — `/referral-management`

**Identity**

| | |
|---|---|
| File | `referral-management/page.tsx` (225) |
| Nav | Rewards › **Referrals** |
| Purpose | Configure referral program; view referral log and payout stats |
| Access | Log/stats: `referral_management`. **Settings read/write: `/api/app-config` (super admin only)** |

**Layout:**
1. PageHeader.
2. **Settings** Card:
   * header Toggle `referral_active`;
   * a 2×2 grid: Referrer bonus (₦) `referral_referrer_bonus`, Referee bonus (₦) `referral_referee_bonus`, Min first-trade (USD) `referral_min_trade_usd`, Max referrals / day `referral_max_per_day`;
   * static text "Trigger: First Trade";
   * footer **Save**.
3. StatStrip: Total referrals · **Pending payout (hard-coded 0 by the API, `api/referrals/route.ts:55`)** · Total paid out (both from RPC `admin_referrals_stats`).
4. Referral log table.

**Table — referral log** (latest **500**, no pagination):

| # | Column | Source | Format |
|---|---|---|---|
| 1 | Referrer | `referrer_id` → username | `@x` |
| 2 | Referee | `referee_id` → username | `@x` |
| 3 | Referred On | created_at | date |
| 4 | First Trade | first_trade_at | date or — |
| 5 | Bonus | referrer_bonus_amount + referee_bonus_amount | ₦ |
| 6 | Status | derived: both credited → "Paid" (success); `first_trade_completed` → "Pending Payout" (warning); else "Awaiting Trade" (neutral) | StatusDot |

No search, filters, links to users, or manual payout/retry actions.

**Save:** `PATCH /api/app-config` with the pending keys. **No value validation.** Audit `UPDATE_APP_CONFIG`. Toasts.

**Issues:**
* The "Pending payout" metric is a placeholder (always ₦0), while the table can show "Pending Payout" rows.
* Settings delegation is broken.
* There are no actions for stuck payouts.

---

### 7.19 Broadcast (Notifications Broadcast) — `/notifications-broadcast`

**Identity**

| | |
|---|---|
| File | `notifications-broadcast/page.tsx` (373) |
| Nav | Communications › **Broadcast** |
| Purpose | Compose and send push/in-app broadcasts to audiences, with per-user and global template variables; view recent broadcasts |
| Access | `notifications_broadcast`. The "Specific User" search additionally needs `users` (or SA). Otherwise the search returns 403, and the UI shows no results with no message |

**Layout:**
1. PageHeader.
2. **Compose Broadcast** Card.
3. **Recent Broadcasts** table (or a mobile list with a "RECENT BROADCASTS" micro-label).
4. A local toast.

**Form — Compose**

| Field | Control | Values / limits | Server validation |
|---|---|---|---|
| Audience | Select | `all` "All Users (in-app only)" · `all_anon` "All Users + Anonymous" · `active_7d` "Active in last 7 days" · `inactive` "Inactive (7+ days)" · `specific` "Specific User" | must be one of these |
| Type | Select | `general` General · `promo` Promotional · `update` Product Update · `system` System | one of these, or omitted |
| Search User (only when `specific`) | Input + dropdown (debounced 250 ms, ≥3 chars server-side, max 10 hits) → a selected chip "name — email" + **Clear** | `GET /api/notifications/user-search?q=` (rate limit 60/min per admin) | `target_user_id` must be a UUID and exist (404) |
| Title | Input | **maxLength 80** (client) | required, **≤120** |
| Message | Textarea | **maxLength 500** (client) | required, **≤1000** |

* **Variables panel** ("Variables — click to insert at cursor"). Inserts `{token}` at the cursor of the last-focused field.
  * Per-user: `first_name, full_name, username, email, phone, country, referral_code, balance`.
  * App config: `min_withdrawal, max_withdrawal, signup_bonus, referral_bonus, app_version`.
  * Substitution happens in the edge function (outside this repo).
* Footer: "Recipients: **N**", from `GET /api/notifications/recipient-count?audience=` (RPC `resolve_broadcast_audience`; `all_anon` also adds the anonymous push-token count; `specific` → 1). Shows "…" while loading, and "0" on error (misleading).
* **Send Broadcast** (primary):
  * client checks the title and message are present, and a user is picked for `specific`;
  * then POSTs `/api/notifications/broadcast`.
  * **No confirmation dialog, even for "All Users + Anonymous".**
  * The server strips bidi control characters and applies NFKC, then calls the edge function `broadcast-notification` with `x-admin-secret` and `{title, message, type, audience, target_user_id, admin_id}`, and passes through its status and error.
  * Audit `BROADCAST_NOTIFICATION` with `{title, audience, recipient_count, delivered}`. The **message body is not audited**.
  * Success toast "Sent to N users". The form is cleared and the history refreshed.
* No preview, scheduling, test-send-to-self, deep link, image, or cancel/recall.

**Table — Recent Broadcasts** (latest **20**, ordered by `sent_at` desc):

| Column | Source | Format |
|---|---|---|
| Title | title | primary |
| Message | message | truncated to 60 chars |
| Audience | audience | neutral StatusDot showing the raw key (e.g. "active 7d") |
| Delivered | `delivered_count/recipient_count` | mono right |
| Sent | sent_at | locale datetime |

`failed_count` and `type` are fetched but not shown. No detail view or pagination.

**Issues:**
* No send confirmation.
* Client and server limits differ (80/500 vs 120/1000).
* The recipient count shows 0 on error.
* Failures are not shown.
* The audience is displayed as a raw key.

---

### 7.20 Push Templates (Notification Templates) — `/notification-templates`

**Identity**

| | |
|---|---|
| File | `notification-templates/page.tsx` (258) |
| Nav | Communications › **Push Templates** (title "Notification Templates") |
| Purpose | Edit title/body/active of system-defined push notification templates keyed by event (e.g. `card_rejected`, `dispute_closed`) |
| Access | `notification_templates` |

**Table** (ordered by key):

| Column | Format |
|---|---|
| Key | mono secondary |
| Title | primary |
| Body | truncated to 80 chars (max 420px, full text in a tooltip) |
| Active | StatusDot "ON" (success) / "OFF" (danger) |
| Actions | **Edit** |

Mobile: cards (title, ON/OFF, key, truncated body; tap to edit). No create/delete, search, or "updated by/at" display (`updated_at` is fetched, not shown).

**Side panel (wide 720px) — Edit template:**
* Subtitle: the key.
* The description box (if any).
* **Title** Input, **Body** Textarea.
* "Available variables (click to insert)": pill buttons that **append** `{var}` to the end of the body (not at the cursor, and never into the title).
* **Preview (with sample data):** the title and body with samples substituted: symbol `$`, amount_foreign `50`, card_name `Amazon`, type_parens ` (USA)`, credit `72,500`, card_label `$50 Amazon (USA)`, reason `Card already redeemed`, amount `10,000`, total `10,500`, sender_username `john`, provider `MTN`, type `airtime`. Other variables stay as `{var}`.
* **Active** Toggle ("Disable to stop sending this notification entirely.").
* Footer: Cancel / **Save Changes** (disabled until dirty).

**Save:**
* `PATCH /api/notification-templates {key, title, body, is_active}`.
* The server requires the key and a non-empty title/body. **There are no length limits and no check that required variables are still present.** Unknown key → 404.
* Sets `updated_by`, `updated_at`. Audit `UPDATE_NOTIFICATION_TEMPLATE` with before/after.
* Toast "Saved", panel closes.

**Issues:**
* Esc or scrim click discards unsaved edits without a warning.
* Variables can be deleted accidentally.
* No version history or revert.

---

### 7.21 Email Templates — `/email-templates`

**Identity**

| | |
|---|---|
| File | `email-templates/page.tsx` (286) |
| Nav | Communications › Email Templates |
| Purpose | Edit subject/HTML/active of transactional email templates (e.g. new-device login, admin security alerts) |
| Access | `email_templates` |

**Table:** Key (mono chip) · Subject (truncated to 80) · Active (On/Off) · **Edit**. Mobile cards. No create/delete.

**Side panel (wide) — Edit email template:**
* Description.
* **Subject** Input, plus "Insert into subject" variable buttons (append).
* **HTML** Textarea (mono, 220px tall, resizable), plus "Insert into HTML" variable buttons (append).
* **Preview:** a "Subject:" bar with the rendered subject, and a **sandboxed iframe** (`sandbox=""`, `srcDoc`, 420px) of the rendered HTML with SAMPLES: first_name John, device_model iPhone 14, os_version iOS 17.1, app_version 1.2.0, ip 102.89.34.12, when …, severity_upper CRITICAL, severity_color #C62828, alert_type failed_login_burst, alert_subject …, detail_json …, fired_at ….
* **Active** Toggle ("Active — disable to stop sending this email entirely.").
* Cancel / **Save Changes**.

**Save:**
* `PATCH /api/email-templates`.
* The key must match `^[a-z0-9_]+$` and be ≤64. The subject must be non-empty and ≤300. The HTML must be non-empty and ≤200,000. Unknown key → 404.
* Audit `UPDATE_EMAIL_TEMPLATE` (before/after include the **full HTML**, which can bloat the audit log).

**Issues:**
* No test send.
* No HTML sanitization or linting (the HTML is admin-controlled and sent to users).
* No version history.
* No unsaved-changes guard.

---

### 7.22 Balance (Platform Balance) — `/platform-balance`

**Identity**

| | |
|---|---|
| File | `platform-balance/page.tsx` (149) |
| Nav | Configuration › **Balance** |
| Purpose | Choose whether the platform float balance is a static manual value or "live" from the active payment gateway; set the static value; view live status |
| Access | `platform_balance` |

**Layout:**
1. PageHeader.
2. **Mode** Card: segmented Tabs **Static | Live** ("Static uses a manually entered value; Live auto-fetches from the payment gateway.").
3. Mode-specific Card:
   * **Static Balance:** "Static Balance (₦)" number input (min 0, step 0.01) + **Save**.
   * **Live Balance:**
     * the text "Balance is automatically refreshed from the **&lt;active_payment_gateway&gt;** API every 30 minutes.";
     * StatStrip: Current Balance (₦), Last Updated (locale or "Never");
     * red "Error: &lt;platform_balance_live_error&gt;" when set.
4. A local toast.

**Behavior:**
* **Clicking a mode tab saves immediately.** There is no confirmation, and the Tabs component changes the mode directly.
* The static save validates non-negative on the client. **The server does not validate** `platform_balance_mode` or `platform_balance_static` (any string is accepted).
* Audit `UPDATE_PLATFORM_BALANCE` (after only). Clears the public config cache.
* **No "refresh now" action.** README mentions an edge function "platform-balance refresh", but no code calls it. Live values are written by an external job (outside this repo).
* The meaning of "platform balance" (where it is shown and to whom) is outside this repo.

**Issues:**
* Instant mode switch.
* No server validation.
* No manual refresh.
* The dashboard "Total wallet balance" (sum of user wallets) is a different concept from this page. The two are not reconciled anywhere.

---

### 7.23 Limits & Fees — `/limits-fees`

**Identity**

| | |
|---|---|
| File | `limits-fees/page.tsx` (137) |
| Nav | Configuration › Limits & Fees |
| Purpose | Withdrawal min/max/daily cap, PIN-reset freeze hours, withdrawal fee, large-withdrawal auto-flag threshold |
| Access | UI key `limits_fees`; **API GET/PATCH super admin only** (`api/limits-fees/route.ts:26,37`). For a delegated admin the fields are empty (no 403 handling), and saving shows "Forbidden" |

**Form** (draft/diff pattern; **Save Changes** in both the header and the footer; the footer shows "N UNSAVED" or "ALL SAVED"):

| Section | Key | Label | Hint | Server validation |
|---|---|---|---|---|
| Withdrawals | `min_withdrawal_amount` | Minimum Withdrawal (₦) | Smallest amount per request | finite ≥ 0 |
| | `max_withdrawal_amount` | Maximum Withdrawal (₦) | Largest single request | finite ≥ 0 |
| | `max_daily_withdrawal` | Daily Withdrawal Cap (₦) | Per-user per-day total | finite ≥ 0 |
| | `pin_reset_freeze_hours` | PIN-Reset Withdrawal Freeze (hours) | "…Set 0 to disable. **Max 720**" | finite ≥ 0 (**max not enforced**) |
| | `withdraw_fee` | Withdraw Fee (₦) | Flat fee; 0 = free | finite ≥ 0 |
| Anomaly Detection | `large_withdrawal_flag_threshold` | Large Withdrawal Flag (₦) | ≥ this → auto-flag in `flagged_transactions`; 0 disables | finite ≥ 0 |

**Behavior:**
* Changed keys only.
* Cross-field consistency (min ≤ max ≤ daily) is **not validated**.
* An empty string converts to `Number('')=0`, so it is accepted and saved as `""`.
* Audit `UPDATE_LIMITS_FEES` (after only, no before).
* Cache clear.
* Toast "Saved" / error.

---

### 7.24 Bill Settings — `/bill-settings`

**Identity**

| | |
|---|---|
| File | `bill-settings/page.tsx` (140) |
| Nav | Configuration › Bill Settings |
| Purpose | Quick-amount presets and minimum purchase for airtime and electricity |
| Access | `bill_settings` (UI and API) |

**Form** (same draft/diff pattern):

| Section | Key | Label | Server validation |
|---|---|---|---|
| Airtime | `airtime_quick_amounts` | Quick Amounts (CSV) — "Example: 100,200,500,1000" | string; ≥1 part; every part finite ≥ 0 |
| | `min_airtime_amount` | Minimum Amount (₦) | finite ≥ 0 |
| Electricity | `electricity_quick_amounts` | Quick Amounts (CSV) | as above |
| | `min_electricity_amount` | Minimum Amount (₦) | finite ≥ 0 |

Audit `UPDATE_BILL_SETTINGS`. Cache clear.

**Not covered by this page:**
* Max airtime; data/cable min/max. These keys are allow-listed only in `/api/app-config` (`max_airtime_amount, min_data_amount, max_data_amount, min_cable_amount, max_cable_amount`), which **no UI edits**.
* Provider selection lives in Settings.

---

### 7.25 Settings (Admin Settings) — `/admin-settings`

**Identity**

| | |
|---|---|
| File | `admin-settings/page.tsx` (485) |
| Nav | Configuration › **Settings** (title "Admin Settings") |
| Purpose | Global platform configuration |
| Access | UI key `admin_settings`; **API super admin only**. A non-SA admin sees "Super-admin access only." (the only page with an explicit forbidden state). The `admin_settings` key therefore grants nothing |

**Sections** (each Card saves independently; the button shows "Saving…" per section key):

| Card | Controls | Keys | Client rules | Server rules (`api/admin-settings/route.ts`) |
|---|---|---|---|---|
| **Payment Gateways** — "Credentials live in Supabase function secrets…" | Per gateway (Paystack, Monnify, Novac): a "Primary" radio (disabled unless enabled) and an enable Toggle | `gateway_<g>_enabled`, `active_payment_gateway` | can't disable the primary; can't make a disabled gateway primary (toasts) | primary ∈ gateways; primary must be enabled (from the change set or the DB) |
| **Risk Limits** — max gift-card approval for non-super admins; "rejected by the server with an 'escalate to super admin' error. Default 5,000,000." | Number input (min 1000, step 1000) + Save | `max_card_approval_naira` | ≥1000, floored | finite 1,000 – 1,000,000,000,000. *Enforcement lives in the approval RPC (outside this repo)* |
| **Bill Providers** (VTPass, Novac) — "Services a provider doesn't offer are hidden in the app automatically." | Primary radio + Toggle | `bill_<p>_enabled`, `active_bill_provider` (default `vtpass`) | same rules as gateways | same |
| **Live Chat (Chatwoot)** | Chatwoot base URL (url), Website inbox token (text), Identity validation key (password field, optional) + Save | `chatwoot_base_url`, `chatwoot_website_token`, `chatwoot_identity_key` | — (trims) | URL: https, ≤2048, no control chars. Tokens: ≤256, no whitespace or control chars. `chatwoot_identity_key` is forced `is_public=false` after save; its audit value is `[set]` |
| **Legal** | Terms of Use URL + "Save Terms URL"; Privacy Policy URL + "Save Privacy URL" | `terms_url`, `privacy_url` | empty or `^https?://…` (the **client allows http** but its message says https) | https only (empty allowed) |
| **App Store Links** | Google Play URL, Apple App Store URL + "Save Store Links" | `store_url_android`, `store_url_ios` | same | same |
| **App Version** | Current Version, Minimum Version, Update Type Select (soft/force), Update Message + Save | `app_current_version`, `app_minimum_version`, `app_update_type`, `app_update_message` | none | **none** (any strings; no semver or enum check) |
| **Emergency Mode** — "When ON, all mobile clients show a blocking maintenance screen (no logout) and withdrawals/bill payments are refused server-side." | Status label "ACTIVE"/"Off" + Enable/Disable button. The card border turns red when ON | `emergency_mode` | **Confirmation Modal** ("Enable Emergency Mode?" / "Disable…?" with a consequences text; Confirm is danger when enabling) | allow-listed; no value check |

**Save semantics:**
* `PATCH /api/admin-settings {changes}`. Unknown keys are **silently dropped** (filtered).
* Validation as above.
* Upsert.
* Force `is_public=false` for the secret keys.
* `edge_cache_delete('app_config:public')`.
* Audit `UPDATE_ADMIN_SETTINGS` (after only; secrets masked as `[set]`).
* The client merges the changes into the local config and shows the toast "Saved" or the error.

**Security note:** `GET /api/admin-settings` returns `chatwoot_identity_key` in plaintext to the browser, pre-filled into a password input. It is re-sent on every Live Chat save.

**Dead code:** unused imports (`Table…`, `useIsMobile`) and a leftover `type UserHit` (`admin-settings/page.tsx:484`), both remnants of the removed feature-overrides UI (commit `529ccda`).

---

### 7.26 Anomaly & Alerts — `/anomaly-alerts`

**Identity**

| | |
|---|---|
| File | `anomaly-alerts/page.tsx` (156) |
| Nav | Security › Anomaly & Alerts |
| Purpose | Fraud-detection thresholds and security-alert email settings |
| Access | `anomaly_alerts` |

**Form** (draft/diff; header and footer Save):

| Section | Key | Label | Hint |
|---|---|---|---|
| Dormant Account Activity | `anomaly_dormant_days` | Dormant Days | inactivity days that make a sudden large withdrawal suspicious |
| | `anomaly_dormant_amount` | Dormant Amount Threshold (₦) | |
| Rapid Withdrawal Pattern | `anomaly_rapid_window_mins` | Window (minutes) | |
| | `anomaly_rapid_ratio` | Ratio (0–1), step 0.01 | withdrawn/deposited ratio |
| Failed Transaction Burst | `anomaly_failures_window_mins` | Window (minutes) | |
| | `anomaly_failures_threshold` | Failures Threshold | |
| Critical Alerts | `alert_critical_amount` | Critical Amount (₦) | high-severity admin alert threshold |
| | `security_alerts_batch_size` | Email Batch Size | max security alert emails per cron run |
| | `alert_timezone` | Alert Email Timezone (text) | IANA tz for email timestamps only |

**Server:**
* Numeric keys must be finite ≥ 0 (**the ratio's ≤1 is not enforced**).
* `alert_timezone` must be a string of 1–64 chars (**not validated as IANA**).
* Unknown keys are filtered.
* Audit `UPDATE_ANOMALY_ALERTS`. Cache clear.

**Key-name divergence:** `/api/app-config` allow-lists `critical_alert_amount`, `alert_email_batch` and `iana_timezone`. This page writes `alert_critical_amount`, `security_alerts_batch_size` and `alert_timezone`. Which names the detection/alert jobs read is **outside this repo**. One set is likely dead.

**Not present:**
* Viewing the anomalies or alerts themselves: `flagged_transactions` has a SA-only API but no page; `admin_alerts` has no API.
* Alert recipients configuration. The recipients are implicitly the admin emails ("receives security alerts" on the Admins form).

---

### 7.27 Rate Limits & IPs — `/security-limits`

**Identity**

| | |
|---|---|
| File | `security-limits/page.tsx` (148) |
| Nav | Security › **Rate Limits & IPs** (title "Rate Limits & Webhook IPs") |
| Purpose | Anonymous signup rate limit; payment webhook IP allowlists |
| Access | `security_limits` |

**Form:**

| Section | Key | Control | Server validation |
|---|---|---|---|
| Anti-Abuse Rate Limits | `signup_rate_limit_per_hour` | number | finite ≥ 0 |
| Webhook IP Allowlist | `paystack_webhook_ips` | mono Textarea (CSV) | string; each part must be a valid **IPv4** (no IPv6, no CIDR). Empty allowed |
| | `monnify_webhook_ips` | Textarea | same. Hint: empty ⇒ **all Monnify webhooks rejected (403)** |
| | `novac_webhook_ips` | Textarea | same. Hint: empty ⇒ all Novac webhooks rejected |

Audit `UPDATE_SECURITY_LIMITS`. Cache clear.

**Risk:** clearing an allowlist silently breaks payment confirmations. There is no confirmation or warning at save time (only the hint text).

**Not present:**
* Admin-panel rate limits (the login limits are hard-coded).
* Admin IP allowlist.
* Viewing current rate-limit counters or blocked IPs.

---

## 8. Dashboard Specification

### 8.1 Identity and mechanics

| | |
|---|---|
| Route | `/dashboard` (post-login landing) |
| Files | `(dashboard)/dashboard/page.tsx` (server component), `dashboard/loading.tsx`, `dashboard/AutoRefresh.tsx`, `app/lib/dashboard.ts` |
| Access | Any logged-in admin (the Shell exempts `/dashboard` from the permission check). Nav item visible only with the `dashboard` key or super admin |
| Data source | Direct server-side Supabase (service role) queries in `getDashboardStats()` and `getRecentSubmissions()`. **Not** via `/api/dashboard` (that endpoint returns the same data as JSON for other clients) |
| Permission model | `buildCan(admin)` → `is_super_admin \|\| page_permissions.includes(key)`. Queries for a KPI run **only** if the admin can see it (`dashboard.ts:31-71`) |
| Refresh | `<AutoRefresh/>` calls `router.refresh()` every **5,000 ms** (`AutoRefresh.tsx:5`). This re-runs all server queries. The table header copy says "auto-refreshes every **30 seconds**" (mismatch) |
| Real-time vs cached | Neither cached nor streamed. Each refresh is a fresh set of up to 19 queries |
| "Today" definition | `new Date(); setHours(0,0,0,0)` on the **server**, i.e. the server's local midnight (typically UTC on serverless hosts = 01:00 WAT). Several KPI hints incorrectly say "last 24h" |
| Error handling | Every query has `.catch(() => {})`. A failed query leaves the metric undefined, which renders as **0**. **No error state.** Errors are indistinguishable from zero |
| Loading | `loading.tsx`: PageHeader, 8 `KpiSkeleton`s, "Recent card submissions" table with a 7-column `TableSkeleton` (6 rows). Shown on navigation, not on background refresh |

### 8.2 Layout

1. `PageHeader` "Overview" — "Today's activity across the CardElite platform." (no actions).
2. `KpiGrid` (CSS grid `auto-fit, minmax(180px, 1fr)`, gap 16). Only the KPIs the admin may see.
3. If no KPIs are visible: a Card with "No dashboard metrics for your permissions. Use the side navigation to access the pages you manage."
4. If `card_queue`: a `SectionTitle` "Recent card submissions" and a Card (header "Latest 10" / "Real-time feed — auto-refreshes every 30 seconds." with the action **Open queue** → `/card-queue`) containing a flush Table.

### 8.3 KPI catalog (in display order)

Each KPI is a `Kpi` tile: mono uppercase label with an icon, a large tabular value (container-query-scaled font), and a hint line. **No KPI is clickable** (no drill-down links). None has a delta, trend or comparison period (the `Kpi.delta` prop exists but is unused).

| # | Label (icon) | Permission | Query (exact) | Aggregation | Period | Format | Hint text | Accuracy notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Pending cards (ClipboardList) | `card_queue` | `card_submissions` count where `status='pending'` | exact count (head) | all time | integer, locale grouping | "Awaiting admin review" | Accurate |
| 2 | Cards today (TrendingUp) | `card_queue` | `card_submissions` count where `created_at >= todayISO` | exact count | since server midnight | integer | "Submissions in the last 24h" | **Hint wrong** (since midnight, not 24 h) |
| 3 | Today's payouts (Wallet) | `withdrawals` | `withdrawals.select('amount')` where `status='success' AND created_at >= today` | **JS sum of downloaded rows** | since server midnight (by *request* time, not settlement time) | ₦ 2dp | "Withdrawals settled today" | Row-capped (no `.limit`, so subject to the PostgREST max-rows setting; Supabase default 1000). Uses `created_at`, not a settlement timestamp |
| 4 | Pending withdrawals (ArrowDownToLine) | `withdrawals` | `withdrawals` count where `status='initiated'` | exact count | all time | integer | "In the approval queue" | **Status mismatch**: the approval queue is `pending_review`/`held` (Withdrawals "Review" tab). `initiated` has no tab |
| 5 | Transactions today (Receipt) | `transactions_overview` | `transactions` count where `created_at >= today` | exact count | since midnight | integer | "All transaction types" | Accurate |
| 6 | Transaction volume (Receipt) | `transactions_overview` | `transactions.select('amount')` where `status='success' AND created_at >= today` | JS sum | since midnight | ₦ | "Successful, today" | Row-capped. Sums **all types** together (credits, withdrawals, bills, bonuses), so the business meaning is mixed |
| 7 | Total users (Users) | `users` | `users` count | exact | all time | integer | "All-time registrations" | Includes users in deletion |
| 8 | New users today (UserPlus) | `users` | `users` count where `created_at >= today` | exact | since midnight | integer | "Signups in the last 24h" | Hint wrong (since midnight) |
| 9 | Users online (Activity) | `user_activity_monitor` | `users` count where `last_active_at >= now-5min` | exact | rolling 5 min | integer | "Active in the last 5 min" | The Activity Log page uses **90 s** for "online" |
| 10 | Active coupons (TicketPercent) | `coupons` | `coupons` count where `is_active=true` | exact | current | integer | "Currently redeemable" | **Includes expired coupons** (no expiry filter), so the hint is inaccurate |
| 11 | Giftbox claims (Gift) | `bonuses_rewards` | `giftbox_claims` count where `claimed_at >= today` | exact | since midnight | integer | "Claimed today" | Accurate |
| 12 | Reward pool (Coins) | `bonuses_rewards` | (a) `transactions.select('amount')` where `status='success' AND type IN (signup_bonus, giftbox_bonus, referral_bonus, level_bonus)` `.limit(100000)`, plus (b) `card_submissions.select('coupon_bonus')` where `status IN (approved, dispute_resolved) AND coupon_bonus > 0` `.limit(100000)` | JS sum of (a) + (b) | **all time** | ₦ | "Bonuses + coupon rewards granted (all-time)" | Downloads up to 200k rows every 5 s. Still capped by the server max-rows setting. Excludes `bonus_redeem` |
| 13 | Referrals today (Share2) | `referral_management` | `referrals` count where `created_at >= today` | exact | since midnight | integer | "New referral signups" | Accurate |
| 14 | Total wallet balance (Wallet) | `platform_balance` | `wallets.select('balance')` | JS sum, **no limit** | current | ₦ | "Sum across all user wallets" | **Row-capped**: with more wallets than the max-rows cap the value is **silently understated**. Permission key semantics are odd (`platform_balance` gates a user-wallet sum) |
| 15 | Active cards (CreditCard) | `card_management` | `cards` count where `is_active=true` | exact | current | integer | "Live in the catalog" | Accurate |
| 16 | Admin accounts (ShieldCheck) | `admin_accounts` | `admin_users` count | exact | current | integer | "Total admin users" | Includes deactivated and **soft-deleted** admins |

Notes:
* Currency formatting uses the dashboard's own `formatNaira` (`dashboard/page.tsx:17-19`), which is identical to the shared one. Counts use `toLocaleString()` with the **server** locale.
* Two KPIs (Transaction volume, Transactions today) share the Receipt icon; Today's payouts and Total wallet balance share the Wallet icon.

### 8.4 Recent card submissions table

| | |
|---|---|
| Visibility | `card_queue` |
| Query | `card_submissions` select `id, amount_foreign, payout_naira, status, created_at, card_id, users(username), cards(name), card_types(country_code)` order `created_at desc` limit **10**; then `card_countries` for country names (`dashboard.ts:77-107`) |
| Filters / sort / pagination | none |

| # | Column | Source | Format |
|---|---|---|---|
| 1 | User | `users.username` | primary text (no `@`), `—` if missing |
| 2 | Card | `cards.name` | text |
| 3 | Country | country_name, falling back to country_code | secondary |
| 4 | Payout | `payout_naira` | ₦, right, mono |
| 5 | Submitted | `created_at` | `toLocaleDateString()` (**server locale/timezone**, date only) |
| 6 | Status | status | StatusDot with a local tone map (approved/dispute_resolved = success; pending/disputed = warning; rejected = danger); label capitalized with underscores → spaces ("Dispute resolved") |
| 7 | Actions | — | **Open** (ghost) → `/card-queue`. **Generic link; it doesn't open the specific submission** (no deep-link support in Card Queue) |

* Empty state: "No submissions yet".
* Error: silently empty (the query result isn't checked).

### 8.5 Other dashboard aspects

* **Quick actions / shortcuts:** only "Open queue" and the per-row "Open". No other shortcuts.
* **Activity feed / notifications / system status / alerts:** none. The dashboard shows no emergency-mode status, flagged transactions, admin alerts, gateway balance/status, or failed payouts.
* **Charts / graphs:** none (no charting library).
* **Filters / date range:** none.
* **Responsive:** the KPI grid reflows by `auto-fit`: 1 column on phones, 2–6 on wider screens. The KPI value font scales with the container width (`clamp(var(--text-base), 7cqi, var(--text-2xl))`) and truncates with an ellipsis. The table scrolls horizontally inside its wrapper. There is no mobile card variant for the table.
* **Performance:** up to ~19 queries every 5 s per open dashboard tab, two of which download up to 100k rows each (reward pool) and one downloads all wallet rows.

---

## 9. User & Account Management

### 9.1 End users (`users`)

| Capability | Where | Status | Notes |
|---|---|---|---|
| List/search users | `/users` | Complete | Search name/username/email; 25/page; export |
| View profile | `/users/[id]` | Complete | Identity, balance, referral code, counts, last 10 transactions, 20 device logs, 20 logins |
| Freeze with reason | `/users/[id]` | Partial | Needs `users_freeze` (unassignable in the UI) or SA; reason ≤500; 409 if deletion in progress |
| Unfreeze | `/users/[id]` | Partial | No confirmation, no error display |
| Account status | derived | Complete (display) | Frozen > Active > Inactive; "Deletion in progress" when `deleted_at` |
| Activate/deactivate (`is_active`) | — | **Missing** | Shown, not editable |
| Delete / anonymize | — | **Missing** | Deletion appears to be user-initiated (`deleted_at` set elsewhere) |
| Edit profile (name, email, phone, country) | — | **Missing** | |
| Wallet manual credit/debit | — | **Missing** (permission key `manual_wallet_credit` exists, no endpoint) | |
| Sessions: list | `/user-activity-monitor` panel | Partial (SA only) | From `login_history` (30 latest), active = `ended_at` null |
| Sessions: terminate all | `/user-activity-monitor` panel | Partial (SA only) | RPC `terminate_user_sessions` |
| Devices | `/users/[id]` Device logs tab | Complete (read) | model/OS/app/IP/first/last seen/logins |
| Login history | `/users/[id]` tab and monitor panel | Complete (read) | |
| Password/PIN reset for users | — | **Missing** | The PIN-reset *freeze* window is configurable |
| KYC / verification | — | **Missing / not evidenced** | `email_verified` exists only as a rule type |
| Impersonation | — | **Not present** | |
| Notes / tags on users | — | **Missing** | |
| User's submissions / withdrawals / referrals from the profile | — | **Missing** | Only counts; no links |

### 9.2 Admins (`admin_users`)

| Capability | Status | Notes |
|---|---|---|
| Create admin (non-super) | Complete | SA only; password policy enforced server-side |
| Edit email / role title / permissions / password | Complete | Bumps `token_version` (forces re-login) when password, permissions or role change |
| Change username | Missing | Immutable |
| Deactivate / reactivate | Complete | No confirmation; errors ignored in UI; can't deactivate self; can't deactivate the last active SA (API) |
| Soft delete | Complete | Must be inactive and non-super; type-DELETE confirmation; no restore |
| Revoke sessions | **Backend-only** | `PATCH {revoke_sessions:true}` |
| Create/promote/demote super admin | Missing | SQL only (README) |
| Edit a super admin (incl. own password) | Missing in UI | The API technically allows PATCH on SA rows; the UI hides the actions |
| Self-service profile/password | Missing | Only the theme preference is self-service |
| Password reset / forgot password | Missing | |
| MFA / 2FA | Missing | |
| Account lockout | Partial | Auto-deactivate after 25 failed logins in 24 h; login rate limits (§20.1) |
| Session list / device list for admins | Missing | Only `last_login_at` is stored/displayed; IPs are only in `audit_log` |
| Invitations (email invite) | Missing | The admin sets the initial password directly |
| Teams / organizations / groups | Not present | |

### 9.3 Admin authentication & sessions (implementation)

* **Credentials:** email + username + password, all three required and matched together (`api/auth/route.ts:43-49`).
* **Hashing:** bcrypt cost 12 (`admin-accounts/route.ts:81,155`).
* **Token:** JWT HS256 `{admin_id, role_title, is_super_admin, page_permissions, username, token_version, iat, exp}`. Expiry 8 h (web) / 24 h (mobile). There is **no refresh** and no idle timeout. The cookie `admin_token` is httpOnly, SameSite=Strict, Secure in production, max-age 8 h.
* **Revocation:** `token_version` must equal the DB value.
  * **Logout bumps `token_version`**, which ends *all* of that admin's sessions everywhere, including mobile (`auth/logout/route.ts:13-16`).
  * Changes to password, permissions or role also bump it.
  * Deactivation invalidates immediately, because verification requires `is_active=true`.
* **Freshness:** permissions and the SA flag are re-read from the DB on every request. `username` and `role_title` in the Shell come from the token and stay stale until re-login.
* **Logout UI:** the sidebar button → POST `/api/auth/logout` → `router.push('/login')`. The response clears `admin_token` and `admin_theme` (not `admin_theme_resolved`). There is no confirmation.
* **Session expiry UX:**
  * On page load, the server layout redirects to `/login`.
  * On API calls after expiry, the pages get 401/403 and mostly show empty data. **No global "session expired → redirect to login" handler exists.**

---

## 10. Roles & Permissions

### 10.1 Model

* `admin_users.is_super_admin` (boolean) and `admin_users.page_permissions` (jsonb string array).
* `role_title` is a **free-text label**, not a role. There are no role definitions, permission groups or inheritance. Each admin's permissions are chosen individually.
* The permission granularity is **per page/area**, not per action. The one exception is `users_freeze`.

### 10.2 Permission catalog

"In UI checklist" = selectable on the Admins form (`admin-accounts/page.tsx:11-34`). "Enforced by" = API routes that check the key.

| Key | Nav item | In UI checklist | Enforced by (API) | Effective meaning |
|---|---|---|---|---|
| `dashboard` | Dashboard | ✔ | — (no API check; the page is always reachable) | Only shows/hides the nav link |
| `card_queue` | Card Queue | ✔ | card-queue; dashboard KPIs 1–2 + recent table | Full card review, including approve/credit |
| `withdrawals` | Withdrawals | ✔ | withdrawals, approve, reject; dashboard KPIs 3–4 | View + approve/reject payouts + export |
| `transactions_overview` | Transactions | ✔ | transactions; KPIs 5–6 | View + export ledger |
| `users` | Users | ✔ | users, users/[id] GET; user-search (with broadcast); KPIs 7–8 | View/export users (PII) |
| `users_freeze` | — | ✘ | users/[id] PATCH | Freeze/unfreeze. **Unassignable in UI** |
| `user_activity_monitor` | Activity Log | ✔ | — (the APIs are SA-only); KPI 9 | **Effectively only KPI 9**; the page is unusable |
| `activity` | Admin Activity | ✔ | activity | View/export the audit log |
| `admin_accounts` | Admins | ✘ | — (API SA-only); KPI 16 | **Only KPI 16 + nav link**; the page is unusable |
| `card_management` | Cards | ✔ | cards, cards/upload; KPI 15 | Brands/countries. **Also required** by Field Builder and Coupons to list cards |
| `card_type_builder` | Field Builder | ✔ (label "Card Type & Field Builder") | field-builder | Templates/fields/installs |
| `field_builder` | — | ✘ | — | **Unused** |
| `rates_management` | Rates | ✔ | rates | Rates & denominations |
| `bonuses_rewards` | Bonuses, Levels | ✔ | bonuses, giftbox, levels, levels/upload; KPIs 11–12 | Giftbox + levels. Bonus toggles still need SA |
| `giftbox` | — | ✘ | — | **Unused** |
| `coupons` | Coupons | ✔ | coupons; KPI 10 | Coupons. Terms of Use need SA; the card list needs `card_management` |
| `referral_management` | Referrals | ✔ | referrals; KPI 13 | Referral log. Settings need SA |
| `notifications_broadcast` | Broadcast | ✔ | broadcast, recipient-count, user-search (+`users`) | Send broadcasts to all users |
| `notification_templates` | Push Templates | ✔ | notification-templates | Edit push templates |
| `email_templates` | Email Templates | ✔ | email-templates | Edit email templates |
| `platform_balance` | Balance | ✔ | platform-balance; **KPI 14 (user wallet sum)** | Balance mode/value |
| `limits_fees` | Limits & Fees | ✔ | — (API SA-only) | **Nav link only**; the page is unusable |
| `bill_settings` | Bill Settings | ✔ | bill-settings | Bill presets/minimums |
| `admin_settings` | Settings | ✔ | — (API SA-only) | **Nav link only**; the page says "Super-admin access only." |
| `anomaly_alerts` | Anomaly & Alerts | ✔ | anomaly-alerts | Fraud thresholds |
| `security_limits` | Rate Limits & IPs | ✔ | security-limits | Signup limit + webhook IPs |
| `manual_wallet_credit` | — | ✘ | — | **Unused** (no feature) |
| `feature_overrides` | — | ✘ | — | **Legacy** (feature removed in `529ccda`) |
| `flagged_transactions` | — | ✘ | — (API SA-only) | **Unused** |

### 10.3 Super-admin-only endpoints (regardless of permissions)

`/api/admin-accounts` (all methods), `/api/admin-settings`, `/api/app-config`, `/api/limits-fees`, `/api/user-activity-monitor` (+`[id]`, `terminate`), `/api/flagged-transactions`.

### 10.4 UI vs API permission mismatches (concrete)

| Page | UI gate | API requirement | Result for a scoped admin with only the UI key |
|---|---|---|---|
| Activity Log | `user_activity_monitor` | SA | Red banner "Forbidden (super-admin only)", empty table |
| Admins | `admin_accounts` (unassignable) | SA | Empty table "No admin accounts yet"; Create fails ("Forbidden") |
| Limits & Fees | `limits_fees` | SA | Empty fields; Save → toast "Forbidden" |
| Settings | `admin_settings` | SA | "Super-admin access only." |
| Bonuses (toggles/signup) | `bonuses_rewards` | SA (`/api/app-config`) | Toggles show off, amounts blank; "Failed to save settings." |
| Referrals (settings) | `referral_management` | SA | Same as Bonuses |
| Coupons (Terms of Use) | `coupons` | SA | Empty terms list; add/remove appears to work but isn't saved |
| Coupons (card select) | `coupons` | `card_management` | Empty "Type of Card"; can't create |
| Field Builder (brand list) | `card_type_builder` | `card_management` | "No cards yet"; page unusable |
| User detail (Freeze) | `users` | SA or `users_freeze` | Freeze modal error "Forbidden"; Unfreeze silently does nothing |
| Broadcast (Specific user) | `notifications_broadcast` | + `users` | User search shows nothing |

### 10.5 Where authorization is enforced

| Layer | Implementation | Coverage |
|---|---|---|
| Edge proxy | `proxy.ts` | **No auth**. Only a CSRF/origin check + CSP |
| Server layout | `(dashboard)/layout.tsx` | Authentication only (valid JWT + active admin) |
| UI (client) | `Shell` nav filtering + `AdminNotFound` for disallowed keys; per-page button visibility (e.g. Admins hides actions for SA rows; coupons hide actions if expired) | Cosmetic; bypassable. Never grants data access |
| API (server) | Each route handler checks `is_super_admin`/keys | **The real enforcement point**. All 40 routes check auth. Permission checks are present on all data routes |
| Database | Service-role client ⇒ **RLS bypassed**. Some invariants live in RPCs (e.g. max card approval, withdrawal state transitions) — outside this repo | Unknown |

**Operations protected only by the frontend:** none found that grant data access. Some **business rules** are UI-only, however:
* "can't disable the primary gateway" is also enforced server-side only for *setting* a primary. **Disabling the current primary gateway via the API is not blocked** (`admin-settings/route.ts:70-94` validates only when `active_payment_gateway`/`active_bill_provider` is in the change set).
* Expired coupons are un-editable in the UI only; the API allows it.
* A required freeze reason is enforced both client- and server-side.
* Rejecting a card with a reason is enforced server-side.
* The required withdrawal reject reason is **client-side only** (the server accepts empty).
* The required card-correction note is **client-side only** (the server passes it through optionally).
* The "type DELETE" confirmation is UI-only (the server just requires the admin to be inactive and non-super).

---

## 11. Data Management

Per-entity CRUD coverage in the admin:

| Entity | Create | Read | Update | Delete | Bulk | Import | Export | Notes |
|---|---|---|---|---|---|---|---|---|
| users | ✘ | ✔ list/detail | freeze/unfreeze only | ✘ | ✘ | ✘ | CSV/PDF | |
| wallets | ✘ | balance only | ✘ | ✘ | — | — | in users export | No manual adjustments |
| transactions | ✘ | ✔ list | ✘ (card reject/uphold mutates status indirectly) | ✘ | ✘ | ✘ | CSV/PDF | No detail view |
| withdrawals | ✘ | ✔ list/detail | approve/reject | ✘ | ✘ | ✘ | CSV/PDF | |
| card_submissions | ✘ | ✔ | approve/correct/reject/overturn/uphold | ✘ | ✘ | ✘ | ✘ | |
| flagged_transactions | ✘ | withdrawal detail only (+SA API) | clear/escalate (API only) | ✘ | ✘ | ✘ | ✘ | |
| cards | ✔ | ✔ | ✔ name/logo/active (reorder API only) | ✘ | reorder (API) | ✘ | ✘ | |
| card_countries | ✔ | ✔ | active only (API allows code/name/symbol) | ✔ hard delete | ✘ | ✘ | ✘ | |
| card_type_templates | ✔ | ✔ | name/active | ✔ (unlinks installs) | ✘ | ✘ | ✘ | |
| card_type_template_fields | ✔ | ✔ | ✔ | ✔ | reorder (API only) | ✘ | ✘ | Doesn't sync to installs |
| card_types (installs) | ✔ via install | ✔ (as country pills) | active only | ✘ | ✘ | ✘ | ✘ | |
| card_type_fields | via install copy | ✘ (not displayed) | ✘ | ✘ | — | — | — | |
| denominations | ✔ | ✔ | rate/active only | ✘ | batch rate save | ✘ | ✘ | |
| coupons | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | |
| giftbox_items | ✔ | ✔ | ✔ | ✘ (deactivate) | ✘ | ✘ | ✘ | |
| level_tiers | ✘ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | |
| referrals | ✘ | ✔ (500) | ✘ | ✘ | ✘ | ✘ | ✘ | |
| notification_templates | ✘ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | |
| email_templates | ✘ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | |
| notification_broadcasts | ✔ (send) | ✔ (20) | ✘ | ✘ | — | — | ✘ | |
| app_config | — | ✔ per page | ✔ per page | ✘ | ✔ multi-key saves | ✘ | ✘ | |
| admin_users | ✔ | ✔ | ✔ | soft | ✘ | ✘ | ✘ | |
| audit_log | (system) | ✔ (150 view / 5000 export) | ✘ | ✘ | — | — | CSV/PDF | Immutable from the admin |
| admin_alerts | (system) | ✘ | ✘ | ✘ | — | — | — | **No UI or API** |

---

## 12. Search & Filtering

### 12.1 Inventory

| # | Page | Scope | Fields matched | Matching | Where executed | Trigger | Filters | Sort | Pagination | Limits |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Card Queue | latest 200 submissions (per status tab) | user username, user full_name, card name | case-insensitive substring | **server, in memory, after `limit 200`** | every keystroke + 5 s poll | status tab | created desc (fixed) | none | 200 |
| 2 | Withdrawals | withdrawals | user full_name/username/email → user ids | `ilike %q%` (sanitized) | DB (two-step) | every keystroke + 5 s poll | status tab (API also: dates, review) | created desc | none in UI (API supports) | 100 (UI asks 200; clamped) |
| 3 | Transactions | transactions | user full_name/username/email → user ids | `ilike` | DB (two-step) | **Apply** button | type group, status, date from/to | created desc | 25/page | — |
| 4 | Users | users | full_name, username, email | `ilike` | DB | every keystroke | none (API supports dates for export) | created desc | 25/page | — |
| 5 | Activity Log | users | username, full_name, email | `ilike` | DB | Enter / Apply | online only | last_active desc | 25/page | — |
| 6 | Admin Activity | audit entries | — (no text search) | — | RPC | select change | admin | RPC order | none | 150 |
| 7 | Broadcast user picker | users | username, email, full_name | `ilike`, ≥3 chars | DB | 250 ms debounce | — | — | — | 10 results; rate-limited 60/min |
| 8 | Cards country combobox | static ISO list (client) | name, code, currency | substring | client | typing | — | alphabetical | — | ~217 |

### 12.2 Sanitization

`sanitizeSearch` (`lib/sanitize.ts:1-7`) strips everything except `[a-zA-Z0-9 @._+-]`, collapses repeated dots, trims, and truncates to 64. This prevents PostgREST filter injection into `.or(...)`. It also means **non-ASCII names (accents) cannot be searched** and apostrophes are dropped. Card Queue search is **not** sanitized (it doesn't hit the DB).

### 12.3 Inconsistencies

* Four different search behaviors: live, Apply-button, Enter, and debounced.
* Card Queue searches only 200 rows; the others search the whole table.
* The Withdrawals placeholder promises "account" search, but it isn't implemented.
* No page supports sorting by column, saved filters, URL-persisted filters, or multi-select filters.
* Status sets differ per page (Transactions has no `refunded`/`processing`; Card Queue has no `dispute_resolved` tab).
* Two-step user lookups (`users` → `in(user_id)`) are **unbounded**. Broad terms (e.g. "a") can produce very large `IN` lists and long URLs.

---

## 13. Analytics & Reporting

| Surface | Metrics | Source / calculation | Period | Filters | Export | Real/placeholder |
|---|---|---|---|---|---|---|
| Dashboard KPIs | 16 KPIs (§8.3) | counts (exact) and JS sums of row fetches | today (server midnight) / all time / rolling 5 min | none | none | Real (accuracy caveats) |
| Dashboard recent submissions | last 10 | query | — | — | — | Real |
| Transactions StatStrip | total count, total amount, today count, today amount | RPC `admin_transactions_stats` (definition outside this repo; "today" computed in the RPC) | all/today | **ignores page filters** | — | Real |
| Withdrawals StatStrip | in view, amount in view, total for filter | client sum of ≤100 rows / API count | current filter | tab/search | — | Real (label "Total in queue" misleading) |
| Users StatStrip | total (for search) | exact count | — | search | — | Real |
| Activity Log StatStrip | online now, total | counts | 90 s window | search/online | — | Real |
| Admin Activity StatStrip | actions in view, days | client counts of ≤150 rows | — | admin | — | Real but trivial |
| Admins StatStrip | total, active | client counts | — | — | — | Real |
| Cards StatStrip | brands, active | client counts | — | — | — | Real |
| Rates | "N active rates" per brand | client count of active denominations | — | — | — | Real |
| Bonuses | level claims today, active tier count, signup bonuses today/total | counts | today/all | — | — | Real (signup counts include failed transactions) |
| Levels | claims per tier | client count of the `user_level_claims` fetch | all time | — | — | Real (row-cap risk) |
| Giftbox | claims per item | client count of the `giftbox_claims` fetch | all time | — | — | Real (row-cap risk) |
| Coupons | use_count | column | all time | — | — | Real (maintained outside this repo) |
| Referrals | total, **pending payout (always 0)**, total paid | RPC `admin_referrals_stats` + hard-coded 0 | all time | — | — | **Pending payout = placeholder** |
| Broadcast history | delivered/recipients | stored counts | last 20 | — | — | Real |
| Platform balance (live) | gateway balance, last updated, error | written by an external job | — | — | — | Real (read-only) |
| Leaderboard | — | — | — | — | — | **Placeholder "Coming Soon"** |

**Absent:** time-series charts, period comparisons, cohort/retention, revenue/margin (rate spread), per-card volume, per-admin productivity (approval counts/latency), SLA metrics for the queues, scheduled reports, and drill-down from KPIs.

---

## 14. Notifications

### 14.1 Admin-facing feedback inside the UI

| Mechanism | Implementation | Used by | Notes |
|---|---|---|---|
| Shared toast system | `ToastProvider` + `useToast()` (`_ui/Misc.tsx:128-169`); bottom-center, 3.5 s, tones default/success/error/warning | **Nobody** (mounted in Shell, never used) | Dead code |
| Local toast (dark pill) | inline div bottom-right, `background: var(--fg-primary); color: var(--bg-base)` (**undefined token**), 3 s | Rates, Bonuses, Levels, Coupons, Referrals, Broadcast | Duplicated 6× |
| Local toast (surface card) | inline div bottom-right, surface bg + border + shadow, 3 s | Push Templates, Email Templates, Balance, Limits, Bill, Anomaly, Security, Settings | Duplicated 8× |
| Native `alert()` | browser dialog | Card Queue (errors, share), Withdrawals/Users/Transactions (pop-up blocked), Admin Activity (export errors) | |
| Native `confirm()` | browser dialog | Activity Log terminate sessions | |
| Inline error banners/text | tone-danger boxes or red text | Withdrawals panel, Activity Log, Admins form/delete, Freeze modal, Cards modal, Login, Admin Activity | |
| Permission messages | "Super-admin access only." (Settings), "Forbidden (super-admin only)" (Activity Log), "You do not have permission…" (Admin Activity), 404 (Shell) | inconsistent | |

### 14.2 Notifications sent to end users by admin actions

| Trigger | Channel | Mechanism | Template |
|---|---|---|---|
| Card rejected | push/in-app (via RPC) | `emit_notification(user, 'card_rejected', 'card_rejected', {card_label, reason})` | `notification_templates.card_rejected` |
| Dispute upheld | push/in-app | `emit_notification(user, 'dispute_closed', …)` | `dispute_closed` |
| Card approved / overturned / corrected | inside RPC `approve_card_submission` (outside this repo) | — | not visible |
| Withdrawal approved/rejected | inside RPCs / edge fn (outside this repo) | — | not visible |
| Broadcast | push/in-app | edge fn `broadcast-notification` | ad hoc |
| Email templates (e.g. new device, security alerts) | SMTP | outside this repo | `email_templates.*` |

### 14.3 Admin alerts

* `admin_alerts` rows are inserted on admin login bursts (≥5 failures in 30 min; `severity: high`, `event_type: admin_login_burst`).
* The anomaly settings reference "security alert emails per cron run" and "critical amount triggers a high-severity admin alert". The email template samples show fields `severity_upper`, `alert_type`, `alert_subject`, `detail_json`, `fired_at`. So alerts are **emailed to admin emails by a cron job** (outside this repo).
* **There is no in-app alert center, badge, acknowledgement, or alert list.** `admin_alerts` has no read API.

---

## 15. Settings & Configuration

### 15.1 Storage locations

| Kind | Where | Examples |
|---|---|---|
| **Database (`app_config` key/value, `value` stored as text)** | Supabase table | All platform settings below. After every write the routes call RPC `edge_cache_delete('app_config:public')`. Only the rows with `is_public=true` are presumably served to the app (the cache key suggests so; outside this repo) |
| **Database (other tables)** | `level_tiers`, `notification_templates`, `email_templates`, `coupons`, `giftbox_items`, `denominations`, … | Domain configuration |
| **Environment variables** | Hosting env | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_JWT_SECRET`, `ADMIN_FUNCTION_SECRET` (§4.5) |
| **Supabase function secrets** | External | Gateway credentials ("Credentials live in Supabase function secrets", `admin-settings/page.tsx:199`). **Not manageable from the admin** |
| **Code constants** | Repo | Login rate limits (20 / 10 min per IP; 10 / 30 min per account), auto-deactivate at 25 failures / 24 h, alert at 5 / 30 min, JWT TTLs, upload limits (5 MB; png/jpg/jpeg/webp), badge size 320px, export caps (50,000; activity 5,000), list caps (200, 150, 500, 20), online windows (90 s, 5 min), polling intervals, permission catalog, ISO country list, rejection/correction presets, rule types |
| **Browser** | cookies/localStorage | `admin_theme`, `admin_theme_resolved` (cookies, 1 y), `cardelite-admin-sidebar-collapsed` (localStorage) |
| **Per-admin DB** | `admin_users.theme_preference` | Theme (light/dark/system) |

### 15.2 `app_config` key catalog

"Writers" lists every API route allowed to write the key. **`/api/app-config` is a generic SA-only writer that bypasses the specialized validations of the other routes** (e.g. it doesn't validate webhook IPs as IPv4, numeric ranges, CSV formats, or the gateway primary/enabled invariant, and it doesn't force `chatwoot_identity_key` private).

| Key | UI page | Writers | Server validation (specialized route) | Meaning |
|---|---|---|---|---|
| `gateway_paystack_enabled` / `gateway_monnify_enabled` / `gateway_novac_enabled` | Settings | admin-settings, app-config | none on value (UI sends 'true'/'false') | Payout gateway enabled |
| `active_payment_gateway` | Settings (write), Balance (read) | admin-settings | ∈ {paystack, monnify, novac} and enabled | Primary payout gateway |
| `bill_vtpass_enabled` / `bill_novac_enabled` | Settings | admin-settings, app-config | — | Bill provider enabled |
| `active_bill_provider` | Settings | admin-settings, app-config (no invariant check) | ∈ {vtpass, novac} and enabled | Primary bill provider (UI default `vtpass`) |
| `max_card_approval_naira` | Settings | admin-settings | 1,000 – 1e12 | Non-SA approval ceiling (enforced in RPC) |
| `chatwoot_base_url` | Settings | admin-settings, app-config | https, ≤2048, no control chars | Live chat |
| `chatwoot_website_token` | Settings | admin-settings, app-config | single token ≤256 | Live chat |
| `chatwoot_identity_key` (**secret**) | Settings | admin-settings (forces `is_public=false`), app-config (**does not**) | single token ≤256 | HMAC identity validation |
| `terms_url`, `privacy_url` | Settings | admin-settings, app-config | https ≤2048 | Legal links in the app |
| `store_url_android`, `store_url_ios` | Settings | admin-settings, app-config | https ≤2048 | Update-prompt links |
| `app_current_version`, `app_minimum_version`, `app_update_type`, `app_update_message` | Settings | admin-settings (all), app-config (not `app_minimum_version`) | **none** | App update gating |
| `emergency_mode` | Settings | admin-settings, app-config | none | Maintenance kill-switch |
| `min_withdrawal_amount`, `max_withdrawal_amount`, `max_daily_withdrawal`, `withdraw_fee`, `pin_reset_freeze_hours`, `large_withdrawal_flag_threshold` | Limits & Fees | limits-fees, app-config | finite ≥ 0 | Withdrawal limits, fees, auto-flag |
| `airtime_quick_amounts` | Bill Settings | bill-settings only | CSV of numbers ≥0 | Airtime preset buttons |
| `electricity_quick_amounts` | Bill Settings | bill-settings, app-config | CSV of numbers ≥0 | Electricity preset buttons |
| `min_airtime_amount`, `min_electricity_amount` | Bill Settings | bill-settings, app-config | ≥ 0 | Minimums |
| `max_airtime_amount`, `min_data_amount`, `max_data_amount`, `min_cable_amount`, `max_cable_amount` | **none** | app-config only | none | **Backend-only config** |
| `platform_balance_mode`, `platform_balance_static` | Balance | platform-balance | **none** | Balance source |
| `platform_balance_live`, `platform_balance_live_at`, `platform_balance_live_error` | Balance (read) | external job | — | Live gateway balance |
| `signup_rate_limit_per_hour` | Rate Limits & IPs | security-limits, app-config | ≥ 0 | Anonymous signups per IP per hour |
| `paystack_webhook_ips`, `monnify_webhook_ips`, `novac_webhook_ips` | Rate Limits & IPs | security-limits (IPv4 CSV), app-config (**no IP check**) | IPv4 list | Webhook allowlists |
| `anomaly_dormant_days`, `anomaly_dormant_amount`, `anomaly_rapid_window_mins`, `anomaly_rapid_ratio`, `anomaly_failures_window_mins`, `anomaly_failures_threshold` | Anomaly & Alerts | anomaly-alerts, app-config | ≥ 0 | Fraud heuristics |
| `alert_critical_amount`, `security_alerts_batch_size`, `alert_timezone` | Anomaly & Alerts | anomaly-alerts | ≥0 / tz string ≤64 | Alert emails |
| `critical_alert_amount`, `alert_email_batch`, `iana_timezone` | **none** | app-config only | none | **Near-duplicates of the keys above; likely legacy/dead** |
| `signup_bonus_active`, `signup_bonus_amount`, `signup_bonus_condition` | Bonuses | app-config | **none** | Signup bonus |
| `levels_active` | Bonuses | app-config | none | Levels program |
| `level_bonus_active` | **none** | app-config | none | Backend-only (distinct from `levels_active`) |
| `referral_active`, `referral_referrer_bonus`, `referral_referee_bonus`, `referral_min_trade_usd`, `referral_max_per_day` | Referrals | app-config | none | Referral program |
| `coupon_terms_of_use` | Coupons (Terms manager) | app-config | none (JSON array string) | Master terms list |
| `withdrawal_narrations` | **none** | app-config | none | Backend-only (bank narration text?) |

### 15.3 Settings capabilities vs expectations

| Category | Present | Missing |
|---|---|---|
| Application settings | version gating, emergency mode, legal/store URLs | maintenance message text, feature flags UI |
| Security settings | webhook IPs, signup rate limit, anomaly thresholds | admin MFA policy, admin IP allowlist, session TTL, password policy config |
| Email settings | template editing | SMTP config, sender identity, test send |
| Integration settings | gateway/bill provider enable + primary; Chatwoot | gateway credentials (by design in function secrets), connection test, status |
| Payment settings | withdrawal limits/fee, max approval | per-gateway fees, per-bill-type limits for data/cable/max airtime (backend-only keys) |
| Feature flags | `emergency_mode`, `levels_active`, `signup_bonus_active`, `referral_active` (per-feature toggles spread over pages) | central flag list; feature overrides (removed) |
| Limits/quotas | withdrawals, bills (partial), signups | per-user overrides |

---

## 16. Integrations

| Provider | Purpose | Configured in admin | Credentials | Webhooks | Status / test | Enable/disable | Logs | Secrets handling |
|---|---|---|---|---|---|---|---|---|
| **Supabase** (Postgres, PostgREST, RPC, Storage, Edge Functions) | Entire backend | — | `SUPABASE_URL`, service-role key (env) | — | none | — | none | Server-only env; the service-role key never reaches the browser (all Supabase calls are in server code) |
| **Paystack** | Payouts (primary candidate); webhook | Settings (enable/primary), Rate Limits & IPs (webhook IPs), Balance (live source if primary) | Supabase function secrets (not in admin) | IP allowlist `paystack_webhook_ips` | Live balance error text only | Toggle | none | Not exposed |
| **Monnify** | Payouts | same | same | `monnify_webhook_ips` (empty = reject all) | — | Toggle | none | Not exposed |
| **Novac** | Payouts + bill provider | Settings (gateway and bill provider), webhook IPs | same | `novac_webhook_ips` (empty = reject all) | — | Toggles | none | Not exposed |
| **VTPass** | Bills (airtime/data/cable/electricity) | Settings (enable/primary), Bill Settings (amounts) | function secrets | — | — | Toggle | none | Not exposed |
| **Chatwoot** | In-app live chat | Settings › Live Chat | website token (public), identity validation key (**secret**, stored in `app_config`, `is_public=false` enforced by admin-settings) | — | none | (implicitly by clearing values) | none | The identity key is readable by super admins in plaintext in the browser |
| **SMTP** | Transactional/security emails | Email Templates (content only) | outside admin | — | none | per-template active | none | — |
| **Push provider** | Push notifications | Push Templates, Broadcast | outside admin | — | delivered/failed counts per broadcast | per-template active | broadcast history (20) | — |
| **Edge Function `broadcast-notification`** | Broadcast fan-out | Broadcast page | `x-admin-secret` = `ADMIN_FUNCTION_SECRET` | — | HTTP status pass-through | — | — | Secret server-side only |
| **Edge Function `resume-withdrawal`** | Execute payout after approval | Withdrawals approve | `x-admin-secret` **plus the admin's JWT as Bearer** | — | `success` flag | — | — | The admin JWT is shared with the edge function |
| **Edge Function `get-active-promos`** | Promo cache bust (POST with secret) | after coupon/giftbox writes | `x-admin-secret` | — | fire-and-forget; errors swallowed | — | — | — |
| **Google Fonts** (`next/font/google`) | Inter, JetBrains Mono | — | — | — | — | — | — | Self-hosted at build by next/font |
| **WhatsApp / Telegram / mailto** | Share card submission text | Card Queue share menu | — | — | — | — | **none** | Data leaves the platform |

---

## 17. Files / Import / Export

### 17.1 Uploads

| Upload | Endpoint | Auth | Allowed | Size | Content check | Processing | Bucket (visibility) | Name | Audit |
|---|---|---|---|---|---|---|---|---|---|
| Card brand logo | `POST /api/cards/upload` (multipart `file`) | `card_management` (cookie or Bearer) | png, jpg, jpeg, webp (by extension) | ≤5 MB | Magic bytes must match the extension | none | `card-logos` (**public URL**) | `<uuid>.<ext>` | Not audited (the URL is audited on card save) |
| Level badge | `POST /api/levels/upload` (`file`, `tier_order` 0–99) | `bonuses_rewards` (**cookie only**) | png, jpg, jpeg, webp (UI claims SVG) | ≤5 MB | magic bytes | `sharp` resize to fit 320×320, WebP q92; falls back to the original if sharp fails | `level-badges` (**public**) | `tier-<n>-<uuid>.<ext>` | via `UPDATE_LEVEL_TIER` badge_url |

* No virus scanning.
* Old files are never deleted (orphans accumulate on replace).
* No image dimension validation for logos.
* The client-side `accept` is `image/*` for logos (the server rejects gif/svg with an error that the UI **ignores**).

### 17.2 Viewing / downloading user files

* **Card images and dispute evidence** (private bucket `card-images`): the server creates **1-hour signed URLs** per image on each detail load. Viewing is via thumbnails and a lightbox. **Download** fetches each blob and triggers a save. **Native share** sends the files through the Web Share API. **None of this is audited.**
* **Avatars** (private bucket `avatars`): 1-hour signed URLs for the users list only.

### 17.3 Exports

| Export | Page | Endpoint | Formats | Range selection | Filters honored | Cap | Columns | Audit |
|---|---|---|---|---|---|---|---|---|
| Users | Users | `GET /api/users?csv=1` / `?pdf=1` | CSV (`text/csv`, `users-<ts>.csv`), PDF via print window | ExportModal (default 7 d; dates on `created_at`) | search | 50,000 | ID, Name, Username, Email, Phone, Balance, Trades, Joined, Status | `EXPORT_CSV` (entity users, `entity_id 'bulk'`, `after_value {rows, search, cap}`, IP) for both CSV and PDF |
| Transactions | Transactions | `GET /api/transactions?csv=1/pdf=1` | CSV/PDF | ExportModal (overrides applied dates unless "All time") | type, status, search | 50,000 | ID, User, Email, Type, Amount, Status, Reference, Date | `EXPORT_CSV` with `diff` column, `entity_id null`, **no IP**; insert error ignored |
| Withdrawals | Withdrawals | `GET /api/withdrawals?csv=1/pdf=1` | CSV/PDF | ExportModal | status tab, search | 50,000 | ID, User, Amount, Bank, **Account (number)**, AccountName, Status, Gateway, GatewayRef, Date | same as Transactions |
| Admin activity | Admin Activity | `GET /api/activity?format=csv` / `format=json` | CSV/PDF | custom modal (browser-local midnight bounds) | admin filter | 5,000 | created_at, admin_username, admin_role_title, admin_is_super, action, entity, entity_id, target_username, target_label, ip_address, before_value, after_value, id | **Not audited** |

* **CSV safety:** every CSV cell is double-quoted with `"` escaped, and values starting with `= + - @ \t \r` are prefixed with `'` (formula-injection guard). No BOM, so Excel may mis-detect UTF-8 (e.g. `₦`, names with accents).
* **PDF:** `printTable` (`lib/printExport.ts`) or `buildPrintHtml` (activity). Both open `about:blank` via `window.open`, write HTML-escaped content, and call `print()` after 300 ms. If pop-ups are blocked → `alert`. No server-side PDF.
* **Client error handling:** CSV downloads don't check `res.ok`, so an error JSON is saved as a `.csv` file (except Admin Activity, which checks it).
* **No imports** exist anywhere (no CSV upload, bulk update, or bulk user actions).
* **No backup/restore** capabilities in the admin.

---

## 18. Background Jobs

The admin contains **no job runner, queue, or scheduler**. Jobs referenced by the admin (all outside this repo):

| Job / pipeline | Evidence | Admin visibility | Admin controls |
|---|---|---|---|
| Platform balance live refresh ("every 30 minutes") | `platform-balance/page.tsx:115`; `platform_balance_live*` keys | Last value, timestamp, error | None (no manual refresh) |
| Security alert emailer (batch per cron run) | `anomaly-alerts/page.tsx:180` | none | batch size, timezone |
| Anomaly detection → `flagged_transactions` (dormant, rapid, failures, large withdrawal) | limits/anomaly hints | Flag shown only inside withdrawal detail | Thresholds only; clear/escalate API (SA) without UI |
| Broadcast delivery | edge fn `broadcast-notification`; `notification_broadcasts.delivered_count/failed_count` | Delivered/recipients in history | Send only (no retry/cancel) |
| Withdrawal payout execution | edge fn `resume-withdrawal` (synchronous in the approve request) | Status/gateway ref/failure_reason | Approve/Reject only; **no retry for failed payouts, no manual "mark as paid/refunded"** |
| Promo cache | edge fn `get-active-promos` | none | Automatic bust after coupon/giftbox writes |
| Public config cache | RPC `edge_cache_delete('app_config:public')` | none | Automatic after config writes |
| Referral payout crediting | `referrals.*_credited` flags | Status column | None |
| User session tracking (`last_active_at`, `login_history`) | activity monitor | Read | Terminate sessions |

**Polling inside the admin UI** (a client "job"): Dashboard 5 s (`router.refresh`), Card Queue 5 s, Withdrawals 5 s, Activity Log 30 s. Polling continues in background tabs (no visibility check).

**Missing:** job/queue monitoring, failed-job inspection, manual triggers, retry/cancel, and cron health.

---

## 19. Audit Logs

### 19.1 Mechanism

* **Storage:** table `audit_log` with columns written by the code: `admin_id, action, entity, entity_id, before_value, after_value, ip_address` (plus `diff` in two routes); `id` and `created_at` come from the DB.
* **Writer:** direct inserts in each route handler (no shared helper). Inserts are awaited, but **their errors are never checked**. The insert happens *after* the mutation and is not in the same transaction, so a mutation can succeed without an audit row.
* **Redaction:** `redactAudit()` (`lib/redact.ts`) recursively replaces the values of keys named `password, password_hash, pin, pin_hash, secret, admin_function_secret, admin_token, release_secret, otp, otp_code, token, refresh_token, api_key, paystack_secret_key, monnify_secret_key, vtpass_api_key, smtp_password` with `[redacted]`. Additionally, admin-settings masks `chatwoot_identity_key` as `[set]`.
  * `chatwoot_website_token` is **not** in the list, so it is logged in clear (it is public by design).
  * An `app-config` write of `chatwoot_identity_key` is **not masked**, because `redactAudit` doesn't know that key.
* **IP address:**
  * most routes store the raw `x-forwarded-for` header (can contain a spoofable client-supplied chain) or `'unknown'`;
  * login/login-failed store the parsed *last* XFF hop;
  * the transactions/withdrawals exports store none.
* **Device/user-agent:** not recorded.
* **Actor:** `admin_id` (for `LOGIN_FAILED`/`ADMIN_AUTO_DEACTIVATED` this is the *targeted* account, not an actor).
* **Retention:** unknown (outside this repo); no purge in the admin.
* **Immutability:** no UI or API can edit or delete audit rows. DB-level protection is outside this repo (the service role could modify them).

### 19.2 Event catalog (emitted by this codebase)

| Action | Route | Entity / entity_id | Before | After |
|---|---|---|---|---|
| `LOGIN` | POST /api/auth | admin_users / admin id | — | — (IP only) |
| `LOGIN_FAILED` | POST /api/auth | admin_users / target admin | — | — |
| `ADMIN_AUTO_DEACTIVATED` | POST /api/auth | admin_users / target admin | — | — |
| `LOGOUT` | POST /api/auth/logout | admin_users / self | — | — |
| `UPDATE_ADMIN_THEME` | PATCH /api/admin/theme | admin_users / self | — | `{theme}` |
| `CREATE_ADMIN` | POST admin-accounts | admin_users / new id | — | `{username,email,role_title,page_permissions}` |
| `EDIT_ADMIN` / `DEACTIVATE_ADMIN` / `REACTIVATE_ADMIN` / `REVOKE_ADMIN_SESSIONS` | PATCH admin-accounts | admin_users / id | email, role, perms, active, super, deleted_at | updates (+`token_version_bumped`) |
| `DELETE_ADMIN` | DELETE admin-accounts | admin_users / id | `{username,is_active,is_super_admin}` | — |
| `FREEZE_USER` / `UNFREEZE_USER` | PATCH users/[id] | users / id | `{is_frozen, freeze_reason}` | new values |
| `TERMINATE_USER_SESSIONS` | POST …/terminate | users / id | — | — |
| `EXPORT_CSV` | users (after_value), transactions/withdrawals (`diff`) | users/transactions/withdrawals | — | rows, filters |
| `APPROVE_CARD` / `OVERTURN_DISPUTE` | POST card-queue | card_submissions / id | full row | `{status:'approved', ...rpcArgs}` |
| `REJECT_CARD` | POST card-queue | card_submissions / id | full row | `{status, rejection_reason}` |
| `UPHOLD_DISPUTE` | POST card-queue | card_submissions / id | full row | `{status:'dispute_resolved'}` |
| `APPROVE_WITHDRAWAL` | POST approve | withdrawals / id | — | `{gateway_reference}` (only on gateway success) |
| `REJECT_WITHDRAWAL` | POST reject | withdrawals / id | — | `{reason}` |
| `CREATE_CARD` / `UPDATE_CARD` / `REORDER_CARDS` | cards | cards | row (update) | fields |
| `ADD_CARD_COUNTRY` / `UPDATE_CARD_COUNTRY` / `REMOVE_CARD_COUNTRY` | cards | cards (entity label is `cards` even for country rows) | row | fields |
| `CREATE_CARD_TYPE_TEMPLATE`, `UPDATE_CARD_TYPE_TEMPLATE`, `DELETE_CARD_TYPE_TEMPLATE` | field-builder | card_type_templates | row | fields |
| `CREATE_TEMPLATE_FIELD`, `UPDATE_TEMPLATE_FIELD`, `DELETE_TEMPLATE_FIELD`, `REORDER_TEMPLATE_FIELDS` | field-builder | card_type_template_fields | row | fields |
| `ADD_CARD_TYPE_TO_COUNTRY`, `REACTIVATE_CARD_TYPE_COUNTRY`, `SET_CARD_TYPE_COUNTRY_ACTIVE` | field-builder | card_types | — | fields |
| `CREATE_DENOMINATION`, `BATCH_UPDATE_RATES` | rates | denominations | map of rows | changes |
| `CREATE_COUPON`, `UPDATE_COUPON` | coupons | coupons | row | body/updates |
| `CREATE_GIFTBOX_ITEM`, `UPDATE_GIFTBOX_ITEM` | giftbox | giftbox_items | row | body/updates |
| `UPDATE_LEVEL_TIER` | levels | level_tiers | row | fields |
| `BROADCAST_NOTIFICATION` | broadcast | notification_broadcasts / broadcast_id | — | `{title, audience, recipient_count, delivered}` |
| `UPDATE_NOTIFICATION_TEMPLATE`, `UPDATE_EMAIL_TEMPLATE` | templates | templates / key | old | patch |
| `UPDATE_APP_CONFIG` | app-config | app_config / 'batch' | old values | changes |
| `UPDATE_ADMIN_SETTINGS`, `UPDATE_LIMITS_FEES`, `UPDATE_BILL_SETTINGS`, `UPDATE_PLATFORM_BALANCE`, `UPDATE_ANOMALY_ALERTS`, `UPDATE_SECURITY_LIMITS` | respective | app_config / 'batch' | **none** (only app-config records before values) | changes |
| `CLEAR_FLAG`, `ESCALATE_FLAG` | flagged-transactions | flagged_transactions / id | — | `{status}` |

### 19.3 Admin visibility (Admin Activity page)

* Viewer: day-grouped list of the latest 150 entries, an admin filter, a JSON before/after modal, and CSV/PDF export (5,000).
* Humanized labels come from `ACTION_LABEL`. **Map/emitter mismatches:**
  * `OVERTURN_CARD_DISPUTE` / `UPHOLD_CARD_DISPUTE` in the map vs `OVERTURN_DISPUTE` / `UPHOLD_DISPUTE` emitted;
  * the map has `CREATE_CARD_TYPE`, `UPDATE_CARD_TYPE`, `DELETE_CARD_TYPE`, `CREATE_FIELD`, `UPDATE_FIELD`, `DELETE_FIELD`, `REORDER_FIELDS`, which are not emitted (the emitted names are the `*_TEMPLATE*` variants);
  * `APPROVE_CARD_CORRECTED`, `GRANT_FEATURE_OVERRIDE` and `REVOKE_FEATURE_OVERRIDE` are never emitted by this code (legacy or RPC-side).
  * Unmapped actions fall back to title-casing, so they still display.
* `target_username` / `target_label` are resolved by RPC `list_admin_activity` (outside this repo).
* No search by target, entity or action; no date filter; no pagination.

### 19.4 Important actions lacking audit (or with weak audit)

1. Withdrawal approval when the payout call fails after the RPC succeeded (no row at all).
2. Card image/field **share, copy, download** (sensitive data egress).
3. Admin activity export (CSV/PDF).
4. Viewing PII/financial details (user profile, withdrawal account numbers, card codes). Reads are never audited.
5. File uploads (logo/badge) as separate events.
6. Config routes other than app-config don't store **before** values, so a config change can't be reverted from the log alone.
7. Transactions/withdrawals export audit rows use `diff` and omit the IP. If the table has no `diff` column, the insert fails silently.
8. The PDF export is logged as `EXPORT_CSV`.
9. Broadcast message bodies are not captured.
10. Theme changes are audited (noise), while security-relevant reads are not.

---

## 20. Security

### 20.1 Authentication

| Aspect | Implementation | Assessment |
|---|---|---|
| Credential check | email + username + password; bcrypt(12); dummy-hash timing equalization for unknown accounts | Good |
| Brute-force | IP 20/10 min; account 10/30 min (RPC `check_rate_limit_by_key`); alert at 5 fails/30 min; **auto-deactivation at 25 fails/24 h** | The rate-limit RPC **fails open** (`rlOk === false` check). Auto-deactivation lets an attacker **lock out any admin** whose username + email they know (DoS), and reactivation needs another super admin |
| MFA | none | **Missing** — high risk for a financial back-office |
| Password policy | 12–128 chars; lower/upper/digit/symbol (create/edit only) | Good, but no breach check and no rotation |
| Password reset | none | Missing |
| Session | JWT HS256, 8 h web / 24 h mobile, httpOnly + SameSite=Strict + Secure (prod) cookie | Good. No idle timeout. No refresh |
| Revocation | `token_version` checked on every request; active flag checked | Good. Logout revokes **all** sessions of that admin (intended?) |
| JWT secret | `ADMIN_JWT_SECRET` env; `new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!)` | No startup assertion that the secret is set. If it is unset, `TextEncoder.encode(undefined)` yields an empty key, so misconfiguration only surfaces at runtime |
| Account enumeration | Identical 401 for unknown/inactive/wrong-password; 429 is keyed by account | OK |

### 20.2 Authorization

* Server-side per-route checks exist on all 40 routes (§10). **No route lacks an auth check.**
* Page gating is client-only (Shell). This is acceptable because the data comes via checked APIs.
* Inconsistent status codes: Card Queue returns 401 for insufficient permission; most others return 403.
* **Scope creep via a single key:** `card_queue` grants approving and crediting money (bounded by `max_card_approval_naira` in the RPC). `withdrawals` grants payouts. There is no maker-checker / dual control for large payouts.
* `ALLOWED_PERMISSIONS` accepts keys that grant nothing (confusing).

### 20.3 CSRF

* `proxy.ts` rejects cross-origin state-changing `/api/*` requests using `Sec-Fetch-Site`/`Origin`. The cookie is `SameSite=Strict`. **Adequate.**
* Bypass condition: `Authorization: Bearer …` + `x-client: mobile-admin`. If the Bearer token is invalid, `verifyAdminFromRequest` **falls back to the cookie** (`jwt.ts:54-64`). A cross-site attacker can't set these headers without a CORS preflight (no CORS is configured), and SameSite=Strict blocks the cookie anyway. This is a defense-in-depth gap, not an exploitable issue.
* GET endpoints are state-free, except that export GETs write audit rows (benign).

### 20.4 XSS / content injection

* React escaping everywhere. No `dangerouslySetInnerHTML` except the static theme no-flash script (with a nonce).
* Print/PDF HTML escapes `& < > "` (`printExport.ts:9-10`, `activity/page.tsx:481`).
* Email preview is an `<iframe sandbox="">` with `srcDoc` (scripts disabled). **Good.** Email HTML itself is unsanitized and sent to users (trusted-admin model).
* Strict CSP with nonce + `strict-dynamic`. `style-src 'unsafe-inline'` is required by the inline styles.
* Broadcast text: bidi override characters are stripped and NFKC is applied.
* Config URLs: https-only, control/bidi characters rejected.

### 20.5 Input validation

* Present: UUID checks on the users/withdrawals/monitor routes; allow-listed keys on config routes; numeric range checks for money fields (coupons, giftbox, levels, rates, max approval); string length caps (coupon, giftbox, templates, broadcast); search sanitization; upload type/size/magic checks.
* Gaps:
  * `card-queue ?id` not UUID-checked;
  * `card_type_id` for correction not verified to belong to the card (the RPC may check);
  * `field-builder` `input_type` and ids unvalidated;
  * rates POST `card_type_id`/`range_label` unvalidated;
  * platform-balance values unvalidated;
  * app version and emergency values unvalidated;
  * bonus/referral config values unvalidated;
  * PATCH routes without existence checks return success for unknown ids (admin-accounts, cards, coupons, giftbox, field-builder);
  * `req.json()` errors on malformed JSON produce unhandled 500s in most routes.

### 20.6 Rate limiting / API protection

* Only login and admin user-search are rate-limited.
* Exports (50k rows), dashboard (row-heavy sums every 5 s), Card Queue/Withdrawals polling and broadcast sends have **no limits**. A compromised or careless admin session can mass-export PII.

### 20.7 Sensitive data handling

| Data | Exposure | Notes |
|---|---|---|
| User PII (name, email, phone, country) | Users list/detail, exports (50k), activity monitor, broadcast picker | No field-level permissions, no masking, no read audit |
| Bank account numbers | Withdrawals list (plain), detail, exports | Not masked |
| Gift card codes/PINs (`submitted_fields`) and images | Card Queue detail; **share to WhatsApp/Telegram/email/clipboard; download** | No audit, no masking. Highest-risk egress path |
| Card images | 1 h signed URLs (fetchable by anyone holding the URL during that hour) | Acceptable, but shareable |
| Chatwoot identity key | Plain in Settings GET/UI for SA | Consider write-only |
| Admin JWT | Forwarded to the edge function `resume-withdrawal` as Bearer | Token disclosure to another component; acceptable if trusted, but broadens exposure |
| Service role key | Server-only | Good |
| Audit log | before/after JSON may include full rows (e.g. `card_submissions.*`, including `submitted_fields` codes) | `redactAudit` only covers the listed key names. **Card codes in `submitted_fields` are stored in audit before-values** |

### 20.8 File security

Magic-byte validation, extension allow-list, 5 MB limit, random filenames, and `upsert:false`. Buckets `card-logos` and `level-badges` are public (by design). No malware scanning. Orphaned files are never cleaned.

### 20.9 Other observations

* `X-Forwarded-For` trust: login uses the last hop (proxy-appended). Audit uses the raw header (spoofable prefix).
* `NoZoom` disables zoom (and `maximumScale: 1, userScalable: false`), which is an **accessibility (WCAG 1.4.4) concern**.
* Logout clears the cookies but not `admin_theme_resolved` (harmless).
* `/login` doesn't set `noindex` (low).
* No security event UI (alerts, flagged transactions, failed logins dashboard).

### 20.10 Findings summary (severity is the auditor's judgement)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| S1 | No MFA for admins of a money-moving platform | High | §20.1 |
| S2 | Card codes/images can be shared externally with no audit trail | High | `card-queue/page.tsx:80-162` |
| S3 | Targeted admin lockout via auto-deactivation (25 failed attempts / 24 h) | Medium | `api/auth/route.ts:93-102` |
| S4 | Withdrawal approval without an audit row when the payout fails | Medium | `withdrawals/[id]/approve/route.ts:53-64` |
| S5 | Generic `/api/app-config` bypasses specialized validations (IPs, invariants, secret privacy) | Medium (SA only) | `api/app-config/route.ts:41-99` |
| S6 | Audit inserts unchecked and non-transactional; some use a different column shape | Medium | §19.1 |
| S7 | Rate-limit RPC fails open | Medium | `api/auth/route.ts:28,39` |
| S8 | Mass PII export (50k) without extra confirmation, rate limit, or field minimization; bank account numbers unmasked | Medium | §17.3 |
| S9 | Audit before-values may contain sensitive `submitted_fields` | Medium | `api/card-queue/route.ts:158-162,181` |
| S10 | Raw XFF stored as the audit IP (spoofable) | Low | many routes |
| S11 | Chatwoot identity key readable in the UI | Low | `admin-settings/page.tsx:65,307-315` |
| S12 | No startup check for required secrets | Low | `lib/jwt.ts:5` |
| S13 | Zoom disabled (accessibility) | Low | `app/_ui/NoZoom.tsx`, `layout.tsx:27-32` |
| S14 | Disabling the current primary gateway/bill provider is not blocked server-side | Low | `admin-settings/route.ts:70-94` |

---

## 21. API / Backend Dependencies

### 21.1 Conventions shared by all route handlers

* **Auth helper:** `verifyAdminFromRequest()`. Many routes wrap it in an unused `getAdmin(_req)` and import unused `cookies`/`verifyAdminJWT`.
* **Error shape:** `{ error: string }` with 400 (validation), 401 (unauthenticated), 403 (forbidden), 404, 409 (state conflict), 429 (rate limit) or 500. **Supabase error messages are frequently passed through verbatim** (`error.message`), which leaks table/constraint details to the client.
* **Success shape:** `{ success: true, ... }` for mutations; resource-named arrays for reads.
* **Body parsing:** `await req.json()` without try/catch in most routes. Malformed JSON causes an unhandled 500. Exceptions: flagged-transactions, withdrawals reject, admin theme.
* **Transactions:** multi-step writes are never wrapped in DB transactions (they use separate PostgREST calls). Atomic logic exists only where it's delegated to RPCs.

### 21.2 Endpoint specifications

#### Auth & session

| Endpoint | Request | Response | Validation / rules | DB ops | Side effects |
|---|---|---|---|---|---|
| `POST /api/auth` | `{email, username, password}`; header `x-client: mobile-admin` optional | web: `{success}` + cookies; mobile: `{success, token, admin{id,username,email,role_title,is_super_admin,page_permissions,theme_preference}}` | 400 missing; 429 IP/account limit; 401 invalid | read `admin_users`; update `last_login_at`; possibly `is_active=false`; insert `audit_log`, `admin_alerts` | RPC `check_rate_limit_by_key` ×2 |
| `POST /api/auth/logout` | cookie | `{success}` + cleared cookies | — | `token_version += 1`; audit `LOGOUT` | Invalidates all sessions of the admin. Only cookie-based (a mobile Bearer logout is not supported here) |
| `GET /api/auth/me` | cookie/Bearer | `{admin{id,username,email,role_title,is_super_admin,page_permissions}}` | 401 if inactive | read `admin_users` | — |
| `PATCH /api/admin/theme` | `{theme: light\|dark\|system}` | `{success, theme}` + `admin_theme` cookie | 400 invalid | update `theme_preference`; audit | — |

#### Dashboard

| Endpoint | Response | Notes |
|---|---|---|
| `GET /api/dashboard` | `{stats: Record<string,number>, recent_submissions: [...]}` | Same logic as the web dashboard (`lib/dashboard.ts`). Any admin; stats filtered by permission |

#### Card queue

| Endpoint | Request | Response | AuthZ | Validation | DB / RPC | Side effects |
|---|---|---|---|---|---|---|
| `GET /api/card-queue` | `?status=<s>\|all`, `?search=`, or `?id=` | list: `{submissions:[…≤200]}`; detail: `{submission:{…, card_images[], dispute_images[] (signed), country_name, card_types_for_card[], field_labels{}}}` | `card_queue` else **401** | none on id/status | reads card_submissions, card_countries, card_types, denominations, card_type_fields; storage signed URLs | — |
| `POST /api/card-queue` | `{action: approve\|overturn\|reject\|uphold, submission_id, reason?, card_type_id?, amount_foreign?, correction_note?}` | `{success, result?}` | `card_queue` else 401 | 400 missing action/id; 404 not found; approve: amount > 0; reject: reason + pending; uphold: disputed; 409 races | approve/overturn: RPC `approve_card_submission`. reject: update submission, update/insert transaction, RPC `emit_notification`. uphold: update submission + transactions, `emit_notification` | audit |

#### Withdrawals

| Endpoint | Request | Response | Rules | DB / external |
|---|---|---|---|---|
| `GET /api/withdrawals` | `?id=` → detail; else `status, date_from, date_to, search, review=1, page, limit (default 25, max 100; the UI passes 200, which is clamped to 100)` | `{withdrawals, total, page, limit}` / `{withdrawal}` / CSV / `{rows}` | `withdrawals` | reads withdrawals, users, flagged_transactions |
| `POST /api/withdrawals/{id}/approve` | — | `{success, gateway_reference}` | UUID; status ∈ pending_review/held | RPC `admin_approve_withdrawal`; edge fn `resume-withdrawal` |
| `POST /api/withdrawals/{id}/reject` | `{reason}` (≤500, may be empty) | `{success}` | UUID; status ∈ pending_review/held/initiated | RPC `admin_reject_withdrawal` |

> **Pagination clamp note:** `clampPagination(page, limit, maxLimit = 100)` (`lib/sanitize.ts:9-13`) caps `limit` at **100**. The Withdrawals page requests `limit=200` but actually receives **at most 100 rows**. The "200" in the UI code is ineffective. The same helper serves Users/Transactions/Activity Log (25/page).

#### Transactions, users, activity monitor, audit

| Endpoint | Request | Response | AuthZ | Notes |
|---|---|---|---|---|
| `GET /api/transactions` | `search, type (csv), status, date_from, date_to, page, limit, csv=1, pdf=1` | `{transactions, total, page, limit, stats{totalCount,totalAmount,todayCount,todayAmount}}` / CSV / `{rows}` | `transactions_overview` | RPC `admin_transactions_stats` on every request (including exports) |
| `GET /api/users` | `search, date_from, date_to, page, limit, csv, pdf` | `{users[… balance, trades, avatar_url], total, page, limit}` | `users` | Signed avatar URLs; export uses RPC `count_user_transactions` |
| `GET /api/users/{id}` | — | `{user{…, balance}, stats{trades, withdrawals}, devices[20], logins[20], recentTransactions[10]}` | `users` | 400 invalid UUID; 404 |
| `PATCH /api/users/{id}` | `{action: freeze\|unfreeze, reason?}` | `{success}` | SA or `users_freeze` | 409 if `deleted_at`; reason 1–500 |
| `GET /api/user-activity-monitor` | `online=1, search, page, limit` | `{users[…is_online], total, online_count, page, limit}` | SA | 90 s window |
| `GET /api/user-activity-monitor/{id}` | — | `{user, sessions[30], transactions[30], withdrawals[20]}` | SA | |
| `POST /api/user-activity-monitor/{id}/terminate` | — | `{success}` | SA | RPC `terminate_user_sessions` |
| `GET /api/activity` | `format=json\|csv, limit (json ≤200 default 100; csv ≤5000), before, after, admin_filter` | `{activity, admins}` / CSV | `activity` | RPC `list_admin_activity(p_caller_admin_id, p_limit, p_before, p_after, p_admin_filter)`. An invalid date in `before`/`after` throws (500) |

#### Admin accounts

| Method | Body | Rules | Effect |
|---|---|---|---|
| GET | — | SA | `{admins:[id, username, email, role_title, page_permissions, last_login_at, is_active, is_super_admin, deleted_at]}` ordered by created_at |
| POST | `{username, email, password, role_title, page_permissions}` | SA; required; email regex; password policy; username 3–32; role 2–64; permission allow-list | insert (non-super, active) |
| PATCH | `{id, email?, password?, role_title?, page_permissions?, is_active?, revoke_sessions?}` | SA; not deleted; no self-deactivate/revoke; not the last active SA | update + optional `token_version` bump |
| DELETE | `{id}` | SA; target not SA; target inactive | soft delete |

#### Catalog

| Endpoint | Discriminator | Operations |
|---|---|---|
| `/api/cards` GET | — | brands + countries (N+1) |
| `/api/cards` POST | `type: card \| country` | create brand (`name ≤80`, `logo_url` https ≤500, `sort_order` 0–10000, `is_active`) / add country (code `[A-Z]{2,3}`, name ≤80, symbol ≤8; 409 duplicate) |
| `/api/cards` PATCH | `type: card \| country \| reorder` | update brand / update country / `ids[]` (≤200) → sort_order = index |
| `/api/cards` DELETE | `type: country` | hard delete country (only `country` supported) |
| `/api/cards/upload` POST | multipart `file` | logo upload → `{url}` |
| `/api/field-builder` GET | `card_id` (required) | templates (+fields, installs) + active countries |
| `/api/field-builder` POST | `type: template \| field \| add_country` | create template (sort = max+1) / create field (sort = max+1; `is_required` default true) / install into a country |
| `/api/field-builder` PATCH | `type: template \| field \| reorder_fields \| country` | update template (name also renames installs) / update field / reorder / toggle install |
| `/api/field-builder` DELETE | `type: template \| field` | delete template (unlink installs) / delete field |
| `/api/rates` GET | — | nested tree of active entities |
| `/api/rates` POST | `{card_type_id, range_label, min_value, max_value, rate_naira, is_active}` | create denomination (min ≤ max, all ≥ 0) |
| `/api/rates` PATCH | `{changes:[{id, rate_naira, is_active}]}` | batch update (non-atomic) |

#### Rewards

| Endpoint | Operations / rules |
|---|---|
| `GET /api/bonuses` | stats (4 counts) |
| `/api/giftbox` GET/POST/PATCH | list with claim counts / create (title ≤120, desc ≤1000, reward 0–1e8, condition ≤200, rules array) / update (rules sliced to 50). POST/PATCH trigger `bustPromoCache()` |
| `/api/levels` GET/PATCH | tiers + claim counts / update name (≤80), target_usd and bonus_naira (0–1e9), badge_url (https ≤500), is_active |
| `POST /api/levels/upload` | badge upload (cookie auth) |
| `/api/coupons` GET/POST/PATCH | list all / create / update (see §7.17). Trigger `bustPromoCache()` |
| `GET /api/referrals` | `{log[≤500], stats{total_referrals, pending_payout: 0, total_paid_out}}` via RPC `admin_referrals_stats` |

#### Communications

| Endpoint | Operations / rules |
|---|---|
| `GET /api/notifications/broadcast` | last 20 `notification_broadcasts` |
| `POST /api/notifications/broadcast` | validate → edge fn `broadcast-notification` → audit. Returns the edge fn JSON (`broadcast_id, recipient_count, delivered…`) |
| `GET /api/notifications/recipient-count?audience=` | RPC `resolve_broadcast_audience(p_audience)` → array length (+ anonymous tokens for `all_anon`) |
| `GET /api/notifications/user-search?q=` | ≥3 chars; RPC rate limit 60/min; ≤10 users |
| `/api/notification-templates` GET/PATCH | list / update title, body, is_active |
| `/api/email-templates` GET/PATCH | list / update subject, html, is_active |

#### Configuration

| Endpoint | Keys | AuthZ |
|---|---|---|
| `/api/app-config` GET `?keys=a,b` (or all keys if omitted) / PATCH `{changes}` | allow-list of ~60 keys (§15.2); unknown keys → 400 listing them | SA |
| `/api/admin-settings` GET/PATCH | 20 keys; unknown keys silently ignored | SA |
| `/api/limits-fees` GET/PATCH | 6 keys | SA |
| `/api/bill-settings` GET/PATCH | 4 keys | `bill_settings` |
| `/api/platform-balance` GET (6 keys) / PATCH (2 keys) | | `platform_balance` |
| `/api/anomaly-alerts` GET/PATCH | 9 keys | `anomaly_alerts` |
| `/api/security-limits` GET/PATCH | 4 keys | `security_limits` |
| `/api/flagged-transactions` GET `?status=` / POST `{action: clear\|escalate, flag_id}` | ≤200 rows with the user join; sets `status`, `reviewed_by`, `reviewed_at` | SA |

> **`GET /api/app-config` without `keys`** returns **every** `app_config` row, including private ones such as `chatwoot_identity_key`, to a super admin.

### 21.3 Postgres RPCs used (bodies outside this repo)

| RPC | Called from | Arguments | Purpose (inferred) |
|---|---|---|---|
| `check_rate_limit_by_key` | auth, user-search | `p_key, p_action, p_limit, p_window_secs` | Sliding-window rate limit; returns boolean |
| `approve_card_submission` | card-queue | `p_submission_id, p_admin_id, [p_card_type_id, p_amount_foreign, p_correction_note]` | Approve/credit (+correction, +coupon, +max-approval check, +notification) |
| `emit_notification` | card-queue | `p_user_id, p_template_key, p_type, p_vars` | Render template + push/in-app |
| `admin_approve_withdrawal` | withdrawals approve | `p_withdrawal_id, p_admin_id` | State transition before payout |
| `admin_reject_withdrawal` | withdrawals reject | `p_withdrawal_id, p_admin_id, p_reason` | Reject + refund |
| `terminate_user_sessions` | monitor | `p_user_id, p_admin_id` | End sessions |
| `list_admin_activity` | activity | `p_caller_admin_id, p_limit, p_before, p_admin_filter, p_after` | Audit rows + target resolution |
| `admin_transactions_stats` | transactions | — | Totals |
| `admin_referrals_stats` | referrals | — | Totals |
| `count_user_transactions` | users export | — | Per-user transaction counts |
| `resolve_broadcast_audience` | recipient-count | `p_audience` | Audience user ids |
| `edge_cache_delete` | all config routes | `p_key: 'app_config:public'` | Invalidate the cached public config |

### 21.4 Admin UI → Backend dependency map

| UI element | Calls | Tables / RPC / external |
|---|---|---|
| Login form | POST /api/auth | admin_users, audit_log, admin_alerts, `check_rate_limit_by_key` |
| Shell logout | POST /api/auth/logout | admin_users, audit_log |
| Theme switcher | PATCH /api/admin/theme | admin_users, audit_log |
| Dashboard (server) | lib/dashboard | card_submissions, withdrawals, transactions, users, coupons, giftbox_claims, referrals, wallets, cards, admin_users, card_countries |
| Card Queue list/detail/actions | /api/card-queue | card_submissions, cards, card_types, card_countries, denominations, card_type_fields, transactions, storage `card-images`, RPCs `approve_card_submission`, `emit_notification` |
| Withdrawals list/detail | GET /api/withdrawals | withdrawals, users, flagged_transactions |
| Withdrawals approve/reject | /api/withdrawals/{id}/… | RPCs + edge `resume-withdrawal` |
| Transactions | GET /api/transactions | transactions, users, RPC `admin_transactions_stats` |
| Users list/export | GET /api/users | users, wallets, transactions, storage `avatars`, RPC `count_user_transactions` |
| User detail/freeze | /api/users/{id} | users, wallets, transactions, withdrawals, device_logs, login_history |
| Activity Log | /api/user-activity-monitor… | users, login_history, transactions, withdrawals, RPC `terminate_user_sessions` |
| Admin Activity | GET /api/activity | RPC `list_admin_activity`, admin_users |
| Admins | /api/admin-accounts | admin_users, audit_log |
| Cards | /api/cards, /api/cards/upload | cards, card_countries, storage `card-logos` |
| Field Builder | /api/cards (GET), /api/field-builder | card_type_templates, card_type_template_fields, card_types, card_type_fields, card_countries |
| Rates | /api/rates | cards, card_countries, card_types, denominations |
| Bonuses | /api/app-config, /api/bonuses, /api/giftbox | app_config, user_level_claims, level_tiers, transactions, giftbox_items, giftbox_claims, edge `get-active-promos` |
| Levels | /api/levels, /api/levels/upload | level_tiers, user_level_claims, storage `level-badges` |
| Coupons | /api/coupons, /api/cards (GET), /api/app-config (terms) | coupons, cards, app_config, edge `get-active-promos` |
| Referrals | /api/app-config, /api/referrals | app_config, referrals, users, RPC `admin_referrals_stats` |
| Broadcast | /api/notifications/* | notification_broadcasts, users, user_push_tokens, RPCs, edge `broadcast-notification` |
| Push/Email templates | /api/notification-templates, /api/email-templates | notification_templates, email_templates |
| Balance | /api/platform-balance | app_config |
| Limits & Fees / Bill / Anomaly / Security / Settings | respective routes | app_config (+ `edge_cache_delete`) |

---

## 22. Database / Data Model

> The schema is **not in this repository**. Everything below is inferred from the columns the admin reads/writes. Types are inferred; constraints are noted only where the code relies on them (e.g. error code `23505`).

### 22.1 Admin-side tables

| Table | Key fields | Status fields | Audit/timestamps | Constraints / notes |
|---|---|---|---|---|
| `admin_users` | `id` (uuid), `username`, `email`, `password_hash`, `role_title`, `page_permissions` (jsonb array), `theme_preference`, `token_version` (int) | `is_active`, `is_super_admin`, `deleted_at` (soft delete) | `created_at`, `last_login_at` | Unique username (error text contains "unique"). Email is nullable in practice |
| `audit_log` | `id`, `admin_id` → admin_users, `action`, `entity`, `entity_id` (text; ids, 'batch', 'bulk', template keys), `before_value` (json), `after_value` (json), `ip_address` (text), *(`diff` json — referenced by 2 routes, may not exist)* | — | `created_at` | Append-only in practice |
| `admin_alerts` | `admin_id`, `severity`, `event_type`, `subject`, `detail` (json) | (unknown) | (unknown) | Written by login; read by nothing in this repo |
| `app_config` | `key` (unique, used as `onConflict`), `value` (text), `is_public` (bool) | — | `updated_at` | See §15.2 |

### 22.2 Users & money

| Table | Fields used | Status / enums observed | Relationships |
|---|---|---|---|
| `users` | `id, full_name, username, email, phone, country, referral_code, avatar_path, last_active_at, created_at, deleted_at, freeze_reason` | `is_active`, `is_frozen`, `deleted_at` (deletion in progress) | 1–1 wallets; 1–* transactions, withdrawals, card_submissions, device_logs, login_history, referrals |
| `wallets` | `balance` (+ user FK) | — | embedded as `wallets(balance)` (the code handles both array and object shapes) |
| `transactions` | `id, user_id, type, amount, status, reference_id, metadata (json), created_at, idempotency_key, session_id` | type ∈ {giftcard_credit, withdrawal, withdrawal_refund, airtime, data, cable, electricity, signup_bonus, giftbox_bonus, referral_bonus, bonus_redeem, level_bonus}; status ∈ {pending, pending_review, success, failed, …} | `reference_id` → card_submissions.id for giftcard_credit |
| `withdrawals` | `id, user_id, amount, bank_name, account_number, account_name, gateway, gateway_reference, failure_reason, created_at, session_id` | status ∈ {initiated, pending_review, held, processing, success, failed, refunded} | — |
| `flagged_transactions` | `id, user_id, transaction_id, transaction_type, amount, flag_reason, reviewed_by (admin), reviewed_at, created_at` | status ∈ {?, cleared, escalated} (initial value unknown) | → users |
| `device_logs` | `user_id, device_model, os_version, app_version, ip_address, created_at, last_seen_at, login_count` | — | |
| `login_history` | `id, user_id, session_id, ip_address, device_model, os_version, app_version, device_fingerprint, created_at, ended_at` | active if `ended_at` null | |
| `user_push_tokens` | `token, user_id` (nullable = anonymous) | — | |

### 22.3 Gift card catalog & trading

| Table | Fields used | Status | Relationships / notes |
|---|---|---|---|
| `cards` | `id, name, logo_url, sort_order, created_at` | `is_active` | 1–* card_countries, card_types, card_type_templates |
| `card_countries` | `id, card_id, country_code, country_name, currency_symbol` | `is_active` | Unique (card_id, country_code) (23505). Hard-deletable |
| `card_type_templates` | `id, card_id, name, sort_order` | `is_active` | 1–* template fields; 1–* card_types |
| `card_type_template_fields` | `id, template_id, label, input_type (text\|image\|image_text), is_required, sort_order` | — | |
| `card_types` | `id, card_id, country_code, name, template_id (nullable), sort_order` | `is_active` | 1–* card_type_fields, denominations |
| `card_type_fields` | `id, card_type_id, label, input_type, is_required, sort_order` | — | Copied from the template at install |
| `denominations` | `id, card_type_id, range_label, min_value, max_value, rate_naira` | `is_active` | No overlap constraint visible |
| `card_submissions` | `id, user_id, card_id, card_type_id, (denomination FK), amount_foreign, payout_naira, rate_at_submission, submitted_fields (json), card_images (text[] paths), dispute_message, dispute_images, coupon_code, coupon_bonus, rejection_reason, created_at` | status ∈ {pending, approved, rejected, disputed, dispute_resolved} | Coupon bonus is zeroed at credit time if the coupon was voided (comment `lib/dashboard.ts:55-56`) |

### 22.4 Rewards & communications

| Table | Fields used | Notes |
|---|---|---|
| `coupons` | `id, code (unique?), min_trade_amount_usd, expiry_date, type (card name), bonus_rate_naira, eligibility_rules (json), terms_of_use (text), use_count, created_at`, `is_active` | No delete |
| `giftbox_items` | `id, title, description, reward_naira, expiry_date, eligibility_condition, eligibility_rules (json), created_at`, `is_active` | |
| `giftbox_claims` | `id, item_id, claimed_at` (+ user) | |
| `level_tiers` | `id, tier_order, name, target_usd, bonus_naira, badge_url, updated_at`, `is_active` | 6 rows expected |
| `user_level_claims` | `id, tier_order, claimed_at` (+ user) | |
| `referrals` | `id, referrer_id, referee_id, created_at, first_trade_at, first_trade_completed, referrer_bonus_amount, referee_bonus_amount, referrer_credited, referee_credited` | |
| `notification_templates` | `key, title, body, description, variables (text[]), is_active, updated_at, updated_by` | |
| `email_templates` | `key, subject, html, description, variables, is_active, updated_at, updated_by` | |
| `notification_broadcasts` | `id, title, message, type, audience, recipient_count, delivered_count, failed_count, sent_at` | Written by the edge function |

### 22.5 Soft deletion, ownership, timestamps

* **Soft delete:** `admin_users.deleted_at`, `users.deleted_at` (externally set). All other deletes (card_countries, templates, template fields) are **hard deletes**.
* **Ownership / "updated_by":** only the template tables store `updated_by`. Other tables rely on `audit_log` for attribution. `flagged_transactions.reviewed_by` records the reviewer.
* **Timestamps:** `created_at` (most), `updated_at` (app_config, level_tiers, templates), `last_login_at`, `last_active_at`, `last_seen_at`, `claimed_at`, `sent_at`, `reviewed_at`, `first_trade_at`.

### 22.6 Storage buckets

| Bucket | Visibility | Written by admin? | Read by admin |
|---|---|---|---|
| `card-images` | private | no | 1 h signed URLs (card & dispute images) |
| `avatars` | private | no | 1 h signed URLs (users list) |
| `card-logos` | public | yes | public URL |
| `level-badges` | public | yes | public URL |

---

## 23. Error Handling

### 23.1 Server-side error classes

| Class | Where produced | Status | Message style |
|---|---|---|---|
| Validation | most mutation routes | 400 | Human-readable (e.g. "Reason too long (max 500 chars)") |
| Authentication | all routes | 401 "Unauthorized" | — |
| Permission | all routes | 403 "Forbidden" (Card Queue: **401 "Unauthorized"**) | — |
| Not found | users/[id], withdrawals, templates, card-queue submit | 404 | — |
| State conflict | card reject/uphold races, withdrawal status, user in deletion, duplicate country | 409 / 400 | — |
| Rate limit | login, user-search | 429 | "Too many attempts…" / "Too many requests" |
| CSRF | proxy | 403 `{error:'Origin not allowed'}` | — |
| DB / RPC errors | most routes | 500 (some 400) | **Raw Supabase `error.message`** passed through (card-queue approve, cards, coupons, etc.). Some routes mask it ("Something went wrong", "Could not approve") |
| Edge function failure | broadcast, approve withdrawal | edge fn status | edge fn `error`/`message` |
| Malformed JSON | most routes | unhandled 500 (Next default HTML/empty) | — |
| Timeouts | none configured (no `AbortController`, no fetch timeouts to edge functions) | — | A slow gateway blocks the approve request |

### 23.2 Client-side presentation per page

| Page | List/load failure | Mutation failure | Permission failure | Network failure |
|---|---|---|---|---|
| Login | — | Inline red text | — | **Unhandled** (button stuck) |
| Dashboard | Metrics show 0 | — | KPIs hidden | Next error boundary (none custom) |
| Card Queue | Silent (empty list) | `alert()` | Empty (401) | Unhandled promise rejection; loading may stick |
| Withdrawals | Silent | Inline banner in panel | Empty | Unhandled |
| Transactions | Silent | — | Empty | Unhandled |
| Users | Silent | — | Empty | Unhandled |
| User detail | "User not found" | Freeze: inline modal error; Unfreeze: **ignored** | "User not found" | Unhandled |
| Activity Log | Banner (403 special-cased) | Panel banner (terminate) | "Forbidden (super-admin only)" | Unhandled; detail errors invisible |
| Admin Activity | Error line | Export: `alert()` | "You do not have permission…" | Unhandled |
| Admins | Silent (403 → empty) | Form: inline; toggles: ignored; delete: inline | Empty table | Unhandled |
| Cards | Silent | Save: inline; toggle/add/remove/upload: **ignored** | Empty | Unhandled |
| Field Builder | Silent | **All ignored** | "No cards yet" | Unhandled |
| Rates | Silent | Batch: toast; add range: **ignored** | Empty | Unhandled |
| Bonuses | Partial data | Toasts (generic) | Config appears empty/off | Unhandled |
| Levels | Empty grid | Toast (server message) | Empty | Unhandled |
| Coupons | Silent | Toast (server message); terms: **ignored** | Empty | Unhandled |
| Referrals | Silent | Toast (generic) | Settings appear empty | Unhandled |
| Broadcast | History empty; count 0 | Toast (server message) | Empty / search silent | Unhandled |
| Templates | Empty | Toast | Empty | Unhandled |
| Balance / Limits / Bill / Anomaly / Security | Empty fields | Toast (server message) | Empty (Limits: "Forbidden" on save) | Unhandled |
| Settings | Empty | Toast | "Super-admin access only." | Unhandled |

**No global error boundary** (`error.tsx`) exists in the app. There is no retry UI, no offline detection, no session-expiry redirect for client fetches, and no request timeouts.

---

## 24. Loading / Empty / Success States

| Page | Initial loading | Skeleton type | Empty state text | First-use guidance | Success feedback | Disabled/processing |
|---|---|---|---|---|---|---|
| Login | — | — | — | — | Redirect | "Logging in..." |
| Dashboard | `loading.tsx` | KPI + table skeleton | "No submissions yet"; "No dashboard metrics for your permissions…" | — | — | — |
| Card Queue | yes | TableSkeleton (desktop), grey blocks (mobile); panel SkeletonLines | "No submissions" | — | Panel closes + list refresh (no toast) | Buttons disabled while busy; Confirm spinner |
| Withdrawals | yes | same | "No withdrawals" | — | Panel closes | Confirm buttons loading |
| Transactions | yes (every change) | TableSkeleton / blocks | "No transactions found" | — | — | Export buttons loading |
| Users | yes | TableSkeleton / blocks | "No users found" | — | — | Export loading |
| User detail | yes | SkeletonLines in 2 cards | "User not found" / "No transactions" / "No device logs" / "No login history" | — | Modal closes | "Unfreezing…", Freeze loading |
| Activity Log | yes | TableSkeleton (only when empty) | "No users"; panel "No sessions." / "None." | — | Reloads | "Terminating…" |
| Admin Activity | yes (first) | TableSkeleton | "No activity in this window." | — | — | Export loading |
| Admins | yes | TableSkeleton | "No admin accounts yet" | — | Panel closes | "Saving..." |
| Cards | yes | TableSkeleton | "No card brands yet"; panel "No countries added yet."; combobox "No matches" | — | Modal closes | Save loading; "Uploading..."; Add Country loading |
| Field Builder | templates only | SkeletonLines card | "No cards yet"; "Select a card brand…"; "No card types yet. Add one above."; "Not added to any country yet." | Subtitle explains the flow | Silent refresh | "Saving..." |
| Rates | yes | SkeletonLines | "No active cards found. Add cards first." | ✔ (points to Cards) | Toast "All changes saved ✓"; "No changes to save." | "Saving…"; add range disabled until complete |
| Bonuses | yes (whole page) | SkeletonLines | "No giftbox items yet." | — | Toasts | "Saving…" |
| Levels | yes | SkeletonLines | (none) | Subtitle | Toast | "Saving…", "Uploading…", "No Changes" disabled |
| Coupons | yes | SkeletonLines | "No coupons yet."; terms "No terms yet — add one above." | — | Toasts | "Saving..." |
| Referrals | yes | SkeletonLines | "No referrals yet" | — | Toasts | "Saving…" |
| Broadcast | history | TableSkeleton / SkeletonLines | "No broadcasts yet." | Variables help | Toast "Sent to N users" | "Sending…"; recipients "…" |
| Push Templates | yes | SkeletonLines | "No templates" | — | Toast "Saved" | Save disabled until dirty |
| Email Templates | yes | SkeletonLines | "No templates found" | — | Toast "Saved" | same |
| Balance | yes | SkeletonLines | Live: "—", "Never" | Mode explanation | Toast "Saved" | Tabs ignore clicks while saving |
| Limits / Bill / Anomaly / Security | yes | SkeletonLines | — | Field hints | Toast "Saved"; footer "ALL SAVED" / "N UNSAVED" | Save disabled when no changes |
| Settings | yes | SkeletonLines | — | Card subtitles | Toast "Saved" | Per-card "Saving…"; toggles disabled while saving |

Unused shared state components: `EmptyState` (icon/title/hint/actions) and `Spinner` exist in `_ui/Misc.tsx` and are **never used**. All empty states are plain text.

---

## 25. Responsive Behavior

### 25.1 Breakpoints and mechanisms

* A **single breakpoint: 768px**, used in CSS (`Shell.module.css:342`, `Misc.module.css:79`, `tokens.css:206`) and JS (`useIsMobile(768)`).
* ≤768px:
  * the sidebar becomes a drawer, the hamburger appears, and content padding drops to 16px;
  * `PageHeader` stacks;
  * inputs are forced to 16px font (iOS zoom prevention);
  * pages that use `useIsMobile` swap tables for card lists.
* There is **no tablet-specific treatment**. 769–1024px gets the full desktop layout with a 240px sidebar (collapsible to 64px), and tables scroll horizontally (`Table.module.css .wrap { overflow:auto }`).
* Zoom is disabled globally (viewport `maximumScale: 1, userScalable: false` and `NoZoom` JS handlers).
* **Hydration flash:** `useIsMobile` initializes `false`, so phones briefly render desktop tables before switching.

### 25.2 Per-page summary

| Page | Mobile strategy | Notes / problems |
|---|---|---|
| Login | none | **400px fixed card overflows <400px screens**; hard-coded light theme |
| Dashboard | KPI grid auto-fit; table scrolls | No card view for recent submissions |
| Card Queue | Card list | Toolbar wraps; lightbox full-screen; side panel 100vw |
| Withdrawals | Card list (`WithdrawalsMobile`) | Tabs scroll horizontally (7 tabs) |
| Transactions | Card list | Filter bar wraps into many rows (5 inputs + 2 buttons); no user link on mobile |
| Users | Card list (links) | — |
| User detail | none | Header row doesn't wrap; 3 tables scroll horizontally |
| Activity Log | Card list | — |
| Admin Activity | Grouped card buttons | Detail modal (lg, 720px) scales to 100% width |
| Admins | Card list | Side panel form is full width |
| Cards | Card list | Countries side panel with combobox works; the drag handle is hidden (desktop only) |
| Field Builder | none (flex wrap) | Brand list fixed 220px; template header rows of 5 controls can overflow on very narrow screens |
| Rates | none | Deep indentation (64px) + 130px inputs; cramped |
| Bonuses | 1-column grid; giftbox card list | Signup Bonus inner grid stays 2 columns; the giftbox modal grid stays 2 columns |
| Levels | grid minmax(300px) | Needs ≥332px viewport (300 + 2×16 padding); OK for most phones |
| Coupons | Card list | **Form grid stays 2 columns on mobile** (cramped inputs); terms modal fits |
| Referrals | Card list | Settings grid stays 2 columns |
| Broadcast | History card list | **Compose grid stays 2 columns** |
| Push/Email Templates | Card list | Wide panels (720px) cap at 100vw; the email iframe is 420px tall |
| Balance / Limits / Bill / Anomaly / Security | single-column forms | Fine |
| Settings | none | App Version grid stays 2 columns; gateway rows fine |

---

## 26. UI / Design System Audit

### 26.1 Foundations (`app/_ui/tokens.css`)

* **Themes:** light (default) and dark via `[data-theme]`. The theme mode (light/dark/system) is persisted in cookies and the DB. A no-flash inline script applies the resolved theme before paint. A theme transition class (250 ms).
* **Colors (semantic tokens):**
  * backgrounds `--bg-app/surface/subtle/muted/inverse`;
  * foregrounds `--fg-primary/secondary/tertiary/disabled/inverse/link`;
  * borders `--border-default/subtle/strong`;
  * accent (indigo `#5B5BD6` light / `#7373E8` dark) `--accent-base/hover/active/soft/fg`;
  * tone triplets (bg/fg/border) for success, warning, danger, info, neutral, purple;
  * focus ring; shadows xs–lg.
* **Typography:**
  * Inter (400–700) as `--font-sans`; JetBrains Mono (400–600) as `--font-mono`;
  * scale `--text-xs` 11px, `sm` 12, `base` 13, `md` 14, `lg` 16, `xl` 18, `2xl` 22, `3xl` 30, `4xl` 40;
  * weights 400/500/600/700; leading tight/snug/normal/relaxed.
  * A "developer console" aesthetic: mono uppercase micro-labels with letter-spacing for group labels, table headers, field labels and stat labels.
* **Spacing:** 4px scale `--space-0…20`.
* **Radii:** xs 3 … 2xl 16, pill.
* **Motion:** `--dur-fast/base/slow` (120/180/240 ms), ease-out/in-out.
* **Z-index:** base 0, raised 10, sticky 100, overlay 500, modal 1000, toast 2000, tooltip 3000.
* **Global:** focus-visible outline in the accent color; links in the link color; `.mono/.tabular` helpers.

### 26.2 Core components (see the §35 appendix for props)

Button (6 variants × 3 sizes, loading spinner, icons, icon-only), Card (+Header/Body/Footer), Badge (7 tones, 3 sizes, dot), FieldShell/Input/Textarea/Select, Toggle (switch), Tabs (segmented/underline, with counts), Modal (sm/md/lg/xl, static, footer), SidePanel (560/720), Table family (density, sticky, emphasis, mono, interactive/selected rows, TableEmpty, TableSkeleton), Skeleton/SkeletonLines, EmptyState, PageHeader, SectionTitle, Kpi/KpiGrid/KpiSkeleton, Spinner, Toast provider, ExportModal, ThemeProvider, NoZoom.

### 26.3 Consistency audit

| Area | Observation |
|---|---|
| Styling approach | Mix of CSS Modules (UI kit, Shell) and **extensive inline styles** in pages (most layout, every mobile card, detail rows, toasts). Tailwind is imported but unused |
| Hard-coded colors outside tokens | Login page (`#F7F7F7`, `#111111`, `#E53935`…), `TermsOfUseManager` (whole modal), orphan `_shared/RuleBuilder.tsx`, activity print HTML, `rgba(0,0,0,0.92)` lightbox. These **break dark mode** (Login, Terms modal) |
| Undefined token | `var(--bg-base)` used by 6 local toasts; not defined |
| Buttons | Mostly `Button`. Exceptions: login submit, TermsOfUseManager pill buttons, rule-builder chips (bonuses uses Button; orphan uses raw), field-builder brand list, broadcast variable chips, template variable chips (two styles), share menu items |
| Inputs | Mostly `Input/Select/Textarea`. Exceptions: login, Terms modal, native radios in card-queue/withdrawals/settings, the custom div-checkbox in Admins |
| Status indicators | Shared `StatusDot` + `statusTone`, but **5 local re-implementations** (dashboard, card-queue, withdrawals page, WithdrawalsMobile, and ad hoc labels). Tone mapping differs: shared maps `held` → warning while Withdrawals maps `held` → danger; the dashboard maps `disputed` → warning (the shared one → neutral) |
| Badges | `Badge` used in 3 places (Activity SUPER, Field Builder types/required). Otherwise StatusDot |
| Money formatting | Shared `formatNaira` + 4 local copies; the platform-balance page uses a different formatter (`toLocaleString(undefined, …)`) |
| Toasts | 3 systems (unused shared provider, 2 local styles) + `alert()` |
| Modals | `Modal` (most), `SidePanel` for detail/edit, inline "ConfirmBox" (withdrawals), inline reject panel (card-queue), custom Terms modal, native `confirm()`, inline create form (coupons, field builder) |
| Page headers | Consistent `PageHeader`, except back links (two styles: `<a>` mono caps vs `Link`) |
| Stat strips | Shared `StatStrip` + a local copy in Withdrawals |
| Export | `ExportModal` (3 pages) + a custom duplicate (Admin Activity) |
| Empty states | Plain text in `TableEmpty` or ad hoc divs; `EmptyState` unused |
| Loading | `TableSkeleton`/`SkeletonLines` on desktop; **grey translucent blocks (not shimmer)** in mobile lists |
| Icons | lucide-react. Some inline SVG duplicates (EyeIcon ×2, upload icon). Emoji/glyph icons: "⠿", "✕", "✓", "●/○", "›", "⚠" via lucide |
| Terminology | "Activity Log" vs "User activity monitor" vs "Admin Activity"; "Admins" vs "Admin Accounts"; "Balance" vs "Platform Balance"; "Settings" vs "Admin Settings"; "Push Templates" vs "Notification Templates"; "Cards" vs "Card & Country Management"; "Card type" (UI) vs "template" (API); "Trades" (all transactions); "Bonus (₦ flat)" vs `bonus_rate_naira`; "Disabled" (coupons) vs "Inactive" (others) vs "OFF"/"Off" (templates) |
| Accessibility | Modal has `role=dialog` + Esc but **no focus trap and no initial focus**; SidePanel the same. The custom checkboxes aren't focusable. Icon-only buttons in Field Builder lack `aria-label`. Status is conveyed by color + text (OK). Zoom is disabled. Tables have no captions. The lightbox has aria-labels |

---

## 27. Component Inventory

A summary. The complete per-component table with props and usages is in **§35**.

| Category | Reusable components (shared) | Page-local / duplicated implementations |
|---|---|---|
| Layout/shell | `Shell`, `ThemeSwitcher`, `AdminNotFound`, `PageHeader`, `SectionTitle` | Back links (2 styles) |
| Data display | `Table` family, `StatStrip`, `StatusDot`, `Kpi`/`KpiGrid`, `Badge`, `Card` family | `DetailRow` (card-queue, withdrawals), `InfoRow` (user detail), `DetailGrid`, `JsonCard` (activity), `MoneyRow` (monitor), `TypeLabel` ×2, `UserAvatar`, `CardLogo`, `CardStatus`, `UserStatus`, local `StatusDot`/`StatStrip`/`StatCell` (withdrawals) |
| Inputs | `Input`, `Select`, `Textarea`, `FieldShell`, `Toggle`, `Tabs` | Country combobox (cards), user picker (broadcast), custom checkbox (admins), `FieldForm` (field builder), `RuleBuilder` ×2, `RuleValue` ×2 |
| Overlays | `Modal`, `SidePanel`, `ExportModal` | `ApproveModal`, `ConfirmBox`, share popover, lightbox, Terms modal, activity export modal |
| Feedback | `Skeleton`, `SkeletonLines`, `TableSkeleton`, `KpiSkeleton`, `ToastProvider` (unused), `EmptyState` (unused), `Spinner` (unused) | 14 local toast implementations, `alert`/`confirm` |
| Mobile | — | 12 hand-rolled `*Mobile` list components |
| Utilities | `formatNaira`, `statusTone`, `useIsMobile`, `printTable`, `rangeToDates`, `sanitizeSearch`, `clampPagination`, `redactAudit` | `timeAgo` ×2 (different), `formatNaira` ×4, `rangeBounds`, `buildPrintHtml`, `statusTone` ×4, `csvCell`/`formatCSVField` ×3 |

**Unused props/features of shared components** (verified by search):
* `FieldShell.required` / `FieldShell.error`, and `Input/Select/Textarea.invalid`: **no field-level validation UI exists anywhere**.
* `Card.elevated`, `CardBody.tight`, `CardHeader.bare`.
* `Table.density`.
* `Tabs` item `count`.
* `Modal.hideClose` / `Modal.static`.
* `Kpi.delta`.
* `EmptyState`, `Spinner`, `useToast`.
* `asUuid` (`lib/sanitize.ts`).

### 27.1 Overlay index (every modal, drawer, popover and dialog)

| # | Page | Overlay | Kind | Trigger | Content / fields | Buttons | Confirmation / destructive warning | Close behavior | API | Success | Error | Loading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Card Queue | Card submission | SidePanel 560 | Row View/Approve/Reject, mobile card tap | Detail rows, fields, images, dispute, reason | Share, Approve/Reject or Overturn/Uphold | Uphold: none | ✕, Esc, scrim | GET `?id` | — | perpetual skeleton | SkeletonLines |
| 2 | Card Queue | Share menu | Popover | Share | 4–6 share targets | items | none | outside click | none | new tab/clipboard | `alert` | — |
| 3 | Card Queue | Inline reject panel | In-panel section | Reject | 6 preset radios + custom textarea | Confirm reject | Implicit (the panel itself) | Close panel | POST reject | Close + reload | `alert` | disabled while busy |
| 4 | Card Queue | Approve and credit | Modal md | Approve / Overturn | Credit summary; correction (type, amount, note presets + custom, computed payout) | Cancel, Confirm (disabled if invalid) | Shows the amount and user | ✕, Esc, scrim, Cancel | POST approve/overturn | Close + reload | `alert` | Confirm spinner |
| 5 | Card Queue | Image lightbox | Full-screen overlay | Thumbnail click | Image, prev/next | ✕ | — | click backdrop, ✕ (no Esc) | — | — | — | — |
| 6 | Withdrawals | Withdrawal | SidePanel | Row click / View / Approve / Reject | Detail rows, flag box, inline error | Approve, Reject | ConfirmBox (approve: amount + beneficiary; reject: refund note + reason) | ✕, Esc, scrim | POST approve/reject | Close + reload | Inline banner | Confirm loading |
| 7 | Withdrawals / Users / Transactions | Export | `ExportModal` md | Export | Time frame select, meta | Download CSV, Print / PDF | — | ✕, Esc, scrim | GET `csv=1`/`pdf=1` | Download / print window | CSV: none; PDF: `alert` (pop-up) | Button spinners |
| 8 | User detail | Freeze account | Modal sm | Freeze account | Warning text, reason textarea | Cancel, Freeze account (danger) | Consequence text | ✕, Esc, scrim, Cancel | PATCH freeze | Close + reload | Inline text | Freeze loading |
| 9 | Activity Log | Activity detail | SidePanel | Row click | Identity, Terminate, sessions, withdrawals, transactions | Terminate all sessions | native `confirm()` | ✕, Esc, scrim | GET `[id]`, POST terminate | Reload | Inline banner (hidden on load failure) | SkeletonLines / "Terminating…" |
| 10 | Admin Activity | Entry detail | Modal lg | View | WHO / WHEN / TARGET / CHANGES (JSON) / RAW | ✕ | — | ✕, Esc, scrim | — (row data) | — | — | — |
| 11 | Admin Activity | Export activity | Modal md (custom) | Export | Time frame, scope meta | Download CSV, Print / PDF | — | ✕, Esc, scrim | GET `format=csv/json` | Download / print | `alert` | Button spinners |
| 12 | Admins | Create / Edit admin | SidePanel | + Create Admin / Edit | Username, email, password ×2 (eye), role title, 22 page checkboxes | Create Account / Save Changes (footer) | none | ✕, Esc, scrim (**discards input**) | POST / PATCH | Close + silent reload | Inline text | "Saving..." |
| 13 | Admins | Delete admin | Modal sm | Delete (inactive rows) | "Type DELETE" input | Cancel, Delete (danger; enabled only on exact match) | Type-to-confirm + "cannot be undone" | ✕, Esc, scrim, Cancel | DELETE | Close + reload | Inline text | none |
| 14 | Cards | Add/Edit card brand | Modal md | Add Card Brand / Edit | Name, logo upload tile, Active toggle | Cancel, Save | none | ✕, Esc, scrim, Cancel | POST/PATCH `/api/cards`, POST upload | Close + reload | Inline text (save); upload errors ignored | Save loading; "Uploading..." |
| 15 | Cards | &lt;Brand&gt; — Countries | SidePanel | Countries | Country list (toggle, Remove); add form (combobox, symbol, currency name, active) | Add Country, Remove | **none for Remove** | ✕, Esc, scrim | POST/PATCH/DELETE country | Reload | **ignored** | Add Country loading |
| 16 | Cards | Country combobox | Dropdown | Focus / type | Filtered ISO list | option click | — | outside mousedown | — | fills fields | "No matches" | — |
| 17 | Field Builder | Delete Card Type | Modal sm | 🗑 on a template | Warning text | Cancel, Delete (danger) | Explains unlinking | ✕, Esc, scrim, Cancel | DELETE template | Close + refresh | ignored | none |
| 18 | Rates | Add Denomination Range | Modal sm | + Add Range | Label, min, max, rate, active | Cancel, Save (disabled until all filled) | none | ✕, Esc, scrim, Cancel | POST `/api/rates` | Close + reload | **ignored** | "Saving…" |
| 19 | Bonuses | Add/Edit Giftbox Item | Modal md | + Add Item / Edit | Title, description, reward, expiry, display description, RuleBuilder, active | Cancel, Save | none | ✕, Esc, scrim, Cancel | POST/PATCH `/api/giftbox` | Toast + close | Toast (generic) | "Saving…" |
| 20 | Coupons | Create/Edit coupon | **Inline card** (not an overlay) | + Create Coupon / Edit | See §7.17 | Cancel, Save Coupon | none | Cancel | POST/PATCH `/api/coupons` | Toast + hide | Toast | "Saving..." |
| 21 | Coupons | Terms of Use | Custom modal (not `Modal`) | Manage Terms of Use | Add input, list with Remove | Add, Remove, Done, ✕ | none | backdrop, ✕, Done (**no Esc**) | PATCH `/api/app-config` | Optimistic | **ignored** | Add disabled while saving |
| 22 | Broadcast | User picker | Dropdown | Typing in Search User | ≤10 hits | select | — | select / Clear | GET user-search | chip shown | silent | — |
| 23 | Push Templates | Edit template | SidePanel wide | Edit / mobile tap | Description, title, body, variable chips, preview, active | Cancel, Save Changes (disabled until dirty) | none | ✕, Esc, scrim (**discards edits**) | PATCH | Toast + close | Toast | "Saving…" |
| 24 | Email Templates | Edit email template | SidePanel wide | Edit / mobile tap | Description, subject, variable buttons ×2, HTML, sandboxed preview iframe, active | Cancel, Save Changes | none | same | PATCH | Toast + close | Toast | "Saving…" |
| 25 | Settings | Enable/Disable Emergency Mode | Modal sm | Emergency button | Consequence text | Cancel, Confirm (danger when enabling) | ✔ | ✕, Esc, scrim, Cancel | PATCH `/api/admin-settings` | Close + toast | Toast | "Working…" |
| 26 | Shell | Mobile nav drawer | Off-canvas | Hamburger | Nav, identity, logout | — | — | scrim, route change | — | — | — | — |

Modal and SidePanel have **no focus trap and no initial focus management**. Scroll locking of the page behind overlays is not implemented.

### 27.2 Table index

| # | Page | Table | Columns | Sort | Pagination | Selection/bulk | Export | Mobile variant |
|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard | Recent card submissions | User, Card, Country, Payout, Submitted, Status, Actions | fixed | none (10) | ✘ | ✘ | ✘ (scroll) |
| 2 | Card Queue | Submissions | User, Card, Country, Type, Value, Payout, Submitted, Status, Actions | fixed | none (200) | ✘ | ✘ | ✔ |
| 3 | Withdrawals | Withdrawals | User, Amount, Bank, Account, Gateway ref, Requested, Status, Actions | fixed | none (100) | ✘ | ✔ | ✔ |
| 4 | Transactions | Transactions | User (link), Type, Amount, Status, Reference, Date | fixed | 25/page | ✘ | ✔ | ✔ |
| 5 | Users | Users | User (sticky), Email, Phone, Balance, Trades, Status, Joined, Actions | fixed | 25/page | ✘ | ✔ | ✔ |
| 6–8 | User detail | Recent transactions / Device logs / Login history | see §7.8 | fixed | none (10/20/20) | ✘ | ✘ | ✘ |
| 9 | Activity Log | Users by activity | User, Email, Last active, Status, › | fixed | 25/page | ✘ | ✘ | ✔ |
| 10 | Admin Activity | Audit (day-grouped) | Admin, Action, Target, When, Detail | fixed | none (150) | ✘ | ✔ | ✔ |
| 11 | Admins | Admins | Username, Email, Role Title, Assigned Pages, Last Login, Status, Actions | fixed | none | ✘ | ✘ | ✔ |
| 12 | Cards | Brands | Logo, Card Name, Countries, Status, Sort Order, Actions | sort_order | none | ✘ | ✘ | ✔ |
| 13 | Rates | Denomination accordion (not a table) | Range, Rate, Active | min_value | none | batch save | ✘ | ✘ |
| 14 | Bonuses | Giftbox items | Title, Description, Reward, Expiry, Rules, Claims, Status, Actions | created desc | none | ✘ | ✘ | ✔ |
| 15 | Coupons | Coupons | Code, Min, Type, Reward, Expiry, Uses, Status, Actions | created desc | none | ✘ | ✘ | ✔ |
| 16 | Referrals | Referral log | Referrer, Referee, Referred On, First Trade, Bonus, Status | created desc | none (500) | ✘ | ✘ | ✔ |
| 17 | Broadcast | Recent broadcasts | Title, Message, Audience, Delivered, Sent | sent desc | none (20) | ✘ | ✘ | ✔ |
| 18 | Push Templates | Templates | Key, Title, Body, Active, Actions | key | none | ✘ | ✘ | ✔ |
| 19 | Email Templates | Templates | Key, Subject, Active, Actions | key | none | ✘ | ✘ | ✔ |

No table offers column sorting, column visibility, row selection, page-size choice or sticky headers beyond the default `thead` sticky style.

### 27.3 Form index

| # | Page | Form | Mode | Submit | Validation location | Field-level errors |
|---|---|---|---|---|---|---|
| 1 | Login | Login | — | POST /api/auth | server (+ silent client non-empty) | ✘ (single message) |
| 2 | Card Queue | Reject reason | create | POST card-queue | client non-empty + server | ✘ (`alert`) |
| 3 | Card Queue | Approve correction | edit | POST card-queue | client (denomination match, note) + server (amount > 0) | ✘ (Confirm disabled) |
| 4 | Withdrawals | Reject reason | create | POST reject | client only | ✘ (banner) |
| 5 | Transactions | Filters | — | Apply | none | — |
| 6 | User detail | Freeze reason | create | PATCH | client + server | ✘ (text under field) |
| 7 | Admins | Create/Edit admin | both | POST/PATCH | client (required, match, email) + server (policy, lengths, keys) | ✘ (single message) |
| 8 | Admins | Delete confirm | — | DELETE | client (text match) | — |
| 9 | Cards | Brand | both | POST/PATCH | client (name) + server | ✘ |
| 10 | Cards | Add country | create | POST | client (all filled) + server | ✘ (ignored) |
| 11 | Field Builder | Card type name (add/rename) | both | POST/PATCH | client non-empty | ✘ |
| 12 | Field Builder | FieldForm | both | POST/PATCH | client non-empty label | ✘ |
| 13 | Rates | Inline rates | edit | PATCH batch | server (≥0) | ✘ (toast) |
| 14 | Rates | Add range | create | POST | client (filled) + server | ✘ (ignored) |
| 15 | Bonuses | Signup/levels config | edit | PATCH app-config | none | ✘ |
| 16 | Bonuses | Giftbox item | both | POST/PATCH | client (title, reward) + server | ✘ (toast) |
| 17 | Levels | Tier | edit | PATCH | server | ✘ (toast) |
| 18 | Coupons | Coupon | both | POST/PATCH | client (code, type) + server | ✘ (toast) |
| 19 | Coupons | Terms of Use | add/remove | PATCH app-config | client (non-empty, unique) | ✘ |
| 20 | Referrals | Settings | edit | PATCH app-config | none | ✘ |
| 21 | Broadcast | Compose | create | POST | client (required, maxLength) + server | ✘ (toast) |
| 22 | Push Templates | Template | edit | PATCH | server | ✘ (toast) |
| 23 | Email Templates | Template | edit | PATCH | server | ✘ (toast) |
| 24 | Balance | Static balance | edit | PATCH | client (≥0) | ✘ (toast) |
| 25 | Limits & Fees | Limits | edit | PATCH | server | ✘ (toast) |
| 26 | Bill Settings | Bill | edit | PATCH | server | ✘ (toast) |
| 27 | Settings | 8 section forms | edit | PATCH | client (some) + server | ✘ (toast) |
| 28 | Anomaly & Alerts | Thresholds | edit | PATCH | server | ✘ (toast) |
| 29 | Rate Limits & IPs | Limits/IPs | edit | PATCH | server | ✘ (toast) |

**No form in the admin shows field-level (inline, per-input) validation errors.** No rich-text editor exists (the email HTML is a raw textarea). The only file inputs are the logo and badge uploads. Multi-selects: the permissions checklist (Admins). Toggles: 12 pages.

---

## 28. Workflow Specifications

### 28.1 Admin login

1. Admin opens any URL → `(dashboard)/layout` finds no or invalid cookie → redirect `/login`.
2. Enters email, username, password → **Login**.
3. `POST /api/auth`: rate limits → lookup → bcrypt → (fail: audit, alert, maybe auto-deactivate → 401) → (success: `last_login_at`, audit `LOGIN`, JWT, cookies).
4. Client → `router.push('/dashboard')` → layout verifies the JWT and DB row → Shell renders the nav filtered by permissions; the theme applies from the cookie.
5. Session ends after 8 h (no warning), on logout, on a password/permission/role change by an SA, or on deactivation.

### 28.2 Logout

Sidebar ⎋ → `POST /api/auth/logout` (bumps `token_version`: **all devices logged out**; audit `LOGOUT`; cookies cleared) → `/login`. No confirmation. Not available while the desktop sidebar is collapsed.

### 28.3 Gift card review — approve

1. Card Queue (Pending tab, polling 5 s) → row **Approve** (or View → Approve).
2. The detail panel loads (signed images, fields); the Approve modal shows "Credit ₦(payout+coupon) to @user?".
3. Optional **correction**: pick another type of the same card and/or a new foreign amount → the client finds the matching denomination → the new payout preview → a required note.
4. **Confirm** → `POST /api/card-queue {action:'approve', …}` → RPC `approve_card_submission` (credit wallet, set status, apply the coupon, enforce `max_card_approval_naira` for non-SA, notify — inside the RPC) → audit `APPROVE_CARD`.
5. The panel closes, the list reloads. Errors → `alert(message)` (e.g. an escalation error from the RPC).

### 28.4 Gift card review — reject

1. **Reject** → the inline reason panel → pick a preset or type a custom reason → **Confirm reject**.
2. Server:
   1. verifies the status is pending;
   2. conditional update to `rejected`;
   3. marks the giftcard_credit transaction failed (or inserts a failed one);
   4. `emit_notification('card_rejected', {card_label, reason})`;
   5. audit `REJECT_CARD`.
3. The panel closes, the list reloads.

### 28.5 Dispute resolution

* Dispute queue tab → View → read the dispute message and evidence images →
  * **Overturn (approve + credit)** → the approve modal (optional correction) → `action:'overturn'` → the same RPC → audit `OVERTURN_DISPUTE`; **or**
  * **Uphold** (no confirmation) → status `dispute_resolved`, transactions failed, notification `dispute_closed`, audit `UPHOLD_DISPUTE`.

### 28.6 Withdrawal approval

1. Withdrawals (Review tab) → **Approve** → panel ConfirmBox "Approve withdrawal of ₦X? This will fire the gateway transfer to &lt;name&gt; (&lt;bank&gt;)." → **Confirm approve**.
2. `POST /api/withdrawals/{id}/approve`:
   1. status check;
   2. RPC `admin_approve_withdrawal`;
   3. edge fn `resume-withdrawal` (gateway transfer);
   4. on success, audit `APPROVE_WITHDRAWAL {gateway_reference}`.
3. Success → the panel closes. Failure → an inline error ("Could not approve" or the gateway message). **If the gateway fails after step 2, the withdrawal may be left in a post-approval state with no audit and no retry button.**

### 28.7 Withdrawal rejection

Reject → ConfirmBox with the preset or custom reason (client-required, ≤500) → `POST …/reject` → RPC `admin_reject_withdrawal` (refunds to the wallet per the UI copy) → audit `REJECT_WITHDRAWAL`.

### 28.8 User suspension (freeze) and reinstatement

* **Freeze:**
  1. Users → search → View → **Freeze account** → the modal requires a reason → **Freeze account**.
  2. `PATCH /api/users/{id}` (requires SA/`users_freeze`; blocked if in deletion) → `is_frozen=true` + reason → audit `FREEZE_USER`.
  3. The profile shows "Frozen" + the reason banner.
* **Unfreeze:** **Unfreeze** (no confirmation) → PATCH → audit `UNFREEZE_USER`. Errors are not displayed.
* **Deletion / deactivation of users:** not available.

### 28.9 Force logout of a user

(SA only) Activity Log → search/online-only → click the user → the panel shows sessions → **Terminate all sessions** → native confirm → RPC `terminate_user_sessions` → audit → the panel and list refresh.

### 28.10 Admin creation and role/permission assignment

1. (SA) Admins → **+ Create Admin** → the side panel: username, email, password ×2, role title, assigned pages (≥1) → **Create Account**.
2. Server: validations + password policy + permission allow-list → insert → audit `CREATE_ADMIN`.
3. The new admin logs in with username + email + password. There is **no invite email or forced password change**.
4. **Modify permissions:** Edit → toggle pages → **Save Changes** → PATCH → `token_version` bump (the admin is logged out everywhere) → audit `EDIT_ADMIN` (before/after permissions).

### 28.11 Admin deactivation, reactivation, deletion

* Deactivate (no confirmation) → PATCH `is_active=false` → immediate lockout → audit.
* Reactivate → PATCH `is_active=true`.
* Delete: only when inactive → the modal requires typing DELETE → soft delete → audit. Permanent from the UI.

### 28.12 Catalog setup (new card brand end-to-end)

1. **Cards** → Add Card Brand (name, logo upload, active) → Countries → add each country (combobox → symbol).
2. **Field Builder** (needs `card_management` too) → select the brand → Add Card Type (name) → expand → Add Field(s) (label, type, required) → "+ &lt;country&gt;" to install the template into each country (copies the fields) → toggle per-country pills.
3. **Rates** → expand brand → country → type → "+ Add Range" (label, min, max, rate, active) → adjust the rates inline → **Save All Changes**.
4. Pitfalls:
   * editing template fields after step 2 does not update installed countries;
   * a failed range add is silent;
   * inactive brands/countries/types are hidden from Rates.

### 28.13 Coupon lifecycle

Create (code, min trade, expiry, card, terms, bonus, status, optional "has traded X") → table → Edit/Disable/Enable while unexpired → after expiry: read-only ("Expired"), no actions. The promo cache is busted on each write. Terms of Use are managed in a separate modal (SA only).

### 28.14 Giftbox item lifecycle

Bonuses → + Add Item (title, description, reward, expiry, display description, rules, active) → table → Edit / Deactivate / Activate. No delete. The promo cache is busted.

### 28.15 Level tier configuration

Levels → edit name/target/bonus/active → **Save Tier**. Upload Badge → instant upload and save.

### 28.16 Broadcast

Broadcast → audience (count shown) → type → [specific: search user] → title/message (+variables) → **Send Broadcast** (no confirm) → edge fn → audit → toast "Sent to N users" → history row.

### 28.17 Template edit (push/email)

Templates → Edit → side panel → edit (variables append) → preview → Save Changes → audit → toast. Takes effect immediately in production.

### 28.18 Configuration change (typical)

Config page → edit fields (draft) → footer shows "N UNSAVED" → **Save Changes** → PATCH (validated per route) → upsert `app_config` → `edge_cache_delete` → audit → toast "Saved" → refetch. There is no preview, diff, rollback, or change approval.

### 28.19 Emergency mode

Settings → **Enable Emergency Mode** → confirmation modal (consequences text) → Confirm → `emergency_mode='true'` → cache invalidated → all apps show maintenance and withdrawals/bills are refused (per the UI copy; enforcement is outside this repo). Disable via the same flow.

### 28.20 Payment gateway switch

Settings → Payment Gateways → toggle a gateway on → select its **Primary** radio (saves immediately) → the server verifies it is enabled → audit. Disabling the current primary is blocked in the UI (a toast) but not in the API.

### 28.21 Data export

List page → **Export** → choose a time frame → **Download CSV** (up to 50k rows; audited as EXPORT_CSV) or **Print / PDF** (JSON → print window). Admin Activity uses its own modal (5k rows; not audited).

### 28.22 Error resolution (as supported)

* Failed card action → retry the same action (the alert shows the message).
* Failed payout → **no retry path in the UI**. The status/failure reason is visible; resolution requires a backend or manual process.
* Flagged withdrawal → the flag is visible in the detail; **clear/escalate is not available in the UI**.
* Stuck referral payouts → no action.

---

## 29. Feature Completeness Matrix

Legend: ✔ yes · ◐ partial · ✘ no · n/a not applicable.

| Feature | Exists | UI Exists | Backend Exists | Permissions | Validation | Audit Logging | Error Handling | Complete | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Admin login | ✔ | ✔ | ✔ | n/a | ✔ | ✔ (LOGIN/LOGIN_FAILED) | ◐ (network errors unhandled) | ◐ | No MFA/reset; 400px card overflows on phones |
| Admin logout | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | ◐ | ✔ | Logs out all devices; hidden in collapsed rail |
| Theme preference | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (noisy) | ◐ | ✔ | |
| Dashboard KPIs | ✔ | ✔ | ✔ | ✔ per KPI | n/a | n/a | ✘ (errors = 0) | ◐ | Row-cap sums, timezone, 5 s refresh, wrong pending-withdrawal status |
| Card queue list/search | ✔ | ✔ | ✔ | ✔ (401) | ◐ | n/a | ✘ silent | ◐ | Search limited to the latest 200 |
| Card approve (+correction) | ✔ | ✔ | ✔ (RPC) | ✔ | ◐ (note client-only) | ✔ | ◐ (alert) | ✔ | |
| Card reject | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | Non-atomic multi-step |
| Dispute overturn/uphold | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (label mismatch) | ◐ | ◐ | Uphold has no confirmation |
| Card data sharing | ✔ | ✔ | client-only | ✔ (page) | n/a | ✘ | ◐ (alert) | ◐ | Sensitive egress |
| Withdrawals list/detail | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✘ silent | ◐ | 100-row cap; `initiated` has no tab |
| Withdrawal approve | ✔ | ✔ | ✔ (RPC + edge) | ✔ | ✔ | ◐ (none on gateway failure) | ✔ inline | ◐ | No retry for failed payouts |
| Withdrawal reject | ✔ | ✔ | ✔ | ✔ | ◐ (reason client-only) | ✔ | ✔ | ✔ | |
| Flagged transaction review | ✔ | ◐ (flag badge only) | ✔ (SA) | ✔ SA | ✔ | ✔ | n/a | ✘ | **Backend-only** actions |
| Transactions ledger | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✘ silent | ◐ | No detail/metadata; stats unfiltered |
| Exports (users/tx/withdrawals) | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (tx/wd shape; PDF as CSV) | ◐ | ◐ | 50k cap; no BOM |
| Admin activity export | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ | ◐ | |
| Users list/search | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✘ silent | ◐ | "Trades" = all tx; double fetch |
| User profile | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ◐ | ◐ | No links, no avatar |
| Freeze / unfreeze user | ✔ | ✔ | ✔ | ◐ (`users_freeze` unassignable) | ✔ | ✔ | ◐ (unfreeze errors ignored) | ◐ | |
| User sessions view/terminate | ✔ | ✔ | ✔ | ◐ (SA only; nav key misleading) | ✔ | ✔ | ◐ (detail errors invisible) | ◐ | |
| User edit / delete / wallet adjust | ✘ | ✘ | ✘ | (`manual_wallet_credit` key only) | — | — | — | ✘ | Missing |
| Admin CRUD | ✔ | ✔ | ✔ | SA | ✔ | ✔ | ◐ (toggles ignored) | ◐ | Email can be nulled; no SA management |
| Admin session revoke | ✔ | ✘ | ✔ | SA | ✔ | ✔ | n/a | ✘ | **Backend-only** |
| Admin MFA / password reset | ✘ | ✘ | ✘ | — | — | — | — | ✘ | Missing |
| Audit log viewer | ✔ | ✔ | ✔ (RPC) | ✔ | ✔ | n/a | ✔ | ◐ | 150 rows, admin filter only |
| Card brands | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ (toggle/upload silent) | ◐ | No delete |
| Card reorder | ✔ | ◐ (fake handle) | ✔ | ✔ | ✔ | ✔ | n/a | ✘ | **UI placeholder + backend-only** |
| Card countries | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ silent | ◐ | Currency name not saved; delete without confirm |
| Card type templates/fields | ✔ | ✔ | ✔ | ◐ (needs card_management) | ◐ | ✔ | ✘ silent | ◐ | No sync to installs; no reorder UI |
| Template → country install | ✔ | ✔ | ✔ | ◐ | ◐ | ✔ | ✘ silent | ◐ | |
| Rates edit | ✔ | ✔ | ✔ | ✔ | ◐ (blank → 0) | ✔ | ◐ | ◐ | Non-atomic; no confirm |
| Denomination add | ✔ | ✔ | ✔ | ✔ | ✔ (server) | ✔ | ✘ silent | ◐ | |
| Denomination edit range/delete | ✘ | ✘ | ✘ | — | — | — | — | ✘ | Missing |
| Signup bonus / levels toggle | ✔ | ✔ | ✔ | ◐ (SA via app-config) | ✘ (no value validation) | ✔ | ◐ generic | ◐ | |
| Giftbox items | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ generic | ◐ | No delete |
| Level tiers + badges | ✔ | ✔ | ✔ | ✔ (upload cookie-only) | ◐ (SVG mismatch) | ✔ | ✔ | ◐ | Fixed 6 tiers |
| Leaderboard | ✘ | placeholder | ✘ | — | — | — | — | ✘ | **UI placeholder** |
| Coupons | ✔ | ✔ | ✔ | ◐ (needs card_management) | ✔ | ✔ | ✔ toast | ◐ | Rules overwritten on edit; no post-expiry mgmt |
| Coupon terms of use | ✔ | ✔ | ✔ (app-config) | ◐ (SA) | ✘ | ✔ | ✘ ignored | ◐ | |
| Referral settings | ✔ | ✔ | ✔ | ◐ (SA) | ✘ | ✔ | ◐ | ◐ | |
| Referral log & stats | ✔ | ✔ | ✔ | ✔ | n/a | n/a | ✘ silent | ◐ | Pending payout hard-coded 0 |
| Broadcast | ✔ | ✔ | ✔ (edge) | ✔ | ✔ | ◐ (no body) | ✔ toast | ◐ | No confirmation |
| Push templates | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ | ◐ | Edit only |
| Email templates | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | No test send |
| Platform balance | ✔ | ✔ | ✔ | ✔ | ✘ server | ✔ | ◐ | ◐ | Instant mode switch; no refresh |
| Limits & fees | ✔ | ✔ | ✔ | ◐ (SA) | ◐ | ✔ (no before) | ✔ | ◐ | |
| Bill settings | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | Data/cable/max airtime backend-only |
| Gateways / bill providers | ✔ | ✔ | ✔ | SA | ◐ | ✔ | ✔ | ◐ | Disabling the primary isn't blocked server-side |
| Chatwoot / URLs / version | ✔ | ✔ | ✔ | SA | ◐ (version none) | ✔ | ✔ | ◐ | |
| Emergency mode | ✔ | ✔ | ✔ | SA | ◐ | ✔ | ✔ | ✔ | Has confirmation |
| Anomaly thresholds | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ | ◐ | Key-name divergence |
| Security limits / webhook IPs | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | No confirm on clearing |
| Admin alerts center | ✘ | ✘ | ◐ (insert only) | — | — | — | — | ✘ | Missing |
| Job monitoring | ✘ | ✘ | ✘ | — | — | — | — | ✘ | Missing |
| Import / bulk ops | ✘ | ✘ | ✘ | — | — | — | — | ✘ | Missing |

### 29.1 Implementation status classification

**CURRENTLY IMPLEMENTED** (works end-to-end for super admins, and for properly scoped admins where noted):
* Login/logout/theme.
* Dashboard.
* Card review (approve, correct, reject, overturn, uphold).
* Withdrawal approve/reject.
* Transaction/user/withdrawal browsing and exports.
* User freeze (SA).
* User session termination (SA).
* Audit viewer and export.
* Admin CRUD (SA).
* Card brands, countries, templates, fields and installs (with `card_management`).
* Rates and range creation.
* Giftbox, levels and coupons (with `card_management`).
* Referral log.
* Broadcast.
* Push and email templates.
* Balance, bill, anomaly and security configuration.
* Global settings (SA).
* Emergency mode.

**PARTIALLY IMPLEMENTED:**
* Delegated access for Activity Log, Admins, Limits & Fees, Settings, bonus/referral settings and coupon terms (SA-only APIs).
* Field Builder/Coupons for admins without `card_management`.
* Freeze for non-SA admins.
* Card Queue search (200 rows).
* Withdrawals list (100 rows, no pagination, no `initiated` tab).
* Template field changes (no sync to installs).
* Countries (currency name not stored).
* Coupons after expiry.
* Referral "pending payout" stat.
* Dashboard sums (row caps).
* Error handling across most pages.

**BACKEND-ONLY:**
* `GET/POST /api/flagged-transactions` (list, clear, escalate).
* `PATCH /api/admin-accounts {revoke_sessions}`.
* `PATCH /api/cards {type:'reorder'}`.
* `PATCH /api/field-builder {type:'reorder_fields'}`.
* `GET /api/auth/me`, `GET /api/dashboard`.
* The withdrawals `review=1`, `page` and date filters.
* The users `date_from`/`date_to` listing filters (used only by export).
* The PATCH of country code/name/symbol (the UI only toggles active).
* The app_config keys `max_airtime_amount`, `min/max_data_amount`, `min/max_cable_amount`, `level_bonus_active`, `withdrawal_narrations`, `critical_alert_amount`, `alert_email_batch`, `iana_timezone`.
* The `admin_alerts` inserts (no read).
* Accepted-but-unused permission keys.

**UI-ONLY / PLACEHOLDER:**
* The card drag-handle "⠿".
* The Leaderboard "Coming Soon" card.
* The Referral "Pending payout" metric (always ₦0).
* The Country "Currency name" field (required, not persisted).
* The Withdrawals mobile flag highlight (the list has no flag data).
* The level badge "SVG" support claim.
* The `ToastProvider`/`EmptyState`/`Spinner` components (unused).
* The `_shared/RuleBuilder.tsx` (orphan).

**MISSING** (expected given the existing application):
* See §31.

---

## 30. Current Problems / Gaps

Each item cites implementation evidence.

### 30.1 Permissions & access

1. **Nav/API permission mismatch.** Admins with `user_activity_monitor`, `limits_fees`, `admin_settings` or `admin_accounts` can see pages whose APIs are SA-only (§10.4). Evidence: `api/user-activity-monitor/route.ts:15`, `api/limits-fees/route.ts:26`, `api/admin-settings/route.ts:49`, `api/admin-accounts/route.ts:47`.
2. **Hidden dependencies:** Field Builder and Coupons fetch `/api/cards` (`field-builder/page.tsx:83`, `coupons/page.tsx:122`), which requires `card_management` (`api/cards/route.ts:26`).
3. **Unassignable permissions** (`users_freeze`, `admin_accounts`, …) vs `ASSIGNABLE_PAGES` (`admin-accounts/page.tsx:11-34` vs `api/admin-accounts/route.ts:23-31`).
4. **Buttons shown without authority:** Freeze/Unfreeze on the user detail page for all `users` admins.
5. **The permission-denied state is a 404** ("doesn't exist, or you don't have permission"), so admins can't tell a bug from missing access.
6. **Inconsistent forbidden UX:** some pages show a message, most show empty data (§23.2).

### 30.2 Navigation & IA

1. Nav labels differ from page titles in 12 places (§26.3). "Activity Log" (user presence) and "Admin Activity" (audit log) are easily confused and share an icon.
2. The breadcrumb is wrong and both items are active on `/bonuses-rewards/levels` (`nav.ts:90-99`, `Shell.tsx:94`).
3. The Dashboard is always the landing page, even for admins without the `dashboard` key (where it may be empty).
4. There are no deep links:
   * the dashboard "Open" and the transaction rows can't open a specific submission, withdrawal or transaction;
   * status tabs and filters aren't in the URL;
   * the detail panels have no URL.
5. Logout is unreachable in the collapsed desktop sidebar.
6. There is no global search (users, withdrawals by reference, submissions by id).
7. Related data isn't cross-linked:
   * the user profile doesn't link to their withdrawals, submissions, referrals or sessions;
   * withdrawals and card submissions don't link to the user profile;
   * the audit log target doesn't link to the entity.

### 30.3 Information hierarchy & missing detail pages

* The only full detail page is User. Transactions have no detail at all (metadata hidden).
* Admin detail (sessions, activity) is missing. Coupon redemption detail is missing.
* Operational queues (cards, withdrawals) rely on side panels with polling underneath and no pagination.
* The Dashboard lacks operational alerts: emergency mode, flagged withdrawals, failed payouts, admin alerts, gateway errors.

### 30.4 Search, filtering, pagination

See §12.3.
* Card Queue search covers only the latest 200 rows.
* Withdrawals is capped at 100 rows with no pagination.
* No sorting anywhere.
* Inconsistent triggers (live/Apply/Enter).
* Missing statuses (`initiated`, `dispute_resolved`, `refunded` in Transactions).
* The Admin Activity view has no date/action/target filters.

### 30.5 Bulk operations

**None exist** (no row selection anywhere). Examples:
* approving multiple card submissions or withdrawals;
* bulk rate adjustments (only a per-row batch save);
* bulk coupon disable;
* bulk user freeze.

### 30.6 Confirmation flows (missing or weak)

| Action | Current |
|---|---|
| Uphold dispute | none |
| Unfreeze user | none |
| Deactivate/reactivate admin | none |
| Deactivate card brand / toggle country / **remove country** | none |
| Delete template field | none |
| Rates "Save All" (money-affecting; blank → 0) | none |
| Broadcast to all users | none |
| Platform balance mode switch (tab click saves) | none |
| Clearing webhook IP allowlists (breaks payments) | none |
| Gateway/bill provider primary switch (radio click saves) | none |
| Giftbox/coupon activate/deactivate | none |
| Terminate user sessions | native `confirm()` |

### 30.7 Error / empty / loading states

* Silent failures on most list loads and many mutations (§23.2).
* `alert()` usage.
* Perpetual skeletons on detail failures (Card Queue, Withdrawals, Activity Log).
* No error boundary.
* Mobile lists use non-shimmer placeholders.
* The "No activity in this window" copy doesn't match the view.

### 30.8 Mobile

* The login card overflows.
* 2-column form grids don't collapse (Coupons, Broadcast, Referrals, Signup Bonus, Giftbox modal, App Version).
* Rates and Field Builder have no mobile adaptation.
* Hydration flash from desktop to mobile.
* Zoom is disabled (accessibility).

### 30.9 Consistency

Duplicated helpers/components (§26.3, §27); three toast systems; two export modals; two rule builders; varied status tone maps; mixed inline styles; hard-coded light colors in the Login and Terms modal (broken dark mode); the undefined `--bg-base` token.

### 30.10 Data integrity & correctness risks surfaced by the UI

1. Rates: a blank input saves as 0 (`rates/page.tsx:81`). The batch is non-atomic (`api/rates/route.ts:114-119`).
2. Levels: a blank number saves as 0 (`levels/page.tsx:168,176`).
3. Coupons: editing overwrites the eligibility rules (`coupons/page.tsx:162-164`).
4. Field Builder: template edits don't reach existing installs (`api/field-builder/route.ts:158-168`).
5. Card reject and template delete are non-transactional.
6. Admin edit can null the email and lock the admin out (`api/admin-accounts/route.ts:157-162`).
7. Dashboard numbers: row-capped sums, the `initiated` vs review status mismatch, expired coupons counted as active, the server-midnight timezone, and "24h" hints that are really "since midnight".
8. Bonus/referral/balance/version config values are unvalidated.

### 30.11 Auditability

See §19.4. Also: failed-login rows attributed to the victim account, PDF logged as CSV, and missing before-values on most config routes.

### 30.12 Missing administrative controls (operational)

* No manual wallet adjustment/refund.
* No payout retry or "mark paid".
* No flag clear/escalate UI.
* No referral payout retry.
* No user profile edit.
* No admin session management.
* No SA management.
* No job visibility.
* No alert center.

---

## 31. Missing Capabilities

Items reasonably expected given what already exists, and **not implemented anywhere in this repo**:

**Access & security**
1. Admin MFA/2FA (TOTP/WebAuthn).
2. Admin password reset and self-service password change.
3. Super-admin management UI (create/promote/demote, edit own account).
4. Role templates / permission presets, and per-action permissions (e.g. approve vs view, export permission, approval limits per admin).
5. Admin session/device list, "revoke sessions" button, last-login IP.
6. Admin IP allowlisting; configurable session TTL/idle timeout.
7. Maker-checker / dual approval for large payouts or config changes.
8. Read-access auditing for PII/card data; an audit for share/download.

**Operations**
1. Flagged-transaction review queue (the API exists).
2. Admin alert center for `admin_alerts` (list, acknowledge).
3. Failed-payout handling: retry, mark as paid/refunded, re-route to another gateway.
4. Manual wallet credit/debit with reason (the `manual_wallet_credit` permission is reserved).
5. Transaction detail view (metadata, related entities).
6. Deep links to submission/withdrawal/transaction detail; URL-synced filters.
7. Pagination for the Card Queue and Withdrawals; server-side search for the card queue.
8. Bulk actions on queues.
9. SLA/queue-age indicators (e.g. time pending).

**Users**
1. Edit profile, activate/deactivate, delete/anonymize, reset PIN, internal notes/tags.
2. Links from the profile to submissions, withdrawals, referrals, coupons and level claims.

**Catalog & rewards**
1. Delete card brand; reorder brands (UI); edit/delete denomination ranges; range overlap validation; rate history; bulk rate change.
2. Field reorder UI; view/edit per-country installed fields; sync template changes to installs.
3. Coupon delete/duplicate, redemption list, extend expiry, full rule builder (the API supports it).
4. Giftbox delete and claims list.
5. Leaderboard configuration (placeholder).
6. Referral payout management; accurate pending-payout stat.

**Communications**
1. Broadcast confirmation, preview, test send, scheduling, cancel; failed-delivery detail.
2. Template version history/revert; email test send; required-variable validation.

**Configuration**
1. Editors for the backend-only keys (data/cable/max airtime limits, `withdrawal_narrations`, `level_bonus_active`).
2. Manual platform-balance refresh; gateway connectivity status/test.
3. Config change history with before/after values and rollback.

**Platform**
1. Background job/cron monitoring.
2. Import (CSV) and bulk update tools.
3. Charts/trends and reporting with date ranges and comparisons.
4. A global error boundary and a session-expired handler.
5. Automated tests, lint and CI.

---

## 32. Technical Debt

| # | Debt | Evidence | Impact |
|---|---|---|---|
| T1 | Duplicated utilities/components (formatNaira ×5, statusTone ×5, StatusDot ×3, DetailRow ×2, TypeLabel ×2, timeAgo ×2, RuleBuilder ×2, CSV cell ×3, EyeIcon ×2, export modal ×2, print builders ×2) | §27 | Divergent behavior (e.g. `held` tone) |
| T2 | Inline styles dominate pages; Tailwind imported but unused; hard-coded colors | §26.3 | Theming/dark-mode bugs; hard redesign |
| T3 | Three toast mechanisms; shared toast unused; `alert`/`confirm` | §14.1 | Inconsistent feedback |
| T4 | No data-fetching layer (no cache, abort, dedupe, retry); manual polling; race conditions (Users double fetch) | pages | Flicker, wasted queries, stale data |
| T5 | N+1 queries (cards, rates tree, card-queue detail, rates PATCH snapshots, signed URLs per image) | API routes | Latency, load |
| T6 | JS aggregation of row fetches for KPIs/claims | `lib/dashboard.ts`, `api/levels`, `api/giftbox`, `api/users` | Wrong numbers at scale |
| T7 | Unchecked Supabase errors in PATCH/DELETE (field-builder, cards reorder, users freeze update) | routes | Silent failures reported as success |
| T8 | No DB transactions for multi-step writes | card reject, template delete, rates batch | Partial state |
| T9 | Audit logging ad hoc (per-route inserts, inconsistent columns, unchecked) | §19 | Gaps and unreliable audit |
| T10 | Generic `/api/app-config` overlapping specialized config routes with weaker validation | §15.2 | Validation bypass; confusing ownership |
| T11 | Config key-name drift (`alert_critical_amount` vs `critical_alert_amount`, etc.) | §7.26 | Possible dead settings |
| T12 | Permission catalog duplicated in 3 places (nav.ts, ASSIGNABLE_PAGES, ALLOWED_PERMISSIONS) with drift | §10.2 | Unassignable/unused keys |
| T13 | Dead/legacy code: `_shared/RuleBuilder.tsx`, unused imports (`cookies`, `verifyAdminJWT` in many routes; `Table`/`useIsMobile` in settings), `type UserHit`, `rejectBody`, `jsonwebtoken` dependency, legacy action labels, `feature_overrides` key, `public/*.svg` | various | Noise |
| T14 | Documentation drift (README env vars, Next version, requireAdmin, session.ts, broken links to the parent repo) | `README.md` | Onboarding errors |
| T15 | No tests, lint config or CI | repo | Regressions |
| T16 | No shared types for API contracts (pervasive `any`) | pages/routes | Contract drift between UI and API |
| T17 | Mobile variants hand-written per page (12 components) | pages | Duplication; inconsistent mobile UX |
| T18 | Supabase error messages returned to the client verbatim | routes | Information leakage, poor UX |
| T19 | `sharp` used via dynamic import but not a declared dependency (transitive via next) | `api/levels/upload/route.ts:12`, `package.json` | Silent fallback to unresized uploads if absent |
| T20 | Hard-coded business constants in code (limits, windows, presets, country list) | §15.1 | Changes need deploys |

---

## 33. Recommendations for Admin Redesign

These are grounded in the findings above. They are directional inputs for the redesign, not a design.

**Foundation**
1. **Unify the permission catalog.** Keep a single source of truth for keys, labels, nav mapping and API enforcement. Decide whether each page is delegable. Make SA-only pages explicitly SA-only in the nav, or implement scoped APIs for them. Add per-action permissions where money moves (approve card, approve payout, export, freeze).
2. **Adopt a data layer** (e.g. React Query/SWR) with typed API clients, abortable requests, a global 401 → login redirect, retry, and consistent error/empty/loading components (`EmptyState`, `ErrorState`, one toast system).
3. **Consolidate the UI kit.**
   * Remove inline styles and page-local duplicates.
   * Adopt the tokens everywhere, including the Login and Terms modal.
   * Adopt a responsive `DataTable` that renders cards on mobile, with sorting, pagination, URL-synced filters, row selection and bulk actions.
   * Make Modal/Drawer accessible (focus trap, initial focus).
4. **Standardize audit.** One server helper writes audit rows transactionally or checks failures. It records before/after for every config change, the real client IP, and the user-agent. It audits exports (including activity and PDF) and sensitive reads/shares.

**Operations UX**
1. Queues: server-side search and pagination, URL deep links for each record, age/SLA indicators, and bulk actions where safe.
2. Add missing statuses (`initiated`, `dispute_resolved`), a flag review workflow, failed-payout handling, and consistent confirmations for all irreversible or money-affecting actions (with amount summaries).
3. Transaction detail and cross-entity links (user ↔ submissions ↔ withdrawals ↔ transactions ↔ audit entries).
4. Dashboard:
   * accurate DB-side aggregates with explicit timezone (Africa/Lagos);
   * KPIs that link to filtered lists;
   * an alerts strip (emergency mode, flagged items, failed payouts, gateway errors, admin alerts);
   * a sensible refresh interval with the copy matching it.

**Configuration**
1. A single, typed settings model with server validation per key, before/after history and rollback. Retire the generic `/api/app-config` or bring it to the same validation.
2. Add confirmations and impact warnings for high-blast-radius settings (emergency mode, gateways, webhook IPs, limits, balance mode).
3. Expose backend-only keys deliberately, or remove them. Resolve the anomaly/alert key-name duplication.

**Security**
1. Admin MFA, password reset/change, session management, and SA management flows.
2. Reconsider the auto-deactivation lockout (e.g. temporary lock + alert instead of deactivation). Make rate limiting fail closed.
3. Restrict or audit card-data sharing. Mask account numbers in lists. Minimize PII in exports.
4. Keep API-level authorization as the source of truth. Treat UI gating as UX only.

**Catalog & rewards**
1. Model templates vs installed card types explicitly (show per-country fields, offer "sync to countries").
2. Full denomination management (edit/delete, overlap validation, bulk %) with safe numeric inputs (no blank → 0).
3. A full rule builder for coupons (reusing the giftbox builder), coupon lifecycle after expiry, and redemption lists.

---

## 34. Appendix — Complete Admin Page Inventory

| # | Section | Page | Route | Purpose | Access (UI key → effective) | Main Actions | Backend Dependency | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Public | Root | `/` | Redirect | public | — | — | Complete |
| 2 | Public | Login | `/login` | Admin sign-in | public | Login | `POST /api/auth` | Complete (mobile overflow, no MFA) |
| 3 | Public | 404 / Permission denied | *(any)* | Not found / no access | — | Back to Dashboard | — | Complete |
| 4 | Operations | Dashboard (Overview) | `/dashboard` | KPIs + recent submissions | any admin; KPIs per key | Open queue | `lib/dashboard.ts` (direct DB) | Complete (accuracy issues) |
| 5 | Operations | Card Queue | `/card-queue` | Review gift-card submissions | `card_queue` | View, Approve (+correct), Reject, Overturn, Uphold, Share/Download | `/api/card-queue`, RPCs `approve_card_submission`, `emit_notification` | Complete (search/pagination limited) |
| 6 | Operations | Withdrawals | `/withdrawals` | Payout queue | `withdrawals` | View, Approve, Reject, Export | `/api/withdrawals`, `/approve`, `/reject`, edge `resume-withdrawal` | Complete (100-row cap) |
| 7 | Operations | Transactions | `/transactions-overview` | Ledger browser | `transactions_overview` | Filter, Paginate, Export | `/api/transactions`, RPC `admin_transactions_stats` | Complete (read-only) |
| 8 | People | Users | `/users` | Customer list | `users` | Search, Paginate, View, Export | `/api/users` | Complete |
| 9 | People | User detail | `/users/[id]` | Customer profile | `users`; freeze: SA/`users_freeze` | Freeze, Unfreeze, Tabs | `/api/users/[id]` | Partial |
| 10 | People | Activity Log (User activity monitor) | `/user-activity-monitor` | Presence + sessions + force logout | `user_activity_monitor` → **SA** | Search, Online only, View, Terminate sessions | `/api/user-activity-monitor/*`, RPC `terminate_user_sessions` | Partial |
| 11 | People | Admin Activity | `/activity` | Audit log | `activity` | Filter by admin, View, Export, Refresh | `/api/activity`, RPC `list_admin_activity` | Complete (limited) |
| 12 | People | Admins (Admin Accounts) | `/admin-accounts` | Admin provisioning | `admin_accounts` → **SA** | Create, Edit, Deactivate/Reactivate, Delete | `/api/admin-accounts` | Partial |
| 13 | Catalog | Cards (Card & Country Management) | `/cards` | Brands, logos, countries | `card_management` | Add/Edit brand, Upload logo, Toggle, Countries add/toggle/remove | `/api/cards`, `/api/cards/upload` | Partial |
| 14 | Catalog | Field Builder | `/field-builder` | Card types & fields per brand/country | `card_type_builder` (+`card_management`) | Add/rename/toggle/delete type, Add/edit/delete field, Install/toggle country | `/api/field-builder`, `/api/cards` | Partial |
| 15 | Catalog | Rates | `/rates` | Denomination rates | `rates_management` | Edit rates/active, Save all, Add range | `/api/rates` | Partial |
| 16 | Rewards | Bonuses (Bonuses & Rewards) | `/bonuses-rewards` | Signup/levels toggles, giftbox | `bonuses_rewards` (+SA for config) | Save settings, Add/Edit/Toggle giftbox item | `/api/app-config`, `/api/bonuses`, `/api/giftbox`, edge `get-active-promos` | Partial |
| 17 | Rewards | Levels (Level Tiers) | `/bonuses-rewards/levels` | 6 tier configs + badges | `bonuses_rewards` | Edit & Save tier, Upload badge | `/api/levels`, `/api/levels/upload` | Complete |
| 18 | Rewards | Coupons | `/coupons` | Promo codes + terms | `coupons` (+`card_management`, +SA for terms) | Create, Edit, Enable/Disable, Manage terms | `/api/coupons`, `/api/cards`, `/api/app-config`, edge `get-active-promos` | Partial |
| 19 | Rewards | Referrals (Referral Management) | `/referral-management` | Program settings + log | `referral_management` (+SA for settings) | Save settings | `/api/app-config`, `/api/referrals`, RPC `admin_referrals_stats` | Partial |
| 20 | Communications | Broadcast (Notifications Broadcast) | `/notifications-broadcast` | Push broadcasts | `notifications_broadcast` (+`users` for picker) | Compose, Insert variables, Pick user, Send | `/api/notifications/*`, edge `broadcast-notification`, RPC `resolve_broadcast_audience` | Complete (no confirm) |
| 21 | Communications | Push Templates (Notification Templates) | `/notification-templates` | Edit push templates | `notification_templates` | Edit, Toggle active | `/api/notification-templates` | Complete (edit-only) |
| 22 | Communications | Email Templates | `/email-templates` | Edit email templates | `email_templates` | Edit, Preview, Toggle active | `/api/email-templates` | Complete (edit-only) |
| 23 | Configuration | Balance (Platform Balance) | `/platform-balance` | Balance source/value | `platform_balance` | Switch mode, Save static | `/api/platform-balance` | Complete |
| 24 | Configuration | Limits & Fees | `/limits-fees` | Withdrawal limits/fee/flag | `limits_fees` → **SA** | Save changes | `/api/limits-fees` | Partial |
| 25 | Configuration | Bill Settings | `/bill-settings` | Bill presets/minimums | `bill_settings` | Save changes | `/api/bill-settings` | Complete |
| 26 | Configuration | Settings (Admin Settings) | `/admin-settings` | Global config | `admin_settings` → **SA** | Gateways, Risk limit, Bill providers, Chatwoot, Legal, Store links, Version, Emergency mode | `/api/admin-settings` | Complete (SA only) |
| 27 | Security | Anomaly & Alerts | `/anomaly-alerts` | Fraud/alert thresholds | `anomaly_alerts` | Save changes | `/api/anomaly-alerts` | Complete |
| 28 | Security | Rate Limits & IPs (Rate Limits & Webhook IPs) | `/security-limits` | Signup limit, webhook IPs | `security_limits` | Save changes | `/api/security-limits` | Complete |

---

## 35. Appendix — Complete Admin Component Inventory

### 35.1 Shared UI kit (`app/_ui/*`, exported via `app/_ui/index.ts`)

| Component | Location | Purpose | Props / configuration | Variants | Used by | Reusable | Duplicates / alternatives |
|---|---|---|---|---|---|---|---|
| `Button` | `_ui/Button.tsx` + `.module.css` | Action button | `variant`, `size`, `loading`, `leftIcon`, `rightIcon`, `iconOnly`, native button props (forwardRef) | primary, secondary, ghost, danger, dangerSubtle, success × sm/md/lg; icon sizes | nearly all pages | ✔ | Raw `<button>` in Login, Terms modal, share menu, variable chips, brand list, field-builder country pills |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | `_ui/Card.tsx` | Surface container | Card: `elevated`, `flush`. Header: `title`, `subtitle`, `actions`, `bare`. Body: `tight`, `flush` | — (elevated/tight/bare unused) | most pages | ✔ | Ad hoc divs in mobile lists |
| `Badge` | `_ui/Badge.tsx` | Pill label | `tone` (neutral/success/warning/danger/info/purple/accent), `size` (sm/md/lg), `dot` | 7 tones | Admin Activity (SUPER), Field Builder (type/required) | ✔ | `StatusDot`, local `TypeLabel` chips |
| `FieldShell` | `_ui/Field.tsx` | Label + help/error wrapper | `label`, `htmlFor`, `required`, `help`, `error` | — (`required`/`error` never used) | 16 pages | ✔ | Ad hoc labels (freeze modal, card-queue SectionLabel, export modals) |
| `Input` | `_ui/Field.tsx` | Text/number/date input | `invalid`, `mono`, native props (forwardRef) | mono | most pages | ✔ | Login, Terms modal raw inputs |
| `Textarea` | `_ui/Field.tsx` | Multiline | `invalid` | — | 8 pages | ✔ | — |
| `Select` | `_ui/Field.tsx` | Native select with chevron | `invalid` | — | 8 pages | ✔ | — |
| `Toggle` | `_ui/Toggle.tsx` | Switch (checkbox role=switch) | `checked`, `onChange(next)`, `label`, `disabled` | — | 12 pages | ✔ | Custom div checkbox (Admins) |
| `Tabs` | `_ui/Tabs.tsx` | Segmented/underline tabs | `value`, `onChange`, `items[{value,label,count?}]`, `variant` | segmented, underline | Card Queue, Withdrawals, User detail, Balance | ✔ | — (`count` unused) |
| `Modal` | `_ui/Overlay.tsx` | Centered dialog | `open`, `onClose`, `title`, `subtitle`, `hideClose`, `size` (sm/md/lg/xl), `footer`, `static` | sizes | 9 pages + ExportModal | ✔ | Terms modal (custom), ConfirmBox, inline panels, native confirm |
| `SidePanel` | `_ui/Overlay.tsx` | Right drawer | `open`, `onClose`, `title`, `subtitle`, `hideClose`, `wide`, `footer` | 560 / 720px | 7 pages | ✔ | — |
| `ExportModal` | `_ui/ExportModal.tsx` | Time frame + CSV/PDF | `open`, `onClose`, `title`, `subtitle`, `range`, `onRangeChange`, `metaLine`, `exporting`, `onCsv`, `onPdf` | — | Users, Transactions, Withdrawals | ✔ | Admin Activity custom export modal |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `_ui/Table.tsx` | Data table | Table: `density` (default/dense/relaxed), `flush`. Th: `align`, `sticky`. Td: `align`, `emphasis` (primary/secondary/muted), `mono`, `sticky`. Tr: `interactive`, `selected` | density (unused), sticky (Users) | 17 pages | ✔ | Mobile card lists per page |
| `TableEmpty` | `_ui/Table.tsx` | Empty row | `colSpan`, children | — | 17 pages | ✔ | ad hoc empty divs (mobile) |
| `TableSkeleton` | `_ui/Table.tsx` | Loading rows | `colSpan`, `rows` | — | 10 pages | ✔ | grey blocks (mobile) |
| `Skeleton`, `SkeletonLines` | `_ui/Misc.tsx` | Shimmer placeholders | width/height/rounded; rows/gap/height | — | 19 pages | ✔ | — |
| `KpiSkeleton` | `_ui/Misc.tsx` | KPI placeholder | — | — | dashboard/loading | ✔ | — |
| `EmptyState` | `_ui/Misc.tsx` | Icon/title/hint/actions empty state | `icon`, `title`, `hint`, `actions` | — | **unused** | ✔ | plain text everywhere |
| `PageHeader` | `_ui/Misc.tsx` | Page title bar | `title`, `subtitle`, `actions` | — | all pages | ✔ | — |
| `SectionTitle` | `_ui/Misc.tsx` | Mono section label | children | — | Dashboard | ✔ | local `SectionLabel` (card-queue, activity), `microLabel` styles |
| `Kpi`, `KpiGrid` | `_ui/Misc.tsx` | Metric tile/grid | `label`, `value`, `icon`, `hint`, `delta{value,direction}` | delta unused | Dashboard | ✔ | `StatStrip` |
| `Spinner` | `_ui/Misc.tsx` | Loading spinner | `size` | — | **unused** | ✔ | Button `loading` |
| `ToastProvider`, `useToast` | `_ui/Misc.tsx` | Toast system | `show(text, tone)` | default/success/error/warning | **mounted in Shell, never used** | ✔ | 14 local toasts |
| `ThemeProvider`, `useTheme` | `_ui/theme.tsx` | Theme state/persistence | `initialMode`, `initialResolved` | light/dark/system | root layout, ThemeSwitcher | ✔ | — |
| `NoZoom` | `_ui/NoZoom.tsx` | Disable zoom gestures | — | — | root layout | ✔ | — |
| `tokens.css` | `_ui/tokens.css` | Design tokens + base styles | — | light/dark | global | ✔ | — |

### 35.2 Shell & shared admin components

| Component | Location | Purpose | Props | Used by | Notes |
|---|---|---|---|---|---|
| `Shell` | `(dashboard)/_shell/Shell.tsx` | Sidebar, top bar, breadcrumb, permission gate, logout, toast provider | `allowedKeys`, `isSuperAdmin`, `username`, `roleTitle`, children | dashboard layout | Collapse state in localStorage; mobile drawer |
| `ThemeSwitcher` | `_shell/ThemeSwitcher.tsx` | Light/System/Dark radio group | — | Shell | Persists via `/api/admin/theme` |
| `AdminNotFound` | `_shell/NotFound.tsx` | 404 / denied | — | Shell, global not-found | Inline styles |
| `NAV_GROUPS`, `findBreadcrumb`, `findNavKey`, `filterNavByPermissions` | `_shell/nav.ts` | Nav config + helpers | — | Shell | First-match prefix logic |
| `formatNaira`, `statusTone`, `StatusDot`, `StatStrip` | `(dashboard)/_shared/statusUi.tsx` | Money format, status colors, status dot, stat strip | StatusDot: `status`, `tone?`. StatStrip: `items[{label,value,mono?}]` | 19 / 11 files | Local duplicates in dashboard, card-queue, withdrawals |
| `RuleBuilder` (orphan) | `app/_shared/RuleBuilder.tsx` | Eligibility rule editor | `rules`, `onChange` | **none** | Hard-coded light colors; the active copy lives in `bonuses-rewards/page.tsx` |
| `AutoRefresh` | `dashboard/AutoRefresh.tsx` | `router.refresh()` interval | `intervalMs` (5000) | Dashboard | |

### 35.3 Page-local components

| Component | File | Purpose | Reuse candidates |
|---|---|---|---|
| `CardQueueMobile` | card-queue/page.tsx | Mobile submission cards | Generic responsive table |
| `DetailRow` | card-queue, withdrawals | Label/value row | Shared DescriptionList |
| `SectionLabel` | card-queue, activity | Uppercase label | `SectionTitle` |
| `ShareItem` + share popover | card-queue | Share menu | Shared Menu/Popover |
| `ApproveModal` | card-queue | Approve + correction | — |
| Lightbox (inline) | card-queue | Image viewer | Shared ImageViewer |
| `StatusDot`, `StatCell`, `StatStrip`, `ConfirmBox` | withdrawals/page.tsx | Local duplicates + inline confirm | Shared StatusDot/StatStrip/ConfirmDialog |
| `WithdrawalsMobile` | withdrawals/WithdrawalsMobile.tsx | Mobile cards | — |
| `TypeLabel` | transactions-overview, users/[id] | Type chip | Badge |
| `TransactionsMobile` | transactions-overview | Mobile cards | — |
| `UserStatus`, `UserAvatar`, `UsersMobile` | users/page.tsx | Status, avatar, mobile list | Shared Avatar |
| `InfoRow` | users/[id] | Label/value row | DescriptionList |
| `DetailBody`, `MoneyRow`, `OnlineDot`, `ActivityMobile`, `timeAgo`, `presence` | user-activity-monitor | Monitor panel | — |
| `ActivitySection`, `ActivityMobile`, `DetailGrid`, `JsonCard`, `buildPrintHtml`, `rangeBounds`, `actionLabel`, `actionTone`, `ACTION_LABEL` | activity/page.tsx | Audit viewer | Shared export modal/print |
| `AdminActions`, `AdminAccountsMobile`, `EyeIcon` | admin-accounts | Row actions, mobile, password eye | Shared PasswordInput, Checkbox |
| `CardLogo`, `CardStatus`, `CardsMobile`, `codeToFlag`, `ISO_COUNTRIES` | cards/page.tsx | Brand display, flags, country data | Shared Combobox |
| `FieldForm` | field-builder | Inline field editor | — |
| Accordion (inline styles object) | rates/page.tsx | 4-level tree | Shared Accordion |
| `GiftboxMobile`, `RuleBuilder`, `RuleValue`, `RULE_TYPES` | bonuses-rewards/page.tsx | Giftbox list, rule editor | Promote RuleBuilder to shared (and delete the orphan) |
| Tier card (inline) | levels/page.tsx | Tier editor | — |
| `CouponsMobile`, `couponStatus`, `isExpired` | coupons/page.tsx | Mobile list, status | — |
| `TermsOfUseManager` | coupons/TermsOfUseManager.tsx | Custom modal list editor | Should use `Modal` + tokens |
| `ReferralManagementMobile`, `logStatus`, `bonusOf` | referral-management | Mobile list, status | — |
| `BroadcastsMobile`, variable chips, user picker | notifications-broadcast | History, variables, picker | Shared UserPicker |
| Template editors (inline) | notification-templates, email-templates | Side-panel editors with preview | Shared TemplateEditor |
| Config form pattern (FIELDS arrays + draft/diff + footer) | limits-fees, bill-settings, anomaly-alerts, security-limits | Declarative settings forms | Shared SettingsForm (4 near-identical copies) |
| `rowStyle` gateway rows | admin-settings | Enable + primary rows | Shared ProviderSelector |
| `EyeIcon` | login/page.tsx | Password visibility | Shared PasswordInput |

### 35.4 Library helpers (`app/lib/*`)

| Helper | Purpose |
|---|---|
| `jwt.ts` | `signAdminJWT`, `verifyAdminJWT` (DB-backed), `verifyAdminFromRequest` (Bearer or cookie) |
| `supabase.ts` | Service-role client |
| `dashboard.ts` | `buildCan`, `getDashboardStats`, `getRecentSubmissions`, `getDashboardData` |
| `sanitize.ts` | `sanitizeSearch`, `clampPagination` (max 100), `asUuid` (**unused**) |
| `redact.ts` | `redactAudit` |
| `configUrls.ts` | `URL_CONFIG_KEYS`, `validateConfigUrl` (used by app-config; admin-settings re-implements it inline) |
| `uploadTypes.ts` | `ALLOWED_IMAGE_TYPES`, `MAX_UPLOAD_BYTES`, `magicMatchesExt` |
| `printExport.ts` | `printTable`, `rangeToDates`, `RangeKey` |
| `promoCacheBust.ts` | `bustPromoCache()` |
| `useIsMobile.ts` | `useIsMobile(768)` |

---

*End of specification.*
