import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  buildDashboardData,
  deriveCompanies,
  isValuationTarget,
} from "../lib/model.ts";

test("valuation targets prefer the explicit flag and preserve the legacy focus rule", () => {
  assert.equal(
    isValuationTarget({ market: "A", role: "重点观察" }),
    true,
  );
  assert.equal(
    isValuationTarget({ market: "A", role: "A股可比" }),
    false,
  );
  assert.equal(
    isValuationTarget({
      market: "A",
      role: "重点观察",
      valuation_target: false,
    }),
    false,
  );
  assert.equal(
    isValuationTarget({
      market: "US",
      role: "全球参考",
      valuation_target: true,
    }),
    true,
  );
});

test("static export contains the complete branded dashboard", async () => {
  const [html, chunks, dataset] = await Promise.all([
    readFile(new URL("../out/index.html", import.meta.url), "utf8"),
    readdir(new URL("../out/_next/static/chunks/", import.meta.url)),
    readFile(new URL("../out/data/dashboard.json", import.meta.url), "utf8"),
  ]);

  assert.match(html, /科技股长期估值与经营效率看板/);
  assert.ok(chunks.some((name) => name.endsWith(".js")));
  assert.equal(JSON.parse(dataset).snapshot.companies.length, 61);
});

test("embedded delivery data preserves audited coverage", async () => {
  const seed = JSON.parse(
    await readFile(new URL("../lib/seed-data.json", import.meta.url), "utf8"),
  );

  const companies = seed.snapshot.companies;
  const valuationTargets = companies.filter(isValuationTarget);
  const dashboard = buildDashboardData(seed);

  assert.equal(companies.length, 61);
  assert.equal(valuationTargets.length, 15);
  assert.equal(dashboard.summary.companyCount, 61);
  assert.equal(dashboard.summary.targetCompanyCount, 15);
  assert.equal(dashboard.valuations.length, 15);
  assert.deepEqual(
    dashboard.valuations.map((company) => company.id).sort(),
    valuationTargets.map((company) => company.id).sort(),
  );
  assert.equal(seed.events.length, 16);
  assert.ok(seed.history.length >= 15);
  assert.ok(companies.every((company) => company.currency));
  assert.ok(companies.every((company) => company.quote_currency));
  assert.ok(
    companies.every((company) => company.financial_currency),
  );
  assert.ok(
    companies.every(
      (company) => Number.isFinite(company.quote_fx_to_cny),
    ),
  );
  assert.ok(
    companies.every(
      (company) => Number.isFinite(company.financial_fx_to_cny),
    ),
  );
  assert.ok(companies.every((company) => company.report_period));
  for (const field of [
    "revenue_local_100m",
    "gross_profit_local_100m",
    "net_profit_local_100m",
    "ocf_local_100m",
    "capex_local_100m",
    "cash_local_100m",
    "debt_local_100m",
    "employees",
  ]) {
    assert.ok(
      companies.every((company) => Number.isFinite(company[field])),
      `${field} must be complete for all 61 default companies`,
    );
  }
  assert.ok(
    companies.every(
      (company) =>
        String(company.official_report_source).startsWith("https://") &&
        !String(company.official_report_source).includes("eastmoney.com"),
    ),
    "official report evidence must not point to the structured-data provider",
  );
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

test("financial automation preserves expanded-universe audit controls", async () => {
  const [prepareFinancials, applyFinancials, updateData] = await Promise.all([
    readFile(
      new URL("../scripts/prepare-financial-input.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/apply-financial-snapshot.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../automation/scripts/update_data.py", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(prepareFinancials, /"09888": "BIDU"/);
  assert.match(prepareFinancials, /official_report_source_override/);
  assert.match(prepareFinancials, /valuation_target:/);
  assert.match(prepareFinancials, /normalizedCurrency/);

  assert.match(updateData, /TENCENT_FX_SOURCE/);
  assert.match(updateData, /"whEURCNY": \("EUR", False\)/);
  assert.match(updateData, /"whTWDCNY": \("TWD", False\)/);
  assert.match(updateData, /required_currencies/);
  assert.match(updateData, /def is_valuation_target/);
  assert.match(updateData, /if not is_valuation_target\(company\):/);
  assert.match(updateData, /removesuffix\("\.HK"\)/);
  assert.match(updateData, /CURRENT_FX = fetch_fx\(companies\)/);
  assert.match(updateData, /official_report_source_override/);
  assert.match(updateData, /official_report_source_override_report_date/);
  assert.match(updateData, /"40-F"/);

  assert.match(
    applyFinancials,
    /currentEmployees !== null && currentEmployees > 0/,
  );
  assert.match(
    applyFinancials,
    /candidateEmployees !== null && candidateEmployees > 0/,
  );
  assert.match(applyFinancials, /official_report_source_override/);
  assert.match(
    applyFinancials,
    /official_report_source_override_report_date/,
  );
});

test("GitHub Pages mode keeps live refresh and persistence explicit", async () => {
  const [
    component,
    customFinancials,
    customFinancialCache,
    watchPool,
    config,
    workflow,
    refreshScript,
    marketRefresh,
  ] =
    await Promise.all([
    readFile(new URL("../components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/custom-financials.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/custom-financial-cache.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/watch-pool.ts", import.meta.url), "utf8"),
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
  assert.match(component, /导出 Excel/);
  assert.match(component, /完整观察池/);
  assert.match(
    component,
    /await import\("@\/lib\/excel-export"\)/,
    "工作簿代码应在用户点击导出时才动态载入",
  );
  assert.match(component, /delete shareable\.customNote/);
  assert.match(component, /valuations: activeValuations/);
  assert.match(component, /events: scopedEvents/);
  assert.match(component, /history: scopedHistory/);
  assert.match(component, /filters: \{ query, group, region \}/);
  assert.match(component, /aria-describedby="excel-export-feedback"/);
  assert.match(component, /aria-live=/);
  assert.match(component, /fetchCustomFinancials/);
  assert.match(component, /deriveCompanies/);
  assert.doesNotMatch(component, /用户自定义（仅行情）/);
  assert.match(customFinancials, /RPT_F10_FINANCE_MAINFINADATA/);
  assert.match(customFinancials, /RPT_HKF10_FN_MAININDICATOR/);
  assert.match(customFinancials, /RPT_USF10_FN_GMAININDICATOR/);
  assert.match(customFinancialCache, /CUSTOM_FINANCIAL_RETRY_TTL_MS/);
  assert.match(customFinancialCache, /mergeCustomFinancialRefresh/);
  assert.match(watchPool, /financialCache/);
  assert.doesNotMatch(component, /\/api\/dashboard/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run refresh:static/);
  assert.match(refreshScript, /public\/data\/dashboard\.json/);
  assert.match(marketRefresh, /quote_fx_to_cny: quoteFxToCny/);
  assert.match(marketRefresh, /financial_fx_to_cny: financialFxToCny/);
});
