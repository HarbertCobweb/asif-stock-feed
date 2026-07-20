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
    "https://asif-stock-feed.onrender.com",
    "http://localhost:3000"
  ]
}));

app.use(express.json());
app.use(express.static("public"));

const TWELVEDATA_API_KEY =
  String(process.env.TWELVEDATA_API_KEY || "").trim();

const IMAGE_BASE_URL =
  "https://harbert.auburn.edu/binaries/images/centers/investment-center";

const HOLDINGS = [
  {
    symbol: "AMZN",
    name: "Amazon",
    sector: "Consumer Discretionary"
  },
  {
    symbol: "GOLD",
    name: "Barrick Mining",
    sector: "Materials"
  },
  {
    symbol: "COST",
    name: "Costco Wholesale",
    sector: "Consumer Staples"
  },
  {
    symbol: "DE",
    name: "Deere & Company",
    sector: "Industrials"
  },
  {
    symbol: "LLY",
    name: "Eli Lilly",
    sector: "Health Care"
  },
  {
    symbol: "EQT",
    name: "EQT Corporation",
    sector: "Energy"
  },
  {
    symbol: "LIN",
    name: "Linde",
    sector: "Materials"
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    sector: "Information Technology"
  },
  {
    symbol: "ORCL",
    name: "Oracle",
    sector: "Information Technology"
  },
  {
    symbol: "PHYS",
    name: "Sprott Physical Gold Trust",
    sector: "Precious Metals Fund"
  },
  {
    symbol: "PSLV",
    name: "Sprott Physical Silver Trust",
    sector: "Precious Metals Fund"
  },
  {
    symbol: "WM",
    name: "Waste Management",
    sector: "Industrials"
  },
  {
    symbol: "UBER",
    name: "Uber Technologies",
    sector: "Industrials"
  },
  {
    symbol: "SGDJ",
    name: "Sprott Junior Gold Miners ETF",
    sector: "Precious Metals Fund"
  },
  {
    symbol: "AVGO",
    name: "Broadcom",
    sector: "Information Technology"
  },
  {
    symbol: "HCA",
    name: "HCA Healthcare",
    sector: "Health Care"
  },
  {
    symbol: "PEP",
    name: "PepsiCo",
    sector: "Consumer Staples"
  }
];

const DATA_DIR = path.join(
  process.cwd(),
  "public",
  "data"
);

const STOCKS_JSON_FILE = path.join(
  DATA_DIR,
  "stocks.json"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
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
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function createImageUrl(symbol) {
  return (
    `${IMAGE_BASE_URL}/` +
    `${String(symbol).toLowerCase()}.png`
  );
}

function createEmptyStock(
  holding,
  errorMessage = null
) {
  return {
    symbol: holding.symbol,
    name: holding.name,
    sector: holding.sector,
    image: createImageUrl(holding.symbol),
    price: null,
    open: null,
    volume: null,
    change: null,
    changePct: null,
    quoteDate: null,
    error: errorMessage
  };
}

function readCache() {
  if (!fs.existsSync(STOCKS_JSON_FILE)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        STOCKS_JSON_FILE,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      "Could not read stock cache:",
      error.message
    );

    return null;
  }
}

function getUtcDateString(value = new Date()) {
  return new Date(value)
    .toISOString()
    .slice(0, 10);
}

function isCacheFromToday() {
  const payload = readCache();

  if (!payload?.updatedAt) {
    return false;
  }

  return (
    getUtcDateString(payload.updatedAt) ===
    getUtcDateString()
  );
}

function getLatestCachedQuoteDate() {
  const payload = readCache();

  if (!Array.isArray(payload?.data)) {
    return null;
  }

  const dates = payload.data
    .map(stock => stock.quoteDate)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  return dates[0] || null;
}

