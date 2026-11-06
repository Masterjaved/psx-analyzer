// PSX Stock Analyzer — frontend logic
// This calls the Netlify Function at /api/analyze (see netlify.toml, which
// redirects /api/* to /.netlify/functions/*). No separate backend server
// or IP address needed — it all runs on the same Netlify site.
const API_BASE = "";

const MAX_SYMBOLS = 10;
const MIN_SYMBOLS = 3;

let symbols = [];
let chartInstance = null;

const symbolInput = document.getElementById("symbolInput");
const addBtn = document.getElementById("addBtn");
const chipsEl = document.getElementById("chips");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultsCard = document.getElementById("resultsCard");
const tblBody = document.getElementById("tblBody");
const emptyState = document.getElementById("emptyState");

function renderChips() {
  chipsEl.innerHTML = "";
  symbols.forEach((sym, idx) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${sym}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `${sym} ہٹائیں`);
    removeBtn.onclick = () => {
      symbols.splice(idx, 1);
      renderChips();
    };
    chip.appendChild(removeBtn);
    chipsEl.appendChild(chip);
  });
  analyzeBtn.disabled = symbols.length < MIN_SYMBOLS;
  addBtn.disabled = symbols.length >= MAX_SYMBOLS;
}

addBtn.addEventListener("click", () => {
  const val = symbolInput.value.trim().toUpperCase();
  if (!val) return;
  if (symbols.includes(val)) {
    symbolInput.value = "";
    return;
  }
  if (symbols.length >= MAX_SYMBOLS) return;
  symbols.push(val);
  symbolInput.value = "";
  renderChips();
});

symbolInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addBtn.click();
  }
});

function badgeHtml(text, kind) {
  const map = {
    good: ["var(--green-bg)", "var(--green-text)"],
    bad: ["var(--red-bg)", "var(--red-text)"],
    neutral: ["var(--amber-bg)", "var(--amber-text)"],
  };
  const [bg, fg] = map[kind] || map.neutral;
  return `<span class="badge" style="background:${bg}; color:${fg};">${text}</span>`;
}

function positionBadgeKind(positionEn) {
  if (positionEn === "Strong") return "good";
  if (positionEn === "Weak") return "bad";
  return "neutral";
}

function recommendationBadgeKind(recEn) {
  if (recEn === "Buy") return "good";
  if (recEn === "Don't buy") return "bad";
  return "neutral";
}

async function analyze() {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "تجزیہ ہو رہا ہے...";
  emptyState.style.display = "none";

  try {
    const resp = await authFetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `سرور کی خرابی (${resp.status})`);
    }
    const data = await resp.json();
    renderResults(data);
  } catch (err) {
    tblBody.innerHTML = `<tr><td colspan="5" style="color:var(--red-text);">خرابی: ${err.message}<br><span style="font-size:12px;">کیا بیک اینڈ سرور چل رہا ہے؟ / Is the backend server running?</span></td></tr>`;
    resultsCard.style.display = "block";
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "تجزیہ کریں / Analyze";
  }
}

function rangeBadgeHtml(rangeData, labelUr, labelEn) {
  if (!rangeData) return "";
  return `<span class="range-badge">${labelUr}/${labelEn}: ${rangeData.labelEn === "Near high" ? "🔼" : rangeData.labelEn === "Near low" ? "🔽" : "↔️"} ${rangeData.label} (${rangeData.pctFromHigh}% از بلند ترین)</span>`;
}

function trendIcon(trendEn) {
  if (trendEn === "Uptrend") return "📈";
  if (trendEn === "Downtrend") return "📉";
  return "➡️";
}

