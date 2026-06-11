// scripts/publish-static-feeds.js

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;

const SOURCE_JSON_URL = process.env.SOURCE_JSON_URL;
const SOURCE_XML_URL = process.env.SOURCE_XML_URL;

const OUTPUT_JSON_PATH = process.env.OUTPUT_JSON_PATH || "feeds/stock-feed.json";
const OUTPUT_XML_PATH = process.env.OUTPUT_XML_PATH || "feeds/stock-feed.xml";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} - ${res.status}`);
  return await res.text();
}

async function getExistingFile(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub lookup failed for ${path}: ${res.status}`);

  return await res.json();
}

async function publishFile(path, content, message) {
  const existing = await getExistingFile(path);

  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: BRANCH,
  };

  if (existing?.sha) {
    body.sha = existing.sha;
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub publish failed for ${path}: ${res.status} ${error}`);
  }

  console.log(`Published ${path}`);
}

async function main() {
  if (!OWNER || !REPO || !TOKEN || !SOURCE_JSON_URL || !SOURCE_XML_URL) {
    throw new Error("Missing required environment variables.");
  }

  const json = await fetchText(SOURCE_JSON_URL);
  const xml = await fetchText(SOURCE_XML_URL);

  await publishFile(
    OUTPUT_JSON_PATH,
    json,
    `Update static JSON feed - ${new Date().toISOString()}`
  );

  await publishFile(
    OUTPUT_XML_PATH,
    xml,
    `Update static XML feed - ${new Date().toISOString()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});