function stockDataToXml(payload) {
  const rows = payload.data || [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <updatedAt>${escapeXml(payload.updatedAt)}</updatedAt>
  <source>${escapeXml(payload.source)}</source>
  <count>${escapeXml(payload.count)}</count>
  <successfulCount>${escapeXml(payload.successfulCount)}</successfulCount>
  ${rows.map(stock => `
  <item>
    <symbol>${escapeXml(stock.symbol)}</symbol>
    <name>${escapeXml(stock.name)}</name>
    <sector>${escapeXml(stock.sector)}</sector>
    <image>${escapeXml(stock.image)}</image>
    <price>${escapeXml(stock.price)}</price>
    <open>${escapeXml(stock.open)}</open>
    <volume>${escapeXml(stock.volume)}</volume>
    <change>${escapeXml(stock.change)}</change>
    <changePct>${escapeXml(stock.changePct)}</changePct>
    <quoteDate>${escapeXml(stock.quoteDate)}</quoteDate>
  </item>`).join("")}
</items>`;
}

async function fetchTwelveData(holdings) {
  if (!TWELVEDATA_API_KEY) {
    throw new Error(
      "TWELVEDATA_API_KEY is missing from the environment variables."
    );
  }

  const symbols = holdings
    .map(holding => holding.symbol)
    .join(",");

  const url = new URL(
    "https://api.twelvedata.com/time_series"
  );

  url.searchParams.set(
    "symbol",
    symbols
  );

  url.searchParams.set(
    "interval",
    "1day"
  );

  url.searchParams.set(
    "outputsize",
    "2"
  );

  url.searchParams.set(
    "format",
    "JSON"
  );

  url.searchParams.set(
    "apikey",
    TWELVEDATA_API_KEY
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Twelve Data request failed: ` +
      `${response.status} ` +
      `${response.statusText} — ` +
      responseText
    );
  }

  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Twelve Data returned invalid JSON: ` +
      responseText
    );
  }

  if (payload.status === "error") {
    throw new Error(
      `Twelve Data error: ` +
      `${payload.message || "Unknown error"}`
    );
  }

  const results = [];

  for (const holding of holdings) {
    const symbolData =
      payload[holding.symbol];

    if (!symbolData) {
      results.push(
        createEmptyStock(
          holding,
          `No response object returned for ${holding.symbol}.`
        )
      );

      continue;
    }

    if (symbolData.status === "error") {
      results.push(
        createEmptyStock(
          holding,
          symbolData.message ||
          `Twelve Data returned an error for ${holding.symbol}.`
        )
      );

      continue;
    }

    const values = symbolData.values;

    if (
      !Array.isArray(values) ||
      values.length < 2
    ) {
      results.push(
        createEmptyStock(
          holding,
          `Not enough daily records returned for ${holding.symbol}.`
        )
      );

      continue;
    }

    const latest = values[0];
    const previous = values[1];

    const price = normalizeNumber(
      latest.close
    );

    const open = normalizeNumber(
      latest.open
    );

    const volume = normalizeNumber(
      latest.volume
    );

    const previousClose = normalizeNumber(
      previous.close
    );

    if (
      price === null ||
      previousClose === null
    ) {
      results.push(
        createEmptyStock(
          holding,
          `Incomplete quote data returned for ${holding.symbol}.`
        )
      );

      continue;
    }

    const change =
      price - previousClose;

    const changePct =
      previousClose !== 0
        ? (change / previousClose) * 100
        : null;

    results.push({
      symbol: holding.symbol,
      name: holding.name,
      sector: holding.sector,
      image: createImageUrl(
        holding.symbol
      ),
      price,
      open,
      volume,
      change,
      changePct,
      quoteDate:
        latest.datetime || null
    });
  }

  const successfulResults =
    results.filter(
      stock => stock.price !== null
    );

  if (successfulResults.length === 0) {
    const firstError =
      results.find(stock => stock.error)?.error;

    throw new Error(
      `All Twelve Data symbols failed. ` +
      `First error: ${
        firstError ||
        "Unknown Twelve Data error"
      }`
    );
  }

  return {
    results,
    creditsUsed:
      response.headers.get(
        "api-credits-used"
      ),
    creditsLeft:
      response.headers.get(
        "api-credits-left"
      )
  };
}

async function createAndSaveStockPayload(
  holdings = HOLDINGS
) {
  const {
    results,
    creditsUsed,
    creditsLeft
  } = await fetchTwelveData(holdings);

  const payload = {
    updatedAt: new Date().toISOString(),
    source:
      "Twelve Data — Daily Time Series",
    count: results.length,
    successfulCount:
      results.filter(
        stock => stock.price !== null
      ).length,
    symbols:
      holdings.map(
        holding => holding.symbol
      ),
    apiUsage: {
      creditsUsed:
        creditsUsed !== null
          ? Number(creditsUsed)
          : null,
      creditsLeft:
        creditsLeft !== null
          ? Number(creditsLeft)
          : null
    },
    data: results
  };

  fs.writeFileSync(
    STOCKS_JSON_FILE,
    JSON.stringify(
      payload,
      null,
      2
    )
  );

  return payload;
}

/*
 * Full refresh.
 *
 * Normally uses one batch HTTP request.
 *
 * Use ?force=1 only when you intentionally
 * need to bypass the daily cache protection.
 */
app.get(
  "/api/refresh",
  async (req, res) => {
    const forceRefresh =
      req.query.force === "1";

    if (
      !forceRefresh &&
      isCacheFromToday()
    ) {
      const payload = readCache();

      return res.json({
        success: true,
        cached: true,
        message:
          "Today's stock cache already exists. " +
          "No Twelve Data request was made.",
        source:
          payload?.source,
        updatedAt:
          payload?.updatedAt,
        latestQuoteDate:
          getLatestCachedQuoteDate(),
        count:
          payload?.count,
        successfulCount:
          payload?.successfulCount,
        apiUsage:
          payload?.apiUsage || null,
        jsonUrl:
          "/data/stocks.json",
        ixmlUrl:
          "/data/stocks.ixml",
        xmlUrl:
          "/data/stocks.xml"
      });
    }

    try {
      const payload =
        await createAndSaveStockPayload();

      res.json({
        success: true,
        cached: false,
        forced: forceRefresh,
        message:
          "Stock cache refreshed.",
        source:
          payload.source,
        updatedAt:
          payload.updatedAt,
        latestQuoteDate:
          getLatestCachedQuoteDate(),
        count:
          payload.count,
        successfulCount:
          payload.successfulCount,
        apiUsage:
          payload.apiUsage,
        jsonUrl:
          "/data/stocks.json",
        ixmlUrl:
          "/data/stocks.ixml",
        xmlUrl:
          "/data/stocks.xml"
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Refresh failed",
        detail:
          error.message
      });
    }
  }
);

/*
 * Test a subset of configured symbols.
 *
 * Example:
 * /api/test/AMZN
 * /api/test/AMZN,MSFT
 *
 * This does not overwrite stocks.json.
 */
app.get(
  "/api/test/:symbols",
  async (req, res) => {
    const requestedSymbols =
      String(req.params.symbols || "")
        .split(",")
        .map(symbol =>
          symbol.trim().toUpperCase()
        )
        .filter(Boolean);

    const holdings =
      HOLDINGS.filter(holding =>
        requestedSymbols.includes(
          holding.symbol
        )
      );

    if (!holdings.length) {
      return res.status(404).json({
        error:
          "No requested symbols are in the holdings list.",
        availableSymbols:
          HOLDINGS.map(
            holding => holding.symbol
          )
      });
    }

    try {
      const {
        results,
        creditsUsed,
        creditsLeft
      } = await fetchTwelveData(holdings);

      res.json({
        success: true,
        source:
          "Twelve Data — Daily Time Series",
        requestedSymbols:
          holdings.map(
            holding => holding.symbol
          ),
        apiUsage: {
          creditsUsed:
            creditsUsed !== null
              ? Number(creditsUsed)
              : null,
          creditsLeft:
            creditsLeft !== null
              ? Number(creditsLeft)
              : null
        },
        data: results
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Test failed",
        detail:
          error.message
      });
    }
  }
);

app.get(
  "/data/stocks.json",
  (req, res) => {
    if (
      !fs.existsSync(
        STOCKS_JSON_FILE
      )
    ) {
      return res.status(404).json({
        error:
          "stocks.json has not been " +
          "created yet. Visit " +
          "/api/refresh first."
      });
    }

    res.sendFile(
      STOCKS_JSON_FILE
    );
  }
);

function sendXmlFeed(req, res) {
  if (
    !fs.existsSync(
      STOCKS_JSON_FILE
    )
  ) {
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

  const payload = readCache();

  if (!payload) {
    return res
      .status(500)
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <error>stocks.json could not be read.</error>
</items>`
      );
  }

  res
    .type("application/xml")
    .send(
      stockDataToXml(payload)
    );
}

