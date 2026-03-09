const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_USER_AGENT = "perfil-server";
const DEFAULT_TIMEOUT_MS = 15000;

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

function sumBy(repos, key) {
  return repos.reduce((total, repo) => total + Number(repo[key] || 0), 0);
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

async function fetchProfileSummary(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || DEFAULT_API_URL;

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing. Add it to .env or process environment.");
  }

  const user = await fetchJson(`${apiUrl}/user`, token);
  const reposRaw = await fetchOwnedRepos(apiUrl, token);
  const events = await fetchJson(`${apiUrl}/users/${user.login}/events/public?per_page=30`, token);

  const repos = reposRaw.map(toRepoEntry);
  const publicRepos = repos.filter((repo) => !repo.private);
  const privateRepos = repos.filter((repo) => repo.private);

  const sortedByStars = [...publicRepos].sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  const sortedByUpdate = [...publicRepos].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

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
    languages: buildLanguageStats(repos),
    topRepositories: sortedByStars.slice(0, 6),
    recentlyUpdated: sortedByUpdate.slice(0, 6),
    recentActivity: buildRecentActivity(events, user.login)
  };

  return summary;
}

module.exports = {
  fetchProfileSummary
};
