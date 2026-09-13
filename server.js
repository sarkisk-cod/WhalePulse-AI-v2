const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = parseInt(process.env.PORT || "8080", 10);
const QWEN_API_KEY = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || process.env.BITGET_QWEN_API_KEY || "";
const QWEN_BASE = process.env.OPENAI_BASE_URL || "https://hackathon.bitgetops.com/v1";
const QWEN_URL = QWEN_BASE + "/chat/completions";
const QWEN_MODEL = "qwen3.8-max";

// ── Qwen caller ─────────────────────────────────────────────────
function callQwen(systemPrompt, userPrompt, temperature = 0.3) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: QWEN_MODEL,
      temperature,
      max_tokens: 2048,
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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
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

const TRADE_SYS = `You are WhalePulse AI v2's autonomous event-driven trading decision engine (Qwen 3.8 Max via OpenRouter).
Given live cryptocurrency market data AND rToken (tokenized US stock) prices, generate paper trading decisions. You can trade crypto pairs (BTCUSDT, ETHUSDT, SOLUSDT, etc.) AND rToken pairs (RTSLAUSDT, RNVDAUSDT, RAAPLUSDT, RMSFTUSDT, RGOOGLUSDT, RMETAUSDT, RAMZNUSDT, RCOINUSDT).
Return ONLY valid JSON:
{"decisions":[{"asset":"...","side":"LONG|SHORT|WATCH","conviction":"high|medium|low","size_pct":<0-5>,"entry_price":<n>,"stop_loss":<n>,"take_profit":<n>,"catalyst":"...","whale_flow":"supporting|opposing|neutral","sentiment_alignment":"aligned|divergent|neutral","rationale":"..."}],"portfolio_risk":"low|medium|high","max_concurrent_positions":<n>,"market_regime":"trending|ranging|volatile|quiet"}
Rules: Max 5 decisions, max 5% per position, stop_loss max 3% from entry, WATCH has size_pct=0. Include at least 1 rToken trade when data is available.`;

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
  const [ctx, rTokens] = await Promise.allSettled([
    getLiveContext(),
    fetchRTokenPrices(),
  ]);
  const market = ctx.status === "fulfilled" ? ctx.value : {};
  const rtData = rTokens.status === "fulfilled" ? rTokens.value : [];
  const trimmed = {
    prices: market.prices || {},
    derivatives: market.derivatives || {},
    fear_greed: market.fear_greed || {},
    trending: (market.trending || []).slice(0,5),
    global: market.global || {},
    rtoken_prices: rtData.reduce((acc, r) => { acc[r.label] = { price: r.price, change24h: r.change24h }; return acc; }, {}),
  };
  const raw = await callQwen(TRADE_SYS, "Generate paper trading decisions based on CURRENT live crypto + rToken prices:\n" + JSON.stringify(trimmed), 0.3);
  return parseQwenJSON(raw);
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
  const raw = await callQwen(EVENT_AGENT_SYS, prompt, 0.2);
  const result = parseQwenJSON(raw);

  // Log events
  const entry = { ts: Date.now(), events: result.events || [], agent_state: result.agent_state || "scanning" };
  agentEvents.unshift(entry);
  if (agentEvents.length > 50) agentEvents.length = 50; // keep last 50

  return { ...result, rtoken_data: rtData, market_summary: { fear_greed: market.fear_greed, prices_count: Object.keys(market.prices || {}).length } };
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
    if (req.url === "/api/health") {
      let reachable = false;
      if (QWEN_API_KEY) {
        try {
          const r = await callQwen("Reply with ok", "health", 0);
          reachable = !r.includes('"error"') || r.length > 10;
        } catch {}
      }
      return sendJSON({ status: "ok", qwen_configured: !!QWEN_API_KEY, qwen_api_reachable: reachable, qwen_message: "" });
    }
    if (req.url === "/api/sentiment") {
      const data = await handleSentiment();
      return sendJSON({ ok: true, data });
    }
    if (req.url === "/api/whale-classify") {
      const data = await handleWhale();
      return sendJSON({ ok: true, data });
    }
    if (req.url === "/api/trade-decisions") {
      const data = await handleTrades();
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
        const data = await handleAgentEvents();
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[WhalePulse] Server on :${PORT} | Qwen key: ${QWEN_API_KEY ? "set" : "MISSING"}`);
});
