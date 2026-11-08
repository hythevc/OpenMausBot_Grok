// Opt-in native acceptance. Called only by the disposable browser launcher.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserRuntime } from "../../server/browser-runtime.ts";

export async function verifyBrowserRecovery(input: {
  binaryPath: string; executablePath: string; dataDir: string; previewUrl: string; testPage: string;
  screenshotPath: string;
}) {
  const playwrightPath = process.env.OMB_VERIFY_PLAYWRIGHT;
  if (!playwrightPath) throw new Error("Set OMB_VERIFY_PLAYWRIGHT to an installed Playwright module for --recovery.");
  const { chromium } = await import(playwrightPath);
  const runtime = new BrowserRuntime();
  const session = `recovery-${randomUUID()}`;
  const env = {
    HOME: input.dataDir, USERPROFILE: input.dataDir, PATH: process.env.PATH,
    AGENT_BROWSER_SESSION: session, AGENT_BROWSER_HEADLESS: "1",
    AGENT_BROWSER_EXECUTABLE_PATH: input.executablePath, AGENT_BROWSER_NO_WEBMCP: "1",
  };
  const spec = { command: input.binaryPath, args: ["mcp", "--tools", "core", "--no-webmcp"], env };
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await runtime.agentRpc(session, spec, "tools/call", { name: `agent_browser_${name}`, arguments: args }) as { isError?: boolean };
    assert(!result.isError, JSON.stringify(result));
    return JSON.stringify(result);
  };
  const browser = await chromium.launch({ executablePath: input.executablePath, headless: true });
  let releasePendingInput = () => {};
  try {
    await call("open", { url: input.testPage });
    await call("fill", { selector: "#name", text: "Preserved after idle" });
    await call("eval", { script: "window.fixtureIdentity = crypto.randomUUID(); window.fixtureIdentity" });
    const identity = await call("eval", { script: "window.fixtureIdentity" });
    // This wait is deliberately longer than the production 60-second timeout.
    const idle = delay(65_000);
    console.log("Native form filled; waiting across the production idle boundary while testing the real preview.");

    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      (window as any).fixtureInputRequests = [];
      (window as any).fixtureInputConsumed = false;
      window.fetch = async (resource, init) => {
        const action = String(resource).endsWith("/browser/action") && typeof init?.body === "string"
          ? JSON.parse(init.body) : null;
        if (action?.type === "input_keyboard") (window as any).fixtureInputRequests.push(action.text);
        const response = await originalFetch(resource, init);
        if (action?.text === "Held fixture input") {
          const readJson = response.json.bind(response);
          response.json = async () => {
            const body = await readJson();
            (window as any).fixtureInputConsumed = true;
            return body;
          };
        }
        return response;
      };
      const Original = window.EventSource;
      (window as any).fixtureSources = [];
      window.EventSource = class extends Original {
        fixtureSilent = false;
        fixtureHeartbeatCount = 0;
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          if (String(url).endsWith("/browser/live")) {
            (window as any).fixtureSources.push(this);
            for (const type of ["ready", "heartbeat", "frame", "tabs", "url", "status", "control", "error"]) {
              this.addEventListener(type, (event) => {
                if (this.fixtureSilent) event.stopImmediatePropagation();
                else if (type === "heartbeat") this.fixtureHeartbeatCount++;
              });
            }
          }
        }
      };
    });
    const actions: Array<Record<string, unknown>> = [];
    page.on("request", (request: any) => {
      if (request.url().endsWith("/browser/action")) actions.push(request.postDataJSON());
    });
    await page.goto(input.previewUrl);
    await page.getByRole("img", { name: "Live bot browser" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Take control", exact: true }).click();
    await page.getByRole("button", { name: "Return to bot", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Browser address" }).fill(input.testPage);
    const navigation = page.waitForResponse((response: any) => response.url().endsWith("/browser/action") && response.request().postDataJSON()?.type === "navigate");
    await page.getByRole("textbox", { name: "Browser address" }).press("Enter");
    assert((await navigation).ok());
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('img[alt="Live bot browser"]')?.naturalWidth);
    // Inject only a transport failure into a real EventSource. The component
    // must close the old server viewer and establish a new watch-only viewer.
    const offset = actions.length;
    await page.evaluate(() => (window as any).fixtureSources.at(-1).dispatchEvent(new Event("error")));
    await page.getByText("Connection interrupted. Reconnecting the browser view…").waitFor();
    await page.waitForFunction(() => (window as any).fixtureSources.length === 2);
    await page.getByRole("img", { name: "Live bot browser" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Take control", exact: true }).waitFor();
    assert.deepEqual(actions.slice(offset).filter((action) => action.type !== "ack"), []);
    await page.waitForFunction((url: string) => document.querySelector<HTMLInputElement>('input[aria-label="Browser address"]')?.value === url, input.testPage);
    console.log("PASS: real native preview reconnects automatically, retaining the page without replaying navigation or taking control.");

    // Four real server heartbeats exceed the renderer's silence deadline.
    // A static image is valid while its connection continues to report health.
    await page.waitForFunction(() => (window as any).fixtureSources[1]?.fixtureHeartbeatCount >= 4, undefined, { timeout: 45_000 });
    assert.equal(await page.evaluate(() => (window as any).fixtureSources.length), 2);
    assert(await page.getByRole("img", { name: "Live bot browser" }).isVisible());
    await page.screenshot({ path: input.screenshotPath.replace(/\.png$/, "-healthy.png") });
    console.log("PASS: healthy heartbeats keep a static native browser view connected for more than 30 seconds.");

    await page.getByRole("button", { name: "Take control", exact: true }).click();
    await page.getByRole("button", { name: "Return to bot", exact: true }).waitFor();
    const silenceOffset = actions.length;
    const heldInput = new Promise<void>((resolve) => { releasePendingInput = resolve; });
    let inputHeld = false;
    await page.route("**/api/bots/*/browser/action", async (route: any) => {
      const body = route.request().postDataJSON();
      if (body.type === "input_keyboard" && body.text === "Held fixture input") {
        inputHeld = true;
        await heldInput;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      } else await route.continue();
    });
    const typeThroughPanel = async (text: string) => {
      await page.getByLabel("Browser menu", { exact: true }).click();
      await page.getByRole("button", { name: "Type or paste text…", exact: true }).click();
      await page.getByRole("textbox", { name: "Text for the page", exact: true }).fill(text);
      await page.getByRole("button", { name: "Type", exact: true }).click();
    };
    await typeThroughPanel("Held fixture input");
    await typeThroughPanel("Must not replay");
    assert(inputHeld, "the first input must be in flight while the second waits in the real input queue");
    assert.equal(actions.slice(silenceOffset).filter((action) => action.text === "Must not replay").length, 0);

    // Suppress all delivery, including error events, on this real connection.
    // Its only renderer recovery trigger is the production heartbeat deadline.
    await page.evaluate(() => { (window as any).fixtureSources[1].fixtureSilent = true; });
    await page.getByText("Connection interrupted. Reconnecting the browser view…").waitFor({ timeout: 35_000 });
    assert.equal(await page.getByRole("img", { name: "Live bot browser" }).count(), 0);
    assert(await page.getByRole("button", { name: "Take control", exact: true }).isDisabled());
    assert(await page.getByRole("textbox", { name: "Browser address" }).getAttribute("readonly") !== null);
    await page.screenshot({ path: input.screenshotPath.replace(/\.png$/, "-reconnecting.png") });
    await page.waitForFunction(() => (window as any).fixtureSources.length === 3);
    await page.getByRole("img", { name: "Live bot browser" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Take control", exact: true }).waitFor();
    const lateInputResponse = page.waitForResponse((response: any) => response.url().endsWith("/browser/action") && response.request().postDataJSON()?.text === "Held fixture input");
    releasePendingInput();
    assert((await lateInputResponse).ok());
    // Observe response consumption at the next rendering checkpoint, after
    // the input queue's promise continuations have had a chance to dispatch.
    await page.waitForFunction(() => (window as any).fixtureInputConsumed === true);
    assert.deepEqual(await page.evaluate(() => (window as any).fixtureInputRequests), ["Held fixture input"]);
    assert.deepEqual(actions.slice(silenceOffset).filter((action) => action.type !== "ack").map((action) => action.text), ["Held fixture input"]);
    assert(await page.getByRole("textbox", { name: "Browser address" }).getAttribute("readonly") !== null);
    await page.waitForFunction((url: string) => document.querySelector<HTMLInputElement>('input[aria-label="Browser address"]')?.value === url, input.testPage);
    console.log("PASS: heartbeat silence clears the stale frame and control, reconnects watch-only, and discards queued input after a late response.");
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    await page.screenshot({ path: input.screenshotPath });
    console.log(`Preview screenshot: ${input.screenshotPath}`);
    await idle;
    assert.equal(await call("eval", { script: "window.fixtureIdentity" }), identity);
    assert.match(await call("snapshot", {}), /Preserved after idle/);
    await call("click", { selector: "#greeting button" });
    assert.match(await call("get_text", { selector: "#result" }), /Hello, Preserved after idle/);
    console.log("PASS: the same live document and unsaved form survive 65 seconds idle; the next agent tool call completes.");
  } finally {
    releasePendingInput();
    await browser.close();
    try { await promisify(execFile)(input.binaryPath, ["close"], { env, timeout: 15_000 }); }
    finally { await runtime.closeAll(); }
  }
}
