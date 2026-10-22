const { portfolioStore } = require("./lib/blobStore");
const { json, getUser, isAdmin } = require("./lib/http");
const { mapLimit } = require("./lib/pool");

exports.handler = async (event, context) => {
  const user = await getUser(event);
  if (!user || !(await isAdmin(user))) {
    return json(403, { error: "یہ صفحہ صرف ایڈمن کے لیے ہے" });
  }

  try {
    const store = portfolioStore();
    const { blobs } = await store.list();

    const loaded = await mapLimit(blobs, 6, async (b) => {
      const data = await store.get(b.key, { type: "json" });
      return data ? { userId: b.key, ...data } : null;
    });

    return json(200, loaded.filter(Boolean));
  } catch (e) {
    console.error("admin-portfolios error:", e);
    return json(500, { error: "ڈیٹا لوڈ نہیں ہو سکا — Netlify Functions لاگز دیکھیں" });
  }
};
