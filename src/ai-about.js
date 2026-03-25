const fs = require("node:fs/promises");
const path = require("node:path");
const { runGeminiCliPrompt } = require("./gemini-cli");

const DEFAULT_REFRESH_HOURS = 1;
const DEFAULT_MAX_OUTPUT_TOKENS = 220;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRefreshHours() {
  return Math.max(1, parseNumber(process.env.AI_ABOUT_REFRESH_HOURS, DEFAULT_REFRESH_HOURS));
}

function getCachePath() {
  return process.env.AI_ABOUT_CACHE_PATH || path.resolve(process.cwd(), ".cache/ai-about.json");
}

async function readCache(cachePath) {
  try {
    const content = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.content || !parsed.generatedAt) {
      return null;
    }

    return {
      content: String(parsed.content),
      generatedAt: String(parsed.generatedAt),
      model: parsed.model ? String(parsed.model) : null
    };
  } catch {
    return null;
  }
}

async function writeCache(cachePath, data) {
  const payload = {
    content: String(data.content || ""),
    generatedAt: String(data.generatedAt || new Date().toISOString()),
    model: data.model ? String(data.model) : null
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

function formatList(items, limit) {
  return items
    .slice(0, limit)
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join(", ");
}

function buildInput(summary) {
  const topLanguages = formatList(
    (summary.languages || []).map((item) => `${item.language} (${item.repositories} repos)`),
    5
  );
  const topStacks = formatList(
    (summary.stackTechnologies || []).map(
      (item) => `${item.name} (score ${item.score}, ${item.repositories} repos)`
    ),
    8
  );
  const organizations = formatList(
    (summary.organizations || []).map(
      (org) => `${org.name || org.login || "org"} (${org.publicRepos || 0} repos)`
    ),
    5
  );
  const projects = (summary.projectsByActivity || []).slice(0, 3).map((repo, index) => {
    return `${index + 1}. ${repo.name} | linguagem ${repo.language || "N/A"} | eventos ${repo.activity?.events || 0} | score ${repo.activity?.score || 0}`;
  });

  return [
    `Perfil: ${summary.user?.name || summary.user?.login || "N/A"} (@${summary.user?.login || "N/A"})`,
    `Bio atual: ${summary.user?.bio || "sem bio"}`,
    `Seguidores: ${summary.user?.followers || 0}`,
    `Repositórios públicos: ${summary.totals?.publicRepositories || 0}`,
    `Stars totais: ${summary.totals?.stars || 0}`,
    `Organizações: ${organizations || "sem dados"}`,
    `Linguagens dominantes: ${topLanguages || "sem dados"}`,
    `Stack principal detectada: ${topStacks || "sem dados"}`,
    "Projetos mais ativos:",
    ...(projects.length ? projects : ["- sem dados de atividade"])
  ].join("\n");
}

function normalizeAboutText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFallbackAbout(summary) {
  const displayName = summary.user?.name || summary.user?.login || "Desenvolvedor";
  const stack = (summary.stackTechnologies || [])
    .slice(0, 5)
    .map((item) => item.name)
    .filter(Boolean)
    .join(", ");
  const project = summary.projectsByActivity?.[0];

  const firstSentence = `${displayName} atua com foco em desenvolvimento Full-Stack, automações e integrações, transformando necessidades operacionais em soluções práticas e estáveis.`;
  const secondSentence = stack
    ? `A base técnica mais recorrente inclui ${stack}.`
    : "A base técnica está em evolução contínua conforme os projetos mais recentes.";
  const thirdSentence = project
    ? `No momento, ${project.name} aparece entre os projetos com maior atividade no GitHub.`
    : "";

  return [firstSentence, secondSentence, thirdSentence].filter(Boolean).join(" ");
}

async function generateAboutWithGeminiCli(summary) {
  const maxOutputTokens = Math.max(
    80,
    parseNumber(process.env.AI_ABOUT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)
  );
  const prompt = [
    "Voce escreve descricoes de perfil em portugues do Brasil para README tecnico.",
    "Com base nos dados abaixo, escreva exatamente 1 paragrafo com 3 frases.",
    "Regras: tom profissional, objetivo, sem exageros, sem emoji, sem markdown extra, sem listas.",
    `Limite de tamanho: aproximadamente ${maxOutputTokens} tokens.`,
    "",
    "Dados coletados da API do GitHub:",
    buildInput(summary)
  ].join("\n");

  const generated = await runGeminiCliPrompt(prompt);
  const content = normalizeAboutText(generated.text);
  if (!content) {
    throw new Error("Gemini CLI retornou resposta vazia para o resumo da secao Sobre.");
  }

  return {
    content,
    model: generated.model || null
  };
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

function buildAboutSectionText(content, generatedAt) {
  const refreshHours = getRefreshHours();
  return [
    normalizeAboutText(content),
    "",
    `> _Resumo gerado por IA em ${formatPtBrUtc(generatedAt)} (UTC), com atualização a cada ${refreshHours}h._`
  ].join("\n");
}

async function getAiAboutSummary(summary, options = {}) {
  const force = Boolean(options.force);
  const refreshHours = getRefreshHours();
  const cachePath = getCachePath();
  const cache = await readCache(cachePath);
  const cacheStillValid = cache && !isExpired(cache.generatedAt, refreshHours);

  if (!force && cacheStillValid) {
    return {
      content: normalizeAboutText(cache.content),
      source: "cache",
      generatedAt: cache.generatedAt,
      model: cache.model || null
    };
  }

  try {
    const generated = await generateAboutWithGeminiCli(summary);
    const generatedAt = new Date().toISOString();
    await writeCache(cachePath, {
      content: generated.content,
      generatedAt,
      model: generated.model
    });

    return {
      content: normalizeAboutText(generated.content),
      source: "gemini_cli",
      generatedAt,
      model: generated.model || null
    };
  } catch (error) {
    if (cache && cache.content) {
      return {
        content: normalizeAboutText(cache.content),
        source: "cache_stale",
        generatedAt: cache.generatedAt,
        model: cache.model || null,
        error: error.message
      };
    }

    const fallbackContent = buildFallbackAbout(summary);
    const generatedAt = new Date().toISOString();
    return {
      content: normalizeAboutText(fallbackContent),
      source: "fallback",
      generatedAt,
      model: null,
      error: error.message
    };
  }
}

async function getAiAboutSection(summary, options = {}) {
  const result = await getAiAboutSummary(summary, options);
  return {
    ...result,
    sectionText: buildAboutSectionText(result.content, result.generatedAt)
  };
}

module.exports = {
  getAiAboutSummary,
  getAiAboutSection
};
