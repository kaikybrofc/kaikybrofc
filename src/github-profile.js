const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "perfil-server";
const DEFAULT_TIMEOUT_MS = 15000;
const STACK_SCAN_MAX_REPOS_DEFAULT = 40;
const STACK_SCAN_CONCURRENCY_DEFAULT = 4;
const STACK_TOP_LIMIT_DEFAULT = 14;
const PUBLIC_EVENTS_PER_PAGE_DEFAULT = 100;
const PUBLIC_EVENTS_PAGES_DEFAULT = 3;

const DEPENDENCY_TECH_MAP = Object.freeze({
  express: { name: "Express", badgeKey: "express" },
  fastify: { name: "Fastify", badgeKey: "fastify" },
  koa: { name: "Koa", badgeKey: "koa" },
  hono: { name: "Hono", badgeKey: "hono" },
  react: { name: "React", badgeKey: "react" },
  "react-dom": { name: "React", badgeKey: "react" },
  next: { name: "Next.js", badgeKey: "nextjs" },
  vue: { name: "Vue.js", badgeKey: "vuejs" },
  nuxt: { name: "Nuxt.js", badgeKey: "nuxtjs" },
  svelte: { name: "Svelte", badgeKey: "svelte" },
  typescript: { name: "TypeScript", badgeKey: "typescript" },
  prisma: { name: "Prisma", badgeKey: "prisma" },
  "@prisma/client": { name: "Prisma", badgeKey: "prisma" },
  mongoose: { name: "MongoDB", badgeKey: "mongodb" },
  mongodb: { name: "MongoDB", badgeKey: "mongodb" },
  redis: { name: "Redis", badgeKey: "redis" },
  ioredis: { name: "Redis", badgeKey: "redis" },
  mysql: { name: "MySQL", badgeKey: "mysql" },
  mysql2: { name: "MySQL", badgeKey: "mysql" },
  pg: { name: "PostgreSQL", badgeKey: "postgresql" },
  sequelize: { name: "Sequelize", badgeKey: "sequelize" },
  typeorm: { name: "TypeORM", badgeKey: "typeorm" },
  "socket.io": { name: "Socket.IO", badgeKey: "socketio" },
  "socket.io-client": { name: "Socket.IO", badgeKey: "socketio" },
  tailwindcss: { name: "Tailwind CSS", badgeKey: "tailwindcss" },
  sass: { name: "Sass", badgeKey: "sass" },
  vite: { name: "Vite", badgeKey: "vite" },
  webpack: { name: "Webpack", badgeKey: "webpack" },
  jest: { name: "Jest", badgeKey: "jest" },
  vitest: { name: "Vitest", badgeKey: "vitest" },
  eslint: { name: "ESLint", badgeKey: "eslint" },
  prettier: { name: "Prettier", badgeKey: "prettier" }
});

