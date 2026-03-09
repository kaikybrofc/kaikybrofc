#!/usr/bin/env node

const path = require("node:path");
const dotenv = require("dotenv");

const { fetchProfileSummary } = require("../src/github-profile");
const { updateReadmeWithSummary } = require("../src/readme-sync");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

async function run() {
  const summary = await fetchProfileSummary();
  const result = await updateReadmeWithSummary(summary, {
    readmePath: process.env.README_PATH || path.resolve(process.cwd(), "README.md"),
    generatedAt: new Date().toISOString()
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        changed: result.changed,
        readmePath: result.readmePath,
        login: summary.user.login,
        repositories: summary.totals.ownedRepositories
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
