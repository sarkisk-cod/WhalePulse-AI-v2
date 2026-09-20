# WhalePulse AI v3 — Tokenized US Stocks Intelligence

Track 3 submission for Bitget AI Hackathon Season 2.

## Scope

- Live Bitget rToken prices for rNVDA, rTSLA, rAAPL, rMSFT, rGOOGL, rMETA, rAMZN, and rCOIN
- New York session regime and rToken-to-underlying basis monitoring
- Institutional equity volume and rToken flow intelligence
- SPY / QQQ correlation monitoring
- US equity and macro sentiment
- Risk-validated paper trades restricted to rNVDA, rTSLA, rAAPL, rMSFT, rCOIN, and rAMZN

## Data sources

- Bitget rToken Spot API
- Yahoo Finance API
- US macro and equity data

## Run

```bash
npm start
```

The server listens on `PORT` or port 3000 by default.

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
