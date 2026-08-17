import { publishStaticFeeds } from "./github-publisher.js";

const SOURCE_JSON_URL = String(process.env.SOURCE_JSON_URL || "").trim();
const SOURCE_XML_URL = String(process.env.SOURCE_XML_URL || "").trim();

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${url} - ${res.status}`);
  }
  return await res.text();
}

async function main() {
  if (!SOURCE_JSON_URL || !SOURCE_XML_URL) {
    throw new Error(
      "Missing SOURCE_JSON_URL or SOURCE_XML_URL. " +
      "This standalone script is optional; /api/refresh now publishes directly."
    );
  }

  const jsonText = await fetchText(SOURCE_JSON_URL);
  const payload = JSON.parse(jsonText);
  const xml = await fetchText(SOURCE_XML_URL);

  const result = await publishStaticFeeds({ payload, xml });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
