/**
 * Opt-in, read-only browser smoke against an already deployed Vue studio.
 * No server is started and no model, design, printer or slicer action is sent.
 * View PUTs are suppressed locally because selection/locale normally persist.
 * This validates deployed UI/CAD transport, not engineering or physical fitness.
 *
 * PowerShell example (use a completed, idle project):
 * $env:M4KE_UI_LIVE_URL='http://127.0.0.1:4174'
 * $env:M4KE_UI_LIVE_PROJECT='<project UUID>'
 * node tests/vue-deployed-e2e.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const configuredUrl = process.env.M4KE_UI_LIVE_URL;
const projectId = process.env.M4KE_UI_LIVE_PROJECT;
if (!configuredUrl || !projectId) {
  console.error(
    "Opt-in required: set both M4KE_UI_LIVE_URL and M4KE_UI_LIVE_PROJECT. No service was contacted.",
  );
  process.exit(2);
}
const base = new URL(configuredUrl);
assert(
  ["http:", "https:"].includes(base.protocol),
  "Expected an HTTP(S) studio URL.",
);
assert(
  !base.username && !base.password,
  "Do not place credentials in the URL.",
);
assert(
  base.pathname === "/" && !base.search && !base.hash,
  "Use the studio origin only, without a path/query/fragment.",
);
assert(/^[a-f\d-]{36}$/i.test(projectId), "Expected a project UUID.");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  root,
  process.env.M4KE_UI_LIVE_OUTPUT || `test-results/vue-deployed-${Date.now()}`,
);
await mkdir(output, { recursive: true });
const report = {
  at: new Date().toISOString(),
  scope:
    "Real deployed Vue/read-only service/CAD transport. View preferences are locally suppressed; no model inference, manufacturing release or physical validation is proved.",
  origin: base.origin,
  projectId,
  results: [],
  browserErrors: [],
  blockedWrites: [],
  suppressedViewWrites: [],
  externalRequests: [],
  failedResponses: [],
  stlResponses: [],
  screenshots: [],
};
let browser, context, page;
let before, job;
const bodyChecks = [];
const sha = (data) => createHash("sha256").update(data).digest("hex");
const identity = (project) => ({
  id: project.id,
  revision: project.revision,
  designHash: project.designHash,
  jobId: project.jobId,
  specContentSha256: sha(JSON.stringify(project.spec)),
});
const expectedMeshes = new Map();
const endpoint = (pathname) => new URL(pathname, base).href;
const projectPath = `/api/studio/projects/${projectId}`;
const check = async (name, action) => {
  try {
    const detail = await action();
    report.results.push({
      name,
      status: "PASS",
      ...(detail ? { detail } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.results.push({ name, status: "FAIL", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
};
const screenshot = async (name) => {
  const file = path.join(output, name);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
};
const get = async (pathname) => {
  const response = await context.request.get(endpoint(pathname));
  assert(response.ok(), `GET ${pathname}: HTTP ${response.status()}`);
  return response.json();
};
const row = (id) =>
  page.locator(`.tree-row[data-part-id=${JSON.stringify(id)}]`);
const phase = (id) =>
  page.locator(`[data-stage=${JSON.stringify(id)}]`).click();

try {
  const executablePath =
    process.env.M4KE_BROWSER_EXECUTABLE ||
    (process.platform === "win32"
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : undefined);
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(60000);
  before = await get(projectPath);
  assert.equal(before.id, projectId, "Service project identity differs.");
  assert(
    before.spec?.parts?.length,
    "Choose an existing project with designed parts.",
  );
  assert(
    before.workflow?.status !== "running",
    "Choose an idle project; do not smoke-test while its design changes.",
  );
  if (before.jobId) job = await get(`/api/studio/jobs/${before.jobId}`);
  assert(
    !["queued", "running"].includes(job?.status),
    "Choose a completed/idle CAD job.",
  );
  report.before = identity(before);
  report.job = job
    ? {
        id: job.id,
        status: job.status,
        designHash: job.designHash,
        reportHash: job.verification?.revisionHash,
        reportedOverall: job.verification?.overall,
      }
    : null;
  const cad =
    job?.status === "complete" && job.designHash === before.designHash
      ? job.cad?.parts || []
      : [];
  for (const part of cad) {
    const url = new URL(part.stlUrl, base);
    assert.equal(
      url.origin,
      base.origin,
      "Native artifact must be same-origin.",
    );
    assert(
      url.pathname.startsWith(`/api/studio/jobs/${before.jobId}/files/`),
      "Native artifact must belong to this job.",
    );
    assert(
      /^[a-f\d]{64}$/.test(part.sha256?.stl || ""),
      `Missing STL SHA for ${part.id}.`,
    );
    expectedMeshes.set(url.href, { partId: part.id, sha256: part.sha256.stl });
  }
  report.nativeExpected = cad.length;

  // All actual service mutations are forbidden. Only view preference responses
  // are locally simulated; this never tests production view persistence.
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.origin !== base.origin &&
      ["http:", "https:"].includes(url.protocol)
    ) {
      report.externalRequests.push({
        method: request.method(),
        origin: url.origin,
      });
      return route.abort("blockedbyclient");
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()))
      return route.continue();
    if (request.method() === "PUT" && url.pathname === `${projectPath}/view`) {
      const body = request.postDataJSON();
      const { expectedVersion, ...view } = body;
      report.suppressedViewWrites.push({
        mode: "view-suppressed",
        expectedVersion,
        fields: Object.keys(view),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...view, version: expectedVersion + 1 }),
      });
    }
    report.blockedWrites.push({ method: request.method(), path: url.pathname });
    return route.abort("blockedbyclient");
  });
  page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable', {maxTotalBufferSize: 64000000, maxResourceBufferSize: 32000000});
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400)
      report.failedResponses.push({
        path: url.pathname,
        status: response.status(),
      });
    const expected = expectedMeshes.get(response.url());
    if (!expected) return;
    bodyChecks.push(
      (async () => {
        try {
          const body = await response.body();
          const actualSha256 = sha(body);
          report.stlResponses.push({
            path: url.pathname,
            ...expected,
            status: response.status(),
            bytes: body.byteLength,
            actualSha256,
            matches: response.ok() && actualSha256 === expected.sha256,
          });
        } catch (error) {
          report.stlResponses.push({
            path: url.pathname,
            ...expected,
            status: response.status(),
            error: error.message,
            matches: false,
          });
        }
      })(),
    );
  });
  await page.goto(endpoint(`/?project=${encodeURIComponent(projectId)}`));
  // The saved view arrives after project/job data. Do not race its locale and
  // stage restoration by changing controls while initialization is in flight.
  await page.waitForLoadState("networkidle", { timeout: 180000 });
  await phase("refine");
  await page.locator(".workspace-toolbar > div > button").first().click();
  await page.locator(".studio-viewport").waitFor();
  if ((await page.locator("html").getAttribute("lang")) !== "en") {
    await page.getByRole("button", { name: "切换为英文", exact: true }).click();
  }

  await check("deployed Vue entry and five-stage workflow", async () => {
    assert.deepEqual(
      await page
        .locator("[data-stage]")
        .evaluateAll((elements) =>
          elements.map((e) => e.getAttribute("data-stage")),
        ),
      ["workspace", "requirements", "refine", "verify", "export"],
    );
    assert(
      await page
        .locator("#root")
        .evaluate((element) => Boolean(element.__vue_app__)),
      "Expected mounted Vue application.",
    );
    assert.equal(
      await page.locator(".tree-row[data-part-id]").count(),
      before.spec.parts.length,
    );
    assert.equal(await page.locator(".inspector").count(), 1);
  });
  await check(
    "actual native STL bytes match service hashes and complete viewport count",
    async () => {
      assert(
        cad.length > 0,
        "No exact-current completed native CAD exists; cannot claim native rendering.",
      );
      await page.waitForFunction(
        (expected) => {
          const view = document.querySelector(".studio-viewport");
          return (
            Number(view?.getAttribute("data-native-loaded")) === expected ||
            Boolean(document.querySelector(".viewport-error"))
          );
        },
        cad.length,
        { timeout: 180000 },
      );
      await Promise.all(bodyChecks);
      report.nativeActual = await page
        .locator(".studio-viewport")
        .evaluate((element) => ({
          loaded: Number(element.getAttribute("data-native-loaded")),
          total: Number(element.getAttribute("data-native-total")),
          receivedBytes: Number(element.getAttribute("data-native-bytes")),
          error:
            element.querySelector(".viewport-error")?.textContent?.trim() || "",
        }));
      assert.equal(report.nativeActual.error, "");
      assert.equal(report.nativeActual.loaded, cad.length);
      assert.equal(report.nativeActual.total, cad.length);
      assert.equal(
        await page.locator(".viewport-geometry-label.concept").count(),
        0,
      );
      const observed = new Set(
        report.stlResponses.filter((r) => r.matches).map((r) => r.sha256),
      );
      // Chromium may evict streamed response bodies from its DevTools buffer.
      // A separate read-only GET verifies missing bytes without replacing any
      // production response. Preserve the original observability error above.
      const missing = [...expectedMeshes.entries()].filter(
        ([, entry]) => !observed.has(entry.sha256),
      );
      const unique = [
        ...new Map(
          missing.map(([url, entry]) => [entry.sha256, [url, entry]]),
        ).values(),
      ];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, unique.length) }, async () => {
          while (next < unique.length) {
            const [url, expected] = unique[next++];
            const response = await context.request.get(url, {
              timeout: 180000, maxRetries: 1,
            });
            try {
              const body = await response.body(),
                actualSha256 = sha(body);
              const matches = response.ok() && actualSha256 === expected.sha256;
              report.stlResponses.push({
                transport: "read-only-api-readback",
                path: new URL(url).pathname,
                ...expected,
                status: response.status(),
                bytes: body.byteLength,
                actualSha256,
                matches,
              });
              if (matches) observed.add(expected.sha256);
            } finally {
              await response.dispose();
            }
          }
        }),
      );
      for (const part of cad)
        assert(
          observed.has(part.sha256.stl),
          `Missing verified service bytes for ${part.id}.`,
        );
      assert(
        report.stlResponses.every(
          (r) => r.matches || (r.error && r.status === 200),
        ),
        "A native response failed its declared hash.",
      );
    },
  );
  await check(
    "part selection, honest recorded intent and AI context without asking AI",
    async () => {
      const part =
        before.spec.parts.find((p) => !p.explanation?.purpose) ||
        before.spec.parts[0];
      await row(part.id).locator(".tree-select").click();
      assert.equal(
        await page.locator(".inspector").getAttribute("data-active-id"),
        part.id,
      );
      assert.equal(
        await page
          .locator(`[data-context-id=${JSON.stringify(part.id)}]`)
          .count(),
        1,
      );
      if (!part.explanation?.purpose)
        await page
          .locator(".inspector")
          .getByText(
            "This revision has no recorded purpose. Ask Qwen with this part selected.",
            { exact: true },
          )
          .waitFor();
      else
        await page
          .locator(".inspector .explanation")
          .getByText(part.explanation.purpose, { exact: true })
          .waitFor();
      const eye = page.locator(
        `[data-visibility-id=${JSON.stringify(part.id)}]`,
      );
      const wasVisible = await eye.getAttribute("aria-pressed");
      await eye.click();
      assert.notEqual(await eye.getAttribute("aria-pressed"), wasVisible);
      await eye.click();
      assert.equal(await eye.getAttribute("aria-pressed"), wasVisible);
      await screenshot("refine-desktop.png");
      return {
        selectedPartId: part.id,
        missingLegacyPurpose: !part.explanation?.purpose,
        inferenceSent: false,
      };
    },
  );
  await check(
    "real current netlist selection carries endpoint context",
    async () => {
      const wires =
        job?.electrical?.designHash === before.designHash
          ? job.electrical.connections || []
          : [];
      if (!wires.length)
        return {
          notApplicable: "No exact-current netlist; no wires invented.",
        };
      const wire = wires[0];
      await page
        .locator(".outliner")
        .getByRole("button", { name: wire.id, exact: true })
        .click();
      assert.equal(
        await page
          .locator(".studio-viewport")
          .getAttribute("data-selected-wire"),
        wire.id,
      );
      for (const id of new Set([wire.from.partId, wire.to.partId])) {
        assert.equal(
          await page.locator(`[data-context-id=${JSON.stringify(id)}]`).count(),
          1,
        );
      }
      return {
        wireId: wire.id,
        endpointPartIds: [wire.from.partId, wire.to.partId],
        physicalFit: "NOT_TESTED",
      };
    },
  );
  await check('real assembly playback and labelled wiring preserve the current design', async () => {
    await phase('export');
    await page.getByTestId('assembly-tab').click();
    await page.getByTestId('assembly-player').waitFor();
    const viewport=page.locator('.studio-viewport');
    await page.getByRole('button',{name:'Play assembly animation',exact:true}).click();
    await page.waitForFunction(()=>Number(document.querySelector('.studio-viewport')?.getAttribute('data-assembly-progress'))<1);
    await page.getByRole('button',{name:'Pause assembly animation',exact:true}).click();
    assert.equal(await page.getByTestId('assembly-player').getAttribute('data-playing'),'false');
    assert(await viewport.evaluate(element=>{
      const r=element.getBoundingClientRect(),scroll=element.closest('.central-scroll').getBoundingClientRect();
      return r.top>=scroll.top && r.bottom<=scroll.bottom+2;
    }),'Assembly viewport must not be clipped by the instructions scroll position');
    assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);
    await screenshot('assembly-playback.png');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelector('button[aria-label="Play assembly animation"]')?.disabled===true);
    assert(await page.getByRole('button',{name:'Play assembly animation',exact:true}).isDisabled());
    assert.equal(await viewport.getAttribute('data-assembly-progress'),'1');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await phase('refine');
    assert.equal(await page.getByTestId('assembly-player').count(),0);
    await page.locator('.workspace-toolbar > div > button').nth(1).click();
    const wires=job?.electrical?.connections||[];
    await page.getByTestId('wire-guide').waitFor();
    assert.equal(await page.locator('.wire-card').count(),wires.length);
    if(wires.length){
      const card=page.locator('.wire-card').first();
      assert((await card.innerText()).includes(wires[0].from.terminal),'Missing source pin label');
      assert((await card.innerText()).includes(wires[0].to.terminal),'Missing destination pin label');
      await card.scrollIntoViewIfNeeded();
      await screenshot('wire-guide.png');
      await card.getByRole('button',{name:'Locate in 3D',exact:false}).click();
      assert.equal(await viewport.getAttribute('data-selected-wire'),wires[0].id);
    } else await page.locator('.workspace-toolbar > div > button').first().click();
    return {steps:before.spec.assembly.length,wireCards:wires.length,illustrativeOnly:true};
  });
  await check(
    "locale and mobile panels stay usable; preferences are view-suppressed",
    async () => {
      await page
        .getByRole("button", { name: "Switch to Chinese", exact: true })
        .click();
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      await page
        .getByRole("button", { name: "切换为英文", exact: true })
        .click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      for (const selector of [".language-button", '[data-testid="ai-send"]']) {
        assert(
          await page.locator(selector).evaluate((element) => {
            const r = element.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              r.top >= 0 &&
              r.bottom <= innerHeight
            );
          }),
          `${selector} is clipped`,
        );
      }
      await screenshot("refine-mobile.png");
      await page
        .getByRole("button", {
          name: "Toggle outliner & properties",
          exact: true,
        })
        .click();
      await page.locator(".right-panels").waitFor({ state: "visible" });
      assert(await page.locator(".inspector").isVisible());
      await screenshot("refine-mobile-properties.png");
      await page
        .getByRole("button", {
          name: "Close outliner and properties",
          exact: true,
        })
        .click();
      await page.locator(".right-panels").waitFor({ state: "hidden" });
      await page.waitForTimeout(700); // Debounced view preferences must be intercepted, not transmitted.
      assert(report.suppressedViewWrites.length > 0);
    },
  );
  await check(
    "no browser exception, design write, model call or hardware action",
    async () => {
      const after = await get(projectPath);
      report.after = identity(after);
      assert.deepEqual(
        report.after,
        report.before,
        "Project changed during this read-only smoke; do not attribute this to the test.",
      );
      assert.deepEqual(report.browserErrors, []);
      assert.deepEqual(
        report.blockedWrites,
        [],
        "Forbidden mutation was attempted (and blocked).",
      );
      assert.deepEqual(report.externalRequests, []);
      await Promise.all(bodyChecks);
    },
  );
} catch (error) {
  report.results.push({
    name: "live smoke setup/navigation",
    status: "FAIL",
    error: error.message,
  });
  console.error(error.message);
  if (page) await screenshot("failure.png").catch(() => {});
} finally {
  await Promise.allSettled(bodyChecks);
  if (page && !report.nativeActual) {
    report.nativeActual = await page
      .locator(".studio-viewport")
      .evaluate((element) => ({
        loaded: Number(element.getAttribute("data-native-loaded")),
        total: Number(element.getAttribute("data-native-total")),
        error:
          element.querySelector(".viewport-error")?.textContent?.trim() || "",
      }))
      .catch(() => null);
  }
  report.status = report.results.some((r) => r.status === "FAIL")
    ? "FAIL"
    : "PASS";
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
}
console.log(
  JSON.stringify({
    status: report.status,
    checks: report.results.length,
    output,
    viewPersistence: "SUPPRESSED_NOT_TESTED",
    physicalValidation: "NOT_TESTED",
  }),
);
if (report.status !== "PASS") process.exitCode = 1;
