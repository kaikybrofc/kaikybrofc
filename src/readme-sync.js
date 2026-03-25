const fs = require("node:fs/promises");
const path = require("node:path");
const { STAT_DEFINITIONS } = require("./profile-stats");
const { getAiAboutSummary } = require("./ai-about");
const { getAiFocusSummary } = require("./ai-focus");

const FEATURED_START_MARKER = "<!--FEATURED_PROJECTS_START-->";
const FEATURED_END_MARKER = "<!--FEATURED_PROJECTS_END-->";
const STACK_START_MARKER = "<!--STACK_DYNAMIC_START-->";
const STACK_END_MARKER = "<!--STACK_DYNAMIC_END-->";
const ABOUT_START_MARKER = "<!--ABOUT_AI_START-->";
const ABOUT_END_MARKER = "<!--ABOUT_AI_END-->";
const FOCUS_START_MARKER = "<!--FOCUS_DYNAMIC_START-->";
const FOCUS_END_MARKER = "<!--FOCUS_DYNAMIC_END-->";
const ADV_STATS_START_MARKER = "<!--ADV_STATS_DYNAMIC_START-->";
const ADV_STATS_END_MARKER = "<!--ADV_STATS_DYNAMIC_END-->";
const ORGS_START_MARKER = "<!--ORGS_DYNAMIC_START-->";
const ORGS_END_MARKER = "<!--ORGS_DYNAMIC_END-->";
const DEFAULT_REMOTE_BASE_URL = "https://omnizap.xyz";
const DEFAULT_LOCAL_ASSET_PREFIX = "./assets";

function toSafeText(value) {
  if (!value) {
    return "-";
  }
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function truncateText(value, maxLen) {
  const text = toSafeText(value);
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
}

function getReadmeAssetMode() {
  return String(process.env.README_ASSET_MODE || "local").trim().toLowerCase();
}

function isLocalAssetMode() {
  return getReadmeAssetMode() !== "remote";
}

function getBadgeBaseUrl() {
  return (process.env.BADGE_BASE_URL || DEFAULT_REMOTE_BASE_URL).replace(/\/$/, "");
}

function getLocalAssetPrefix() {
  return (process.env.BADGE_LOCAL_PREFIX || DEFAULT_LOCAL_ASSET_PREFIX).replace(/\/$/, "");
}

function buildAssetUrl(relativePath) {
  const normalizedPath = String(relativePath || "").replace(/^\/+/, "");
  const baseUrl = isLocalAssetMode() ? getLocalAssetPrefix() : getBadgeBaseUrl();
  return `${baseUrl}/${normalizedPath}`;
}

function formatPtBrUtc(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "data indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date);
}

function buildAboutTextSection(about) {
  const content = String(about?.content || "").trim();
  if (!content) {
    return "_Resumo indisponível no momento._";
  }

  return [content, "", `> _Atualizado em ${formatPtBrUtc(about?.generatedAt)} (UTC)._`].join("\n");
}

function buildFocusTextSection(focus) {
  const bullets = Array.isArray(focus?.bullets)
    ? focus.bullets.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!bullets.length) {
    return "_Foco atual indisponível no momento._";
  }

  const list = bullets.map((item) => `- ${item}`).join("\n");
  return [list, "", `> _Atualizado em ${formatPtBrUtc(focus?.generatedAt)} (UTC)._`].join("\n");
}

function buildStackEmbedSection(summary) {
  const baseUrl = getBadgeBaseUrl();
  const stackItems = Array.isArray(summary?.stackTechnologies) ? summary.stackTechnologies : [];
  const limit = Math.max(6, Math.min(24, Number(process.env.STACK_CURRENT_LIMIT || 14)));
  const topStack = stackItems.slice(0, limit);

  if (!topStack.length) {
    const fallbackImage = `<img src="${buildAssetUrl("stack/current.svg")}" width="100%" alt="Lista dinâmica da stack principal gerada pelo servidor"/>`;
    if (isLocalAssetMode()) {
      return fallbackImage;
    }

    return [`<a href="${baseUrl}/api/stack/current" target="_blank" rel="noopener noreferrer">`, `  ${fallbackImage}`, "</a>"].join("\n");
  }

  const badges = topStack
    .map((item) => {
      const techKey = encodeURIComponent(String(item.badgeKey || item.name || "").trim());
      const techName = toSafeText(item.name || item.badgeKey || "Stack");
      const imageTag = `<img src="${buildAssetUrl(`badges/stack/${techKey}.svg`)}" alt="Badge stack ${techName}"/>`;
      if (isLocalAssetMode()) {
        return imageTag;
      }

      return `<a href="${baseUrl}/api/stack/current" target="_blank" rel="noopener noreferrer">${imageTag}</a>`;
    })
    .join("\n  ");

  return [
    `<p align="center">`,
    `  ${badges}`,
    `</p>`,
    "",
    `<p align="center"><sub>Stack dinâmica baseada nas tecnologias detectadas nos repositórios.</sub></p>`
  ].join("\n");
}

