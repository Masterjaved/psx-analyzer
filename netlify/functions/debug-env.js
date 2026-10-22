// Diagnostic helper — visit /api/debug-env in your browser (logged in as
// admin) to see which environment variables the functions can read. This
// never returns the actual values, only whether each is set and how many
// characters long it is (useful to catch copy-paste mistakes like extra
// spaces or a partially-pasted key).

const { json, getUser, isAdmin } = require("./lib/http");

exports.handler = async (event, context) => {
  const user = await getUser(event);
  if (!user || !(await isAdmin(user))) {
    return json(403, { error: "صرف ایڈمن کے لیے" });
  }

  const check = (name) => {
    const val = process.env[name];
    return { set: Boolean(val), length: val ? val.length : 0 };
  };

  return json(200, {
    ai: {
      ANTHROPIC_API_KEY: check("ANTHROPIC_API_KEY"),
      GEMINI_API_KEY: check("GEMINI_API_KEY"),
      GROQ_API_KEY: check("GROQ_API_KEY"),
      OLLAMA_HOST: check("OLLAMA_HOST"),
      PROVIDER_ORDER: process.env.PROVIDER_ORDER || "(not set — default: claude,gemini,groq)",
    },
    email: {
      RESEND_API_KEY: check("RESEND_API_KEY"),
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "(not set — default: onboarding@resend.dev, can only email the Resend account owner)",
      PROFIT_ALERT_PCT: process.env.PROFIT_ALERT_PCT || "(not set — default: 10)",
    },
    supabase: {
      SUPABASE_URL: check("SUPABASE_URL"),
      SUPABASE_ANON_KEY: check("SUPABASE_ANON_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: check("SUPABASE_SERVICE_ROLE_KEY"),
      note: "Phase 2 — used for login, portfolio, watchlist, admin view",
    },
  });
};
