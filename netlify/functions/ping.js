// Public health-check: open /api/ping in a browser — if you see {"ok":true},
// the backend functions are deployed and the /api redirect works.
exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ok: true, time: new Date().toISOString() }),
});
