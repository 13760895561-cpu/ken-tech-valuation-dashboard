import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchCustomFinancials } from "../lib/custom-financials";
import { refreshMarketDataset } from "../lib/market-refresh";
import type {
  CompanySnapshot,
  DashboardDataset,
  MaybeNumber,
} from "../lib/dashboard-types";

interface UniverseCompany {
  id: string;
  name: string;
  ticker: string;
  market: "A" | "HK" | "US";
  quote_code: string;
  financial_symbol: string;
  group: string;
  region: string;
  role: string;
  include_in_stats: boolean;
  quote_currency: string;
  financial_currency: string;
  sec_ticker?: string;
  official_report_source_override?: string;
  official_report_source_override_report_date?: string;
}

const seedUrl = new URL("../lib/seed-data.json", import.meta.url);
const publicDataDirectory = new URL("../public/data/", import.meta.url);
const publicDataUrl = new URL("../public/data/dashboard.json", import.meta.url);

const VALUATION_TARGET_IDS = new Set([
  "688256",
  "688041",
  "688047",
  "300308",
  "300502",
  "300394",
  "688111",
  "002230",
  "600588",
  "601138",
  "000977",
  "603019",
  "000062",
  "001287",
  "300184",
]);

const VERIFIED_SEC_DEBT_BACKFILLS: Record<
  string,
  { reportDate: string; debtLocal100m: number; source: string }
> = {
  HPE: {
    reportDate: "2025-10-31",
    debtLocal100m: 224,
    source:
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0001645590.json",
  },
  SMCI: {
    reportDate: "2025-06-30",
    debtLocal100m: 47.57653,
    source:
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0001375365.json",
  },
};

/**
 * The 30-company expansion is intentionally split between direct peers and
 * supply-chain anchors. Supply-chain anchors remain visible but are excluded
 * from peer medians because their business models are not directly comparable.
 */
