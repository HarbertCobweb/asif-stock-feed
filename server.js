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

const BATCH_SIZE = 6;
const BATCH_DELAY_MS = 65 * 1000;

/*
 * Prevent refreshes from starting too close together.
 * The full refresh itself takes about 130 seconds.
 */
const MIN_REFRESH_INTERVAL_MS =
  8 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

/*
 * General utilities
 */

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function escapeXml(value) {
  if (
    value === null ||
    value === undefined
  ) {
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
    image: createImageUrl(
      holding.symbol
    ),

    price: null,
    open: null,
    previousClose: null,
    volume: null,
    change: null,
    changePct: null,

    quoteDate: null,
    quoteTimestamp: null,

    error: errorMessage
  };
}

/*
 * Cache utilities
 */

function readCache() {
  if (
    !fs.existsSync(
      STOCKS_JSON_FILE
    )
  ) {
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

function getLatestCachedTimestamp() {
  const payload = readCache();

  if (!payload?.updatedAt) {
    return null;
  }

  const timestamp =
    new Date(payload.updatedAt).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function wasCacheRecentlyRefreshed() {
  const timestamp =
    getLatestCachedTimestamp();

  if (!timestamp) {
    return false;
  }

  return (
    Date.now() - timestamp <
    MIN_REFRESH_INTERVAL_MS
  );
}

function getMinutesSinceRefresh() {
  const timestamp =
    getLatestCachedTimestamp();

  if (!timestamp) {
    return null;
  }

  return Math.floor(
    (Date.now() - timestamp) /
    (60 * 1000)
  );
}

/*
 * Eastern Time and market-hours logic
 */

function getEasternTimeParts(
  date = new Date()
) {
  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",

        weekday:
          "short",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23"
      }
    );

  const parts =
    formatter.formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] =
        part.value;
    }
  }

  return {
    weekday:
      values.weekday,

    year:
      Number(values.year),

    month:
      Number(values.month),

    day:
      Number(values.day),

    hour:
      Number(values.hour),

    minute:
      Number(values.minute),

    second:
      Number(values.second)
  };
}

function isWeekdayEastern() {
  const {
    weekday
  } = getEasternTimeParts();

  return ![
    "Sat",
    "Sun"
  ].includes(weekday);
}

function isMarketRefreshWindow() {
  const eastern =
    getEasternTimeParts();

  if (
    !isWeekdayEastern()
  ) {
    return false;
  }

  const minutesSinceMidnight =
    eastern.hour * 60 +
    eastern.minute;

  /*
   * Start at 9:30 AM ET.
   *
   * Continue through 4:10 PM ET so the
   * final cron after market close can
   * capture the closing snapshot.
   */
  const startMinutes =
    9 * 60 + 30;

  const endMinutes =
    16 * 60 + 10;

  return (
    minutesSinceMidnight >=
      startMinutes &&
    minutesSinceMidnight <=
      endMinutes
  );
}

function getEasternDisplayTime() {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "America/New_York",

      month:
        "short",

      day:
        "numeric",

      year:
        "numeric",

      hour:
        "numeric",

      minute:
        "2-digit",

      second:
        "2-digit",

      timeZoneName:
        "short"
    }
  ).format(new Date());
}

/*
 * XML generation
 */

