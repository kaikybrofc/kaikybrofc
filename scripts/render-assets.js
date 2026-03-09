#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const dotenv = require("dotenv");

const { STAT_DEFINITIONS } = require("../src/profile-stats");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRenderBaseUrl() {
  const explicitBaseUrl = String(process.env.LOCAL_RENDER_BASE_URL || "").trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  const host = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
  const port = parseNumber(process.env.PORT, 3015);
  return `http://${host}:${port}`;
}

function getAssetsOutputDir() {
  const configured = String(process.env.ASSETS_OUTPUT_DIR || "").trim();
  if (configured) {
    return path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "assets");
}

function collectFeaturedProjects(summary) {
  const ranked = Array.isArray(summary?.projectsByActivity) ? summary.projectsByActivity : [];
  return ranked.slice(0, Math.max(3, Math.min(6, ranked.length)));
}

function collectStackItems(summary) {
  const stack = Array.isArray(summary?.stackTechnologies) ? summary.stackTechnologies : [];
  const limit = Math.max(6, Math.min(24, parseNumber(process.env.STACK_CURRENT_LIMIT, 14)));
  return stack.slice(0, limit);
}

function collectRoutes(summary) {
  const routes = new Set([
    "/banners/hero.svg",
    "/banners/divider.svg",
    "/about/summary.svg",
    "/focus/current.svg",
    "/stack/current.svg",
    "/badges/contact/github.svg",
    "/badges/contact/linkedin.svg",
    "/badges/contact/email.svg",
    "/badges/contact/whatsapp.svg",
    "/badges/seguidores.svg",
    "/badges/repos.svg",
    "/badges/estrelas.svg",
    "/badges/linguagem.svg",
    "/badges/atividade.svg",
    "/badges/sync.svg"
  ]);

  for (const definition of STAT_DEFINITIONS) {
    routes.add(`/stats/${definition.key}.svg`);
  }

  for (const stackItem of collectStackItems(summary)) {
    const key = encodeURIComponent(String(stackItem?.badgeKey || stackItem?.name || "").trim());
    if (key) {
      routes.add(`/badges/stack/${key}.svg`);
    }
  }

  const projectMetrics = ["resumo", "atividade", "estrelas", "atualizado"];
  for (const project of collectFeaturedProjects(summary)) {
    const repoName = encodeURIComponent(String(project?.name || "").trim());
    if (!repoName) {
      continue;
    }

    for (const metric of projectMetrics) {
      routes.add(`/badges/projeto/${repoName}/${metric}.svg`);
    }
  }

  return [...routes];
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignora até o timeout.
    }

    await sleep(500);
  }

  throw new Error(`Servidor local indisponivel em ${baseUrl} apos ${timeoutMs}ms.`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao buscar JSON (${response.status}) em ${url}: ${body.slice(0, 220)}`);
  }

  return await response.json();
}

async function downloadSvg(baseUrl, route, assetsDir) {
  const normalizedRoute = `/${String(route || "").replace(/^\/+/, "")}`;
  const response = await fetch(`${baseUrl}${normalizedRoute}`, {
    method: "GET",
    headers: {
      Accept: "image/svg+xml"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Falha ao gerar ${normalizedRoute} (${response.status}): ${body.slice(0, 220)}`
    );
  }

  const svg = await response.text();
  if (!svg.includes("<svg")) {
    throw new Error(`Resposta invalida para ${normalizedRoute}: nao parece SVG.`);
  }

  const outputRelativePath = normalizedRoute.replace(/^\/+/, "");
  const outputPath = path.join(assetsDir, outputRelativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, svg, "utf8");
  return outputRelativePath;
}

async function run() {
  const baseUrl = getRenderBaseUrl();
  const assetsDir = getAssetsOutputDir();
  const waitTimeoutMs = Math.max(2000, parseNumber(process.env.LOCAL_RENDER_WAIT_TIMEOUT_MS, 20000));

  await waitForServer(baseUrl, waitTimeoutMs);

  const profilePayload = await fetchJson(`${baseUrl}/api/profile/summary`);
  if (!profilePayload?.ok || !profilePayload?.summary) {
    throw new Error("API /api/profile/summary nao retornou summary valido.");
  }

  const routes = collectRoutes(profilePayload.summary);
  await fs.rm(assetsDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const rendered = [];
  for (const route of routes) {
    rendered.push(await downloadSvg(baseUrl, route, assetsDir));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        assetsDir,
        generated: rendered.length
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
