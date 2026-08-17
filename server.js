import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import cors from "cors";
import { publishStaticFeeds, getGitHubPublishConfig } from "./scripts/github-publisher.js";

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
    symbol: "B",
    name: "Barrick Mining",
    sector: "Materials",
    imageSymbol: "gold"
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

const BATCH_SIZE = 5;
const RATE_LIMIT_BUFFER_MS = 5 * 1000;
const MAX_BATCH_RETRIES = 2;

const MIN_REFRESH_INTERVAL_MS =
  8 * 60 * 1000;

let activeRefreshPromise = null;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function millisecondsUntilNextMinute() {
  const now = new Date();

  return (
    (60 - now.getUTCSeconds()) * 1000 -
    now.getUTCMilliseconds() +
    RATE_LIMIT_BUFFER_MS
  );
}

async function waitForNextCreditWindow(reason = "rate limit") {
  const waitMs = millisecondsUntilNextMinute();

  console.log(
    `Waiting ${Math.ceil(waitMs / 1000)} seconds for the next Twelve Data credit window (${reason})...`
  );

  await sleep(waitMs);
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

function createImageUrl(
  symbol,
  imageSymbol = null
) {
  const filename =
    imageSymbol || symbol;

  return (
    `${IMAGE_BASE_URL}/` +
    `${String(filename).toLowerCase()}.png`
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
      holding.symbol,
      holding.imageSymbol
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

  if (!isWeekdayEastern()) {
    return false;
  }

  const minutesSinceMidnight =
    eastern.hour * 60 +
    eastern.minute;

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

async function publishCurrentPayload(payload) {
  return await publishStaticFeeds({
    payload,
    xml: stockDataToXml(payload)
  });
}

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
        holding.symbol,
        holding.imageSymbol
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

async function fetchQuoteBatch(
  holdings,
  attempt = 0
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
    `Requesting quote batch: ${symbols}` +
    (attempt > 0
      ? ` (retry ${attempt} of ${MAX_BATCH_RETRIES})`
      : "")
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

  let payload = null;

  try {
    payload =
      JSON.parse(
        responseText
      );
  } catch {
    if (!response.ok) {
      throw new Error(
        `Twelve Data quote request failed: ` +
        `${response.status} ` +
        `${response.statusText} — ` +
        responseText
      );
    }

    throw new Error(
      `Twelve Data returned invalid JSON: ` +
      responseText
    );
  }

  const isRateLimitError =
    response.status === 429 ||
    payload?.code === 429 ||
    /api credits|too many requests|rate limit/i.test(
      String(payload?.message || "")
    );

  if (
    isRateLimitError &&
    attempt < MAX_BATCH_RETRIES
  ) {
    await waitForNextCreditWindow(
      `429 received for ${symbols}`
    );

    return fetchQuoteBatch(
      holdings,
      attempt + 1
    );
  }

  if (!response.ok) {
    throw new Error(
      `Twelve Data quote request failed: ` +
      `${response.status} ` +
      `${response.statusText} — ` +
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

    if (index > 0) {
      await waitForNextCreditWindow(
        `before batch ${index + 1}`
      );
    }

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
  }

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

function getOrCreateRefreshPromise() {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise =
    createAndSaveStockPayload()
      .finally(() => {
        activeRefreshPromise = null;
      });

  return activeRefreshPromise;
}

app.get(
  "/api/refresh",
  async (req, res) => {
    const forceValue =
      String(req.query.force || "")
        .trim()
        .toLowerCase();

    const forceRefresh =
      forceValue === "1" ||
      forceValue === "true";

    const cachedPayload =
      readCache();

    if (
      !forceRefresh &&
      !isMarketRefreshWindow() &&
      cachedPayload
    ) {
      const payload =
        cachedPayload;

      try {
        const staticPublish =
          await publishCurrentPayload(payload);

        return res.json({
        success: true,
        skipped: true,
        staticPublish,

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
      } catch (error) {
        console.error(error);
        return res.status(500).json({
          error: "Static feed publish failed",
          detail: error.message,
          refreshSkipped: true
        });
      }
    }

    if (
      !forceRefresh &&
      !isMarketRefreshWindow() &&
      !cachedPayload
    ) {
      console.warn(
        "No cached stock data is available outside the normal market window. " +
        "Running a recovery refresh instead of returning an empty response."
      );
    }

    if (
      !forceRefresh &&
      wasCacheRecentlyRefreshed()
    ) {
      const payload =
        readCache();

      try {
        const staticPublish =
          await publishCurrentPayload(payload);

        return res.json({
        success: true,
        skipped: true,
        staticPublish,

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
      } catch (error) {
        console.error(error);
        return res.status(500).json({
          error: "Static feed publish failed",
          detail: error.message,
          refreshSkipped: true
        });
      }
    }

    try {
      const alreadyRunning =
        Boolean(activeRefreshPromise);

      const payload =
        await getOrCreateRefreshPromise();

      const staticPublish =
        await publishCurrentPayload(payload);

      res.json({
        success: true,
        staticPublish,
        skipped: false,
        forced: forceRefresh,
        joinedExistingRefresh:
          alreadyRunning,

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

    if (activeRefreshPromise) {
      return res
        .status(409)
        .json({
          error:
            "A full stock refresh is already running. Try the test again after it finishes."
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

      staticPublishing:
        getGitHubPublishConfig(),

      symbols:
        HOLDINGS.map(
          holding => holding.symbol
        ),

      batchSize:
        BATCH_SIZE,

      batchDelayStrategy:
        "Wait until the next UTC minute plus a 5-second buffer",

      maxBatchRetries:
        MAX_BATCH_RETRIES,

      refreshInProgress:
        Boolean(activeRefreshPromise),

      expectedRefreshDurationSeconds:
        195,

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
        testBarrick:
          "/api/test/B",

        batchTest:
          "/api/test/AMZN,B",

        refresh:
          "/api/refresh",

        forcedRefresh:
          "/api/refresh?force=true",

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