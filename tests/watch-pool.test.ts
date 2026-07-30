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
    assert.doesNotMatch(transfer, /priceLocal|marketCapLocal100m/);
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
  assert.equal(imported.summary.skippedHiddenCount, 1);
  assert.equal(imported.summary.skippedCustomCount, 1);
  assert.equal(imported.summary.discardedFinancialFieldCount, 5);

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
  ]) {
    assert.equal(Object.hasOwn(reconstructed, field), false);
  }
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
    },
    DEFAULT_IDS,
  );

  assert.deepEqual(incoming.hiddenDefaultIds, ["smic"]);
  assert.equal(incoming.customCompanies.length, 1);
  assert.deepEqual(Object.keys(incoming.quoteCache), [company.id]);

  const merged = mergeWatchPoolStates(
    {
      ...emptyWatchPoolState(),
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
