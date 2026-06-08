import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import cors from "cors";

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
  "AMZN", "GOLD", "COST", "DE", "LLY", "EQT", "LIN",
  "MSFT", "ORCL", "PHYS", "PSLV", "WM", "UBER",
  "SGDJ", "AVGO", "HCA", "PEP"
];

const DATA_DIR = path.join(process.cwd(), "public", "data");
const STOCKS_JSON_FILE = path.join(DATA_DIR, "stocks.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stockDataToIxml(payload) {
  const rows = payload.data || [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <updatedAt>${escapeXml(payload.updatedAt)}</updatedAt>
  ${rows.map(stock => `
  <item>
    <symbol>${escapeXml(stock.symbol)}</symbol>
    <image>${escapeXml(stock.image)}</image>
    <price>${escapeXml(stock.price)}</price>
    <open>${escapeXml(stock.open)}</open>
    <volume>${escapeXml(stock.volume)}</volume>
    <change>${escapeXml(stock.change)}</change>
    <changePct>${escapeXml(stock.changePct)}</changePct>
  </item>`).join("")}
</items>`;
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
          content: `Return ONLY a valid JSON array with latest stock data for: ${symbols.join(", ")}.

Each object must contain:
symbol, price, open, volume, change, changePct

Example:
[{"symbol":"AMZN","price":185.42,"open":183.10,"volume":23450000,"change":2.32,"changePct":1.27}]

No markdown. No explanation.`
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI API error:", errorText);
    throw new Error("OpenAI API request failed.");
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\[[\s\S]*\]/);

  if (!match) {
    throw new Error("No JSON array found in OpenAI response.");
  }

  const parsed = JSON.parse(match[0]);

  return parsed.map(stock => ({
    ...stock,
    symbol: String(stock.symbol).toUpperCase(),
    image: `https://harbert.auburn.edu/binaries/images/centers/investment-center/${String(stock.symbol).toUpperCase()}.png`
  }));
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

    fs.writeFileSync(STOCKS_JSON_FILE, JSON.stringify(payload, null, 2));

    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to fetch stock data"
    });
  }
});

app.get("/api/refresh", async (req, res) => {
  try {
    const parsedData = await fetchStockData(SYMBOLS);

    const payload = {
      updatedAt: new Date().toISOString(),
      symbols: SYMBOLS,
      data: parsedData
    };

    fs.writeFileSync(STOCKS_JSON_FILE, JSON.stringify(payload, null, 2));

    res.json({
      success: true,
      updatedAt: payload.updatedAt,
      jsonUrl: "/data/stocks.json",
      ixmlUrl: "/data/stocks.ixml"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Refresh failed"
    });
  }
});

app.get("/data/stocks.json", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404).json({
      error: "stocks.json has not been created yet. Visit /api/refresh first."
    });
  }

  res.sendFile(STOCKS_JSON_FILE);
});

app.get("/data/stocks.ixml", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404).type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><items><error>stocks.json has not been created yet. Visit /api/refresh first.</error></items>`
    );
  }

  const payload = JSON.parse(fs.readFileSync(STOCKS_JSON_FILE, "utf8"));
  const xml = stockDataToIxml(payload);

  res.type("application/xml").send(xml);
});

app.get("/data/stocks.xml", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404).type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><items><error>stocks.json has not been created yet. Visit /api/refresh first.</error></items>`
    );
  }

  const payload = JSON.parse(fs.readFileSync(STOCKS_JSON_FILE, "utf8"));
  const xml = stockDataToIxml(payload);

  res.type("application/xml").send(xml);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});