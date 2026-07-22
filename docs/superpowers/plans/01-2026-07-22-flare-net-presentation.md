# Flare Net Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, editable six-slide Flare Net pitch deck for a 90-second presentation followed by a 90-second demo video.

**Architecture:** A small Node.js presentation generator will keep slide content, timing, visual tokens, and speaker notes version-controlled while PptxGenJS produces an editable 16:9 PowerPoint file that imports cleanly into Google Slides. A separate asset-capture script will download the cited flood image and capture the live Flare Net console, keeping content generation deterministic and the deck builder focused.

**Tech Stack:** Node.js, PptxGenJS, Vitest, Playwright, Google Slides import, existing React/Vite Flare Net console

---

## File Map

- `package.json`: add presentation build, asset, and verification commands plus PptxGenJS.
- `package-lock.json`: lock the presentation dependency.
- `presentation/01-content.mjs`: single source of truth for six slides, timing, citations, and speaker notes.
- `presentation/02-content.test.mjs`: validates narrative order, 90-second timing, problem-feature coverage, architecture products, and source separation.
- `presentation/03-capture-assets.mjs`: downloads the cited Accra flood image and captures the local Flare Net console.
- `presentation/04-build-deck.mjs`: defines the visual system and generates the editable deck.
- `presentation/assets/01-accra-flood.jpeg`: cited flood image used on the crisis slides.
- `presentation/assets/02-flare-net-console.png`: current product UI used on the product and demo slides.
- `presentation/output/01-flare-net-pitch.pptx`: generated presentation for Google Slides import.

## Task 1: Lock the Narrative as Tested Data

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `presentation/01-content.mjs`
- Create: `presentation/02-content.test.mjs`

- [ ] **Step 1: Install PptxGenJS and add presentation commands**

Run:

```bash
npm install --save-dev pptxgenjs
```

Add these scripts to `package.json`:

```json
{
  "presentation:assets": "node presentation/03-capture-assets.mjs",
  "presentation:build": "node presentation/04-build-deck.mjs",
  "presentation:test": "vitest run presentation/02-content.test.mjs"
}
```

Expected: `pptxgenjs` appears in `devDependencies`, and `package-lock.json` records the exact version.

- [ ] **Step 2: Write the failing content contract**

Create `presentation/02-content.test.mjs`:

```javascript
import { describe, expect, it } from "vitest";
import { DECK, SLIDES } from "./01-content.mjs";

describe("Flare Net pitch content", () => {
  it("fits the live portion into 90 seconds", () => {
    expect(SLIDES).toHaveLength(6);
    expect(SLIDES.reduce((total, slide) => total + slide.seconds, 0)).toBe(90);
  });

  it("moves from crisis to experience to response to demo", () => {
    expect(SLIDES.map((slide) => slide.id)).toEqual([
      "crisis",
      "experience",
      "response-gaps",
      "product",
      "architecture",
      "demo",
    ]);
  });

  it("keeps testimony and reporting as separate sources", () => {
    expect(SLIDES[0].source.type).toBe("reported");
    expect(SLIDES[1].source.type).toBe("personal-testimony");
    expect(SLIDES[1].source.label).toContain("team member");
  });

  it("derives product capabilities from response problems", () => {
    expect(SLIDES[2].mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ problem: expect.stringContaining("simultaneously"), feature: expect.stringContaining("queue") }),
      expect.objectContaining({ problem: expect.stringContaining("location"), feature: expect.stringContaining("Map") }),
      expect.objectContaining({ problem: expect.stringContaining("disconnect"), feature: expect.stringContaining("saving") }),
      expect.objectContaining({ problem: expect.stringContaining("Languages"), feature: expect.stringContaining("translation") }),
      expect.objectContaining({ problem: expect.stringContaining("Mobility"), feature: expect.stringContaining("Accessibility") }),
    ]));
  });

  it("names the intended Cloudflare architecture", () => {
    expect(SLIDES[4].products).toEqual([
      "Workers",
      "Durable Objects",
      "D1",
      "R2",
      "Queues",
      "Workers AI",
      "Workers Static Assets",
    ]);
  });

  it("uses the approved product name", () => {
    expect(DECK.title).toBe("Flare Net");
    expect(JSON.stringify(SLIDES)).not.toContain("Crisis Mesh");
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
npm run presentation:test
```

Expected: FAIL because `presentation/01-content.mjs` does not exist.

