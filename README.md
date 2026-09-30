# Mak-Gambreng Monitoring Realtime

Standalone Owner Monitoring PWA for Mak-Gambreng.

## Backend integration

- Supabase Auth: email/password.
- Owner-only access: the app verifies `profiles.role = owner` and `profiles.status = active`.
- Initial snapshot: Supabase Edge Function `monitoring-feed` (JWT protected).
- Realtime: Supabase Postgres Changes is used only as a refresh signal; the UI re-fetches the authoritative snapshot from `monitoring-feed` after database changes.
- Source tables already present in the connected Supabase project: `stores`, `store_operation_sessions`, `monitoring_sales_events`, `monitoring_store_sales`, `monitoring_menu_sales`, `profiles`, `businesses`.
- No mock/seed/simulator data is included.
- No service-role key is shipped to the browser.

## Local development

1. Production configuration reference is `.env.production`.
2. For local development, copy `.env.production` to `.env.local` if you want to use the same Supabase project.
3. Run `npm install`.
4. Run `npm run dev`.

## Vercel

Production reference file: `.env.production`.

For Vercel, configure these same variables in the Project Environment Variables so the deployment uses the intended Production/Preview values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is a browser-safe Supabase key; never replace it with a service-role/secret key. Then deploy with the default Vite settings. Build command: `npm run build`. Output directory: `dist`.

## Important

The monitoring page reads live data from the existing Supabase backend. If there are no sale events or operation sessions yet, the UI intentionally shows empty/zero states rather than demo numbers.
