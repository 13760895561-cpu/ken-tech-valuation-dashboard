import {
  calculateValuations,
  deriveCompanies,
  finiteNumber,
} from "./model";
import type {
  CompanySnapshot,
  DashboardDataset,
  DerivedCompany,
  FxSnapshot,
  HistoryRecord,
} from "./dashboard-types";

export const TENCENT_QUOTE_SOURCE = "https://qt.gtimg.cn/";
const FX_SOURCE =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD";
const TENCENT_FX_SOURCE =
  "https://qt.gtimg.cn/q=whEURCNY,whTWDCNY,whCNYJPY,whGBPCNY,whSGDCNY";

interface QuoteInstrument {
  id: string;
  name: string;
  quote_code: string;
  name_quote?: string;
}

export interface TencentQuoteUpdate {
  name: string;
  priceLocal: number;
  previousCloseLocal: number | null;
  changePct: number | null;
  quoteDate: string;
  sharesMillion: number;
  marketCapLocal100m: number;
}

export interface CustomQuoteRequest {
  id: string;
  name: string;
  quoteCode: string;
}

export interface CustomQuoteRefreshResult {
  updates: Map<string, TencentQuoteUpdate>;
  errors: Record<string, string>;
}

export interface RefreshResult {
  dataset: DashboardDataset;
  sampleCount: number;
  successCount: number;
  fxRefreshed: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "text/plain,application/json;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  label: string,
  attempts = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`${label} HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label}连接失败：${errorMessage(lastError)}`);
}

function decodeTencent(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    // Numeric quote fields and separators remain parseable even when a Worker
    // runtime only exposes UTF-8 decoding. The existing audited company name is
    // retained if the decoded quote name is damaged.
    return new TextDecoder().decode(buffer);
  }
}

export function parseTencentFxRates(
  text: string,
): Record<string, number> {
  const rates: Record<string, number> = {};
  const mapping: Record<
    string,
    { currency: string; inverse?: boolean }
  > = {
    whEURCNY: { currency: "EUR" },
    whTWDCNY: { currency: "TWD" },
    whCNYJPY: { currency: "JPY", inverse: true },
    whGBPCNY: { currency: "GBP" },
    whSGDCNY: { currency: "SGD" },
  };
  const pattern = /v_([A-Za-z0-9._-]+)="(.*?)";/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const definition = mapping[match[1]];
    if (!definition) continue;
    const current = finiteNumber(match[2].split("~")[3]);
    if (current === null || current <= 0) continue;
    rates[definition.currency] = definition.inverse
      ? 1 / current
      : current;
  }
  return rates;
}

function parseQuoteDate(value: string): string | null {
  const match = value.match(
    /(\d{4})[/-]?(\d{2})[/-]?(\d{2})(?:[ T]?\d{2}:?\d{2}:?\d{2})?/,
  );
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function parseTencentQuotes(
  text: string,
  companies: QuoteInstrument[],
): Map<string, TencentQuoteUpdate> {
  const byQuoteCode = new Map(
    companies.map((company) => [company.quote_code.toLowerCase(), company]),
  );
  const updates = new Map<string, TencentQuoteUpdate>();
  const pattern = /v_([A-Za-z0-9._-]+)="(.*?)";/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const [, quoteCode, payload] = match;
    const company = byQuoteCode.get(quoteCode.toLowerCase());
    if (!company) continue;
    const fields = payload.split("~");
    if (fields.length < 46) continue;

    const priceLocal = finiteNumber(fields[3]);
    const previousCloseLocal = finiteNumber(fields[4]);
    const changePercentPoints = finiteNumber(fields[32]);
    const marketCapLocal100m = finiteNumber(fields[45]);
    const quoteDate = parseQuoteDate(fields[30]);
    if (
      priceLocal === null ||
      priceLocal <= 0 ||
      marketCapLocal100m === null ||
      marketCapLocal100m <= 0 ||
      !quoteDate
    ) {
      continue;
    }

    const decodedName = fields[1]?.trim();
    updates.set(company.id, {
      name:
        decodedName && !decodedName.includes("�")
          ? decodedName
          : company.name_quote || company.name,
      priceLocal,
      previousCloseLocal,
      changePct:
        changePercentPoints === null ? null : changePercentPoints / 100,
      quoteDate,
      sharesMillion: (marketCapLocal100m * 100) / priceLocal,
      marketCapLocal100m,
    });
  }
  return updates;
}