const ADDITIONS: UniverseCompany[] = [
  {
    id: "688825",
    name: "长鑫科技",
    ticker: "688825.SH",
    market: "A",
    quote_code: "sh688825",
    financial_symbol: "688825.SH",
    group: "AI算力芯片",
    region: "A股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "CNY",
    financial_currency: "CNY",
    official_report_source_override:
      "https://static.sse.com.cn/stock/disclosure/announcement/c/202605/002170_20260520_DS3Z.pdf",
    official_report_source_override_report_date: "2025-12-31",
  },
  {
    id: "688981",
    name: "中芯国际",
    ticker: "688981.SH",
    market: "A",
    quote_code: "sh688981",
    financial_symbol: "688981.SH",
    group: "AI算力芯片",
    region: "A股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "TSM",
    name: "台积电",
    ticker: "TSM",
    market: "US",
    quote_code: "usTSM",
    financial_symbol: "TSM",
    sec_ticker: "TSM",
    group: "AI算力芯片",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "TWD",
  },
  {
    id: "ARM",
    name: "Arm Holdings",
    ticker: "ARM",
    market: "US",
    quote_code: "usARM",
    financial_symbol: "ARM",
    group: "AI算力芯片",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "MRVL",
    name: "Marvell Technology",
    ticker: "MRVL",
    market: "US",
    quote_code: "usMRVL",
    financial_symbol: "MRVL",
    group: "AI算力芯片",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "MU",
    name: "美光科技",
    ticker: "MU",
    market: "US",
    quote_code: "usMU",
    financial_symbol: "MU",
    group: "AI算力芯片",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "002281",
    name: "光迅科技",
    ticker: "002281.SZ",
    market: "A",
    quote_code: "sz002281",
    financial_symbol: "002281.SZ",
    group: "光通信",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "000988",
    name: "华工科技",
    ticker: "000988.SZ",
    market: "A",
    quote_code: "sz000988",
    financial_symbol: "000988.SZ",
    group: "光通信",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "300620",
    name: "光库科技",
    ticker: "300620.SZ",
    market: "A",
    quote_code: "sz300620",
    financial_symbol: "300620.SZ",
    group: "光通信",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "688498",
    name: "源杰科技",
    ticker: "688498.SH",
    market: "A",
    quote_code: "sh688498",
    financial_symbol: "688498.SH",
    group: "光通信",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "CIEN",
    name: "Ciena",
    ticker: "CIEN",
    market: "US",
    quote_code: "usCIEN",
    financial_symbol: "CIEN",
    group: "光通信",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "CRDO",
    name: "Credo Technology",
    ticker: "CRDO",
    market: "US",
    quote_code: "usCRDO",
    financial_symbol: "CRDO",
    group: "光通信",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "688083",
    name: "中望软件",
    ticker: "688083.SH",
    market: "A",
    quote_code: "sh688083",
    financial_symbol: "688083.SH",
    group: "软件及AI应用",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "600570",
    name: "恒生电子",
    ticker: "600570.SH",
    market: "A",
    quote_code: "sh600570",
    financial_symbol: "600570.SH",
    group: "软件及AI应用",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "09888",
    name: "百度集团",
    ticker: "09888.HK",
    market: "HK",
    quote_code: "hk09888",
    financial_symbol: "09888.HK",
    sec_ticker: "BIDU",
    group: "软件及AI应用",
    region: "港股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "HKD",
    financial_currency: "CNY",
  },
  {
    id: "ORCL",
    name: "Oracle",
    ticker: "ORCL",
    market: "US",
    quote_code: "usORCL",
    financial_symbol: "ORCL",
    group: "软件及AI应用",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "CRM",
    name: "Salesforce",
    ticker: "CRM",
    market: "US",
    quote_code: "usCRM",
    financial_symbol: "CRM",
    group: "软件及AI应用",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "NOW",
    name: "ServiceNow",
    ticker: "NOW",
    market: "US",
    quote_code: "usNOW",
    financial_symbol: "NOW",
    group: "软件及AI应用",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "000938",
    name: "紫光股份",
    ticker: "000938.SZ",
    market: "A",
    quote_code: "sz000938",
    financial_symbol: "000938.SZ",
    group: "服务器及算力设备",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "000034",
    name: "神州数码",
    ticker: "000034.SZ",
    market: "A",
    quote_code: "sz000034",
    financial_symbol: "000034.SZ",
    group: "服务器及算力设备",
    region: "A股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "00992",
    name: "联想集团",
    ticker: "00992.HK",
    market: "HK",
    quote_code: "hk00992",
    financial_symbol: "00992.HK",
    group: "服务器及算力设备",
    region: "港股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "HKD",
    financial_currency: "USD",
    official_report_source_override:
      "https://www.hkexnews.hk/listedco/listconews/sehk/2026/0626/2026062600475.pdf",
    official_report_source_override_report_date: "2026-03-31",
  },
  {
    id: "ANET",
    name: "Arista Networks",
    ticker: "ANET",
    market: "US",
    quote_code: "usANET",
    financial_symbol: "ANET",
    group: "服务器及算力设备",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
    official_report_source_override:
      "https://www.sec.gov/Archives/edgar/data/1596532/000159653226000013/anet-20251231.htm",
    official_report_source_override_report_date: "2025-12-31",
  },
  {
    id: "CLS",
    name: "Celestica",
    ticker: "CLS",
    market: "US",
    quote_code: "usCLS",
    financial_symbol: "CLS",
    group: "服务器及算力设备",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "VRT",
    name: "Vertiv",
    ticker: "VRT",
    market: "US",
    quote_code: "usVRT",
    financial_symbol: "VRT",
    group: "服务器及算力设备",
    region: "美股",
    role: "产业链锚",
    include_in_stats: false,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "300475",
    name: "香农芯创",
    ticker: "300475.SZ",
    market: "A",
    quote_code: "sz300475",
    financial_symbol: "300475.SZ",
    group: "科技分销及贸易",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "300975",
    name: "商络电子",
    ticker: "300975.SZ",
    market: "A",
    quote_code: "sz300975",
    financial_symbol: "300975.SZ",
    group: "科技分销及贸易",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "301099",
    name: "雅创电子",
    ticker: "301099.SZ",
    market: "A",
    quote_code: "sz301099",
    financial_symbol: "301099.SZ",
    group: "科技分销及贸易",
    region: "A股",
    role: "国内参考",
    include_in_stats: true,
    quote_currency: "CNY",
    financial_currency: "CNY",
  },
  {
    id: "SNX",
    name: "TD SYNNEX",
    ticker: "SNX",
    market: "US",
    quote_code: "usSNX",
    financial_symbol: "SNX",
    group: "科技分销及贸易",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "WCC",
    name: "WESCO International",
    ticker: "WCC",
    market: "US",
    quote_code: "usWCC",
    financial_symbol: "WCC",
    group: "科技分销及贸易",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
  {
    id: "CDW",
    name: "CDW",
    ticker: "CDW",
    market: "US",
    quote_code: "usCDW",
    financial_symbol: "CDW",
    group: "科技分销及贸易",
    region: "美股",
    role: "全球参考",
    include_in_stats: true,
    quote_currency: "USD",
    financial_currency: "USD",
  },
];

const current = JSON.parse(await readFile(seedUrl, "utf8")) as DashboardDataset;
const duplicateIds = new Set<string>();
const seenIds = new Set<string>();
for (const company of [...current.snapshot.companies, ...ADDITIONS]) {
  if (seenIds.has(company.id)) duplicateIds.add(company.id);
  seenIds.add(company.id);
}
const existingAdditionIds = new Set(
  current.snapshot.companies
    .filter((company) => ADDITIONS.some((addition) => addition.id === company.id))
    .map((company) => company.id),
);
for (const id of existingAdditionIds) duplicateIds.delete(id);
if (duplicateIds.size) {
  throw new Error(`扩容清单存在重复代码：${[...duplicateIds].join(", ")}`);
}

const metadataById = new Map(ADDITIONS.map((company) => [company.id, company]));
const existingById = new Map(
  current.snapshot.companies.map((company) => [company.id, company]),
);
const baseCompanies = current.snapshot.companies
  .filter((company) => !metadataById.has(company.id))
  .map((company) => {
    const debtBackfill = VERIFIED_SEC_DEBT_BACKFILLS[company.id];
    const shouldBackfillDebt =
      debtBackfill &&
      company.report_date === debtBackfill.reportDate &&
      (company.debt_local_100m === null ||
        company.debt_local_100m === undefined);
    return {
      ...company,
      valuation_target: VALUATION_TARGET_IDS.has(company.id),
      ...(shouldBackfillDebt
        ? {
            debt_local_100m: debtBackfill.debtLocal100m,
            debt_source_note:
              "SEC XBRL年报事实表补齐，用于EV口径",
            debt_source_url: debtBackfill.source,
          }
        : {}),
    };
  });

const missingAdditions = ADDITIONS.filter((addition) => !existingById.has(addition.id));
const fetched = await fetchCustomFinancials(
  missingAdditions.map((company) => ({
    id: company.id,
    name: company.name,
    ticker: company.financial_symbol,
    market: company.market,
    quoteCode: company.quote_code,
  })),
  { concurrency: 4, timeoutMs: 12_000, retries: 2 },
);
const financialById = new Map(
  missingAdditions.map((company, index) => [company.id, fetched[index]]),
);

const additions = ADDITIONS.map((metadata) => {
  const existing = existingById.get(metadata.id);
  if (existing) {
    return {
      ...existing,
      ...metadata,
      currency: metadata.quote_currency,
      valuation_target: false,
    } satisfies CompanySnapshot;
  }
  const financial = financialById.get(metadata.id);
  if (!financial || financial.status === "unavailable") {
    throw new Error(
      `${metadata.name}（${metadata.ticker}）未取得可用财务数据：${financial?.message ?? "未知错误"}`,
    );
  }
  const financialCurrency =
    financial.financialCurrency ?? metadata.financial_currency;
  if (financialCurrency !== metadata.financial_currency) {
    throw new Error(
      `${metadata.name}财务币种不一致：预期 ${metadata.financial_currency}，实际 ${financialCurrency}`,
    );
  }
  const officialSource =
    metadata.official_report_source_override ?? financial.structuredSource;
  const debt = metadata.id === "ANET" ? 0 : financial.debtLocal100m;
  return {
    ...metadata,
    valuation_target: false,
    name_quote: metadata.name,
    price_local: null,
    prev_close_local: null,
    change_pct: null,
    quote_date: current.snapshot.as_of,
    shares_million: null,
    market_cap_local_100m: null,
    quote_market_cap_check_100m: null,
    currency: metadata.quote_currency,
    structured_source: financial.structuredSource,
    report_period:
      financial.reportPeriod ?? `${financial.reportDate?.slice(0, 4) ?? ""}年报`,
    report_date: financial.reportDate ?? "",
    notice_date: financial.noticeDate ?? "",
    revenue_local_100m: financial.revenueLocal100m,
    gross_profit_local_100m: financial.grossProfitLocal100m,
    net_profit_local_100m: financial.netProfitLocal100m,
    revenue_growth: financial.revenueGrowth,
    gross_margin: financial.grossMargin,
    net_margin: financial.netMargin,
    roic: financial.roic,
    employees: financial.employees,
    official_report_source: officialSource,
    ocf_local_100m: financial.ocfLocal100m,
    capex_local_100m: financial.capexLocal100m,
    cash_local_100m: financial.cashLocal100m,
    debt_local_100m: debt,
    errors: financial.errors,
    financial_refresh_status: "bootstrap_structured_extraction",
    financial_source_generated_at: financial.updatedAt,
    quote_source: "https://qt.gtimg.cn/",
    quote_status: "unavailable",
    fx_to_cny: rateFor(current, metadata.quote_currency),
    quote_fx_to_cny: rateFor(current, metadata.quote_currency),
    financial_fx_to_cny: rateFor(current, financialCurrency),
    data_quality_score:
      metadata.id === "ANET" ? 100 : financial.dataQualityScore,
  } satisfies CompanySnapshot;
});

const expanded: DashboardDataset = {
  ...current,
  snapshot: {
    ...current.snapshot,
    companies: [...baseCompanies, ...additions],
  },
};
if (expanded.snapshot.companies.length !== 61) {
  throw new Error(
    `扩容后公司数应为 61，实际为 ${expanded.snapshot.companies.length}`,
  );
}
const targetCount = expanded.snapshot.companies.filter(
  (company) => company.valuation_target === true,
).length;
if (targetCount !== 15) {
  throw new Error(`重点估值公司应为 15，实际为 ${targetCount}`);
}

const refreshed = await refreshMarketDataset(expanded);
const serialized = `${JSON.stringify(refreshed.dataset, null, 2)}\n`;
await mkdir(publicDataDirectory, { recursive: true });
await Promise.all([
  writeFile(seedUrl, serialized, "utf8"),
  writeFile(publicDataUrl, serialized, "utf8"),
]);

console.log(
  `默认覆盖池已扩展为 ${refreshed.dataset.snapshot.companies.length} 家，` +
    `重点估值 ${targetCount} 家，行情成功 ${refreshed.successCount}/${refreshed.sampleCount}`,
);

function rateFor(dataset: DashboardDataset, currency: string): MaybeNumber {
  if (currency === "CNY") return 1;
  const rate = dataset.snapshot.fx.rates_to_cny[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : null;
}
