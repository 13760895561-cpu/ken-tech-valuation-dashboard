import type {
  CustomMarket,
  CustomWatchCompany,
} from "./watch-pool";

export interface SearchableDefaultCompany {
  id: string;
  name: string;
  ticker: string;
  group: string;
  region: string;
}

export interface WatchSearchCandidate {
  id: string;
  source: "default" | "curated" | "directory";
  defaultId: string | null;
  name: string;
  englishName: string;
  ticker: string;
  market: CustomMarket;
  quoteCode: string | null;
  note: string;
  aliases: string[];
}

export interface SecurityCatalogDocument {
  schemaVersion: number;
  generatedAt: string;
  sourceAsOf: string;
  securities: unknown[];
}

export type WatchSearchAvailability =
  | "available"
  | "default-visible"
  | "default-hidden"
  | "custom-added";

export type WatchSearchKeyDecision =
  | { type: "none"; index: number }
  | { type: "move"; index: number }
  | { type: "select"; index: number }
  | { type: "clear"; index: number };

const DEFAULT_ALIASES: Record<
  string,
  { englishName?: string; aliases: string[] }
> = {
  "688256": {
    englishName: "Cambricon",
    aliases: ["寒武纪科技", "hanwuj", "hanwujikeji", "hwj"],
  },
  "688041": {
    englishName: "Hygon Information",
    aliases: ["Hygon", "haiguangxinxi", "hgxx"],
  },
  "688047": {
    englishName: "Loongson Technology",
    aliases: ["Loongson", "longxinzhongke", "lxzk"],
  },
  NVDA: {
    englishName: "NVIDIA",
    aliases: ["yingweida", "ywd"],
  },
  AMD: {
    englishName: "Advanced Micro Devices",
    aliases: ["chaoweibandaoti", "cwbdt", "chaowei"],
  },
  AVGO: {
    englishName: "Broadcom",
    aliases: ["botong", "bt"],
  },
  "300308": {
    englishName: "Zhongji Innolight",
    aliases: ["Innolight", "zhongjixuchuang", "zjxc"],
  },
  "300502": {
    englishName: "Eoptolink Technology",
    aliases: ["Eoptolink", "xinyisheng", "xys"],
  },
  "300394": {
    englishName: "TFC Optical Communication",
    aliases: ["TFC", "tianfutongxin", "tftx"],
  },
  COHR: {
    englishName: "Coherent",
    aliases: ["gaoyidianzi", "gydz"],
  },
  LITE: {
    englishName: "Lumentum",
    aliases: ["lumentum holdings"],
  },
  FN: {
    englishName: "Fabrinet",
    aliases: ["fabrinet"],
  },
  "688111": {
    englishName: "Kingsoft Office",
    aliases: ["WPS", "jinshanbangong", "jsbg"],
  },
  "002230": {
    englishName: "iFlytek",
    aliases: ["kedaxunfei", "kdxf"],
  },
  "600588": {
    englishName: "Yonyou",
    aliases: ["yongyouwangluo", "yywl"],
  },
  "00700": {
    englishName: "Tencent Holdings",
    aliases: ["Tencent", "tengxunkonggu", "txkg", "tx"],
  },
  "09988": {
    englishName: "Alibaba Group",
    aliases: ["Alibaba", "alibabagroup", "alibaba", "albb"],
  },
  MSFT: {
    englishName: "Microsoft",
    aliases: ["weiruan", "wr"],
  },
  GOOGL: {
    englishName: "Alphabet",
    aliases: ["Google", "guge", "gg"],
  },
  ADBE: {
    englishName: "Adobe",
    aliases: ["adobe"],
  },
  "601138": {
    englishName: "Foxconn Industrial Internet",
    aliases: ["FII", "gongyefulian", "gyfl"],
  },
  "000977": {
    englishName: "Inspur Electronic Information",
    aliases: ["Inspur", "langchaoxinxi", "lcxx"],
  },
  "603019": {
    englishName: "Sugon",
    aliases: ["Dawning", "zhongkeshuguang", "zksg"],
  },
  DELL: {
    englishName: "Dell Technologies",
    aliases: ["Dell", "daierkeji", "dekj"],
  },
  HPE: {
    englishName: "Hewlett Packard Enterprise",
    aliases: ["huiyukeji", "hykj"],
  },
  SMCI: {
    englishName: "Super Micro Computer",
    aliases: ["Supermicro", "chaoweidiannao", "cwdn"],
  },
  "000062": {
    englishName: "Shenzhen Huaqiang",
    aliases: ["shenzhenhuaqiang", "szhq"],
  },
  "001287": {
    englishName: "CECport Technologies",
    aliases: ["CECport", "zhongdiangang", "zdg"],
  },
  "300184": {
    englishName: "Wuhan P&S Information Technology",
    aliases: ["liyuanxinxi", "lyxx"],
  },
  ARW: {
    englishName: "Arrow Electronics",
    aliases: ["Arrow", "airo"],
  },
  AVT: {
    englishName: "Avnet",
    aliases: ["anfuli"],
  },
};

