/**
 * HTML-escaping helper shared by every page (loaded before auth.js).
 * Everything that comes from a user, from PSX, from AI, or from a news
 * feed MUST pass through escapeHtml() before being put into innerHTML.
 * Also usable from Node (tests) via module.exports.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns the URL only if it is a plain http(s) link, otherwise "". */
function safeUrl(value) {
  try {
    const u = new URL(String(value ?? ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { escapeHtml, safeUrl };
}
