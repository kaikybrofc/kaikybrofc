const fs = require("node:fs/promises");
const path = require("node:path");
const { STAT_DEFINITIONS } = require("./profile-stats");

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

function getBadgeBaseUrl() {
  return (process.env.BADGE_BASE_URL || "https://omnizap.xyz").replace(/\/$/, "");
}

function buildAboutEmbedSection() {
  const baseUrl = getBadgeBaseUrl();
  return [
    `<a href="${baseUrl}/api/about/summary" target="_blank" rel="noopener noreferrer">`,
    `  <img src="${baseUrl}/about/summary.svg" width="100%" alt="Resumo dinâmico da seção Sobre gerado pelo servidor"/>`,
    "</a>"
  ].join("\n");
}

function buildFocusEmbedSection() {
  const baseUrl = getBadgeBaseUrl();
  return [
    `<a href="${baseUrl}/api/focus/current" target="_blank" rel="noopener noreferrer">`,
    `  <img src="${baseUrl}/focus/current.svg" width="100%" alt="Resumo dinâmico do foco atual baseado nos commits recentes"/>`,
    "</a>"
  ].join("\n");
}

function buildStackEmbedSection(summary) {
  const baseUrl = getBadgeBaseUrl();
  const stackItems = Array.isArray(summary?.stackTechnologies) ? summary.stackTechnologies : [];
  const limit = Math.max(6, Math.min(24, Number(process.env.STACK_CURRENT_LIMIT || 14)));
  const topStack = stackItems.slice(0, limit);

  if (!topStack.length) {
    return [
      `<a href="${baseUrl}/api/stack/current" target="_blank" rel="noopener noreferrer">`,
      `  <img src="${baseUrl}/stack/current.svg" width="100%" alt="Lista dinâmica da stack principal gerada pelo servidor"/>`,
      "</a>"
    ].join("\n");
  }

  const badges = topStack
    .map((item) => {
      const techKey = encodeURIComponent(String(item.badgeKey || item.name || "").trim());
      const techName = toSafeText(item.name || item.badgeKey || "Stack");
      return `<a href="${baseUrl}/api/stack/current" target="_blank" rel="noopener noreferrer"><img src="${baseUrl}/badges/stack/${techKey}.svg" alt="Badge stack ${techName}"/></a>`;
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

function buildAdvancedStatsEmbedSection() {
  const baseUrl = getBadgeBaseUrl();

  return STAT_DEFINITIONS.map((definition, index) => {
    const card = [
      `### ${toSafeText(definition.title)}`,
      "",
      `<a href="${baseUrl}/api/stats/${definition.key}" target="_blank" rel="noopener noreferrer">`,
      `  <img src="${baseUrl}/stats/${definition.key}.svg" width="100%" alt="Card dinâmico da estatística ${toSafeText(definition.title)}"/>`,
      "</a>"
    ];

    if (index < STAT_DEFINITIONS.length - 1) {
      card.push("", buildProjectDivider());
    }

    return card.join("\n");
  }).join("\n\n");
}

function buildProjectBadges(repoName) {
  const baseUrl = getBadgeBaseUrl();
  const encoded = encodeURIComponent(repoName);

  return [
    `![Resumo do Projeto](${baseUrl}/badges/projeto/${encoded}/resumo.svg)`,
    `![Atividade](${baseUrl}/badges/projeto/${encoded}/atividade.svg)`,
    `![Estrelas](${baseUrl}/badges/projeto/${encoded}/estrelas.svg)`,
    `![Atualizado](${baseUrl}/badges/projeto/${encoded}/atualizado.svg)`
  ].join(" ");
}

function buildProjectDivider() {
  const baseUrl = getBadgeBaseUrl();
  return [
    `<p align="center">`,
    `  <img src="${baseUrl}/banners/divider.svg" width="100%" alt="Divisor neon animado gerado pelo servidor"/>`,
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

  const currentReadme = await fs.readFile(readmePath, "utf8");
  const aboutSection = buildAboutEmbedSection();
  const focusSection = buildFocusEmbedSection();
  const stackSection = buildStackEmbedSection(summary);
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
  const withAdvancedStats = replaceSection(
    withFocusAndStack,
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
  buildFeaturedProjectsTable,
  buildStackEmbedSection,
  buildAdvancedStatsEmbedSection,
  updateReadmeWithSummary
};
