const { initBlobs, portfolioStore } = require("./lib/blobStore");

exports.handler = async (event, context) => {
  initBlobs(event);
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "پہلے لاگ ان کریں" }) };
  }

  try {
    const store = portfolioStore();
    const key = user.sub;

    if (event.httpMethod === "GET") {
      const data = await store.get(key, { type: "json" });
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || { email: user.email, holdings: [] }),
      };
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "غلط JSON" }) };
      }
      const holdings = Array.isArray(body.holdings) ? body.holdings : [];
      const record = {
        email: user.email,
        holdings,
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(key, record);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Blobs خرابی: ${e.message}` }),
    };
  }
};
