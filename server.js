const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

// Sentiment Analytics & rToken Tracker ($rNVDA, $rTSLA)
app.get('/api/sentiment', async (req, res) => {
    try {
        const response = await axios.post(`${OPENAI_BASE_URL}/chat/completions`, {
            model: "qwen/qwen3-235b-a22b",
            messages: [
                { role: "system", content: "You are WhalePulse AI v2, analyzing tokenized equities and crypto sentiment." },
                { role: "user", content: "Provide market sentiment for $rNVDA and $rTSLA tokenized stocks." }
            ],
            max_tokens: 2048
        }, {
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/sarkisk-cod/WhalePulse-AI-v2',
                'X-Title': 'WhalePulse AI v2'
            }
        });

        res.json({ success: true, data: response.data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`WhalePulse AI v2 Agent running on port ${PORT}`);
});
