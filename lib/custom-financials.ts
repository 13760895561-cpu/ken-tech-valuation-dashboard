export type CustomFinancialMarket = "A" | "HK" | "US";
export type CustomFinancialStatus =
  | "fresh"
  | "partial"
  | "stale"
  | "unavailable";

export interface CustomFinancialRequest {
  id?: string;
  name?: string;
  ticker: string;
  market: CustomFinancialMarket;
  quoteCode?: string | null;
}

export interface CustomFinancialSource {
  label: string;
  reportName: string;
  url: string;
}

export interface CustomFinancialSnapshot {
  securityCode: string;
  market: CustomFinancialMarket;
  reportPeriod: string | null;
  reportDate: string | null;
  noticeDate: string | null;
  financialCurrency: string | null;
  revenueLocal100m: number | null;
  grossProfitLocal100m: number | null;
  netProfitLocal100m: number | null;
  ocfLocal100m: number | null;
  capexLocal100m: number | null;
  cashLocal100m: number | null;
  debtLocal100m: number | null;
  employees: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  roic: number | null;
  structuredSource: string;
  sources: CustomFinancialSource[];
  status: CustomFinancialStatus;
  message: string;
  errors: string[];
  updatedAt: string;
  dataQualityScore: number;
}

export interface CustomFinancialFetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

export interface NormalizedFinancialSecurity {
  market: CustomFinancialMarket;
  securityCode: string;
  eastmoneyCode: string;
  structuredSource: string;
}

type JsonRecord = Record<string, unknown>;

const EASTMONEY_SECURITIES_API =
  "https://datacenter.eastmoney.com/securities/api/data/get";
const EASTMONEY_SECURITIES_V1_API =
  "https://datacenter.eastmoney.com/securities/api/data/v1/get";

const A_MAIN_REPORT = "RPT_F10_FINANCE_MAINFINADATA";
const A_BALANCE_REPORT = "RPT_F10_FINANCE_GBALANCE";
const A_CASHFLOW_REPORT = "RPT_F10_FINANCE_GCASHFLOW";
const HK_MAIN_REPORT = "RPT_HKF10_FN_MAININDICATOR";
const HK_PROFILE_REPORT = "RPT_HKF10_INFO_ORGPROFILE";
const HK_REPORT_SUMMARY = "RPT_CUSTOM_HKSK_APPFN_CASHFLOW_SUMMARY";
const HK_BALANCE_REPORT = "RPT_HKF10_FN_BALANCE_PC";
const HK_CASHFLOW_REPORT = "RPT_HKF10_FN_CASHFLOW_PC";
const US_PROFILE_REPORT = "RPT_USF10_INFO_ORGPROFILE";
const US_MAIN_REPORT = "RPT_USF10_FN_GMAININDICATOR";
const US_BALANCE_REPORT = "RPT_USF10_FN_BALANCE";
const US_CASHFLOW_REPORT = "RPT_USSK_FN_CASHFLOW";

const DEFAULT_TIMEOUT_MS = 9_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 180;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;

const HK_BALANCE_COLUMNS =
  "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_CODE,REPORT_DATE," +
  "DATE_TYPE_CODE,FISCAL_YEAR,STD_ITEM_CODE,STD_ITEM_NAME,AMOUNT,STD_REPORT_DATE";
const HK_CASHFLOW_COLUMNS =
  "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_CODE,REPORT_DATE," +
  "DATE_TYPE_CODE,FISCAL_YEAR,START_DATE,STD_ITEM_CODE,STD_ITEM_NAME,AMOUNT";
