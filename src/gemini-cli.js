const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getGeminiCliBin() {
  return String(process.env.GEMINI_CLI_BIN || "gemini").trim() || "gemini";
}

function getGeminiModel() {
  return String(process.env.GEMINI_MODEL || "").trim();
}

function getGeminiTimeoutMs() {
  return Math.max(5000, parseNumber(process.env.GEMINI_CLI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
}

function getGeminiMaxBufferBytes() {
  return Math.max(
    64 * 1024,
    parseNumber(process.env.GEMINI_CLI_MAX_BUFFER_BYTES, DEFAULT_MAX_BUFFER_BYTES)
  );
}

function extractGeminiText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.response === "string" && payload.response.trim()) {
    return payload.response.trim();
  }

  if (typeof payload.output === "string" && payload.output.trim()) {
    return payload.output.trim();
  }

  return "";
}

function detectGeminiModel(payload, explicitModel) {
  if (explicitModel) {
    return explicitModel;
  }

  const models = payload?.stats?.models;
  if (!models || typeof models !== "object") {
    return null;
  }

  const modelNames = Object.keys(models);
  return modelNames[0] || null;
}

function buildGeminiCliErrorMessage(error, bin, timeoutMs) {
  if (error?.code === "ENOENT") {
    return `Gemini CLI nao encontrado (binario: "${bin}"). Instale o Gemini CLI ou ajuste GEMINI_CLI_BIN.`;
  }

  if (error?.killed || /timed out/i.test(String(error?.message || ""))) {
    return `Gemini CLI excedeu o timeout de ${timeoutMs}ms. Ajuste GEMINI_CLI_TIMEOUT_MS se necessario.`;
  }

  const details = String(error?.stderr || error?.stdout || error?.message || "")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = details ? details.slice(0, 320) : "erro desconhecido";
  return `Gemini CLI falhou: ${snippet}`;
}

async function runGeminiCliPrompt(prompt, options = {}) {
  const content = String(prompt || "").trim();
  if (!content) {
    throw new Error("Prompt vazio para Gemini CLI.");
  }

  const bin = getGeminiCliBin();
  const explicitModel = String(options.model || getGeminiModel()).trim();
  const timeoutMs = Math.max(5000, parseNumber(options.timeoutMs, getGeminiTimeoutMs()));
  const maxBuffer = getGeminiMaxBufferBytes();
  const args = ["-p", content, "-o", "json"];

  if (explicitModel) {
    args.push("-m", explicitModel);
  }

  let stdout = "";
  let payload = null;

  try {
    const result = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer
    });
    stdout = String(result.stdout || "").trim();
  } catch (error) {
    throw new Error(buildGeminiCliErrorMessage(error, bin, timeoutMs));
  }

  if (!stdout) {
    throw new Error("Gemini CLI nao retornou conteudo no stdout.");
  }

  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error(`Gemini CLI retornou JSON invalido: ${stdout.slice(0, 280)}`);
  }

  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini CLI retornou resposta vazia.");
  }

  return {
    text,
    model: detectGeminiModel(payload, explicitModel)
  };
}

module.exports = {
  runGeminiCliPrompt
};
