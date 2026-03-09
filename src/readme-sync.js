const fs = require("node:fs/promises");
const path = require("node:path");

const FEATURED_START_MARKER = "<!--FEATURED_PROJECTS_START-->";
const FEATURED_END_MARKER = "<!--FEATURED_PROJECTS_END-->";

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

function buildProjectBadges(repoName) {
  const baseUrl = (process.env.BADGE_BASE_URL || "https://omnizap.xyz").replace(/\/$/, "");
  const encoded = encodeURIComponent(repoName);

  return [
    `![Atividade](${baseUrl}/badges/projeto/${encoded}/atividade.svg)`,
    `![Estrelas](${baseUrl}/badges/projeto/${encoded}/estrelas.svg)`,
    `![Atualizado](${baseUrl}/badges/projeto/${encoded}/atualizado.svg)`
  ].join(" ");
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
    lines.push(`### ${index + 1}. [${project.name}](${project.htmlUrl})`);
    lines.push("");
    lines.push(`**Descrição:** ${truncateText(project.description, 160)}`);
    lines.push("");
    lines.push(`**Tecnologias:** ${toSafeText(project.language)}`);
    lines.push("");
    lines.push(buildProjectBadges(project.name));
    lines.push("");
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
  const featuredSection = buildFeaturedProjectsTable(summary);
  const nextReadme = replaceSection(
    currentReadme,
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
  buildFeaturedProjectsTable,
  updateReadmeWithSummary
};