const US_STATEMENT_COLUMNS =
  "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,REPORT_TYPE," +
  "REPORT,STD_ITEM_CODE,AMOUNT,ITEM_NAME";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanInput(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function local100m(value: unknown): number | null {
  const amount = finiteNumber(value);
  return amount === null ? null : amount / 100_000_000;
}

function percentDecimal(value: unknown): number | null {
  const percentagePoints = finiteNumber(value);
  return percentagePoints === null ? null : percentagePoints / 100;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function reportDateFilterValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/,
  );
  if (!match) return null;
  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = textOrNull(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const mapping: Record<string, string> = {
    人民币: "CNY",
    人民币元: "CNY",
    港元: "HKD",
    港币: "HKD",
    美元: "USD",
    欧元: "EUR",
    日元: "JPY",
    英镑: "GBP",
    新台币: "TWD",
    新加坡元: "SGD",
  };
  if (mapping[raw]) return mapping[raw];
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return raw.slice(0, 12);
}

function inferAMarket(digits: string): "SH" | "SZ" | "BJ" | null {
  if (/^(4|8|92)/.test(digits)) return "BJ";
  if (/^(5|6|9)/.test(digits)) return "SH";
  if (/^(0|1|2|3)/.test(digits)) return "SZ";
  return null;
}

export function normalizeFinancialSecurity(
  input: Pick<CustomFinancialRequest, "ticker" | "market" | "quoteCode">,
): NormalizedFinancialSecurity {
  const ticker = cleanInput(input.ticker).toUpperCase();
  const quoteCode = cleanInput(input.quoteCode).toUpperCase();
  const candidate = ticker || quoteCode;

  if (input.market === "A") {
    const match = candidate.match(
      /^(?:(SH|SZ|BJ))?(\d{6})(?:\.(SH|SZ|BJ))?$/,
    );
    const quoteMatch = quoteCode.match(/^(SH|SZ|BJ)(\d{6})$/);
    const digits = match?.[2] ?? quoteMatch?.[2];
    if (!digits) throw new Error("A股证券代码必须是6位数字");
    const explicitMarket = match?.[1] ?? match?.[3] ?? quoteMatch?.[1];
    const market = explicitMarket ?? inferAMarket(digits);
    if (!market) throw new Error("无法识别A股证券代码所属市场");
    return {
      market: "A",
      securityCode: `${digits}.${market}`,
      eastmoneyCode: `${digits}.${market}`,
      structuredSource:
        "https://emweb.securities.eastmoney.com/pc_hsf10/pages/" +
        `index.html?type=web&code=${market}${digits}#/cwfx`,
    };
  }

  if (input.market === "HK") {
    const stripped = candidate
      .replace(/^HK/, "")
      .replace(/\.HK$/, "");
    if (!/^\d{1,5}$/.test(stripped)) {
      throw new Error("港股证券代码必须是1至5位数字");
    }
    const digits = stripped.padStart(5, "0");
    return {
      market: "HK",
      securityCode: `${digits}.HK`,
      eastmoneyCode: `${digits}.HK`,
      structuredSource:
        "https://emweb.securities.eastmoney.com/PC_HKF10/" +
        `NewFinancialAnalysis/index?type=web&code=${digits}`,
    };
  }

  if (input.market === "US") {
    const stripped = candidate
      .replace(/^US/, "")
      .replace(/\.US$/, "");
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(stripped)) {
      throw new Error("美股代码仅支持字母、数字、点号或连字符");
    }
    return {
      market: "US",
      securityCode: stripped,
      eastmoneyCode: stripped,
      structuredSource:
        "https://emweb.eastmoney.com/PC_USF10/pages/" +
        `index.html?code=${encodeURIComponent(stripped)}&type=web&color=w#/cwfx`,
    };
  }

  throw new Error("暂不支持该证券市场的自动财务更新");
}

function createUrl(
  endpoint: typeof EASTMONEY_SECURITIES_API | typeof EASTMONEY_SECURITIES_V1_API,
  params: Record<string, string>,
): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return "未知错误";
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return (
    error.name === "AbortError" ||
    /网络|network|timeout|超时|HTTP (408|429|5\d\d)/i.test(error.message)
  );
}

