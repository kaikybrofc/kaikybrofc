const fs = require("node:fs/promises");
const path = require("node:path");

const START_MARKER = "<!--PROFILE_DYNAMIC_START-->";
const END_MARKER = "<!--PROFILE_DYNAMIC_END-->";

function formatIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function toSafeText(value) {
  if (!value) {
    return "-";
  }
  return String(value).replace(/\r?\n/g, " ").trim();
}

function buildRepoTable(repos) {
  if (!repos.length) {
    return "_Nenhum repositorio encontrado._";
  }

  const lines = [
    "| Repo | Stars | Language | Updated |",
    "| --- | ---: | --- | --- |"
  ];

  for (const repo of repos) {
    lines.push(
      `| [${repo.name}](${repo.htmlUrl}) | ${repo.stars} | ${toSafeText(repo.language)} | ${formatIsoDate(repo.updatedAt)} |`
    );
  }

  return lines.join("\n");
}

function buildLanguageLine(languages) {
  if (!languages.length) {
    return "_Sem dados de linguagem._";
  }

  return languages
    .slice(0, 6)
    .map((language) => `${language.language}: ${language.repositories} repos (${language.percentage}%)`)
    .join(" | ");
}

function buildActivityList(activity) {
  if (!activity.length) {
    return "- Nenhuma atividade publica recente encontrada.";
  }

  return activity
    .slice(0, 6)
    .map((event) => `- ${event.type} em \`${event.repo}\` (${formatIsoDate(event.createdAt)})`)
    .join("\n");
}

function buildDynamicSection(summary, generatedAt) {
  const { user, totals, topRepositories, languages, recentActivity } = summary;

  return [
    "## Snapshot Dinamico do GitHub",
    "",
    `Atualizado em: **${formatIsoDate(generatedAt)}**`,
    "",
    `- Perfil: [${user.name}](${user.htmlUrl}) (@${user.login})`,
    `- Bio: ${toSafeText(user.bio)}`,
    `- Seguidores: ${user.followers} | Seguindo: ${user.following}`,
    `- Repositorios: ${totals.ownedRepositories} (publicos: ${totals.publicRepositories}, privados: ${totals.privateRepositories})`,
    `- Stars totais: ${totals.stars} | Forks totais: ${totals.forks} | Open issues: ${totals.openIssues}`,
    "",
    "**Top linguagens (repos):**",
    "",
    buildLanguageLine(languages),
    "",
    "**Top repositorios por stars:**",
    "",
    buildRepoTable(topRepositories),
    "",
    "**Atividade publica recente:**",
    "",
    buildActivityList(recentActivity),
    "",
    "<!--DYNAMIC_GENERATED_BY: perfil-server -->"
  ].join("\n");
}

function replaceDynamicSection(readmeContent, generatedSection) {
  const start = readmeContent.indexOf(START_MARKER);
  const end = readmeContent.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    return [
      readmeContent.trimEnd(),
      "",
      START_MARKER,
      generatedSection,
      END_MARKER,
      ""
    ].join("\n");
  }

  const head = readmeContent.slice(0, start + START_MARKER.length);
  const tail = readmeContent.slice(end);
  return `${head}\n${generatedSection}\n${tail}`;
}

async function updateReadmeWithSummary(summary, options = {}) {
  const readmePath = options.readmePath || path.resolve(process.cwd(), "README.md");
  const generatedAt = options.generatedAt || new Date().toISOString();

  const currentReadme = await fs.readFile(readmePath, "utf8");
  const generatedSection = buildDynamicSection(summary, generatedAt);
  const nextReadme = replaceDynamicSection(currentReadme, generatedSection);

  if (nextReadme !== currentReadme) {
    await fs.writeFile(readmePath, nextReadme, "utf8");
    return { changed: true, readmePath, generatedAt };
  }

  return { changed: false, readmePath, generatedAt };
}

module.exports = {
  START_MARKER,
  END_MARKER,
  buildDynamicSection,
  updateReadmeWithSummary
};
