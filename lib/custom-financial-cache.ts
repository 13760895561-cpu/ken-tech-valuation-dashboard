import type { CustomFinancialSnapshot } from "./watch-pool";

export const CUSTOM_FINANCIAL_FRESH_TTL_MS = 24 * 60 * 60 * 1_000;
export const CUSTOM_FINANCIAL_RETRY_TTL_MS = 60 * 60 * 1_000;

const FACT_FIELDS = [
  "revenueLocal100m",
  "grossProfitLocal100m",
  "netProfitLocal100m",
  "ocfLocal100m",
  "capexLocal100m",
  "cashLocal100m",
  "debtLocal100m",
  "employees",
  "revenueGrowth",
  "grossMargin",
  "netMargin",
  "roic",
] as const satisfies ReadonlyArray<keyof CustomFinancialSnapshot>;

export function hasUsableCustomFinancialFacts(
  snapshot: CustomFinancialSnapshot | undefined,
): snapshot is CustomFinancialSnapshot {
  return Boolean(
    snapshot &&
      (snapshot.reportDate ||
        snapshot.revenueLocal100m !== null ||
        snapshot.netProfitLocal100m !== null ||
        snapshot.employees !== null),
  );
}

export function customFinancialCacheNeedsRefresh(
  snapshot: CustomFinancialSnapshot | undefined,
  now = Date.now(),
): boolean {
  if (!snapshot) return true;
  const updatedAt = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  const ttl =
    snapshot.status === "fresh"
      ? CUSTOM_FINANCIAL_FRESH_TTL_MS
      : CUSTOM_FINANCIAL_RETRY_TTL_MS;
  return now - updatedAt >= ttl;
}

function retainPrevious(
  previous: CustomFinancialSnapshot,
  next: CustomFinancialSnapshot,
  reason: string,
): CustomFinancialSnapshot {
  return {
    ...previous,
    status: "stale",
    message: `${next.message ?? "财务更新未完成"}；${reason}`,
    errors: next.errors,
    updatedAt: next.updatedAt,
  };
}

export function mergeCustomFinancialRefresh(
  previous: CustomFinancialSnapshot | undefined,
  next: CustomFinancialSnapshot,
): CustomFinancialSnapshot {
  if (!hasUsableCustomFinancialFacts(previous)) return next;

  if (next.status === "unavailable") {
    return retainPrevious(previous, next, "已保留最近成功数据");
  }

  if (next.status !== "partial") return next;

  if (
    !previous.reportDate ||
    !next.reportDate ||
    previous.reportDate !== next.reportDate ||
    (previous.financialCurrency &&
      next.financialCurrency &&
      previous.financialCurrency !== next.financialCurrency)
  ) {
    return retainPrevious(
      previous,
      next,
      "新报告期数据尚不完整，已保留上一份可核验年报",
    );
  }

  const merged: CustomFinancialSnapshot = {
    ...next,
    reportPeriod: next.reportPeriod ?? previous.reportPeriod,
    noticeDate: next.noticeDate ?? previous.noticeDate,
    financialCurrency:
      next.financialCurrency ?? previous.financialCurrency,
    structuredSource: next.structuredSource ?? previous.structuredSource,
    message: `${next.message ?? "财务数据部分更新"}；同报告期缺失字段沿用最近成功缓存`,
  };
  for (const field of FACT_FIELDS) {
    if (merged[field] === null) {
      (merged[field] as number | null) = previous[field] as number | null;
    }
  }
  return merged;
}