async function fetchQuotes(
  companies: CompanySnapshot[],
): Promise<Map<string, TencentQuoteUpdate>> {
  const url = `${TENCENT_QUOTE_SOURCE}q=${companies
    .map((company) => company.quote_code)
    .join(",")}`;
  const response = await fetchWithRetry(url, "腾讯行情");
  const updates = parseTencentQuotes(
    decodeTencent(await response.arrayBuffer()),
    companies,
  );
  if (updates.size !== companies.length) {
    const missing = companies
      .filter((company) => !updates.has(company.id))
      .map((company) => company.id)
      .join(", ");
    throw new Error(
      `腾讯行情仅返回 ${updates.size}/${companies.length} 家有效数据；缺失：${missing}`,
    );
  }
  return updates;
}

export async function fetchCustomQuoteUpdates(
  requests: CustomQuoteRequest[],
): Promise<CustomQuoteRefreshResult> {
  const updates = new Map<string, TencentQuoteUpdate>();
  const errors: Record<string, string> = {};
  const unique = [
    ...new Map(
      requests
        .filter(
          (request) =>
            request.id.trim() &&
            request.name.trim() &&
            request.quoteCode.trim(),
        )
        .map((request) => [request.id, request]),
    ).values(),
  ];

  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const instruments: QuoteInstrument[] = chunk.map((request) => ({
      id: request.id,
      name: request.name,
      quote_code: request.quoteCode,
    }));
    try {
      const url = `${TENCENT_QUOTE_SOURCE}q=${instruments
        .map((instrument) => instrument.quote_code)
        .join(",")}`;
      const response = await fetchWithRetry(url, "自定义公司腾讯行情");
      const parsed = parseTencentQuotes(
        decodeTencent(await response.arrayBuffer()),
        instruments,
      );
      for (const instrument of instruments) {
        const quote = parsed.get(instrument.id);
        if (quote) {
          updates.set(instrument.id, quote);
        } else {
          errors[instrument.id] = "腾讯行情未返回有效价格、市值或行情日期";
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      for (const instrument of instruments) {
        errors[instrument.id] = message;
      }
    }
  }

  return { updates, errors };
}

async function fetchFx(): Promise<FxSnapshot> {
  const [response, supplementalRates] = await Promise.all([
    fetchWithRetry(FX_SOURCE, "Frankfurter汇率"),
    (async () => {
      try {
        const supplementalResponse = await fetchWithRetry(
          TENCENT_FX_SOURCE,
          "腾讯补充汇率",
        );
        return parseTencentFxRates(
          decodeTencent(await supplementalResponse.arrayBuffer()),
        );
      } catch {
        return {};
      }
    })(),
  ]);
  const payload = (await response.json()) as {
    date?: string;
    rates?: { CNY?: number; HKD?: number };
  };
  const usdCny = finiteNumber(payload.rates?.CNY);
  const usdHkd = finiteNumber(payload.rates?.HKD);
  if (usdCny === null || usdCny <= 0 || usdHkd === null || usdHkd <= 0) {
    throw new Error("Frankfurter汇率响应缺少USD/CNY或USD/HKD");
  }
  return {
    date: payload.date || "",
    source: FX_SOURCE,
    rates_to_cny: {
      CNY: 1,
      USD: usdCny,
      HKD: usdCny / usdHkd,
      ...supplementalRates,
    },
    status: "ok",
  };
}

function shanghaiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function stringifyNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function normalizedCurrency(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : fallback;
}

function companyCurrencies(company: CompanySnapshot): {
  quoteCurrency: string;
  financialCurrency: string;
} {
  const legacyCurrency = normalizedCurrency(company.currency, "");
  return {
    quoteCurrency: normalizedCurrency(
      company.quote_currency,
      legacyCurrency,
    ),
    financialCurrency: normalizedCurrency(
      company.financial_currency,
      company.market === "HK" ? "CNY" : legacyCurrency,
    ),
  };
}

function historyRowsForSnapshot(
  asOf: string,
  companies: DerivedCompany[],
): HistoryRecord[] {
  return companies
    .filter((company) => company.market === "A")
    .map((company) => {
      const { quoteCurrency, financialCurrency } = companyCurrencies(company);
      return {
        快照日期: asOf,
        代码: company.id,
        公司: company.name,
        分组: company.group,
        地区: company.region,
        币种: quoteCurrency,
        行情币种: quoteCurrency,
        财务币种: financialCurrency,
        财务报告期: company.report_period,
        股价本币: stringifyNumber(finiteNumber(company.price_local)),
        市值亿元人民币: stringifyNumber(company.currentMarketCapCny100m),
        EV_Sales: stringifyNumber(company.evSales),
        EV_GrossProfit: stringifyNumber(company.evGrossProfit),
        PE: stringifyNumber(company.pe),
        P_FCF: stringifyNumber(company.pFcf),
        人均市值万元: stringifyNumber(company.marketCapPerEmployeeCny10k),
        数据状态: company.coreStatus,
      };
    });
}

function upsertDailyHistory(
  existing: HistoryRecord[],
  incoming: HistoryRecord[],
): HistoryRecord[] {
  const incomingKeys = new Set(
    incoming.map((row) => `${row.快照日期}|${row.代码}`),
  );
  return [
    ...existing.filter(
      (row) => !incomingKeys.has(`${row.快照日期}|${row.代码}`),
    ),
    ...incoming,
  ].sort((left, right) => {
    const byDate = left.快照日期.localeCompare(right.快照日期);
    return byDate || left.代码.localeCompare(right.代码);
  });
}

/**
 * Fetches all external inputs first, validates full coverage, and only then
 * returns a replacement dataset. Callers must persist this returned document
 * atomically; an exception means the previous snapshot remains authoritative.
 */
export async function refreshMarketDataset(
  current: DashboardDataset,
): Promise<RefreshResult> {
  const started = Date.now();
  const quotesPromise = fetchQuotes(current.snapshot.companies);
  let fxRefreshed = true;
  const fxPromise = fetchFx().catch(() => {
    const fallback = current.snapshot.fx;
    const usd = finiteNumber(fallback?.rates_to_cny?.USD);
    const hkd = finiteNumber(fallback?.rates_to_cny?.HKD);
    if (usd === null || usd <= 0 || hkd === null || hkd <= 0) {
      throw new Error("实时汇率不可用，且最近快照没有有效备用汇率");
    }
    fxRefreshed = false;
    return {
      ...fallback,
      status: "stale-retained",
    };
  });
  const [quotes, fx] = await Promise.all([quotesPromise, fxPromise]);

  const companies = current.snapshot.companies.map((company) => {
    const quote = quotes.get(company.id);
    if (!quote) throw new Error(`缺少 ${company.id} 的已验证行情`);
    const { quoteCurrency, financialCurrency } = companyCurrencies(company);
    const quoteFxToCny = finiteNumber(fx.rates_to_cny[quoteCurrency]);
    if (quoteFxToCny === null || quoteFxToCny <= 0) {
      throw new Error(`缺少行情币种 ${quoteCurrency} 对人民币汇率`);
    }
    const financialFxToCny = finiteNumber(
      fx.rates_to_cny[financialCurrency],
    );
    if (financialFxToCny === null || financialFxToCny <= 0) {
      throw new Error(`缺少财务币种 ${financialCurrency} 对人民币汇率`);
    }
    return {
      ...company,
      name_quote: quote.name,
      price_local: quote.priceLocal,
      prev_close_local: quote.previousCloseLocal,
      change_pct: quote.changePct,
      quote_date: quote.quoteDate,
      shares_million: quote.sharesMillion,
      market_cap_local_100m: quote.marketCapLocal100m,
      quote_market_cap_check_100m: quote.marketCapLocal100m,
      quote_source: TENCENT_QUOTE_SOURCE,
      quote_status: "fresh",
      currency: quoteCurrency,
      quote_currency: quoteCurrency,
      financial_currency: financialCurrency,
      fx_to_cny: quoteFxToCny,
      quote_fx_to_cny: quoteFxToCny,
      financial_fx_to_cny: financialFxToCny,
    };
  });

  const quoteDates = companies
    .map((company) => company.quote_date)
    .filter(Boolean)
    .sort();
  if (!quoteDates.length) throw new Error("刷新结果没有有效行情日期");
  const quoteDateMin = quoteDates[0];
  const quoteDateMax = quoteDates[quoteDates.length - 1];
  const generatedAt = new Date().toISOString();
  const nextSnapshot = {
    ...current.snapshot,
    as_of: quoteDateMax,
    run_date: shanghaiDate(),
    generated_at: generatedAt,
    quote_date_min: quoteDateMin,
    quote_date_max: quoteDateMax,
    fx,
    quote_meta: {
      source: TENCENT_QUOTE_SOURCE,
      sample_count: companies.length,
      success_count: companies.length,
      status: "ok",
    },
    sample_count: companies.length,
    success_count: companies.length,
    elapsed_seconds: Math.round((Date.now() - started) / 100) / 10,
    companies,
  };

  // This call also validates that the refreshed data can still produce the
  // complete five-method model before the document is offered for persistence.
  const derived = deriveCompanies(companies);
  calculateValuations(
    derived,
    current.methodology,
    nextSnapshot.as_of,
  );
  const history = upsertDailyHistory(
    current.history,
    historyRowsForSnapshot(nextSnapshot.as_of, derived),
  );

  return {
    dataset: {
      ...current,
      exportedAt: generatedAt,
      snapshot: nextSnapshot,
      history,
    },
    sampleCount: companies.length,
    successCount: companies.length,
    fxRefreshed,
  };
}
