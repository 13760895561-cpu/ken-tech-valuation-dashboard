export const WATCH_POOL_STORAGE_KEY =
  "ken-tech-valuation-dashboard:watch-pool:v1";
export const WATCH_POOL_EXPORT_KIND = "ken-tech-watch-pool";
export const WATCH_POOL_VERSION = 1 as const;
export const WATCH_POOL_SYNC_PREFIX = "KTV1.";
export const MAX_CUSTOM_COMPANIES = 100;
export const MAX_IMPORT_BYTES = 512 * 1024;

export type CustomMarket = "A" | "HK" | "US" | "OTHER";
export type CustomQuoteStatus = "fresh" | "stale" | "unavailable";

export interface CustomWatchCompany {
  id: string;
  name: string;
  ticker: string;
  market: CustomMarket;
  region: string;
  currency: string;
  quoteCode: string | null;
  note: string;
  createdAt: string;
}

export interface CustomQuoteSnapshot {
  verifiedName: string | null;
  priceLocal: number | null;
  changePct: number | null;
  quoteDate: string | null;
  marketCapLocal100m: number | null;
  status: CustomQuoteStatus;
  updatedAt: string;
}

export interface WatchPoolState {
  version: typeof WATCH_POOL_VERSION;
  hiddenDefaultIds: string[];
  customCompanies: CustomWatchCompany[];
  quoteCache: Record<string, CustomQuoteSnapshot>;
  updatedAt: string;
}

export interface WatchPoolExport {
  kind: typeof WATCH_POOL_EXPORT_KIND;
  version: typeof WATCH_POOL_VERSION;
  exportedAt: string;
  universe: {
    companyIds: string[];
  };
  hiddenDefaultIds: string[];
  customCompanies: CustomWatchCompany[];
}

export interface WatchPoolImportSummary {
  hiddenCount: number;
  customCount: number;
  skippedHiddenCount: number;
  skippedCustomCount: number;
  discardedFinancialFieldCount: number;
}

export interface ParsedWatchPoolImport {
  state: WatchPoolState;
  summary: WatchPoolImportSummary;
}

export interface CustomCompanyInput {
  name: string;
  ticker: string;
  market: CustomMarket;
  quoteCode?: string | null;
  note?: string;
}

const FINANCIAL_IMPORT_FIELDS = new Set([
  "employees",
  "revenue",
  "revenue_local_100m",
  "gross_profit_local_100m",
  "net_profit_local_100m",
  "ocf_local_100m",
  "capex_local_100m",
  "cash_local_100m",
  "debt_local_100m",
  "pe",
  "ps",
  "p_fcf",
  "pFcf",
  "evSales",
  "evGrossProfit",
  "modelLow",
  "modelCenter",
  "modelHigh",
  "temperatureScore",
  "confidenceScore",
  "valuation",
  "financials",
]);

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMarket(value: unknown): CustomMarket | null {
  const market = cleanText(value, 12).toUpperCase();
  return market === "A" ||
    market === "HK" ||
    market === "US" ||
    market === "OTHER"
    ? market
    : null;
}

function defaultsForMarket(market: CustomMarket): {
  region: string;
  currency: string;
} {
  if (market === "A") return { region: "A股", currency: "CNY" };
  if (market === "HK") return { region: "港股", currency: "HKD" };
  if (market === "US") return { region: "美股", currency: "USD" };
  return { region: "其他市场", currency: "" };
}

function inferAQuotePrefix(ticker: string): "sh" | "sz" | "bj" | null {
  const digits = ticker.match(/\d{6}/)?.[0];
  if (!digits) return null;
  if (/^(4|8|92)/.test(digits)) return "bj";
  if (/^(5|6|9)/.test(digits)) return "sh";
  if (/^(0|1|2|3)/.test(digits)) return "sz";
  return null;
}

