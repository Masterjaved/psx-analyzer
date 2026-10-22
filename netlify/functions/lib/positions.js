/**
 * Turns a raw transaction history into current positions. Pure function —
 * no network, easy to unit test. A SELL never edits or deletes the BUY
 * rows; everything is derived fresh from the full history every time.
 *
 * Accounting method: average cost.
 *   BUY / RIGHTS : qty += quantity; investedAmount += quantity*price
 *   SELL         : realizedPL += (price - avgCost) * quantity;
 *                  investedAmount -= avgCost * quantity; qty -= quantity
 *                  (selling more than held is clamped to what is held —
 *                  flagged via `oversold` so the UI/admin can see it)
 *   BONUS / SPLIT: qty += quantity (free shares; investedAmount unchanged,
 *                  which correctly lowers average cost per share)
 *   DIVIDEND     : totalDividends += quantity * price; qty/cost unchanged
 *                  (quantity is the shares held at record date, price is
 *                  cash dividend per share, per the schema's documented
 *                  convention)
 * Transactions are processed oldest-first regardless of input order.
 */
function computePositions(transactions) {
  const bySymbol = new Map();
  const sorted = [...(transactions || [])].sort((a, b) => {
    const d = String(a.transaction_date).localeCompare(String(b.transaction_date));
    return d !== 0 ? d : String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  for (const t of sorted) {
    const symbol = t.symbol;
    if (!bySymbol.has(symbol)) {
      bySymbol.set(symbol, {
        symbol,
        companyName: t.company_name || null,
        qty: 0,
        investedAmount: 0,
        realizedPL: 0,
        totalDividends: 0,
        oversold: false,
        strategy: t.strategy || null,
        notes: t.notes || null,
        lastTransactionDate: null,
      });
    }
    const pos = bySymbol.get(symbol);
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;

    switch (t.transaction_type) {
      case "BUY":
      case "RIGHTS":
        pos.qty += qty;
        pos.investedAmount += qty * price;
        break;
      case "SELL": {
        const avgCost = pos.qty > 0 ? pos.investedAmount / pos.qty : 0;
        const sellQty = Math.min(qty, pos.qty);
        if (qty > pos.qty) pos.oversold = true;
        pos.realizedPL += (price - avgCost) * sellQty;
        pos.investedAmount -= avgCost * sellQty;
        pos.qty -= sellQty;
        if (pos.qty < 1e-9) pos.qty = 0;
        break;
      }
      case "BONUS":
      case "SPLIT":
        pos.qty += qty;
        break;
      case "DIVIDEND":
        pos.totalDividends += qty * price;
        break;
      default:
        break;
    }

    if (t.strategy) pos.strategy = t.strategy;
    if (t.notes) pos.notes = t.notes;
    if (t.company_name) pos.companyName = t.company_name;
    pos.lastTransactionDate = t.transaction_date;
  }

  const positions = [...bySymbol.values()].map((p) => ({
    ...p,
    avgCost: p.qty > 0 ? Math.round((p.investedAmount / p.qty) * 10000) / 10000 : 0,
    investedAmount: Math.round(p.investedAmount * 100) / 100,
    realizedPL: Math.round(p.realizedPL * 100) / 100,
    totalDividends: Math.round(p.totalDividends * 100) / 100,
  }));

  return positions;
}

/** Splits into open holdings (qty > 0) and fully-exited symbols (qty == 0, kept for realized P/L history). */
function splitOpenClosed(positions) {
  return {
    open: positions.filter((p) => p.qty > 0),
    closed: positions.filter((p) => p.qty === 0 && (p.realizedPL !== 0 || p.totalDividends !== 0)),
  };
}

module.exports = { computePositions, splitOpenClosed };
