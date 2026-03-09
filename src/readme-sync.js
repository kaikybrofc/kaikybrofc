const fs = require("node:fs/promises");
const path = require("node:path");
const { getAiAboutSection } = require("./ai-about");

const FEATURED_START_MARKER = "<!--FEATURED_PROJECTS_START-->";
const FEATURED_END_MARKER = "<!--FEATURED_PROJECTS_END-->";
const STACK_START_MARKER = "<!--STACK_DYNAMIC_START-->";
const STACK_END_MARKER = "<!--STACK_DYNAMIC_END-->";
const ABOUT_START_MARKER = "<!--ABOUT_AI_START-->";
const ABOUT_END_MARKER = "<!--ABOUT_AI_END-->";

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

function toHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getBadgeBaseUrl() {
  return (process.env.BADGE_BASE_URL || "https://omnizap.xyz").replace(/\/$/, "");
}

function buildProjectBadges(repoName) {
  const baseUrl = getBadgeBaseUrl();
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

function buildStackBadges(summary) {
  const baseUrl = getBadgeBaseUrl();
  const stack = Array.isArray(summary?.stackTechnologies) ? summary.stackTechnologies : [];

  if (!stack.length) {
    return "_Stack principal ainda indisponivel. Execute a sincronizacao para gerar os badges dinamicos._";
  }

  const lines = ["<p>"];
  for (const tech of stack) {
    const key = String(tech?.badgeKey || "").trim();
    if (!key) {
      continue;
    }

    const name = toSafeText(tech?.name || key);
    lines.push(
      `  <img src="${baseUrl}/badges/stack/${encodeURIComponent(key)}.svg" alt="${toHtmlAttribute(name)}"/>`
    );
  }
  lines.push("</p>");

  if (lines.length === 2) {
    return "_Stack principal ainda indisponivel. Execute a sincronizacao para gerar os badges dinamicos._";
  }

  return lines.join("\n");
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
  const aboutResult = await getAiAboutSection(summary, { force: options.forceAi });
  const aboutSection = aboutResult.sectionText;
  const stackSection = buildStackBadges(summary);
  const featuredSection = buildFeaturedProjectsTable(summary);
  const withAbout = replaceSection(
    currentReadme,
    ABOUT_START_MARKER,
    ABOUT_END_MARKER,
    aboutSection
  );
  const withStack = replaceSection(
    withAbout,
    STACK_START_MARKER,
    STACK_END_MARKER,
    stackSection
  );
  const nextReadme = replaceSection(
    withStack,
    FEATURED_START_MARKER,
    FEATURED_END_MARKER,
    featuredSection
  );

  if (nextReadme !== currentReadme) {
    await fs.writeFile(readmePath, nextReadme, "utf8");
    return {
      changed: true,
      readmePath,
      generatedAt: new Date().toISOString(),
      about: {
        source: aboutResult.source,
        generatedAt: aboutResult.generatedAt,
        model: aboutResult.model || null,
        error: aboutResult.error || null
      }
    };
  }

  return {
    changed: false,
    readmePath,
    generatedAt: new Date().toISOString(),
    about: {
      source: aboutResult.source,
      generatedAt: aboutResult.generatedAt,
      model: aboutResult.model || null,
      error: aboutResult.error || null
    }
  };
}

module.exports = {
  FEATURED_START_MARKER,
  FEATURED_END_MARKER,
  STACK_START_MARKER,
  STACK_END_MARKER,
  ABOUT_START_MARKER,
  ABOUT_END_MARKER,
  buildFeaturedProjectsTable,
  buildStackBadges,
  updateReadmeWithSummary
};