app.get(
  "/data/stocks.ixml",
  sendXmlFeed
);

app.get(
  "/data/stocks.xml",
  sendXmlFeed
);

app.get(
  "/api/status",
  (req, res) => {
    const payload = readCache();

    res.json({
      running: true,
      provider:
        "Twelve Data",
      endpoint:
        "time_series",
      interval:
        "1day",
      apiKeyConfigured:
        Boolean(
          TWELVEDATA_API_KEY
        ),
      holdingCount:
        HOLDINGS.length,
      cacheExists:
        Boolean(payload),
      cacheFromToday:
        isCacheFromToday(),
      latestQuoteDate:
        getLatestCachedQuoteDate(),
      cache:
        payload
          ? {
              updatedAt:
                payload.updatedAt,
              count:
                payload.count,
              successfulCount:
                payload.successfulCount,
              apiUsage:
                payload.apiUsage || null
            }
          : null,
      routes: {
        test:
          "/api/test/AMZN",
        batchTest:
          "/api/test/AMZN,MSFT",
        refresh:
          "/api/refresh",
        forcedRefresh:
          "/api/refresh?force=1",
        json:
          "/data/stocks.json",
        xml:
          "/data/stocks.xml"
      }
    });
  }
);

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );

  console.log(
    `Twelve Data API key configured: ` +
    `${Boolean(
      TWELVEDATA_API_KEY
    )}`
  );
});