export function normalizeQuoteCode(
  market: CustomMarket,
  ticker: string,
  explicitCode?: string | null,
): string | null {
  const explicit = cleanText(explicitCode, 32).replace(/\s/g, "");
  if (explicit) {
    if (/^(sh|sz|bj)\d{6}$/i.test(explicit)) {
      return explicit.toLowerCase();
    }
    if (/^hk\d{5}$/i.test(explicit)) {
      return `hk${explicit.slice(2).padStart(5, "0")}`;
    }
    if (/^us[A-Za-z0-9._-]{1,15}$/i.test(explicit)) {
      return `us${explicit.slice(2).toUpperCase()}`;
    }
    throw new Error("腾讯行情代码格式不正确");
  }

  const normalizedTicker = cleanText(ticker, 24).toUpperCase();
  if (market === "A") {
    const digits = normalizedTicker.match(/\d{6}/)?.[0];
    const prefix = inferAQuotePrefix(normalizedTicker);
    return digits && prefix ? `${prefix}${digits}` : null;
  }
  if (market === "HK") {
    const digits = normalizedTicker.match(/\d{1,5}/)?.[0];
    return digits ? `hk${digits.padStart(5, "0")}` : null;
  }
  if (market === "US") {
    const symbol = normalizedTicker
      .replace(/\.US$/, "")
      .replace(/[^A-Z0-9._-]/g, "");
    return symbol ? `us${symbol.slice(0, 15)}` : null;
  }
  return null;
}

function displayTicker(market: CustomMarket, ticker: string): string {
  const cleaned = cleanText(ticker, 24).toUpperCase();
  if (!cleaned) return "";
  if (market === "A") {
    const digits = cleaned.match(/\d{6}/)?.[0];
    const prefix = inferAQuotePrefix(cleaned);
    if (!digits || !prefix) return cleaned;
    return `${digits}.${prefix === "sh" ? "SH" : prefix === "sz" ? "SZ" : "BJ"}`;
  }
  if (market === "HK") {
    const digits = cleaned.match(/\d{1,5}/)?.[0];
    return digits ? `${digits.padStart(5, "0")}.HK` : cleaned;
  }
  return market === "US" ? cleaned.replace(/\.US$/, "") : cleaned;
}

