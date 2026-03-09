#!/usr/bin/env node

const path = require("node:path");
const { spawn } = require("node:child_process");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

function runCommand(command, args, options = {}) {
  const capture = Boolean(options.capture);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = Number.isInteger(code) ? code : 1;
      const result = { code: exitCode, stdout, stderr };

      if (exitCode === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      const details = stderr.trim() || stdout.trim();
      const displayArgs = Array.isArray(options.displayArgs) ? options.displayArgs : args;
      reject(
        new Error(`${command} ${displayArgs.join(" ")} falhou (${exitCode}). ${details}`.trim())
      );
    });
  });
}

function getGitPushToken() {
  return String(process.env.GITHUB_PUSH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
}

function isGithubHttpsRemote(remoteUrl) {
  return /^https:\/\/github\.com\//i.test(String(remoteUrl || "").trim());
}

function buildPushCommand(remote, branch, remoteUrl, token) {
  if (!token || !isGithubHttpsRemote(remoteUrl)) {
    return {
      args: ["push", remote, branch],
      displayArgs: ["push", remote, branch],
      authMode: "default"
    };
  }

  const basicAuth = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    args: [
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicAuth}`,
      "push",
      remote,
      branch
    ],
    displayArgs: [
      "-c",
      "http.https://github.com/.extraheader=AUTHORIZATION: basic ***",
      "push",
      remote,
      branch
    ],
    authMode: "token_env"
  };
}

async function run() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    README_ASSET_MODE: process.env.README_ASSET_MODE || "local",
    BADGE_LOCAL_PREFIX: process.env.BADGE_LOCAL_PREFIX || "./assets"
  };

  await runCommand(process.execPath, [path.resolve(process.cwd(), "scripts/render-assets.js")], { env });
  await runCommand(process.execPath, [path.resolve(process.cwd(), "scripts/update-readme.js")], { env });

  const statusResult = await runCommand(
    "git",
    ["status", "--porcelain", "--", "README.md", "assets"],
    { capture: true }
  );

  const changedEntries = statusResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!changedEntries.length) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          changed: false,
          message: "Sem alteracoes em README.md/assets para publicar."
        },
        null,
        2
      )
    );
    return;
  }

  const dryRun = (process.env.AUTO_PUBLISH_DRY_RUN || "false").toLowerCase() === "true";
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          changed: true,
          dryRun: true,
          pending: changedEntries
        },
        null,
        2
      )
    );
    return;
  }

  await runCommand("git", ["add", "--", "README.md", "assets"], { env });

  const commitMessage =
    String(process.env.AUTO_COMMIT_MESSAGE || "").trim() ||
    `chore: atualizar assets SVG (${new Date().toISOString()})`;

  const commitResult = await runCommand(
    "git",
    ["commit", "--only", "-m", commitMessage, "--", "README.md", "assets"],
    { capture: true, allowFailure: true, env }
  );

  if (commitResult.code !== 0) {
    const output = `${commitResult.stdout}\n${commitResult.stderr}`.trim();
    if (/nothing to commit|no changes added/i.test(output)) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            changed: false,
            message: "Nada para commitar apos git add."
          },
          null,
          2
        )
      );
      return;
    }

    throw new Error(`git commit falhou: ${output}`);
  }

  const branch =
    String(process.env.AUTO_PUSH_BRANCH || "").trim() ||
    (await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true })).stdout.trim();

  if (!branch || branch === "HEAD") {
    throw new Error("Nao foi possivel identificar branch atual para push.");
  }

  const autoPushEnabled = (process.env.AUTO_PUSH_ENABLED || "true").toLowerCase() === "true";
  if (!autoPushEnabled) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          changed: true,
          branch,
          remote: null,
          push: "skipped"
        },
        null,
        2
      )
    );
    return;
  }

  const remote = String(process.env.AUTO_PUSH_REMOTE || "origin").trim() || "origin";
  const remoteUrl = (
    await runCommand("git", ["remote", "get-url", remote], { capture: true, env })
  ).stdout.trim();
  const pushToken = getGitPushToken();
  if (isGithubHttpsRemote(remoteUrl) && !pushToken) {
    throw new Error(
      "Remote HTTPS do GitHub detectado sem token. Defina GITHUB_PUSH_TOKEN ou GITHUB_TOKEN no ambiente."
    );
  }

  const pushCommand = buildPushCommand(remote, branch, remoteUrl, pushToken);
  await runCommand("git", pushCommand.args, {
    env,
    displayArgs: pushCommand.displayArgs
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        changed: true,
        branch,
        remote,
        authMode: pushCommand.authMode
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
