import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PROMPTNOOK_E2E_PORT ?? "1422";
const baseURL = `http://127.0.0.1:${port}`;
const viteBin = path.join(workspace, "node_modules", "vite", "bin", "vite.js");
const playwrightBin = path.join(
  workspace,
  "node_modules",
  "playwright",
  "cli.js",
);

const vite = spawn(
  process.execPath,
  [
    viteBin,
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
  ],
  {
    cwd: workspace,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  },
);

let viteExit;
const viteClosed = new Promise((resolve) => {
  vite.once("exit", (code, signal) => {
    viteExit = { code, signal };
    resolve(viteExit);
  });
});

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (viteExit) {
      throw new Error(
        `Vite exited before the test started (code=${viteExit.code}, signal=${viteExit.signal})`,
      );
    }
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite: ${baseURL}`);
}

async function stopVite() {
  if (viteExit) return;
  vite.kill();
  await Promise.race([
    viteClosed,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!viteExit) {
    vite.kill("SIGKILL");
    await Promise.race([
      viteClosed,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    interrupted = true;
    await stopVite();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  await waitForServer();
  const playwright = spawn(
    process.execPath,
    [playwrightBin, "test", ...process.argv.slice(2)],
    {
      cwd: workspace,
      env: {
        ...process.env,
        PROMPTNOOK_E2E_BASE_URL: baseURL,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  exitCode = await new Promise((resolve, reject) => {
    playwright.once("error", reject);
    playwright.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright was terminated by signal ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  await stopVite();
}

if (!interrupted) process.exitCode = exitCode;
