# WhalePulse AI v2

**AI-assisted tokenized-stock research workbench for Bitget AI Hackathon Season 2 — Track 3: AI Trading Desk.**

[Live app](https://cpmcacza.mule.page/) · [Demo video](https://youtu.be/alT6HxhQizY?si=OXDV0m3wdvWTkmFL) · [Source code](https://github.com/sarkisk-cod/WhalePulse-AI-v2)

> **Paper trading only.** WhalePulse AI v2 produces research and hypothetical paper-trade insights. It does not place orders, provide financial advice, or replace trader judgment. A human trader always makes the final decision.

## Problem and thesis

Tokenized US stocks can trade continuously while their underlying equities follow US market hours. That difference can create changing price-discovery regimes, temporary basis dislocations, and uneven liquidity. Traders must compare multiple venues and validate risk before acting.

WhalePulse AI v2 tests the thesis that a compact research desk can combine Bitget rToken data, US-equity reference prices, market-regime context, correlations, and structured AI reasoning into a clearer paper insight without removing human control.

## Target users

- rToken traders comparing tokenized assets with US-equity references
- Discretionary traders who need a fast, structured pre-trade review
- Hackathon judges and researchers evaluating explainable AI-assisted workflows
- Risk reviewers testing paper scenarios before any independent execution decision

## Product value

- Tracks rNVDA, rTSLA, rAAPL, rMSFT, rGOOGL, rMETA, rAMZN, and rCOIN
- Shows Bitget price, 24-hour change, US-equity reference, and live basis state
- Identifies New York pre-market, regular, after-hours, closed, and weekend regimes
- Compares daily rToken returns with SPY and QQQ on aligned calendar dates
- Surfaces venue-volume concentration, basis movement, and equity breadth
- Generates risk-limited paper insights with an explicit AI-source label
- Keeps every output advisory and requires a human decision

## Complete research workflow

```text
Trader question
  → Bitget rToken and US-equity data
  → basis and market-regime analysis
  → Qwen reasoning or clearly labeled deterministic fallback
  → deterministic risk validation
  → actionable paper insight
  → human decision
```

The browser calls same-origin API routes. The Node.js service obtains live market references, derives analytics, optionally requests structured Qwen output, validates the result, and returns paper-only research to the interface.

## Data sources

| Source | Role | Important limitation |
|---|---|---|
| Bitget rToken Spot API | rToken prices, 24-hour range/volume, and daily candles | Market-data source only; this project does not submit orders |
| Yahoo Finance chart API | US-equity, SPY, and QQQ reference prices/history | Reference data, not an execution venue; availability may vary |
| Derived US equity data | New York session regime, basis, breadth, and rule-based sentiment | The current build has no standalone live Federal Reserve or macro-news feed |

No credentials are sent to the browser. Qwen credentials, when configured, remain server-side environment secrets.

## Role of Qwen 3.8-Max

When a server-side Qwen key is configured, the research endpoint requests a structured set of paper insights from Qwen 3.8-Max. The server then enforces the asset whitelist and risk limits before returning results.

When Qwen is not configured, unavailable, or returns invalid output, the endpoint uses a deterministic market-rule fallback. Responses expose `analysis_source`, `qwen_generated`, and `fallback_reason`, and the interface labels genuine Qwen output separately from fallback output. A fallback result must never be represented as Qwen-generated.

## Risk controls

- Paper trading only; no brokerage or exchange order route exists
- Allowed paper-insight universe: rNVDA, rTSLA, rAAPL, rMSFT, rCOIN, rAMZN
- Maximum suggested position size: 5% per insight
- Maximum stop distance: 3% from entry after server validation
- Invalid or unavailable AI output activates a labeled deterministic fallback
- Missing market inputs are shown as unavailable rather than invented
- Human decision is required for every output

These controls reduce presentation and model risk; they do not eliminate market, liquidity, basis, execution, or data-source risk.

## Architecture

```text
Browser UI
  └─ same-origin REST API
      ├─ Bitget rToken Spot API
      ├─ Yahoo Finance chart API
      ├─ market/basis/correlation/sentiment derivation
      ├─ optional Qwen 3.8-Max reasoning
      ├─ deterministic fallback
      └─ server-side risk validator → paper insight → human review
```

The implementation uses the Node.js standard library and has no runtime package dependencies. Market requests use timeouts, retries in the browser, partial-data handling, and short in-memory caches.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service identity, AI mode, universe, and NY regime |
| `GET /api/market` | Bitget rToken and underlying-equity snapshot |
| `GET /api/flow-intelligence` | Venue-volume, basis, and regime events |
| `GET /api/correlations` | Date-aligned SPY/QQQ versus rToken correlations |
| `GET /api/sentiment` | Rule-based US-equity breadth and macro context |
| `GET /api/trade-decisions` | Qwen or labeled-fallback paper insights with risk validation |
| `GET /api/agent-events` | Deterministic rToken event review requiring human action |

## Validation plan and metrics

No returns, win rate, Sharpe ratio, user count, or production performance claims are available. All such metrics are **pending** until a reproducible paper-trading study is completed.

Planned validation:

1. Save timestamped inputs, source status, regime, model/fallback status, output, and human decision for each research run.
2. Freeze entry prices at the recorded observation time and define horizon-specific evaluation windows.
3. Measure data availability, basis convergence, stop/target outcomes, slippage assumptions, and maximum adverse excursion.
4. Compare Qwen-assisted outputs with the deterministic baseline using the same inputs.
5. Report sample size, rejected outputs, missing data, and transaction-cost assumptions alongside any result.
6. Keep validation paper-only until independent security, compliance, and execution reviews are complete.

## Verified research runs

Only outputs captured from the running application belong here. No run is fabricated.

### Research run — 2026-09-29T08:15:04.087Z

| Field | Recorded value |
|---|---|
| Input | Full allowed paper universe; first returned setup shown for rNVDA |
| Data status | Bitget: live; Yahoo Finance: live; 8 of 8 rTokens available |
| Market regime | PRE-MARKET, 04:15 ET; rTOKEN LEADS |
| Analysis status | `deterministic_fallback`; `qwen_generated: false` |
| Fallback reason | `qwen_not_configured` |
| Paper output | rNVDA SHORT; entry 231.09; stop 235.7118; target 224.1573; size 2% |
| Rationale | PREMIUM basis with pre-market session controls |
| Human decision | Pending / not recorded |

This record verifies the fallback path, not a genuine Qwen run. Live values are point-in-time observations and will change.

## Local run

```bash
npm start
```

The service listens on `PORT`, or port `3000` by default. To configure Qwen, add the key through the deployment platform's server-side secret manager; never commit it to the repository.

## Track 3 positioning

WhalePulse AI v2 is an **AI Trading Desk research layer** and does not execute trades. It gathers market evidence, evaluates tokenized-stock basis and regime, applies Qwen reasoning when available, validates risk deterministically, and presents a paper insight for a human trader to accept, reject, or modify.

## Disclaimer

Paper trading only. Educational research software; not financial advice. Data may be delayed, partial, or unavailable. Tokenized assets can differ materially from their referenced equities. Human review and an independent decision are always required.
