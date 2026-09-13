# WhalePulse AI v2 — Cross-Market Intelligence Engine

Autonomous event-driven crypto trading agent for the **Bitget AI Hackathon S2** (Track 2: Agentic Trading).

## Features
- **Live Crypto Prices** — BTC, ETH, SOL, BNB, XRP, DOGE + meme tokens via CoinGecko
- **rToken Monitoring** — Tokenized US stocks (rTSLA, rNVDA, rAAPL, rMSFT, rGOOGL, rMETA, rAMZN, rCOIN) via Bitget Spot API
- **Event-Driven Agent** — Autonomous market event detection → Qwen 3.8 Max analysis → Trading signals
- **Qwen AI Sentiment Engine** — Real-time sentiment scoring powered by Qwen 3.8 Max
- **Whale Classifier** — AI-powered whale alert impact classification
- **Autonomous Trade Decisions** — Paper trading with risk management (crypto + rToken)
- **Fear & Greed Gauge** — Live Alternative.me index with 7-day trend
- **Neon Noir Dashboard** — Trading terminal aesthetic with GSAP animations

## Tech Stack
- **Backend:** Node.js HTTP server (zero dependencies)
- **Frontend:** Single-file HTML with TailwindCSS, ECharts 5, GSAP ScrollTrigger
- **AI Model:** Qwen 3.8 Max via Bitget Hackathon API
- **Data Sources:** CoinGecko, Bitget Spot API, Alternative.me

## Environment Variables
```
DASHSCOPE_API_KEY=your-key-here   # or QWEN_API_KEY or BITGET_QWEN_API_KEY
```

## Run Locally
```bash
export DASHSCOPE_API_KEY=your-key-here
node server.js
# → http://localhost:8080
```

## API Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/live-prices` | Live crypto prices + Fear & Greed |
| `GET /api/rtoken-prices` | rToken (tokenized US stocks) prices |
| `GET /api/agent-events` | Event-driven agent scan |
| `GET /api/sentiment` | Qwen AI sentiment analysis |
| `GET /api/whale-classify` | Whale alert classification |
| `GET /api/trade-decisions` | Autonomous paper trading decisions |
| `GET /api/health` | API connectivity check |

## Architecture
```
[Data Sources] → [Event Detector] → [Qwen 3.8 Max] → [Risk Mgr] → [Execution]
     ↑                                                                    |
     └──────────────────── Feedback Loop ─────────────────────────────────┘
```

**Paper Trading Only — Not Financial Advice**