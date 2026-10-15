const { execFileSync } = require("node:child_process");

let cachedToken;

function getGithubToken() {
  if (cachedToken !== undefined) {
    return cachedToken;
  }

  const configuredToken = [
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_PUSH_TOKEN
  ]
    .map((token) => String(token || "").trim())
    .find((token) => token && !/your.*token|choose.*strong.*key/i.test(token));

  if (configuredToken) {
    cachedToken = configuredToken;
    return cachedToken;
  }

  try {
    cachedToken = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    }).trim();
  } catch {
    cachedToken = "";
  }

  return cachedToken;
}

module.exports = { getGithubToken };