/**
 * Supabase Auth for every page. Sign-up is invite-only (Supabase project
 * setting "Allow new users to sign up" = off) — someone becomes a user
 * only by an admin inviting their email from the Supabase dashboard.
 *
 * supabase-js keeps the session valid on its own (autoRefreshToken) and
 * fires onAuthStateChange whenever it changes — that single listener
 * drives the whole login gate / user bar / "set your password" flow
 * below, so there is no manual token-expiry or refresh code here (unlike
 * the old Netlify Identity version of this file).
 */

let _currentUser = null;
let _profileRole = null; // 'admin' | 'user' | null (unknown yet)
let _pendingOnReady = null;
let _handledAuthLink = false; // guards against re-showing the set-password gate
let _authResolved = false; // true once onAuthStateChange has fired at least once

function currentUser() {
  return _currentUser;
}

function isAdmin() {
  return _profileRole === "admin";
}

async function refreshProfileRole(user) {
  if (!user) {
    _profileRole = null;
    return;
  }
  try {
    const { data, error } = await sb.from("profiles").select("role,status").eq("user_id", user.id).single();
    if (error) throw error;
    _profileRole = data && data.status === "active" ? data.role : "user";
  } catch {
    _profileRole = "user"; // fail closed — never silently grant admin
  }
}

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function removeGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.remove();
}

function showGate(innerHtml) {
  removeGate();
  const gate = el(`
    <div id="auth-gate" style="position:fixed;inset:0;background:#ece8dc;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:9999;padding:24px;text-align:center;font-family:inherit;">
      ${innerHtml}
    </div>
  `);
  document.body.appendChild(gate);
  return gate;
}

function showLoadingGate() {
  showGate(`<div style="font-size:14px;color:#5f5e5a;">لوڈ ہو رہا ہے...</div>`);
}

function showLoginGate() {
  const gate = showGate(`
    <div style="font-size:18px;font-weight:600;">لاگ ان درکار ہے</div>
    <div id="auth-gate-msg" style="font-size:13px;color:#5f5e5a;max-width:280px;">یہ صفحہ صرف مدعو صارفین کے لیے ہے۔</div>
    <form id="auth-gate-form" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px;">
      <input id="auth-email" type="email" placeholder="ای میل" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">
      <input id="auth-password" type="password" placeholder="پاس ورڈ" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">
      <button type="submit" style="height:44px;border-radius:8px;border:none;background:#06281f;color:white;font-size:14px;cursor:pointer;">لاگ ان کریں</button>
    </form>
    <button id="auth-forgot" style="background:none;border:none;color:#5f5e5a;text-decoration:underline;font-size:12px;cursor:pointer;">پاس ورڈ بھول گئے؟</button>
  `);

  const msg = gate.querySelector("#auth-gate-msg");
  const showError = (t) => {
    msg.textContent = t;
    msg.style.color = "#993C1D";
  };
  const showInfo = (t) => {
    msg.textContent = t;
    msg.style.color = "#0F6E56";
  };

  gate.querySelector("#auth-gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = gate.querySelector("#auth-email").value;
    const password = gate.querySelector("#auth-password").value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) showError(error.message || "لاگ ان ناکام — ای میل یا پاس ورڈ غلط ہے");
    // success: onAuthStateChange takes over (removes gate, renders app)
  });

  gate.querySelector("#auth-forgot").addEventListener("click", async () => {
    const email = gate.querySelector("#auth-email").value;
    if (!email) return showError("پہلے اوپر اپنی ای میل لکھیں");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/index.html" });
    if (error) showError(error.message || "ری سیٹ ای میل نہیں بھیجی جا سکی");
    else showInfo("ری سیٹ لنک آپ کی ای میل پر بھیج دیا گیا ہے۔");
  });
}

