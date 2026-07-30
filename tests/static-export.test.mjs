import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { deriveCompanies } from "../lib/model.ts";

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
  assert.ok(seed.snapshot.companies.every((company) => company.quote_currency));
  assert.ok(
    seed.snapshot.companies.every((company) => company.financial_currency),
  );
  assert.ok(
    seed.snapshot.companies.every(
      (company) => Number.isFinite(company.quote_fx_to_cny),
    ),
  );
  assert.ok(
    seed.snapshot.companies.every(
      (company) => Number.isFinite(company.financial_fx_to_cny),
    ),
  );
  assert.ok(seed.snapshot.companies.every((company) => company.report_period));
  assert.ok(seed.history.every((row) => row.行情币种 && row.财务币种));
});

test("quote and financial currencies are converted independently", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../lib/seed-data.json", import.meta.url), "utf8"),
  );
  const hongKongCompanies = seed.snapshot.companies.filter(
    (company) => company.id === "00700" || company.id === "09988",
  );
  assert.equal(hongKongCompanies.length, 2);

  for (const company of hongKongCompanies) {
    assert.equal(company.quote_currency, "HKD");
    assert.equal(company.financial_currency, "CNY");
    assert.equal(company.financial_fx_to_cny, 1);
    const [derived] = deriveCompanies([company]);
    assert.equal(
      derived.currentMarketCapCny100m,
      company.market_cap_local_100m * company.quote_fx_to_cny,
    );
    assert.equal(derived.revenueCny100m, company.revenue_local_100m);
    assert.notEqual(
      derived.revenueCny100m,
      company.revenue_local_100m * company.quote_fx_to_cny,
    );
  }

  const legacy = {
    ...hongKongCompanies[0],
    quote_currency: undefined,
    financial_currency: undefined,
    quote_fx_to_cny: undefined,
    financial_fx_to_cny: undefined,
  };
  const [legacyDerived] = deriveCompanies([legacy]);
  assert.equal(
    legacyDerived.currentMarketCapCny100m,
    legacy.market_cap_local_100m * legacy.fx_to_cny,
  );
  assert.equal(
    legacyDerived.revenueCny100m,
    legacy.revenue_local_100m * legacy.fx_to_cny,
  );

  const partiallyMigrated = {
    ...legacy,
    financial_currency: "CNY",
  };
  const [partiallyMigratedDerived] = deriveCompanies([partiallyMigrated]);
  assert.equal(
    partiallyMigratedDerived.revenueCny100m,
    partiallyMigrated.revenue_local_100m,
  );
});

test("GitHub Pages mode keeps live refresh and persistence explicit", async () => {
  const [component, config, workflow, refreshScript, marketRefresh] =
    await Promise.all([
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
    readFile(new URL("../lib/market-refresh.ts", import.meta.url), "utf8"),
  ]);

  assert.match(config, /output: "export"/);
  assert.match(config, /basePath/);
  assert.match(component, /refreshMarketDataset/);
  assert.match(component, /MANUAL_REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(component, /WatchPoolManager/);
  assert.match(component, /activeDefaultIds/);
  assert.match(component, /scopeRowsToActiveCompanies/);
  assert.match(component, /customCompanyView/);
  assert.doesNotMatch(component, /\/api\/dashboard/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run refresh:static/);
  assert.match(refreshScript, /public\/data\/dashboard\.json/);
  assert.match(marketRefresh, /quote_fx_to_cny: quoteFxToCny/);
  assert.match(marketRefresh, /financial_fx_to_cny: financialFxToCny/);
});
