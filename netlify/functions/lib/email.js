/**
 * Sends email via Resend (resend.com) — a simple email API with a free
 * tier (100 emails/day). Requires RESEND_API_KEY in environment variables.
 *
 * IMPORTANT: on a brand-new Resend account, you can only send to your OWN
 * verified email address until you verify a sending domain. To send to
 * other users' emails, verify a domain in the Resend dashboard first.
 */
const { timedFetch } = require("./net");

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const from = process.env.RESEND_FROM_EMAIL || "PSX Analyzer <onboarding@resend.dev>";

  const resp = await timedFetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    },
    8000
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend failed (status ${resp.status}): ${text}`);
  }

  return resp.json();
}

module.exports = { sendEmail };
