import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  CompanySnapshot,
  DashboardDataset,
  Snapshot,
} from "../lib/dashboard-types";

const seedUrl = new URL("../lib/seed-data.json", import.meta.url);
const publicDataDirectory = new URL("../public/data/", import.meta.url);
const publicDataUrl = new URL(
  "../public/data/dashboard.json",
  import.meta.url,
);
const candidateUrl = new URL(
  "../automation/data/latest_snapshot.json",
  import.meta.url,
);
const candidateStatusUrl = new URL(
  "../automation/data/last_update_status.json",
  import.meta.url,
);
const publicStatusUrl = new URL(
  "../public/data/financial-status.json",
  import.meta.url,
);

const FINANCIAL_DATA_FIELDS = [
  "financial_currency",
  "financial_fx_to_cny",
  "structured_source",
  "report_period",
  "report_date",
  "notice_date",
  "revenue_local_100m",
  "gross_profit_local_100m",
  "net_profit_local_100m",
  "revenue_growth",
  "gross_margin",
  "net_margin",
  "roic",
  "official_report_source",
  "ocf_local_100m",
  "capex_local_100m",
  "cash_local_100m",
  "debt_local_100m",
] as const;

const FINANCIAL_DIAGNOSTIC_FIELDS = [
  "financial_refresh_mode",
  "financial_refresh_attempted",
  "financial_refresh_attempted_at",
  "financial_refresh_automatic",
  "financial_fallback_used",
  "financial_refresh_errors",
  "financial_refresh_core_missing_fields",
  "financial_refresh_missing_fields",
  "financial_data_missing_fields",
  "financial_source_generated_at",
  "financial_source_report_date",
] as const;

const FINANCIAL_FIELDS = [
  ...FINANCIAL_DATA_FIELDS,
  ...FINANCIAL_DIAGNOSTIC_FIELDS,
] as const;

const REQUIRED_NUMERIC_FIELDS = [
  "revenue_local_100m",
  "gross_profit_local_100m",
  "net_profit_local_100m",
  "ocf_local_100m",
  "capex_local_100m",
  "cash_local_100m",
  "debt_local_100m",
] as const;

const dataset = JSON.parse(
  await readFile(seedUrl, "utf8"),
) as DashboardDataset;
const candidate = JSON.parse(
  await readFile(candidateUrl, "utf8"),
) as Snapshot;
const upstreamStatus = await readOptionalJson(candidateStatusUrl);

const currentById = new Map(
  dataset.snapshot.companies.map((company) => [company.id, company]),
);
const candidateById = new Map(
  candidate.companies.map((company) => [company.id, company]),
);
if (
  currentById.size !== candidateById.size ||
  [...currentById.keys()].some((id) => !candidateById.has(id))
) {
  throw new Error("财务候选快照与经审计公司清单不一致");
}

const checkedAt = new Date().toISOString();
const failures: Array<{ id: string; name: string; reason: string }> = [];
const warnings: Array<{ id: string; name: string; warning: string }> = [];
const changedIds: string[] = [];
let acceptedCount = 0;

const companies = dataset.snapshot.companies.map((current) => {
  const next = candidateById.get(current.id);
  if (!next) return current;
  const validationError = validateCandidate(current, next);
  if (validationError) {
    failures.push({
      id: current.id,
      name: current.name,
      reason: validationError,
    });
    return {
      ...current,
      financial_refresh_status: "retained_last_good",
      financial_refresh_mode: "full",
      financial_refresh_attempted: true,
      financial_refresh_attempted_at: checkedAt,
      financial_refresh_automatic: true,
      financial_fallback_used: true,
      financial_refresh_errors: [validationError],
    };
  }

  acceptedCount += 1;
  const merged = { ...current } as CompanySnapshot;
  for (const field of FINANCIAL_FIELDS) {
    if (field in next) {
      (merged as Record<string, unknown>)[field] = next[field];
    }
  }
  merged.employees = current.employees;
  const currentEmployees = finiteNumber(current.employees);
  const candidateEmployees = finiteNumber(next.employees);
  if (
    candidateEmployees === null ||
    currentEmployees === null ||
    candidateEmployees !== currentEmployees
  ) {
    warnings.push({
      id: current.id,
      name: current.name,
      warning:
        "员工数未自动覆盖：该字段需从同一份官方年报人工复核，当前继续沿用最近核验值",
    });
  }
  const extractionWarnings = [
    ...(Array.isArray(next.errors) ? next.errors : []),
    ...(Array.isArray(next.financial_refresh_errors)
      ? next.financial_refresh_errors
      : []),
  ]
    .filter(Boolean)
    .map(String);
  if (extractionWarnings.length) {
    warnings.push({
      id: current.id,
      name: current.name,
      warning: `非核心提取提示：${extractionWarnings.join("；").slice(0, 240)}`,
    });
  }
  merged.quote_currency =
    current.quote_currency ?? current.currency ?? inferQuoteCurrency(current);
  merged.quote_fx_to_cny =
    current.quote_fx_to_cny ?? current.fx_to_cny ?? null;
  merged.financial_currency =
    next.financial_currency ??
    current.financial_currency ??
    (current.market === "HK" ? "CNY" : merged.quote_currency);
  merged.financial_fx_to_cny =
    next.financial_fx_to_cny ??
    currencyRate(candidate, merged.financial_currency);

  const dataChanged =
    financialFingerprint(merged) !== financialFingerprint(current);
  merged.financial_refresh_status = dataChanged
    ? "auto_validated_changed"
    : "auto_checked_unchanged";
  if (dataChanged) {
    merged.financial_source_generated_at =
      candidate.generated_at || checkedAt;
    changedIds.push(current.id);
  }
  return merged;
});

