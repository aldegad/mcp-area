#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const distEntry = path.join(__dirname, "dist", "index.js");

if (!fs.existsSync(distEntry)) {
  const yarnCmd = process.platform === "win32" ? "yarn.cmd" : "yarn";
  const workspaceRoot = path.resolve(__dirname, "..", "..");
  const build = spawnSync(
    yarnCmd,
    ["workspace", "@mcp-arena/mcp-bridge", "build"],
    { cwd: workspaceRoot, stdio: "inherit" }
  );

  if (build.status !== 0 || !fs.existsSync(distEntry)) {
    process.exit(build.status ?? 1);
  }
}

require(distEntry);
