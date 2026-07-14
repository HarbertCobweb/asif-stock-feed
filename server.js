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

const ALPHAVANTAGE_API_KEY =
  String(process.env.ALPHAVANTAGE_API_KEY || "").trim();

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

async function fetchAlphaVantageDaily(holding) {
  if (!ALPHAVANTAGE_API_KEY) {
    throw new Error(
      "ALPHAVANTAGE_API_KEY is missing."
    );
  }

  const url = new URL(
    "https://www.alphavantage.co/query"
  );

  url.searchParams.set(
    "function",
    "TIME_SERIES_DAILY"
  );

  url.searchParams.set(
    "symbol",
    holding.symbol
  );

  url.searchParams.set(
    "outputsize",
    "compact"
  );

  url.searchParams.set(
    "apikey",
    ALPHAVANTAGE_API_KEY
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
      `Alpha Vantage request failed for ` +
      `${holding.symbol}: ` +
      `${response.status} ` +
      `${response.statusText}`
    );
  }

  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Alpha Vantage returned invalid JSON ` +
      `for ${holding.symbol}.`
    );
  }

  if (payload["Error Message"]) {
    throw new Error(
      `Alpha Vantage symbol error for ` +
      `${holding.symbol}: ` +
      payload["Error Message"]
    );
  }

  if (payload.Note) {
    throw new Error(
      `Alpha Vantage rate limit reached ` +
      `for ${holding.symbol}: ` +
      payload.Note
    );
  }

  if (payload.Information) {
    throw new Error(
      `Alpha Vantage response for ` +
      `${holding.symbol}: ` +
      payload.Information
    );
  }

  const series =
    payload["Time Series (Daily)"];

  if (
    !series ||
    typeof series !== "object"
  ) {
    throw new Error(
      `No daily time series returned ` +
      `for ${holding.symbol}.`
    );
  }

  const dates = Object.keys(series)
    .sort((a, b) => b.localeCompare(a));

  if (dates.length < 2) {
    throw new Error(
      `Not enough daily records returned ` +
      `for ${holding.symbol}.`
    );
  }

  const latestDate = dates[0];
  const previousDate = dates[1];

  const latest = series[latestDate];
  const previous = series[previousDate];

  const price = normalizeNumber(
    latest["4. close"]
  );

  const open = normalizeNumber(
    latest["1. open"]
  );

  const volume = normalizeNumber(
    latest["5. volume"]
  );

  const previousClose = normalizeNumber(
    previous["4. close"]
  );

  if (
    price === null ||
    previousClose === null
  ) {
    throw new Error(
      `Incomplete daily quote data returned ` +
      `for ${holding.symbol}.`
    );
  }

  const change =
    price - previousClose;

  const changePct =
    previousClose !== 0
      ? (change / previousClose) * 100
      : null;

  return {
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
    quoteDate: latestDate
  };
}

async function fetchStockData(holdings) {
  if (!ALPHAVANTAGE_API_KEY) {
    throw new Error(
      "ALPHAVANTAGE_API_KEY is missing " +
      "from the environment variables."
    );
  }

  const results = [];
  const errors = [];

  /*
   * Requests are deliberately sequential.
   *
   * A full refresh uses one request per holding.
   * With 17 holdings, do not run this more than
   * once daily on the 25-request free plan.
   */
  for (const holding of holdings) {
    try {
      const quote =
        await fetchAlphaVantageDaily(holding);

      results.push(quote);

      console.log(
        `Loaded ${holding.symbol}`
      );
    } catch (error) {
      console.error(error.message);

      errors.push({
        symbol: holding.symbol,
        error: error.message
      });

      results.push(
        createEmptyStock(
          holding,
          error.message
        )
      );
    }
  }

  const successfulResults =
    results.filter(
      stock => stock.price !== null
    );

  /*
   * Do not overwrite the existing cache if
   * every request failed.
   */
  if (successfulResults.length === 0) {
    throw new Error(
      `All Alpha Vantage requests failed. ` +
      `First error: ${
        errors[0]?.error ||
        "Unknown Alpha Vantage error"
      }`
    );
  }

  return results;
}

async function createAndSaveStockPayload(
  holdings = HOLDINGS
) {
  const stockData =
    await fetchStockData(holdings);

  const payload = {
    updatedAt: new Date().toISOString(),
    source:
      "Alpha Vantage — Daily Time Series",
    count: stockData.length,
    successfulCount:
      stockData.filter(
        stock => stock.price !== null
      ).length,
    symbols:
      holdings.map(
        holding => holding.symbol
      ),
    data: stockData
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
 * Test one symbol without refreshing
 * or overwriting the full cache.
 *
 * Example:
 * /api/test/AMZN
 */
app.get(
  "/api/test/:symbol",
  async (req, res) => {
    const symbol = String(
      req.params.symbol || ""
    )
      .trim()
      .toUpperCase();

    const holding =
      HOLDINGS.find(
        item => item.symbol === symbol
      );

    if (!holding) {
      return res.status(404).json({
        error:
          "Symbol is not in the holdings list.",
        availableSymbols:
          HOLDINGS.map(
            item => item.symbol
          )
      });
    }

    try {
      const quote =
        await fetchAlphaVantageDaily(holding);

      res.json({
        success: true,
        source:
          "Alpha Vantage — Daily Time Series",
        data: quote
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Test failed",
        symbol,
        detail: error.message
      });
    }
  }
);

/*
 * Full refresh.
 *
 * This uses 17 requests.
 */
app.get(
  "/api/refresh",
  async (req, res) => {
    try {
      const payload =
        await createAndSaveStockPayload();

      res.json({
        success: true,
        source: payload.source,
        updatedAt: payload.updatedAt,
        count: payload.count,
        successfulCount:
          payload.successfulCount,
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
        error: "Refresh failed",
        detail: error.message
      });
    }
  }
);

app.get(
  "/data/stocks.json",
  (req, res) => {
    if (
      !fs.existsSync(STOCKS_JSON_FILE)
    ) {
      return res.status(404).json({
        error:
          "stocks.json has not been " +
          "created yet. Visit " +
          "/api/refresh first."
      });
    }

    res.sendFile(STOCKS_JSON_FILE);
  }
);

function sendXmlFeed(req, res) {
  if (
    !fs.existsSync(STOCKS_JSON_FILE)
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

  const payload = JSON.parse(
    fs.readFileSync(
      STOCKS_JSON_FILE,
      "utf8"
    )
  );

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
    let cache = null;

    if (
      fs.existsSync(STOCKS_JSON_FILE)
    ) {
      try {
        const payload = JSON.parse(
          fs.readFileSync(
            STOCKS_JSON_FILE,
            "utf8"
          )
        );

        cache = {
          updatedAt:
            payload.updatedAt,
          successfulCount:
            payload.successfulCount,
          count:
            payload.count
        };
      } catch {
        cache = {
          error:
            "Cache exists but could " +
            "not be parsed."
        };
      }
    }

    res.json({
      running: true,
      provider: "Alpha Vantage",
      function:
        "TIME_SERIES_DAILY",
      apiKeyConfigured:
        Boolean(
          ALPHAVANTAGE_API_KEY
        ),
      holdingCount:
        HOLDINGS.length,
      cacheExists:
        fs.existsSync(
          STOCKS_JSON_FILE
        ),
      testRoute:
        "/api/test/AMZN",
      fullRefreshRequests:
        HOLDINGS.length,
      cache
    });
  }
);

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );

  console.log(
    `Alpha Vantage API key configured: ` +
    `${Boolean(
      ALPHAVANTAGE_API_KEY
    )}`
  );
});