/**
 * Netlify Blobs helper (built-in key-value storage for portfolios,
 * alert state and the recommendation track record).
 *
 * IMPORTANT: our functions use the classic "exports.handler(event, context)"
 * format ("Lambda compatibility mode"). In that mode Netlify does NOT
 * configure Blobs automatically — each handler must call initBlobs(event)
 * first, which passes the request's Blobs credentials to the library.
 * (Without this you get: "The environment has not been configured to use
 * Netlify Blobs".)
 *
 * Fallback: if initBlobs() could not connect, a manual siteID + token can be
 * supplied via environment variables (BLOBS_SITE_ID + BLOBS_TOKEN).
 */
const { getStore, connectLambda } = require("@netlify/blobs");

let connected = false;

function initBlobs(event) {
  try {
    if (event && event.blobs) {
      connectLambda(event);
      connected = true;
    }
  } catch {
    connected = false;
  }
  return connected;
}

function openStore(name) {
  if (!connected) {
    const siteID =
      process.env.BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) return getStore({ name, siteID, token });
  }
  return getStore(name);
}

const portfolioStore = () => openStore("portfolios");
const alertStateStore = () => openStore("alert-state");
const recommendationStore = () => openStore("recommendations");

module.exports = { initBlobs, portfolioStore, alertStateStore, recommendationStore, openStore };
