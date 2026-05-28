import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const ALLOWED_SYMBOLS = [
  "AMZN", "GOLD", "COST", "DE", "LLY", "EQT", "LIN", "MSFT", "ORCL",
  "PHYS", "PSLV", "WM", "UBER", "SGDJ", "AVGO", "HCA", "PEP"
];

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/stock-feed", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY environment variable." });
    }

    const requestedSymbols = Array.isArray(req.body?.symbols) ? req.body.symbols : ALLOWED_SYMBOLS;
    const symbols = requestedSymbols
      .map((symbol) => String(symbol).trim().toUpperCase())
      .filter((symbol) => ALLOWED_SYMBOLS.includes(symbol));

    if (!symbols.length) {
      return res.status(400).json({ error: "No valid stock symbols were provided." });
    }

    const prompt = `Return ONLY a valid JSON array with the latest available stock market data for these symbols: ${symbols.join(", ")}.

Each object must contain these keys exactly:
symbol, price, open, volume, change, changePct

Use numbers for numeric values. If a symbol is unavailable, use null for numeric values.

Example:
[{"symbol":"AMZN","price":185.42,"open":183.10,"volume":23450000,"change":2.32,"changePct":1.27}]`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return res.status(response.status).json({ error: "OpenAI API request failed." });
    }

    const text = data.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);

    if (!match) {
      console.error("Unexpected OpenAI response:", text);
      return res.status(502).json({ error: "No JSON array found in OpenAI response." });
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      console.error("JSON parse error:", err, text);
      return res.status(502).json({ error: "Could not parse stock data response." });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stock data." });
  }
});

app.listen(PORT, () => {
  console.log(`Auburn Market Watch running at http://localhost:${PORT}`);
});
