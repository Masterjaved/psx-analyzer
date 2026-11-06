/**
 * Custom Netlify Identity auth — talks directly to the GoTrue REST API
 * (same endpoints the official widget uses internally) instead of loading
 * the iframe-based widget. This avoids iframe-related loading issues.
 *
 * Endpoints used (all relative to this site, since Identity is enabled
 * on it):
 *   POST /.netlify/identity/token     — login (grant_type=password)
 *   POST /.netlify/identity/recover   — request password reset email
 *   PUT  /.netlify/identity/user      — set password using an
 *                                        invite/recovery token from the
 *                                        email link
 */

const TOKEN_KEY = "psx_nf_token";
const USER_KEY = "psx_nf_user";

// Clean up any old service worker registration/cache from earlier versions
// of this app — it was causing pages to show stale content.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
  if (window.caches) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

function saveSession(tokenData, user) {
  const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...tokenData, expiresAt }));
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() >= data.expiresAt) return null; // expired; caller should try refreshSession()
    return data;
  } catch {
    return null;
  }
}

/**
 * Silently extends the session using the refresh_token, without asking
 * the user to log in again. Called automatically when the access token
 * has expired but a refresh_token is still on file.
 */
async function refreshSession() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    if (!old.refresh_token) return null;

    const resp = await fetch("/.netlify/identity/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: old.refresh_token }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const user = data.user || JSON.parse(localStorage.getItem(USER_KEY) || "null");
    saveSession(data, user);
    return user;
  } catch {
    return null;
  }
}

function currentUser() {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

function isAdmin(user) {
  const u = user || currentUser();
  const roles = (u && u.app_metadata && u.app_metadata.roles) || [];
  return roles.includes("admin");
}

async function login(email, password) {
  const resp = await fetch("/.netlify/identity/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: email, password }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error_description || data.msg || "لاگ ان ناکام — ای میل یا پاس ورڈ غلط ہے");
  }
  saveSession(data, data.user);
  return data.user;
}

async function requestPasswordReset(email) {
  const resp = await fetch("/.netlify/identity/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.msg || "ری سیٹ ای میل نہیں بھیجی جا سکی");
  }
}

async function setPasswordWithToken(tokenInfo, password) {
  // Step 1: exchange the one-time invite/recovery/confirmation token for a
  // real session (access_token) via Netlify Identity's verify endpoint.
  const typeMap = { invite_token: "invite", recovery_token: "recovery", confirmation_token: "signup" };
  const verifyResp = await fetch("/.netlify/identity/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: typeMap[tokenInfo.type], token: tokenInfo.token }),
  });
  const session = await verifyResp.json();
  console.log("[auth] verify response:", verifyResp.status, session);
  if (!verifyResp.ok) {
    throw new Error(session.msg || session.error_description || "لنک پرانا ہو چکا ہے یا غلط ہے — نئی دعوت/ری سیٹ لنک منگوائیں");
  }

  // Step 2: now that we have a real access_token, set the chosen password.
  const putResp = await fetch("/.netlify/identity/user", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ password }),
  });
  const user = await putResp.json();
  if (!putResp.ok) {
    throw new Error(user.msg || "پاس ورڈ محفوظ نہیں ہو سکا");
  }

  // Step 3: log them straight in with this session.
  saveSession(session, user);
  return user;
}

function logout() {
  clearSession();
  window.location.reload();
}

/**
 * Reads invite_token / recovery_token / confirmation_token from the URL
 * hash, e.g. #invite_token=xxxx (this is how Netlify's email links work).
 */
function getUrlToken() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const keys = ["invite_token", "recovery_token", "confirmation_token"];
  for (const k of keys) {
    if (hashParams.get(k)) return { type: k, token: hashParams.get(k) };
    if (queryParams.get(k)) return { type: k, token: queryParams.get(k) };
  }
  return null;
}

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

/**
 * Call this at the top of a protected page. Shows a login gate (or a
 * "set your password" form for invite/recovery links) until the user is
 * authenticated, then removes it and calls onReady(user).
 */
