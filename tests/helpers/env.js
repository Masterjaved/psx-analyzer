/**
 * Test helpers. The tests run WITHOUT `npm install`, so third-party
 * packages (cheerio, @netlify/blobs) and network-touching modules are
 * replaced with stubs. Everything else — the handlers, validation,
 * indicator maths — is the real code.
 */
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FN = (p) => path.join(ROOT, "netlify/functions", p);

const moduleStubs = {};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(moduleStubs, request)) return moduleStubs[request];
  return origLoad.call(this, request, ...rest);
};

/** Replace an npm package (e.g. "cheerio") for the rest of this test file. */
function stubPackage(name, exports) {
  moduleStubs[name] = exports;
}

/** Replace one of our own files, e.g. stubFile("lib/psxData.js", {...}). */
function stubFile(relPath, exports) {
  const p = FN(relPath);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

function fakeStore() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? JSON.parse(m.get(k)) : null;
    },
    async setJSON(k, v) {
      m.set(k, JSON.stringify(v));
    },
    async list() {
      return { blobs: [...m.keys()].map((key) => ({ key })) };
    },
    _map: m,
  };
}

/** Builds N daily rows; closeFn(i) gives the close for day i. */
function makeHistory(n, closeFn) {
  return Array.from({ length: n }, (_, i) => {
    const close = closeFn(i);
    return { date: `D${i + 1}`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 };
  });
}
const post = (body, headers = {}) => ({
  httpMethod: "POST",
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers,
});

/**
 * A minimal in-memory stand-in for Supabase's Auth server + PostgREST.
 * `createFakeSupabaseBackend()` returns the backend itself (reused by both
 * the unit-test global.fetch wrapper below AND tests/e2e/server.js, so the
 * browser and the Netlify Functions in an e2e run see the exact same data).
 * Understands exactly the requests our code makes: the password grant and
 * GET /auth/v1/user, PUT /auth/v1/user (set password), and GET/POST/DELETE
 * /rest/v1/<table> with select / eq. filters / order / limit / on_conflict
 * (merge-duplicates). Real Supabase enforces RLS server-side; this fake
 * enforces the same "own rows only, admin reads everything" rule by hand,
 * mirroring supabase/migrations/002_rls_policies.sql closely enough for
 * tests, but it is NOT a substitute for testing against the real database.
 */