function showSetPasswordGate() {
  const gate = showGate(`
    <div style="font-size:18px;font-weight:600;">نیا پاس ورڈ بنائیں</div>
    <div id="auth-gate-msg" style="font-size:13px;color:#5f5e5a;max-width:280px;"></div>
    <form id="auth-gate-form" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px;">
      <input id="auth-password" type="password" placeholder="نیا پاس ورڈ (کم از کم 6 حروف)" minlength="6" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">
      <button type="submit" style="height:44px;border-radius:8px;border:none;background:#06281f;color:white;font-size:14px;cursor:pointer;">پاس ورڈ محفوظ کریں</button>
    </form>
  `);

  const msg = gate.querySelector("#auth-gate-msg");

  gate.querySelector("#auth-gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = gate.querySelector("#auth-password").value;
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      msg.textContent = error.message || "پاس ورڈ محفوظ نہیں ہو سکا";
      msg.style.color = "#993C1D";
      return;
    }
    _handledAuthLink = true;
    window.history.replaceState({}, "", window.location.pathname);
    // onAuthStateChange (USER_UPDATED / already SIGNED_IN) proceeds to the app.
  });
}

function renderUserBar(user) {
  const old = document.getElementById("auth-user-bar");
  if (old) old.remove();
  const bar = el(`
    <div id="auth-user-bar" style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#06281f;color:#cdeee2;font-size:12px;">
      <span>${user.email}${isAdmin() ? " (ایڈمن)" : ""}</span>
      <span>
        ${isAdmin() ? '<a href="admin.html" style="color:#cdeee2;margin-inline-end:12px;">ایڈمن ویو</a>' : ""}
        <a href="portfolio.html" style="color:#cdeee2;margin-inline-end:12px;">میرا پورٹ فولیو</a>
        <a href="index.html" style="color:#cdeee2;margin-inline-end:12px;">تجزیہ کار</a>
        <button id="logout-btn" style="background:none;border:none;color:#cdeee2;text-decoration:underline;cursor:pointer;">لاگ آؤٹ</button>
      </span>
    </div>
  `);
  document.body.prepend(bar);
  document.getElementById("logout-btn").addEventListener("click", logout);
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

/** Call this at the top of a protected page. */
function requireLogin(onReady) {
  _pendingOnReady = onReady || null;
  // Only show the generic spinner if the auth listener (below) hasn't
  // already rendered something real (a login form, a set-password form,
  // or removed the gate because we're signed in) — scripts execute in
  // order, but a microtask checkpoint runs between <script> tags, so the
  // listener's first event can fire before this function is even called.
  if (!document.getElementById("auth-gate")) {
    showLoadingGate();
  }
  if (_authResolved && _currentUser) {
    removeGate();
    renderUserBar(_currentUser);
    if (_pendingOnReady) {
      const cb = _pendingOnReady;
      _pendingOnReady = null;
      cb(_currentUser);
    }
  }
}

sb.auth.onAuthStateChange(async (event, session) => {
  _authResolved = true;
  _currentUser = (session && session.user) || null;

  const isAuthLink = !_handledAuthLink && (window.__authLinkType === "invite" || window.__authLinkType === "recovery");
  if (session && (event === "PASSWORD_RECOVERY" || isAuthLink)) {
    showSetPasswordGate();
    return;
  }

  if (session) {
    await refreshProfileRole(session.user);
    removeGate();
    renderUserBar(session.user);
    if (_pendingOnReady) {
      const cb = _pendingOnReady;
      _pendingOnReady = null;
      cb(session.user);
    }
  } else {
    _profileRole = null;
    const bar = document.getElementById("auth-user-bar");
    if (bar) bar.remove();
    showLoginGate();
  }
});

/**
 * fetch() wrapper that attaches the current Supabase access token. One
 * retry on 401 (a token can expire in the instant between getSession()
 * and the request reaching the server).
 */
async function authFetch(url, options = {}) {
  async function attempt() {
    const { data } = await sb.auth.getSession();
    const headers = { ...(options.headers || {}) };
    if (data && data.session) headers["Authorization"] = `Bearer ${data.session.access_token}`;
    return fetch(url, { ...options, headers });
  }
  let resp = await attempt();
  if (resp.status === 401) {
    await sb.auth.refreshSession().catch(() => {});
    resp = await attempt();
  }
  return resp;
}
