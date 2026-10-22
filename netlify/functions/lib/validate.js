/** Input validation shared by the functions. */

// PSX symbols are short uppercase codes (letters/digits, occasionally a dash).
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9\-]{0,14}$/;
const STRATEGIES = ["SHORT_TERM", "SWING", "HOLD", "LONG_TERM", "WATCHLIST"];
const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "BONUS", "RIGHTS", "SPLIT"];
const MAX_HOLDINGS = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the normalised symbol, or null if it isn't a valid code. */
function normalizeSymbol(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

function isPositiveNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Validates the holdings array a client wants to save. Returns
 * { ok: true, holdings } (cleaned, unknown fields dropped) or
 * { ok: false, error }.
 */
function validateHoldings(input, makeId) {
  if (!Array.isArray(input)) return { ok: false, error: "holdings array درکار ہے" };
  if (input.length > MAX_HOLDINGS) {
    return { ok: false, error: `زیادہ سے زیادہ ${MAX_HOLDINGS} ہولڈنگز محفوظ ہو سکتی ہیں` };
  }

  const cleaned = [];
  for (let i = 0; i < input.length; i++) {
    const h = input[i];
    if (!h || typeof h !== "object") return { ok: false, error: `ہولڈنگ ${i + 1} غلط ہے` };

    const symbol = normalizeSymbol(h.symbol);
    if (!symbol) return { ok: false, error: `ہولڈنگ ${i + 1}: سٹاک کوڈ غلط ہے` };
    if (!isPositiveNumber(h.qty)) return { ok: false, error: `${symbol}: مقدار مثبت عدد ہونی چاہیے` };
    if (!isPositiveNumber(h.buyPrice)) return { ok: false, error: `${symbol}: خریدی قیمت مثبت عدد ہونی چاہیے` };

    const out = { id: typeof h.id === "string" && h.id.length <= 64 ? h.id : makeId(), symbol, qty: h.qty, buyPrice: h.buyPrice };

    if (h.buyDate != null && h.buyDate !== "") {
      if (typeof h.buyDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(h.buyDate)) {
        return { ok: false, error: `${symbol}: تاریخ YYYY-MM-DD فارمیٹ میں ہونی چاہیے` };
      }
      out.buyDate = h.buyDate;
    }
    if (h.strategy != null && h.strategy !== "") {
      if (!STRATEGIES.includes(h.strategy)) return { ok: false, error: `${symbol}: strategy غلط ہے` };
      out.strategy = h.strategy;
    }
    if (h.notes != null && h.notes !== "") {
      if (typeof h.notes !== "string" || h.notes.length > 500) {
        return { ok: false, error: `${symbol}: نوٹس 500 حروف سے کم ہونے چاہییں` };
      }
      out.notes = h.notes;
    }
    cleaned.push(out);
  }
  return { ok: true, holdings: cleaned };
}


/**
 * Validates a single transaction the client wants to insert. Returns
 * { ok: true, row } (cleaned, matches portfolio_transactions columns) or
 * { ok: false, error }.
 */
function validateTransaction(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "transaction غلط ہے" };

  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) return { ok: false, error: "سٹاک کوڈ غلط ہے" };

  if (!TRANSACTION_TYPES.includes(input.transaction_type)) {
    return { ok: false, error: "transaction_type غلط ہے" };
  }
  if (!isPositiveNumber(input.quantity)) return { ok: false, error: `${symbol}: مقدار مثبت عدد ہونی چاہیے` };

  const priceRequired = input.transaction_type !== "BONUS" && input.transaction_type !== "SPLIT";
  const price = input.price == null ? 0 : Number(input.price);
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: `${symbol}: قیمت غلط ہے` };
  if (priceRequired && input.transaction_type !== "DIVIDEND" && price === 0) {
    return { ok: false, error: `${symbol}: قیمت 0 نہیں ہو سکتی` };
  }

  if (typeof input.transaction_date !== "string" || !DATE_RE.test(input.transaction_date)) {
    return { ok: false, error: `${symbol}: تاریخ YYYY-MM-DD فارمیٹ میں ہونی چاہیے` };
  }

  const row = {
    symbol,
    transaction_type: input.transaction_type,
    quantity: input.quantity,
    price,
    transaction_date: input.transaction_date,
  };

  if (input.company_name != null && input.company_name !== "") {
    if (typeof input.company_name !== "string" || input.company_name.length > 120) {
      return { ok: false, error: `${symbol}: کمپنی کا نام بہت لمبا ہے` };
    }
    row.company_name = input.company_name;
  }
  if (input.strategy != null && input.strategy !== "") {
    if (!STRATEGIES.includes(input.strategy)) return { ok: false, error: `${symbol}: strategy غلط ہے` };
    row.strategy = input.strategy;
  }
  if (input.notes != null && input.notes !== "") {
    if (typeof input.notes !== "string" || input.notes.length > 500) {
      return { ok: false, error: `${symbol}: نوٹس 500 حروف سے کم ہونے چاہییں` };
    }
    row.notes = input.notes;
  }
  if (input.portfolio_id != null) {
    if (typeof input.portfolio_id !== "string" || input.portfolio_id.length > 64) {
      return { ok: false, error: "portfolio_id غلط ہے" };
    }
    row.portfolio_id = input.portfolio_id;
  }

  return { ok: true, row };
}

/** Validates a watchlist entry the client wants to save. */
function validateWatchlistEntry(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "entry غلط ہے" };
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) return { ok: false, error: "سٹاک کوڈ غلط ہے" };

  const row = { symbol };
  if (input.company_name != null && input.company_name !== "") {
    if (typeof input.company_name !== "string" || input.company_name.length > 120) {
      return { ok: false, error: `${symbol}: کمپنی کا نام بہت لمبا ہے` };
    }
    row.company_name = input.company_name;
  }
  if (input.notes != null && input.notes !== "") {
    if (typeof input.notes !== "string" || input.notes.length > 500) {
      return { ok: false, error: `${symbol}: نوٹس 500 حروف سے کم ہونے چاہییں` };
    }
    row.notes = input.notes;
  }
  return { ok: true, row };
}

module.exports = {
  normalizeSymbol,
  validateHoldings,
  validateTransaction,
  validateWatchlistEntry,
  STRATEGIES,
  TRANSACTION_TYPES,
  MAX_HOLDINGS,
};