const nextDataset: DashboardDataset = {
  ...dataset,
  exportedAt: checkedAt,
  snapshot: {
    ...dataset.snapshot,
    financial_refresh_meta: {
      status:
        failures.length > 0
          ? changedIds.length > 0
            ? "partial_update"
            : "checked_retained"
          : changedIds.length > 0
            ? "updated"
            : "checked_unchanged",
      mode: "latest-complete-annual-report",
      automatic: true,
      checked_at: checkedAt,
      candidate_generated_at: candidate.generated_at || "",
      accepted_count: acceptedCount,
      changed_count: changedIds.length,
      unchanged_accepted_count: acceptedCount - changedIds.length,
      retained_last_good_count: failures.length,
      warning_count: warnings.length,
      upstream_meta: candidate.financial_refresh_meta,
    },
    companies,
  },
};
const serialized = `${JSON.stringify(nextDataset, null, 2)}\n`;
const reportDates = companies
  .map((company) => company.report_date)
  .filter((value): value is string => Boolean(value))
  .sort();
const status = {
  checkedAt,
  mode: "latest-complete-annual-report",
  sourcePolicy:
    "官方财报链接为证据基准，AKShare/东方财富仅用于结构化提取；核心财务字段校验失败则保留最近核验值，员工数缺失时单独沿用最近核验值。",
  companyCount: companies.length,
  acceptedCount,
  changedCount: changedIds.length,
  unchangedAcceptedCount: acceptedCount - changedIds.length,
  retainedLastGoodCount: failures.length,
  changedIds,
  failed: failures,
  warnings,
  reportDateMin: reportDates[0] ?? "",
  reportDateMax: reportDates.at(-1) ?? "",
  upstreamStatus,
};