- [ ] **Step 4: Add the approved slide content and speaker notes**

Create `presentation/01-content.mjs`:

```javascript
export const DECK = {
  title: "Flare Net",
  subtitle: "From fragmented calls to coordinated action",
  author: "Flare Net team",
  subject: "Three-minute personal presentation and product demo",
};

export const SLIDES = [
  {
    id: "crisis",
    seconds: 15,
    kicker: "GREATER ACCRA · 29 JUNE 2026",
    title: "When the rain comes, entire communities can be cut off overnight.",
    body: "Homes submerged. Roads blocked. Residents trapped.",
    source: {
      type: "reported",
      label: "Citi Newsroom, 29 June 2026",
      url: "https://www.citinewsroom.com/2026/06/accra-floods-homes-submerged-residents-trapped-as-roads-are-blocked/",
    },
    notes: "Flooding is not an abstract risk in Ghana. On June 29, rain beginning around 10 p.m. submerged homes and roads across parts of Accra and trapped residents overnight.",
  },
  {
    id: "experience",
    seconds: 15,
    kicker: "FOR OUR TEAMMATE, IT WAS PERSONAL",
    title: "We woke up to water filling homes.",
    quote: "Streets became rivers. Cars were swept away, and people who could not swim had nowhere to go.",
    source: { type: "personal-testimony", label: "Flare Net team member, July 2026" },
    notes: "Deliver this slide in first person. Add the details about broken walls, submerged cars, children and older people at risk, and neighbors searching for help. Do not read the slide verbatim.",
  },
  {
    id: "response-gaps",
    seconds: 25,
    kicker: "WHERE EMERGENCY RESPONSE BREAKS",
    title: "Every failure shaped a feature.",
    mappings: [
      { problem: "Many people need help simultaneously", feature: "Prioritized incident queue" },
      { problem: "Callers cannot communicate location", feature: "Map-based incident pings" },
      { problem: "Calls disconnect and networks fail", feature: "Progressive saving and delayed sync" },
      { problem: "Languages differ", feature: "Live transcription and translation" },
      { problem: "Mobility risks surface too late", feature: "Accessibility and vulnerability fields" },
      { problem: "Updates arrive across channels", feature: "One evidence-linked report" },
    ],
    source: { type: "product-synthesis", label: "Flare Net project context" },
    notes: "The problem was not a lack of courage from first responders. It was fragmented information arriving faster than people could organize it. Each Flare Net feature comes from one of those response gaps.",
  },
  {
    id: "product",
    seconds: 15,
    kicker: "FLARE NET",
    title: "From a call for help to a responder-ready incident.",
    flow: ["Calls + messages", "AI-assisted intake", "Evidence-linked incident", "Dispatcher approval", "Responders"],
    boundary: "Human dispatchers remain in control.",
    source: { type: "product-synthesis", label: "Flare Net product direction" },
    notes: "Flare Net transcribes, translates, extracts facts and organizes evidence while an authorized dispatcher retains the final decision.",
  },
  {
    id: "architecture",
    seconds: 15,
    kicker: "BUILT FOR DISASTER CONDITIONS",
    title: "Capture now. Coordinate globally. Sync when connections return.",
    resilience: ["Local-first capture", "Delayed synchronization", "Phone + SMS fallback", "Visible connection state"],
    products: ["Workers", "Durable Objects", "D1", "R2", "Queues", "Workers AI", "Workers Static Assets"],
    layers: [
      { label: "PEOPLE + CHANNELS", value: "Phone · SMS · Web · Field teams" },
      { label: "CLOUDFLARE COORDINATION", value: "AI intake · realtime state · durable evidence · surge processing" },
      { label: "HUMAN RESPONSE", value: "Dispatchers approve · responders act" },
    ],
    source: { type: "architecture", label: "Flare Net intended architecture" },
    notes: "Disasters damage connectivity at the moment demand spikes. Flare Net captures locally, queues changes, and synchronizes when a connection returns. Cloudflare provides the distributed coordination layer.",
  },
  {
    id: "demo",
    seconds: 5,
    kicker: "90-SECOND DEMO",
    title: "See fragmented information become coordinated action.",
    source: { type: "product-demo", label: "Flare Net console" },
    notes: "Start the video immediately. Show intake, progressive extraction, map location, evidence provenance, dispatcher review, simulated dispatch and status update.",
  },
];
```