const DEPENDENCY_TECH_PREFIX_MAP = Object.freeze([
  { prefix: "@nestjs/", tech: { name: "NestJS", badgeKey: "nestjs" } },
  { prefix: "@angular/", tech: { name: "Angular", badgeKey: "angular" } },
  { prefix: "@mui/", tech: { name: "MUI", badgeKey: "mui" } },
  { prefix: "@aws-sdk/", tech: { name: "AWS SDK", badgeKey: "amazonwebservices" } }
]);

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": process.env.GITHUB_USER_AGENT || DEFAULT_USER_AGENT
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url, token) {
  const timeoutMs = parseNumber(process.env.GITHUB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: createHeaders(token),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status} on ${url}: ${body.slice(0, 280)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOwnedRepos(apiUrl, token) {
  const repos = [];
  let page = 1;

  while (true) {
    const url = new URL(`${apiUrl}/user/repos`);
    url.searchParams.set("affiliation", "owner");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const batch = await fetchJson(url.toString(), token);
    repos.push(...batch);

    if (batch.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
}

async function fetchPublicEvents(apiUrl, token, username) {
  const events = [];
  const perPageRaw = parseNumber(process.env.GITHUB_EVENTS_PER_PAGE, PUBLIC_EVENTS_PER_PAGE_DEFAULT);
  const pagesRaw = parseNumber(process.env.GITHUB_EVENTS_PAGES, PUBLIC_EVENTS_PAGES_DEFAULT);
  const perPage = Math.max(1, Math.min(100, perPageRaw));
  const maxPages = Math.max(1, pagesRaw);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${apiUrl}/users/${username}/events/public`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const batch = await fetchJson(url.toString(), token);
    if (!Array.isArray(batch) || !batch.length) {
      break;
    }

    events.push(...batch);
    if (batch.length < perPage) {
      break;
    }
  }

  return events;
}

async function fetchRepoPackageJson(apiUrl, token, repoFullName, defaultBranch) {
  const timeoutMs = parseNumber(process.env.GITHUB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${apiUrl}/repos/${repoFullName}/contents/package.json`);
    if (defaultBranch) {
      url.searchParams.set("ref", String(defaultBranch));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: createHeaders(token),
      signal: controller.signal
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data || data.type !== "file" || !data.content) {
      return null;
    }

    const raw = Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPackageJsonMap(apiUrl, token, reposRaw) {
  const maxRepos = Math.max(
    1,
    parseNumber(process.env.STACK_SCAN_MAX_REPOS, STACK_SCAN_MAX_REPOS_DEFAULT)
  );
  const concurrency = Math.max(
    1,
    parseNumber(process.env.STACK_SCAN_CONCURRENCY, STACK_SCAN_CONCURRENCY_DEFAULT)
  );

  const selectedRepos = reposRaw.slice(0, maxRepos);
  if (!selectedRepos.length) {
    return new Map();
  }

  const result = new Map();
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= selectedRepos.length) {
        return;
      }

      const repo = selectedRepos[index];
      const packageJson = await fetchRepoPackageJson(apiUrl, token, repo.full_name, repo.default_branch);
      if (packageJson) {
        result.set(repo.full_name, packageJson);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, selectedRepos.length) }, () => worker());
  await Promise.all(workers);
  return result;
}

function sumBy(repos, key) {
  return repos.reduce((total, repo) => total + Number(repo[key] || 0), 0);
}

function getEventWeight(type) {
  const weights = {
    PushEvent: 5,
    ReleaseEvent: 4,
    PullRequestEvent: 3,
    PullRequestReviewEvent: 3,
    IssuesEvent: 2,
    IssueCommentEvent: 2,
    CreateEvent: 1,
    DeleteEvent: 1
  };

  return weights[type] || 1;
}

function getDaysSince(value) {
  if (!value) {
    return 9999;
  }

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return 9999;
  }

  const diff = Date.now() - time;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function toBadgeKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\+\+/g, "plusplus")
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/\./g, "dot")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function mapDependencyToTech(dependencyName) {
  const key = String(dependencyName || "").toLowerCase().trim();
  if (!key) {
    return null;
  }

  if (DEPENDENCY_TECH_MAP[key]) {
    return DEPENDENCY_TECH_MAP[key];
  }

  for (const mapping of DEPENDENCY_TECH_PREFIX_MAP) {
    if (key.startsWith(mapping.prefix)) {
      return mapping.tech;
    }
  }

  return null;
}

function collectDependencySignals(packageJson) {
  const fields = [
    { name: "dependencies", weight: 3 },
    { name: "peerDependencies", weight: 2.4 },
    { name: "optionalDependencies", weight: 1.6 },
    { name: "devDependencies", weight: 0.9 }
  ];

  const byTech = new Map();

  for (const field of fields) {
    const deps = packageJson?.[field.name];
    if (!deps || typeof deps !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(deps)) {
      const tech = mapDependencyToTech(dependencyName);
      if (!tech) {
        continue;
      }

      const techKey = tech.badgeKey || toBadgeKey(tech.name);
      if (!techKey) {
        continue;
      }

      const current = byTech.get(techKey) || { ...tech, weight: 0 };
      current.weight = Math.max(current.weight, field.weight);
      byTech.set(techKey, current);
    }
  }

  return [...byTech.values()];
}

function addStackEntry(map, tech, score, repoFullName) {
  const name = tech?.name ? String(tech.name).trim() : "";
  const badgeKey = tech?.badgeKey ? String(tech.badgeKey).trim() : toBadgeKey(name);
  if (!name || !badgeKey) {
    return;
  }

  const current = map.get(badgeKey) || {
    name,
    badgeKey,
    score: 0,
    repositoriesSet: new Set()
  };

  current.score += Number(score || 0);
  if (repoFullName) {
    current.repositoriesSet.add(repoFullName);
  }

  map.set(badgeKey, current);
}

function buildStackStats(repos, packageJsonMap) {
  const stacks = new Map();
  const topLimit = Math.max(6, parseNumber(process.env.STACK_TOP_LIMIT, STACK_TOP_LIMIT_DEFAULT));

  for (const repo of repos) {
    if (repo.language && repo.language !== "N/A") {
      addStackEntry(stacks, { name: repo.language }, 2.4, repo.fullName);
    }

    const packageJson = packageJsonMap.get(repo.fullName);
    if (!packageJson) {
      continue;
    }

    addStackEntry(stacks, { name: "Node.js", badgeKey: "nodejs" }, 2.2, repo.fullName);

    const signals = collectDependencySignals(packageJson);
    for (const signal of signals) {
      addStackEntry(stacks, signal, signal.weight, repo.fullName);
    }
  }

  return [...stacks.values()]
    .map((entry) => ({
      name: entry.name,
      badgeKey: entry.badgeKey,
      score: Number(entry.score.toFixed(1)),
      repositories: entry.repositoriesSet.size
    }))
    .sort(
      (a, b) => b.score - a.score || b.repositories - a.repositories || a.name.localeCompare(b.name)
    )
    .slice(0, topLimit);
}

