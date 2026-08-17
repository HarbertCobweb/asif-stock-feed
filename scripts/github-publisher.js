const OWNER = String(process.env.GITHUB_OWNER || "").trim();
const REPO = String(process.env.GITHUB_REPO || "").trim();
const BRANCH = String(process.env.GITHUB_BRANCH || "main").trim();
const TOKEN = String(process.env.GITHUB_TOKEN || "").trim();

const OUTPUT_JSON_PATH =
  String(process.env.OUTPUT_JSON_PATH || "feeds/stock-feed.json").trim();
const OUTPUT_XML_PATH =
  String(process.env.OUTPUT_XML_PATH || "feeds/stock-feed.xml").trim();

export function getGitHubPublishConfig() {
  return {
    configured: Boolean(OWNER && REPO && TOKEN),
    owner: OWNER || null,
    repo: REPO || null,
    branch: BRANCH,
    jsonPath: OUTPUT_JSON_PATH,
    xmlPath: OUTPUT_XML_PATH
  };
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function getExistingFile(path) {
  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/` +
    `${encodeURI(path)}?ref=${encodeURIComponent(BRANCH)}`;

  const res = await fetch(url, {
    headers: githubHeaders()
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `GitHub lookup failed for ${path}: ${res.status} ${detail}`
    );
  }

  return await res.json();
}

function decodeGitHubContent(existing) {
  if (!existing?.content) return null;
  return Buffer.from(
    String(existing.content).replace(/\n/g, ""),
    "base64"
  ).toString("utf8");
}

async function publishFile(path, content, message) {
  const existing = await getExistingFile(path);
  const existingContent = decodeGitHubContent(existing);

  if (existingContent === content) {
    console.log(`Static feed unchanged; skipped ${path}`);
    return {
      path,
      changed: false,
      sha: existing?.sha || null
    };
  }

  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: BRANCH
  };

  if (existing?.sha) {
    body.sha = existing.sha;
  }

  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `GitHub publish failed for ${path}: ${res.status} ${detail}`
    );
  }

  const result = await res.json();
  console.log(`Published ${path}`);

  return {
    path,
    changed: true,
    sha: result?.content?.sha || null
  };
}

export async function publishStaticFeeds({ payload, xml }) {
  const config = getGitHubPublishConfig();

  if (!config.configured) {
    return {
      configured: false,
      published: false,
      reason:
        "GitHub publishing is disabled until GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN are configured."
    };
  }

  const timestamp = new Date().toISOString();
  const json = JSON.stringify(payload, null, 2) + "\n";
  const xmlText = xml.endsWith("\n") ? xml : xml + "\n";

  const jsonResult = await publishFile(
    OUTPUT_JSON_PATH,
    json,
    `Update static JSON feed - ${timestamp}`
  );

  const xmlResult = await publishFile(
    OUTPUT_XML_PATH,
    xmlText,
    `Update static XML feed - ${timestamp}`
  );

  return {
    configured: true,
    published: jsonResult.changed || xmlResult.changed,
    json: jsonResult,
    xml: xmlResult,
    repository: `${OWNER}/${REPO}`,
    branch: BRANCH
  };
}
