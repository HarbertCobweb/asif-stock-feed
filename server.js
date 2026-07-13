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

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

const IMAGE_BASE_URL =
  "https://harbert.auburn.edu/binaries/images/centers/investment-center";

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
    <quoteTimestamp>${escapeXml(stock.quoteTimestamp)}</quoteTimestamp>
  </item>`).join("")}
</items>`;
}

function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

async function fetchFinnhubQuote(symbol) {
  const url = new URL("https://finnhub.io/api/v1/quote");

  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", FINNHUB_API_KEY);

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Finnhub request failed for ${symbol}: ${response.status} ${errorText}`
    );
  }

  const quote = await response.json();

  /*
    Finnhub quote response:
    c  = current price
    d  = change
    dp = percentage change
    h  = high
    l  = low
    o  = open
    pc = previous close
    t  = Unix timestamp
  */

  const price = normalizeNumber(quote.c);
  const open = normalizeNumber(quote.o);
  const change = normalizeNumber(quote.d);
  const changePct = normalizeNumber(quote.dp);
  const timestamp = normalizeNumber(quote.t);

  /*
    Finnhub may return zero values when a symbol cannot be resolved.
    Treat a quote with no usable price as unavailable.
  */
  if (price === null || price === 0) {
    console.warn(`No usable Finnhub quote returned for ${symbol}`);

    return {
      symbol,
      image: `${IMAGE_BASE_URL}/${symbol.toLowerCase()}.png`,
      price: null,
      open: null,
      volume: null,
      change: null,
      changePct: null,
      quoteTimestamp: null
    };
  }

  return {
    symbol,
    image: `${IMAGE_BASE_URL}/${symbol.toLowerCase()}.png`,
    price,
    open,
    volume: null,
    change,
    changePct,
    quoteTimestamp: timestamp
      ? new Date(timestamp * 1000).toISOString()
      : null
  };
}

async function fetchStockData(symbols) {
  if (!FINNHUB_API_KEY) {
    throw new Error(
      "FINNHUB_API_KEY is missing from the environment variables."
    );
  }

  /*
    Fetch sequentially rather than all at once.
    This is gentler on Finnhub free-tier rate limits.
  */
  const results = [];

  for (const rawSymbol of symbols) {
    const symbol = String(rawSymbol).trim().toUpperCase();

    try {
      const quote = await fetchFinnhubQuote(symbol);
      results.push(quote);
    } catch (error) {
      console.error(error.message);

      results.push({
        symbol,
        image: `${IMAGE_BASE_URL}/${symbol.toLowerCase()}.png`,
        price: null,
        open: null,
        volume: null,
        change: null,
        changePct: null,
        quoteTimestamp: null
      });
    }
  }

  return results;
}

async function createAndSaveStockPayload(symbols) {
  const parsedData = await fetchStockData(symbols);

  const payload = {
    updatedAt: new Date().toISOString(),
    source: "Finnhub",
    symbols,
    data: parsedData
  };

  fs.writeFileSync(
    STOCKS_JSON_FILE,
    JSON.stringify(payload, null, 2)
  );

  return payload;
}

app.post("/api/stock-feed", async (req, res) => {
  try {
    const symbols = Array.isArray(req.body.symbols)
      ? req.body.symbols
      : SYMBOLS;

    const payload = await createAndSaveStockPayload(symbols);

    res.json(payload);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch stock data",
      detail: error.message
    });
  }
});

app.get("/api/refresh", async (req, res) => {
  try {
    const payload = await createAndSaveStockPayload(SYMBOLS);

    res.json({
      success: true,
      source: payload.source,
      updatedAt: payload.updatedAt,
      count: payload.data.length,
      jsonUrl: "/data/stocks.json",
      ixmlUrl: "/data/stocks.ixml",
      xmlUrl: "/data/stocks.xml"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Refresh failed",
      detail: error.message
    });
  }
});

app.get("/data/stocks.json", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404).json({
      error:
        "stocks.json has not been created yet. Visit /api/refresh first."
    });
  }

  res.sendFile(STOCKS_JSON_FILE);
});

app.get("/data/stocks.ixml", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404)
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <error>stocks.json has not been created yet. Visit /api/refresh first.</error>
</items>`
      );
  }

  const payload = JSON.parse(
    fs.readFileSync(STOCKS_JSON_FILE, "utf8")
  );

  const xml = stockDataToIxml(payload);

  res.type("application/xml").send(xml);
});

app.get("/data/stocks.xml", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res.status(404)
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <error>stocks.json has not been created yet. Visit /api/refresh first.</error>
</items>`
      );
  }

  const payload = JSON.parse(
    fs.readFileSync(STOCKS_JSON_FILE, "utf8")
  );

  const xml = stockDataToIxml(payload);

  res.type("application/xml").send(xml);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});