function stockDataToXml(payload) {
  const rows =
    payload.data || [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <updatedAt>${escapeXml(payload.updatedAt)}</updatedAt>
  <updatedAtEastern>${escapeXml(payload.updatedAtEastern)}</updatedAtEastern>
  <source>${escapeXml(payload.source)}</source>
  <mode>${escapeXml(payload.mode)}</mode>
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
    <previousClose>${escapeXml(stock.previousClose)}</previousClose>
    <volume>${escapeXml(stock.volume)}</volume>
    <change>${escapeXml(stock.change)}</change>
    <changePct>${escapeXml(stock.changePct)}</changePct>
    <quoteDate>${escapeXml(stock.quoteDate)}</quoteDate>
    <quoteTimestamp>${escapeXml(stock.quoteTimestamp)}</quoteTimestamp>
  </item>`).join("")}
</items>`;
}

/*
 * Convert one Twelve Data quote response
 * to the stock feed structure.
 */

function convertQuoteToStock(
  holding,
  quote
) {
  const price =
    normalizeNumber(
      quote.close ??
      quote.price
    );

  const open =
    normalizeNumber(
      quote.open
    );

  const previousClose =
    normalizeNumber(
      quote.previous_close
    );

  const volume =
    normalizeNumber(
      quote.volume
    );

  let change =
    normalizeNumber(
      quote.change
    );

  let changePct =
    normalizeNumber(
      quote.percent_change
    );

  if (
    change === null &&
    price !== null &&
    previousClose !== null
  ) {
    change =
      price - previousClose;
  }

  if (
    changePct === null &&
    change !== null &&
    previousClose !== null &&
    previousClose !== 0
  ) {
    changePct =
      (
        change /
        previousClose
      ) * 100;
  }

  let quoteTimestamp = null;

  if (quote.timestamp) {
    const numericTimestamp =
      Number(quote.timestamp);

    if (
      Number.isFinite(
        numericTimestamp
      )
    ) {
      const milliseconds =
        numericTimestamp >
          9999999999
          ? numericTimestamp
          : numericTimestamp * 1000;

      quoteTimestamp =
        new Date(
          milliseconds
        ).toISOString();
    }
  }

  if (!quoteTimestamp) {
    quoteTimestamp =
      new Date().toISOString();
  }

  return {
    symbol:
      holding.symbol,

    name:
      holding.name,

    sector:
      holding.sector,

    image:
      createImageUrl(
        holding.symbol
      ),

    price,
    open,
    previousClose,
    volume,
    change,
    changePct,

    quoteDate:
      quote.datetime
        ? String(
            quote.datetime
          ).slice(0, 10)
        : quoteTimestamp.slice(
            0,
            10
          ),

    quoteTimestamp,

    error: null
  };
}

/*
 * Fetch one batch from Twelve Data.
 */

async function fetchQuoteBatch(
  holdings
) {
  const symbols =
    holdings
      .map(
        holding =>
          holding.symbol
      )
      .join(",");

  const url =
    new URL(
      "https://api.twelvedata.com/quote"
    );

  url.searchParams.set(
    "symbol",
    symbols
  );

  url.searchParams.set(
    "apikey",
    TWELVEDATA_API_KEY
  );

  console.log(
    `Requesting quote batch: ${symbols}`
  );

  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json"
        }
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Twelve Data quote request failed: ` +
      `${response.status} ` +
      `${response.statusText} — ` +
      responseText
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      `Twelve Data returned invalid JSON: ` +
      responseText
    );
  }

  if (
    payload.status ===
    "error"
  ) {
    throw new Error(
      `Twelve Data error: ` +
      `${
        payload.message ||
        "Unknown error"
      }`
    );
  }

  const isSingleSymbol =
    holdings.length === 1 &&
    payload.symbol;

  const results = [];

  for (
    const holding of holdings
  ) {
    const quote =
      isSingleSymbol
        ? payload
        : payload[
            holding.symbol
          ];

    if (!quote) {
      results.push(
        createEmptyStock(
          holding,
          `No response object returned for ${holding.symbol}.`
        )
      );

      continue;
    }

    if (
      quote.status ===
      "error"
    ) {
      results.push(
        createEmptyStock(
          holding,
          quote.message ||
          `Twelve Data returned an error for ${holding.symbol}.`
        )
      );

      continue;
    }

    const stock =
      convertQuoteToStock(
        holding,
        quote
      );

    if (
      stock.price === null
    ) {
      results.push(
        createEmptyStock(
          holding,
          `No usable price returned for ${holding.symbol}.`
        )
      );

      continue;
    }

    results.push(stock);
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

/*
 * Fetch all holdings in three batches.
 */

async function fetchAllQuotes() {
  if (
    !TWELVEDATA_API_KEY
  ) {
    throw new Error(
      "TWELVEDATA_API_KEY is missing from the environment variables."
    );
  }

  const batches = [];

  for (
    let index = 0;
    index < HOLDINGS.length;
    index += BATCH_SIZE
  ) {
    batches.push(
      HOLDINGS.slice(
        index,
        index + BATCH_SIZE
      )
    );
  }

  const allResults = [];
  const batchUsage = [];

  for (
    let index = 0;
    index < batches.length;
    index++
  ) {
    const batch =
      batches[index];

    console.log(
      `Starting batch ${index + 1} of ${batches.length}: ` +
      batch
        .map(
          holding =>
            holding.symbol
        )
        .join(", ")
    );

    try {
      const {
        results,
        creditsUsed,
        creditsLeft
      } =
        await fetchQuoteBatch(
          batch
        );

      allResults.push(
        ...results
      );

      batchUsage.push({
        batch:
          index + 1,

        symbols:
          batch.map(
            holding =>
              holding.symbol
          ),

        creditsUsed:
          creditsUsed !== null
            ? Number(
                creditsUsed
              )
            : null,

        creditsLeft:
          creditsLeft !== null
            ? Number(
                creditsLeft
              )
            : null
      });
    } catch (error) {
      console.error(
        `Batch ${index + 1} failed:`,
        error.message
      );

      for (
        const holding of batch
      ) {
        allResults.push(
          createEmptyStock(
            holding,
            error.message
          )
        );
      }

      batchUsage.push({
        batch:
          index + 1,

        symbols:
          batch.map(
            holding =>
              holding.symbol
          ),

        error:
          error.message
      });
    }

    if (
      index <
      batches.length - 1
    ) {
      console.log(
        `Waiting 65 seconds before batch ${index + 2}...`
      );

      await sleep(
        BATCH_DELAY_MS
      );
    }
  }

  /*
   * Restore the portfolio's original order.
   */

  const resultMap =
    new Map(
      allResults.map(
        stock => [
          stock.symbol,
          stock
        ]
      )
    );

  const orderedResults =
    HOLDINGS.map(
      holding =>
        resultMap.get(
          holding.symbol
        ) ||
        createEmptyStock(
          holding,
          "No result returned."
        )
    );

  const successfulResults =
    orderedResults.filter(
      stock =>
        stock.price !== null
    );

  if (
    successfulResults.length ===
    0
  ) {
    const firstError =
      orderedResults.find(
        stock =>
          stock.error
      )?.error;

    throw new Error(
      `All Twelve Data symbols failed. First error: ` +
      `${
        firstError ||
        "Unknown Twelve Data error"
      }`
    );
  }

  return {
    results:
      orderedResults,

    successfulCount:
      successfulResults.length,

    batchUsage
  };
}

/*
 * Save the refreshed cache.
 */

async function createAndSaveStockPayload() {
  const {
    results,
    successfulCount,
    batchUsage
  } =
    await fetchAllQuotes();

  const payload = {
    updatedAt:
      new Date().toISOString(),

    updatedAtEastern:
      getEasternDisplayTime(),

    source:
      "Twelve Data — Quote",

    mode:
      "near-real-time",

    count:
      results.length,

    successfulCount,

    symbols:
      HOLDINGS.map(
        holding =>
          holding.symbol
      ),

    apiUsage: {
      creditsUsed:
        HOLDINGS.length,

      batches:
        batchUsage
    },

    data:
      results
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
 * Refresh route
 */

app.get(
  "/api/refresh",
  async (req, res) => {
    const forceRefresh =
      req.query.force === "1";

    /*
     * Do not use credits outside the
     * normal market refresh window.
     */

    if (
      !forceRefresh &&
      !isMarketRefreshWindow()
    ) {
      const payload =
        readCache();

      return res.json({
        success: true,
        skipped: true,

        reason:
          "Outside the weekday market refresh window.",

        marketWindow:
          "9:30 AM–4:10 PM Eastern",

        currentEasternTime:
          getEasternDisplayTime(),

        cachedDataAvailable:
          Boolean(payload),

        updatedAt:
          payload?.updatedAt ||
          null,

        updatedAtEastern:
          payload?.updatedAtEastern ||
          null,

        jsonUrl:
          "/data/stocks.json",

        xmlUrl:
          "/data/stocks.xml"
      });
    }

    /*
     * Prevent overlapping or duplicate runs.
     */

    if (
      !forceRefresh &&
      wasCacheRecentlyRefreshed()
    ) {
      const payload =
        readCache();

      return res.json({
        success: true,
        skipped: true,

        reason:
          "The stock cache was refreshed recently.",

        minutesSinceRefresh:
          getMinutesSinceRefresh(),

        minimumIntervalMinutes:
          MIN_REFRESH_INTERVAL_MS /
          60000,

        updatedAt:
          payload?.updatedAt,

        updatedAtEastern:
          payload?.updatedAtEastern,

        successfulCount:
          payload?.successfulCount,

        jsonUrl:
          "/data/stocks.json",

        xmlUrl:
          "/data/stocks.xml"
      });
    }

    try {
      const payload =
        await createAndSaveStockPayload();

      res.json({
        success: true,
        skipped: false,
        forced: forceRefresh,

        message:
          "Near-real-time market snapshot refreshed.",

        source:
          payload.source,

        mode:
          payload.mode,

        updatedAt:
          payload.updatedAt,

        updatedAtEastern:
          payload.updatedAtEastern,

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
 * Test one or more symbols without
 * overwriting the main cache.
 */

app.get(
  "/api/test/:symbols",
  async (req, res) => {
    const requestedSymbols =
      String(
        req.params.symbols ||
        ""
      )
        .split(",")
        .map(
          symbol =>
            symbol
              .trim()
              .toUpperCase()
        )
        .filter(Boolean);

    const holdings =
      HOLDINGS.filter(
        holding =>
          requestedSymbols.includes(
            holding.symbol
          )
      );

    if (!holdings.length) {
      return res
        .status(404)
        .json({
          error:
            "No requested symbols are in the holdings list.",

          availableSymbols:
            HOLDINGS.map(
              holding =>
                holding.symbol
            )
        });
    }

    /*
     * Keep tests below the per-minute
     * free-plan credit window.
     */

    if (
      holdings.length >
      BATCH_SIZE
    ) {
      return res
        .status(400)
        .json({
          error:
            `Test a maximum of ${BATCH_SIZE} symbols at a time.`
        });
    }

    try {
      const result =
        await fetchQuoteBatch(
          holdings
        );

      res.json({
        success: true,

        source:
          "Twelve Data — Quote",

        requestedSymbols:
          holdings.map(
            holding =>
              holding.symbol
          ),

        apiUsage: {
          creditsUsed:
            result.creditsUsed,

          creditsLeft:
            result.creditsLeft
        },

        data:
          result.results
      });
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .json({
          error:
            "Test failed",

          detail:
            error.message
        });
    }
  }
);

/*
 * Public JSON
 */

app.get(
  "/data/stocks.json",
  (req, res) => {
    const payload =
      readCache();

    if (!payload) {
      return res
        .status(404)
        .json({
          error:
            "stocks.json has not been created yet. Visit /api/refresh?force=1 first."
        });
    }

    res.json(payload);
  }
);

/*
 * Public XML/iXML
 */

function sendXmlFeed(
  req,
  res
) {
  const payload =
    readCache();

  if (!payload) {
    return res
      .status(404)
      .type(
        "application/xml"
      )
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <error>stocks.json has not been created yet.</error>
</items>`
      );
  }

  res
    .type(
      "application/xml"
    )
    .send(
      stockDataToXml(
        payload
      )
    );
}

