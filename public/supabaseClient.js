/**
 * Supabase project connection. The URL and the "anon/publishable" key are
 * DESIGNED to be public — every request they make is still checked by the
 * Row Level Security policies in supabase/migrations/002_rls_policies.sql,
 * so having these two values gives a visitor no more access than the
 * login form already would. The service-role/secret key is different: it
 * bypasses RLS entirely and must NEVER appear here — it lives only in
 * Netlify's server-side Environment Variables.
 *
 * Loaded after the supabase-js CDN script, before auth.js.
 */
const SUPABASE_URL = "https://qlexjyoyujsecjdagovq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KVd9dugSQzgQrFN2NyS7CQ_79je_0CA";

// Supabase consumes (and strips) the #access_token=...&type=invite|recovery
// hash from invite/reset-password email links as soon as the client below
// is created. Read `type` first so auth.js still knows which flow this is.
(function captureAuthLinkType() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  window.__authLinkType = hashParams.get("type") || null; // 'invite' | 'recovery' | 'signup' | null
})();

window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