async function fetchJson(
  url: string,
  options: Required<
    Pick<
      CustomFinancialFetchOptions,
      "fetch" | "timeoutMs" | "retries" | "retryDelayMs"
    >
  > &
    Pick<CustomFinancialFetchOptions, "signal">,
): Promise<JsonRecord> {
  let lastError: unknown = new Error("请求未执行");
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`东方财富接口 HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error("东方财富接口返回格式异常");
      if (payload.success === false) {
        throw new Error("东方财富接口返回失败状态");
      }
      return payload;
    } catch (error) {
      lastError =
        controller.signal.aborted && !options.signal?.aborted
          ? new DOMException("东方财富接口请求超时", "AbortError")
          : error;
      if (
        options.signal?.aborted ||
        attempt >= options.retries ||
        !shouldRetry(lastError)
      ) {
        break;
      }
      await sleep(options.retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromParent);
    }
  }
  throw lastError;
}

function resultRows(payload: JsonRecord): JsonRecord[] {
  const result = payload.result;
  if (!isRecord(result) || !Array.isArray(result.data)) return [];
  return result.data.filter(isRecord);
}

function sortedByReportDate(rows: JsonRecord[]): JsonRecord[] {
  return [...rows].sort((left, right) =>
    (dateOnly(right.REPORT_DATE) ?? "").localeCompare(
      dateOnly(left.REPORT_DATE) ?? "",
    ),
  );
}

function matchingReportDate(
  rows: JsonRecord[],
  reportDate: string | null,
): JsonRecord | null {
  if (!reportDate) return null;
  return (
    rows.find((row) => dateOnly(row.REPORT_DATE) === reportDate) ?? null
  );
}

function annualARow(rows: JsonRecord[]): JsonRecord | null {
  return (
    sortedByReportDate(rows).find(
      (row) =>
        row.REPORT_TYPE === "年报" ||
        String(row.REPORT_DATE_NAME ?? "").includes("年报"),
    ) ?? null
  );
}

function annualIndicatorRow(rows: JsonRecord[]): JsonRecord | null {
  return (
    sortedByReportDate(rows).find(
      (row) =>
        row.DATE_TYPE_CODE === "001" ||
        row.DATE_TYPE === "年报" ||
        String(row.REPORT_DATA_TYPE ?? "").includes("年报"),
    ) ?? null
  );
}

function sumFields(row: JsonRecord | null, fields: string[]): number | null {
  if (!row) return null;
  const values = fields
    .map((field) => finiteNumber(row[field]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function sumNamedRows(rows: JsonRecord[], names: string[]): number | null {
  const values = rows
    .filter((row) => names.includes(String(row.STD_ITEM_NAME ?? row.ITEM_NAME)))
    .map((row) => finiteNumber(row.AMOUNT))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function baseSources(
  reports: Array<[string, string, string]>,
): CustomFinancialSource[] {
  return reports.map(([label, reportName, url]) => ({
    label,
    reportName,
    url,
  }));
}

function unavailableSnapshot(
  request: CustomFinancialRequest,
  error: unknown,
  now: () => Date,
): CustomFinancialSnapshot {
  return {
    securityCode: cleanInput(request.ticker).toUpperCase(),
    market: request.market,
    reportPeriod: null,
    reportDate: null,
    noticeDate: null,
    financialCurrency: null,
    revenueLocal100m: null,
    grossProfitLocal100m: null,
    netProfitLocal100m: null,
    ocfLocal100m: null,
    capexLocal100m: null,
    cashLocal100m: null,
    debtLocal100m: null,
    employees: null,
    revenueGrowth: null,
    grossMargin: null,
    netMargin: null,
    roic: null,
    structuredSource: "",
    sources: [],
    status: "unavailable",
    message: `财务数据暂不可用：${errorText(error)}`,
    errors: [errorText(error)],
    updatedAt: now().toISOString(),
    dataQualityScore: 0,
  };
}

function finishSnapshot(
  snapshot: Omit<
    CustomFinancialSnapshot,
    "status" | "message" | "updatedAt" | "dataQualityScore"
  >,
  now: () => Date,
): CustomFinancialSnapshot {
  const financialFields = [
    snapshot.revenueLocal100m,
    snapshot.grossProfitLocal100m,
    snapshot.netProfitLocal100m,
    snapshot.ocfLocal100m,
    snapshot.capexLocal100m,
    snapshot.cashLocal100m,
    snapshot.debtLocal100m,
    snapshot.employees,
  ];
  const completeCount = financialFields.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  ).length;
  const usable = completeCount > 0;
  const status: CustomFinancialStatus =
    completeCount === financialFields.length
      ? "fresh"
      : usable
        ? "partial"
        : "unavailable";
  const dataQualityScore = Math.min(
    100,
    Math.round(
      (completeCount / financialFields.length) * 80 +
        (snapshot.reportDate ? 7 : 0) +
        (snapshot.financialCurrency ? 5 : 0) +
        (snapshot.sources.length ? 8 : 0),
    ),
  );
  const message =
    status === "fresh"
      ? "最近完整年报财务数据已更新"
      : status === "partial"
        ? `财务数据已部分更新（${completeCount}/${financialFields.length}项核心字段）`
        : "最近完整年报没有可用财务字段";
  return {
    ...snapshot,
    status,
    message,
    updatedAt: now().toISOString(),
    dataQualityScore,
  };
}

function fetchConfiguration(options: CustomFinancialFetchOptions) {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    retries: Math.min(2, Math.max(0, options.retries ?? DEFAULT_RETRIES)),
    retryDelayMs: Math.max(
      0,
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    ),
    signal: options.signal,
  };
}

async function rowsFor(
  label: string,
  url: string,
  configuration: ReturnType<typeof fetchConfiguration>,
  errors: string[],
): Promise<JsonRecord[]> {
  try {
    return resultRows(await fetchJson(url, configuration));
  } catch (error) {
    errors.push(`${label}：${errorText(error)}`);
    return [];
  }
}

async function fetchAFinancials(
  security: NormalizedFinancialSecurity,
  configuration: ReturnType<typeof fetchConfiguration>,
  now: () => Date,
): Promise<CustomFinancialSnapshot> {
  const errors: string[] = [];
  const mainUrl = createUrl(EASTMONEY_SECURITIES_API, {
    type: A_MAIN_REPORT,
    sty: "APP_F10_MAINFINADATA",
    quoteColumns: "",
    filter: `(SECUCODE="${security.eastmoneyCode}")`,
    p: "1",
    ps: "40",
    sr: "-1",
    st: "REPORT_DATE",
    source: "HSF10",
    client: "PC",
  });
  const mainRows = await rowsFor("A股主要指标", mainUrl, configuration, errors);
  const main = annualARow(mainRows);
  if (!main) throw new Error(errors[0] ?? "未找到A股最近完整年报");
  const reportDate = dateOnly(main.REPORT_DATE);
  if (!reportDate) throw new Error("A股年报日期缺失");
  const statementFilter =
    `(SECUCODE="${security.eastmoneyCode}")` +
    `(REPORT_DATE in ('${reportDate}'))`;
  const balanceUrl = createUrl(EASTMONEY_SECURITIES_API, {
    type: A_BALANCE_REPORT,
    sty: "F10_FINANCE_GBALANCE",
    filter: statementFilter,
    p: "1",
    ps: "10",
    sr: "-1",
    st: "REPORT_DATE",
    source: "HSF10",
    client: "PC",
  });
  const cashflowUrl = createUrl(EASTMONEY_SECURITIES_API, {
    type: A_CASHFLOW_REPORT,
    sty: "APP_F10_GCASHFLOW",
    filter: statementFilter,
    p: "1",
    ps: "10",
    sr: "-1",
    st: "REPORT_DATE",
    source: "HSF10",
    client: "PC",
  });
  const [balanceRows, cashflowRows] = await Promise.all([
    rowsFor("A股资产负债表", balanceUrl, configuration, errors),
    rowsFor("A股现金流量表", cashflowUrl, configuration, errors),
  ]);
  const balance = matchingReportDate(balanceRows, reportDate);
  const cashflow = matchingReportDate(cashflowRows, reportDate);
  const capex = finiteNumber(cashflow?.CONSTRUCT_LONG_ASSET);

  return finishSnapshot(
    {
      securityCode: security.securityCode,
      market: "A",
      reportPeriod:
        textOrNull(main.REPORT_DATE_NAME) ?? `${reportDate.slice(0, 4)}年报`,
      reportDate,
      noticeDate: dateOnly(main.NOTICE_DATE),
      financialCurrency: normalizeCurrency(main.CURRENCY) ?? "CNY",
      revenueLocal100m: local100m(main.TOTALOPERATEREVE),
      grossProfitLocal100m: local100m(main.MLR),
      netProfitLocal100m: local100m(main.PARENTNETPROFIT),
      ocfLocal100m: local100m(cashflow?.NETCASH_OPERATE),
      capexLocal100m: capex === null ? null : Math.abs(capex) / 100_000_000,
      cashLocal100m: local100m(balance?.MONETARYFUNDS),
      debtLocal100m: local100m(
        sumFields(balance, [
          "SHORT_LOAN",
          "LONG_LOAN",
          "BOND_PAYABLE",
          "SHORT_BOND_PAYABLE",
          "LEASE_LIAB",
        ]),
      ),
      employees: finiteNumber(main.STAFF_NUM),
      revenueGrowth: percentDecimal(main.TOTALOPERATEREVETZ),
      grossMargin: percentDecimal(main.XSMLL),
      netMargin: percentDecimal(main.XSJLL),
      roic: percentDecimal(main.ROIC),
      structuredSource: security.structuredSource,
      sources: baseSources([
        ["A股主要指标", A_MAIN_REPORT, EASTMONEY_SECURITIES_API],
        ["A股资产负债表", A_BALANCE_REPORT, EASTMONEY_SECURITIES_API],
        ["A股现金流量表", A_CASHFLOW_REPORT, EASTMONEY_SECURITIES_API],
      ]),
      errors,
    },
    now,
  );
}

async function fetchHKFinancials(
  security: NormalizedFinancialSecurity,
  configuration: ReturnType<typeof fetchConfiguration>,
  now: () => Date,
): Promise<CustomFinancialSnapshot> {
  const errors: string[] = [];
  const mainUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: HK_MAIN_REPORT,
    columns: "HKF10_FN_MAININDICATOR",
    quoteColumns: "",
    pageNumber: "1",
    pageSize: "20",
    sortTypes: "-1",
    sortColumns: "STD_REPORT_DATE",
    source: "F10",
    client: "PC",
    filter: `(SECUCODE="${security.eastmoneyCode}")(DATE_TYPE_CODE="001")`,
  });
  const profileUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: HK_PROFILE_REPORT,
    columns: "SECUCODE,SECURITY_CODE,ORG_NAME,ORG_EN_ABBR,EMP_NUM",
    quoteColumns: "",
    filter: `(SECUCODE="${security.eastmoneyCode}")`,
    pageNumber: "1",
    pageSize: "20",
    sortTypes: "",
    sortColumns: "",
    source: "F10",
    client: "PC",
  });
  const summaryUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: HK_REPORT_SUMMARY,
    columns:
      "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,START_DATE,REPORT_DATE," +
      "FISCAL_YEAR,CURRENCY,ACCOUNT_STANDARD,REPORT_TYPE",
    quoteColumns: "",
    filter: `(SECUCODE="${security.eastmoneyCode}")`,
    source: "F10",
    client: "PC",
  });
  const [mainRows, profileRows, summaryContainer] = await Promise.all([
    rowsFor("港股主要指标", mainUrl, configuration, errors),
    rowsFor("港股公司资料", profileUrl, configuration, errors),
    rowsFor("港股报表摘要", summaryUrl, configuration, errors),
  ]);
  const fallbackMain = annualIndicatorRow(mainRows);
  if (!fallbackMain) throw new Error(errors[0] ?? "未找到港股最近完整年报");
  const reportList = Array.isArray(summaryContainer[0]?.REPORT_LIST)
    ? summaryContainer[0].REPORT_LIST.filter(isRecord)
    : [];
  const annualSummary =
    sortedByReportDate(
      reportList.filter((row) => row.REPORT_TYPE === "年报"),
    )[0] ?? null;
  const reportDateFilter =
    reportDateFilterValue(annualSummary?.REPORT_DATE) ??
    reportDateFilterValue(fallbackMain.REPORT_DATE);
  const reportDate = dateOnly(reportDateFilter);
  if (!reportDate) throw new Error("港股年报日期缺失");
  const main = matchingReportDate(mainRows, reportDate) ?? fallbackMain;
  const statementFilter =
    `(SECUCODE="${security.eastmoneyCode}")` +
    `(REPORT_DATE in ('${reportDateFilter}'))`;
  const balanceUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: HK_BALANCE_REPORT,
    columns: HK_BALANCE_COLUMNS,
    quoteColumns: "",
    filter: statementFilter,
    pageNumber: "1",
    pageSize: "500",
    sortTypes: "-1,1",
    sortColumns: "REPORT_DATE,STD_ITEM_CODE",
    source: "F10",
    client: "PC",
  });
  const cashflowUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: HK_CASHFLOW_REPORT,
    columns: HK_CASHFLOW_COLUMNS,
    quoteColumns: "",
    filter: statementFilter,
    pageNumber: "1",
    pageSize: "500",
    sortTypes: "-1,1",
    sortColumns: "REPORT_DATE,STD_ITEM_CODE",
    source: "F10",
    client: "PC",
  });
  const [balanceRows, cashflowRows] = await Promise.all([
    rowsFor("港股资产负债表", balanceUrl, configuration, errors),
    rowsFor("港股现金流量表", cashflowUrl, configuration, errors),
  ]);
  const capex = sumNamedRows(cashflowRows, [
    "购建固定资产",
    "购建无形资产及其他资产",
  ]);
  const reportCurrency =
    normalizeCurrency(annualSummary?.CURRENCY) ??
    normalizeCurrency(main.CURRENCY);

  return finishSnapshot(
    {
      securityCode: security.securityCode,
      market: "HK",
      reportPeriod: `${reportDate.slice(0, 4)}年报`,
      reportDate,
      noticeDate: dateOnly(main.NOTICE_DATE),
      financialCurrency: reportCurrency,
      revenueLocal100m: local100m(main.OPERATE_INCOME),
      grossProfitLocal100m: local100m(main.GROSS_PROFIT),
      netProfitLocal100m: local100m(main.HOLDER_PROFIT),
      ocfLocal100m: local100m(
        sumNamedRows(cashflowRows, ["经营业务现金净额"]),
      ),
      capexLocal100m: capex === null ? null : Math.abs(capex) / 100_000_000,
      cashLocal100m: local100m(
        sumNamedRows(balanceRows, ["现金及等价物", "短期存款"]),
      ),
      debtLocal100m: local100m(
        sumNamedRows(balanceRows, [
          "短期贷款",
          "长期贷款",
          "融资租赁负债(流动)",
          "融资租赁负债(非流动)",
        ]),
      ),
      employees: finiteNumber(profileRows[0]?.EMP_NUM),
      revenueGrowth: percentDecimal(main.OPERATE_INCOME_YOY),
      grossMargin: percentDecimal(main.GROSS_PROFIT_RATIO),
      netMargin: percentDecimal(main.NET_PROFIT_RATIO),
      roic: percentDecimal(main.ROIC_YEARLY),
      structuredSource: security.structuredSource,
      sources: baseSources([
        ["港股主要指标", HK_MAIN_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["港股公司资料", HK_PROFILE_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["港股报表摘要", HK_REPORT_SUMMARY, EASTMONEY_SECURITIES_V1_API],
        ["港股资产负债表", HK_BALANCE_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["港股现金流量表", HK_CASHFLOW_REPORT, EASTMONEY_SECURITIES_V1_API],
      ]),
      errors,
    },
    now,
  );
}

async function fetchUSFinancials(
  security: NormalizedFinancialSecurity,
  configuration: ReturnType<typeof fetchConfiguration>,
  now: () => Date,
): Promise<CustomFinancialSnapshot> {
  const errors: string[] = [];
  const profileUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: US_PROFILE_REPORT,
    columns:
      "SECUCODE,SECURITY_CODE,ORG_CODE,SECURITY_INNER_CODE,ORG_NAME," +
      "ORG_EN_ABBR,EMP_NUM",
    quoteColumns: "",
    filter: `(SECURITY_CODE="${security.eastmoneyCode}")`,
    pageNumber: "1",
    pageSize: "20",
    sortTypes: "",
    sortColumns: "",
    source: "SECURITIES",
    client: "PC",
  });
  const profileRows = await rowsFor(
    "美股公司资料",
    profileUrl,
    configuration,
    errors,
  );
  const profile = profileRows[0];
  const eastmoneySecucode = textOrNull(profile?.SECUCODE);
  if (!eastmoneySecucode || !/^[A-Z0-9.-]{1,15}\.[A-Z]{1,4}$/.test(eastmoneySecucode)) {
    throw new Error(errors[0] ?? "东方财富未识别该美股代码");
  }
  const mainUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: US_MAIN_REPORT,
    columns: "USF10_FN_GMAININDICATOR",
    quoteColumns: "",
    pageNumber: "1",
    pageSize: "20",
    sortTypes: "-1",
    sortColumns: "REPORT_DATE",
    source: "SECURITIES",
    client: "PC",
    filter: `(SECUCODE="${eastmoneySecucode}")(DATE_TYPE_CODE="001")`,
  });
  const mainRows = await rowsFor("美股主要指标", mainUrl, configuration, errors);
  const main = annualIndicatorRow(mainRows);
  if (!main) throw new Error(errors[0] ?? "未找到美股最近完整年报");
  const reportDate = dateOnly(main.REPORT_DATE);
  const reportToken = textOrNull(main.REPORT_TYPE);
  const safeReportToken =
    reportToken && /^\d{4}\/FY$/.test(reportToken) ? reportToken : null;
  if (!reportDate) throw new Error("美股年报日期缺失");
  if (!safeReportToken) {
    errors.push("美股年报标识缺失，资产负债表与现金流量表未更新");
  }
  const statementFilter = safeReportToken
    ? `(SECUCODE="${eastmoneySecucode}")(REPORT in ("${safeReportToken}"))`
    : `(SECUCODE="${eastmoneySecucode}")(REPORT_DATE="${reportDate}")`;
  const balanceUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: US_BALANCE_REPORT,
    columns: US_STATEMENT_COLUMNS,
    quoteColumns: "",
    filter: statementFilter,
    pageNumber: "1",
    pageSize: "500",
    sortTypes: "1,-1",
    sortColumns: "STD_ITEM_CODE,REPORT_DATE",
    source: "SECURITIES",
    client: "PC",
  });
  const cashflowUrl = createUrl(EASTMONEY_SECURITIES_V1_API, {
    reportName: US_CASHFLOW_REPORT,
    columns: US_STATEMENT_COLUMNS,
    quoteColumns: "",
    filter: statementFilter,
    pageNumber: "1",
    pageSize: "500",
    sortTypes: "1,-1",
    sortColumns: "STD_ITEM_CODE,REPORT_DATE",
    source: "SECURITIES",
    client: "PC",
  });
  const [balanceRows, cashflowRows] = await Promise.all([
    rowsFor("美股资产负债表", balanceUrl, configuration, errors),
    rowsFor("美股现金流量表", cashflowUrl, configuration, errors),
  ]);
  const capex = sumNamedRows(cashflowRows, ["购买固定资产", "购建固定资产"]);

  return finishSnapshot(
    {
      securityCode: security.securityCode,
      market: "US",
      reportPeriod:
        textOrNull(main.REPORT_DATA_TYPE) ?? `${reportDate.slice(0, 4)}年报`,
      reportDate,
      noticeDate: dateOnly(main.NOTICE_DATE),
      financialCurrency:
        normalizeCurrency(main.CURRENCY_ABBR) ??
        normalizeCurrency(main.CURRENCY),
      revenueLocal100m: local100m(main.OPERATE_INCOME),
      grossProfitLocal100m: local100m(main.GROSS_PROFIT),
      netProfitLocal100m: local100m(main.PARENT_HOLDER_NETPROFIT),
      ocfLocal100m: local100m(
        sumNamedRows(cashflowRows, ["经营活动产生的现金流量净额"]),
      ),
      capexLocal100m: capex === null ? null : Math.abs(capex) / 100_000_000,
      cashLocal100m: local100m(
        sumNamedRows(balanceRows, ["现金及现金等价物"]),
      ),
      debtLocal100m: local100m(
        sumNamedRows(balanceRows, [
          "短期债务",
          "一年内到期长期债务",
          "长期债务",
          "资本租赁债务(流动)",
          "资本租赁债务(非流动)",
        ]),
      ),
      employees: finiteNumber(profile?.EMP_NUM),
      revenueGrowth: percentDecimal(main.OPERATE_INCOME_YOY),
      grossMargin: percentDecimal(main.GROSS_PROFIT_RATIO),
      netMargin: percentDecimal(main.NET_PROFIT_RATIO),
      roic: null,
      structuredSource: security.structuredSource,
      sources: baseSources([
        ["美股公司资料", US_PROFILE_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["美股主要指标", US_MAIN_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["美股资产负债表", US_BALANCE_REPORT, EASTMONEY_SECURITIES_V1_API],
        ["美股现金流量表", US_CASHFLOW_REPORT, EASTMONEY_SECURITIES_V1_API],
      ]),
      errors,
    },
    now,
  );
}

export async function fetchCustomFinancial(
  request: CustomFinancialRequest,
  options: CustomFinancialFetchOptions = {},
): Promise<CustomFinancialSnapshot> {
  const now = options.now ?? (() => new Date());
  try {
    if (typeof (options.fetch ?? globalThis.fetch) !== "function") {
      throw new Error("当前浏览器不支持联网财务更新");
    }
    const security = normalizeFinancialSecurity(request);
    const configuration = fetchConfiguration(options);
    if (security.market === "A") {
      return await fetchAFinancials(security, configuration, now);
    }
    if (security.market === "HK") {
      return await fetchHKFinancials(security, configuration, now);
    }
    return await fetchUSFinancials(security, configuration, now);
  } catch (error) {
    return unavailableSnapshot(request, error, now);
  }
}

export async function fetchCustomFinancials(
  requests: CustomFinancialRequest[],
  options: CustomFinancialFetchOptions = {},
): Promise<CustomFinancialSnapshot[]> {
  const concurrency = Math.min(
    MAX_CONCURRENCY,
    Math.max(
      1,
      Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY),
    ),
  );
  const results = new Array<CustomFinancialSnapshot>(requests.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < requests.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fetchCustomFinancial(requests[index], options);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, requests.length) },
      () => worker(),
    ),
  );
  return results;
}
