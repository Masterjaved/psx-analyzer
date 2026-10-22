/**
 * A hand-written stand-in for the @supabase/supabase-js UMD bundle, used
 * ONLY in the e2e test (there is no internet access in this build
 * environment to fetch the real CDN script). It implements the small
 * slice of the real API that public/auth.js and public/admin.html
 * actually call: auth.signInWithPassword, getSession, onAuthStateChange,
 * signOut, resetPasswordForEmail, updateUser, refreshSession, and
 * from(table).select().eq().single(). Every call is a real HTTP request
 * to the Supabase URL/key it was created with (intercepted by e2e.js and
 * answered by the fake backend), so this only fakes the *client library*,
 * not the server — the real supabase-js talks to those same endpoints the
 * same way.
 */
window.supabase = (function () {
  function createClient(url, anonKey) {
    const STORAGE_KEY = "shim-sb-session:" + url;
    let session = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) session = JSON.parse(raw);
    } catch {}
    const listeners = [];

    function setSession(s) {
      session = s;
      try {
        if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        else localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    function notify(event) {
      for (const cb of listeners) cb(event, session);
    }

    async function req(path, opts = {}) {
      const resp = await fetch(url + path, {
        ...opts,
        headers: { apikey: anonKey, "Content-Type": "application/json", ...(opts.headers || {}) },
      });
      const data = await resp.json().catch(() => null);
      return { resp, data };
    }

    const auth = {
      async signInWithPassword({ email, password }) {
        const { resp, data } = await req("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
        if (!resp.ok) return { data: { session: null, user: null }, error: { message: data && data.error_description ? data.error_description : "Login failed" } };
        setSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
        notify("SIGNED_IN");
        return { data: { session, user: data.user }, error: null };
      },
      async getSession() {
        return { data: { session } };
      },
      onAuthStateChange(cb) {
        listeners.push(cb);
        // Mimic supabase-js: fires once, asynchronously, right after registration.
        Promise.resolve().then(() => cb(session ? "INITIAL_SESSION" : "INITIAL_SESSION", session));
        return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
      },
      async signOut() {
        setSession(null);
        notify("SIGNED_OUT");
        return { error: null };
      },
      async resetPasswordForEmail() {
        return { error: null }; // not exercised by the e2e test
      },
      async updateUser({ password }) {
        if (!session) return { error: { message: "not signed in" } };
        const { resp, data } = await req("/auth/v1/user", { method: "PUT", headers: { Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ password }) });
        if (!resp.ok) return { error: { message: "update failed" } };
        notify("USER_UPDATED");
        return { data, error: null };
      },
      async refreshSession() {
        return { data: { session }, error: null }; // token expiry is not exercised by the e2e test
      },
    };

    function table(name) {
      const filters = [];
      const builder = {
        select(cols) {
          builder._select = cols;
          return builder;
        },
        eq(col, val) {
          filters.push([col, val]);
          return builder;
        },
        async single() {
          const params = new URLSearchParams();
          if (builder._select) params.set("select", builder._select);
          for (const [c, v] of filters) params.set(c, "eq." + v);
          params.set("limit", "1");
          const { resp, data } = await req(`/rest/v1/${name}?${params.toString()}`, {
            headers: { Authorization: "Bearer " + (session ? session.access_token : "") },
          });
          if (!resp.ok || !Array.isArray(data) || !data.length) return { data: null, error: { message: "not found" } };
          return { data: data[0], error: null };
        },
      };
      return builder;
    }

    return { auth, from: table };
  }

  return { createClient };
})();
