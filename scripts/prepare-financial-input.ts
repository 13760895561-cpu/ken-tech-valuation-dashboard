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

const dataset = JSON.parse(await readFile(seedUrl, "utf8")) as SeedDataset;
if (
  !dataset.snapshot ||
  !Array.isArray(dataset.snapshot.companies) ||
  dataset.snapshot.companies.length === 0
) {
  throw new Error("静态看板数据缺少公司清单");
}

const companies = dataset.snapshot.companies.map((company) => {
  const quoteCurrency =
    company.quote_currency ?? company.currency ?? marketCurrency(company.market);
  const financialCurrency =
    company.financial_currency ??
    (company.market === "HK" ? "CNY" : quoteCurrency);
  return {
    id: company.id,
    name: company.name,
    ticker: company.ticker,
    market: company.market,
    quote_code: company.quote_code,
    financial_symbol: company.financial_symbol,
    ...(company.id === "09988" ? { sec_ticker: "BABA" } : {}),
    group: company.group,
    region: company.region,
    role: company.role,
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
