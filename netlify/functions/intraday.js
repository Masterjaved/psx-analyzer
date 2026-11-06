const { fetchIntraday, PSXDataError } = require("./lib/psxData");

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "پہلے لاگ ان کریں" }) };
  }

  const symbol = event.queryStringParameters?.symbol;
  if (!symbol) {
    return { statusCode: 400, body: JSON.stringify({ error: "symbol درکار ہے" }) };
  }

  try {
    const points = await fetchIntraday(symbol);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: symbol.toUpperCase(), points }),
    };
  } catch (e) {
    const message = e instanceof PSXDataError ? e.message : `غیر متوقع خرابی: ${e.message}`;
    return { statusCode: 404, body: JSON.stringify({ error: message }) };
  }
};
