/**
 * Shared helper for reading/writing user portfolios via Netlify Blobs.
 * Netlify Blobs is a simple built-in key-value store — no external
 * database service needed. Each user's portfolio is stored under a key
 * equal to their Netlify Identity user id (user.sub).
 */
const { getStore } = require("@netlify/blobs");

function portfolioStore() {
  // getStore auto-configures itself using the Netlify runtime context
  // when called from inside a Netlify Function — no manual site ID/token
  // setup needed.
  return getStore("portfolios");
}

module.exports = { portfolioStore };
