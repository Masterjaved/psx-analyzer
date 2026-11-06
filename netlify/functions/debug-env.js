// Diagnostic helper — visit /api/debug-env in your browser to see which
// environment variables are actually being read by the functions. This
// never returns the actual key values, only whether each is set and how
// many characters long it is (useful to catch copy-paste mistakes like
// extra spaces or a partially-pasted key).

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  const roles = (user && user.app_metadata && user.app_metadata.roles) || [];
  if (!user || !roles.includes("admin")) {
    return { statusCode: 403, body: JSON.stringify({ error: "صرف ایڈمن کے لیے" }) };
  }

  const check = (name) => {
    const val = process.env[name];
    return {
      set: Boolean(val),
      length: val ? val.length : 0,
    };
  };

  const result = {
    ANTHROPIC_API_KEY: check("ANTHROPIC_API_KEY"),
    GEMINI_API_KEY: check("GEMINI_API_KEY"),
    GROQ_API_KEY: check("GROQ_API_KEY"),
    PROVIDER_ORDER: process.env.PROVIDER_ORDER || "(not set — default: claude,gemini,groq)",
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result, null, 2),
  };
};
