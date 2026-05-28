
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "https://harbert.22miles.net",
    "https://asif-stock-feed.onrender.com"
  ]
}));

app.use(express.json());
app.use(express.static("public"));

const SYMBOLS = [
  'AMZN','GOLD','COST','DE','LLY','EQT','LIN',
  'MSFT','ORCL','PHYS','PSLV','WM','UBER',
  'SGDJ','AVGO','HCA','PEP'
];

const DATA_DIR = path.join(process.cwd(), "public", "data");
const STOCKS_FILE = path.join(DATA_DIR, "stocks.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function fetchStockData(symbols) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `Return ONLY a valid JSON array (no markdown) with latest stock data for: ${symbols.join(", ")}.

Each object must contain:
symbol, price, open, volume, change, changePct

Example:
[{"symbol":"AMZN","price":185.42,"open":183.10,"volume":23450000,"change":2.32,"changePct":1.27}]`
        }
      ]
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    console.error(txt);
    throw new Error("OpenAI API request failed.");
  }

  const data = await response.json();

  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json|```/g, "").trim();

  const match = clean.match(/\[[\s\S]*\]/);

  if (!match) {
    throw new Error("No JSON returned.");
  }

  return JSON.parse(match[0]);
}

app.post("/api/stock-feed", async (req, res) => {
  try {
    const symbols = req.body.symbols || SYMBOLS;

    const parsedData = await fetchStockData(symbols);

    const payload = {
      updatedAt: new Date().toISOString(),
      symbols,
      data: parsedData
    };

    fs.writeFileSync(
      STOCKS_FILE,
      JSON.stringify(payload, null, 2)
    );

    res.json(payload);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to fetch stock data"
    });
  }
});

app.get("/data/stocks.json", (req, res) => {
  if (!fs.existsSync(STOCKS_FILE)) {
    return res.status(404).json({
      error: "stocks.json has not been created yet"
    });
  }

  res.sendFile(STOCKS_FILE);
});

app.get("/api/refresh", async (req, res) => {
  try {
    const parsedData = await fetchStockData(SYMBOLS);

    const payload = {
      updatedAt: new Date().toISOString(),
      symbols: SYMBOLS,
      data: parsedData
    };

    fs.writeFileSync(
      STOCKS_FILE,
      JSON.stringify(payload, null, 2)
    );

    res.json({
      success: true,
      updatedAt: payload.updatedAt
    });

  } catch (error) {
    res.status(500).json({
      error: "Refresh failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
