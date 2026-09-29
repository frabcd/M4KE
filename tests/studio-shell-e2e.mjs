import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { designHash } from "../server/studio-contract.mjs";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.resolve(
  root,
  process.env.M4KE_TEST_OUTPUT || `test-results/vue-workspace-${Date.now()}`,
);
await mkdir(out, { recursive: true });
const vite = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium
  .launch({
    ...(process.env.M4KE_BROWSER_EXECUTABLE || process.platform === "win32"
      ? {
          executablePath:
            process.env.M4KE_BROWSER_EXECUTABLE ||
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
        }
      : {}),
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  })
  .catch(async (error) => {
    await vite.close();
    throw error;
  });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const errors = [],
  results = [],
  writes = [],
  assets = [];
page.on("pageerror", (e) => errors.push(e.message));
const hash = "a".repeat(64),
  jobId = "aaaaaaaa-1111-4111-8111-111111111111";
const parts = [
  {
    id: "chassis",
    name: "Printed base",
    kind: "printed",
    material: "PLA",
    color: "#d2d9e0",
    shape: { type: "box", size: [160, 90, 4] },
    position: [0, 0, 2],
    rotation: [0, 0, 0],
  },
  {
    id: "controller",
    name: "Controller fixture",
    kind: "purchased",
    material: "FR4",
    color: "#38876c",
    shape: { type: "box", size: [40, 22, 8] },
    position: [-33, 0, 15],
    rotation: [0, 0, 0],
  },
  {
    id: "driver",
    name: "Driver fixture",
    kind: "purchased",
    material: "FR4",
    color: "#415688",
    shape: { type: "box", size: [30, 20, 8] },
    position: [35, 0, 15],
    rotation: [0, 0, 0],
  },
];
const spec = {
  schemaVersion: 1,
  title: "Electrical UI fixture — not engineering evidence",
  description:
    "Mocked netlist to verify UI rendering, not a generated or physically tested toy.",
  units: "mm",
  requirements: [
    {
      id: "fixture",
      text: "Exercise browser behavior, not physical performance.",
    },
  ],
  assumptions: ["Fixture data only."],
  unknowns: ["Not a physically verified circuit."],
  questions: [],
  parts,
  assembly: [
    {
      id: "wire",
      title: "Wire with power disconnected",
      partIds: ["chassis", "controller", "driver"],
      requires: [],
      instructions: ["Confirm labels against the real hardware."],
      checks: ["Power is disconnected."],
    },
  ],
  physicsInputs: {},
};
const connection = (id, color, from, to, route) => ({
  id,
  from: { partId: "controller", terminal: from },
  to: { partId: "driver", terminal: to },
  kind: "signal",
  color,
  wireAwg: 24,
  fromAnchorMm: route?.[0],
  toAnchorMm: route?.at(-1),
  polylineMm: route,
  routingStatus: route ? "MODEL_ASSUMED" : "MISSING_ANCHORS",
});
const summary = {
  schemaVersion: 1,
  designHash: hash,
  status: "UNVERIFIED",
  claims: [
    {
      id: "fixture-pin-check",
      name: "Fixture pin references",
      status: "PASS",
      method: "Mock UI fixture",
      actual: 2,
      required: 2,
      notes: "UI test only, not an electrical qualification.",
    },
  ],
  components: parts.slice(1).map((p) => ({
    partId: p.id,
    profileId: "fixture",
    name: p.name,
    identityStatus: "ASSUMED_NONCATALOG",
    terminals: [],
    terminalAnchors: [],
  })),
  connections: [
    connection("drive-control", "#e54528", "GP0", "AIN1", [
      [-13, -6, 19],
      [-13, -22, 26],
      [20, -22, 26],
      [20, -6, 19],
    ]),
    connection("common-ground", "#225aca", "GND", "GND", [
      [-13, 6, 19],
      [-13, 22, 28],
      [20, 22, 28],
      [20, 6, 19],
    ]),
    connection("missing-position", "#8258cc", "GP1", "AIN2"),
  ],
  firmware: {
    status: "GENERATED_OUTPUT_DISABLED",
    reason: "Fixture outputs are disabled pending commissioning.",
    files: ["firmware/config.py"],
  },
  artifactPaths: {
    diagram: "electrical/wiring.svg",
    table: "electrical/connections.csv",
    netlist: "electrical/netlist.json",
    guide: "electrical/README.md",
    firmwareConfig: "firmware/config.py",
  },
};

// Mock HTTP is deliberately not Qwen/native-CAD/physical evidence.
parts[0].explanation = {
  purpose: "Fixture shell protects the layout.",
  placementReason: "Fixture location rationale.",
  selectionReason: "Fixture material rationale.",
};
const projectId = "bbbbbbbb-2222-4222-8222-222222222222";
let project,
  job,
  proposal,
  pending = "",
  stale = false,
  configured = true,
  askGate,
  askStarted,
  disconnected = false,
  nativeFailure = false;
