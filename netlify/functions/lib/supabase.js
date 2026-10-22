/**
 * Talks to Supabase's own REST APIs directly (Auth + PostgREST) using plain
 * fetch — no @supabase/supabase-js dependency needed server-side, so
 * functions stay small and fast to cold-start.
 *
 * Auth model: the browser signs in with Supabase Auth and sends the user's
 * access token on every request (Authorization: Bearer <token>). A function
 * verifies it by asking Supabase's Auth server who it belongs to, then uses
 * THE SAME token (not a service-role key) to read/write PostgREST tables —
 * that way every table access is still checked by the RLS policies in
 * supabase/migrations/002_rls_policies.sql. No function in this app needs
 * the service-role key: profiles/portfolios/transactions RLS already lets
 * an admin read every user's rows with their own token.
 */
const { timedFetch } = require("./net");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

class SupabaseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 500;
  }
}

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new SupabaseError("Supabase configured نہیں (SUPABASE_URL / SUPABASE_ANON_KEY سیٹ نہیں) / Supabase not configured", 500);
  }
}

function bearerToken(event) {
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/**
 * Verifies the caller's access token with Supabase Auth and returns
 * { id, email } or null (never throws for an invalid/expired token — that
 * is just "not logged in", not a server error).
 */
async function getUser(event) {
  assertConfigured();
  const token = bearerToken(event);
  if (!token) return null;

  try {
    const resp = await timedFetch(
      `${SUPABASE_URL}/auth/v1/user`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
      6000
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.id) return null;
    return { id: data.id, email: data.email, token };
  } catch {
    return null; // treat a Supabase Auth outage as "not logged in", not a crash
  }
}

/** Reads the caller's own profile row (id, role, status) — RLS: own row only. */
async function getProfile(user) {
  if (!user) return null;
  const rows = await restGet(user.token, "profiles", "select=role,status,full_name&user_id=eq." + user.id);
  return rows[0] || null;
}

async function isAdmin(user) {
  const profile = await getProfile(user).catch(() => null);
  return Boolean(profile && profile.role === "admin" && profile.status === "active");
}

function restHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function restRequest(token, method, table, query, body, extra = {}) {
  assertConfigured();
  const qs = query ? `?${query}` : "";
  let resp;
  try {
    resp = await timedFetch(
      `${SUPABASE_URL}/rest/v1/${table}${qs}`,
      { method, headers: restHeaders(token, extra), body: body !== undefined ? JSON.stringify(body) : undefined },
      8000
    );
  } catch (e) {
    throw new SupabaseError(`Supabase سے رابطہ نہیں ہو سکا / could not reach Supabase: ${e.message}`, 502);
  }

  const text = await resp.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!resp.ok) {
    const msg = (data && (data.message || data.error_description || data.hint)) || `Supabase error (status ${resp.status})`;
    throw new SupabaseError(msg, resp.status === 401 || resp.status === 403 ? resp.status : 500);
  }
  return data;
}

const restGet = (token, table, query) => restRequest(token, "GET", table, query);
const restPost = (token, table, body) =>
  restRequest(token, "POST", table, null, body, { Prefer: "return=representation" });
const restPatch = (token, table, query, body) =>
  restRequest(token, "PATCH", table, query, body, { Prefer: "return=representation" });
const restDelete = (token, table, query) =>
  restRequest(token, "DELETE", table, query, undefined, { Prefer: "return=representation" });

/** Insert-or-update by a unique column set (e.g. user_id,symbol). */
const restUpsert = (token, table, body, onConflictCols) =>
  restRequest(token, "POST", table, `on_conflict=${onConflictCols}`, body, {
    Prefer: "resolution=merge-duplicates,return=representation",
  });

module.exports = { getUser, getProfile, isAdmin, restGet, restPost, restPatch, restDelete, restUpsert, SupabaseError };
