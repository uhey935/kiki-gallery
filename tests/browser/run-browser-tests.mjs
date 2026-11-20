import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const sourceRoot = process.cwd();
const sandboxRoot = await mkdtemp(path.join(tmpdir(), "kiki-browser-"));
const repositoryRoot = path.join(sandboxRoot, "repository");
const remoteRoot = path.join(sandboxRoot, "remote.git");
const port = await new Promise((resolve, reject) => {
  const listener = createServer();
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    if (!address || typeof address === "string") {
      listener.close();
      reject(new Error("Failed to allocate an isolated Editor port"));
      return;
    }
    listener.close((error) =>
      error ? reject(error) : resolve(String(address.port)),
    );
  });
});
let server;
let activeCommand;
const interruption = new AbortController();
const onInterrupt = () => interrupt("SIGINT", 130);
const onTerminate = () => interrupt("SIGTERM", 143);
function interrupt(signal, exitCode) {
  process.exitCode = exitCode;
  interruption.abort(new Error(`Browser test runner interrupted by ${signal}`));
}
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

// Async children let signal handlers reach finally even during Playwright.
async function run(command, args, options = {}) {
  interruption.signal.throwIfAborted();
  activeCommand = spawn(command, args, { stdio: "inherit", ...options });
  const [code, signal] = await once(activeCommand, "close", {
    signal: interruption.signal,
  });
  activeCommand = undefined;
  if (code !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${signal ?? code})`);
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const stopped = once(child, "close");
  for (const [signal, timeout] of [
    ["SIGTERM", 10_000],
    ["SIGKILL", 5_000],
  ]) {
    child.kill(signal);
    let timer;
    try {
      const exited = await Promise.race([
        stopped.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeout);
        }),
      ]);
      if (exited) return;
    } finally {
      clearTimeout(timer);
    }
    console.error(`Timed out stopping test child ${child.pid} with ${signal}`);
    process.exitCode ||= 1;
  }
  throw new Error(
    `Test child ${child.pid} did not stop; preserving ${sandboxRoot}`,
  );
}

function materializeWorkingTree() {
  const patch = spawnSync("git", ["diff", "--binary", "HEAD"], { cwd: sourceRoot, encoding: "buffer" });
  if (patch.status !== 0) throw new Error("Failed to capture browser-test working tree patch");
  if (patch.stdout.length) {
    const applied = spawnSync("git", ["apply", "--binary"], { cwd: repositoryRoot, input: patch.stdout, stdio: ["pipe", "inherit", "inherit"] });
    if (applied.status !== 0) throw new Error("Failed to apply browser-test working tree patch");
  }
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: sourceRoot, encoding: "utf8" });
  if (untracked.status !== 0) throw new Error("Failed to inventory browser-test untracked files");
  return untracked.stdout.split("\0").filter(Boolean);
}

async function closeBrowserFixtureReferenceGraph(directory) {
  let changed = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      changed += await closeBrowserFixtureReferenceGraph(file);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const source = await readFile(file, "utf8");
    const normalized = source.replace(
      /<\/?(?:figure|figcaption)(?:\s[^>]*)?>/g,
      "",
    );
    if (normalized !== source) {
      await writeFile(file, normalized);
      changed += 1;
    }
  }
  return changed;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    interruption.signal.throwIfAborted();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/editor/`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated Editor server");
}

try {
  await run("git", ["clone", "--no-hardlinks", sourceRoot, repositoryRoot]);
  for (const relative of materializeWorkingTree()) {
    const destination = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(sourceRoot, relative), destination, { recursive: true });
  }
  const normalizedFixtureFiles = await closeBrowserFixtureReferenceGraph(
    path.join(repositoryRoot, "src/content"),
  );
  if (normalizedFixtureFiles > 0) {
    await run("git", ["add", "src/content"], { cwd: repositoryRoot });
    await run(
      "git",
      ["commit", "-m", "test: close browser fixture references"],
      {
        cwd: repositoryRoot,
      },
    );
  }
  await run("git", ["init", "--bare", remoteRoot]);
  await run("git", ["remote", "set-url", "origin", remoteRoot], {
    cwd: repositoryRoot,
  });
  await run("git", ["push", "-u", "origin", "main"], { cwd: repositoryRoot });
  await symlink(
    path.join(sourceRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );

  interruption.signal.throwIfAborted();
  server = spawn(
    process.execPath,
    [
      path.join(sourceRoot, "node_modules/astro/bin/astro.mjs"),
      "dev",
      "--ignore-lock",
      "--host",
      "127.0.0.1",
      "--port",
      port,
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  console.log(
    `Owned test server pid=${server.pid} port=${port} root=${sandboxRoot}`,
  );
  await waitForServer();

  await run(
    process.execPath,
    [
      path.join(sourceRoot, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      path.join(sourceRoot, "playwright.config.ts"),
      ...(process.env.KIKI_BROWSER_GREP
        ? ["--grep", process.env.KIKI_BROWSER_GREP]
        : []),
    ],
    {
      cwd: sourceRoot,
      env: {
        ...process.env,
        KIKI_BROWSER_BASE_URL: `http://127.0.0.1:${port}`,
        KIKI_BROWSER_REPOSITORY: repositoryRoot,
      },
    },
  );
} finally {
  // Never delete a watched tree until both owned children have stopped.
  const errors = [];
  for (const child of [activeCommand, server]) {
    try {
      await stopChild(child);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Browser test cleanup failed");
  await rm(sandboxRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  console.log(`Browser test cleanup complete: ${sandboxRoot}`);
}
