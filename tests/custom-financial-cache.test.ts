import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOM_FINANCIAL_FRESH_TTL_MS,
  CUSTOM_FINANCIAL_RETRY_TTL_MS,
  customFinancialCacheNeedsRefresh,
  mergeCustomFinancialRefresh,
} from "../lib/custom-financial-cache";
import type { CustomFinancialSnapshot } from "../lib/watch-pool";

function snapshot(
  overrides: Partial<CustomFinancialSnapshot> = {},
): CustomFinancialSnapshot {
  return {
    reportPeriod: "2025年报",
    reportDate: "2025-12-31",
    noticeDate: "2026-03-20",
    financialCurrency: "CNY",
    revenueLocal100m: 100,
    grossProfitLocal100m: 40,
    netProfitLocal100m: 20,
    ocfLocal100m: 25,
    capexLocal100m: 5,
    cashLocal100m: 30,
    debtLocal100m: 10,
    employees: 1_000,
    revenueGrowth: 0.1,
    grossMargin: 0.4,
    netMargin: 0.2,
    roic: 0.15,
    structuredSource: "https://example.com/financials",
    status: "fresh",
    message: "最近完整年报财务数据已更新",
    errors: [],
    updatedAt: "2026-07-30T00:00:00.000Z",
    dataQualityScore: 100,
    ...overrides,
  };
}

test("fresh caches use 24h TTL while incomplete states use a 1h retry cooldown", () => {
  const start = Date.parse("2026-07-30T00:00:00.000Z");
  assert.equal(
    customFinancialCacheNeedsRefresh(
      snapshot(),
      start + CUSTOM_FINANCIAL_FRESH_TTL_MS - 1,
    ),
    false,
  );
  assert.equal(
    customFinancialCacheNeedsRefresh(
      snapshot(),
      start + CUSTOM_FINANCIAL_FRESH_TTL_MS,
    ),
    true,
  );
  for (const status of ["partial", "stale", "unavailable"] as const) {
    const incomplete = snapshot({ status });
    assert.equal(
      customFinancialCacheNeedsRefresh(
        incomplete,
        start + CUSTOM_FINANCIAL_RETRY_TTL_MS - 1,
      ),
      false,
    );
    assert.equal(
      customFinancialCacheNeedsRefresh(
        incomplete,
        start + CUSTOM_FINANCIAL_RETRY_TTL_MS,
      ),
      true,
    );
  }
});

test("same-report partial refresh fills missing fields from the last good cache", () => {
  const merged = mergeCustomFinancialRefresh(
    snapshot(),
    snapshot({
      status: "partial",
      revenueLocal100m: 105,
      cashLocal100m: null,
      debtLocal100m: null,
      errors: ["资产负债表暂不可用"],
      updatedAt: "2026-07-30T01:00:00.000Z",
      dataQualityScore: 75,
    }),
  );
  assert.equal(merged.status, "partial");
  assert.equal(merged.revenueLocal100m, 105);
  assert.equal(merged.cashLocal100m, 30);
  assert.equal(merged.debtLocal100m, 10);
  assert.match(merged.message ?? "", /同报告期缺失字段沿用/);
});

test("a partial new report never mixes periods and retains the previous report", () => {
  const merged = mergeCustomFinancialRefresh(
    snapshot(),
    snapshot({
      reportPeriod: "2026年报",
      reportDate: "2026-12-31",
      status: "partial",
      revenueLocal100m: 130,
      cashLocal100m: null,
      debtLocal100m: null,
      updatedAt: "2027-03-01T00:00:00.000Z",
    }),
  );
  assert.equal(merged.status, "stale");
  assert.equal(merged.reportDate, "2025-12-31");
  assert.equal(merged.revenueLocal100m, 100);
  assert.match(merged.message ?? "", /新报告期数据尚不完整/);
});

test("a partial refresh never mixes facts reported in different currencies", () => {
  const merged = mergeCustomFinancialRefresh(
    snapshot(),
    snapshot({
      financialCurrency: "USD",
      status: "partial",
      revenueLocal100m: 20,
      cashLocal100m: null,
      debtLocal100m: null,
      updatedAt: "2026-07-30T01:00:00.000Z",
    }),
  );
  assert.equal(merged.status, "stale");
  assert.equal(merged.financialCurrency, "CNY");
  assert.equal(merged.revenueLocal100m, 100);
});

test("an unavailable refresh preserves usable facts but keeps the new attempt time", () => {
  const merged = mergeCustomFinancialRefresh(
    snapshot(),
    snapshot({
      reportPeriod: null,
      reportDate: null,
      status: "unavailable",
      revenueLocal100m: null,
      grossProfitLocal100m: null,
      netProfitLocal100m: null,
      employees: null,
      message: "财务数据暂不可用",
      errors: ["网络超时"],
      updatedAt: "2026-07-30T02:00:00.000Z",
      dataQualityScore: 0,
    }),
  );
  assert.equal(merged.status, "stale");
  assert.equal(merged.reportDate, "2025-12-31");
  assert.equal(merged.revenueLocal100m, 100);
  assert.equal(merged.updatedAt, "2026-07-30T02:00:00.000Z");
  assert.deepEqual(merged.errors, ["网络超时"]);
});