function newId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `custom:${globalThis.crypto.randomUUID()}`;
  }
  return `custom:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createCustomWatchCompany(
  input: CustomCompanyInput,
): CustomWatchCompany {
  const market = normalizeMarket(input.market);
  if (!market) throw new Error("请选择有效市场");
  const name = cleanText(input.name, 80);
  const ticker = displayTicker(market, input.ticker);
  if (!name) throw new Error("请填写公司名称");
  if (!ticker) throw new Error("请填写证券代码或自定义代码");
  const defaults = defaultsForMarket(market);
  return {
    id: newId(),
    name,
    ticker,
    market,
    region: defaults.region,
    currency: defaults.currency,
    quoteCode: normalizeQuoteCode(market, ticker, input.quoteCode),
    note: cleanText(input.note, 240),
    createdAt: nowIso(),
  };
}

function sanitizeCustomCompany(
  value: unknown,
): CustomWatchCompany | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const market = normalizeMarket(record.market);
  const name = cleanText(record.name, 80);
  const rawTicker = cleanText(record.ticker, 24);
  if (!market || !name || !rawTicker) return null;
  const ticker = displayTicker(market, rawTicker);
  let quoteCode: string | null = null;
  try {
    quoteCode = normalizeQuoteCode(
      market,
      ticker,
      cleanText(record.quoteCode, 32) || null,
    );
  } catch {
    return null;
  }
  const defaults = defaultsForMarket(market);
  const id = cleanText(record.id, 90);
  return {
    id: id.startsWith("custom:") ? id : newId(),
    name,
    ticker,
    market,
    region: defaults.region,
    currency:
      market === "OTHER"
        ? cleanText(record.currency, 8).toUpperCase()
        : defaults.currency,
    quoteCode,
    note: cleanText(record.note, 240),
    createdAt:
      cleanText(record.createdAt, 40) || nowIso(),
  };
}

function sanitizeQuote(value: unknown): CustomQuoteSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = cleanText(record.status, 20);
  if (
    status !== "fresh" &&
    status !== "stale" &&
    status !== "unavailable"
  ) {
    return null;
  }
  return {
    verifiedName: cleanText(record.verifiedName, 80) || null,
    priceLocal: finiteOrNull(record.priceLocal),
    changePct: finiteOrNull(record.changePct),
    quoteDate: cleanText(record.quoteDate, 20) || null,
    marketCapLocal100m: finiteOrNull(record.marketCapLocal100m),
    status,
    updatedAt: cleanText(record.updatedAt, 40) || nowIso(),
  };
}

function dedupeCustomCompanies(
  values: CustomWatchCompany[],
): CustomWatchCompany[] {
  const result: CustomWatchCompany[] = [];
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const company of values) {
    const identity = company.quoteCode
      ? `quote:${company.quoteCode.toLowerCase()}`
      : `${company.market}:${company.ticker.toUpperCase()}`;
    if (ids.has(company.id) || identities.has(identity)) continue;
    ids.add(company.id);
    identities.add(identity);
    result.push(company);
    if (result.length >= MAX_CUSTOM_COMPANIES) break;
  }
  return result;
}

export function emptyWatchPoolState(): WatchPoolState {
  return {
    version: WATCH_POOL_VERSION,
    hiddenDefaultIds: [],
    customCompanies: [],
    quoteCache: {},
    updatedAt: nowIso(),
  };
}

export function sanitizeWatchPoolState(
  value: unknown,
  validDefaultIds: Iterable<string>,
): WatchPoolState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyWatchPoolState();
  }
  const record = value as Record<string, unknown>;
  if (record.version !== WATCH_POOL_VERSION) {
    return emptyWatchPoolState();
  }
  const allowedDefaults = new Set(validDefaultIds);
  const hiddenDefaultIds = Array.isArray(record.hiddenDefaultIds)
    ? [
        ...new Set(
          record.hiddenDefaultIds
            .map((item) => cleanText(item, 40))
            .filter((item) => item && allowedDefaults.has(item)),
        ),
      ]
    : [];
  const customCompanies = dedupeCustomCompanies(
    Array.isArray(record.customCompanies)
      ? record.customCompanies
          .map(sanitizeCustomCompany)
          .filter((item): item is CustomWatchCompany => Boolean(item))
      : [],
  );
  const quoteCache: Record<string, CustomQuoteSnapshot> = {};
  const allowedCustomIds = new Set(customCompanies.map((company) => company.id));
  if (
    record.quoteCache &&
    typeof record.quoteCache === "object" &&
    !Array.isArray(record.quoteCache)
  ) {
    for (const [id, quote] of Object.entries(
      record.quoteCache as Record<string, unknown>,
    )) {
      if (!allowedCustomIds.has(id)) continue;
      const sanitized = sanitizeQuote(quote);
      if (sanitized) quoteCache[id] = sanitized;
    }
  }
  return {
    version: WATCH_POOL_VERSION,
    hiddenDefaultIds,
    customCompanies,
    quoteCache,
    updatedAt: cleanText(record.updatedAt, 40) || nowIso(),
  };
}

export function loadWatchPool(
  storage: Storage,
  validDefaultIds: Iterable<string>,
): WatchPoolState {
  const raw = storage.getItem(WATCH_POOL_STORAGE_KEY);
  if (!raw) return emptyWatchPoolState();
  return sanitizeWatchPoolState(JSON.parse(raw) as unknown, validDefaultIds);
}

export function saveWatchPool(
  storage: Storage,
  state: WatchPoolState,
): void {
  storage.setItem(WATCH_POOL_STORAGE_KEY, JSON.stringify(state));
}

function exportEnvelope(
  state: WatchPoolState,
  defaultCompanyIds: Iterable<string>,
): WatchPoolExport {
  return {
    kind: WATCH_POOL_EXPORT_KIND,
    version: WATCH_POOL_VERSION,
    exportedAt: nowIso(),
    universe: {
      companyIds: [...new Set(defaultCompanyIds)].sort(),
    },
    hiddenDefaultIds: [...new Set(state.hiddenDefaultIds)].sort(),
    customCompanies: state.customCompanies.map((company) => ({ ...company })),
  };
}

export function serializeWatchPoolExport(
  state: WatchPoolState,
  defaultCompanyIds: Iterable<string>,
): string {
  return `${JSON.stringify(exportEnvelope(state, defaultCompanyIds), null, 2)}\n`;
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function createWatchPoolSyncCode(
  state: WatchPoolState,
  defaultCompanyIds: Iterable<string>,
): string {
  const compact = JSON.stringify(exportEnvelope(state, defaultCompanyIds));
  return `${WATCH_POOL_SYNC_PREFIX}${encodeBase64Url(compact)}`;
}

function financialFieldCount(record: Record<string, unknown>): number {
  return Object.keys(record).filter((key) => FINANCIAL_IMPORT_FIELDS.has(key))
    .length;
}

function parseTransferText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("导入内容为空");
  if (new TextEncoder().encode(trimmed).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("导入内容超过 512KB 限制");
  }
  const jsonText = trimmed.startsWith(WATCH_POOL_SYNC_PREFIX)
    ? decodeBase64Url(trimmed.slice(WATCH_POOL_SYNC_PREFIX.length))
    : trimmed;
  return JSON.parse(jsonText) as unknown;
}

export function parseWatchPoolImport(
  text: string,
  validDefaultIds: Iterable<string>,
): ParsedWatchPoolImport {
  const parsed = parseTransferText(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("导入内容不是有效的观察池文件");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.kind !== WATCH_POOL_EXPORT_KIND ||
    record.version !== WATCH_POOL_VERSION
  ) {
    throw new Error("观察池文件格式或版本不受支持");
  }
  const allowedDefaults = new Set(validDefaultIds);
  const rawHidden = Array.isArray(record.hiddenDefaultIds)
    ? record.hiddenDefaultIds
    : [];
  const hiddenDefaultIds = [
    ...new Set(
      rawHidden
        .map((item) => cleanText(item, 40))
        .filter((item) => item && allowedDefaults.has(item)),
    ),
  ];
  const rawCustom = Array.isArray(record.customCompanies)
    ? record.customCompanies
    : [];
  let discardedFinancialFieldCount = 0;
  const sanitizedCustom = rawCustom.flatMap((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      discardedFinancialFieldCount += financialFieldCount(
        item as Record<string, unknown>,
      );
    }
    const company = sanitizeCustomCompany(item);
    return company ? [company] : [];
  });
  const customCompanies = dedupeCustomCompanies(sanitizedCustom);
  return {
    state: {
      version: WATCH_POOL_VERSION,
      hiddenDefaultIds,
      customCompanies,
      quoteCache: {},
      updatedAt: nowIso(),
    },
    summary: {
      hiddenCount: hiddenDefaultIds.length,
      customCount: customCompanies.length,
      skippedHiddenCount: Math.max(0, rawHidden.length - hiddenDefaultIds.length),
      skippedCustomCount: Math.max(0, rawCustom.length - customCompanies.length),
      discardedFinancialFieldCount,
    },
  };
}

export function mergeWatchPoolStates(
  current: WatchPoolState,
  incoming: WatchPoolState,
): WatchPoolState {
  const customCompanies = dedupeCustomCompanies([
    ...current.customCompanies,
    ...incoming.customCompanies,
  ]);
  const allowedIds = new Set(customCompanies.map((company) => company.id));
  const quoteCache = Object.fromEntries(
    Object.entries(current.quoteCache).filter(([id]) => allowedIds.has(id)),
  );
  return {
    version: WATCH_POOL_VERSION,
    hiddenDefaultIds: [
      ...new Set([
        ...current.hiddenDefaultIds,
        ...incoming.hiddenDefaultIds,
      ]),
    ],
    customCompanies,
    quoteCache,
    updatedAt: nowIso(),
  };
}

export function stateWithTimestamp(
  state: Omit<WatchPoolState, "updatedAt"> | WatchPoolState,
): WatchPoolState {
  return { ...state, updatedAt: nowIso() };
}