function buildOrganizationsSection(summary) {
  const organizations = Array.isArray(summary?.organizations) ? summary.organizations : [];
  const source = summary?.scan?.organizationsSource === "gh_cli" ? "gh + API" : "GitHub API";

  if (!organizations.length) {
    return [
      "_Sem organizações vinculadas no momento._",
      "",
      `> _Atualizado em ${formatPtBrUtc(new Date().toISOString())} (UTC) | Fonte: ${source}._`
    ].join("\n");
  }

  const lines = [
    "| Organização | Repositórios Públicos | Seguidores | Repos em Destaque |",
    "|---|---:|---:|---|"
  ];

  for (const organization of organizations.slice(0, 8)) {
    const login = toSafeText(organization?.login || "org");
    const displayName = toSafeText(organization?.name || organization?.login || "Organização");
    const orgUrl = String(organization?.htmlUrl || "").trim();
    const orgLabel = orgUrl ? `[${displayName}](${orgUrl})` : displayName;
    const orgCell = displayName.toLowerCase() === login.toLowerCase()
      ? orgLabel
      : `${orgLabel}<br/><sub>@${login}</sub>`;

    const highlightsRaw = Array.isArray(organization?.topRepositories)
      ? organization.topRepositories
      : [];
    const highlights = highlightsRaw
      .slice(0, 3)
      .map((repo) => {
        const repoName = toSafeText(repo?.name || repo?.fullName || "repo");
        const repoUrl = String(repo?.htmlUrl || "").trim();
        if (!repoUrl) {
          return repoName;
        }
        return `[${repoName}](${repoUrl})`;
      })
      .join(", ");

    lines.push(
      `| ${orgCell} | ${Number(organization?.publicRepos || 0)} | ${Number(
        organization?.followers || 0
      )} | ${highlights || "-"} |`
    );
  }

  return [
    lines.join("\n"),
    "",
    `> _Atualizado em ${formatPtBrUtc(new Date().toISOString())} (UTC) | Fonte: ${source}._`
  ].join("\n");
}

function buildAdvancedStatsEmbedSection() {
  const baseUrl = getBadgeBaseUrl();

  return STAT_DEFINITIONS.map((definition, index) => {
    const imageTag = `<img src="${buildAssetUrl(`stats/${definition.key}.svg`)}" width="100%" alt="Card dinâmico da estatística ${toSafeText(definition.title)}"/>`;
    const card = [
      `### ${toSafeText(definition.title)}`,
      "",
      ...(isLocalAssetMode()
        ? [imageTag]
        : [
            `<a href="${baseUrl}/api/stats/${definition.key}" target="_blank" rel="noopener noreferrer">`,
            `  ${imageTag}`,
            "</a>"
          ])
    ];

    if (index < STAT_DEFINITIONS.length - 1) {
      card.push("", buildProjectDivider());
    }

    return card.join("\n");
  }).join("\n\n");
}

function buildProjectBadges(repoName) {
  const encoded = encodeURIComponent(repoName);

  return [
    `![Resumo do Projeto](${buildAssetUrl(`badges/projeto/${encoded}/resumo.svg`)})`,
    `![Atividade](${buildAssetUrl(`badges/projeto/${encoded}/atividade.svg`)})`,
    `![Estrelas](${buildAssetUrl(`badges/projeto/${encoded}/estrelas.svg`)})`,
    `![Atualizado](${buildAssetUrl(`badges/projeto/${encoded}/atualizado.svg`)})`
  ].join(" ");
}

