#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

// Prevent recursive execution if npm invokes lifecycle hooks
if (process.env.SMART_PUBLISH_ACTIVE === "1") {
  process.exit(0);
}

function parseSemver(v) {
  const match = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (!p1 || !p2) return 0;
  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;
  return 0;
}

function bumpPatch(v) {
  const p = parseSemver(v);
  if (!p) return v;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

function getPublishedVersion(packageName) {
  try {
    const raw = execSync(`npm view ${packageName} version --json`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    }).trim();
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // If not published yet or network query failed
  }
  return null;
}

function checkNpmLogin() {
  try {
    const whoami = execSync("npm whoami", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000,
    }).trim();
    return whoami || null;
  } catch {
    return null;
  }
}

function isGitDirty() {
  try {
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  p.intro(pc.bgMagenta(pc.black(" Smart Publish & Release Automation ")));

  const cwd = process.cwd();
  const pkgPath = path.resolve(cwd, "package.json");
  const pkgLockPath = path.resolve(cwd, "package-lock.json");

  if (!fs.existsSync(pkgPath)) {
    p.log.error("package.json not found in current directory!");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const localVersion = pkg.version || "1.0.0";
  const packageName = pkg.name;

  // 1. Verify NPM Login with interactive fallback
  const loginSpinner = p.spinner();
  loginSpinner.start("Checking npm authentication...");

  let npmUser = checkNpmLogin();

  if (!npmUser) {
    loginSpinner.stop(pc.yellow("Not logged into npm."));

    p.log.warn(
      pc.yellow("You must be logged in to npm to publish packages.")
    );

    const shouldLogin = await p.confirm({
      message: "Would you like to run 'npm login' now?",
      initialValue: true,
    });

    if (p.isCancel(shouldLogin) || !shouldLogin) {
      p.cancel("Publish cancelled. Please run 'npm login' before publishing.");
      process.exit(0);
    }

    p.log.info("Starting npm login in your terminal...");
    const loginResult = spawnSync("npm", ["login"], {
      stdio: "inherit",
      shell: true,
    });

    if (loginResult.status !== 0) {
      p.log.error("npm login failed or was cancelled.");
      process.exit(1);
    }

    npmUser = checkNpmLogin();
    if (!npmUser) {
      p.log.error(
        "Could not verify npm authentication. Please log in manually and retry."
      );
      process.exit(1);
    }
  }

  loginSpinner.stop(`Authenticated as npm user: ${pc.cyan(pc.bold(npmUser))}`);

  // 2. Smart Version Detection (Prevents multi-version jumping if previous publish failed)
  const verSpinner = p.spinner();
  verSpinner.start("Checking npm registry for published version...");

  const publishedVersion = getPublishedVersion(packageName);
  let targetVersion = localVersion;

  if (publishedVersion) {
    const comp = compareSemver(localVersion, publishedVersion);

    if (comp > 0) {
      // Local version is ALREADY higher than published version
      // (This happens if a previous publish failed after bumping local version!)
      targetVersion = localVersion;
      verSpinner.stop(
        `Registry is at ${pc.dim(publishedVersion)}. Resuming publish for unreleased local version: ${pc.yellow(pc.bold(targetVersion))} (skipping redundant bump)`
      );
    } else if (comp === 0) {
      // Local matches published: normal bump required
      targetVersion = bumpPatch(localVersion);
      verSpinner.stop(
        `Registry matches local (${pc.dim(publishedVersion)}). Bumping to next patch: ${pc.green(pc.bold(targetVersion))}`
      );
    } else {
      // Local is behind published version
      targetVersion = bumpPatch(publishedVersion);
      verSpinner.stop(
        `Local (${pc.dim(localVersion)}) was behind registry (${pc.dim(publishedVersion)}). Bumping to: ${pc.green(pc.bold(targetVersion))}`
      );
    }
  } else {
    verSpinner.stop(
      `Package not yet published on npm registry. Using version: ${pc.green(pc.bold(targetVersion))}`
    );
  }

  // Update package.json and package-lock.json if version changed
  if (pkg.version !== targetVersion) {
    pkg.version = targetVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    if (fs.existsSync(pkgLockPath)) {
      try {
        const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, "utf-8"));
        pkgLock.version = targetVersion;
        if (pkgLock.packages && pkgLock.packages[""]) {
          pkgLock.packages[""].version = targetVersion;
        }
        fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + "\n");
      } catch {
        // ignore lockfile parse error
      }
    }
    p.log.success(`Updated package.json version -> ${pc.cyan(targetVersion)}`);
  }

  // 3. Build step
  const buildSpinner = p.spinner();
  buildSpinner.start("Compiling TypeScript distribution (npm run build)...");

  try {
    execSync("npm run build", { stdio: "pipe" });
    buildSpinner.stop("Build succeeded! Distribution ready.");
  } catch (err) {
    buildSpinner.stop(pc.red("Build failed. Aborting publish."));
    const errorOutput = err?.stdout?.toString() || err?.stderr?.toString() || String(err);
    console.error(errorOutput);
    process.exit(1);
  }

  // 4. Git Auto-Committing of all working files
  const dirty = isGitDirty();
  if (dirty) {
    const gitSpinner = p.spinner();
    gitSpinner.start("Staging and committing all files via git...");
    try {
      execSync("git add -A", { stdio: "pipe" });
      execSync(`git commit -m "chore(release): v${targetVersion}"`, {
        stdio: "pipe",
      });
      gitSpinner.stop(
        `Committed all working files: ${pc.dim(`"chore(release): v${targetVersion}"`)}`
      );
    } catch (err) {
      gitSpinner.stop(pc.yellow("Git commit skipped or already committed."));
    }
  } else {
    p.log.info(pc.dim("Git working tree clean."));
  }

  // 5. Publish to npm
  p.log.step(`Publishing ${pc.bold(`${packageName}@${targetVersion}`)} to npm...`);

  let publishResult = spawnSync("npm", ["publish", "--access", "public"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, SMART_PUBLISH_ACTIVE: "1" },
  });

  // If publish failed (e.g. requires OTP or interactive 2FA prompt), ask user for OTP
  if (publishResult.status !== 0) {
    p.log.warn(
      pc.yellow("Publish failed or requires a One-Time Password (2FA / OTP).")
    );
    const otp = await p.text({
      message: "Enter your 6-digit npm 2FA / OTP code (or leave blank to cancel):",
      placeholder: "123456",
    });

    if (p.isCancel(otp) || !otp || !otp.trim()) {
      p.cancel("Publish aborted.");
      process.exit(1);
    }

    p.log.step(pc.cyan("Retrying npm publish with provided OTP code..."));
    publishResult = spawnSync(
      "npm",
      ["publish", "--access", "public", `--otp=${otp.trim()}`],
      {
        stdio: "inherit",
        shell: true,
        env: { ...process.env, SMART_PUBLISH_ACTIVE: "1" },
      }
    );
  }

  if (publishResult.status !== 0) {
    p.log.error(pc.red(`npm publish failed with exit code ${publishResult.status}.`));
    p.note(
      "If the version already exists on npm, bump package.json version or check your npm permissions.\nYou can also run manually: npm publish --access public --otp=YOUR_CODE",
      "Troubleshooting"
    );
    process.exit(1);
  }

  p.log.success(
    pc.green(`Published ${pc.bold(`${packageName}@${targetVersion}`)} to npm!`)
  );

  // 6. Git Tag & Push
  try {
    const tag = `v${targetVersion}`;
    const existingTags = execSync("git tag -l " + tag, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!existingTags) {
      execSync(`git tag ${tag}`, { stdio: "pipe" });
    }

    const remotes = execSync("git remote", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (remotes) {
      const pushSpinner = p.spinner();
      pushSpinner.start("Pushing commits and tags to remote GitHub repository...");
      try {
        execSync("git push && git push --tags", { stdio: "pipe" });
        pushSpinner.stop("Pushed commits and release tags to GitHub!");
      } catch {
        pushSpinner.stop(
          pc.yellow("Git push skipped (network unavailable or no push permission).")
        );
      }
    }
  } catch {
    // Non-fatal if git tag/push fails
  }

  p.outro(
    pc.green(
      pc.bold(
        `Success! ${packageName}@${targetVersion} is now live and published on npm!`
      )
    )
  );
}

main().catch((err) => {
  p.log.error(pc.red(`Publish script error: ${err.message || err}`));
  process.exit(1);
});

