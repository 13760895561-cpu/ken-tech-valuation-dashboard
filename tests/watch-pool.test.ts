import assert from "node:assert/strict";
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

const DEFAULT_IDS = ["smic", "naura", "tencent"];

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