function buildLanguageStats(repos) {
  const totals = new Map();
  let totalTracked = 0;

  for (const repo of repos) {
    if (!repo.language) {
      continue;
    }

    const current = totals.get(repo.language) || 0;
    totals.set(repo.language, current + 1);
    totalTracked += 1;
  }

  return [...totals.entries()]
    .map(([language, count]) => ({
      language,
      repositories: count,
      percentage: totalTracked === 0 ? 0 : Number(((count / totalTracked) * 100).toFixed(1))
    }))
    .sort((a, b) => b.repositories - a.repositories)
    .slice(0, 8);
}

function toRepoEntry(repo) {
  return {
    name: repo.name,
    fullName: repo.full_name,
    private: Boolean(repo.private),
    htmlUrl: repo.html_url,
    description: repo.description || "",
    language: repo.language || "N/A",
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || 0),
    watchers: Number(repo.watchers_count || 0),
    openIssues: Number(repo.open_issues_count || 0),
    defaultBranch: repo.default_branch || "main",
    pushedAt: repo.pushed_at,
    updatedAt: repo.updated_at
  };
}

function buildRecentActivity(events, username) {
  return events.slice(0, 6).map((event) => ({
    type: event.type,
    repo: event.repo?.name || username,
    createdAt: event.created_at
  }));
}

function buildProjectsByActivity(publicRepos, events) {
  const activityMap = new Map();

  for (const event of events) {
    const repoFullName = event.repo?.name;
    if (!repoFullName) {
      continue;
    }

    const current = activityMap.get(repoFullName) || {
      events: 0,
      weightedEvents: 0,
      lastEventAt: null
    };

    current.events += 1;
    current.weightedEvents += getEventWeight(event.type);
    if (!current.lastEventAt || new Date(event.created_at) > new Date(current.lastEventAt)) {
      current.lastEventAt = event.created_at;
    }

    activityMap.set(repoFullName, current);
  }

  return publicRepos
    .map((repo) => {
      const activity = activityMap.get(repo.fullName) || {
        events: 0,
        weightedEvents: 0,
        lastEventAt: null
      };

      const lastTouchAt = activity.lastEventAt || repo.pushedAt || repo.updatedAt;
      const daysSinceTouch = getDaysSince(lastTouchAt);
      const recencyScore = Math.max(0, 30 - daysSinceTouch);
      const activityScore =
        activity.weightedEvents * 100 +
        activity.events * 25 +
        recencyScore * 2 +
        Math.min(repo.stars, 100);

      return {
        ...repo,
        activity: {
          events: activity.events,
          weightedEvents: activity.weightedEvents,
          lastEventAt: activity.lastEventAt,
          lastTouchAt,
          recencyScore,
          score: activityScore
        }
      };
    })
    .sort(
      (a, b) =>
        b.activity.score - a.activity.score ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
}

async function fetchProfileSummary(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || DEFAULT_API_URL;

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing. Add it to .env or process environment.");
  }

  const user = await fetchJson(`${apiUrl}/user`, token);
  const reposRaw = await fetchOwnedRepos(apiUrl, token);
  const events = await fetchPublicEvents(apiUrl, token, user.login);
  const packageJsonMap = await fetchPackageJsonMap(apiUrl, token, reposRaw);

  const repos = reposRaw.map(toRepoEntry);
  const publicRepos = repos.filter((repo) => !repo.private);
  const privateRepos = repos.filter((repo) => repo.private);

  const sortedByStars = [...publicRepos].sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  const sortedByUpdate = [...publicRepos].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const projectsByActivity = buildProjectsByActivity(publicRepos, events);
  const stackTechnologies = buildStackStats(repos, packageJsonMap);

  const summary = {
    user: {
      login: user.login,
      name: user.name || user.login,
      bio: user.bio || "",
      company: user.company || "",
      location: user.location || "",
      blog: user.blog || "",
      htmlUrl: user.html_url,
      avatarUrl: user.avatar_url,
      followers: Number(user.followers || 0),
      following: Number(user.following || 0),
      publicRepos: Number(user.public_repos || 0),
      publicGists: Number(user.public_gists || 0),
      createdAt: user.created_at
    },
    totals: {
      ownedRepositories: repos.length,
      publicRepositories: publicRepos.length,
      privateRepositories: privateRepos.length,
      stars: sumBy(repos, "stars"),
      forks: sumBy(repos, "forks"),
      watchers: sumBy(repos, "watchers"),
      openIssues: sumBy(repos, "openIssues")
    },
    repositories: repos,
    languages: buildLanguageStats(repos),
    stackTechnologies,
    topRepositories: sortedByStars.slice(0, 6),
    recentlyUpdated: sortedByUpdate.slice(0, 6),
    recentActivity: buildRecentActivity(events, user.login),
    projectsByActivity: projectsByActivity.slice(0, 12)
  };

  return summary;
}

module.exports = {
  fetchProfileSummary
};
