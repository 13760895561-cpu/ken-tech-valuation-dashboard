import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  WATCH_POOL_EXPORT_KIND,
  WATCH_POOL_VERSION,
  createCustomWatchCompany,
  createWatchPoolSyncCode,
  emptyWatchPoolState,
  mergeWatchPoolStates,
  normalizeQuoteCode,
  parseWatchPoolImport,
  sanitizeCustomFinancialSnapshot,
  sanitizeWatchPoolState,
  serializeWatchPoolExport,
  type WatchPoolState,
} from "../lib/watch-pool";
import {
  buildWatchSearchCatalog,
  getWatchSearchAvailability,
  normalizeWatchSearch,
  parseSecurityCatalog,
  resolveWatchSearchKey,
  searchWatchCatalog,
} from "../lib/watch-search";

const DEFAULT_IDS = ["smic", "naura", "tencent"];

test("single-input stock search normalizes punctuation, spaces, and case", () => {
  assert.equal(normalizeWatchSearch(" 688825.SH "), "688825SH");
  assert.equal(normalizeWatchSearch("Zhong-Ji Xu.Chuang"), "ZHONGJIXUCHUANG");
  assert.equal(normalizeWatchSearch(" CX-MT "), "CXMT");
  assert.equal(normalizeWatchSearch("ｎｖｄａ"), "NVDA");
});

test("single-input stock search matches code, Chinese, English, and pinyin initials", () => {
  const catalog = buildWatchSearchCatalog([
    {
      id: "NVDA",
      name: "英伟达",
      ticker: "NVDA",
      group: "AI算力芯片",
      region: "美股",
    },
    {
      id: "300308",
      name: "中际旭创",
      ticker: "300308.SZ",
      group: "光模块",
      region: "A股",
    },
    {
      id: "00700",
      name: "腾讯控股",
      ticker: "00700.HK",
      group: "互联网平台",
      region: "港股",
    },
  ]);

  for (const query of [
    "NVDA",
    "NVIDIA",
    "Nvidia",
    "英伟达",
    "yingweida",
    "ywd",
  ]) {
    const result = searchWatchCatalog(query, catalog);
    assert.equal(result[0]?.defaultId, "NVDA", query);
  }
  for (const query of [
    "300308",
    "300308.SZ",
    "SZ300308",
    "３００３０８．ＳＺ",
    "中际旭创",
    "Zhongji Innolight",
    "zj-xc",
  ]) {
    const result = searchWatchCatalog(query, catalog);
    assert.equal(result[0]?.defaultId, "300308", query);
  }
  for (const query of [
    "688825",
    "688825.SH",
    "SH688825",
    "长鑫",
    "长鑫科技",
    "ChangXin",
    "CXMT",
    "cx-kj",
    "changxinkeji",
  ]) {
    const result = searchWatchCatalog(query, catalog);
    assert.equal(result[0]?.ticker, "688825.SH", query);
    assert.equal(result[0]?.quoteCode, "sh688825", query);
  }
  for (const query of [
    "00700",
    "00700.HK",
    "HK00700",
    "００７００．ＨＫ",
    "腾讯",
    "Tencent",
  ]) {
    const result = searchWatchCatalog(query, catalog);
    assert.equal(result[0]?.defaultId, "00700", query);
  }
});