- [ ] **Step 5: Run the content contract**

Run:

```bash
npm run presentation:test
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit the tested narrative**

```bash
git add package.json package-lock.json presentation/01-content.mjs presentation/02-content.test.mjs
git commit -m "feat: define Flare Net pitch content"
```

## Task 2: Capture Source and Product Assets

**Files:**
- Create: `presentation/03-capture-assets.mjs`
- Create: `presentation/assets/01-accra-flood.jpeg`
- Create: `presentation/assets/02-flare-net-console.png`

- [ ] **Step 1: Add the deterministic asset-capture script**

Create `presentation/03-capture-assets.mjs`:

```javascript
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const assetsDirectory = new URL("./assets/", import.meta.url);
const floodImage = new URL("./assets/01-accra-flood.jpeg", import.meta.url);
const consoleImage = new URL("./assets/02-flare-net-console.png", import.meta.url);
const floodImageUrl = "https://www.citinewsroom.com/wp-content/uploads/2026/06/cc-flood.jpeg";
const consoleUrl = process.env.FLARE_NET_URL ?? "http://127.0.0.1:5173/incidents/CM-0722-0017";

await mkdir(assetsDirectory, { recursive: true });

const response = await fetch(floodImageUrl);
if (!response.ok) throw new Error(`Flood image download failed: ${response.status}`);
await writeFile(floodImage, Buffer.from(await response.arrayBuffer()));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(consoleUrl, { waitUntil: "networkidle" });
  await page.getByText("Flare Net", { exact: true }).waitFor();
  await page.screenshot({ path: consoleImage.pathname, fullPage: false });
} finally {
  await browser.close();
}

console.log("Captured presentation/assets/01-accra-flood.jpeg");
console.log("Captured presentation/assets/02-flare-net-console.png");
```

- [ ] **Step 2: Confirm the app is available**

Run:

```bash
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:5173/incidents/CM-0722-0017
```

Expected: `200`. If the server is not running, start it in a separate terminal with `npm run dev -- --host 127.0.0.1` and rerun the check.

- [ ] **Step 3: Capture both assets**

Run:

```bash
npm run presentation:assets
```

Expected: both asset paths are printed with no Playwright or HTTP errors.

- [ ] **Step 4: Verify image types and dimensions**

Run:

```bash
file presentation/assets/01-accra-flood.jpeg presentation/assets/02-flare-net-console.png
sips -g pixelWidth -g pixelHeight presentation/assets/01-accra-flood.jpeg presentation/assets/02-flare-net-console.png
```

Expected: valid JPEG and PNG images; console screenshot is `1600 x 900`; both images have non-zero dimensions.

- [ ] **Step 5: Commit the reproducible assets**

```bash
git add presentation/03-capture-assets.mjs presentation/assets/01-accra-flood.jpeg presentation/assets/02-flare-net-console.png
git commit -m "chore: capture Flare Net presentation assets"
```

## Task 3: Generate the Editable Deck

**Files:**
- Create: `presentation/04-build-deck.mjs`
- Create: `presentation/output/01-flare-net-pitch.pptx`

- [ ] **Step 1: Create the deck generator**

Create `presentation/04-build-deck.mjs` with these implementation requirements:

```javascript
import { mkdir } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import { DECK, SLIDES } from "./01-content.mjs";

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = DECK.author;
pptx.title = DECK.title;
pptx.subject = DECK.subject;
pptx.company = "Flare Net";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "IBM Plex Sans",
  bodyFontFace: "IBM Plex Sans",
  lang: "en-US",
};

const C = {
  bg: "071018",
  panel: "0E1A24",
  line: "3B4C59",
  text: "EEF3F6",
  soft: "C3CDD4",
  muted: "8193A1",
  blue: "55A7FF",
  critical: "FF5C62",
  warning: "E9AD45",
  success: "57D293",
  cloudflare: "F48120",
};

const ASSETS = {
  flood: new URL("./assets/01-accra-flood.jpeg", import.meta.url).pathname,
  console: new URL("./assets/02-flare-net-console.png", import.meta.url).pathname,
};

const outputDirectory = new URL("./output/", import.meta.url);
const outputPath = new URL("./output/01-flare-net-pitch.pptx", import.meta.url).pathname;

