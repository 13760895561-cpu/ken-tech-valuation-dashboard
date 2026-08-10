import { mkdir, readFile, writeFile } from "node:fs/promises";

interface SeedCompany {
  id: string;
  name: string;
  ticker: string;
  market: string;
  quote_code: string;
  financial_symbol: string;
  group: string;
  region: string;
  role: string;
  include_in_stats: boolean;
  currency?: string;
  quote_currency?: string;
  financial_currency?: string;
  sec_ticker?: string;
  valuation_target?: boolean;
  official_report_source_override?: string;
  official_report_source_override_report_date?: string;
  [key: string]: unknown;
}

interface SeedDataset {
  snapshot: {
    companies: SeedCompany[];
    [key: string]: unknown;
  };
}

const seedUrl = new URL("../lib/seed-data.json", import.meta.url);
const automationConfigDirectory = new URL(
  "../automation/config/",
  import.meta.url,
);
const automationDataDirectory = new URL("../automation/data/", import.meta.url);
const companiesUrl = new URL(
  "../automation/config/companies.json",
  import.meta.url,
);
const snapshotUrl = new URL(
  "../automation/data/latest_snapshot.json",
  import.meta.url,
);

const SEC_TICKER_BY_ID: Record<string, string> = {
  "09988": "BABA",
  "09888": "BIDU",
};

const dataset = JSON.parse(await readFile(seedUrl, "utf8")) as SeedDataset;
if (
  !dataset.snapshot ||
  !Array.isArray(dataset.snapshot.companies) ||
  dataset.snapshot.companies.length === 0
) {
  throw new Error("静态看板数据缺少公司清单");
}

const companies = dataset.snapshot.companies.map((company) => {
  const quoteCurrency = normalizedCurrency(
    company.quote_currency ?? company.currency,
    marketCurrency(company.market),
  );
  const financialCurrency = normalizedCurrency(
    company.financial_currency,
    company.market === "HK" ? "CNY" : quoteCurrency,
  );
  const secTicker = normalizedText(company.sec_ticker) ?? SEC_TICKER_BY_ID[company.id];
  const sourceOverride = normalizedText(
    company.official_report_source_override,
  );
  const sourceOverrideReportDate = normalizedText(
    company.official_report_source_override_report_date,
  );
  return {
    id: company.id,
    name: company.name,
    ticker: company.ticker,
    market: company.market,
    quote_code: company.quote_code,
    financial_symbol: company.financial_symbol,
    ...(secTicker ? { sec_ticker: secTicker.toUpperCase() } : {}),
    ...(sourceOverride
      ? {
          official_report_source_override: sourceOverride,
          official_report_source_override_report_date:
            sourceOverrideReportDate,
        }
      : {}),
    group: company.group,
    region: company.region,
    role: company.role,
    valuation_target:
      typeof company.valuation_target === "boolean"
        ? company.valuation_target
        : company.role === "重点观察",
    include_in_stats: company.include_in_stats,
    quote_currency: quoteCurrency,
    financial_currency: financialCurrency,
  };
});

await Promise.all([
  mkdir(automationConfigDirectory, { recursive: true }),
  mkdir(automationDataDirectory, { recursive: true }),
]);
await Promise.all([
  writeFile(companiesUrl, `${JSON.stringify(companies, null, 2)}\n`, "utf8"),
  writeFile(
    snapshotUrl,
    `${JSON.stringify(dataset.snapshot, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(`已准备 ${companies.length} 家公司的财务更新输入`);

function marketCurrency(market: string): string {
  if (market === "US") return "USD";
  if (market === "HK") return "HKD";
  return "CNY";
}

function normalizedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizedCurrency(value: unknown, fallback: string): string {
  return (normalizedText(value) ?? fallback).toUpperCase();
}
