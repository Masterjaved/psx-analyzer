const { initBlobs, portfolioStore } = require("./lib/blobStore");

exports.handler = async (event, context) => {
  initBlobs(event);
  const user = context.clientContext && context.clientContext.user;
  const roles = (user && user.app_metadata && user.app_metadata.roles) || [];

  if (!user || !roles.includes("admin")) {
    return { statusCode: 403, body: JSON.stringify({ error: "یہ صفحہ صرف ایڈمن کے لیے ہے" }) };
  }

  try {
    const store = portfolioStore();
    const { blobs } = await store.list();

    const all = [];
    for (const b of blobs) {
      const data = await store.get(b.key, { type: "json" });
      if (data) all.push({ userId: b.key, ...data });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(all),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Blobs خرابی: ${e.message}` }),
    };
  }
};