await mkdir(publicDataDirectory, { recursive: true });
await Promise.all([
  writeFile(seedUrl, serialized, "utf8"),
  writeFile(publicDataUrl, serialized, "utf8"),
  writeFile(
    publicStatusUrl,
    `${JSON.stringify(status, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(
  `财务检查完成：${acceptedCount}/${companies.length} 家通过，` +
    `${changedIds.length} 家数据变化，${failures.length} 家保留原值`,
);

function validateCandidate(
  current: CompanySnapshot,
  candidateCompany: CompanySnapshot,
): string | null {
  if (
    candidateCompany.financial_fallback_used === true ||
    String(candidateCompany.financial_refresh_status ?? "").startsWith(
      "reused_prior",
    )
  ) {
    const refreshErrors = Array.isArray(
      candidateCompany.financial_refresh_errors,
    )
      ? candidateCompany.financial_refresh_errors
          .filter(Boolean)
          .join("；")
          .slice(0, 220)
      : "";
    return refreshErrors
      ? `本次自动抓取失败，继续保留最近核验值：${refreshErrors}`
      : "本次自动抓取未形成新候选，继续保留最近核验值";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateCompany.report_date ?? "")) {
    return "候选报告日期无效";
  }
  if (
    current.report_date &&
    candidateCompany.report_date.localeCompare(current.report_date) < 0
  ) {
    return `候选报告期 ${candidateCompany.report_date} 早于现有报告期 ${current.report_date}`;
  }
  if (!String(candidateCompany.report_period ?? "").includes("年报")) {
    return "候选数据不是明确标注的完整年报口径";
  }
  const expectedFinancialCurrency = String(
    current.financial_currency ??
      (current.market === "HK"
        ? "CNY"
        : current.quote_currency ?? current.currency),
  ).toUpperCase();
  const candidateFinancialCurrency = String(
    candidateCompany.financial_currency ?? "",
  ).toUpperCase();
  if (
    !candidateFinancialCurrency ||
    candidateFinancialCurrency !== expectedFinancialCurrency
  ) {
    return `财务币种不一致：期望 ${expectedFinancialCurrency || "已核验币种"}，候选为 ${candidateFinancialCurrency || "空"}`;
  }
  const financialFx = finiteNumber(candidateCompany.financial_fx_to_cny);
  if (financialFx === null || financialFx <= 0) {
    return "候选财务汇率无效";
  }
  if (
    candidateFinancialCurrency === "CNY" &&
    Math.abs(financialFx - 1) > 1e-9
  ) {
    return "人民币财务数据的换算汇率必须为 1";
  }
  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const value = finiteNumber(candidateCompany[field]);
    if (value === null) return `${field} 缺失`;
    if (
      (field === "revenue_local_100m" ||
        field === "gross_profit_local_100m") &&
      value <= 0
    ) {
      return `${field} 必须大于零`;
    }
    if (
      (field === "capex_local_100m" ||
        field === "cash_local_100m" ||
        field === "debt_local_100m") &&
      value < 0
    ) {
      return `${field} 不能为负`;
    }
  }
  const revenue = finiteNumber(candidateCompany.revenue_local_100m);
  const grossProfit = finiteNumber(candidateCompany.gross_profit_local_100m);
  if (
    revenue !== null &&
    grossProfit !== null &&
    Math.abs(grossProfit) > Math.abs(revenue) * 1.2
  ) {
    return "毛利润与营业收入关系异常";
  }
  const grossMargin = finiteNumber(candidateCompany.gross_margin);
  if (
    revenue !== null &&
    revenue > 0 &&
    grossProfit !== null &&
    grossMargin !== null &&
    Math.abs(grossProfit / revenue - grossMargin) > 0.08
  ) {
    return "毛利率与毛利润/营业收入不一致";
  }
  const netProfit = finiteNumber(candidateCompany.net_profit_local_100m);
  const netMargin = finiteNumber(candidateCompany.net_margin);
  if (
    revenue !== null &&
    revenue > 0 &&
    netProfit !== null &&
    netMargin !== null &&
    Math.abs(netProfit / revenue - netMargin) > 0.12
  ) {
    return "净利率与归母净利润/营业收入差异过大";
  }
  for (const field of [
    "revenue_local_100m",
    "gross_profit_local_100m",
    "cash_local_100m",
    "debt_local_100m",
  ] as const) {
    const previous = finiteNumber(current[field]);
    const next = finiteNumber(candidateCompany[field]);
    if (
      previous !== null &&
      next !== null &&
      Math.abs(previous) >= 1 &&
      Math.abs(next) >= 1
    ) {
      const ratio = Math.abs(next / previous);
      if (ratio > 10 || ratio < 0.1) {
        return `${field} 相对最近核验值出现数量级异常`;
      }
    }
  }
  if (
    current.report_date &&
    candidateCompany.report_date > current.report_date &&
    Number(candidateCompany.report_date.slice(0, 4)) -
      Number(current.report_date.slice(0, 4)) ===
      1
  ) {
    const previousRevenue = finiteNumber(current.revenue_local_100m);
    const reportedGrowth = finiteNumber(candidateCompany.revenue_growth);
    if (
      previousRevenue !== null &&
      previousRevenue > 0 &&
      revenue !== null &&
      reportedGrowth !== null &&
      Math.abs(revenue / previousRevenue - 1 - reportedGrowth) > 0.15
    ) {
      return "营收同比与两期营业收入变化不一致";
    }
  }
  const sourceError = validateOfficialReportSource(candidateCompany);
  if (sourceError) {
    return sourceError;
  }
  return null;
}

function validateOfficialReportSource(
  company: CompanySnapshot,
): string | null {
  let url: URL;
  try {
    url = new URL(String(company.official_report_source ?? ""));
  } catch {
    return "缺少格式有效的官方年报链接";
  }
  if (url.protocol !== "https:") return "官方年报链接必须使用 HTTPS";
  const host = url.hostname.toLowerCase();
  if (company.market === "A") {
    if (
      !host.endsWith("cninfo.com.cn") ||
      !url.pathname.toLowerCase().endsWith(".pdf")
    ) {
      return "A股候选缺少巨潮资讯年度报告 PDF";
    }
    return null;
  }
  if (company.market === "US") {
    return host.endsWith("sec.gov") &&
      url.pathname.includes("/Archives/edgar/data/")
      ? null
      : "美股候选缺少 SEC EDGAR 年度报告原文";
  }
  if (company.market === "HK") {
    const isSec =
      host.endsWith("sec.gov") &&
      url.pathname.includes("/Archives/edgar/data/");
    const isIssuer =
      host.endsWith("tencent.com") ||
      host.endsWith("alibabagroup.com");
    const isHkex = host.endsWith("hkexnews.hk");
    return isSec || isIssuer || isHkex
      ? null
      : "港股候选缺少交易所、SEC或发行人官网的年度报告";
  }
  return "候选市场不在自动财务更新白名单内";
}

function financialFingerprint(company: CompanySnapshot): string {
  const fields = FINANCIAL_DATA_FIELDS.filter(
    (field) => field !== "financial_fx_to_cny",
  );
  return JSON.stringify(
    Object.fromEntries(
      fields.map((field) => [field, company[field] ?? null]),
    ),
  );
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inferQuoteCurrency(company: CompanySnapshot): string {
  if (company.market === "US") return "USD";
  if (company.market === "HK") return "HKD";
  return "CNY";
}

function currencyRate(
  snapshot: Snapshot,
  currency: string | undefined,
): number | null {
  if (!currency) return null;
  const rate = snapshot.fx?.rates_to_cny?.[currency];
  return finiteNumber(rate);
}

async function readOptionalJson(url: URL): Promise<unknown> {
  try {
    return JSON.parse(await readFile(url, "utf8")) as unknown;
  } catch {
    return null;
  }
}