test("shipped security catalog has a valid full-market shape and feeds normalized search", () => {
  const document = JSON.parse(
    readFileSync(
      new URL("../public/data/security-catalog.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  const directory = parseSecurityCatalog(document);
  assert.ok(directory.length > 5_000);

  const catalog = buildWatchSearchCatalog([], directory);
  for (const query of [
    "688825.SH",
    "长鑫",
    "Chang-Xin",
    "cxkj",
    "changxinkeji",
  ]) {
    const result = searchWatchCatalog(query, catalog);
    assert.equal(result[0]?.ticker, "688825.SH", query);
    assert.equal(result[0]?.quoteCode, "sh688825", query);
  }

  const zhongji = searchWatchCatalog("zj xc", catalog)[0];
  assert.equal(zhongji?.ticker, "300308.SZ");
  assert.equal(searchWatchCatalog("００７００．ＨＫ", catalog)[0]?.ticker, "00700.HK");
});

test("search state restores hidden defaults, disables duplicates, and protects IME composition", () => {
  const catalog = buildWatchSearchCatalog([
    {
      id: "NVDA",
      name: "英伟达",
      ticker: "NVDA",
      group: "AI算力芯片",
      region: "美股",
    },
  ]);
  const nvda = searchWatchCatalog("NVDA", catalog)[0];
  const longxin = searchWatchCatalog("688825", catalog)[0];

  assert.equal(getWatchSearchAvailability(nvda, [], []), "default-visible");
  assert.equal(
    getWatchSearchAvailability(nvda, ["NVDA"], []),
    "default-hidden",
  );
  assert.equal(getWatchSearchAvailability(longxin, [], []), "available");
  assert.equal(
    getWatchSearchAvailability(longxin, [], [
      {
        market: "A",
        ticker: "688825.SH",
        quoteCode: "sh688825",
      },
    ]),
    "custom-added",
  );

  assert.deepEqual(
    resolveWatchSearchKey("Enter", true, "英伟达", 3, 1),
    { type: "none", index: 1 },
  );
  assert.deepEqual(
    resolveWatchSearchKey("ArrowDown", false, "英伟达", 3, 1),
    { type: "move", index: 2 },
  );
  assert.deepEqual(
    resolveWatchSearchKey("Enter", false, "英伟达", 3, 2),
    { type: "select", index: 2 },
  );
  assert.deepEqual(
    resolveWatchSearchKey("Escape", false, "英伟达", 3, 2),
    { type: "clear", index: 0 },
  );
});

test("normalizes A/HK/US quote codes and creates the Longxin preset shape", () => {
  const longxin = createCustomWatchCompany({
    name: "长鑫科技",
    ticker: "688825",
    market: "A",
    quoteCode: "SH688825",
    note: "仅行情",
  });

  assert.match(longxin.id, /^custom:/);
  assert.equal(longxin.ticker, "688825.SH");
  assert.equal(longxin.quoteCode, "sh688825");
  assert.equal(longxin.region, "A股");
  assert.equal(longxin.currency, "CNY");
  assert.equal(normalizeQuoteCode("HK", "700", null), "hk00700");
  assert.equal(normalizeQuoteCode("US", "NVDA", "USnvda"), "usNVDA");
  assert.equal(normalizeQuoteCode("A", "920001", null), "bj920001");
});

test("JSON and sync-code transfers preserve only watch-pool identity fields", () => {
  const company = createCustomWatchCompany({
    name: "Test Company",
    ticker: "TEST",
    market: "US",
  });
  const state: WatchPoolState = {
    ...emptyWatchPoolState(),
    hiddenDefaultIds: ["smic"],
    customCompanies: [company],
    quoteCache: {
      [company.id]: {
        verifiedName: company.name,
        priceLocal: 12,
        changePct: 0.01,
        quoteDate: "2026-07-30",
        marketCapLocal100m: 20,
        status: "fresh",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    },
    financialCache: {
      [company.id]: {
        reportPeriod: "2026Q2",
        reportDate: "2026-06-30",
        noticeDate: "2026-07-30",
        financialCurrency: "USD",
        revenueLocal100m: 100,
        grossProfitLocal100m: 60,
        netProfitLocal100m: 30,
        ocfLocal100m: 35,
        capexLocal100m: 8,
        cashLocal100m: 50,
        debtLocal100m: 10,
        employees: 1_000,
        revenueGrowth: 0.2,
        grossMargin: 0.6,
        netMargin: 0.3,
        roic: 0.25,
        structuredSource: "https://example.com/filing",
        status: "fresh",
        message: "sensitive local cache",
        errors: [],
        updatedAt: "2026-07-30T01:00:00.000Z",
        dataQualityScore: 96,
      },
    },
  };

  for (const transfer of [
    serializeWatchPoolExport(state, DEFAULT_IDS),
    createWatchPoolSyncCode(state, DEFAULT_IDS),
  ]) {
    const imported = parseWatchPoolImport(transfer, DEFAULT_IDS);
    assert.deepEqual(imported.state.hiddenDefaultIds, ["smic"]);
    assert.equal(imported.state.customCompanies.length, 1);
    assert.equal(imported.state.customCompanies[0].ticker, "TEST");
    assert.deepEqual(imported.state.quoteCache, {});
    assert.deepEqual(imported.state.financialCache, {});
    assert.doesNotMatch(
      transfer,
      /priceLocal|marketCapLocal100m|financialCache|revenueLocal100m|sensitive local cache/,
    );
  }
});

test("import rejects foreign financial payloads by strict reconstruction", () => {
  const payload = {
    kind: WATCH_POOL_EXPORT_KIND,
    version: WATCH_POOL_VERSION,
    hiddenDefaultIds: ["smic", "unknown-id"],
    quoteCache: {
      "custom:hostile": {
        priceLocal: 999,
      },
    },
    financialCache: {
      "custom:hostile": {
        status: "fresh",
        revenueLocal100m: 999,
        modelCenter: 888,
      },
    },
    customCompanies: [
      {
        id: "custom:hostile",
        name: "Hostile Payload",
        ticker: "688825",
        market: "A",
        quoteCode: "sh688825",
        note: "identity only",
        employees: 10,
        revenue: 999,
        modelCenter: 888,
        valuation: { low: 1, high: 2 },
        financialCache: { revenueLocal100m: 999 },
      },
      {
        name: "",
        ticker: "",
        market: "INVALID",
        financials: { revenue: 1 },
      },
    ],
  };

  const imported = parseWatchPoolImport(
    JSON.stringify(payload),
    DEFAULT_IDS,
  );
  assert.deepEqual(imported.state.hiddenDefaultIds, ["smic"]);
  assert.equal(imported.state.customCompanies.length, 1);
  assert.deepEqual(imported.state.quoteCache, {});
  assert.deepEqual(imported.state.financialCache, {});
  assert.equal(imported.summary.skippedHiddenCount, 1);
  assert.equal(imported.summary.skippedCustomCount, 1);
  assert.equal(imported.summary.discardedFinancialFieldCount, 6);

  const reconstructed = imported.state.customCompanies[0] as unknown as Record<
    string,
    unknown
  >;
  for (const field of [
    "employees",
    "revenue",
    "modelCenter",
    "valuation",
    "financials",
    "financialCache",
  ]) {
    assert.equal(Object.hasOwn(reconstructed, field), false);
  }
});

test("financial cache is strictly allowlisted, custom-only, and compatible with old v1 state", () => {
  const company = createCustomWatchCompany({
    name: "Financial Cache Test",
    ticker: "NVDA",
    market: "US",
  });
  const rawSnapshot = {
    reportPeriod: "FY2026",
    reportDate: "2026-01-31",
    noticeDate: "2026-02-25",
    financialCurrency: "usd",
    revenueLocal100m: 1_305.5,
    grossProfitLocal100m: 920.25,
    netProfitLocal100m: 700.1,
    ocfLocal100m: 750,
    capexLocal100m: 28.5,
    cashLocal100m: 430,
    debtLocal100m: 85,
    employees: 36_000.9,
    revenueGrowth: 0.78,
    grossMargin: 0.705,
    netMargin: 0.536,
    roic: 0.92,
    structuredSource: "https://example.com/annual-report",
    status: "fresh",
    message: "annual filing",
    errors: ["", "  normalized warning  ", 7, "x".repeat(300)],
    updatedAt: "2026-02-25T08:30:00.000Z",
    dataQualityScore: 98,
    sourceRecords: [{ secret: "must not persist" }],
    modelCenter: 999,
  };
  const sanitizedSnapshot =
    sanitizeCustomFinancialSnapshot(rawSnapshot);

  assert.ok(sanitizedSnapshot);
  assert.equal(sanitizedSnapshot.financialCurrency, "USD");
  assert.equal(sanitizedSnapshot.employees, 36_000);
  assert.deepEqual(sanitizedSnapshot.errors, [
    "normalized warning",
    "x".repeat(240),
  ]);
  assert.equal(
    Object.hasOwn(sanitizedSnapshot as object, "sourceRecords"),
    false,
  );
  assert.equal(Object.hasOwn(sanitizedSnapshot as object, "modelCenter"), false);
  assert.equal(
    sanitizeCustomFinancialSnapshot({ ...rawSnapshot, status: "complete" }),
    null,
  );
  assert.equal(
    sanitizeCustomFinancialSnapshot({
      ...rawSnapshot,
      dataQualityScore: 101,
    })?.dataQualityScore,
    null,
  );

  const state = sanitizeWatchPoolState(
    {
      version: WATCH_POOL_VERSION,
      hiddenDefaultIds: [],
      customCompanies: [company],
      quoteCache: {},
      financialCache: {
        [company.id]: rawSnapshot,
        orphan: rawSnapshot,
        "custom:invalid": { ...rawSnapshot, status: "complete" },
      },
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
    DEFAULT_IDS,
  );
  assert.deepEqual(Object.keys(state.financialCache), [company.id]);
  assert.equal(state.financialCache[company.id].revenueLocal100m, 1_305.5);
  assert.equal(
    Object.hasOwn(
      state.financialCache[company.id] as unknown as object,
      "sourceRecords",
    ),
    false,
  );

  const oldV1State = sanitizeWatchPoolState(
    {
      version: WATCH_POOL_VERSION,
      hiddenDefaultIds: [],
      customCompanies: [company],
      quoteCache: {},
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
    DEFAULT_IDS,
  );
  assert.deepEqual(oldV1State.financialCache, {});
});

test("sanitization and merge keep the default universe valid and custom rows deduplicated", () => {
  const company = createCustomWatchCompany({
    name: "One",
    ticker: "00700",
    market: "HK",
  });
  const duplicate = {
    ...company,
    id: "custom:duplicate",
    name: "Duplicate",
  };
  const incoming = sanitizeWatchPoolState(
    {
      version: WATCH_POOL_VERSION,
      hiddenDefaultIds: ["smic", "invalid"],
      customCompanies: [company, duplicate],
      quoteCache: {
        [company.id]: {
          verifiedName: "One",
          priceLocal: 1,
          changePct: 0,
          quoteDate: "2026-07-30",
          marketCapLocal100m: 1,
          status: "fresh",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
        orphan: {
          status: "fresh",
        },
      },
      financialCache: {
        [company.id]: {
          status: "partial",
          financialCurrency: "HKD",
          revenueLocal100m: 10,
          message: "部分财务字段待补充",
          errors: ["employees unavailable"],
          updatedAt: "2026-07-30T00:00:00.000Z",
          dataQualityScore: 65,
        },
        orphan: {
          status: "fresh",
          revenueLocal100m: 999,
        },
      },
    },
    DEFAULT_IDS,
  );

  assert.deepEqual(incoming.hiddenDefaultIds, ["smic"]);
  assert.equal(incoming.customCompanies.length, 1);
  assert.deepEqual(Object.keys(incoming.quoteCache), [company.id]);
  assert.deepEqual(Object.keys(incoming.financialCache), [company.id]);
  assert.equal(incoming.financialCache[company.id].grossMargin, null);

  const merged = mergeWatchPoolStates(
    {
      ...incoming,
      hiddenDefaultIds: ["naura"],
      customCompanies: [company],
    },
    {
      ...emptyWatchPoolState(),
      hiddenDefaultIds: ["smic"],
      customCompanies: [duplicate],
    },
  );
  assert.deepEqual(new Set(merged.hiddenDefaultIds), new Set(["naura", "smic"]));
  assert.equal(merged.customCompanies.length, 1);
  assert.deepEqual(Object.keys(merged.financialCache), [company.id]);

  const futureVersion = sanitizeWatchPoolState(
    {
      version: WATCH_POOL_VERSION + 1,
      hiddenDefaultIds: ["smic"],
      customCompanies: [company],
    },
    DEFAULT_IDS,
  );
  assert.deepEqual(futureVersion.hiddenDefaultIds, []);
  assert.deepEqual(futureVersion.customCompanies, []);
});
