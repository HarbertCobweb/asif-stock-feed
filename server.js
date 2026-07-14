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
  "AMZN",
  "GOLD",
  "COST",
  "DE",
  "LLY",
  "EQT",
  "LIN",
  "MSFT",
  "ORCL",
  "PHYS",
  "PSLV",
  "WM",
  "UBER",
  "SGDJ",
  "AVGO",
  "HCA",
  "PEP"
];

const FMP_API_KEY = String(process.env.FMP_API_KEY || "").trim();

const IMAGE_BASE_URL =
  "https://harbert.auburn.edu/binaries/images/centers/investment-center";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const STOCKS_JSON_FILE = path.join(DATA_DIR, "stocks.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function escapeXml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function createImageUrl(symbol) {
  return `${IMAGE_BASE_URL}/${String(symbol).toLowerCase()}.png`;
}

function stockDataToXml(payload) {
  const rows = payload.data || [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <updatedAt>${escapeXml(payload.updatedAt)}</updatedAt>
  <source>${escapeXml(payload.source)}</source>
  ${rows.map(stock => `
  <item>
    <symbol>${escapeXml(stock.symbol)}</symbol>
    <name>${escapeXml(stock.name)}</name>
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

async function fetchFmpQuote(symbol) {
  const url = new URL(
    "https://financialmodelingprep.com/stable/quote"
  );

  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", FMP_API_KEY);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `FMP request failed for ${symbol}: ` +
      `${response.status} ${response.statusText} — ${responseText}`
    );
  }

  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `FMP returned invalid JSON for ${symbol}: ${responseText}`
    );
  }

  /*
    FMP normally returns an array for this endpoint.
    Keep support for an object response just in case.
  */
  const quote = Array.isArray(payload)
    ? payload[0]
    : payload;

  if (!quote || typeof quote !== "object") {
    throw new Error(
      `No quote returned for ${symbol}: ${responseText}`
    );
  }

  /*
    Detect subscription or API errors that may come back
    inside an otherwise successful JSON response.
  */
  if (quote.error || quote["Error Message"]) {
    throw new Error(
      `FMP error for ${symbol}: ` +
      `${quote.error || quote["Error Message"]}`
    );
  }

  const price = normalizeNumber(quote.price);

  if (price === null) {
    throw new Error(
      `No usable price returned for ${symbol}: ${responseText}`
    );
  }

  const quoteTimestampValue =
    quote.timestamp ??
    quote.lastUpdated ??
    quote.date;

  let quoteTimestamp = null;

  if (quoteTimestampValue) {
    /*
      Unix timestamps are commonly returned as seconds.
      String dates are also supported.
    */
    if (
      typeof quoteTimestampValue === "number" ||
      /^\d+$/.test(String(quoteTimestampValue))
    ) {
      const numericTimestamp = Number(quoteTimestampValue);

      quoteTimestamp = new Date(
        numericTimestamp > 9999999999
          ? numericTimestamp
          : numericTimestamp * 1000
      ).toISOString();
    } else {
      const parsedDate = new Date(quoteTimestampValue);

      if (!Number.isNaN(parsedDate.getTime())) {
        quoteTimestamp = parsedDate.toISOString();
      }
    }
  }

  return {
    symbol,
    name:
      quote.name ??
      quote.companyName ??
      symbol,

    image: createImageUrl(symbol),

    price,

    open: normalizeNumber(
      quote.open ??
      quote.openPrice
    ),

    volume: normalizeNumber(
      quote.volume ??
      quote.avgVolume
    ),

    change: normalizeNumber(
      quote.change
    ),

    changePct: normalizeNumber(
      quote.changePercentage ??
      quote.changesPercentage ??
      quote.changePercent
    ),

    quoteTimestamp
  };
}

async function fetchStockData(symbols) {
  if (!FMP_API_KEY) {
    throw new Error(
      "FMP_API_KEY is missing from the environment variables."
    );
  }

  const results = [];
  const errors = [];

  /*
    Fetch quotes sequentially. That avoids firing 17 API
    requests at once and is friendlier to free-tier limits.
  */
  for (const rawSymbol of symbols) {
    const symbol = String(rawSymbol)
      .trim()
      .toUpperCase();

    try {
      const quote = await fetchFmpQuote(symbol);
      results.push(quote);
    } catch (error) {
      console.error(error.message);

      errors.push({
        symbol,
        error: error.message
      });

      /*
        Keep the symbol in the feed, but expose null values
        when only that individual quote fails.
      */
      results.push({
        symbol,
        name: symbol,
        image: createImageUrl(symbol),
        price: null,
        open: null,
        volume: null,
        change: null,
        changePct: null,
        quoteTimestamp: null,
        error: error.message
      });
    }
  }

  const successfulResults = results.filter(
    stock => stock.price !== null
  );

  /*
    Do not overwrite a healthy cache with an entirely failed feed.
  */
  if (successfulResults.length === 0) {
    throw new Error(
      `All FMP requests failed. First error: ${
        errors[0]?.error || "Unknown FMP error"
      }`
    );
  }

  return results;
}

async function createAndSaveStockPayload(symbols) {
  const stockData = await fetchStockData(symbols);

  const payload = {
    updatedAt: new Date().toISOString(),
    source: "Financial Modeling Prep",
    symbols,
    count: stockData.length,
    successfulCount: stockData.filter(
      stock => stock.price !== null
    ).length,
    data: stockData
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
      count: payload.count,
      successfulCount: payload.successfulCount,
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
    return res
      .status(404)
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

  res
    .type("application/xml")
    .send(stockDataToXml(payload));
});

app.get("/data/stocks.xml", (req, res) => {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return res
      .status(404)
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

  res
    .type("application/xml")
    .send(stockDataToXml(payload));
});

app.get("/api/status", (req, res) => {
  res.json({
    running: true,
    provider: "Financial Modeling Prep",
    apiKeyConfigured: Boolean(FMP_API_KEY),
    cacheExists: fs.existsSync(STOCKS_JSON_FILE),
    symbols: SYMBOLS
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    `FMP API key configured: ${Boolean(FMP_API_KEY)}`
  );
});