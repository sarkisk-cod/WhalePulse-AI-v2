const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const QWEN_API_KEY = process.env.QWEN_API_KEY;
// Bitget AI Hackathon S2 Qwen gateway (per official setup guide).
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://hackathon.bitgetops.com/v1';
const MODEL = process.env.MODEL || 'qwen3.8-max';

const TRACKED = ['$rNVDA', '$rTSLA'];

const SYSTEM_PROMPT =
  'You are WhalePulse AI v2, analyzing tokenized equities and crypto sentiment. ' +
  'Respond ONLY with minified JSON matching: ' +
  '{"assets":[{"ticker":"$rNVDA","sentiment":"bullish|neutral|bearish",' +
  '"score":0-100,"summary":"one sentence","drivers":["short driver","short driver"]}],' +
  '"market_note":"one sentence on overall tokenized-equity flow"}';

// Clearly-labeled sample payload. Served only when the upstream model call fails
// (e.g. missing/invalid QWEN_API_KEY) so the dashboard stays demonstrable.
const DEMO_PAYLOAD = {
  assets: [
    {
      ticker: '$rNVDA',
      sentiment: 'bullish',
      score: 74,
      summary: 'Sample data: accumulation into the AI datacenter narrative with steady tokenized volume.',
      drivers: ['Datacenter demand', 'Whale accumulation', 'Positive options skew']
    },
    {
      ticker: '$rTSLA',
      sentiment: 'neutral',
      score: 52,
      summary: 'Sample data: two-sided flow as delivery expectations offset margin pressure.',
      drivers: ['Delivery estimates', 'Margin compression', 'Mixed retail flow']
    }
  ],
  market_note: 'Sample data: tokenized equity liquidity concentrated in mega-cap AI names.'
};

function parseModelOutput(raw) {
  const cleaned = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed.assets) && parsed.assets.length) return parsed;
    } catch (_) { /* fall through to raw passthrough */ }
  }
  return { assets: [], market_note: cleaned.slice(0, 600), raw: true };
}

// Sentiment Analytics & rToken Tracker ($rNVDA, $rTSLA)
app.get('/api/sentiment', async (req, res) => {
  const startedAt = Date.now();

  if (!QWEN_API_KEY) {
    return res.json({
      success: true,
      mode: 'demo',
      degraded: true,
      notice: 'QWEN_API_KEY is not set — showing sample data, not live model output.',
      model: MODEL,
      tracked: TRACKED,
      data: DEMO_PAYLOAD,
      latency_ms: Date.now() - startedAt
    });
  }

  try {
    const response = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Provide market sentiment for ${TRACKED.join(' and ')} tokenized stocks.`
          }
        ],
        max_tokens: 2048
      },
      {
        timeout: 45000,
        headers: {
          Authorization: `Bearer ${QWEN_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/sarkisk-cod/WhalePulse-AI-v2',
          'X-Title': 'WhalePulse AI v2'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    return res.json({
      success: true,
      mode: 'live',
      degraded: false,
      model: MODEL,
      tracked: TRACKED,
      data: parseModelOutput(content),
      usage: response.data.usage || null,
      latency_ms: Date.now() - startedAt
    });
  } catch (error) {
    const status = error.response && error.response.status;
    const upstream =
      (error.response && error.response.data && error.response.data.error &&
        (error.response.data.error.message || error.response.data.error)) ||
      error.message;

    console.error(`[sentiment] upstream failure status=${status || 'n/a'}: ${upstream}`);

    // Graceful degradation: keep the endpoint usable and label the data honestly.
    return res.json({
      success: true,
      mode: 'demo',
      degraded: true,
      notice: 'Live model call failed — showing sample data, not live model output.',
      upstream_status: status || null,
      upstream_error: String(upstream).slice(0, 300),
      model: MODEL,
      tracked: TRACKED,
      data: DEMO_PAYLOAD,
      latency_ms: Date.now() - startedAt
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WhalePulse AI v2',
    version: '2.0.0',
    model: MODEL,
    base_url: OPENAI_BASE_URL,
    api_key_present: Boolean(QWEN_API_KEY),
    tracked: TRACKED,
    uptime_s: Math.round(process.uptime())
  });
});

app.listen(PORT, HOST, () => {
  console.log(`WhalePulse AI v2 Agent running on port ${PORT}`);
});
