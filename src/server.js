const path = require("node:path");
const dotenv = require("dotenv");
const express = require("express");

const { fetchProfileSummary } = require("./github-profile");
const { updateReadmeWithSummary } = require("./readme-sync");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const app = express();
const startedAt = new Date().toISOString();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3015);
const readmePath = process.env.README_PATH || path.resolve(process.cwd(), "README.md");
const autoRefreshEnabled = (process.env.README_AUTO_REFRESH || "true").toLowerCase() === "true";
const autoRefreshIntervalMin = Number(process.env.README_REFRESH_INTERVAL_MIN || 60);
const profileCacheTtlSec = Number(process.env.PROFILE_CACHE_TTL_SEC || 300);
let lastSync = null;
let lastSyncError = null;
let cachedSummary = null;
let cachedSummaryAt = 0;

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

async function getProfileSummary(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const ttlMs = Math.max(profileCacheTtlSec, 30) * 1000;

  if (!force && cachedSummary && now - cachedSummaryAt < ttlMs) {
    return cachedSummary;
  }

  const summary = await fetchProfileSummary();
  cachedSummary = summary;
  cachedSummaryAt = now;
  return summary;
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "perfil-server",
    startedAt,
    lastSync,
    lastSyncError
  });
});

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>omnizap.xyz</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "JetBrains Mono", Consolas, monospace;
      background: radial-gradient(circle at 20% 20%, #0ea5e9 0%, #020617 55%);
      color: #e2e8f0;
    }
    main {
      width: min(900px, 92vw);
      border: 1px solid rgba(226, 232, 240, 0.2);
      border-radius: 16px;
      padding: 32px;
      backdrop-filter: blur(4px);
      background: rgba(2, 6, 23, 0.65);
      box-shadow: 0 20px 50px rgba(2, 6, 23, 0.45);
    }
    h1 { margin: 0 0 16px 0; font-size: clamp(1.5rem, 5vw, 2.4rem); }
    p { margin: 8px 0; line-height: 1.5; }
    code {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(14, 165, 233, 0.2);
      border: 1px solid rgba(14, 165, 233, 0.35);
    }
  </style>
</head>
<body>
  <main>
    <h1>omnizap.xyz online</h1>
    <p>Express server is running behind Nginx reverse proxy.</p>
    <p>Host: <code>${req.headers.host || "unknown"}</code></p>
    <p>Time (UTC): <code>${new Date().toISOString()}</code></p>
    <p>Health endpoint: <code>/health</code></p>
    <p>Summary endpoint: <code>/api/profile/summary</code></p>
  </main>
</body>
</html>`);
});

app.get("/api/profile/summary", async (_req, res) => {
  try {
    const summary = await getProfileSummary();
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.post("/api/readme/refresh", async (req, res) => {
  const expectedKey = process.env.README_REFRESH_KEY;
  const providedKey = req.get("x-refresh-key");

  if (!expectedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized. Set README_REFRESH_KEY and send it in x-refresh-key."
    });
  }

  try {
    const summary = await getProfileSummary({ force: true });
    const result = await updateReadmeWithSummary(summary, {
      readmePath,
      generatedAt: new Date().toISOString()
    });
    lastSync = result.generatedAt;
    lastSyncError = null;

    return res.status(200).json({
      ok: true,
      changed: result.changed,
      generatedAt: result.generatedAt,
      readmePath: result.readmePath
    });
  } catch (error) {
    lastSyncError = error.message;
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `Route ${req.method} ${req.originalUrl} does not exist`
  });
});

async function syncReadme(reason) {
  try {
    const summary = await getProfileSummary({ force: true });
    const result = await updateReadmeWithSummary(summary, {
      readmePath,
      generatedAt: new Date().toISOString()
    });
    lastSync = result.generatedAt;
    lastSyncError = null;
    console.log(`[readme-sync] reason=${reason} changed=${result.changed} at=${result.generatedAt}`);
  } catch (error) {
    lastSyncError = error.message;
    console.error(`[readme-sync] reason=${reason} failed: ${error.message}`);
  }
}

app.listen(port, host, () => {
  console.log(`perfil-server listening on http://${host}:${port}`);

  if (!process.env.GITHUB_TOKEN) {
    console.warn("[readme-sync] GITHUB_TOKEN not found. Dynamic profile sync disabled.");
    return;
  }

  if (autoRefreshEnabled) {
    syncReadme("startup");
    const intervalMs = Math.max(autoRefreshIntervalMin, 5) * 60 * 1000;
    setInterval(() => {
      syncReadme("interval");
    }, intervalMs);
    console.log(`[readme-sync] auto-refresh enabled every ${Math.max(autoRefreshIntervalMin, 5)} minutes.`);
  } else {
    console.log("[readme-sync] auto-refresh disabled by README_AUTO_REFRESH=false");
  }
});
