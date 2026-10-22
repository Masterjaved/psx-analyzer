/** Small shared helpers for Netlify Functions. */
const supabase = require("./supabase");

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * Verifies the caller's Supabase access token and returns { id, email,
 * token } or null. Async because Supabase Auth must be asked over the
 * network (unlike the old Netlify Identity JWT, which Netlify had already
 * verified and attached to context.clientContext.user for free).
 */
async function getUser(event) {
  return supabase.getUser(event);
}

/** Reads the caller's own profile row and reports whether role is 'admin'. */
async function isAdmin(user) {
  return supabase.isAdmin(user);
}

function parseJsonBody(event, maxBytes = 100 * 1024) {
  const raw = event.body || "{}";
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    const err = new Error("request too large");
    err.code = "TOO_LARGE";
    throw err;
  }
  return JSON.parse(raw);
}

module.exports = { json, getUser, isAdmin, parseJsonBody };