const CURATED_CANDIDATES: WatchSearchCandidate[] = [
  {
    id: "curated:688825",
    source: "curated",
    defaultId: null,
    name: "长鑫科技",
    englishName: "ChangXin Memory Technologies",
    ticker: "688825.SH",
    market: "A",
    quoteCode: "sh688825",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: [
      "ChangXin Technology",
      "ChangXin Memory",
      "CXMT",
      "changxinkeji",
      "cxkj",
      "changxin",
      "cx",
    ],
  },
  {
    id: "curated:688981",
    source: "curated",
    defaultId: null,
    name: "中芯国际",
    englishName: "Semiconductor Manufacturing International",
    ticker: "688981.SH",
    market: "A",
    quoteCode: "sh688981",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["SMIC", "zhongxinguoji", "zxgj"],
  },
  {
    id: "curated:002371",
    source: "curated",
    defaultId: null,
    name: "北方华创",
    englishName: "NAURA Technology",
    ticker: "002371.SZ",
    market: "A",
    quoteCode: "sz002371",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["NAURA", "beifanghuachuang", "bfhc"],
  },
  {
    id: "curated:002463",
    source: "curated",
    defaultId: null,
    name: "沪电股份",
    englishName: "WUS Printed Circuit",
    ticker: "002463.SZ",
    market: "A",
    quoteCode: "sz002463",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["WUS", "hudiangufen", "hdgf"],
  },
  {
    id: "curated:TSM",
    source: "curated",
    defaultId: null,
    name: "台积电",
    englishName: "Taiwan Semiconductor Manufacturing",
    ticker: "TSM",
    market: "US",
    quoteCode: "usTSM",
    note:
      "美股存托凭证；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["TSMC", "Taiwan Semiconductor", "taijidian", "tjd"],
  },
  {
    id: "curated:MU",
    source: "curated",
    defaultId: null,
    name: "美光科技",
    englishName: "Micron Technology",
    ticker: "MU",
    market: "US",
    quoteCode: "usMU",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Micron", "meiguangkeji", "mgkj"],
  },
  {
    id: "curated:AAPL",
    source: "curated",
    defaultId: null,
    name: "苹果",
    englishName: "Apple",
    ticker: "AAPL",
    market: "US",
    quoteCode: "usAAPL",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Apple Inc", "pingguo", "pg"],
  },
  {
    id: "curated:AMZN",
    source: "curated",
    defaultId: null,
    name: "亚马逊",
    englishName: "Amazon",
    ticker: "AMZN",
    market: "US",
    quoteCode: "usAMZN",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Amazon.com", "yamaxun", "ymx"],
  },
  {
    id: "curated:META",
    source: "curated",
    defaultId: null,
    name: "Meta",
    englishName: "Meta Platforms",
    ticker: "META",
    market: "US",
    quoteCode: "usMETA",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Facebook", "lianpushu", "fb"],
  },
  {
    id: "curated:TSLA",
    source: "curated",
    defaultId: null,
    name: "特斯拉",
    englishName: "Tesla",
    ticker: "TSLA",
    market: "US",
    quoteCode: "usTSLA",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Tesla Motors", "tesila", "tsl"],
  },
  {
    id: "curated:ASML",
    source: "curated",
    defaultId: null,
    name: "阿斯麦",
    englishName: "ASML",
    ticker: "ASML",
    market: "US",
    quoteCode: "usASML",
    note:
      "美股存托凭证；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["ASML Holding", "asimai", "asm"],
  },
  {
    id: "curated:01810",
    source: "curated",
    defaultId: null,
    name: "小米集团",
    englishName: "Xiaomi",
    ticker: "01810.HK",
    market: "HK",
    quoteCode: "hk01810",
    note:
      "智能搜索候选；自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
    aliases: ["Xiaomi Corporation", "xiaomijituan", "xmjt", "xm"],
  },
];