function createFakeSupabaseBackend() {
  const usersByToken = new Map(); // token -> {id, email}
  const usersByEmail = new Map(); // email -> {id, password}
  const tables = { profiles: [], portfolios: [], portfolio_transactions: [], watchlists: [] };
  let autoId = 1;
  const newId = () => `row-${autoId++}`;
  let tokenSeq = 0;

  function issueToken(id, email) {
    const token = `tok-${id}-${++tokenSeq}`;
    usersByToken.set(token, { id, email });
    return token;
  }

  function addUser(id, email, role = "user", password = "pw") {
    usersByEmail.set(email, { id, password });
    tables.profiles.push({ user_id: id, email, role, status: "active", full_name: "" });
    const portfolio = { id: `pf-${id}`, user_id: id, name: "Main", created_at: new Date(2026, 0, 1).toISOString() };
    tables.portfolios.push(portfolio);
    const token = issueToken(id, email);
    return { id, token, headers: { authorization: `Bearer ${token}` }, portfolioId: portfolio.id };
  }

  function isAdminToken(token) {
    const u = usersByToken.get(token);
    if (!u) return false;
    const p = tables.profiles.find((row) => row.user_id === u.id);
    return Boolean(p && p.role === "admin");
  }

  function rowsForToken(table, token) {
    const admin = isAdminToken(token);
    const u = usersByToken.get(token);
    const all = tables[table] || [];
    if (admin && ["profiles", "portfolios", "portfolio_transactions"].includes(table)) return all;
    return all.filter((r) => r.user_id === (u && u.id));
  }

  function applyFilters(rows, params) {
    let out = rows;
    for (const [k, v] of params) {
      if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
      const m = /^eq\.(.*)$/.exec(v);
      if (m) out = out.filter((r) => String(r[k]) === decodeURIComponent(m[1]));
    }
    return out;
  }

  function applyOrder(rows, orderParam) {
    if (!orderParam) return rows;
    let out = [...rows];
    for (const spec of orderParam.split(",").reverse()) {
      const [col, dir] = spec.split(".");
      out.sort((a, b) => {
        const av = a[col],
          bv = b[col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return out;
  }

  function tokenFromAuthHeader(headers) {
    const h = headers || {};
    const raw = h.Authorization || h.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
    return m ? m[1] : null;
  }

  /** method, pathname (e.g. "/rest/v1/profiles"), searchParams (URLSearchParams), headers, bodyText → {status, json} */
  function respond(method, pathname, search, headers, bodyText) {
    const token = tokenFromAuthHeader(headers);

    if (pathname === "/auth/v1/token" && method === "POST") {
      const body = JSON.parse(bodyText || "{}");
      if (search.get("grant_type") === "password") {
        const rec = usersByEmail.get(body.email);
        if (!rec || rec.password !== body.password) return { status: 400, json: { error_description: "Invalid login credentials" } };
        const t = issueToken(rec.id, body.email);
        return { status: 200, json: { access_token: t, refresh_token: `ref-${t}`, expires_in: 3600, token_type: "bearer", user: { id: rec.id, email: body.email } } };
      }
      return { status: 400, json: { error_description: "unsupported grant_type in fake" } };
    }

    if (pathname === "/auth/v1/user" && method === "GET") {
      const rec = token && usersByToken.get(token);
      return rec ? { status: 200, json: { id: rec.id, email: rec.email } } : { status: 401, json: { error: "invalid token" } };
    }

    if (pathname === "/auth/v1/user" && method === "PUT") {
      // updateUser({password}) — a no-op in the fake beyond acknowledging it.
      const rec = token && usersByToken.get(token);
      if (!rec) return { status: 401, json: { error: "invalid token" } };
      const acc = usersByEmail.get(rec.email);
      if (acc) acc.password = JSON.parse(bodyText || "{}").password || acc.password;
      return { status: 200, json: { id: rec.id, email: rec.email } };
    }

    if (pathname.startsWith("/rest/v1/")) {
      const table = pathname.replace("/rest/v1/", "");
      if (!tables[table]) return { status: 404, json: { message: `unknown table ${table}` } };
      if (!token || !usersByToken.get(token)) return { status: 401, json: { message: "no/invalid token" } };
      const params = [...search.entries()];
      const scoped = rowsForToken(table, token);

      if (method === "GET") {
        const limit = Number(search.get("limit")) || undefined;
        return { status: 200, json: applyOrder(applyFilters(scoped, params), search.get("order")).slice(0, limit) };
      }
      if (method === "POST") {
        const body = JSON.parse(bodyText || "{}");
        const onConflict = search.get("on_conflict");
        if (onConflict) {
          const cols = onConflict.split(",");
          const idx = tables[table].findIndex((r) => cols.every((c) => r[c] === body[c]));
          if (idx >= 0) {
            tables[table][idx] = { ...tables[table][idx], ...body };
            return { status: 200, json: [tables[table][idx]] };
          }
        }
        const row = { id: newId(), created_at: new Date().toISOString(), ...body };
        tables[table].push(row);
        return { status: 201, json: [row] };
      }
      if (method === "DELETE") {
        const toDelete = applyFilters(scoped, params);
        const ids = new Set(toDelete.map((r) => r.id));
        tables[table] = tables[table].filter((r) => !ids.has(r.id));
        return { status: 200, json: toDelete };
      }
      return { status: 405, json: { message: "unsupported method in fake" } };
    }

    return { status: 404, json: { message: `no route for ${method} ${pathname} in fake` } };
  }

  return { addUser, tables, respond };
}

/** Unit-test convenience: installs a fakeSupabase backend as global.fetch. */
function fakeSupabase() {
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  const backend = createFakeSupabaseBackend();

  global.fetch = async (url, options = {}) => {
    const u = new URL(url);
    const r = backend.respond(options.method || "GET", u.pathname, u.searchParams, options.headers || {}, options.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.json), json: async () => r.json };
  };

  return backend;
}

module.exports = { ROOT, FN, stubPackage, stubFile, fakeStore, makeHistory, post, fakeSupabase, createFakeSupabaseBackend };
