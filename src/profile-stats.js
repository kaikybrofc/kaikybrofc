const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "perfil-server";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_REFRESH_HOURS = 1;
const DEFAULT_REPOS_MAX = 8;
const DEFAULT_COMMITS_PER_REPO = 25;
const DEFAULT_MERGED_PRS_SAMPLE = 50;
const DEFAULT_MONTHS_RANGE = 12;

const DAY_LABELS = Object.freeze(["dom", "seg", "ter", "qua", "qui", "sex", "sab"]);

const STAT_DEFINITIONS = Object.freeze([
  { key: "evolucao-mensal", title: "Evolucao Mensal", subtitle: "Commits e eventos no periodo" },
  { key: "ritmo-semanal", title: "Ritmo Semanal", subtitle: "Distribuicao por dia da semana" },
  { key: "horarios-pico", title: "Horarios de Pico", subtitle: "Faixas com maior atividade" },
  { key: "saude-repositorios", title: "Saude dos Repositorios", subtitle: "Atividade recente por repositorio" },
  { key: "top-tecnologias", title: "Top Tecnologias", subtitle: "Uso real por stack detectada" },
  { key: "entrega-manutencao", title: "Entrega e Manutencao", subtitle: "Cadencia media entre atualizacoes" },
  { key: "issues-prs", title: "Issues e PRs", subtitle: "Abertura, fechamento e resolucao" },
  { key: "velocidade-merge", title: "Velocidade de Merge", subtitle: "Tempo medio para mergear PRs" },
  { key: "distribuicao-projetos", title: "Distribuicao de Projetos", subtitle: "Categorias de repositorios" },
  { key: "marcos-recentes", title: "Marcos Recentes", subtitle: "Destaques das ultimas atualizacoes" }
]);

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getGithubApiUrl() {
  return String(process.env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL).trim() || DEFAULT_GITHUB_API_URL;
}

function getGithubToken() {
  return String(process.env.GITHUB_TOKEN || "").trim();
}

function getUserAgent() {
  return String(process.env.GITHUB_USER_AGENT || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
}

function getCachePath() {
  return process.env.ADV_STATS_CACHE_PATH || path.resolve(process.cwd(), ".cache/advanced-stats.json");
}

function getRefreshHours() {
  return Math.max(1, parseNumber(process.env.ADV_STATS_REFRESH_HOURS, DEFAULT_REFRESH_HOURS));
}

function getReposMax() {
  return Math.max(3, parseNumber(process.env.ADV_STATS_REPOS_MAX, DEFAULT_REPOS_MAX));
}

function getCommitsPerRepo() {
  return Math.max(5, parseNumber(process.env.ADV_STATS_COMMITS_PER_REPO, DEFAULT_COMMITS_PER_REPO));
}

function getMergedPrSample() {
  return Math.max(10, parseNumber(process.env.ADV_STATS_MERGED_PRS_SAMPLE, DEFAULT_MERGED_PRS_SAMPLE));
}

function getMonthsRange() {
  return Math.max(6, parseNumber(process.env.ADV_STATS_MONTHS_RANGE, DEFAULT_MONTHS_RANGE));
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value || 0));
}

