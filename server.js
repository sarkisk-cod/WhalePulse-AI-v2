const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const AI_KEY = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || process.env.BITGET_QWEN_API_KEY || "";
const AI_BASE = process.env.OPENAI_BASE_URL || "https://hackathon.bitgetops.com/v1";
const AI_MODEL = process.env.MODEL || process.env.QWEN_MODEL || "qwen3.8-max";

const RTOKENS = [
  { pair: "RNVDAUSDT", label: "rNVDA", stock: "NVDA" },
  { pair: "RTSLAUSDT", label: "rTSLA", stock: "TSLA" },
  { pair: "RAAPLUSDT", label: "rAAPL", stock: "AAPL" },
  { pair: "RMSFTUSDT", label: "rMSFT", stock: "MSFT" },
  { pair: "RGOOGLUSDT", label: "rGOOGL", stock: "GOOGL" },
  { pair: "RMETAUSDT", label: "rMETA", stock: "META" },
  { pair: "RAMZNUSDT", label: "rAMZN", stock: "AMZN" },
  { pair: "RCOINUSDT", label: "rCOIN", stock: "COIN" },
];
const TRADE_UNIVERSE = new Set(["rNVDA", "rTSLA", "rAAPL", "rMSFT", "rCOIN", "rAMZN"]);
const memory = { market: null, marketAt: 0, correlation: null, correlationAt: 0 };

function nyMarketRegime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit",
    minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(value.hour) * 60 + Number(value.minute);
  const weekend = value.weekday === "Sat" || value.weekday === "Sun";
  let code = "CLOSED";
  if (!weekend && minutes >= 240 && minutes < 570) code = "PRE-MARKET";
  if (!weekend && minutes >= 570 && minutes < 960) code = "REGULAR";
  if (!weekend && minutes >= 960 && minutes < 1200) code = "AFTER-HOURS";
  if (weekend) code = "WEEKEND";
  return {
    code,
    ny_time: `${value.hour}:${value.minute} ET`,
    equity_market_open: code === "REGULAR",
    discovery_mode: code === "REGULAR" ? "CONVERGENCE" : "rTOKEN LEADS",
  };
}

function requestJSON(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": "WhalePulse-AI-v2/2.0", Accept: "application/json" },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`upstream status ${res.statusCode}`));
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("upstream returned invalid JSON")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("upstream timeout")));
  });
}

