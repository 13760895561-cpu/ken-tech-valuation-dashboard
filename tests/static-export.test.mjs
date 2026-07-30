import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("static export contains the complete branded dashboard", async () => {
  const [html, chunks, dataset] = await Promise.all([
    readFile(new URL("../out/index.html", import.meta.url), "utf8"),
    readdir(new URL("../out/_next/static/chunks/", import.meta.url)),
    readFile(new URL("../out/data/dashboard.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /科技股长期估值与经营效率看板/);
  assert.ok(chunks.some((name) => name.endsWith(".js")));
  assert.equal(JSON.parse(dataset).snapshot.companies.length, 31);
});

test("embedded delivery data preserves audited coverage", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../lib/seed-data.json", import.meta.url), "utf8"),
  );

  assert.equal(seed.snapshot.companies.length, 31);
  assert.equal(
    seed.snapshot.companies.filter((company) => company.market === "A").length,
    15,
  );
  assert.equal(seed.events.length, 16);
  assert.ok(seed.history.length >= 15);
  assert.ok(seed.snapshot.companies.every((company) => company.currency));
  assert.ok(seed.snapshot.companies.every((company) => company.report_period));
});

test("GitHub Pages mode keeps live refresh and persistence explicit", async () => {
  const [component, config, workflow, refreshScript] = await Promise.all([
    readFile(new URL("../components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../.github/workflows/pages.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/refresh-static-data.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(config, /output: "export"/);
  assert.match(config, /basePath/);
  assert.match(component, /refreshMarketDataset/);
  assert.match(component, /MANUAL_REFRESH_COOLDOWN_MS = 60_000/);
  assert.doesNotMatch(component, /\/api\/dashboard/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run refresh:static/);
  assert.match(refreshScript, /public\/data\/dashboard\.json/);
});
