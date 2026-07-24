import { spawn } from "node:child_process";
import { createPageHelper } from "./scripts/auth";

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

async function waitForServer(url: string, maxWait: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log("Starting preview server...");
  const server = spawn("bun", ["run", "preview"], {
    cwd: import.meta.dir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  server.stdout?.on("data", () => {});
  server.stderr?.on("data", () => {});

  try {
    console.log("Waiting for server...");
    await waitForServer(PREVIEW_URL, 30000);

    process.env.APP_URL = PREVIEW_URL;
    const helper = await createPageHelper();

    await helper.goto("/constraints");

    // Wait for Convex data — look for a group header
    console.log("Waiting for data to load...");
    try {
      await helper.page.waitForSelector('text=ThemeREX Addons', { timeout: 15000 });
      console.log("Data loaded!");
    } catch {
      console.log("Timeout waiting for data, screenshot anyway...");
    }

    await new Promise(r => setTimeout(r, 1000));
    await helper.screenshot("constraints-final.png");
    await helper.printPageContent();
    console.log("Done!");
    await helper.close();
  } finally {
    server.kill("SIGTERM");
  }
}

main();