function baseSlide(content) {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  slide.addText(content.kicker, {
    x: 0.55, y: 0.3, w: 8.8, h: 0.25,
    fontFace: "IBM Plex Mono", fontSize: 8, bold: true,
    color: C.blue, charSpacing: 1.8, margin: 0,
  });
  slide.addText("FLARE NET", {
    x: 11.3, y: 0.3, w: 1.45, h: 0.25,
    fontFace: "IBM Plex Mono", fontSize: 8, bold: true,
    color: C.muted, align: "right", margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.55, y: 0.68, w: 12.23, h: 0,
    line: { color: C.line, width: 0.8 },
  });
  slide.addNotes(content.notes);
  return slide;
}

function addFooter(slide, content) {
  slide.addText(content.source.label, {
    x: 0.55, y: 7.1, w: 8.7, h: 0.18,
    fontFace: "IBM Plex Mono", fontSize: 6.5,
    color: C.muted, margin: 0,
    hyperlink: content.source.url ? { url: content.source.url } : undefined,
  });
  slide.addText(`${content.seconds}s`, {
    x: 12.1, y: 7.1, w: 0.68, h: 0.18,
    fontFace: "IBM Plex Mono", fontSize: 6.5,
    color: C.muted, align: "right", margin: 0,
  });
}

function addCrisisSlide(content) {
  const slide = baseSlide(content);
  slide.addImage({ path: ASSETS.flood, x: 6.45, y: 0.9, w: 6.33, h: 5.95, transparency: 8 });
  slide.addShape(pptx.ShapeType.rect, {
    x: 6.45, y: 0.9, w: 6.33, h: 5.95,
    fill: { color: C.bg, transparency: 62 }, line: { transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 1.05, w: 0.06, h: 4.65,
    fill: { color: C.critical }, line: { transparency: 100 },
  });
  slide.addText(content.title, {
    x: 0.86, y: 1.25, w: 5.65, h: 2.8,
    fontSize: 30, bold: true, color: C.text, breakLine: false,
    margin: 0, valign: "mid", fit: "shrink",
  });
  slide.addText(content.body, {
    x: 0.86, y: 4.42, w: 5.3, h: 0.55,
    fontSize: 14, color: C.soft, margin: 0,
  });
  addFooter(slide, content);
}

function addExperienceSlide(content) {
  const slide = baseSlide(content);
  slide.addImage({ path: ASSETS.flood, x: 0.55, y: 0.9, w: 4.4, h: 5.9 });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.9, w: 4.4, h: 5.9,
    fill: { color: C.bg, transparency: 45 }, line: { color: C.line, width: 1 },
  });
  slide.addText(content.title, {
    x: 5.45, y: 1.25, w: 6.7, h: 1.25,
    fontSize: 30, bold: true, color: C.text, margin: 0,
  });
  slide.addText(`“${content.quote}”`, {
    x: 5.45, y: 2.75, w: 6.65, h: 2.45,
    fontSize: 22, italic: true, color: C.soft, margin: 0,
    breakLine: false, fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 5.45, y: 5.55, w: 2.2, h: 0,
    line: { color: C.critical, width: 3 },
  });
  addFooter(slide, content);
}

function addResponseGapsSlide(content) {
  const slide = baseSlide(content);
  slide.addText(content.title, {
    x: 0.55, y: 0.95, w: 8.5, h: 0.65,
    fontSize: 27, bold: true, color: C.text, margin: 0,
  });
  content.mappings.forEach((mapping, index) => {
    const row = index % 3;
    const column = Math.floor(index / 3);
    const x = 0.55 + column * 6.16;
    const y = 1.9 + row * 1.55;
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: 5.72, h: 1.15,
      fill: { color: C.panel }, line: { color: C.line, width: 1 },
    });
    slide.addText(mapping.problem.toUpperCase(), {
      x: x + 0.2, y: y + 0.16, w: 2.45, h: 0.72,
      fontFace: "IBM Plex Mono", fontSize: 8.5, bold: true,
      color: C.warning, margin: 0, fit: "shrink", valign: "mid",
    });
    slide.addText("→", {
      x: x + 2.62, y: y + 0.3, w: 0.38, h: 0.4,
      fontSize: 17, color: C.blue, align: "center", margin: 0,
    });
    slide.addText(mapping.feature, {
      x: x + 3.08, y: y + 0.16, w: 2.38, h: 0.72,
      fontSize: 12, bold: true, color: C.text,
      margin: 0, fit: "shrink", valign: "mid",
    });
  });
  addFooter(slide, content);
}

