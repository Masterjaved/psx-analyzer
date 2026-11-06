/**
 * Fetches recent news headlines for a stock via Google News' public RSS
 * feed — no API key needed. Used to give the AI extra context (beyond
 * pure technical indicators) when a stock is trading near its recent low,
 * so it can factor in whether the news around it looks likely to help it
 * recover or push it further down.
 */
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

async function fetchNews(symbol, limit = 5) {
  const query = encodeURIComponent(`${symbol} PSX Pakistan stock`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-PK&gl=PK&ceid=PK:en`;

  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) return [];

    const xml = await resp.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    const headlines = [];
    $("item").each((i, el) => {
      if (i >= limit) return;
      const title = $(el).find("title").first().text().trim();
      const pubDate = $(el).find("pubDate").first().text().trim();
      if (title) headlines.push({ title, pubDate });
    });

    return headlines;
  } catch {
    return []; // news is a nice-to-have — never let it break the main analysis
  }
}

module.exports = { fetchNews };