function safeIsoDate(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function daysSince(value) {
  const iso = safeIsoDate(value);
  if (!iso) {
    return 9999;
  }
  const diffMs = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function relativeTime(value) {
  const iso = safeIsoDate(value);
  if (!iso) {
    return "sem dados";
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
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

function shortText(value, maxLen = 90) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
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

async function fetchJson(url, headers, options = {}) {
  const timeoutMs = parseNumber(process.env.GITHUB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (options.allow404 && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status} on ${url}: ${body.slice(0, 280)}`);
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

    if (!parsed.generatedAt || !parsed.stats || typeof parsed.stats !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cachePath, payload) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isExpired(generatedAt, refreshHours) {
  const timestamp = new Date(generatedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return true;
  }

  const ttlMs = Math.max(1, refreshHours) * 60 * 60 * 1000;
  return Date.now() - timestamp >= ttlMs;
}

function normalizeRepositories(summary) {
  const repos = Array.isArray(summary?.repositories) ? summary.repositories : [];
  if (repos.length) {
    return repos;
  }

  return [];
}

function buildRepoTargets(summary) {
  const repos = normalizeRepositories(summary)
    .filter((repo) => !repo.private && repo.fullName)
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

  const maxRepos = getReposMax();
  return repos.slice(0, maxRepos).map((repo) => ({
    name: String(repo.name || repo.fullName),
    fullName: String(repo.fullName),
    defaultBranch: String(repo.defaultBranch || "main")
  }));
}

async function fetchRecentCommitsForRepo(apiUrl, headers, repoTarget) {
  const commitsPerRepo = getCommitsPerRepo();
  const url = new URL(`${apiUrl}/repos/${repoTarget.fullName}/commits`);
  url.searchParams.set("per_page", String(Math.min(100, commitsPerRepo)));
  if (repoTarget.defaultBranch) {
    url.searchParams.set("sha", repoTarget.defaultBranch);
  }

  try {
    const data = await fetchJson(url.toString(), headers, { allow404: true });
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item) => ({
      repo: repoTarget.name,
      fullName: repoTarget.fullName,
      sha: String(item?.sha || "").slice(0, 7),
      message: shortText(String(item?.commit?.message || "").split("\n")[0], 120),
      date: safeIsoDate(item?.commit?.author?.date || item?.commit?.committer?.date),
      url: item?.html_url ? String(item.html_url) : ""
    }));
  } catch {
    return [];
  }
}

async function collectCommitEntries(summary, token) {
  if (!token) {
    return [];
  }

  const targets = buildRepoTargets(summary);
  if (!targets.length) {
    return [];
  }

  const apiUrl = getGithubApiUrl();
  const headers = createGithubHeaders(token);

  const collected = await Promise.all(
    targets.map((target) => fetchRecentCommitsForRepo(apiUrl, headers, target))
  );

  const dedup = new Map();
  for (const list of collected) {
    for (const entry of list) {
      if (!entry.date) {
        continue;
      }
      const key = `${entry.fullName}:${entry.sha || entry.date}:${entry.message}`;
      if (!dedup.has(key)) {
        dedup.set(key, entry);
      }
    }
  }

  return [...dedup.values()].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

function collectActivityEntries(summary) {
  const recent = Array.isArray(summary?.recentActivity) ? summary.recentActivity : [];
  return recent
    .map((item) => ({
      date: safeIsoDate(item?.createdAt),
      type: item?.type ? String(item.type) : "Activity",
      repo: item?.repo ? String(item.repo) : "repo"
    }))
    .filter((item) => item.date);
}

function buildMonthSeries(entries, monthsRange) {
  const months = [];
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  for (let offset = monthsRange - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - offset, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("pt-BR", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC"
    }).format(date);
    months.push({ key, label, count: 0, date: date.toISOString() });
  }

  const indexByKey = new Map(months.map((item, index) => [item.key, index]));
  for (const entry of entries) {
    const date = new Date(entry.date);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const index = indexByKey.get(key);
    if (index !== undefined) {
      months[index].count += 1;
    }
  }

  return months;
}

function computeWeeklyDistribution(entries) {
  const counts = DAY_LABELS.map((label) => ({ label, count: 0 }));
  for (const entry of entries) {
    const date = new Date(entry.date);
    const day = date.getUTCDay();
    counts[day].count += 1;
  }
  return counts;
}

function computeHourDistribution(entries) {
  const counts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const entry of entries) {
    const date = new Date(entry.date);
    counts[date.getUTCHours()].count += 1;
  }
  return counts;
}

function classifyTimeBucket(hour) {
  if (hour >= 0 && hour < 6) {
    return "madrugada";
  }
  if (hour < 12) {
    return "manha";
  }
  if (hour < 18) {
    return "tarde";
  }
  return "noite";
}

function computeCadenceByRepo(commitEntries) {
  const byRepo = new Map();
  for (const entry of commitEntries) {
    const current = byRepo.get(entry.fullName) || [];
    current.push(entry.date);
    byRepo.set(entry.fullName, current);
  }

  const cadence = [];
  for (const [repo, dates] of byRepo.entries()) {
    const sorted = dates
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a);

    if (sorted.length < 2) {
      continue;
    }

    const intervalsDays = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const diffDays = (sorted[index] - sorted[index + 1]) / (1000 * 60 * 60 * 24);
      if (diffDays >= 0) {
        intervalsDays.push(diffDays);
      }
    }

    if (!intervalsDays.length) {
      continue;
    }

    const avgDays = intervalsDays.reduce((total, value) => total + value, 0) / intervalsDays.length;
    cadence.push({
      repo,
      averageDays: avgDays
    });
  }

  return cadence.sort((a, b) => a.averageDays - b.averageDays);
}

function classifyProject(repo) {
  const name = String(repo?.name || "").toLowerCase();
  const description = String(repo?.description || "").toLowerCase();
  const language = String(repo?.language || "").toLowerCase();
  const text = `${name} ${description}`;

  if (/(bot|automac|automation|whatsapp|zap|integrac)/.test(text)) {
    return "Automacao";
  }
  if (/(api|server|backend|node|express|fastify)/.test(text)) {
    return "API/Backend";
  }
  if (/(front|ui|site|portfolio|portifolio|react|vite|vue|web)/.test(text)) {
    return "Frontend/Web";
  }
  if (/(infra|deploy|docker|linux|nginx|k8s|devops)/.test(text)) {
    return "Infra/DevOps";
  }
  if (/(python|rust|c\+\+|java|go)/.test(language)) {
    return "Apps/Sistemas";
  }
  return "Outros";
}

async function fetchIssuePrMetrics(login, token) {
  if (!token || !login) {
    return null;
  }

  const apiUrl = getGithubApiUrl();
  const headers = createGithubHeaders(token);

  async function fetchCount(query) {
    const url = new URL(`${apiUrl}/search/issues`);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", "1");
    const data = await fetchJson(url.toString(), headers);
    return Number(data?.total_count || 0);
  }

  try {
    const [
      issuesOpen,
      issuesClosed,
      prsOpen,
      prsClosed,
      prsMergedCount
    ] = await Promise.all([
      fetchCount(`author:${login} type:issue state:open`),
      fetchCount(`author:${login} type:issue state:closed`),
      fetchCount(`author:${login} type:pr state:open`),
      fetchCount(`author:${login} type:pr state:closed`),
      fetchCount(`author:${login} type:pr is:merged`)
    ]);

    const mergedSampleUrl = new URL(`${apiUrl}/search/issues`);
    mergedSampleUrl.searchParams.set("q", `author:${login} type:pr is:merged`);
    mergedSampleUrl.searchParams.set("sort", "updated");
    mergedSampleUrl.searchParams.set("order", "desc");
    mergedSampleUrl.searchParams.set("per_page", String(Math.min(100, getMergedPrSample())));

    const mergedSampleData = await fetchJson(mergedSampleUrl.toString(), headers);
    const mergedItems = Array.isArray(mergedSampleData?.items) ? mergedSampleData.items : [];

    const mergedDurationsDays = mergedItems
      .map((item) => {
        const created = new Date(item?.created_at || 0).getTime();
        const closed = new Date(item?.closed_at || 0).getTime();
        if (!Number.isFinite(created) || !Number.isFinite(closed) || closed < created) {
          return null;
        }
        return (closed - created) / (1000 * 60 * 60 * 24);
      })
      .filter((value) => Number.isFinite(value));

    const averageMergeDays = mergedDurationsDays.length
      ? mergedDurationsDays.reduce((total, value) => total + value, 0) / mergedDurationsDays.length
      : null;

    const medianMergeDays = mergedDurationsDays.length
      ? mergedDurationsDays
          .slice()
          .sort((a, b) => a - b)[Math.floor(mergedDurationsDays.length / 2)]
      : null;

    return {
      issuesOpen,
      issuesClosed,
      prsOpen,
      prsClosed,
      prsMergedCount,
      mergedSampleSize: mergedDurationsDays.length,
      averageMergeDays,
      medianMergeDays
    };
  } catch {
    return null;
  }
}

function buildStatLines(summary, context, issuePrMetrics) {
  const entriesCombined = context.entriesCombined;
  const commitEntries = context.commitEntries;
  const repositories = context.repositories;

  const monthsRange = getMonthsRange();
  const monthlySeries = buildMonthSeries(entriesCombined, monthsRange);
  const lastMonth = monthlySeries[monthlySeries.length - 1] || { label: "n/a", count: 0 };
  const prevMonth = monthlySeries[monthlySeries.length - 2] || { label: "n/a", count: 0 };
  const peakMonth = monthlySeries.reduce(
    (best, item) => (item.count > best.count ? item : best),
    { label: "n/a", count: 0 }
  );
  const deltaMonth = lastMonth.count - prevMonth.count;

  const weekly = computeWeeklyDistribution(entriesCombined);
  const weeklySorted = [...weekly].sort((a, b) => b.count - a.count);
  const topWeek = weeklySorted[0] || { label: "n/a", count: 0 };
  const lowWeek = weeklySorted[weeklySorted.length - 1] || { label: "n/a", count: 0 };

  const hours = computeHourDistribution(entriesCombined);
  const topHours = [...hours].sort((a, b) => b.count - a.count).slice(0, 3);
  const dominantBucket = topHours.length
    ? classifyTimeBucket(topHours[0].hour)
    : "sem dados";

  const publicRepos = repositories.filter((repo) => !repo.private);
  const active30 = publicRepos.filter((repo) => daysSince(repo.updatedAt) <= 30).length;
  const active60 = publicRepos.filter((repo) => daysSince(repo.updatedAt) <= 60).length;
  const active90 = publicRepos.filter((repo) => daysSince(repo.updatedAt) <= 90).length;
  const stale90 = Math.max(0, publicRepos.length - active90);
  const activeCoverage = publicRepos.length
    ? Number(((active30 / publicRepos.length) * 100).toFixed(1))
    : 0;

  const stackTop = Array.isArray(summary?.stackTechnologies) ? summary.stackTechnologies : [];
  const stackPreview = stackTop.slice(0, 3).map((item) => `${item.name} (${item.repositories})`);

  const cadence = computeCadenceByRepo(commitEntries);
  const cadenceAvg = cadence.length
    ? cadence.reduce((total, item) => total + item.averageDays, 0) / cadence.length
    : null;
  const fastestCadence = cadence[0] || null;
  const slowestCadence = cadence[cadence.length - 1] || null;

  const categoryCounts = new Map();
  for (const repo of publicRepos) {
    const category = classifyProject(repo);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  const categoryTop = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const milestones = [
    ...commitEntries.slice(0, 8).map((entry) => ({
      date: entry.date,
      label: `${entry.repo}: ${shortText(entry.message, 62)}`
    })),
    ...collectActivityEntries(summary).slice(0, 8).map((entry) => ({
      date: entry.date,
      label: `${entry.type} em ${entry.repo}`
    }))
  ]
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3)
    .map((item) => `${relativeTime(item.date)}: ${item.label}`);

  const issuesOpen = Number(issuePrMetrics?.issuesOpen || 0);
  const issuesClosed = Number(issuePrMetrics?.issuesClosed || 0);
  const prsOpen = Number(issuePrMetrics?.prsOpen || 0);
  const prsClosed = Number(issuePrMetrics?.prsClosed || 0);
  const resolvedTotal = issuesClosed + prsClosed;
  const trackedTotal = issuesOpen + issuesClosed + prsOpen + prsClosed;
  const resolutionRate = trackedTotal ? Number(((resolvedTotal / trackedTotal) * 100).toFixed(1)) : 0;

  const statMap = {
    "evolucao-mensal": {
      title: "Evolucao Mensal",
      subtitle: "Commits e eventos no periodo",
      lines: [
        `Mes atual (${lastMonth.label}): ${lastMonth.count} registros.`,
        `Mes anterior (${prevMonth.label}): ${prevMonth.count} registros.`,
        `Variacao mensal: ${deltaMonth >= 0 ? "+" : ""}${deltaMonth}.`,
        `Pico no periodo: ${peakMonth.label} (${peakMonth.count}).`
      ],
      payload: { series: monthlySeries }
    },
    "ritmo-semanal": {
      title: "Ritmo Semanal",
      subtitle: "Distribuicao por dia da semana",
      lines: [
        `Dia mais ativo: ${topWeek.label} (${topWeek.count}).`,
        `Dia menos ativo: ${lowWeek.label} (${lowWeek.count}).`,
        `Total analisado: ${entriesCombined.length} registros.`,
        `Cadencia semanal detectada com base em eventos recentes.`
      ],
      payload: { distribution: weekly }
    },
    "horarios-pico": {
      title: "Horarios de Pico",
      subtitle: "Faixas com maior atividade",
      lines: [
        `Horario #1: ${topHours[0]?.hour ?? "-"}h (${topHours[0]?.count ?? 0}).`,
        `Horario #2: ${topHours[1]?.hour ?? "-"}h (${topHours[1]?.count ?? 0}).`,
        `Horario #3: ${topHours[2]?.hour ?? "-"}h (${topHours[2]?.count ?? 0}).`,
        `Faixa dominante: ${dominantBucket}.`
      ],
      payload: { distribution: hours }
    },
    "saude-repositorios": {
      title: "Saude dos Repositorios",
      subtitle: "Atividade recente por repositorio",
      lines: [
        `Repositorios publicos monitorados: ${publicRepos.length}.`,
        `Ativos em 30d: ${active30} | em 60d: ${active60}.`,
        `Ativos em 90d: ${active90} | inativos >90d: ${stale90}.`,
        `Cobertura ativa (30d): ${activeCoverage}%.`
      ],
      payload: { publicRepos: publicRepos.length, active30, active60, active90, stale90 }
    },
    "top-tecnologias": {
      title: "Top Tecnologias",
      subtitle: "Uso real por stack detectada",
      lines: [
        `Tecnologias detectadas: ${stackTop.length}.`,
        `Top 1: ${stackTop[0]?.name || "N/A"} (${stackTop[0]?.repositories || 0} repos).`,
        `Top 3: ${stackPreview.join(" | ") || "N/A"}.`,
        `Ranking baseado em linguagem e dependencias dos projetos.`
      ],
      payload: { technologies: stackTop.slice(0, 8) }
    },
    "entrega-manutencao": {
      title: "Entrega e Manutencao",
      subtitle: "Cadencia media entre atualizacoes",
      lines: [
        `Repositorios com cadencia calculada: ${cadence.length}.`,
        `Intervalo medio: ${cadenceAvg !== null ? cadenceAvg.toFixed(1) : "N/A"} dias.`,
        `Mais frequente: ${fastestCadence ? `${fastestCadence.repo} (${fastestCadence.averageDays.toFixed(1)}d)` : "N/A"}.`,
        `Menos frequente: ${slowestCadence ? `${slowestCadence.repo} (${slowestCadence.averageDays.toFixed(1)}d)` : "N/A"}.`
      ],
      payload: { cadence }
    },
    "issues-prs": {
      title: "Issues e PRs",
      subtitle: "Abertura, fechamento e resolucao",
      lines: [
        `Issues abertas: ${issuesOpen} | fechadas: ${issuesClosed}.`,
        `PRs abertas: ${prsOpen} | fechadas: ${prsClosed}.`,
        `Taxa de resolucao geral: ${resolutionRate}%.`,
        `PRs mergeadas (total): ${issuePrMetrics?.prsMergedCount ?? 0}.`
      ],
      payload: issuePrMetrics || null
    },
    "velocidade-merge": {
      title: "Velocidade de Merge",
      subtitle: "Tempo medio para mergear PRs",
      lines: [
        `Amostra de PRs mergeadas: ${issuePrMetrics?.mergedSampleSize ?? 0}.`,
        `Tempo medio para merge: ${issuePrMetrics?.averageMergeDays !== null && issuePrMetrics?.averageMergeDays !== undefined ? issuePrMetrics.averageMergeDays.toFixed(1) : "N/A"} dias.`,
        `Tempo mediano: ${issuePrMetrics?.medianMergeDays !== null && issuePrMetrics?.medianMergeDays !== undefined ? issuePrMetrics.medianMergeDays.toFixed(1) : "N/A"} dias.`,
        `Metrica baseada em PRs mergeadas recentes.`
      ],
      payload: issuePrMetrics || null
    },
    "distribuicao-projetos": {
      title: "Distribuicao de Projetos",
      subtitle: "Categorias de repositorios",
      lines: [
        `Repositorios classificados: ${publicRepos.length}.`,
        `Categoria lider: ${categoryTop[0] ? `${categoryTop[0].category} (${categoryTop[0].count})` : "N/A"}.`,
        `Top categorias: ${categoryTop.slice(0, 3).map((item) => `${item.category} ${item.count}`).join(" | ") || "N/A"}.`,
        `Classificacao heuristica por nome, descricao e linguagem.`
      ],
      payload: { categories: categoryTop }
    },
    "marcos-recentes": {
      title: "Marcos Recentes",
      subtitle: "Destaques das ultimas atualizacoes",
      lines: milestones.length
        ? milestones
        : [
            "Sem marcos recentes suficientes.",
            "Aguardando novos eventos e commits publicos.",
            "Atualizacao automatica ativa no servidor.",
            "Resumo dinamico pronto para proxima coleta."
          ],
      payload: { milestones }
    }
  };

  return statMap;
}

function buildFallbackStats(summary) {
  const entriesCombined = collectActivityEntries(summary);
  const repositories = normalizeRepositories(summary);
  const context = {
    entriesCombined,
    commitEntries: [],
    repositories
  };

  return buildStatLines(summary, context, null);
}

function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => shortText(line, 170))
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeStatsMap(statsMap) {
  const normalized = {};
  for (const definition of STAT_DEFINITIONS) {
    const source = statsMap?.[definition.key] || {};
    normalized[definition.key] = {
      key: definition.key,
      title: String(source.title || definition.title),
      subtitle: String(source.subtitle || definition.subtitle),
      lines: normalizeLines(source.lines),
      payload: source.payload || null
    };
  }
  return normalized;
}

async function generateAdvancedStats(summary) {
  const token = getGithubToken();
  const commitEntries = await collectCommitEntries(summary, token);
  const activityEntries = collectActivityEntries(summary).map((item) => ({
    date: item.date,
    type: item.type,
    repo: item.repo
  }));

  const entriesCombined = [
    ...activityEntries,
    ...commitEntries.map((item) => ({
      date: item.date,
      type: "Commit",
      repo: item.repo
    }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const issuePrMetrics = await fetchIssuePrMetrics(summary?.user?.login, token);
  const repositories = normalizeRepositories(summary);
  const context = { commitEntries, entriesCombined, repositories };
  const stats = buildStatLines(summary, context, issuePrMetrics);

  return {
    generatedAt: new Date().toISOString(),
    source: "live",
    repositoriesAnalyzed: repositories.length,
    commitsAnalyzed: commitEntries.length,
    issuePrMetrics: issuePrMetrics || null,
    stats: normalizeStatsMap(stats)
  };
}

async function getAdvancedStats(summary, options = {}) {
  const force = Boolean(options.force);
  const cachePath = getCachePath();
  const refreshHours = getRefreshHours();
  const cached = await readCache(cachePath);

  if (!force && cached && !isExpired(cached.generatedAt, refreshHours)) {
    return {
      ...cached,
      source: "cache"
    };
  }

  try {
    const generated = await generateAdvancedStats(summary);
    await writeCache(cachePath, generated);
    return generated;
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        source: "cache_stale",
        error: error.message
      };
    }

    const fallbackStats = normalizeStatsMap(buildFallbackStats(summary));
    return {
      generatedAt: new Date().toISOString(),
      source: "fallback",
      repositoriesAnalyzed: normalizeRepositories(summary).length,
      commitsAnalyzed: 0,
      issuePrMetrics: null,
      stats: fallbackStats,
      error: error.message
    };
  }
}

function getStatDefinition(statKey) {
  return STAT_DEFINITIONS.find((item) => item.key === statKey) || null;
}

module.exports = {
  STAT_DEFINITIONS,
  getAdvancedStats,
  getStatDefinition
};
