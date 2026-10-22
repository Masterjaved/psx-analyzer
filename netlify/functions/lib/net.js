/**
 * fetch() with a hard timeout. Netlify's free tier kills a function after
 * ~10 seconds, so a slow upstream (PSX, an AI provider, Resend...) must
 * never be allowed to hang until then and take the whole response with it.
 */
async function timedFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e && e.name === "AbortError") {
      const err = new Error(`timeout after ${timeoutMs}ms`);
      err.code = "TIMEOUT";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { timedFetch };