function sendJSON(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function fetchRTokenPrices() {
  const response = await requestJSON("https://api.bitget.com/api/v2/spot/market/tickers");
  const rows = Array.isArray(response.data) ? response.data : [];
  const byPair = new Map(rows.map((row) => [row.symbol, row]));
  return RTOKENS.map((asset) => {
    const row = byPair.get(asset.pair);
    if (!row) return { ...asset, available: false };
    const price = Number(row.lastPr);
    const open24h = Number(row.open);
    const derivedChange = Number.isFinite(price) && Number.isFinite(open24h) && open24h > 0
      ? ((price - open24h) / open24h) * 100
      : null;
    const reportedChange = Number(row.change24h);
    return {
      ...asset,
      available: Number.isFinite(price) && price > 0,
      price,
      open_24h: Number.isFinite(open24h) && open24h > 0 ? open24h : null,
      change_pct: Number.isFinite(derivedChange)
        ? Number(derivedChange.toFixed(4))
        : Number.isFinite(reportedChange) ? Number((reportedChange * 100).toFixed(4)) : null,
      change_period: "rolling_24h",
      high: Number(row.high24h || 0),
      low: Number(row.low24h || 0),
      volume_usd: Number(row.quoteVolume || 0),
    };
  });
}

async function fetchYahooSeries(symbol, range = "1mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=true`;
  const data = await requestJSON(url);
  const chart = data?.chart?.result?.[0];
  if (!chart?.meta) throw new Error(`missing equity data for ${symbol}`);
  const timestamps = chart.timestamp || [];
  const rawCloses = chart.indicators?.quote?.[0]?.close || [];
  const series = timestamps
    .map((timestamp, index) => ({
      day: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
      close: Number(rawCloses[index]),
    }))
    .filter((point) => Number.isFinite(point.close));
  const closes = series.map((point) => point.close);
  return {
    symbol,
    price: Number(chart.meta.regularMarketPrice ?? closes.at(-1)),
    previous_close: Number(chart.meta.chartPreviousClose ?? chart.meta.previousClose),
    change_pct: Number.isFinite(chart.meta.regularMarketPrice) && Number.isFinite(chart.meta.chartPreviousClose)
      ? ((chart.meta.regularMarketPrice - chart.meta.chartPreviousClose) / chart.meta.chartPreviousClose) * 100
      : null,
    closes,
    series,
  };
}

async function fetchRTokenCloses(pair) {
  const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${pair}&granularity=1day&limit=30`;
  const data = await requestJSON(url);
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows
    .map((row) => ({ ts: Number(row[0]), day: new Date(Number(row[0])).toISOString().slice(0, 10), close: Number(row[4]) }))
    .filter((row) => Number.isFinite(row.close))
    .sort((a, b) => a.ts - b.ts);
}

async function getMarketSnapshot(force = false) {
  if (!force && memory.market && Date.now() - memory.marketAt < 20000) return memory.market;
  const [rTokenResult, equityResult] = await Promise.allSettled([
    fetchRTokenPrices(),
    Promise.allSettled(RTOKENS.map((asset) => fetchYahooSeries(asset.stock))),
  ]);
  const rTokenRows = rTokenResult.status === "fulfilled" ? rTokenResult.value : RTOKENS.map((asset) => ({ ...asset, available: false }));
  const equitySettled = equityResult.status === "fulfilled" ? equityResult.value : [];
  const equityRows = equitySettled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const equities = new Map(equityRows.map((row) => [row.symbol, row]));
  const assets = rTokenRows.map((row) => {
    const equity = equities.get(row.stock);
    const basis = row.available && equity?.price
      ? ((row.price - equity.price) / equity.price) * 100
      : null;
    return {
      ...row,
      equity_price: equity?.price ?? null,
      equity_change_pct: equity?.change_pct ?? null,
      basis_pct: Number.isFinite(basis) ? Number(basis.toFixed(3)) : null,
      basis_state: !Number.isFinite(basis) ? "UNAVAILABLE" : basis > 0.5 ? "PREMIUM" : basis < -0.5 ? "DISCOUNT" : "ALIGNED",
    };
  });
  const snapshot = {
    assets,
    regime: nyMarketRegime(),
    sources: {
      bitget: rTokenResult.status === "fulfilled" ? "live" : "unavailable",
      yahoo_finance: equityRows.length === RTOKENS.length ? "live" : equityRows.length ? "partial" : "unavailable",
    },
    updated_at: new Date().toISOString(),
  };
  memory.market = snapshot;
  memory.marketAt = Date.now();
  return snapshot;
}

function pearson(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 5) return null;
  const a = left.slice(-length);
  const b = right.slice(-length);
  const meanA = a.reduce((sum, value) => sum + value, 0) / length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denominator = Math.sqrt(denomA * denomB);
  return denominator ? Number((numerator / denominator).toFixed(3)) : null;
}

function alignedReturnPair(leftSeries, rightSeries) {
  const leftByDay = new Map(leftSeries.map((point) => [point.day, point.close]));
  const rightByDay = new Map(rightSeries.map((point) => [point.day, point.close]));
  const days = [...leftByDay.keys()].filter((day) => rightByDay.has(day)).sort();
  const left = [];
  const right = [];
  for (let index = 1; index < days.length; index += 1) {
    const previousDay = days[index - 1];
    const currentDay = days[index];
    const previousLeft = leftByDay.get(previousDay);
    const previousRight = rightByDay.get(previousDay);
    if (!previousLeft || !previousRight) continue;
    left.push((leftByDay.get(currentDay) - previousLeft) / previousLeft);
    right.push((rightByDay.get(currentDay) - previousRight) / previousRight);
  }
  return { left, right };
}

async function getCorrelations() {
  if (memory.correlation && Date.now() - memory.correlationAt < 300000) return memory.correlation;
  const benchmarkResults = await Promise.allSettled([fetchYahooSeries("SPY"), fetchYahooSeries("QQQ")]);
  const spySeries = benchmarkResults[0].status === "fulfilled" ? benchmarkResults[0].value.series : [];
  const qqqSeries = benchmarkResults[1].status === "fulfilled" ? benchmarkResults[1].value.series : [];
  const rows = await Promise.all(RTOKENS.map(async (asset) => {
    try {
      const tokenSeries = await fetchRTokenCloses(asset.pair);
      const spyPair = alignedReturnPair(tokenSeries, spySeries);
      const qqqPair = alignedReturnPair(tokenSeries, qqqSeries);
      return {
        label: asset.label,
        spy: pearson(spyPair.left, spyPair.right),
        qqq: pearson(qqqPair.left, qqqPair.right),
        observations: Math.min(spyPair.left.length, qqqPair.left.length),
      };
    } catch {
      return { label: asset.label, spy: null, qqq: null, observations: 0 };
    }
  }));
  const response = { rows, window: "30 daily observations", updated_at: new Date().toISOString() };
  memory.correlation = response;
  memory.correlationAt = Date.now();
  return response;
}

function buildFlowIntelligence(market) {
  const available = market.assets.filter((asset) => asset.available);
  const byVolume = [...available].sort((a, b) => b.volume_usd - a.volume_usd);
  const byBasis = [...available].filter((asset) => Number.isFinite(asset.basis_pct)).sort((a, b) => Math.abs(b.basis_pct) - Math.abs(a.basis_pct));
  const events = [];
  if (byVolume[0]) events.push({
    severity: "HIGH", asset: byVolume[0].label, type: "VENUE VOLUME CONCENTRATION",
    detail: `${byVolume[0].label} leads the tracked rToken tape with $${Math.round(byVolume[0].volume_usd).toLocaleString("en-US")} in 24h quote volume.`,
  });
  byBasis.slice(0, 3).forEach((asset) => events.push({
    severity: Math.abs(asset.basis_pct) >= 1.5 ? "HIGH" : "MEDIUM",
    asset: asset.label,
    type: "BASIS MOVEMENT",
    detail: `${asset.label} trades at a ${Math.abs(asset.basis_pct).toFixed(2)}% ${asset.basis_pct >= 0 ? "premium" : "discount"} to ${asset.stock}.`,
  }));
  events.push({
    severity: "INFO", asset: "US SESSION", type: "MARKET REGIME",
    detail: `${market.regime.code} at ${market.regime.ny_time}; price-discovery mode is ${market.regime.discovery_mode}.`,
  });
  return { events, updated_at: market.updated_at };
}

function buildSentiment(market) {
  const changes = market.assets.map((asset) => asset.equity_change_pct).filter(Number.isFinite);
  const average = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(50 + average * 10)));
  const classification = score >= 60 ? "RISK-ON" : score <= 40 ? "RISK-OFF" : "BALANCED";
  return {
    score,
    classification,
    feeds: [
      { source: "FED POLICY", signal: "DATA-DEPENDENT", detail: "Rate expectations remain the primary valuation input for long-duration technology equities." },
      { source: "TECH EARNINGS", signal: average >= 0 ? "CONSTRUCTIVE" : "CAUTIOUS", detail: `Tracked mega-cap equity breadth averages ${average >= 0 ? "+" : ""}${average.toFixed(2)}% for the current session.` },
      { source: "WALL STREET", signal: classification, detail: `${market.assets.filter((asset) => (asset.equity_change_pct || 0) > 0).length} of ${changes.length || market.assets.length} tracked equities show positive session breadth.` },
    ],
    updated_at: market.updated_at,
  };
}

function buildPaperTrades(market) {
  return market.assets
    .filter((asset) => TRADE_UNIVERSE.has(asset.label) && asset.available && Number.isFinite(asset.price))
    .slice(0, 6)
    .map((asset, index) => {
      const side = (asset.basis_pct || 0) > 0.5 ? "SHORT" : "LONG";
      const entry = asset.price;
      const stop = side === "LONG" ? entry * 0.98 : entry * 1.02;
      const target = side === "LONG" ? entry * 1.03 : entry * 0.97;
      return {
        time: new Date(Date.now() - index * 60000).toISOString(),
        asset: asset.label,
        pair: asset.pair,
        side,
        size_pct: 2,
        entry_price: Number(entry.toFixed(4)),
        stop_loss: Number(stop.toFixed(4)),
        take_profit: Number(target.toFixed(4)),
        status: "PAPER_INSIGHT",
        rationale: `${asset.basis_state} basis with ${market.regime.code.toLowerCase()} session controls.`,
      };
    });
}

function buildAgentEvents(market) {
  const events = market.assets
    .filter((asset) => asset.available && Number.isFinite(asset.change_pct))
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 4)
    .map((asset) => ({
      event_type: "rtoken_price_move",
      asset: asset.label,
      severity: Math.abs(asset.change_pct) >= 3 ? "HIGH" : "MEDIUM",
      action: Math.abs(asset.basis_pct || 0) >= 0.5 ? "REVIEW_BASIS_TRADE" : "MONITOR",
      description: `${asset.label} moved ${asset.change_pct >= 0 ? "+" : ""}${asset.change_pct.toFixed(2)}% with ${asset.basis_state.toLowerCase()} basis.`,
    }));
  return {
    state: events.some((event) => event.severity === "HIGH") ? "REVIEW" : "SCANNING",
    events,
    next_scan_seconds: 45,
    analysis_source: "deterministic_market_scan",
    human_decision_required: true,
  };
}

function buildResearchRun(market, decisions, analysisSource, qwenGenerated, fallbackReason = null) {
  const generatedAt = new Date().toISOString();
  const sourceTag = qwenGenerated ? "QWEN" : "FALLBACK";
  const allowedAssetsOnly = decisions.every((trade) => TRADE_UNIVERSE.has(trade.asset));
  const positionLimitsPassed = decisions.every((trade) => Number(trade.size_pct) >= 0 && Number(trade.size_pct) <= 5);
  const stopLimitsPassed = decisions.every((trade) => {
    const entry = Number(trade.entry_price);
    const stop = Number(trade.stop_loss);
    return Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && Math.abs(stop - entry) / entry <= 0.0301;
  });
  return {
    run_id: `WPAI-${generatedAt.replace(/\D/g, "")}-${sourceTag}`,
    generated_at: generatedAt,
    research_question: "Which whitelisted rToken paper setups warrant human review under the current basis and New York market regime?",
    input_universe: market.assets
      .filter((asset) => TRADE_UNIVERSE.has(asset.label))
      .map(({ label, stock, pair, price, equity_price, basis_pct, basis_state, change_pct }) => ({
        asset: label,
        stock,
        pair,
        rtoken_price: price,
        equity_reference_price: equity_price,
        basis_pct,
        basis_state,
        change_24h_pct: change_pct,
      })),
    data_sources: market.sources,
    market_snapshot_at: market.updated_at,
    market_regime: market.regime,
    analysis_source: analysisSource,
    qwen_generated: qwenGenerated,
    fallback_reason: fallbackReason,
    risk_validation: {
      status: allowedAssetsOnly && positionLimitsPassed && stopLimitsPassed ? "PASSED" : "FAILED",
      allowed_assets_only: allowedAssetsOnly,
      position_limits_passed: positionLimitsPassed,
      stop_limits_passed: stopLimitsPassed,
      maximum_position_pct: 5,
      maximum_stop_distance_pct: 3,
    },
    paper_insights: decisions,
    human_decision: { required: true, status: "PENDING", recorded_at: null },
  };
}

async function callAI(system, payload) {
  if (!AI_KEY) return null;
  const url = new URL(`${AI_BASE}/chat/completions`);
  const body = JSON.stringify({
    model: AI_MODEL,
    temperature: 0.2,
    max_tokens: 900,
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: "POST",
      headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          let content = JSON.parse(data)?.choices?.[0]?.message?.content || "";
          content = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
          resolve(JSON.parse(content));
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(45000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function getTradeDecisions(market) {
  const fallback = buildPaperTrades(market);
  const fallbackResponse = (reason) => {
    const analysisSource = "deterministic_fallback";
    return {
      decisions: fallback,
      engine: "Deterministic research fallback",
      analysis_source: analysisSource,
      qwen_generated: false,
      fallback_reason: reason,
      paper_only: true,
      human_decision_required: true,
      research_run: buildResearchRun(market, fallback, analysisSource, false, reason),
    };
  };
  const ai = await callAI(
    `You are the Qwen 3.8-Max research analyst inside WhalePulse AI v2, an AI-assisted tokenized-stock research workbench.
Return JSON with a decisions array using ONLY rNVDA, rTSLA, rAAPL, rMSFT, rCOIN, or rAMZN.
Each item must contain asset, side (LONG or SHORT), size_pct, entry_price, stop_loss, take_profit, and a concise rationale.
Rules: maximum position 5%, maximum stop distance 3%, paper insight only, never claim execution, and state that a human trader makes the final decision.`,
    { regime: market.regime, assets: market.assets.filter((asset) => TRADE_UNIVERSE.has(asset.label)) },
  );
  if (!Array.isArray(ai?.decisions)) return fallbackResponse(AI_KEY ? "qwen_unavailable_or_invalid" : "qwen_not_configured");
  const decisions = ai.decisions
    .filter((trade) => TRADE_UNIVERSE.has(String(trade.asset || "").replace(/^\$/, "")))
    .slice(0, 6)
    .map((trade) => {
      const asset = String(trade.asset).replace(/^\$/, "");
      const row = market.assets.find((item) => item.label === asset);
      const side = String(trade.side).toUpperCase() === "SHORT" ? "SHORT" : "LONG";
      const entry = Number(trade.entry_price) || row?.price;
      if (!Number.isFinite(entry) || entry <= 0) return null;
      const proposedStop = Number(trade.stop_loss);
      const proposedTarget = Number(trade.take_profit);
      const defaultStop = side === "LONG" ? entry * 0.98 : entry * 1.02;
      const stop = side === "LONG"
        ? Math.max(Number.isFinite(proposedStop) && proposedStop < entry ? proposedStop : defaultStop, entry * 0.97)
        : Math.min(Number.isFinite(proposedStop) && proposedStop > entry ? proposedStop : defaultStop, entry * 1.03);
      const defaultTarget = side === "LONG" ? entry * 1.03 : entry * 0.97;
      const target = side === "LONG"
        ? Math.min(Number.isFinite(proposedTarget) && proposedTarget > entry ? proposedTarget : defaultTarget, entry * 1.1)
        : Math.max(Number.isFinite(proposedTarget) && proposedTarget < entry ? proposedTarget : defaultTarget, entry * 0.9);
      return {
        ...trade,
        asset,
        pair: row?.pair,
        side,
        size_pct: Math.min(5, Math.max(0, Number(trade.size_pct) || 0)),
        entry_price: Number(entry.toFixed(4)),
        stop_loss: Number(stop.toFixed(4)),
        take_profit: Number(target.toFixed(4)),
        rationale: String(trade.rationale || "Qwen research insight; human review required.").slice(0, 240),
        status: "PAPER_INSIGHT",
      };
    })
    .filter(Boolean);
  if (!decisions.length) return fallbackResponse("qwen_output_failed_validation");
  const analysisSource = "qwen_3_8_max";
  return {
    decisions,
    engine: "Qwen 3.8-Max + deterministic risk validator",
    analysis_source: analysisSource,
    qwen_generated: true,
    paper_only: true,
    human_decision_required: true,
    research_run: buildResearchRun(market, decisions, analysisSource, true),
  };
}

function serveStatic(res, requestPath) {
  const pathname = new URL(requestPath, "http://localhost").pathname;
  if (pathname !== "/" && pathname !== "/index.html") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const file = path.resolve(__dirname, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/health" || pathname === "/health") {
      return sendJSON(res, {
        ok: true,
        status: "ok",
        service: "WhalePulse AI v2",
        track: "Bitget AI Hackathon Season 2 — Track 3: AI Trading Desk",
        product_role: "AI-assisted research workbench",
        ai_configured: Boolean(AI_KEY),
        analysis_mode: AI_KEY ? "qwen_3_8_max" : "deterministic_fallback",
        universe: RTOKENS.map(({ label, stock }) => ({ label, stock })),
        regime: nyMarketRegime(),
      });
    }
    if (pathname === "/api/market") {
      return sendJSON(res, { ok: true, data: await getMarketSnapshot() });
    }
    if (pathname === "/api/flow-intelligence") {
      const market = await getMarketSnapshot();
      return sendJSON(res, { ok: true, data: buildFlowIntelligence(market) });
    }
    if (pathname === "/api/correlations") {
      return sendJSON(res, { ok: true, data: await getCorrelations() });
    }
    if (pathname === "/api/sentiment") {
      const market = await getMarketSnapshot();
      return sendJSON(res, { ok: true, data: buildSentiment(market) });
    }
    if (pathname === "/api/trade-decisions") {
      const market = await getMarketSnapshot();
      return sendJSON(res, { ok: true, data: await getTradeDecisions(market) });
    }
    if (pathname === "/api/agent-events") {
      const market = await getMarketSnapshot();
      return sendJSON(res, { ok: true, data: buildAgentEvents(market) });
    }
    return serveStatic(res, req.url);
  } catch (error) {
    return sendJSON(res, { ok: false, error: error.message }, 502);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[WhalePulse AI v2] Research workbench listening on ${PORT}`);
});
