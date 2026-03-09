const path = require("node:path");
const dotenv = require("dotenv");
const express = require("express");
const { makeBadge } = require("badge-maker");

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
const badgeCacheTtlSec = Number(process.env.BADGE_CACHE_TTL_SEC || 120);
let lastSync = null;
let lastSyncError = null;
let cachedSummary = null;
let cachedSummaryAt = 0;
let cachedBadgeSummary = null;
let cachedBadgeSummaryAt = 0;

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

async function getBadgeSummary(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const ttlMs = Math.max(badgeCacheTtlSec, 15) * 1000;

  if (!force && cachedBadgeSummary && now - cachedBadgeSummaryAt < ttlMs) {
    return cachedBadgeSummary;
  }

  const summary = await getProfileSummary({ force: true });
  cachedBadgeSummary = summary;
  cachedBadgeSummaryAt = now;
  return summary;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(value || 0)
  );
}

function formatRelativeTime(isoDate) {
  if (!isoDate) {
    return "sem dados";
  }

  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return "sem dados";
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (diffSec < 60) {
    return "agora";
  }

  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m`;
  }

  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h`;
  }

  return `${Math.floor(diffSec / 86400)}d`;
}

function renderBadgeSvg(definition) {
  return makeBadge({
    style: "for-the-badge",
    labelColor: "0b0f1a",
    color: "0ea5e9",
    ...definition
  });
}

function buildBadgeDefinition(metric, summary) {
  const topLanguage = summary.languages[0]?.language || "N/A";
  const lastPublicActivity = summary.recentActivity[0]?.createdAt;

  const map = {
    seguidores: {
      label: "seguidores",
      message: formatCompactNumber(summary.user.followers),
      color: "22c55e"
    },
    repos: {
      label: "repositorios",
      message: `${summary.totals.publicRepositories} publicos`,
      color: "3b82f6"
    },
    estrelas: {
      label: "stars totais",
      message: formatCompactNumber(summary.totals.stars),
      color: "f59e0b"
    },
    linguagem: {
      label: "top linguagem",
      message: topLanguage,
      color: "14b8a6"
    },
    atividade: {
      label: "ultima atividade",
      message: formatRelativeTime(lastPublicActivity),
      color: "a855f7"
    },
    sync: {
      label: "sync readme",
      message: lastSync ? formatRelativeTime(lastSync) : "pendente",
      color: "06b6d4"
    }
  };

  return map[metric] || null;
}

function findProject(summary, repoName) {
  const list = Array.isArray(summary.projectsByActivity) ? summary.projectsByActivity : [];
  return (
    list.find((project) => project.name.toLowerCase() === repoName.toLowerCase()) ||
    list.find((project) => project.fullName.toLowerCase().endsWith(`/${repoName.toLowerCase()}`)) ||
    null
  );
}

function buildProjectBadgeDefinition(metric, project) {
  const metrics = {
    atividade: {
      label: "atividade",
      message: `${project.activity.events} eventos`,
      color: "a855f7"
    },
    score: {
      label: "score",
      message: String(project.activity.score),
      color: "8b5cf6"
    },
    estrelas: {
      label: "stars",
      message: formatCompactNumber(project.stars),
      color: "f59e0b"
    },
    forks: {
      label: "forks",
      message: formatCompactNumber(project.forks),
      color: "3b82f6"
    },
    linguagem: {
      label: "stack",
      message: project.language || "N/A",
      color: "14b8a6"
    },
    atualizado: {
      label: "atualizado",
      message: formatRelativeTime(project.updatedAt),
      color: "06b6d4"
    }
  };

  return metrics[metric] || null;
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
    <p>Badge endpoint: <code>/badges/seguidores.svg</code></p>
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

app.get("/api/badges", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.status(200).json({
    ok: true,
    badges: {
      seguidores: `${baseUrl}/badges/seguidores.svg`,
      repos: `${baseUrl}/badges/repos.svg`,
      estrelas: `${baseUrl}/badges/estrelas.svg`,
      linguagem: `${baseUrl}/badges/linguagem.svg`,
      atividade: `${baseUrl}/badges/atividade.svg`,
      sync: `${baseUrl}/badges/sync.svg`,
      projetoTemplate: `${baseUrl}/badges/projeto/{repositorio}/{atividade|score|estrelas|forks|linguagem|atualizado}.svg`
    }
  });
});

app.get("/badges/projeto/:repo/:metric.svg", async (req, res) => {
  const repoName = String(req.params.repo || "").trim();
  const metric = String(req.params.metric || "").toLowerCase();
  const force = req.query.force === "1";

  try {
    const summary = await getBadgeSummary({ force });
    const project = findProject(summary, repoName);

    if (!project) {
      const notFoundSvg = renderBadgeSvg({
        label: "projeto",
        message: "nao encontrado",
        color: "ef4444"
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(notFoundSvg);
    }

    const definition = buildProjectBadgeDefinition(metric, project);
    if (!definition) {
      const invalidSvg = renderBadgeSvg({
        label: "badge",
        message: "metrica invalida",
        color: "ef4444"
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(invalidSvg);
    }

    const svg = renderBadgeSvg(definition);
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
    return res.status(200).send(svg);
  } catch (error) {
    console.error(`[badge-project] repo=${repoName} metric=${metric} failed: ${error.message}`);
    const errorSvg = renderBadgeSvg({
      label: "github",
      message: "erro",
      color: "ef4444"
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(503).send(errorSvg);
  }
});

app.get("/badges/:metric.svg", async (req, res) => {
  const metric = String(req.params.metric || "").toLowerCase();
  const force = req.query.force === "1";

  try {
    const summary = await getBadgeSummary({ force });
    const definition = buildBadgeDefinition(metric, summary);

    if (!definition) {
      const notFoundSvg = renderBadgeSvg({
        label: "badge",
        message: "nao encontrado",
        color: "ef4444"
      });
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "no-store");
      return res.status(404).send(notFoundSvg);
    }

    const svg = renderBadgeSvg(definition);
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${Math.max(badgeCacheTtlSec, 15)}`);
    return res.status(200).send(svg);
  } catch (error) {
    console.error(`[badge] metric=${metric} failed: ${error.message}`);
    const errorSvg = renderBadgeSvg({
      label: "github",
      message: "erro",
      color: "ef4444"
    });
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "no-store");
    return res.status(503).send(errorSvg);
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