function addProductSlide(content) {
  const slide = baseSlide(content);
  slide.addText(content.title, {
    x: 0.55, y: 0.95, w: 6.1, h: 1.15,
    fontSize: 29, bold: true, color: C.text, margin: 0, fit: "shrink",
  });
  slide.addText(content.boundary, {
    x: 0.55, y: 2.3, w: 5.5, h: 0.35,
    fontSize: 13, bold: true, color: C.success, margin: 0,
  });
  slide.addImage({ path: ASSETS.console, x: 6.55, y: 0.95, w: 6.23, h: 3.5 });
  slide.addShape(pptx.ShapeType.rect, {
    x: 6.55, y: 0.95, w: 6.23, h: 3.5,
    fill: { transparency: 100 }, line: { color: C.line, width: 1.2 },
  });
  content.flow.forEach((label, index) => {
    const x = 0.55 + index * 2.46;
    slide.addText(label, {
      x, y: 5.15, w: 1.92, h: 0.65,
      shape: pptx.ShapeType.rect,
      fill: { color: index === 3 ? "153425" : C.panel },
      line: { color: index === 3 ? C.success : C.line, width: 1 },
      fontFace: "IBM Plex Mono", fontSize: 8.5, bold: true,
      color: C.text, align: "center", valign: "mid", margin: 0.08,
    });
    if (index < content.flow.length - 1) {
      slide.addText("→", { x: x + 1.98, y: 5.29, w: 0.42, h: 0.3, fontSize: 13, color: C.blue, align: "center", margin: 0 });
    }
  });
  addFooter(slide, content);
}

function addArchitectureSlide(content) {
  const slide = baseSlide(content);
  slide.addText(content.title, {
    x: 0.55, y: 0.92, w: 9.8, h: 0.85,
    fontSize: 25, bold: true, color: C.text, margin: 0,
  });
  content.layers.forEach((layer, index) => {
    const y = 1.95 + index * 1.35;
    const accent = index === 1 ? C.cloudflare : index === 2 ? C.success : C.blue;
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y, w: 8.2, h: 0.95,
      fill: { color: C.panel }, line: { color: accent, width: 1.2 },
    });
    slide.addText(layer.label, {
      x: 0.82, y: y + 0.16, w: 2.25, h: 0.25,
      fontFace: "IBM Plex Mono", fontSize: 8, bold: true,
      color: accent, margin: 0,
    });
    slide.addText(layer.value, {
      x: 0.82, y: y + 0.46, w: 7.45, h: 0.27,
      fontSize: 12, color: C.text, margin: 0,
    });
  });
  slide.addText("CLOUDFLARE PRODUCTS", {
    x: 9.2, y: 1.95, w: 3.3, h: 0.25,
    fontFace: "IBM Plex Mono", fontSize: 8, bold: true,
    color: C.cloudflare, charSpacing: 1.3, margin: 0,
  });
  content.products.forEach((product, index) => {
    slide.addText(product, {
      x: 9.2, y: 2.38 + index * 0.56, w: 3.05, h: 0.35,
      fontFace: "IBM Plex Mono", fontSize: 10, bold: index < 2,
      color: index < 2 ? C.text : C.soft, margin: 0,
    });
  });
  addFooter(slide, content);
}

function addDemoSlide(content) {
  const slide = baseSlide(content);
  slide.addImage({ path: ASSETS.console, x: 0.55, y: 0.95, w: 12.23, h: 5.9 });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 0.95, w: 12.23, h: 5.9,
    fill: { color: C.bg, transparency: 26 }, line: { color: C.line, width: 1 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 5.86, y: 2.27, w: 1.62, h: 1.62,
    fill: { color: C.blue, transparency: 4 }, line: { color: "FFFFFF", transparency: 35, width: 1.5 },
  });
  slide.addText("▶", {
    x: 6.08, y: 2.58, w: 1.23, h: 0.62,
    fontSize: 27, color: "FFFFFF", align: "center", margin: 0,
  });
  slide.addText(content.title, {
    x: 1.4, y: 5.38, w: 10.55, h: 0.8,
    fontSize: 25, bold: true, color: C.text, align: "center", margin: 0,
  });
  addFooter(slide, content);
}