export function normalizeWatchSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("en-US")
    .replace(/[\s._\-‐‑‒–—/·,，:：()（）]+/g, "");
}

function catalogText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function directoryMarket(value: unknown): CustomMarket | null {
  const market = catalogText(value, 8).toUpperCase();
  return market === "A" || market === "HK" || market === "US"
    ? market
    : null;
}

function validDirectoryQuoteCode(
  market: CustomMarket,
  quoteCode: string,
): boolean {
  if (market === "A") return /^(sh|sz|bj)\d{6}$/i.test(quoteCode);
  if (market === "HK") return /^hk\d{5}$/i.test(quoteCode);
  return /^us[A-Za-z0-9._-]{1,15}$/i.test(quoteCode);
}

export function parseSecurityCatalog(
  value: unknown,
): WatchSearchCandidate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("证券目录格式无效");
  }
  const document = value as Record<string, unknown>;
  if (
    document.schemaVersion !== 1 ||
    !Array.isArray(document.securities)
  ) {
    throw new Error("证券目录版本不兼容");
  }

  const candidates: WatchSearchCandidate[] = [];
  const identities = new Set<string>();
  for (const raw of document.securities) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (
      catalogText(record.instrumentType, 20) !== "stock" ||
      catalogText(record.listingStatus, 20) !== "listed"
    ) {
      continue;
    }
    const market = directoryMarket(record.market);
    const ticker = catalogText(record.ticker, 24).toUpperCase();
    const quoteCode = catalogText(record.quoteCode, 32);
    const name =
      catalogText(record.nameZh, 80) || catalogText(record.nameEn, 80);
    if (
      !market ||
      !ticker ||
      !name ||
      !validDirectoryQuoteCode(market, quoteCode)
    ) {
      continue;
    }
    const identity = `${market}:${normalizeWatchSearch(ticker)}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    const aliases = Array.isArray(record.aliases)
      ? record.aliases
          .map((alias) => catalogText(alias, 100))
          .filter(Boolean)
          .slice(0, 24)
      : [];
    const canonicalKey =
      catalogText(record.canonicalKey, 100) || identity;
    candidates.push({
      id: `directory:${canonicalKey}`,
      source: "directory",
      defaultId: catalogText(record.defaultId, 40) || null,
      name,
      englishName: catalogText(record.nameEn, 80),
      ticker,
      market,
      quoteCode,
      note:
        "证券目录匹配；添加后自动获取可验证行情与最近完整年报财务，自定义公司不自动进入可比组或估值模型。",
      aliases,
    });
  }
  if (!candidates.length) throw new Error("证券目录没有有效候选");
  return candidates;
}

function marketFromDefault(company: SearchableDefaultCompany): CustomMarket {
  if (company.region.includes("A股")) return "A";
  if (company.region.includes("港股")) return "HK";
  if (company.region.includes("美股")) return "US";
  return "OTHER";
}

function tickerAliases(ticker: string): string[] {
  const upper = ticker.toUpperCase();
  const match = upper.match(/^([A-Z0-9]+)\.(SH|SZ|BJ|HK)$/);
  if (!match) return [upper];
  const [, symbol, suffix] = match;
  return [upper, symbol, `${suffix}${symbol}`, `${symbol}${suffix}`];
}

export function buildWatchSearchCatalog(
  defaultCompanies: SearchableDefaultCompany[],
  directoryCandidates: WatchSearchCandidate[] = [],
): WatchSearchCandidate[] {
  const defaults = defaultCompanies.map((company) => {
    const alias = DEFAULT_ALIASES[company.id] ?? {
      englishName: "",
      aliases: [],
    };
    return {
      id: `default:${company.id}`,
      source: "default" as const,
      defaultId: company.id,
      name: company.name,
      englishName: alias.englishName ?? "",
      ticker: company.ticker,
      market: marketFromDefault(company),
      quoteCode: null,
      note: `${company.group} · ${company.region}`,
      aliases: [...tickerAliases(company.ticker), ...alias.aliases],
    };
  });
  const catalog = [...defaults, ...CURATED_CANDIDATES];
  const byIdentity = new Map(
    catalog.map((candidate, index) => [
      `${candidate.market}:${normalizeWatchSearch(candidate.ticker)}`,
      index,
    ]),
  );
  for (const candidate of directoryCandidates) {
    const identity = `${candidate.market}:${normalizeWatchSearch(
      candidate.ticker,
    )}`;
    const existingIndex = byIdentity.get(identity);
    if (existingIndex === undefined) {
      byIdentity.set(identity, catalog.length);
      catalog.push(candidate);
      continue;
    }
    const existing = catalog[existingIndex];
    catalog[existingIndex] = {
      ...existing,
      englishName: existing.englishName || candidate.englishName,
      aliases: [
        ...new Set([...existing.aliases, ...candidate.aliases]),
      ],
    };
  }
  return catalog;
}

function candidateTerms(candidate: WatchSearchCandidate): string[] {
  return [
    candidate.name,
    candidate.englishName,
    candidate.ticker,
    ...tickerAliases(candidate.ticker),
    ...candidate.aliases,
  ]
    .map(normalizeWatchSearch)
    .filter(Boolean);
}

function candidateScore(
  candidate: WatchSearchCandidate,
  query: string,
): number | null {
  let best: number | null = null;
  for (const term of candidateTerms(candidate)) {
    let score: number | null = null;
    if (term === query) score = 0;
    else if (term.startsWith(query)) {
      score = 20 + term.length - query.length;
    } else {
      const index = term.indexOf(query);
      if (index >= 0) {
        score = 60 + index + term.length - query.length;
      }
    }
    if (score !== null && (best === null || score < best)) best = score;
  }
  if (best === null) return null;
  return best + (candidate.source === "default" ? 0 : 1);
}

export function searchWatchCatalog(
  query: string,
  catalog: WatchSearchCandidate[],
  limit = 8,
): WatchSearchCandidate[] {
  const normalizedQuery = normalizeWatchSearch(query);
  if (!normalizedQuery || limit <= 0) return [];

  return catalog
    .map((candidate, index) => {
      return {
        candidate,
        index,
        score: candidateScore(candidate, normalizedQuery),
      };
    })
    .filter(
      (
        item,
      ): item is {
        candidate: WatchSearchCandidate;
        index: number;
        score: number;
      } => item.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.candidate);
}

export function getWatchSearchAvailability(
  candidate: WatchSearchCandidate,
  hiddenDefaultIds: Iterable<string>,
  customCompanies: Pick<
    CustomWatchCompany,
    "market" | "ticker" | "quoteCode"
  >[],
): WatchSearchAvailability {
  if (candidate.source === "default" && candidate.defaultId) {
    return new Set(hiddenDefaultIds).has(candidate.defaultId)
      ? "default-hidden"
      : "default-visible";
  }
  const exists = customCompanies.some((company) => {
    if (candidate.quoteCode && company.quoteCode) {
      return (
        candidate.quoteCode.toLowerCase() ===
        company.quoteCode.toLowerCase()
      );
    }
    return (
      candidate.market === company.market &&
      normalizeWatchSearch(candidate.ticker) ===
        normalizeWatchSearch(company.ticker)
    );
  });
  return exists ? "custom-added" : "available";
}

export function resolveWatchSearchKey(
  key: string,
  isComposing: boolean,
  query: string,
  resultCount: number,
  currentIndex: number,
): WatchSearchKeyDecision {
  const safeIndex =
    resultCount > 0
      ? Math.min(Math.max(currentIndex, 0), resultCount - 1)
      : 0;
  if (isComposing) return { type: "none", index: safeIndex };
  if (key === "ArrowDown" && resultCount > 0) {
    return {
      type: "move",
      index: Math.min(safeIndex + 1, resultCount - 1),
    };
  }
  if (key === "ArrowUp" && resultCount > 0) {
    return { type: "move", index: Math.max(safeIndex - 1, 0) };
  }
  if (key === "Enter" && resultCount > 0) {
    return { type: "select", index: safeIndex };
  }
  if (key === "Escape" && query) {
    return { type: "clear", index: 0 };
  }
  return { type: "none", index: safeIndex };
}