function renderResults(rows) {
  resultsCard.style.display = "block";
  tblBody.innerHTML = "";

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    if (r.error) {
      tr.innerHTML = `<td style="font-weight:500;">${r.symbol}</td><td colspan="5" style="color:var(--red-text); font-size:12px;">${r.error}</td>`;
      tblBody.appendChild(tr);
      return;
    }
    const upClass = r.upside_pct >= 0 ? "up-pos" : "up-neg";
    const upSign = r.upside_pct >= 0 ? "+" : "";
    const rowId = `detail-${idx}`;
    tr.innerHTML = `
      <td style="font-weight:500;">${r.symbol}</td>
      <td style="color:var(--text-secondary);">${r.price ?? "-"}</td>
      <td>${badgeHtml(r.position, positionBadgeKind(r.position_en))}<br><span style="font-size:11px; color:var(--text-secondary);">${trendIcon(r.trend_en)} ${r.trend}</span></td>
      <td class="${upClass}">${upSign}${r.upside_pct}%</td>
      <td>
        ${badgeHtml(r.recommendation, recommendationBadgeKind(r.recommendation_en))}
        ${r.ai_summary ? `<p class="ai-note">${r.ai_summary}${r.ai_provider ? ` <span class="provider-tag">— ${r.ai_provider}</span>` : ""}</p>` : ""}
      </td>
      <td><button class="detail-btn" data-target="${rowId}" data-symbol="${r.symbol}">تفصیل</button></td>
    `;
    tblBody.appendChild(tr);

    const newsHtml = (r.news && r.news.length)
      ? `<div style="margin-top:8px; font-size:12px;">
           <div style="color:var(--text-secondary); margin-bottom:4px;">📰 حالیہ خبریں (کم ترین سطح کے قریب ہونے کی وجہ سے شامل کی گئیں):</div>
           <ul style="margin:0; padding-inline-start:18px; color:var(--text-secondary);">
             ${r.news.map((n) => `<li>${n.title}</li>`).join("")}
           </ul>
         </div>`
      : "";

    const detailTr = document.createElement("tr");
    detailTr.className = "detail-row";
    detailTr.id = rowId;
    detailTr.style.display = "none";
    detailTr.innerHTML = `
      <td colspan="6">
        <div class="range-badges">
          ${rangeBadgeHtml(r.three_month, "3 ماہ", "3M")}
          ${rangeBadgeHtml(r.one_year, "1 سال", "1Y")}
        </div>
        ${newsHtml}
        <div class="intraday-status" data-status="${r.symbol}">آج کا چارٹ لوڈ کرنے کے لیے دبائیں</div>
        <button class="detail-btn" data-load-intraday="${r.symbol}">آج کا چارٹ دکھائیں</button>
        <div class="intraday-wrap" style="display:none;" data-chart-wrap="${r.symbol}">
          <canvas data-chart-canvas="${r.symbol}"></canvas>
        </div>
      </td>
    `;
    tblBody.appendChild(detailTr);
  });

  tblBody.querySelectorAll(".detail-btn[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(btn.dataset.target);
      row.style.display = row.style.display === "none" ? "table-row" : "none";
    });
  });

  tblBody.querySelectorAll("[data-load-intraday]").forEach((btn) => {
    btn.addEventListener("click", () => loadIntraday(btn.dataset.loadIntraday));
  });

  renderChart(rows.filter((r) => !r.error));
}

let intradayCharts = {};

async function loadIntraday(symbol) {
  const statusEl = document.querySelector(`[data-status="${symbol}"]`);
  const wrapEl = document.querySelector(`[data-chart-wrap="${symbol}"]`);
  const canvasEl = document.querySelector(`[data-chart-canvas="${symbol}"]`);
  statusEl.textContent = "لوڈ ہو رہا ہے...";

  try {
    const resp = await authFetch(`${API_BASE}/api/intraday?symbol=${encodeURIComponent(symbol)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "خرابی");

    wrapEl.style.display = "block";
    statusEl.textContent = "";

    if (intradayCharts[symbol]) intradayCharts[symbol].destroy();
    intradayCharts[symbol] = new Chart(canvasEl, {
      type: "line",
      data: {
        labels: data.points.map((p) => new Date(p.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })),
        datasets: [
          {
            data: data.points.map((p) => p.price),
            borderColor: "#1baf7a",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 6 } } },
      },
    });
  } catch (err) {
    statusEl.textContent = `آج کا ڈیٹا نہیں مل سکا: ${err.message}`;
  }
}

function renderChart(rows) {
  const canvas = document.getElementById("cmpChart");
  if (chartInstance) chartInstance.destroy();
  if (!rows.length) return;

  chartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.symbol),
      datasets: [
        {
          data: rows.map((r) => r.upside_pct),
          backgroundColor: rows.map((r) => (r.upside_pct >= 0 ? "#1baf7a" : "#e34948")),
          borderRadius: 4,
          barThickness: 28,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: (v) => v + "%" }, grid: { color: "#e1e0d9" } },
        x: { grid: { display: false } },
      },
    },
  });
}

analyzeBtn.addEventListener("click", analyze);
renderChips();

// Service worker cleanup now handled in auth.js (loaded before this file).