const builders = {
  crisis: addCrisisSlide,
  experience: addExperienceSlide,
  "response-gaps": addResponseGapsSlide,
  product: addProductSlide,
  architecture: addArchitectureSlide,
  demo: addDemoSlide,
};

for (const content of SLIDES) builders[content.id](content);

await mkdir(outputDirectory, { recursive: true });
await pptx.writeFile({ fileName: outputPath });
console.log(`Generated ${outputPath}`);
```

- [ ] **Step 2: Generate the deck**

Run:

```bash
npm run presentation:build
```

Expected: `presentation/output/01-flare-net-pitch.pptx` is generated without warnings or exceptions.

- [ ] **Step 3: Verify the PPTX package and slide count**

Run:

```bash
unzip -t presentation/output/01-flare-net-pitch.pptx
unzip -l presentation/output/01-flare-net-pitch.pptx | rg 'ppt/slides/slide[0-9]+\.xml$' | wc -l
```

Expected: archive test reports no errors and the slide count is `6`.

- [ ] **Step 4: Verify required text is embedded**

Run:

```bash
rm -rf "/var/folders/df/_5ydvbh1203fp2yh9bdpj1nr0000gn/T/opencode/flare-net-pptx-check"
mkdir "/var/folders/df/_5ydvbh1203fp2yh9bdpj1nr0000gn/T/opencode/flare-net-pptx-check"
unzip -q presentation/output/01-flare-net-pitch.pptx -d "/var/folders/df/_5ydvbh1203fp2yh9bdpj1nr0000gn/T/opencode/flare-net-pptx-check"
rg "When the rain comes|FOR OUR TEAMMATE|Every failure shaped a feature|From a call for help|BUILT FOR DISASTER CONDITIONS|90-SECOND DEMO" "/var/folders/df/_5ydvbh1203fp2yh9bdpj1nr0000gn/T/opencode/flare-net-pptx-check/ppt/slides"
```

Expected: all six slide phrases are found in the generated XML.

- [ ] **Step 5: Commit the generator and artifact**

```bash
git add presentation/04-build-deck.mjs presentation/output/01-flare-net-pitch.pptx
git commit -m "feat: generate Flare Net pitch deck"
```

## Task 4: Perform Final Deck QA and Google Slides Handoff

**Files:**
- Modify: `presentation/01-content.mjs` only if rehearsal reveals timing or wording problems
- Regenerate: `presentation/output/01-flare-net-pitch.pptx`

- [ ] **Step 1: Run the complete project verification**

Run:

```bash
npm run presentation:test
npm test
npm run build
npm run presentation:build
unzip -t presentation/output/01-flare-net-pitch.pptx
```

Expected: presentation tests, application tests, and application build pass; deck regeneration succeeds; the PPTX archive contains no errors.

- [ ] **Step 2: Import the editable deck into the provided Google Slides file**

Open the provided presentation, then use `File -> Import slides -> Upload` and select:

```text
/Users/ivanchen/team-name-hackathon/presentation/output/01-flare-net-pitch.pptx
```

Select all six slides and import them. Remove the original blank slide after confirming the imported slides are present.

- [ ] **Step 3: Check the Google Slides rendering**

Verify each slide at presentation size:

```text
Slide 1: flood photo fills the right side and source footer is readable
Slide 2: quote has no clipping and remains the dominant element
Slide 3: all six problem-to-feature cards fit without wrapping collisions
Slide 4: console screenshot is sharp and the five-step flow is readable
Slide 5: three architecture layers and seven product names are visible
Slide 6: demo transition is readable over the console screenshot
```

Expected: no clipped text, missing images, font substitutions that break wrapping, or objects outside the 16:9 canvas.

- [ ] **Step 4: Rehearse the live section with a stopwatch**

Use the speaker notes and stop at the demo handoff.

Expected: the live section lands between `1:20` and `1:30`; the team member tells the personal account in first person; the architecture explanation takes no more than 15 seconds.

- [ ] **Step 5: Make only evidence-based final adjustments**

If a slide overruns, remove spoken detail before shrinking text. If Google Slides substitutes IBM Plex, install or select IBM Plex Sans and IBM Plex Mono in the Slides font picker. Regenerate the PPTX after any content changes and rerun `npm run presentation:test`.

- [ ] **Step 6: Commit final rehearsal adjustments**

```bash
git add presentation/01-content.mjs presentation/output/01-flare-net-pitch.pptx
git commit -m "docs: finalize Flare Net pitch timing"
```