async function requireLogin(onReady) {
  const urlToken = getUrlToken();
  console.log("[auth] current URL:", window.location.href);
  console.log("[auth] detected token:", urlToken);
  let user = currentUser();

  if (user && !urlToken) {
    renderUserBar(user);
    if (onReady) onReady(user);
    return;
  }

  // Access token missing/expired but we might still have a refresh_token
  // on file — try extending the session silently before asking to log in.
  if (!user && !urlToken) {
    user = await refreshSession();
    if (user) {
      renderUserBar(user);
      if (onReady) onReady(user);
      return;
    }
  }

  const gate = el(`
    <div id="auth-gate" style="position:fixed;inset:0;background:#ece8dc;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:9999;padding:24px;text-align:center;font-family:inherit;">
      <div style="font-size:18px;font-weight:600;">${urlToken ? "نیا پاس ورڈ بنائیں" : "لاگ ان درکار ہے"}</div>
      <div id="auth-gate-msg" style="font-size:13px;color:#5f5e5a;max-width:280px;">${
        urlToken ? "" : "یہ صفحہ صرف مدعو صارفین کے لیے ہے۔"
      }</div>
      <form id="auth-gate-form" style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px;">
        ${
          urlToken
            ? `<input id="auth-password" type="password" placeholder="نیا پاس ورڈ" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">`
            : `<input id="auth-email" type="email" placeholder="ای میل" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">
               <input id="auth-password" type="password" placeholder="پاس ورڈ" required style="height:42px;border-radius:8px;border:0.5px solid rgba(0,0,0,0.15);padding:0 12px;font-size:14px;">`
        }
        <button type="submit" style="height:44px;border-radius:8px;border:none;background:#06281f;color:white;font-size:14px;cursor:pointer;">${
          urlToken ? "پاس ورڈ محفوظ کریں" : "لاگ ان کریں"
        }</button>
      </form>
      ${!urlToken ? `<button id="auth-forgot" style="background:none;border:none;color:#5f5e5a;text-decoration:underline;font-size:12px;cursor:pointer;">پاس ورڈ بھول گئے؟</button>` : ""}
    </div>
  `);
  document.body.appendChild(gate);

  const msg = gate.querySelector("#auth-gate-msg");
  function showError(text) {
    msg.textContent = text;
    msg.style.color = "#993C1D";
  }
  function showInfo(text) {
    msg.textContent = text;
    msg.style.color = "#0F6E56";
  }

  gate.querySelector("#auth-gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (urlToken) {
        const password = gate.querySelector("#auth-password").value;
        const loggedInUser = await setPasswordWithToken(urlToken, password);
        window.location.hash = "";
        gate.remove();
        renderUserBar(loggedInUser);
        if (onReady) onReady(loggedInUser);
      } else {
        const email = gate.querySelector("#auth-email").value;
        const password = gate.querySelector("#auth-password").value;
        const loggedInUser = await login(email, password);
        gate.remove();
        renderUserBar(loggedInUser);
        if (onReady) onReady(loggedInUser);
      }
    } catch (err) {
      showError(err.message);
    }
  });

  const forgotBtn = gate.querySelector("#auth-forgot");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = gate.querySelector("#auth-email").value;
      if (!email) {
        showError("پہلے اوپر اپنی ای میل لکھیں");
        return;
      }
      try {
        await requestPasswordReset(email);
        showInfo("ری سیٹ لنک آپ کی ای میل پر بھیج دیا گیا ہے۔");
      } catch (err) {
        showError(err.message);
      }
    });
  }
}

function renderUserBar(user) {
  const bar = el(`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#06281f;color:#cdeee2;font-size:12px;">
      <span>${user.email}${isAdmin(user) ? " (ایڈمن)" : ""}</span>
      <span>
        ${isAdmin(user) ? '<a href="admin.html" style="color:#cdeee2;margin-inline-end:12px;">ایڈمن ویو</a>' : ""}
        <a href="scanner.html" style="color:#cdeee2;margin-inline-end:12px;">مارکیٹ اسکینر</a>
        <a href="dividends.html" style="color:#cdeee2;margin-inline-end:12px;">ڈیویڈنڈ کیلنڈر</a>
        <a href="trackrecord.html" style="color:#cdeee2;margin-inline-end:12px;">ٹریک ریکارڈ</a>
        <a href="portfolio.html" style="color:#cdeee2;margin-inline-end:12px;">میرا پورٹ فولیو</a>
        <a href="index.html" style="color:#cdeee2;margin-inline-end:12px;">تجزیہ کار</a>
        <button id="logout-btn" style="background:none;border:none;color:#cdeee2;text-decoration:underline;cursor:pointer;">لاگ آؤٹ</button>
      </span>
    </div>
  `);
  document.body.prepend(bar);
  document.getElementById("logout-btn").addEventListener("click", logout);
}

/**
 * fetch() wrapper that attaches the current user's JWT so backend
 * functions can identify them.
 */
async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token.access_token}`;
  return fetch(url, { ...options, headers });
}