app.get(
  "/data/stocks.xml",
  sendXmlFeed
);

app.get(
  "/data/stocks.ixml",
  sendXmlFeed
);

/*
 * Diagnostics
 */

app.get(
  "/api/status",
  (req, res) => {
    const payload =
      readCache();

    res.json({
      running: true,

      provider:
        "Twelve Data",

      endpoint:
        "quote",

      mode:
        "near-real-time REST",

      apiKeyConfigured:
        Boolean(
          TWELVEDATA_API_KEY
        ),

      marketRefreshWindow:
        "9:30 AM–4:10 PM Eastern",

      currentlyInRefreshWindow:
        isMarketRefreshWindow(),

      currentEasternTime:
        getEasternDisplayTime(),

      holdingCount:
        HOLDINGS.length,

      batchSize:
        BATCH_SIZE,

      batchDelaySeconds:
        BATCH_DELAY_MS /
        1000,

      expectedRefreshDurationSeconds:
        130,

      minimumRefreshIntervalMinutes:
        MIN_REFRESH_INTERVAL_MS /
        60000,

      cacheExists:
        Boolean(payload),

      minutesSinceRefresh:
        getMinutesSinceRefresh(),

      cache:
        payload
          ? {
              updatedAt:
                payload.updatedAt,

              updatedAtEastern:
                payload.updatedAtEastern,

              count:
                payload.count,

              successfulCount:
                payload.successfulCount
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

app.listen(
  PORT,
  () => {
    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      `Twelve Data API key configured: ` +
      `${Boolean(
        TWELVEDATA_API_KEY
      )}`
    );

    console.log(
      `Current Eastern time: ` +
      getEasternDisplayTime()
    );
  }
);