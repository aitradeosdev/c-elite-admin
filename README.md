# CardElite Admin Panel

Next.js 15 (App Router) dashboard for moderating the CardElite platform. Connects to the shared Supabase project (`kkfnlbatolfmmpyksdvz`) with the service-role key server-side only.

## Stack

- Next.js 15 App Router, React 19, TypeScript
- Supabase JS v2 (service-role on server; never exposed to browser)
- Tailwind CSS
- HTTP-only cookie session

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Create `.env.local` at the admin root:

```
NEXT_PUBLIC_SUPABASE_URL=https://kkfnlbatolfmmpyksdvz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ADMIN_FUNCTION_SECRET=<same value set as Supabase function secret>
```

`ADMIN_FUNCTION_SECRET` must match the value stored in Supabase secrets — API routes that trigger edge functions (broadcast, platform-balance refresh) send it as the `x-admin-secret` header.

## Layout

- `app/login/` — sign-in page (email + password against `auth.users` backing an `admin_users` row).
- `app/(dashboard)/` — protected admin pages. Every page calls `requireAdmin([permission])`.
- `app/api/` — server route handlers. Same guard; mutating routes write an `audit_log` entry.
- `app/lib/` — shared server utilities (`session.ts`, `supabase.ts`, `uploadTypes.ts`).

## Permissions

- `super_admin` — all permissions.
- `admin` — fine-grained strings in `admin_users.permissions` jsonb array. See the full list in the root [README.md](../README.md#44-permissions--audit-logging).

## Bootstrapping the first admin

Run [create_admin.sql](../create_admin.sql) against the Supabase SQL editor after inserting an auth user manually.

## Related docs

The root [README.md](../README.md) documents dashboard pages, API routes, the permissions catalog, and audit-log actions in detail. This file only covers local setup.
