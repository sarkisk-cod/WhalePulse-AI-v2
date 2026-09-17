const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = parseInt(process.env.PORT || "8080", 10);
const QWEN_API_KEY = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || process.env.BITGET_QWEN_API_KEY || "";
const QWEN_BASE = process.env.OPENAI_BASE_URL || "https://hackathon.bitgetops.com/v1";
const QWEN_URL = QWEN_BASE + "/chat/completions";
const QWEN_MODEL = process.env.MODEL || process.env.QWEN_MODEL || "qwen3.8-max";

// ── Qwen caller ─────────────────────────────────────────────────
function callQwen(systemPrompt, userPrompt, temperature = 0.3, opts_ = {}) {
  const { max_tokens = 2048, timeout_ms = 85000 } = opts_;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: QWEN_MODEL,
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const url = new URL(QWEN_URL);
    const opts = {
      hostname: url.hostname, port: 443, path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${QWEN_API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          resolve(j.choices?.[0]?.message?.content ?? data);
        } catch { resolve(data); }
      });
    });
    req.on("error", (e) => reject(e));
    req.setTimeout(timeout_ms, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Response cache for slow endpoints (stale-while-error) ─────
const responseCache = {};
function cacheSet(key, value) { responseCache[key] = { value, ts: Date.now() }; }
function cacheGet(key) { return responseCache[key] || null; }
async function withCache(key, ttlMs, fn) {
  const cached = cacheGet(key);
  if (cached && Date.now() - cached.ts < ttlMs) return { ...cached.value, cached: true, cache_age_ms: Date.now() - cached.ts };
  try {
    const fresh = await fn();
    cacheSet(key, fresh);
    return { ...fresh, cached: false };
  } catch (e) {
    if (cached) return { ...cached.value, cached: true, stale: true, cache_age_ms: Date.now() - cached.ts, upstream_error: e.message };
    throw e;
  }
}

function parseQwenJSON(raw) {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.split("\n").slice(1).join("\n").replace(/```\s*$/, "");
  try { return JSON.parse(s); }
  catch { return { error: "parse_failed", raw: s.substring(0, 500) }; }
}

// ── Market snapshot ─────────────────────────────────────────────
const MARKET = {
  prices:{BTC:{price:72698,change_pct:-1.44},ETH:{price:1982.89,change_pct:-1.7},SOL:{price:80.92,change_pct:-1.98},DOGE:{price:0.0999,change_pct:-0.42},PEPE:{price:0.00000335,change_pct:-1.76},SHIB:{price:0.00000545,change_pct:-0.73},FLOKI:{price:0.00002843,change_pct:-0.35},WIF:{price:0.186,change_pct:-1.59},BONK:{price:0.00000544,change_pct:-0.18}},
  fear_greed:{value:29,label:"Fear",trend_7d:[34,25,22,23,23,28,29]},
  derivatives:{btc_funding_rate_mean:0.0075,btc_oi:{binance:106027,bybit:55261,okx:35637},long_short_ratio_global:1.694,top_traders_ls:1.717,taker_buy_sell:1.118},
  global:{total_crypto_mcap_usd:2549230539529,btc_dominance:57.09,market_cap_change_24h:-1.18},
  trending:["LAB","HYPE","Humanity","PORTAL","NEAR","Solstice","SUI","XLM"],
  news_headlines:["Worldcoin whale txns hit 64 in 24h — 2026 high","ETH whale accumulation accelerating","Meme coin sentiment cautious entering June 2026","149 live memecoin prediction markets on Polymarket","SOL DeFi TVL surpasses $8B","BTC dominance rising above 57%"],
};

const WHALE_ALERTS = [
  "Worldcoin whale txns hit 64 in 24h — 2026 high",
  "ETH whale accumulation accelerating — top holders increasing positions",
  "WLD active addresses + new wallets at 2026 highs alongside price to $0.408",
  "Large BTC transfers detected across exchanges — 2,400 BTC moved",
  "SOL whale deposits 120K SOL to Binance — potential distribution",
];

// ── rToken (Tokenized US Stocks) Configuration ────────────────
const RTOKEN_PAIRS = ["RTSLAUSDT","RNVDAUSDT","RAAPLUSDT","RMSFTUSDT","RGOOGLUSDT","RMETAUSDT","RAMZNUSDT","RCOINUSDT"];
const RTOKEN_LABELS = { RTSLAUSDT:"rTSLA", RNVDAUSDT:"rNVDA", RAAPLUSDT:"rAAPL", RMSFTUSDT:"rMSFT", RGOOGLUSDT:"rGOOGL", RMETAUSDT:"rMETA", RAMZNUSDT:"rAMZN", RCOINUSDT:"rCOIN" };
const RTOKEN_TO_STOCK = { RTSLAUSDT:"TSLA", RNVDAUSDT:"NVDA", RAAPLUSDT:"AAPL", RMSFTUSDT:"MSFT", RGOOGLUSDT:"GOOGL", RMETAUSDT:"META", RAMZNUSDT:"AMZN", RCOINUSDT:"COIN" };

// ── Market-hours regime (NY-time aware) ───────────────────────
function getMarketRegime() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  const m = {}; parts.forEach(p => m[p.type] = p.value);
  const hhmm = parseInt(m.hour) * 60 + parseInt(m.minute);
  const ny_time = `${m.hour}:${m.minute} NY`;
  if (m.weekday === "Sat" || m.weekday === "Sun") return { regime: "weekend", us_market_open: false, ny_time, note: "US equity market closed — rToken price is pure on-chain discovery" };
  if (hhmm < 240)  return { regime: "closed",      us_market_open: false, ny_time };
  if (hhmm < 570)  return { regime: "pre_market",  us_market_open: false, ny_time };
  if (hhmm < 960)  return { regime: "regular",     us_market_open: true,  ny_time };
  if (hhmm < 1200) return { regime: "after_hours", us_market_open: false, ny_time };
  return { regime: "closed", us_market_open: false, ny_time };
}

// ── Endpoint hit tracker (for /health) ─────────────────────────
const endpointStats = {
  "/api/sentiment":       { description: "Crypto + rToken sentiment analysis (Qwen)",       hits: 0, last_hit: null, last_ok: null, last_ms: null },
  "/api/whale-classify":  { description: "Whale alert classification (Qwen)",              hits: 0, last_hit: null, last_ok: null, last_ms: null },
  "/api/trade-decisions": { description: "Paper trading decisions crypto + rToken (Qwen)", hits: 0, last_hit: null, last_ok: null, last_ms: null },
  "/api/agent-events":    { description: "Event-driven autonomous agent (Qwen)",           hits: 0, last_hit: null, last_ok: null, last_ms: null },
};
function trackEndpoint(pathKey, ok, ms) {
  const s = endpointStats[pathKey]; if (!s) return;
  s.hits++; s.last_hit = new Date().toISOString(); s.last_ok = ok; s.last_ms = ms;
}
async function runTracked(pathKey, fn) {
  const t0 = Date.now();
  try { const r = await fn(); trackEndpoint(pathKey, true, Date.now() - t0); return r; }
  catch (e) { trackEndpoint(pathKey, false, Date.now() - t0); throw e; }
}

// ── Code-side risk validator (defense in depth over the prompt) ─
function enforceRiskLimits(payload) {
  if (!payload || !Array.isArray(payload.decisions)) return payload;
  payload.decisions = payload.decisions.slice(0, 5).map(d => {
    const side = String(d.side || "WATCH").toUpperCase();
    let size = Number(d.size_pct); if (!isFinite(size)) size = 0;
    size = Math.max(0, Math.min(5, size));
    if (side === "WATCH") size = 0;
    const entry = Number(d.entry_price);
    let stop = Number(d.stop_loss);
    if (isFinite(entry) && isFinite(stop) && entry > 0) {
      if (side === "LONG"  && (entry - stop) / entry > 0.03) stop = +(entry * 0.97).toFixed(6);
      if (side === "SHORT" && (stop - entry) / entry > 0.03) stop = +(entry * 1.03).toFixed(6);
    }
    return { ...d, side, size_pct: size, stop_loss: isFinite(stop) ? stop : d.stop_loss, risk_validated: true };
  });
  return payload;
}

// ── Event-Driven Agent State ──────────────────────────────────
const agentEvents = [];  // in-memory event log (ephemeral)

// ── Prompts ─────────────────────────────────────────────────────
const SENTIMENT_SYS = `You are WhalePulse AI v2's crypto sentiment analysis engine (Qwen 3.8 Max via OpenRouter).
Analyze the provided cryptocurrency market data including spot prices, rToken (tokenized US stocks) prices, derivatives metrics, Fear & Greed index, whale activity, and trending tokens. Cover both crypto assets AND rToken synthetic equities (RTSLA, RNVDA, RAAPL, RMSFT, RGOOGL, RMETA, RAMZN, RCOIN).
Return ONLY valid JSON:
{"overall_score":<0-100>,"classification":"<Extreme Fear|Fear|Neutral|Greed|Extreme Greed>","key_drivers":["...","...","..."],"narrative_rotation":"...","contrarian_signal":"<bull|bear|neutral>","confidence":<0.0-1.0>,"summary":"<2 sentences about crypto + rToken market conditions>"}`;

const WHALE_SYS = `You are WhalePulse AI v2's crypto whale activity classifier (Qwen 3.8 Max via OpenRouter).
Given whale transaction alerts for cryptocurrency assets, classify each by market impact. Focus on crypto wallets, exchanges, and on-chain movements.
Return ONLY valid JSON:
{"alerts":[{"original":"...","asset":"...","direction":"accumulation|distribution|transfer|unknown","impact":"high|medium|low","implication":"bullish|bearish|neutral","action":"..."}],"net_flow_bias":"accumulation|distribution|balanced","smart_money_direction":"risk-on|risk-off|mixed"}`;

const TRADE_SYS = `WhalePulse AI paper trading engine. Trade crypto (BTCUSDT/ETHUSDT/SOLUSDT/...) and rToken pairs (RTSLA/RNVDA/RAAPL/RMSFT/RGOOGL/RMETA/RAMZN/RCOIN).
Return ONLY valid JSON, no prose, no markdown:
{"decisions":[{"asset":"","side":"LONG|SHORT|WATCH","size_pct":0-5,"entry_price":0,"stop_loss":0,"take_profit":0,"rationale":""}],"portfolio_risk":"low|medium|high","market_regime":"trending|ranging|volatile|quiet"}
Rules: max 5 decisions, max 5% size, stop max 3% from entry, WATCH size=0. Include >=1 rToken trade. Keep rationale under 20 words.`;

const EVENT_AGENT_SYS = `You are WhalePulse AI v2's event-driven autonomous agent (Qwen 3.8 Max via OpenRouter).
You receive a batch of market events (price moves, whale alerts, sentiment shifts, rToken divergences). For each significant event, decide if it warrants a trading action. Classify event severity and generate an autonomous response.
Return ONLY valid JSON:
{"events":[{"event_type":"price_move|whale_alert|sentiment_shift|rtoken_divergence|funding_anomaly","description":"...","severity":"critical|high|medium|low","action":"open_long|open_short|close_position|add_to_position|reduce_position|monitor|no_action","asset":"...","confidence":<0.0-1.0>,"reasoning":"..."}],"agent_state":"scanning|alert|trading|cooldown","next_scan_seconds":<30-300>}`;

// ── Build live market context for Qwen ──────────────────────────
async function getLiveContext() {
  const cgIds = "bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,pepe,shiba-inu,floki,dogwifcoin,bonk";
  const cgUrl = "https://api.coingecko.com/api/v3/simple/price?ids=" + cgIds
    + "&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true";
  const [cgRes, fgRes] = await Promise.allSettled([
    httpGet(cgUrl),
    httpGet("https://api.alternative.me/fng/?limit=1"),
  ]);
  const p = (cgRes.status === "fulfilled" && typeof cgRes.value === "object") ? cgRes.value : {};
  const fgVal = (fgRes.status === "fulfilled" && fgRes.value?.data?.[0]) ? parseInt(fgRes.value.data[0].value) : MARKET.fear_greed.value;
  const fgLabel = fgVal <= 25 ? "Extreme Fear" : fgVal <= 45 ? "Fear" : fgVal <= 55 ? "Neutral" : fgVal <= 75 ? "Greed" : "Extreme Greed";

  const priceOf = (id) => p[id]?.usd || null;
  const changeOf = (id) => p[id]?.usd_24h_change || null;

  return {
    prices: {
      BTC: { price: priceOf("bitcoin") || MARKET.prices.BTC.price, change_pct: changeOf("bitcoin") || MARKET.prices.BTC.change_pct },
      ETH: { price: priceOf("ethereum") || MARKET.prices.ETH.price, change_pct: changeOf("ethereum") || MARKET.prices.ETH.change_pct },
      SOL: { price: priceOf("solana") || MARKET.prices.SOL.price, change_pct: changeOf("solana") || MARKET.prices.SOL.change_pct },
      DOGE: { price: priceOf("dogecoin") || MARKET.prices.DOGE.price, change_pct: changeOf("dogecoin") || MARKET.prices.DOGE.change_pct },
      PEPE: { price: priceOf("pepe") || MARKET.prices.PEPE.price, change_pct: changeOf("pepe") || MARKET.prices.PEPE.change_pct },
      SHIB: { price: priceOf("shiba-inu") || MARKET.prices.SHIB.price, change_pct: changeOf("shiba-inu") || MARKET.prices.SHIB.change_pct },
      FLOKI: { price: priceOf("floki") || MARKET.prices.FLOKI.price, change_pct: changeOf("floki") || MARKET.prices.FLOKI.change_pct },
      WIF: { price: priceOf("dogwifcoin") || MARKET.prices.WIF.price, change_pct: changeOf("dogwifcoin") || MARKET.prices.WIF.change_pct },
      BONK: { price: priceOf("bonk") || MARKET.prices.BONK.price, change_pct: changeOf("bonk") || MARKET.prices.BONK.change_pct },
    },
    fear_greed: { value: fgVal, label: fgLabel },
    derivatives: MARKET.derivatives,
    global: MARKET.global,
    trending: MARKET.trending,
    news_headlines: MARKET.news_headlines,
  };
}

// ── API handlers ────────────────────────────────────────────────
async function handleSentiment() {
  const ctx = await getLiveContext();
  const raw = await callQwen(SENTIMENT_SYS, "Analyze:\n" + JSON.stringify(ctx), 0.2);
  return parseQwenJSON(raw);
}
async function handleWhale() {
  const prompt = "Classify these whale alerts:\n" + WHALE_ALERTS.map(a => "- " + a).join("\n");
  const raw = await callQwen(WHALE_SYS, prompt, 0.1);
  return parseQwenJSON(raw);
}
async function handleTrades() {
  const [ctx, rTokens, equities] = await Promise.allSettled([
    getLiveContext(),
    fetchRTokenPrices(),
    fetchUSEquityQuotes(),
  ]);
  const market = ctx.status === "fulfilled" ? ctx.value : {};
  const rtData = rTokens.status === "fulfilled" ? rTokens.value : [];
  const eqData = equities.status === "fulfilled" ? equities.value : {};
  const regime = getMarketRegime();
  const rtokenBlock = {};
  const compactRtok = {};
  rtData.forEach(r => {
    const stock = RTOKEN_TO_STOCK[r.symbol];
    const usq = eqData[stock];
    const usPrice = usq ? (usq.price ?? usq.prev_close) : null;
    const spread_pct = (usPrice && r.price) ? +(((r.price - usPrice) / usPrice) * 100).toFixed(2) : null;
    rtokenBlock[r.label] = { price: r.price, change24h: r.change24h, us_stock: stock, us_price: usPrice, spread_pct };
    compactRtok[r.label] = { p: r.price, us: usPrice, spread_pct };
  });
  // Compact payload (~400 tokens) to keep Qwen inference under Cloudflare's ~100s edge budget
  const compact = {
    regime: regime.regime,
    us_open: regime.us_market_open,
    fg: market.fear_greed?.value,
    btc: market.prices?.BTC ? { p: market.prices.BTC.price, c: +(market.prices.BTC.change_pct||0).toFixed(2) } : null,
    eth: market.prices?.ETH ? { p: market.prices.ETH.price, c: +(market.prices.ETH.change_pct||0).toFixed(2) } : null,
    sol: market.prices?.SOL ? { p: market.prices.SOL.price, c: +(market.prices.SOL.change_pct||0).toFixed(2) } : null,
    ls_ratio: market.derivatives?.long_short_ratio_global,
    rtok: compactRtok,
  };
  const raw = await callQwen(
    TRADE_SYS,
    "Live market snapshot below. Generate up to 5 paper trades. Prioritize rToken-vs-underlying spread trades (|spread_pct|>=0.5%). Return ONLY JSON.\n" + JSON.stringify(compact),
    0.3,
    { max_tokens: 900, timeout_ms: 90000 }
  );
  const parsed = parseQwenJSON(raw);
  const validated = enforceRiskLimits(parsed);
  if (validated && typeof validated === "object") {
    validated.market_regime = regime;
    validated.stock_spread_context = rtokenBlock;
  }
  return validated;
}

// ── US Equity Fetcher (Yahoo Finance v8 chart, no key) ────────
async function fetchOneEquity(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const data = await httpGet(url, 10000);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      price: meta.regularMarketPrice ?? null,
      change_pct: meta.regularMarketChangePercent ?? null,
      prev_close: meta.chartPreviousClose ?? meta.previousClose ?? null,
      market_state: meta.hasPrePostMarketData ? (meta.currentTradingPeriod?.pre ? "PRE" : "REGULAR") : null,
      full_day_price: meta.fulldayPrice ?? null,
      exchange: meta.fullExchangeName || null,
      ts_market: meta.regularMarketTime || null,
    };
  } catch { return null; }
}
async function fetchUSEquityQuotes() {
  const syms = Object.values(RTOKEN_TO_STOCK);
  const results = await Promise.all(syms.map(fetchOneEquity));
  const out = {};
  syms.forEach((s, i) => { if (results[i]) out[s] = results[i]; });
  return out;
}

// ── rToken vs Underlying Divergence ───────────────────────────
async function handleStockDivergence() {
  const [rTokens, equities] = await Promise.allSettled([
    fetchRTokenPrices(),
    fetchUSEquityQuotes(),
  ]);
  const rt = rTokens.status === "fulfilled" ? rTokens.value : [];
  const eq = equities.status === "fulfilled" ? equities.value : {};
  const regime = getMarketRegime();
  const spreads = rt.map(r => {
    const stock = RTOKEN_TO_STOCK[r.symbol];
    const usq = eq[stock];
    const usPrice = usq ? (usq.price ?? usq.post_price ?? usq.pre_price ?? usq.prev_close) : null;
    const base = {
      symbol: r.symbol, label: r.label, stock,
      rtoken_price: +r.price.toFixed(4),
      change_24h_pct: +(Number(r.change24h || 0) * 100).toFixed(2),
      volume_24h: +Number(r.volume || 0).toFixed(0),
      high_24h: r.high24h ?? null,
      low_24h: r.low24h ?? null,
    };
    if (!usPrice || !r.price) return { ...base, us_price: null, spread_pct: null };
    const spread_pct = ((r.price - usPrice) / usPrice) * 100;
    let signal = "neutral";
    const abs = Math.abs(spread_pct);
    if (abs >= 1.5) signal = spread_pct > 0 ? "strong_premium" : "strong_discount";
    else if (abs >= 0.5) signal = spread_pct > 0 ? "mild_premium" : "mild_discount";
    return {
      ...base,
      us_price: +Number(usPrice).toFixed(4),
      us_prev_close: usq?.prev_close ?? null,
      us_market_state: usq?.market_state || null,
      spread_pct: +spread_pct.toFixed(3),
      spread_direction: spread_pct > 0 ? "rtoken_premium" : "rtoken_discount",
      signal,
    };
  }).sort((a,b) => Math.abs(b.spread_pct||0) - Math.abs(a.spread_pct||0));

  const with_spread = spreads.filter(s => s.spread_pct !== null);
  const n_premium = with_spread.filter(s => s.spread_pct > 0).length;
  const n_discount = with_spread.filter(s => s.spread_pct < 0).length;
  const mean_spread_pct = with_spread.length
    ? +(with_spread.reduce((a, x) => a + x.spread_pct, 0) / with_spread.length).toFixed(3)
    : null;
  const abs_mean_spread_pct = with_spread.length
    ? +(with_spread.reduce((a, x) => a + Math.abs(x.spread_pct), 0) / with_spread.length).toFixed(3)
    : null;
  const total_volume_24h = spreads.reduce((a, x) => a + (x.volume_24h || 0), 0);
  const top_premium = with_spread.filter(s => s.spread_pct > 0).sort((a,b) => b.spread_pct - a.spread_pct)[0] || null;
  const top_discount = with_spread.filter(s => s.spread_pct < 0).sort((a,b) => a.spread_pct - b.spread_pct)[0] || null;
  const top = spreads.find(s => s.spread_pct !== null) || null;

  return {
    market_regime: regime,
    spreads,
    stats: {
      n_tracked: spreads.length,
      n_with_spread: with_spread.length,
      n_premium, n_discount,
      mean_spread_pct,
      abs_mean_spread_pct,
      total_volume_24h,
      basis_bias: mean_spread_pct === null ? "unknown" : (mean_spread_pct > 0.2 ? "premium_skew" : (mean_spread_pct < -0.2 ? "discount_skew" : "balanced")),
      top_premium,
      top_discount,
    },
    top_dislocation: top,
    interpretation: regime.us_market_open
      ? "US market open — persistent basis suggests arb inefficiency or on-chain liquidity gap."
      : "US market closed — rToken is leading price discovery for the underlying (7×24 window).",
  };
}

// ── rToken Fetcher (Bitget Spot API) ───────────────────────────
async function fetchRTokenPrices() {
  const url = "https://api.bitget.com/api/v2/spot/market/tickers";
  const data = await httpGet(url, 15000);
  if (!data || !data.data) return [];
  return data.data
    .filter(t => RTOKEN_PAIRS.includes(t.symbol))
    .map(t => ({
      symbol: t.symbol,
      label: RTOKEN_LABELS[t.symbol] || t.symbol,
      price: parseFloat(t.lastPr),
      change24h: parseFloat(t.change24h || 0),
      high24h: parseFloat(t.high24h || 0),
      low24h: parseFloat(t.low24h || 0),
      volume: parseFloat(t.quoteVolume || 0),
    }));
}

// ── Event-Driven Agent ─────────────────────────────────────────
async function detectEvents() {
  const [ctx, rTokens] = await Promise.allSettled([
    getLiveContext(),
    fetchRTokenPrices(),
  ]);
  const market = ctx.status === "fulfilled" ? ctx.value : {};
  const rtData = rTokens.status === "fulfilled" ? rTokens.value : [];

  // Build event descriptions from market data
  const eventDescriptions = [];
  if (market.prices) {
    Object.entries(market.prices).forEach(([sym, d]) => {
      if (Math.abs(d.change_pct) > 3) {
        eventDescriptions.push(`${sym} price moved ${d.change_pct > 0 ? '+' : ''}${d.change_pct.toFixed(2)}% to $${d.price}`);
      }
    });
  }
  if (market.fear_greed && market.fear_greed.value <= 20) {
    eventDescriptions.push(`Fear & Greed Index at extreme fear: ${market.fear_greed.value}`);
  }
  if (market.derivatives && market.derivatives.long_short_ratio_global > 1.6) {
    eventDescriptions.push(`Crowded long detected — L/S ratio ${market.derivatives.long_short_ratio_global}`);
  }
  rtData.forEach(r => {
    if (Math.abs(r.change24h) > 0.03) {
      eventDescriptions.push(`rToken ${r.label} moved ${(r.change24h * 100).toFixed(2)}% to $${r.price.toFixed(2)}`);
    }
  });
  WHALE_ALERTS.forEach(a => eventDescriptions.push(`Whale: ${a}`));

  if (eventDescriptions.length === 0) {
    eventDescriptions.push("No significant events detected — markets quiet");
  }

  const prompt = "Analyze these market events and decide autonomous actions:\n" + eventDescriptions.map(e => "- " + e).join("\n");
  const raw = await callQwen(EVENT_AGENT_SYS, prompt, 0.2, { max_tokens: 1024, timeout_ms: 80000 });
  const result = parseQwenJSON(raw);

  // Log events
  const entry = { ts: Date.now(), events: result.events || [], agent_state: result.agent_state || "scanning" };
  agentEvents.unshift(entry);
  if (agentEvents.length > 50) agentEvents.length = 50; // keep last 50

  return { ...result, market_regime: getMarketRegime(), rtoken_data: rtData, market_summary: { fear_greed: market.fear_greed, prices_count: Object.keys(market.prices || {}).length } };
}

async function handleRTokenPrices() {
  return await fetchRTokenPrices();
}

async function handleAgentEvents() {
  return await detectEvents();
}

// ── Static file serving ─────────────────────────────────────────
const MIME = { ".html":"text/html",".css":"text/css",".js":"application/javascript",".json":"application/json",".svg":"image/svg+xml",".png":"image/png" };
function serveStatic(res, urlPath) {
  const fp = path.join(__dirname, urlPath === "/" ? "index.html" : urlPath);
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end("Not found"); return; }
  const ext = path.extname(fp);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
}

// ── HTTPS fetch helper ──────────────────────────────────────────
function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { "User-Agent": "WhalePulse/1.0" } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on("error", e => reject(e));
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ── Live market data aggregator (CoinGecko primary) ─────────────
async function fetchLiveMarket() {
  const results = { snapshot: [], meme: [], fear_greed: null, error: null };

  // CoinGecko IDs for all tokens we need
  const cgIds = "bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,pepe,shiba-inu,floki,dogwifcoin,bonk";
  const cgPriceUrl = "https://api.coingecko.com/api/v3/simple/price?ids=" + cgIds
    + "&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true";

  const [cgPriceRes, cgGlobalRes, fgRes] = await Promise.allSettled([
    httpGet(cgPriceUrl),
    httpGet("https://api.coingecko.com/api/v3/global"),
    httpGet("https://api.alternative.me/fng/?limit=7"),
  ]);

  // --- Process CoinGecko prices ---
  const p = (cgPriceRes.status === "fulfilled" && typeof cgPriceRes.value === "object") ? cgPriceRes.value : {};

  function snap(cgId, label, icon) {
    const d = p[cgId];
    if (!d) return { label, icon, value: null, change: null };
    return { label, icon, value: d.usd, change: d.usd_24h_change || null };
  }

  results.snapshot = [
    snap("bitcoin", "BTC", "\u20bf"),
    snap("ethereum", "ETH", "\u039e"),
    snap("solana", "SOL", "\u25c8"),
    snap("binancecoin", "BNB", "\u25c7"),
    snap("ripple", "XRP", "\u25cb"),
    snap("dogecoin", "DOGE", "\ud83d\udc36"),
  ];

  // CoinGecko global — MCap + BTC dominance
  if (cgGlobalRes.status === "fulfilled" && cgGlobalRes.value?.data) {
    const g = cgGlobalRes.value.data;
    results.snapshot.push(
      { label: "Crypto MCap", icon: "\u03a3", value: g.total_market_cap?.usd || null, change: g.market_cap_change_percentage_24h_usd || null },
      { label: "BTC Dom", icon: "\u25c9", value: g.market_cap_percentage?.btc || null, change: null },
    );
  } else {
    results.snapshot.push(
      { label: "Crypto MCap", icon: "\u03a3", value: null, change: null },
      { label: "BTC Dom", icon: "\u25c9", value: null, change: null },
    );
  }

  // Meme tokens from CoinGecko prices
  const memeMap = [
    { id: "dogecoin", token: "DOGE" }, { id: "pepe", token: "PEPE" },
    { id: "shiba-inu", token: "SHIB" }, { id: "floki", token: "FLOKI" },
    { id: "dogwifcoin", token: "WIF" }, { id: "bonk", token: "BONK" },
  ];
  results.meme = memeMap.map(({ id, token }) => {
    const d = p[id];
    if (!d) return { token, price: null, pct: null, vol: null, trades: null };
    return { token, price: d.usd, pct: d.usd_24h_change || null, vol: d.usd_24h_vol || null, trades: null };
  });

  // Fear & Greed
  if (fgRes.status === "fulfilled" && fgRes.value?.data) {
    results.fear_greed = fgRes.value.data.map(d => ({ value: parseInt(d.value), ts: parseInt(d.timestamp) }));
  }

  // Extra prices used by trade log (not in snapshot cards)
  results.solPrice = p.solana?.usd || null;

  return results;
}

// ── Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const sendJSON = (obj, code = 200) => {
    const b = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(b);
  };

  try {
    if (req.url === "/api/live-prices") {
      try {
        const data = await fetchLiveMarket();
        return sendJSON({ ok: true, data, ts: Date.now() });
      } catch (e) {
        return sendJSON({ ok: false, error: e.message }, 500);
      }
    }
    if (req.url === "/health" || req.url === "/api/health") {
      return sendJSON({
        status: "ok",
        service: "WhalePulse AI v2",
        model: QWEN_MODEL,
        qwen_configured: !!QWEN_API_KEY,
        qwen_base: QWEN_BASE,
        market_regime: getMarketRegime(),
        endpoints: endpointStats,
        rtoken_universe: Object.keys(RTOKEN_TO_STOCK).map(k => ({ pair: k, label: RTOKEN_LABELS[k], underlying: RTOKEN_TO_STOCK[k] })),
        ts: Date.now(),
      });
    }
    if (req.url === "/api/stock-divergence") {
      try {
        const data = await handleStockDivergence();
        return sendJSON({ ok: true, data, ts: Date.now() });
      } catch (e) {
        return sendJSON({ ok: false, error: e.message }, 500);
      }
    }
    if (req.url === "/api/sentiment") {
      const data = await runTracked("/api/sentiment", handleSentiment);
      return sendJSON({ ok: true, data });
    }
    if (req.url === "/api/whale-classify") {
      const data = await runTracked("/api/whale-classify", handleWhale);
      return sendJSON({ ok: true, data });
    }
    if (req.url === "/api/trade-decisions") {
      const data = await runTracked("/api/trade-decisions", () => withCache("trades", 120000, handleTrades));
      return sendJSON({ ok: true, data });
    }
    if (req.url === "/api/rtoken-prices") {
      try {
        const data = await handleRTokenPrices();
        return sendJSON({ ok: true, data, ts: Date.now() });
      } catch (e) {
        return sendJSON({ ok: false, error: e.message }, 500);
      }
    }
    if (req.url === "/api/agent-events") {
      try {
        const data = await runTracked("/api/agent-events", () => withCache("agent", 120000, handleAgentEvents));
        return sendJSON({ ok: true, data, ts: Date.now() });
      } catch (e) {
        return sendJSON({ ok: false, error: e.message }, 500);
      }
    }
    if (req.url === "/api/agent-log") {
      return sendJSON({ ok: true, data: agentEvents.slice(0, 20) });
    }
    serveStatic(res, req.url);
  } catch (e) {
    sendJSON({ ok: false, error: e.message }, 500);
  }
});

// ── Background prewarm: keep trades + agent caches hot ────────
let prewarmRunning = false;
async function prewarm() {
  if (prewarmRunning) return; prewarmRunning = true;
  try {
    const t0 = Date.now();
    try { const r = await handleTrades(); cacheSet("trades", r); console.log(`[prewarm] trades OK ${Date.now()-t0}ms`); }
    catch (e) { console.log(`[prewarm] trades FAIL: ${e.message}`); }
    const t1 = Date.now();
    try { const r = await handleAgentEvents(); cacheSet("agent", r); console.log(`[prewarm] agent OK ${Date.now()-t1}ms`); }
    catch (e) { console.log(`[prewarm] agent FAIL: ${e.message}`); }
  } finally { prewarmRunning = false; }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[WhalePulse] Server on :${PORT} | model=${QWEN_MODEL} | Qwen key: ${QWEN_API_KEY ? "set" : "MISSING"}`);
  setTimeout(prewarm, 4000);
  setInterval(prewarm, 90000);
});
