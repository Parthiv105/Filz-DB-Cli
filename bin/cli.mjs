#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.execArgv.some((a) => a.includes("tsx"))) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" }
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
} else {
  const { runCli } = await import("../dist/cli.js");
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
