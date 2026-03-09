const fs = require("node:fs/promises");
const path = require("node:path");

const FEATURED_START_MARKER = "<!--FEATURED_PROJECTS_START-->";
const FEATURED_END_MARKER = "<!--FEATURED_PROJECTS_END-->";
const STACK_START_MARKER = "<!--STACK_DYNAMIC_START-->";
const STACK_END_MARKER = "<!--STACK_DYNAMIC_END-->";
const ABOUT_START_MARKER = "<!--ABOUT_AI_START-->";
const ABOUT_END_MARKER = "<!--ABOUT_AI_END-->";
const FOCUS_START_MARKER = "<!--FOCUS_DYNAMIC_START-->";
const FOCUS_END_MARKER = "<!--FOCUS_DYNAMIC_END-->";

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

function buildStackEmbedSection() {
  const baseUrl = getBadgeBaseUrl();
  return [
    `<a href="${baseUrl}/api/stack/current" target="_blank" rel="noopener noreferrer">`,
    `  <img src="${baseUrl}/stack/current.svg" width="100%" alt="Lista dinâmica da stack principal gerada pelo servidor"/>`,
    "</a>"
  ].join("\n");
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
  const stackSection = buildStackEmbedSection();
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
  const nextReadme = replaceSection(
    withFocusAndStack,
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
  buildFeaturedProjectsTable,
  buildStackEmbedSection,
  updateReadmeWithSummary
};