const geometry = new THREE.BoxGeometry(40, 25, 16),
  material = new THREE.MeshBasicMaterial();
const fixtureStl = new STLExporter().parse(new THREE.Mesh(geometry, material));
geometry.dispose();
material.dispose();
const nativeHash = createHash("sha256").update(fixtureStl).digest("hex");
const nativeCad = () => ({
  parts: project.spec.parts.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    stlUrl: `/api/studio/jobs/${jobId}/files/cad/${p.id}.stl`,
    sha256: { stl: nativeFailure ? "f".repeat(64) : nativeHash },
    bounds: { min: [-20, -12.5, -8], max: [20, 12.5, 8] },
  })),
});
let view = {
  version: 0,
  selectedPartIds: [],
  activePartId: null,
  hiddenPartIds: [],
  stage: "requirements",
  viewMode: "model",
  projection: "perspective",
  language: "zh",
};
const clone = (x) => structuredClone(x);
let inferenceSettings = {provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'fixture-only'};
const settingsWrites = [];
await page.route('**/api/settings', async route => {
  if (route.request().method() === 'POST') { inferenceSettings=route.request().postDataJSON();settingsWrites.push(clone(inferenceSettings)); }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(inferenceSettings)});
});
await page.route('**/api/models', async route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({models:[{name:inferenceSettings.model,family:inferenceSettings.provider}]})}));
await page.route("**/api/studio/**", async (route) => {
  const r = route.request(),
    p = new URL(r.url()).pathname,
    body = r.method() === "GET" ? null : r.postDataJSON();
  if (body) writes.push({ path: p, body: clone(body) });
  const respond = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (p === "/api/studio/capabilities")
    return respond({
      configured,
      model: configured ? inferenceSettings.model : "",
      provider: inferenceSettings.provider,
      cad: { available: true },
      printers: [],
      cloudFallback: false,
    });
  if (p === "/api/studio/catalog")
    return respond({ components: [], materials: [], kits: [] });
  if (p === "/api/studio/integrations") return respond({runtimeNetworkRequired:false});
  if (p === "/api/studio/projects") {
    if (r.method() === "GET")
      return respond({
        projects: project
          ? [
              {
                id: projectId,
                title: project.name,
                updatedAt: project.updatedAt,
              },
            ]
          : [],
      });
    project = {
      id: projectId,
      name: body.name,
      request: body.request,
      budget: "",
      answers: [],
      revision: 1,
      designHash: null,
      spec: null,
      jobId: null,
      workflow: null,
      updatedAt: new Date().toISOString(),
    };
    return respond(project, 201);
  }
  if (p === `/api/studio/projects/${projectId}/view`) {
    if (!body) return respond(view);
    assert.equal(body.expectedVersion, view.version);
    const { expectedVersion, ...next } = body;
    const confirmedIds = new Set(project.spec?.parts.map(part => part.id) || []);
    assert(next.selectedPartIds.every(id => confirmedIds.has(id)), 'Preview-only selections must not be persisted as confirmed parts');
    assert(next.hiddenPartIds.every(id => confirmedIds.has(id)), 'Preview-only hidden IDs must not be persisted');
    view = { ...next, version: view.version + 1 };
    return respond(view);
  }
  if (p === `/api/studio/projects/${projectId}`) {
    if (disconnected)
      return respond({ error: "Fixture DGX connection unavailable." }, 503);
    if (body) {
      assert.equal(body.expectedRevision, project.revision);
      project = { ...project, ...body, revision: project.revision + 1 };
      delete project.expectedRevision;
    }
    if (pending === "design" || pending === "deliver")
      project = {
        ...project,
        spec: clone(spec),
        designHash: designHash(spec),
        revision: project.revision + 1,
        workflow: {
          status: "draft",
          stage: "refine",
          message: "Fixture draft ready",
        },
      };
    if (pending === "deliver") {
      const h = project.designHash;
      job = {id:jobId,status:"complete",designHash:h,spec:clone(project.spec),cad:nativeCad(),verification:{revisionHash:h,overall:"UNKNOWN",physical:"UNKNOWN",claims:[],limitations:["Synthetic browser transport only"]}};
      project = {...project,jobId,workflow:{status:"complete",stage:"complete",message:"Synthetic checked delivery"}};
    }
    if (pending === "verify") {
      const h = project.designHash;
      job = {
        id: jobId,
        status: "complete",
        designHash: h,
        spec: clone(project.spec),
        electrical: { ...clone(summary), designHash: h },
        verification: {
          revisionHash: h,
          overall: "FAILED",
          physical: "UNKNOWN",
          limitations: ["Fixture only."],
          claims: [
            {
              id: "intersection",
              label: "Fixture intersection",
              status: "FAIL",
              critical: true,
              method: "Mock",
              observed: [{ parts: ["controller", "driver"] }],
              required: "No overlap",
              details: "No CAD claim.",
            },
            {
              id: "fixture-wire",
              label: "Fixture wire issue",
              status: "UNKNOWN",
              connectionId: "drive-control",
              method: "Mock",
              observed: "unknown",
              required: "Check",
              details: "No electrical claim.",
            },
            {
              id: "prose-only",
              label: "Controller maybe related",
              status: "UNKNOWN",
              method: "Mock",
              observed: "controller",
              required: "Source",
              details: "driver",
            },
          ],
        },
      };
      project = {
        ...project,
        jobId,
        workflow: {
          status: "complete",
          stage: "complete",
          message: "Fixture failure retained",
          attempts: [
            {
              number: 1,
              jobId,
              designHash: h,
              overall: "FAILED",
              criticalFailures: ["intersection"],
            },
          ],
        },
      };
    }
    pending = "";
    return respond(project);
  }
  if (p === `/api/studio/projects/${projectId}/run`) {
    assert.equal(body.expectedRevision, project.revision);
    pending = body.mode;
    project = {
      ...project,
      workflow: {
        status: "running",
        stage: body.mode,
        message: "Fixture running",
      },
    };
    return respond(project, 202);
  }
  if (p === `/api/studio/projects/${projectId}/assistant`) {
    assert.equal(body.expectedRevision, project.revision);
    assert.equal(body.designHash, project.designHash);
    if (body.mode === "ask") {
      if(body.proposalId){
        assert.equal(body.proposalId,proposal.id);
        return respond({message:"Fixture candidate explanation. Proposed, not applied or verified."});
      }
      askStarted?.();
      if (askGate) await askGate;
      return respond({
        message: "Fixture read-only explanation. Not historical rationale.",
      });
    }
    if (body.message === "Move the selected shell up slightly.") {
      return respond({message:"How far should I move it?",questions:[{id:"move",question:"Choose the offset",options:["2 mm","4 mm"]}]});
    }
    assert.match(body.message, /Move the selected shell up slightly[\s\S]*Clarification answer:[\s\S]*2 mm/);
    const next = clone(project.spec);
    next.parts[0].position[2] += 2;
    next.parts.push({...clone(next.parts[0]),id:'preview-cap',name:'Candidate-only cap',shape:{type:'box',size:[8,8,4]},position:[50,0,35]});
    next.assembly[0].partIds.push('preview-cap');
    proposal = {
      id: "cccccccc-3333-4333-8333-333333333333",
      baseRevision: project.revision,
      baseDesignHash: project.designHash,
      spec: next,
      designHash: designHash(next),
      message: "Fixture candidate, not applied.",
      changes: [
        {
          partId: "chassis",
          type: "modified",
          fields: ["position"],
          reason: "Requested fixture change.",
        },
      ],
    };
    return respond({ message: proposal.message, proposal });
  }
  if (p === `/api/studio/projects/${projectId}/conversation`) return respond({entries:[]});
  if (p.endsWith(`/proposals/${proposal?.id}/apply`)) {
    if (stale)
      return respond(
        { error: "Candidate is stale; reload the current revision." },
        409,
      );
    assert.equal(body.expectedRevision, project.revision);
    assert.equal(body.designHash, project.designHash);
    project = {
      ...project,
      revision: project.revision + 1,
      spec: clone(proposal.spec),
      designHash: proposal.designHash,
      jobId: null,
      workflow: {
        status: "draft",
        stage: "refine",
        message: "Applied; prior evidence invalid",
      },
    };
    return respond(project);
  }
  if (p === `/api/studio/jobs/${jobId}`) return respond(job);
  if (p.includes("/files/cad/") && p.endsWith(".stl")) {
    assets.push(p);
    return route.fulfill({
      status: nativeFailure ? 503 : 200,
      contentType: "model/stl",
      body: nativeFailure ? "Fixture native CAD unavailable." : fixtureStl,
    });
  }
  if (p.endsWith("/electrical/wiring.svg"))
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="120"><text x="10" y="40">Mock wiring, not evidence</text></svg>',
    });
  if (p.endsWith("/slices")) return respond({ jobs: [] });
  return respond({ error: "No fixture endpoint " + p }, 404);
});
const check = async (name, work) => {
  await work();
  results.push({ name, status: "PASS" });
  console.log("PASS " + name);
};
const phase = (name) => page.locator(`[data-stage="${name}"]`).click();
const row = (name) =>
  page
    .locator(".tree-row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
const designWrites = () => writes.filter((w) => !w.path.endsWith("/view"));
try {
  await page.goto(base);
  await check(
    "Chinese workspace-first entry, five stages, no empty model",
    async () => {
      await page.getByTestId("workspace-create").waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(await page.locator("[data-stage]").count(), 5);
      assert.equal(await page.locator(".studio-viewport").count(), 0);
      await page.screenshot({ path: path.join(out, "workspace-create.png") });
    },
  );
  await check(
    "dialog traps keyboard focus; Escape restores trigger",
    async () => {
      const trigger = page.getByRole("button", {
        name: "模型与材料库",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const d = page.locator("dialog[open]");
      await d.waitFor();
      await page.keyboard.press("Shift+Tab");
      assert(await d.evaluate((e) => e.contains(document.activeElement)));
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert(await trigger.evaluate((e) => e === document.activeElement));
    },
  );
  await check("English preference persists without design writes", async () => {
    await page.getByRole("button", { name: "切换为英文", exact: true }).click();
    await page.reload();
    await page.getByTestId("workspace-create").waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(designWrites().length, 0);
    await page
      .getByRole("button", { name: "Switch to Chinese", exact: true })
      .click();
  });
  await check(
    "named project, saved requirements, checked delivery stops at refinement",
    async () => {
      await page
        .getByTestId("workspace-name")
        .fill("Browser acceptance workspace");
      await page.getByTestId("workspace-create").click();
      await page
        .getByTestId("requirements-input")
        .fill("A fixture only; Qwen would design a toy here.");
      await page.getByTestId("brief-preview").getByText("A fixture only; Qwen would design a toy here.",{exact:true}).waitFor();
      await page.getByRole("button",{name:"桌面机械玩具",exact:true}).click();
      assert((await page.getByTestId("requirements-input").inputValue()).startsWith("A fixture only;"));
      await page.getByTestId("ai-input").fill("Before generation, what should I clarify?");
      await page.getByTestId("ai-send").click();
      await page.locator(".conversation").getByText("Fixture read-only explanation. Not historical rationale.",{exact:true}).waitFor();
      assert.equal(project.spec,null);assert.equal(writes.filter(w=>w.path.endsWith('/run')).length,0);
      await page.screenshot({path:path.join(out,"requirements-blueprint-desktop.png")});
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,"requirements-blueprint-mobile.png"),fullPage:true});
      await page.setViewportSize({width:1440,height:1100});
      await page.getByTestId("generate-draft").click();
      await page.getByTestId("confirm-design").waitFor();
      assert.equal(project.name, "Browser acceptance workspace");
      assert.equal(project.workflow.status, "complete");
      assert.equal(job.verification.revisionHash, project.designHash);
      assert.deepEqual(
        writes.filter((w) => w.path.endsWith("/run")).map((w) => w.body.mode),
        ["deliver"],
      );
    },
  );
  await check(
    "printed/purchased multiselect, active inspector, missing old rationale",
    async () => {
      await row("Printed base").locator(".tree-select").click();
      await page
        .locator(".inspector")
        .getByText(parts[0].explanation.purpose, { exact: true })
        .waitFor();
      await row("Controller fixture")
        .locator(".tree-select")
        .click({ modifiers: ["Shift"] });
      assert.equal(
        await page.locator('.tree-select[aria-pressed="true"]').count(),
        2,
      );
      assert.equal(
        await page.locator(".inspector h3").innerText(),
        "Controller fixture",
      );
      assert.equal(await page.locator(".context-chips button").count(), 2);
      await page
        .locator(".inspector")
        .getByText(/此版本未记录用途说明/)
        .waitFor();
    },
  );
  await check(
    "visibility persists separately and hidden parts stay selectable in outliner",
    async () => {
      const before = {
        revision: project.revision,
        hash: project.designHash,
        writes: designWrites().length,
      };
      await row("Printed base")
        .getByRole("button", { name: "隐藏 Printed base", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector(".studio-viewport")
          ?.getAttribute("data-hidden-ids")
          ?.includes("chassis"),
      );
      await row("Printed base").locator(".tree-select").click();
      await page.waitForTimeout(500);
      assert.equal(project.revision, before.revision);
      assert.equal(project.designHash, before.hash);
      assert.equal(designWrites().length, before.writes);
      await page.reload();
      await page.locator(".studio-viewport").waitFor();
      assert.equal(
        await row("Printed base")
          .locator(".tree-select")
          .getAttribute("aria-pressed"),
        "true",
      );
      await row("Printed base")
        .getByRole("button", { name: "显示 Printed base", exact: true })
        .click();
    },
  );
  await check(
    "read-only ask freezes selected IDs while selection changes in flight",
    async () => {
      await row("Printed base").locator(".tree-select").click();
      await row("Controller fixture")
        .locator(".tree-select")
        .click({ modifiers: ["Shift"] });
      const before = JSON.stringify(project),
        started = new Promise((resolve) => {
          askStarted = resolve;
        });
      let release;
      askGate = new Promise((resolve) => {
        release = resolve;
      });
      await page.locator("#studio-composer").fill("Explain only these parts.");
      await page
        .getByRole("button", { name: "发送给 AI", exact: true })
        .click();
      await started;
      await page.locator('.conversation .assistant-pending').waitFor();
      assert(await page.getByTestId('ai-input').isEnabled());
      await page.getByTestId('ai-input').fill('Draft the next question without replacing the in-flight request.');
      assert(await page.getByTestId('ai-send').isDisabled());
      await page.screenshot({path:path.join(out,'assistant-pending-draft.png')});
      assert(await page.locator('.conversation').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<32));
      await row("Driver fixture").locator(".tree-select").click();
      release();
      askGate = null;
      await page
        .getByText("Fixture read-only explanation. Not historical rationale.", {
          exact: true,
        })
        .waitFor();
      const r = writes.filter((w) => w.path.endsWith("/assistant")).at(-1).body;
      assert.deepEqual(r.selectedPartIds, ["chassis", "controller"]);
      assert.equal(await page.getByTestId('ai-input').inputValue(),'Draft the next question without replacing the in-flight request.');
      await page.getByTestId('ai-input').fill('');
      assert.equal(r.mode, "ask");
      assert.equal(JSON.stringify(project), before);
      assert.equal(writes.filter((w) => w.path.endsWith("/run")).length, 1);
    },
  );
  await check(
    "candidate does not overwrite; stale apply rejects, explicit apply versions",
    async () => {
      await row("Printed base").locator(".tree-select").click();
      await page
        .getByRole("combobox", { name: "AI 操作模式" })
        .selectOption("propose");
      const hash = project.designHash,
        revision = project.revision;
      await page
        .locator("#studio-composer")
        .fill("Move the selected shell up slightly.");
      await page
        .getByRole("button", { name: "发送给 AI", exact: true })
        .click();
      await page.getByText("How far should I move it?", {exact:true}).waitFor();
      await page.locator('.clarification-boundary').waitFor();
      await page.getByTestId('edit-continuation').waitFor();
      await page.screenshot({path:path.join(out,'clarification-dialogue.png')});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(out,'clarification-dialogue-mobile.png')});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const continueButton=await page.getByRole('button',{name:'开始新修改',exact:true}).boundingBox();
      assert(continueButton && continueButton.x>=0 && continueButton.x+continueButton.width<=390 && continueButton.y+continueButton.height<=844);
      await page.setViewportSize({width:1440,height:1100});
      const beforeNewEdit=writes.length;
      await page.getByRole('button',{name:'开始新修改',exact:true}).click();
      assert.equal(await page.getByTestId('edit-continuation').count(),0);
      assert.equal(writes.length,beforeNewEdit,'Starting a new composer draft cannot send or apply anything.');
      assert.equal(project.designHash, hash);
      assert.equal(await page.getByTestId("proposal-panel").count(),0);
      // A read-only detour must not turn an answer to Qwen's edit question
      // into a new read-only question or silently target a different part.
      await page.getByTestId('ai-mode').selectOption('ask');
      await row('Driver fixture').locator('.tree-select').click();
      await page.getByTestId('ai-input').fill('Explain the driver before I answer the edit question.');
      await page.getByTestId('ai-send').click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="ai-pending"]'));
      await page.getByRole("button", {name:"2 mm",exact:true}).click();
      assert.equal(await page.getByTestId('ai-mode').inputValue(),'propose');
      assert.equal(await page.locator('[data-context-id="chassis"]').count(),1);
      assert.equal(await page.locator('[data-context-id="driver"]').count(),0);
      assert.equal(await page.locator("#studio-composer").inputValue(),"Choose the offset: 2 mm");
      await page.getByRole("button", {name:"发送给 AI",exact:true}).click();
      await page.getByTestId("proposal-panel").waitFor();
      assert.deepEqual(writes.filter(w=>w.path.endsWith('/assistant')).at(-1).body.selectedPartIds,['chassis']);
      assert.equal(project.designHash, hash);
      assert.equal(project.revision, revision);
      await page.getByTestId('candidate-discussion').waitFor();
      assert.equal(await page.getByTestId('ai-mode').inputValue(),'ask');
      await row('Candidate-only cap').locator('.tree-select').click();
      await page.waitForTimeout(500);
      assert(!view.selectedPartIds.includes('preview-cap'));
      await row('Candidate-only cap').getByRole('button', {name:'隐藏 Candidate-only cap',exact:true}).click();
      await page.waitForTimeout(500);
      assert(!view.hiddenPartIds.includes('preview-cap'));
      assert((await page.locator('.studio-viewport').getAttribute('data-hidden-ids')).includes('preview-cap'));
      await row('Candidate-only cap').getByRole('button', {name:'显示 Candidate-only cap',exact:true}).click();
      await page.getByTestId('ai-input').fill('Why move the candidate upward?');
      await page.getByTestId('ai-send').click();
      await page.getByText('Fixture candidate explanation. Proposed, not applied or verified.',{exact:true}).waitFor();
      assert.deepEqual(writes.filter(w=>w.path.endsWith('/assistant')).at(-1).body.selectedPartIds,['preview-cap']);
      assert.equal(project.designHash,hash);assert.equal(project.revision,revision);
      await page.screenshot({path:path.join(out,'candidate-conversation.png')});
      await page.getByTestId('proposal-preview').click();
      await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-context-id="preview-cap"]').count(),0);
      assert(!view.selectedPartIds.includes('preview-cap'));
      await page.getByTestId('proposal-preview').click();
      stale = true;
      await page.getByTestId("proposal-apply").click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Candidate is stale" })
        .waitFor();
      assert.equal(project.designHash, hash);
      stale = false;
      await page.getByTestId("proposal-apply").click();
      await page.getByTestId("proposal-panel").waitFor({ state: "hidden" });
      assert.equal(project.revision, revision + 1);
      assert.notEqual(project.designHash, hash);
      assert.equal(project.jobId, null);
      assert(await page.getByRole('button',{name:'2 mm',exact:true}).isDisabled(),'Old clarification options must not target a new design revision.');
    },
  );
  await check(
    "verification is explicit; structured cards locate parts/wires, not prose",
    async () => {
      await page.getByTestId("confirm-design").click();
      await page.getByTestId("verification-run").click();
      await page
        .locator(".verification-summary")
        .getByText("这一版仍有待解决的问题", { exact: true })
        .waitFor();
      assert.deepEqual(
        writes.filter((w) => w.path.endsWith("/run")).map((w) => w.body.mode),
        ["deliver", "verify"],
      );
      assert.equal(await page.locator('.claim-card').count(),1);
      await page.getByRole("button",{name:"完整报告",exact:true}).click();
      assert.equal(await page.getByRole("button",{name:"在模型中定位",exact:true}).count(),2);
      await page
        .getByRole("button", { name: "在模型中定位", exact: true })
        .first()
        .click();
      assert.equal(
        await page.locator(".inspector h3").innerText(),
        "Controller fixture",
      );
      await page
        .getByRole("button", { name: "在模型中定位", exact: true })
        .nth(1)
        .click();
      assert.equal(
        await page
          .locator(".studio-viewport")
          .getAttribute("data-selected-wire"),
        "drive-control",
      );
      await page.screenshot({
        path: path.join(out, "verification-failure.png"),
      });
    },
  );
  await check(
    "failed revision only hands off diagnostics; assembly/slicing remain blocked",
    async () => {
      await phase("export");
      const a = page.getByRole("link", { name: "下载诊断资料包", exact: true });
      await a.waitFor();
      assert.equal(
        await a.getAttribute("href"),
        `/api/studio/jobs/${jobId}/package`,
      );
      await page.getByTestId("assembly-tab").click();
      assert(await page.getByTestId("assembly-mark").isDisabled());
      await page.getByTestId('assembly-player').waitFor();
      const exact=project.designHash;
      await page.getByRole('button',{name:'播放装配动画',exact:true}).click();
      await page.waitForFunction(()=>Number(document.querySelector('.studio-viewport')?.getAttribute('data-assembly-progress'))<1);
      await page.getByRole('button',{name:'暂停装配动画',exact:true}).click();
      assert.equal(await page.getByTestId('assembly-player').getAttribute('data-playing'),'false');
      assert.equal(project.designHash,exact);
      await page.emulateMedia({reducedMotion:'reduce'});
      // matchMedia change and Vue rendering complete asynchronously.
      await page.waitForFunction(() => document.querySelector('.assembly-player-controls button:nth-child(2)')?.disabled && document.querySelector('.studio-viewport')?.getAttribute('data-assembly-progress') === '1');
      assert(await page.getByRole('button',{name:'播放装配动画',exact:true}).isDisabled());
      assert.equal(await page.locator('.studio-viewport').getAttribute('data-assembly-progress'),'1');
      await page.emulateMedia({reducedMotion:'no-preference'});
      assert(
        await page
          .getByRole("checkbox", {
            name: "Power is disconnected.",
            exact: true,
          })
          .isDisabled(),
      );
      await page
        .getByRole("button", { name: "打印与切片", exact: true })
        .click();
      assert(
        await page
          .getByRole("button", { name: "在 DGX 上切片", exact: true })
          .isDisabled(),
      );
      const languageSaved = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/projects/${projectId}/view`) &&
          response.request().method() === "PUT" &&
          response.request().postDataJSON()?.language === "en",
      );
      await page
        .getByRole("button", { name: "切换为英文", exact: true })
        .click();
      await page
        .getByText(
          "Diagnostic only — critical checks failed. Do not manufacture, assemble or energize.",
          { exact: true },
        )
        .waitFor();
      await languageSaved;
    },
  );
  await check(
    "detached verification is quarantined while matching CAD stays diagnostic",
    async () => {
      const saved = clone(job),
        before = designWrites().length;
      job = {
        ...clone(saved),
        cad: nativeCad(),
        verification: {
          ...clone(saved.verification),
          revisionHash: "e".repeat(64),
          overall: "PASS",
          claims: [
            {
              id: "detached-pass",
              label: "Detached report must not appear",
              status: "PASS",
              method: "Fixture",
              observed: 1,
              required: 1,
            },
          ],
        },
      };
      await page.goto(`${base}/?project=${projectId}`, {waitUntil:"domcontentloaded"});
      await page.locator(".studio-viewport").waitFor();
      await phase("verify");
      await page.getByTestId("evidence-mismatch").waitFor();
      assert.equal(await page.locator(".verification-summary").count(), 0);
      assert.equal(await page.locator("[data-claim-id]").count(), 0);
      assert.equal(
        await page
          .getByText("Detached report must not appear", { exact: true })
          .count(),
        0,
      );
      await page.waitForFunction(
        (count) =>
          document
            .querySelector(".studio-viewport")
            ?.getAttribute("data-native-loaded") === String(count),
        project.spec.parts.length,
      );
      assert.equal(
        await page.locator(".viewport-geometry-label.concept").count(),
        0,
      );
      await phase("export");
      await page
        .getByRole("link", { name: "Download diagnostic package", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("link", { name: /^Diagnostic STL/ }).count(),
        project.spec.parts.length,
      );
      assert.equal(
        await page.getByRole("link", { name: "STL", exact: true }).count(),
        0,
      );
      await page.getByTestId("assembly-tab").click();
      assert(await page.getByTestId("assembly-mark").isDisabled());
      assert(
        await page
          .getByRole("checkbox", {
            name: "Power is disconnected.",
            exact: true,
          })
          .isDisabled(),
      );
      await page
        .getByRole("button", { name: "Printing & slicing", exact: true })
        .click();
      assert(
        await page
          .getByRole("button", { name: "Slice on DGX", exact: true })
          .isDisabled(),
      );
      assert.equal(designWrites().length, before);
      await page.screenshot({
        path: path.join(out, "detached-report-diagnostic.png"),
      });
      job = saved;
    },
  );
  await check(
    "DGX disconnection is explicit and does not retain prior design evidence",
    async () => {
      const before = designWrites().length;
      disconnected = true;
      await page.goto(`${base}/?project=${projectId}`, {waitUntil:"domcontentloaded"});
      await page
        .locator(".global-alert.error")
        .getByText("Fixture DGX connection unavailable.", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".studio-viewport").count(), 0);
      assert.equal(await page.locator(".verification-summary").count(), 0);
      assert.equal(designWrites().length, before);
      await page.screenshot({ path: path.join(out, "dgx-disconnected.png") });
      disconnected = false;
    },
  );
  await check(
    "failed native CAD load remains visible without concept fallback",
    async () => {
      const saved = clone(job),
        before = designWrites().length;
      nativeFailure = true;
      job = { ...clone(saved), cad: nativeCad() };
      await page.goto(`${base}/?project=${projectId}`, {waitUntil:"domcontentloaded"});
      await page.locator(".studio-viewport").waitFor();
      await phase("refine");
      await page
        .locator(".viewport-error")
        .filter({ hasText: "No preview substitution." })
        .waitFor();
      assert.equal(
        await page
          .locator(".studio-viewport")
          .getAttribute("data-native-total"),
        String(project.spec.parts.length),
      );
      assert.equal(
        await page
          .locator(".studio-viewport")
          .getAttribute("data-native-loaded"),
        "0",
      );
      assert.equal(
        await page.locator(".viewport-geometry-label.concept").count(),
        0,
      );
      assert(assets.length > 0);
      assert.equal(designWrites().length, before);
      await page.screenshot({ path: path.join(out, "native-cad-failure.png") });
      nativeFailure = false;
      job = saved;
    },
  );
  await check(
    "legacy job URL is read-only; unconfigured model state explicit",
    async () => {
      configured = false;
      await page.goto(`${base}/?job=${jobId}`);
      await page.locator(".studio-viewport").waitFor();
      assert(await page.locator("#studio-composer").isDisabled());
      await page.getByText("Model unconfigured", { exact: true }).waitFor();
      configured = true;
    },
  );
  await check(
    "narrow screen and reduced motion preserve controls without overflow",
    async () => {
      await page.goto(`${base}/?project=${projectId}`, {waitUntil:"domcontentloaded"});
      await page.locator(".studio-viewport").waitFor();
      await phase("refine");
      assert.equal(await page.locator(".assistant-composer header strong").innerText(), "AI", "Unknown fixture model must not be attributed to Qwen");
      assert(await page.getByTestId("confirm-design").isVisible());
      await row("Printed base").locator(".tree-select").click();
      await page.screenshot({
        path: path.join(out, "workspace-refine-desktop.png"),
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert(await page.locator("#studio-composer").isVisible());
      for (const selector of [".language-button", '[data-testid="ai-send"]']) {
        assert(
          await page.locator(selector).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight
            );
          }),
          `${selector} must not be clipped on a narrow screen`,
        );
      }
      assert.notEqual(
        await page
          .getByTestId("ai-send")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      await page.screenshot({ path: path.join(out, "workspace-mobile.png") });
      await page
        .getByRole("button", {
          name: "Toggle outliner & properties",
          exact: true,
        })
        .click();
      await page.locator(".right-panels").waitFor({ state: "visible" });
      assert(await page.locator(".inspector").isVisible());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(out, "workspace-mobile-properties.png"),
      });
      await page
        .getByRole("button", {
          name: "Close outliner and properties",
          exact: true,
        })
        .click();
      await page.locator(".right-panels").waitFor({ state: "hidden" });
      assert(await page.locator("#studio-composer").isVisible());
    },
  );
  await check("local provider settings distinguish saved and unsaved state without silent switching", async () => {
    await page.setViewportSize({width:1440,height:1100});
    await page.getByRole('button',{name:'Runtime & settings',exact:true}).click();
    const dialog=page.locator('dialog[open]');
    await dialog.locator('.model-choice').waitFor();
    assert.equal(settingsWrites.length,0);
    await dialog.getByLabel('DGX inference service',{exact:true}).selectOption('vllm');
    await dialog.getByLabel('Local service endpoint',{exact:true}).fill('http://127.0.0.1:8000');
    await dialog.getByLabel('Exact model name',{exact:true}).fill('fixture-vllm');
    assert.equal(await dialog.locator('.model-choice').count(),0);
    assert(await dialog.getByRole('button',{name:'List models at saved endpoint',exact:true}).isDisabled());
    await dialog.getByText('Unsaved changes — the active model has not changed',{exact:true}).waitFor();
    assert.equal(settingsWrites.length,0);
    await dialog.getByRole('button',{name:'Save settings',exact:true}).click();
    await dialog.getByText('Local inference settings saved; no inference triggered.',{exact:true}).waitFor();
    assert.deepEqual(settingsWrites,[{provider:'vllm',endpoint:'http://127.0.0.1:8000',model:'fixture-vllm'}]);
    assert.equal(await dialog.locator('.runtime-unsaved').count(),0);
    await dialog.getByRole('button',{name:'List models at saved endpoint',exact:true}).click();
    await dialog.locator('.model-choice').filter({hasText:'fixture-vllm'}).waitFor();
    await page.screenshot({path:path.join(out,'local-provider-settings.png')});
    await page.keyboard.press('Escape');
  });
  await check("Qwen and the optional online provider share one workspace without tool links or false source labels", async () => {
    const saved = clone(inferenceSettings), before = designWrites().length;
    let baseline;
    try {
      for (const [provider, model, endpoint] of [
        ['vllm', 'qwen-release-fixture', 'http://127.0.0.1:8000'],
        ['codex-bridge', 'codex-release-fixture', 'http://127.0.0.1:4181'],
      ]) {
        inferenceSettings = {provider, model, endpoint};
        await page.goto(`${base}/?project=${projectId}`, {waitUntil:'domcontentloaded'});
        await page.locator('.studio-viewport').waitFor();
        await phase('refine');
        await page.locator('#studio-composer').waitFor();
        assert.equal(await page.locator('.assistant-composer header strong').innerText(), 'AI');
        assert.equal(await page.locator('a[href*="codex"], a[href*="chatgpt.com"], a[href^="file:"]').count(), 0);
        const layout = await page.evaluate(() => ({
          phases: [...document.querySelectorAll('[data-stage]')].map(el => el.textContent.trim()),
          composer: document.querySelector('#studio-composer').getAttribute('placeholder'),
          controls: [...document.querySelectorAll('.assistant-composer form button,.assistant-composer form select')].map(el => ({tag:el.tagName,label:el.getAttribute('aria-label'),text:el.textContent.trim()})),
          panels: ['.studio-viewport','.outliner','.inspector','.assistant-composer'].map(selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return {selector,width:Math.round(r.width),left:Math.round(r.left)};
          }),
        }));
        if (baseline) assert.deepEqual(layout, baseline, 'Same frontend, controls and panel layout for both providers');
        else baseline = layout;
        await page.screenshot({path:path.join(out, `provider-parity-${provider}.png`)});
        await page.getByRole('button',{name:'Runtime & settings',exact:true}).click();
        const dialog = page.locator('dialog[open]');
        await dialog.locator('.model-choice').waitFor();
        assert.equal(await dialog.getByLabel('Exact model name',{exact:true}).inputValue(), model);
        assert.equal(await dialog.getByLabel('DGX inference service',{exact:true}).inputValue(), provider);
        if (provider === 'codex-bridge') assert((await dialog.innerText()).includes('Not offline'));
        await page.keyboard.press('Escape');
      }
      assert.equal(designWrites().length, before);
    } finally { inferenceSettings = saved; }
  });
  await check("no browser exceptions or hardware actions", async () => {
    assert.deepEqual(errors, []);
    assert.equal(
      writes.some((w) => /slice|printer|config/.test(w.path)),
      false,
    );
  });
} finally {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Mock HTTP browser acceptance only, not Qwen, native CAD or physical evidence.",
        results,
        errors,
        writes,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await vite.close();
}
console.log(JSON.stringify({ results, output: out }, null, 2));
