const fs = require("node:fs/promises");
const path = require("node:path");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "perfil-server";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_REFRESH_HOURS = 24;
const DEFAULT_MAX_OUTPUT_TOKENS = 180;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_REPOS_MAX = 5;
const DEFAULT_COMMITS_PER_REPO = 15;
const DEFAULT_TOTAL_COMMITS = 45;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOpenAiApiKey() {
  return String(
    process.env.OPENAI_API_KEY ||
      process.env.OPENAI_API_TKEY ||
      process.env.OPENAI_API_Tkey ||
      process.env.OPENAI_TOKEN ||
      ""
  ).trim();
}

function getModel() {
  return String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function getRefreshHours() {
  return Math.max(1, parseNumber(process.env.AI_FOCUS_REFRESH_HOURS, DEFAULT_REFRESH_HOURS));
}

function getCachePath() {
  return process.env.AI_FOCUS_CACHE_PATH || path.resolve(process.cwd(), ".cache/ai-focus.json");
}

function getGithubToken() {
  return String(process.env.GITHUB_TOKEN || "").trim();
}

function getGithubApiUrl() {
  return String(process.env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL).trim() || DEFAULT_GITHUB_API_URL;
}

function getUserAgent() {
  return String(process.env.GITHUB_USER_AGENT || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
}

function createGithubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": getUserAgent()
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url, headers) {
  const timeoutMs = parseNumber(process.env.GITHUB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} em ${url}: ${body.slice(0, 280)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readCache(cachePath) {
  try {
    const content = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (!Array.isArray(parsed.bullets) || !parsed.generatedAt) {
      return null;
    }

    return {
      bullets: parsed.bullets.map((item) => String(item)).filter(Boolean).slice(0, 3),
      generatedAt: String(parsed.generatedAt),
      model: parsed.model ? String(parsed.model) : null,
      commitEntries: Array.isArray(parsed.commitEntries) ? parsed.commitEntries : []
    };
  } catch {
    return null;
  }
}

async function writeCache(cachePath, data) {
  const payload = {
    bullets: Array.isArray(data.bullets) ? data.bullets.slice(0, 3) : [],
    generatedAt: String(data.generatedAt || new Date().toISOString()),
    model: data.model ? String(data.model) : null,
    commitEntries: Array.isArray(data.commitEntries) ? data.commitEntries : []
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isExpired(generatedAt, refreshHours) {
  const generatedTs = new Date(generatedAt).getTime();
  if (Number.isNaN(generatedTs)) {
    return true;
  }

  const ttlMs = Math.max(1, refreshHours) * 60 * 60 * 1000;
  return Date.now() - generatedTs >= ttlMs;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeCommitMessage(message) {
  const firstLine = String(message || "")
    .split("\n")[0]
    .trim();
  if (!firstLine) {
    return "Atualização sem descrição detalhada.";
  }

  return firstLine.length > 130 ? `${firstLine.slice(0, 127).trim()}...` : firstLine;
}

function collectRepoTargets(summary) {
  const maxRepos = Math.max(1, parseNumber(process.env.AI_FOCUS_REPOS_MAX, DEFAULT_REPOS_MAX));
  const projects = Array.isArray(summary?.projectsByActivity) ? summary.projectsByActivity : [];
  const map = new Map();

  for (const project of projects) {
    if (!project?.fullName || project?.private) {
      continue;
    }

    const fullName = String(project.fullName);
    if (!map.has(fullName)) {
      map.set(fullName, {
        fullName,
        repo: String(project.name || fullName.split("/").pop() || fullName),
        defaultBranch: String(project.defaultBranch || "main")
      });
    }

    if (map.size >= maxRepos) {
      break;
    }
  }

  return [...map.values()];
}

async function fetchRecentCommitsForRepo(repoTarget, options) {
  const commitsPerRepo = Math.max(
    1,
    parseNumber(process.env.AI_FOCUS_COMMITS_PER_REPO, DEFAULT_COMMITS_PER_REPO)
  );
  const apiUrl = getGithubApiUrl();
  const url = new URL(`${apiUrl}/repos/${repoTarget.fullName}/commits`);
  url.searchParams.set("per_page", String(commitsPerRepo));
  if (repoTarget.defaultBranch) {
    url.searchParams.set("sha", repoTarget.defaultBranch);
  }

  try {
    const data = await fetchJson(url.toString(), options.headers);
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item) => {
      const date = item?.commit?.author?.date || item?.commit?.committer?.date || null;
      return {
        repo: repoTarget.repo,
        fullName: repoTarget.fullName,
        sha: String(item?.sha || "").slice(0, 7),
        message: sanitizeCommitMessage(item?.commit?.message || ""),
        date,
        url: item?.html_url ? String(item.html_url) : ""
      };
    });
  } catch {
    return [];
  }
}

async function collectRecentCommits(summary) {
  const token = getGithubToken();
  if (!token) {
    return [];
  }

  const targets = collectRepoTargets(summary);
  if (!targets.length) {
    return [];
  }

  const headers = createGithubHeaders(token);
  const batches = await Promise.all(
    targets.map((repoTarget) => fetchRecentCommitsForRepo(repoTarget, { headers }))
  );

  const dedupe = new Map();
  for (const list of batches) {
    for (const item of list) {
      const key = item.sha || `${item.fullName}:${item.date || "sem-data"}:${item.message}`;
      if (!dedupe.has(key)) {
        dedupe.set(key, item);
      }
    }
  }

  const totalCommits = Math.max(3, parseNumber(process.env.AI_FOCUS_TOTAL_COMMITS, DEFAULT_TOTAL_COMMITS));
  return [...dedupe.values()]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, totalCommits);
}

function extractResponseText(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      if (!item || !Array.isArray(item.content)) {
        continue;
      }
      for (const contentItem of item.content) {
        if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
          parts.push(contentItem.text.trim());
        }
      }
    }
    if (parts.length) {
      return parts.join("\n").trim();
    }
  }

  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return String(data.choices[0].message.content).trim();
  }

  return "";
}