function buildProjectDivider() {
  return [
    `<p align="center">`,
    `  <img src="${buildAssetUrl("banners/divider.svg")}" width="100%" alt="Divisor neon animado gerado pelo servidor"/>`,
    `</p>`
  ].join("\n");
}

function buildFeaturedProjectsTable(summary) {
  const ranked = Array.isArray(summary.projectsByActivity) ? summary.projectsByActivity : [];
  const projects = ranked.slice(0, Math.max(3, Math.min(6, ranked.length)));

  if (!projects.length) {
    return "_Sem projetos públicos para destacar no momento._";
  }

  const lines = [];

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    lines.push(`### Projeto ${index + 1}: [${project.name}](${project.htmlUrl})`);
    lines.push("");
    lines.push(`**Descrição:** ${truncateText(project.description, 160)}`);
    lines.push("");
    lines.push(buildProjectBadges(project.name));
    lines.push("");

    if (index < projects.length - 1) {
      lines.push(buildProjectDivider());
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

function replaceSection(readmeContent, startMarker, endMarker, generatedSection) {
  const start = readmeContent.indexOf(startMarker);
  const end = readmeContent.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    return [
      readmeContent.trimEnd(),
      "",
      startMarker,
      generatedSection,
      endMarker,
      ""
    ].join("\n");
  }

  const head = readmeContent.slice(0, start + startMarker.length);
  const tail = readmeContent.slice(end);
  return `${head}\n${generatedSection}\n${tail}`;
}

async function updateReadmeWithSummary(summary, options = {}) {
  const readmePath = options.readmePath || path.resolve(process.cwd(), "README.md");
  const forceAi = Boolean(options.forceAi);

  const currentReadme = await fs.readFile(readmePath, "utf8");
  const [about, focus] = await Promise.all([
    getAiAboutSummary(summary, { force: forceAi }),
    getAiFocusSummary(summary, { force: forceAi })
  ]);
  const aboutSection = buildAboutTextSection(about);
  const focusSection = buildFocusTextSection(focus);
  const stackSection = buildStackEmbedSection(summary);
  const organizationsSection = buildOrganizationsSection(summary);
  const advancedStatsSection = buildAdvancedStatsEmbedSection();
  const featuredSection = buildFeaturedProjectsTable(summary);
  const withAbout = replaceSection(
    currentReadme,
    ABOUT_START_MARKER,
    ABOUT_END_MARKER,
    aboutSection
  );
  const withStack = replaceSection(
    withAbout,
    FOCUS_START_MARKER,
    FOCUS_END_MARKER,
    focusSection
  );
  const withFocusAndStack = replaceSection(
    withStack,
    STACK_START_MARKER,
    STACK_END_MARKER,
    stackSection
  );
  const withOrganizations = replaceSection(
    withFocusAndStack,
    ORGS_START_MARKER,
    ORGS_END_MARKER,
    organizationsSection
  );
  const withAdvancedStats = replaceSection(
    withOrganizations,
    ADV_STATS_START_MARKER,
    ADV_STATS_END_MARKER,
    advancedStatsSection
  );
  const nextReadme = replaceSection(
    withAdvancedStats,
    FEATURED_START_MARKER,
    FEATURED_END_MARKER,
    featuredSection
  );

  if (nextReadme !== currentReadme) {
    await fs.writeFile(readmePath, nextReadme, "utf8");
    return { changed: true, readmePath, generatedAt: new Date().toISOString() };
  }

  return { changed: false, readmePath, generatedAt: new Date().toISOString() };
}

module.exports = {
  FEATURED_START_MARKER,
  FEATURED_END_MARKER,
  STACK_START_MARKER,
  STACK_END_MARKER,
  ABOUT_START_MARKER,
  ABOUT_END_MARKER,
  FOCUS_START_MARKER,
  FOCUS_END_MARKER,
  ADV_STATS_START_MARKER,
  ADV_STATS_END_MARKER,
  ORGS_START_MARKER,
  ORGS_END_MARKER,
  buildFeaturedProjectsTable,
  buildStackEmbedSection,
  buildOrganizationsSection,
  buildAdvancedStatsEmbedSection,
  updateReadmeWithSummary
};
