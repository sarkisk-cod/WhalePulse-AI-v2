# WhalePulse AI v3 — Tokenized US Stocks Intelligence

Track 3 submission for Bitget AI Hackathon Season 2.

## Live application

https://cpmcacza.mule.page/

## Scope

- Live Bitget rToken prices for rNVDA, rTSLA, rAAPL, rMSFT, rGOOGL, rMETA, rAMZN, and rCOIN
- New York session regime and rToken-to-underlying basis monitoring
- High-impact Live Market Regime Banner with New York session state
- Interactive Qwen AI Trade Simulator for rNVDA, rTSLA, and rAAPL
- Institutional equity volume and rToken flow intelligence
- SPY / QQQ correlation monitoring
- US equity and macro sentiment
- Risk-validated paper trades restricted to rNVDA, rTSLA, rAAPL, rMSFT, rCOIN, and rAMZN

## Trade simulator

The simulator combines the selected rToken with live Bitget pricing, its US equity basis, and the current New York market regime. Users can choose a trading horizon and maximum risk before generating a hypothetical entry, invalidation level, target, reward-to-risk ratio, and model rationale.

If the AI request is temporarily unavailable, the interface falls back to the live market risk engine instead of returning an empty result. No real orders are transmitted.

## Data sources

- Bitget rToken Spot API
- Yahoo Finance API
- US macro and equity data

## Run

```bash
npm start
```

The server listens on `PORT` or port 3000 by default.

## Architecture

```text
Bitget rToken Spot API ─┐
                       ├─> Market Snapshot ─> Signal + Regime Layer ─> AI/Risk Validator ─> Paper Output
Yahoo Finance API ─────┘
```

The frontend uses relative API routes, while the Node.js server serves both the application and its data endpoints. Live requests include timeout handling and one automatic retry.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service, universe, and NY regime status |
| `GET /api/market` | Live rToken and underlying equity snapshot |
| `GET /api/flow-intelligence` | Institutional volume and basis events |
| `GET /api/correlations` | SPY / QQQ versus rToken correlations |
| `GET /api/sentiment` | US equity and macro sentiment feed |
| `GET /api/trade-decisions` | Restricted rToken paper-trade decisions |
| `GET /api/agent-events` | Autonomous rToken event scan |

Paper trading only. Not financial advice.