function normalizeFocusBullets(text) {
  const rawLines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const normalized = rawLines
    .map((line) => line.replace(/^[-*•\d.)\s]+/g, "").trim())
    .filter(Boolean)
    .map((line) => {
      const prepared = line.endsWith(".") ? line : `${line}.`;
      return prepared.length > 160 ? `${prepared.slice(0, 157).trim()}...` : prepared;
    });

  return normalized.slice(0, 3);
}

function buildFallbackBullets(summary, commits) {
  const topRepos = [...new Set(commits.map((item) => item.repo).filter(Boolean))].slice(0, 2);
  const stack = (summary.stackTechnologies || [])
    .slice(0, 3)
    .map((item) => item.name)
    .filter(Boolean)
    .join(", ");

  const first = topRepos.length
    ? `Evolução contínua de funcionalidades nos projetos ${topRepos.join(" e ")}.`
    : "Evolução contínua de funcionalidades nos projetos com atividade recente.";
  const second = "Ajustes e correções incrementais com base nos commits mais recentes publicados.";
  const third = stack
    ? `Consolidação da stack principal (${stack}) nas entregas atuais.`
    : "Consolidação de arquitetura e estabilidade dos serviços em produção.";

  return [first, second, third];
}

function buildAiInput(summary, commits) {
  const stacks = (summary.stackTechnologies || [])
    .slice(0, 6)
    .map((item) => `${item.name} (${item.repositories} repos)`)
    .join(", ");

  const commitLines = commits.map((item, index) => {
    return `${index + 1}. ${item.repo} | ${item.date || "sem data"} | ${item.message}`;
  });

  return [
    `Perfil: ${summary.user?.name || summary.user?.login || "N/A"} (@${summary.user?.login || "N/A"})`,
    `Stack principal detectada: ${stacks || "sem dados"}`,
    "Últimos commits publicados:",
    ...(commitLines.length ? commitLines : ["- sem commits públicos recentes disponíveis"])
  ].join("\n");
}

async function generateFocusWithOpenAi(summary, commits) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente.");
  }

  const model = getModel();
  const body = {
    model,
    temperature: 0.5,
    max_output_tokens: parseNumber(
      process.env.AI_FOCUS_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_OUTPUT_TOKENS
    ),
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Você escreve a seção Foco Atual de um README técnico em português do Brasil."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Com base nos dados abaixo, gere exatamente 3 bullets para Foco Atual.",
              "Regras: cada linha deve começar com '- ', frases curtas, tom profissional, sem emoji, sem marketing.",
              "Baseie o foco principalmente nos últimos commits publicados.",
              buildAiInput(summary, commits)
            ].join("\n")
          }
        ]
      }
    ]
  };

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorBody.slice(0, 280)}`);
  }

  const data = await response.json();
  const bullets = normalizeFocusBullets(extractResponseText(data));
  if (bullets.length < 3) {
    throw new Error("OpenAI retornou menos de 3 bullets para Foco Atual.");
  }

  return {
    bullets: bullets.slice(0, 3),
    model: data.model || model
  };
}

function asResultPayload(base) {
  return {
    bullets: base.bullets.slice(0, 3),
    content: base.bullets.slice(0, 3).map((item) => `- ${item}`).join("\n"),
    source: base.source,
    generatedAt: base.generatedAt,
    model: base.model || null,
    commitEntries: Array.isArray(base.commitEntries) ? base.commitEntries : [],
    error: base.error || null
  };
}

async function getAiFocusSummary(summary, options = {}) {
  const force = Boolean(options.force);
  const refreshHours = getRefreshHours();
  const cachePath = getCachePath();
  const cache = await readCache(cachePath);
  const cacheStillValid = cache && !isExpired(cache.generatedAt, refreshHours);

  if (!force && cacheStillValid) {
    return asResultPayload({
      bullets: cache.bullets,
      source: "cache",
      generatedAt: cache.generatedAt,
      model: cache.model || null,
      commitEntries: cache.commitEntries || []
    });
  }

  const commits = await collectRecentCommits(summary);

  try {
    const generated = await generateFocusWithOpenAi(summary, commits);
    const generatedAt = new Date().toISOString();
    await writeCache(cachePath, {
      bullets: generated.bullets,
      generatedAt,
      model: generated.model,
      commitEntries: commits
    });

    return asResultPayload({
      bullets: generated.bullets,
      source: "openai",
      generatedAt,
      model: generated.model || null,
      commitEntries: commits
    });
  } catch (error) {
    if (cache && cache.bullets?.length) {
      return asResultPayload({
        bullets: cache.bullets,
        source: "cache_stale",
        generatedAt: cache.generatedAt,
        model: cache.model || null,
        commitEntries: cache.commitEntries || commits,
        error: error.message
      });
    }

    return asResultPayload({
      bullets: buildFallbackBullets(summary, commits),
      source: "fallback",
      generatedAt: new Date().toISOString(),
      model: null,
      commitEntries: commits,
      error: error.message
    });
  }
}

module.exports = {
  getAiFocusSummary
};
