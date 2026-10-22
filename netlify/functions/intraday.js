const { fetchIntraday, PSXDataError, DATA_SOURCE } = require("./lib/psxData");
const { json, getUser } = require("./lib/http");
const { normalizeSymbol } = require("./lib/validate");

exports.handler = async (event, context) => {
  const user = await getUser(event);
  if (!user) return json(401, { error: "پہلے لاگ ان کریں" });

  const symbol = normalizeSymbol(event.queryStringParameters?.symbol || "");
  if (!symbol) return json(400, { error: "درست symbol درکار ہے" });

  try {
    const points = await fetchIntraday(symbol);
    return json(200, { symbol, points, data_source: DATA_SOURCE, fetched_at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof PSXDataError ? e.message : `غیر متوقع خرابی: ${e.message}`;
    return json(404, { error: message });
  }
};
