"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { DashboardDataset } from "@/lib/dashboard-types";
import type { DashboardExcelExportInput } from "@/lib/excel-export";
import {
  TENCENT_QUOTE_SOURCE,
  fetchCustomQuoteUpdates,
  refreshMarketDataset,
} from "@/lib/market-refresh";
import { buildDashboardData } from "@/lib/model";
import {
  WATCH_POOL_STORAGE_KEY,
  emptyWatchPoolState,
  loadWatchPool,
  saveWatchPool,
  sanitizeWatchPoolState,
  type CustomQuoteSnapshot,
  type CustomWatchCompany,
  type WatchPoolState,
} from "@/lib/watch-pool";
import WatchPoolManager, {
  type DefaultWatchCompany,
} from "./WatchPoolManager";
import PeerBreakdown from "./PeerBreakdown";
import "./dashboard.css";

type Primitive = string | number | boolean | null | undefined;
type UnknownRecord = Record<string, unknown>;

export interface DashboardCompany extends UnknownRecord {
  id: string;
  name: string;
  ticker: string;
  group: string;
  region: string;
  market?: string;
  role?: string;
  currency?: string;
  price_local?: number | null;
  change_pct?: number | null;
  quote_date?: string | null;
  report_period?: string | null;
  report_date?: string | null;
  employees?: number | null;
  currentMarketCapCny100m?: number | null;
  revenueCny100m?: number | null;
  grossProfitCny100m?: number | null;
  netProfitCny100m?: number | null;
  fcfCny100m?: number | null;
  enterpriseValueCny100m?: number | null;
  revenuePerEmployeeCny10k?: number | null;
  grossProfitPerEmployeeCny10k?: number | null;
  netProfitPerEmployeeCny10k?: number | null;
  marketCapPerEmployeeCny10k?: number | null;
  ps?: number | null;
  priceToGrossProfit?: number | null;
  evSales?: number | null;
  evGrossProfit?: number | null;
  pe?: number | null;
  pFcf?: number | null;
  fcfYield?: number | null;
  coreStatus?: string | null;
  valuationInputStatus?: string | null;
  quote_source?: string | null;
  official_report_source?: string | null;
  structured_source?: string | null;
  trackingOrigin?: "default" | "custom";
  customNote?: string | null;
}

export interface DashboardValuation extends UnknownRecord {
  id: string;
  name: string;
  ticker: string;
  group: string;
  currentMarketCapCny100m?: number | null;
  modelLow?: number | null;
  modelCenter?: number | null;
  modelHigh?: number | null;
  currentToCenter?: number | null;
  temperatureScore?: number | null;
  temperatureLabel?: string | null;
  validMethods?: number | null;
  dispersion?: number | null;
  freshnessScore?: number | null;
  peerQualityScore?: number | null;
  confidenceScore?: number | null;
  conclusion?: string | null;
  domesticPeerCount?: number | null;
  globalPeerCount?: number | null;
  anchors?: UnknownRecord | null;
  impliedValues?: UnknownRecord | null;
}

export interface DashboardStatus extends UnknownRecord {
  state?: string;
  stale?: boolean;
  initializedFromSeed?: boolean;
  refreshAttempted?: boolean;
  refreshed?: boolean;
  source?: string;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  message?: string;
}

export interface DashboardRefresh extends UnknownRecord {
  automatic?: boolean;
  staleAfterSeconds?: number;
  manual?: {
    method?: string;
    endpoint?: string;
    body?: UnknownRecord;
  };
  sources?: unknown;
}

export interface DashboardData extends UnknownRecord {
  asOf?: string;
  generatedAt?: string;
  quoteDateMin?: string;
  quoteDateMax?: string;
  fx?: UnknownRecord;
  companies?: DashboardCompany[];
  valuations?: DashboardValuation[];
  events?: UnknownRecord[];
  history?: UnknownRecord[];
  methodology?: UnknownRecord;
  summary?: UnknownRecord;
}

export interface DashboardResponse {
  ok?: boolean;
  data: DashboardData;
  status?: DashboardStatus;
  refresh?: DashboardRefresh;
}

export interface DashboardProps {
  initialData?: DashboardResponse | DashboardData;
  initialDataset?: DashboardDataset;
  pollIntervalSeconds?: number;
}

type TabKey =
  | "overview"
  | "valuation"
  | "core"
  | "peers"
  | "events"
  | "history"
  | "sources"
  | "methods";

type SortKey =
  | "marketCap"
  | "change"
  | "revenue"
  | "employees"
  | "temperature"
  | "confidence"
  | "name";

type ExcelExportState = "idle" | "exporting" | "success" | "error";

const TABS: Array<{ id: TabKey; label: string; shortLabel: string }> = [
  { id: "overview", label: "首页总览", shortLabel: "总览" },
  { id: "valuation", label: "估值明细", shortLabel: "估值" },
  { id: "core", label: "核心指标", shortLabel: "指标" },
  { id: "peers", label: "可比组统计", shortLabel: "可比组" },
  { id: "events", label: "事件跟踪", shortLabel: "事件" },
  { id: "history", label: "历史快照", shortLabel: "历史" },
  { id: "sources", label: "来源审计", shortLabel: "来源" },
  { id: "methods", label: "方法与假设", shortLabel: "方法" },
];

const FALLBACK_POLL_SECONDS = 300;
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;
const STATIC_DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/dashboard.json`;

function responseFromDataset(
  dataset: DashboardDataset,
  status: Partial<DashboardStatus> = {},
): DashboardResponse {
  return {
    ok: true,
    data: buildDashboardData(dataset) as unknown as DashboardData,
    status: {
      state: "fresh",
      stale: false,
      refreshAttempted: false,
      refreshed: false,
      source: "stored",
      lastSuccessAt: dataset.snapshot.generated_at,
      lastAttemptAt: null,
      message: "已加载最近一次持久化快照",
      ...status,
    },
    refresh: {
      automatic: true,
      staleAfterSeconds: FALLBACK_POLL_SECONDS,
      manual: {
        method: "BROWSER",
        endpoint: "腾讯行情与Frankfurter汇率",
      },
      sources: {
        quotes: "腾讯行情",
        fx: "Frankfurter",
      },
    },
  };
}

function isDashboardDataset(value: unknown): value is DashboardDataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DashboardDataset>;
  return Boolean(
    candidate.snapshot &&
      Array.isArray(candidate.snapshot.companies) &&
      candidate.snapshot.companies.length > 0 &&
      candidate.methodology &&
      Array.isArray(candidate.events) &&
      Array.isArray(candidate.history),
  );
}

function isResponse(value: DashboardResponse | DashboardData): value is DashboardResponse {
  return "data" in value && typeof value.data === "object";
}

function normalizeInitial(
  value: DashboardResponse | DashboardData | undefined,
): DashboardResponse | null {
  if (!value) return null;
  return isResponse(value) ? value : { ok: true, data: value };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function firstValue(record: UnknownRecord, keys: string[]): Primitive {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      if (value !== "" && value !== null && value !== undefined) return value;
    }
  }
  return null;
}

function formatNumber(value: unknown, digits = 1): string {
  const number = asNumber(value);
  if (number === null) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

function formatInteger(value: unknown): string {
  const number = asNumber(value);
  if (number === null) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(number);
}

function formatPercent(value: unknown, digits = 1): string {
  const number = asNumber(value);
  if (number === null) return "—";
  return `${(number * 100).toFixed(digits)}%`;
}

function formatScore(value: unknown): string {
  const number = asNumber(value);
  return number === null ? "—" : number.toFixed(0);
}

function formatDateTime(value: unknown): string {
  const text = asString(value);
  if (!text) return "尚无记录";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace("T", " ");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function safeLink(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function median(values: Array<number | null | undefined>): number | null {
  const valid = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function textIncludes(record: UnknownRecord, query: string): boolean {
  if (!query) return true;
  const haystack = Object.values(record)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLocaleLowerCase("zh-CN");
  return haystack.includes(query.toLocaleLowerCase("zh-CN"));
}

function temperatureClass(label: unknown, score: unknown): string {
  const text = asString(label);
  const numeric = asNumber(score);
  if (text.includes("极热") || text.includes("很热") || (numeric !== null && numeric >= 85)) {
    return "is-hot";
  }
  if (text.includes("偏热") || (numeric !== null && numeric >= 65)) return "is-warm";
  if (text.includes("冷") || (numeric !== null && numeric <= 30)) return "is-cool";
  return "is-neutral";
}

function statusClass(status: DashboardStatus | undefined): string {
  const state = asString(status?.state).toLowerCase();
  if (
    status?.stale ||
    state === "stale-retained" ||
    state.includes("failed")
  ) {
    return "is-warning";
  }
  if (["error", "failed", "unavailable"].includes(state)) return "is-danger";
  return "is-success";
}

function statusLabel(status: DashboardStatus | undefined): string {
  const state = asString(status?.state).toLowerCase();
  if (state === "stale-retained" || state.includes("failed")) {
    return "更新失败，沿用最近成功快照";
  }
  if (status?.stale) return "沿用最近成功快照";
  if (["error", "failed", "unavailable"].includes(state)) return "更新异常";
  if (["refreshing", "loading", "running"].includes(state)) return "正在更新";
  return "数据正常";
}

function toSortValue(
  company: DashboardCompany,
  valuation: DashboardValuation | undefined,
  key: SortKey,
): string | number {
  switch (key) {
    case "marketCap":
      return asNumber(company.currentMarketCapCny100m) ?? -Infinity;
    case "change":
      return asNumber(company.change_pct) ?? -Infinity;
    case "revenue":
      return asNumber(company.revenueCny100m) ?? -Infinity;
    case "employees":
      return asNumber(company.employees) ?? -Infinity;
    case "temperature":
      return asNumber(valuation?.temperatureScore) ?? -Infinity;
    case "confidence":
      return asNumber(valuation?.confidenceScore) ?? -Infinity;
    default:
      return company.name;
  }
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "sky" | "yellow" | "green";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state" role="status">
      <span aria-hidden="true">◇</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SortButton({
  label,
  column,
  active,
  direction,
  onSort,
}: {
  label: string;
  column: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      className="sort-button"
      type="button"
      onClick={() => onSort(column)}
      aria-label={`${label}，点击按${active && direction === "desc" ? "升序" : "降序"}排列`}
    >
      {label}
      <span aria-hidden="true">{active ? (direction === "desc" ? "↓" : "↑") : "↕"}</span>
    </button>
  );
}

function FilterBar({
  query,
  onQuery,
  group,
  onGroup,
  region,
  onRegion,
  groups,
  regions,
  resultCount,
  sortKey,
  onSortKey,
  showCompanyControls = true,
  searchPlaceholder = "搜索公司、代码或分组",
}: {
  query: string;
  onQuery: (value: string) => void;
  group: string;
  onGroup: (value: string) => void;
  region: string;
  onRegion: (value: string) => void;
  groups: string[];
  regions: string[];
  resultCount: number;
  sortKey: SortKey;
  onSortKey: (value: SortKey) => void;
  showCompanyControls?: boolean;
  searchPlaceholder?: string;
}) {
  return (
    <div className="filter-bar" aria-label="数据筛选工具">
      <label className="search-field">
        <span className="sr-only">{searchPlaceholder}</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>
      {showCompanyControls ? (
        <>
          <label>
            <span className="sr-only">按可比组筛选</span>
            <select value={group} onChange={(event) => onGroup(event.target.value)}>
              <option value="全部">全部可比组</option>
              {groups.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">按市场筛选</span>
            <select value={region} onChange={(event) => onRegion(event.target.value)}>
              <option value="全部">全部市场</option>
              {regions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">排序方式</span>
            <select
              value={sortKey}
              onChange={(event) => onSortKey(event.target.value as SortKey)}
            >
              <option value="marketCap">市值排序</option>
              <option value="change">涨跌幅排序</option>
              <option value="revenue">营业收入排序</option>
              <option value="employees">员工数排序</option>
              <option value="temperature">估值温度排序</option>
              <option value="confidence">置信度排序</option>
              <option value="name">公司名称排序</option>
            </select>
          </label>
        </>
      ) : null}
      <span className="result-count" aria-live="polite">
        {resultCount} 条结果
      </span>
    </div>
  );
}

function HorizontalChart({
  title,
  subtitle,
  rows,
  valueFormatter,
  tone,
  ariaLabel,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: number; meta?: string }>;
  valueFormatter: (value: number) => string;
  tone: "navy" | "sky" | "green";
  ariaLabel: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <article className="chart-card">
      <div className="chart-title">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={`chart-key tone-${tone}`} aria-hidden="true" />
      </div>
      {rows.length ? (
        <div className={`bar-chart tone-${tone}`} role="img" aria-label={ariaLabel}>
          {rows.map((row) => {
            const width = Math.max(3, Math.min(100, (row.value / max) * 100));
            return (
              <div className="bar-row" key={row.label}>
                <div className="bar-label">
                  <span>{row.label}</span>
                  <strong>{valueFormatter(row.value)}</strong>
                </div>
                <div className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ "--bar-size": `${width}%` } as CSSProperties}
                  />
                </div>
                {row.meta ? <small>{row.meta}</small> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="chart-empty">等待估值计算数据</div>
      )}
    </article>
  );
}

function OverviewCharts({
  companies,
  valuations,
}: {
  companies: DashboardCompany[];
  valuations: DashboardValuation[];
}) {
  const valuationRows = valuations
    .filter((row) => asNumber(row.currentToCenter) !== null)
    .sort(
      (a, b) =>
        (asNumber(b.currentToCenter) ?? -Infinity) -
        (asNumber(a.currentToCenter) ?? -Infinity),
    )
    .slice(0, 8)
    .map((row) => ({
      label: row.name,
      value: asNumber(row.currentToCenter) ?? 0,
      meta: asString(row.temperatureLabel),
    }));

  const groups = [...new Set(companies.map((company) => company.group).filter(Boolean))];
  const revenueRows = groups
    .map((group) => ({
      label: group,
      value:
        median(
          companies
            .filter((company) => company.group === group && company.region === "A股")
            .map((company) => company.revenuePerEmployeeCny10k),
        ) ?? 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const marketCapRows = groups
    .map((group) => ({
      label: group,
      value:
        median(
          companies
            .filter((company) => company.group === group && company.region === "A股")
            .map((company) => company.marketCapPerEmployeeCny10k),
        ) ?? 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <section className="dashboard-charts" aria-label="顶部图表看板">
      <HorizontalChart
        title="估值位置"
        subtitle="当前市值 ÷ 模型中枢，最高 8 家"
        rows={valuationRows}
        valueFormatter={(value) => `${value.toFixed(2)}x`}
        tone="navy"
        ariaLabel={`估值位置最高公司：${valuationRows
          .map((row) => `${row.label}${row.value.toFixed(2)}倍`)
          .join("，")}`}
      />
      <HorizontalChart
        title="各组人均营收中位数"
        subtitle="A股可比组，万元人民币/人"
        rows={revenueRows}
        valueFormatter={(value) => formatNumber(value, 1)}
        tone="sky"
        ariaLabel={`各组人均营收中位数：${revenueRows
          .map((row) => `${row.label}${formatNumber(row.value, 1)}万元每人`)
          .join("，")}`}
      />
      <HorizontalChart
        title="各组人均市值中位数"
        subtitle="A股可比组，万元人民币/人"
        rows={marketCapRows}
        valueFormatter={(value) => formatNumber(value, 1)}
        tone="green"
        ariaLabel={`各组人均市值中位数：${marketCapRows
          .map((row) => `${row.label}${formatNumber(row.value, 1)}万元每人`)
          .join("，")}`}
      />
    </section>
  );
}

function ValuationTable({
  rows,
  compact = false,
  sortKey,
  sortDirection,
  onSort,
}: {
  rows: DashboardValuation[];
  compact?: boolean;
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="暂未取得估值结果"
        description="核心经营数据仍可查看；估值方法完成计算后会自动显示在这里。"
      />
    );
  }
  const visibleRows = compact ? rows.slice(0, 10) : rows;
  return (
    <div className="table-scroll">
      <table className="data-table valuation-table">
        <caption className="sr-only">A股重点观察公司估值明细</caption>
        <thead>
          <tr>
            <th scope="col">代码 / 公司</th>
            <th scope="col">可比组</th>
            <th scope="col">
              <SortButton
                label="当前市值"
                column="marketCap"
                active={sortKey === "marketCap"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">模型区间</th>
            <th scope="col">
              <SortButton
                label="当前 / 中枢"
                column="temperature"
                active={sortKey === "temperature"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">温度</th>
            <th scope="col">
              <SortButton
                label="置信度"
                column="confidence"
                active={sortKey === "confidence"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">结论</th>
            {!compact ? <th scope="col">计算依据</th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id || row.ticker}>
              <th scope="row">
                <span className="ticker">{row.ticker}</span>
                <strong>{row.name}</strong>
              </th>
              <td>{row.group}</td>
              <td className="number-cell">
                {formatNumber(row.currentMarketCapCny100m, 1)}
                <small>亿元</small>
              </td>
              <td className="number-cell range-cell">
                <strong>{formatNumber(row.modelCenter, 1)}</strong>
                <small>
                  {formatNumber(row.modelLow, 1)}–{formatNumber(row.modelHigh, 1)} 亿元
                </small>
              </td>
              <td className="number-cell emphasis">
                {asNumber(row.currentToCenter) === null
                  ? "—"
                  : `${formatNumber(row.currentToCenter, 2)}x`}
              </td>
              <td>
                <span
                  className={`temperature-pill ${temperatureClass(
                    row.temperatureLabel,
                    row.temperatureScore,
                  )}`}
                >
                  {formatScore(row.temperatureScore)}
                  <small>{asString(row.temperatureLabel) || "待判定"}</small>
                </span>
              </td>
              <td>
                <div
                  className="score-meter"
                  aria-label={`置信度 ${formatScore(row.confidenceScore)} 分`}
                >
                  <span
                    style={
                      {
                        "--score": `${Math.max(
                          0,
                          Math.min(100, asNumber(row.confidenceScore) ?? 0),
                        )}%`,
                      } as CSSProperties
                    }
                  />
                  <strong>{formatScore(row.confidenceScore)}</strong>
                </div>
              </td>
              <td>
                <span className="conclusion-tag">{row.conclusion || "继续跟踪"}</span>
              </td>
              {!compact ? (
                <td className="details-cell">
                  <details>
                    <summary>展开</summary>
                    <div className="details-popover">
                      <p>
                        有效方法 <strong>{formatInteger(row.validMethods)}</strong>；A股同组{" "}
                        <strong>{formatInteger(row.domesticPeerCount)}</strong> 家；全球同组{" "}
                        <strong>{formatInteger(row.globalPeerCount)}</strong> 家。
                      </p>
                      <BandList
                        title="估值锚（低 / 中 / 高）"
                        values={row.anchors}
                        unit="x"
                      />
                      <BandList
                        title="隐含市值（低 / 中 / 高）"
                        values={row.impliedValues}
                        unit="亿元"
                      />
                    </div>
                  </details>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BAND_LABELS: Record<string, string> = {
  ps: "P/S",
  priceToGrossProfit: "市值/毛利",
  pe: "P/E",
  pFcf: "P/FCF",
  marketCapPerEmployee: "人均市值",
};

function BandList({
  title,
  values,
  unit,
}: {
  title: string;
  values: UnknownRecord | null | undefined;
  unit: string;
}) {
  const entries = Object.entries(values ?? {}).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const band = value as UnknownRecord;
    const low = asNumber(band.low);
    const center = asNumber(band.center);
    const high = asNumber(band.high);
    if (low === null && center === null && high === null) return [];
    return [{ key, low, center, high }];
  });
  if (!entries.length) return null;
  return (
    <div className="key-value-group">
      <h4>{title}</h4>
      <dl>
        {entries.map(({ key, low, center, high }) => (
          <div key={key}>
            <dt>{BAND_LABELS[key] ?? key}</dt>
            <dd>
              {formatNumber(low, 2)} / {formatNumber(center, 2)} /{" "}
              {formatNumber(high, 2)} {unit}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CoreTable({
  companies,
  sortKey,
  sortDirection,
  onSort,
}: {
  companies: DashboardCompany[];
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  if (!companies.length) {
    return <EmptyState title="没有匹配公司" description="请调整搜索词或筛选条件。" />;
  }
  return (
    <div className="table-scroll">
      <table className="data-table core-table">
        <caption className="sr-only">当前观察池公司的行情、经营与估值指标</caption>
        <thead>
          <tr>
            <th scope="col">
              <SortButton
                label="代码 / 公司"
                column="name"
                active={sortKey === "name"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">市场 / 分组</th>
            <th scope="col">股价 / 涨跌</th>
            <th scope="col">
              <SortButton
                label="市值"
                column="marketCap"
                active={sortKey === "marketCap"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">
              <SortButton
                label="营收"
                column="revenue"
                active={sortKey === "revenue"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">毛利 / 净利（亿元人民币）</th>
            <th scope="col">
              <SortButton
                label="员工（人）"
                column="employees"
                active={sortKey === "employees"}
                direction={sortDirection}
                onSort={onSort}
              />
            </th>
            <th scope="col">人均营收 / 市值（万元人民币/人）</th>
            <th scope="col">EV/Sales / PE</th>
            <th scope="col">核心 / 估值状态</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const change = asNumber(company.change_pct);
            return (
              <tr key={company.id || company.ticker}>
                <th scope="row">
                  <span className="ticker">{company.ticker}</span>
                  <strong>{company.name}</strong>
                  {company.trackingOrigin === "custom" ? (
                    <small className="custom-company-badge">
                      用户添加 · 仅行情
                    </small>
                  ) : (
                    <small>{company.report_period || "报告期未标注"}</small>
                  )}
                  {company.customNote ? (
                    <small className="custom-company-note">
                      {company.customNote}
                    </small>
                  ) : null}
                </th>
                <td>
                  <span className="market-tag">{company.region}</span>
                  <small>{company.group}</small>
                </td>
                <td className="number-cell">
                  <strong>
                    {formatNumber(company.price_local, 2)} {company.currency || ""}
                  </strong>
                  <span className={change !== null && change < 0 ? "change-down" : "change-up"}>
                    {formatPercent(change, 2)}
                  </span>
                </td>
                <td className="number-cell">
                  {formatNumber(company.currentMarketCapCny100m, 1)}
                  <small>亿元人民币</small>
                </td>
                <td className="number-cell">
                  {formatNumber(company.revenueCny100m, 1)}
                  <small>亿元人民币</small>
                </td>
                <td className="number-cell paired-value">
                  <span>{formatNumber(company.grossProfitCny100m, 1)}</span>
                  <span>{formatNumber(company.netProfitCny100m, 1)}</span>
                </td>
                <td className="number-cell">{formatInteger(company.employees)}</td>
                <td className="number-cell paired-value">
                  <span>{formatNumber(company.revenuePerEmployeeCny10k, 1)}</span>
                  <span>{formatNumber(company.marketCapPerEmployeeCny10k, 1)}</span>
                </td>
                <td className="number-cell paired-value">
                  <span>{formatNumber(company.evSales, 2)}x</span>
                  <span>{formatNumber(company.pe, 2)}x</span>
                </td>
                <td>
                  <span
                    className={`status-chip ${
                      asString(company.coreStatus).toUpperCase() === "OK"
                        ? "is-success"
                        : "is-warning"
                    }`}
                  >
                    核心 {company.coreStatus || "待核验"}
                  </span>
                  <span
                    className={`status-chip ${
                      asString(company.valuationInputStatus).toUpperCase() === "OK"
                        ? "is-success"
                        : "is-warning"
                    }`}
                  >
                    估值 {company.valuationInputStatus || "待核验"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PeerTable({ companies }: { companies: DashboardCompany[] }) {
  return <PeerBreakdown companies={companies} />;
}

function EventsTable({ rows, query }: { rows: UnknownRecord[]; query: string }) {
  const filtered = rows.filter((row) => textIncludes(row, query));
  if (!filtered.length) {
    return <EmptyState title="没有匹配事件" description="事件库会在后续更新中持续累积。" />;
  }
  return (
    <div className="table-scroll">
      <table className="data-table events-table">
        <caption className="sr-only">公司重大事件与后续验证事项</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">公司 / 代码</th>
            <th scope="col">事件类别</th>
            <th scope="col">事实摘要</th>
            <th scope="col">方向 / 重要性</th>
            <th scope="col">下一步验证</th>
            <th scope="col">来源</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, index) => {
            const source = safeLink(firstValue(row, ["来源链接", "sourceUrl", "url"]));
            return (
              <tr key={`${asString(firstValue(row, ["日期", "date"]))}-${index}`}>
                <td>{asString(firstValue(row, ["日期", "date"])) || "—"}</td>
                <th scope="row">
                  <strong>{asString(firstValue(row, ["公司", "company", "name"])) || "—"}</strong>
                  <small>{asString(firstValue(row, ["代码", "ticker", "id"]))}</small>
                </th>
                <td>{asString(firstValue(row, ["事件类别", "category"])) || "—"}</td>
                <td className="long-text">
                  {asString(firstValue(row, ["事实摘要", "summary"])) || "—"}
                </td>
                <td>
                  <span className="event-direction">
                    {asString(firstValue(row, ["方向", "direction"])) || "中性"}
                  </span>
                  <small>{asString(firstValue(row, ["重要性", "importance"])) || "—"}</small>
                </td>
                <td className="long-text">
                  {asString(firstValue(row, ["下一步验证", "nextStep"])) || "—"}
                </td>
                <td>
                  {source ? (
                    <a href={source} target="_blank" rel="noreferrer">
                      打开原文 ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ rows, query }: { rows: UnknownRecord[]; query: string }) {
  const filtered = rows.filter((row) => textIncludes(row, query));
  if (!filtered.length) {
    return (
      <EmptyState
        title="没有匹配快照"
        description="每次成功更新都会保留可复核的历史记录。"
      />
    );
  }
  return (
    <div className="table-scroll">
      <table className="data-table history-table">
        <caption className="sr-only">A股公司历次估值与经营快照</caption>
        <thead>
          <tr>
            <th scope="col">快照日期</th>
            <th scope="col">代码 / 公司</th>
            <th scope="col">可比组</th>
            <th scope="col">股价（元人民币）</th>
            <th scope="col">市值（亿元人民币）</th>
            <th scope="col">EV/Sales</th>
            <th scope="col">EV/毛利</th>
            <th scope="col">PE</th>
            <th scope="col">P/FCF</th>
            <th scope="col">人均市值（万元人民币/人）</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, index) => (
            <tr key={`${asString(firstValue(row, ["快照日期", "snapshotDate"]))}-${index}`}>
              <td>{asString(firstValue(row, ["快照日期", "snapshotDate"])) || "—"}</td>
              <th scope="row">
                <span className="ticker">
                  {asString(firstValue(row, ["代码", "ticker", "id"]))}
                </span>
                <strong>{asString(firstValue(row, ["公司", "company", "name"]))}</strong>
              </th>
              <td>{asString(firstValue(row, ["分组", "group"])) || "—"}</td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["股价本币", "priceLocal"]), 2)}
              </td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["市值亿元人民币", "marketCapCny100m"]), 1)}
                <small>亿元</small>
              </td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["EV_Sales", "evSales"]), 2)}x
              </td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["EV_GrossProfit", "evGrossProfit"]), 2)}x
              </td>
              <td className="number-cell">{formatNumber(firstValue(row, ["PE", "pe"]), 2)}x</td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["P_FCF", "pFcf"]), 2)}x
              </td>
              <td className="number-cell">
                {formatNumber(firstValue(row, ["人均市值万元", "marketCapPerEmployee"]), 1)}
                <small>万元/人</small>
              </td>
              <td>
                <span className="status-chip is-success">
                  {asString(firstValue(row, ["数据状态", "status"])) || "OK"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesTable({ companies }: { companies: DashboardCompany[] }) {
  if (!companies.length) {
    return <EmptyState title="没有匹配来源" description="请调整搜索词或筛选条件。" />;
  }
  return (
    <div className="table-scroll">
      <table className="data-table sources-table">
        <caption className="sr-only">公司行情、财报与结构化数据来源审计</caption>
        <thead>
          <tr>
            <th scope="col">代码 / 公司</th>
            <th scope="col">行情日</th>
            <th scope="col">财务报告期</th>
            <th scope="col">行情来源</th>
            <th scope="col">官方报告</th>
            <th scope="col">结构化来源</th>
            <th scope="col">质量状态</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const quoteLink = safeLink(company.quote_source);
            const reportLink = safeLink(company.official_report_source);
            const structuredLink = safeLink(company.structured_source);
            return (
              <tr key={company.id || company.ticker}>
                <th scope="row">
                  <span className="ticker">{company.ticker}</span>
                  <strong>{company.name}</strong>
                  {company.trackingOrigin === "custom" ? (
                    <small className="custom-company-badge">
                      用户添加 · 不参与估值
                    </small>
                  ) : null}
                </th>
                <td>{company.quote_date || "—"}</td>
                <td>
                  <strong>{company.report_period || "—"}</strong>
                  <small>{company.report_date || ""}</small>
                </td>
                <td>{quoteLink ? <SourceLink href={quoteLink} label="行情" /> : "—"}</td>
                <td>{reportLink ? <SourceLink href={reportLink} label="财报" /> : "—"}</td>
                <td>
                  {structuredLink ? <SourceLink href={structuredLink} label="结构化数据" /> : "—"}
                </td>
                <td>
                  <span
                    className={`status-chip ${
                      asString(company.coreStatus).toUpperCase() === "OK"
                        ? "is-success"
                        : "is-warning"
                    }`}
                  >
                    {company.coreStatus || "待核验"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}

function MethodologyView({ methodology }: { methodology: UnknownRecord | undefined }) {
  const discount = asNumber(methodology?.global_multiple_discount);
  const aggregation =
    methodology?.valuation_aggregation &&
    typeof methodology.valuation_aggregation === "object" &&
    !Array.isArray(methodology.valuation_aggregation)
      ? (methodology.valuation_aggregation as UnknownRecord)
      : {};
  const confidence =
    methodology?.confidence_weights &&
    typeof methodology.confidence_weights === "object" &&
    !Array.isArray(methodology.confidence_weights)
      ? (methodology.confidence_weights as UnknownRecord)
      : {};
  const principles = Array.isArray(methodology?.principles)
    ? methodology.principles.map(asString).filter(Boolean)
    : [];
  return (
    <div className="methodology-view">
      <div className="method-grid">
        <article>
          <span>全球倍数折算</span>
          <strong>{discount === null ? "—" : `${(discount * 100).toFixed(0)}%`}</strong>
          <p>美股同组倍数先折算，再与A股同组形成双锚。</p>
        </article>
        <article>
          <span>区间聚合</span>
          <strong>有效方法中位数</strong>
          <p>{asString(aggregation.note) || "只汇总可用方法，不用零值填补缺失值。"}</p>
        </article>
        <article>
          <span>置信度</span>
          <strong>五项证据评分</strong>
          <p>来源、时效、可比组、方法完整性与方法收敛度共同决定。</p>
        </article>
      </div>

      <section className="method-section">
        <h3>置信度权重</h3>
        <div className="weight-list">
          {[
            ["来源质量", confidence.source_quality],
            ["数据时效", confidence.freshness],
            ["可比组质量", confidence.peer_quality],
            ["方法完整性", confidence.method_completeness],
            ["方法收敛度", confidence.method_convergence],
          ].map(([label, value]) => {
            const numeric = asNumber(value);
            return (
              <div key={asString(label)}>
                <span>{asString(label)}</span>
                <div className="weight-track">
                  <i
                    style={
                      {
                        "--weight": `${Math.max(0, Math.min(100, (numeric ?? 0) * 100))}%`,
                      } as CSSProperties
                    }
                  />
                </div>
                <strong>{numeric === null ? "—" : `${(numeric * 100).toFixed(0)}%`}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="method-section">
        <h3>核心原则</h3>
        <ol className="principle-list">
          {(principles.length
            ? principles
            : [
                "合理区间是可比估值观察区间，不等同于股价底部，也不是买卖建议。",
                "净利润或自由现金流不大于零时，对应倍数不适用。",
                "行情、财务报告和员工数存在时间错位，所有判断均需保留时点。",
              ]
          ).map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function FormulaRail({
  asOf,
  quoteDates,
  fxDate,
}: {
  asOf: string;
  quoteDates: string;
  fxDate: string;
}) {
  return (
    <aside className="formula-rail" aria-labelledby="formula-title">
      <div className="formula-rail-heading">
        <p className="eyebrow">审计口径</p>
        <h2 id="formula-title">单位与公式</h2>
      </div>
      <details open>
        <summary>估值口径</summary>
        <dl>
          <div>
            <dt>当前 / 模型中枢｜x</dt>
            <dd>当前市值 ÷ 模型中枢。1.0x 等于中枢，低于 1.0x 不是买入信号。</dd>
          </div>
          <div>
            <dt>模型市值｜亿元人民币</dt>
            <dd>同组经营指标 × 可比倍数，经A股与全球折算锚交叉形成。</dd>
          </div>
          <div>
            <dt>温度｜0–100分</dt>
            <dd>相对模型中枢的离散评分；越高只表示相对模型越热。</dd>
          </div>
          <div>
            <dt>置信度｜0–100分</dt>
            <dd>衡量数据与方法证据强度，不代表预测准确率或收益概率。</dd>
          </div>
        </dl>
      </details>
      <details open>
        <summary>经营效率</summary>
        <dl>
          <div>
            <dt>人均营收｜万元人民币/人</dt>
            <dd>年度营收 × 10,000 ÷ 最近年报员工数。</dd>
          </div>
          <div>
            <dt>人均市值｜万元人民币/人</dt>
            <dd>当前总市值 × 10,000 ÷ 最近年报员工数。</dd>
          </div>
          <div>
            <dt>自由现金流｜亿元人民币</dt>
            <dd>经营现金流 − 资本开支；小于等于零时 P/FCF 停用。</dd>
          </div>
          <div>
            <dt>简化EV｜亿元人民币</dt>
            <dd>市值 + 期末有息债务 − 期末现金。债务或现金缺失时留空。</dd>
          </div>
        </dl>
      </details>
      <details>
        <summary>时点与限制</summary>
        <dl>
          <div>
            <dt>估值基准日</dt>
            <dd>{asOf || "—"}</dd>
          </div>
          <div>
            <dt>行情日</dt>
            <dd>{quoteDates || "—"}</dd>
          </div>
          <div>
            <dt>汇率日</dt>
            <dd>{fxDate || "—"}</dd>
          </div>
          <div>
            <dt>时间错位提示</dt>
            <dd>市值使用最新行情，经营数据与员工数使用最近完整年报，时点并不完全同步。</dd>
          </div>
        </dl>
      </details>
      <p className="disclaimer">本看板用于研究跟踪与证据复核，不构成任何投资建议。</p>
    </aside>
  );
}

function getFxDate(fx: UnknownRecord | undefined): string {
  return asString(firstValue(fx ?? {}, ["date", "fxDate", "asOf"]));
}

function customCompanyView(
  company: CustomWatchCompany,
  quote: CustomQuoteSnapshot | undefined,
  fx: UnknownRecord | undefined,
): DashboardCompany {
  const rates =
    fx?.rates_to_cny &&
    typeof fx.rates_to_cny === "object" &&
    !Array.isArray(fx.rates_to_cny)
      ? (fx.rates_to_cny as UnknownRecord)
      : {};
  const fxToCny =
    company.currency === "CNY"
      ? 1
      : asNumber(rates[company.currency]);
  const marketCapCny =
    quote?.marketCapLocal100m !== null &&
    quote?.marketCapLocal100m !== undefined &&
    fxToCny !== null
      ? quote.marketCapLocal100m * fxToCny
      : null;
  return {
    id: company.id,
    name: company.name,
    ticker: company.ticker,
    group: "自定义观察",
    region: company.region,
    market: company.market,
    role: "用户自定义（仅行情）",
    currency: company.currency,
    price_local: quote?.priceLocal ?? null,
    change_pct: quote?.changePct ?? null,
    quote_date: quote?.quoteDate ?? null,
    report_period: null,
    report_date: null,
    employees: null,
    currentMarketCapCny100m: marketCapCny,
    revenueCny100m: null,
    grossProfitCny100m: null,
    netProfitCny100m: null,
    fcfCny100m: null,
    enterpriseValueCny100m: null,
    revenuePerEmployeeCny10k: null,
    grossProfitPerEmployeeCny10k: null,
    netProfitPerEmployeeCny10k: null,
    marketCapPerEmployeeCny10k: null,
    ps: null,
    priceToGrossProfit: null,
    evSales: null,
    evGrossProfit: null,
    pe: null,
    pFcf: null,
    fcfYield: null,
    coreStatus: quote?.status === "fresh" ? "仅行情" : "行情待核验",
    valuationInputStatus: "不参与估值",
    quote_source: company.quoteCode
      ? `${TENCENT_QUOTE_SOURCE}q=${company.quoteCode}`
      : null,
    official_report_source: null,
    structured_source: null,
    trackingOrigin: "custom",
    customNote: company.note || null,
  };
}

function scopeRowsToActiveCompanies(
  rows: UnknownRecord[],
  defaultCompanies: DashboardCompany[],
  activeIds: Set<string>,
): UnknownRecord[] {
  const keys = new Map<string, string>();
  for (const company of defaultCompanies) {
    for (const key of [company.id, company.ticker, company.name]) {
      if (key) keys.set(key.toLocaleLowerCase("zh-CN"), company.id);
    }
  }
  return rows.filter((row) => {
    const candidates = [
      firstValue(row, ["代码", "ticker", "id"]),
      firstValue(row, ["公司", "company", "name"]),
    ]
      .map(asString)
      .filter(Boolean);
    const matchedId = candidates
      .map((value) => keys.get(value.toLocaleLowerCase("zh-CN")))
      .find(Boolean);
    return !matchedId || activeIds.has(matchedId);
  });
}

export function Dashboard({
  initialData,
  initialDataset,
  pollIntervalSeconds = FALLBACK_POLL_SECONDS,
}: DashboardProps) {
  const normalizedInitial = useMemo(
    () =>
      normalizeInitial(initialData) ??
      (initialDataset ? responseFromDataset(initialDataset) : null),
    [initialData, initialDataset],
  );
  const defaultCompanyIds = useMemo(
    () =>
      initialDataset?.snapshot.companies.map((company) => company.id) ??
      normalizedInitial?.data.companies?.map((company) => company.id) ??
      [],
    [initialDataset, normalizedInitial],
  );
  const [response, setResponse] = useState<DashboardResponse | null>(normalizedInitial);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("全部");
  const [region, setRegion] = useState("全部");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(!normalizedInitial);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(pollIntervalSeconds);
  const [watchPool, setWatchPool] = useState<WatchPoolState>(
    emptyWatchPoolState,
  );
  const [watchPoolOpen, setWatchPoolOpen] = useState(false);
  const [watchPoolLoaded, setWatchPoolLoaded] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [customQuotesRefreshing, setCustomQuotesRefreshing] = useState(false);
  const [excelExportState, setExcelExportState] =
    useState<ExcelExportState>("idle");
  const [excelExportMessage, setExcelExportMessage] = useState("");
  const inFlight = useRef(false);
  const datasetRef = useRef<DashboardDataset | null>(initialDataset ?? null);
  const lastManualAttemptRef = useRef(0);
  const watchPoolRef = useRef<WatchPoolState>(watchPool);

  useEffect(() => {
    watchPoolRef.current = watchPool;
  }, [watchPool]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setWatchPool(loadWatchPool(window.localStorage, defaultCompanyIds));
        setStorageWarning("");
      } catch {
        setWatchPool(emptyWatchPoolState());
        setStorageWarning(
          "当前浏览器无法读取已保存的观察池；本次修改仍可导出，但刷新页面后可能丢失。",
        );
      } finally {
        setWatchPoolLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultCompanyIds]);

  useEffect(() => {
    if (!watchPoolLoaded) return;
    const timer = window.setTimeout(() => {
      try {
        saveWatchPool(window.localStorage, watchPool);
        setStorageWarning("");
      } catch {
        setStorageWarning(
          "当前浏览器无法保存观察池；请及时导出文件或同步码。",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [watchPool, watchPoolLoaded]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WATCH_POOL_STORAGE_KEY) return;
      if (!event.newValue) {
        setWatchPool(emptyWatchPoolState());
        return;
      }
      try {
        setWatchPool(
          sanitizeWatchPoolState(
            JSON.parse(event.newValue) as unknown,
            defaultCompanyIds,
          ),
        );
      } catch {
        setStorageWarning("其他标签页传来的观察池数据无效，已忽略。");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [defaultCompanyIds]);

  const refreshCustomQuotes = useCallback(
    async (selected?: CustomWatchCompany[]) => {
      const targets = (
        selected ?? watchPoolRef.current.customCompanies
      ).filter((company) => company.quoteCode);
      if (!targets.length) return { success: 0, total: 0 };
      setCustomQuotesRefreshing(true);
      try {
        const result = await fetchCustomQuoteUpdates(
          targets.map((company) => ({
            id: company.id,
            name: company.name,
            quoteCode: company.quoteCode ?? "",
          })),
        );
        const updatedAt = new Date().toISOString();
        setWatchPool((current) => {
          const quoteCache = { ...current.quoteCache };
          const activeCustomIds = new Set(
            current.customCompanies.map((company) => company.id),
          );
          for (const company of targets) {
            if (!activeCustomIds.has(company.id)) continue;
            const quote = result.updates.get(company.id);
            if (quote) {
              quoteCache[company.id] = {
                verifiedName: quote.name,
                priceLocal: quote.priceLocal,
                changePct: quote.changePct,
                quoteDate: quote.quoteDate,
                marketCapLocal100m: quote.marketCapLocal100m,
                status: "fresh",
                updatedAt,
              };
            } else {
              const previous = quoteCache[company.id];
              quoteCache[company.id] = {
                verifiedName: previous?.verifiedName ?? null,
                priceLocal: previous?.priceLocal ?? null,
                changePct: previous?.changePct ?? null,
                quoteDate: previous?.quoteDate ?? null,
                marketCapLocal100m:
                  previous?.marketCapLocal100m ?? null,
                status: previous ? "stale" : "unavailable",
                updatedAt,
              };
            }
          }
          return {
            ...current,
            quoteCache,
            updatedAt,
          };
        });
        return { success: result.updates.size, total: targets.length };
      } finally {
        setCustomQuotesRefreshing(false);
      }
    },
    [],
  );

  const loadDashboard = useCallback(
    async (manual = false) => {
      if (inFlight.current) return;
      if (
        manual &&
        Date.now() - lastManualAttemptRef.current <
          MANUAL_REFRESH_COOLDOWN_MS
      ) {
        setResponse((current) =>
          current
            ? {
                ...current,
                status: {
                  ...current.status,
                  message: "为保护公共数据源，手动更新每 60 秒最多执行一次。",
                },
              }
            : current,
        );
        return;
      }
      inFlight.current = true;
      if (manual) {
        lastManualAttemptRef.current = Date.now();
        setIsRefreshing(true);
      }
      setError("");
      try {
        let currentDataset = datasetRef.current;
        if (!manual) {
          try {
            const storedResponse = await fetch(STATIC_DATA_URL, {
              cache: "no-store",
            });
            if (storedResponse.ok) {
              const storedDataset = (await storedResponse.json()) as unknown;
              if (isDashboardDataset(storedDataset)) {
                currentDataset = storedDataset;
                datasetRef.current = storedDataset;
              }
            }
          } catch {
            // The embedded audited snapshot remains available when GitHub's
            // persisted JSON is temporarily unreachable.
          }
        }
        if (!currentDataset) throw new Error("没有可供刷新的完整数据快照");

        const refreshed = await refreshMarketDataset(currentDataset);
        let customRefresh = { success: 0, total: 0 };
        try {
          customRefresh = await refreshCustomQuotes();
        } catch {
          // Custom quotes are intentionally isolated: a failure must never
          // downgrade the audited 31-company refresh.
        }
        datasetRef.current = refreshed.dataset;
        const nextResponse = responseFromDataset(refreshed.dataset, {
          state: "fresh",
          stale: false,
          refreshAttempted: true,
          refreshed: true,
          source: "live",
          lastSuccessAt: refreshed.dataset.snapshot.generated_at,
          lastAttemptAt: new Date().toISOString(),
          message: `${
            refreshed.fxRefreshed
              ? `实时刷新成功：${refreshed.successCount}/${refreshed.sampleCount} 家基础行情完整`
              : `基础行情更新成功：${refreshed.successCount}/${refreshed.sampleCount} 家完整；汇率沿用 ${refreshed.dataset.snapshot.fx.date} 快照`
          }${
            customRefresh.total
              ? `；自定义行情 ${customRefresh.success}/${customRefresh.total}`
              : ""
          }`,
        });
        setResponse(nextResponse);
        setCountdown(
          Math.max(
            30,
            Math.round(
              asNumber(nextResponse.refresh?.staleAfterSeconds) ?? pollIntervalSeconds,
            ),
          ),
        );
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : "更新未完成，正在保留最近成功数据。";
        setError(message);
        setResponse((current) =>
          current
            ? {
                ...current,
                status: {
                  ...current.status,
                  state: "stale-retained",
                  stale: true,
                  refreshAttempted: true,
                  refreshed: false,
                  message: `刷新失败，已保留最近完整快照：${message}`,
                },
              }
            : current,
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setCountdown(pollIntervalSeconds);
        inFlight.current = false;
      }
    },
    [pollIntervalSeconds, refreshCustomQuotes],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (countdown !== 0 || inFlight.current) return;
    void loadDashboard(false);
    setCountdown(pollIntervalSeconds);
  }, [countdown, loadDashboard, pollIntervalSeconds]);

  const closeWatchPool = useCallback(() => {
    setWatchPoolOpen(false);
  }, []);

  const data = response?.data;
  const baseCompanies = useMemo(
    () => data?.companies ?? [],
    [data?.companies],
  );
  const hiddenDefaultIds = useMemo(
    () => new Set(watchPool.hiddenDefaultIds),
    [watchPool.hiddenDefaultIds],
  );
  const companies = useMemo(
    () =>
      baseCompanies.filter(
        (company) => !hiddenDefaultIds.has(company.id),
      ),
    [baseCompanies, hiddenDefaultIds],
  );
  const activeDefaultIds = useMemo(
    () => new Set(companies.map((company) => company.id)),
    [companies],
  );
  const customCompanies = useMemo(
    () =>
      watchPool.customCompanies.map((company) =>
        customCompanyView(
          company,
          watchPool.quoteCache[company.id],
          data?.fx,
        ),
      ),
    [data?.fx, watchPool.customCompanies, watchPool.quoteCache],
  );
  const defaultWatchCompanies = useMemo<DefaultWatchCompany[]>(
    () =>
      baseCompanies.map((company) => ({
        id: company.id,
        name: company.name,
        ticker: company.ticker,
        group: company.group,
        region: company.region,
      })),
    [baseCompanies],
  );
  const valuations = useMemo(() => data?.valuations ?? [], [data?.valuations]);
  const activeValuations = useMemo(
    () =>
      valuations.filter((valuation) => activeDefaultIds.has(valuation.id)),
    [activeDefaultIds, valuations],
  );
  const valuationMap = useMemo(
    () =>
      new Map(
        activeValuations.map((valuation) => [valuation.id, valuation]),
      ),
    [activeValuations],
  );
  const groups = useMemo(
    () => [...new Set(companies.map((company) => company.group).filter(Boolean))].sort(),
    [companies],
  );
  const regions = useMemo(
    () =>
      [
        ...new Set(
          [...companies, ...customCompanies]
            .map((company) => company.region)
            .filter(Boolean),
        ),
      ].sort(),
    [companies, customCompanies],
  );

  const visibleDefaultCompanies = useMemo(() => {
    const filtered = companies.filter(
      (company) =>
        (group === "全部" || company.group === group) &&
        (region === "全部" || company.region === region) &&
        textIncludes(company, query),
    );
    return [...filtered].sort((left, right) => {
      const leftValue = toSortValue(left, valuationMap.get(left.id), sortKey);
      const rightValue = toSortValue(right, valuationMap.get(right.id), sortKey);
      const direction = sortDirection === "desc" ? -1 : 1;
      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue, "zh-CN") * direction;
      }
      return ((leftValue as number) - (rightValue as number)) * direction;
    });
  }, [companies, group, query, region, sortDirection, sortKey, valuationMap]);

  const visibleCustomCompanies = useMemo(() => {
    if (group !== "全部") return [];
    const filtered = customCompanies.filter(
      (company) =>
        (region === "全部" || company.region === region) &&
        textIncludes(company, query),
    );
    return [...filtered].sort((left, right) => {
      const leftValue = toSortValue(left, undefined, sortKey);
      const rightValue = toSortValue(right, undefined, sortKey);
      const direction = sortDirection === "desc" ? -1 : 1;
      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue, "zh-CN") * direction;
      }
      return ((leftValue as number) - (rightValue as number)) * direction;
    });
  }, [
    customCompanies,
    group,
    query,
    region,
    sortDirection,
    sortKey,
  ]);

  const visibleCompanies = useMemo(() => {
    if (activeTab !== "core" && activeTab !== "sources") {
      return visibleDefaultCompanies;
    }
    return [...visibleDefaultCompanies, ...visibleCustomCompanies].sort(
      (left, right) => {
        const leftValue = toSortValue(
          left,
          valuationMap.get(left.id),
          sortKey,
        );
        const rightValue = toSortValue(
          right,
          valuationMap.get(right.id),
          sortKey,
        );
        const direction = sortDirection === "desc" ? -1 : 1;
        if (
          typeof leftValue === "string" &&
          typeof rightValue === "string"
        ) {
          return (
            leftValue.localeCompare(rightValue, "zh-CN") * direction
          );
        }
        return ((leftValue as number) - (rightValue as number)) * direction;
      },
    );
  }, [
    activeTab,
    sortDirection,
    sortKey,
    valuationMap,
    visibleCustomCompanies,
    visibleDefaultCompanies,
  ]);

  const visibleValuations = useMemo(() => {
    const allowed = new Set(
      visibleDefaultCompanies.map((company) => company.id),
    );
    return activeValuations
      .filter((valuation) => allowed.has(valuation.id))
      .sort((left, right) => {
        const leftCompany =
          companies.find((company) => company.id === left.id) ??
          ({
            id: left.id,
            name: left.name,
            ticker: left.ticker,
            group: left.group,
            region: "A股",
            currentMarketCapCny100m: left.currentMarketCapCny100m,
          } as DashboardCompany);
        const rightCompany =
          companies.find((company) => company.id === right.id) ??
          ({
            id: right.id,
            name: right.name,
            ticker: right.ticker,
            group: right.group,
            region: "A股",
            currentMarketCapCny100m: right.currentMarketCapCny100m,
          } as DashboardCompany);
        const leftValue = toSortValue(leftCompany, left, sortKey);
        const rightValue = toSortValue(rightCompany, right, sortKey);
        const direction = sortDirection === "desc" ? -1 : 1;
        if (typeof leftValue === "string" && typeof rightValue === "string") {
          return leftValue.localeCompare(rightValue, "zh-CN") * direction;
        }
        return ((leftValue as number) - (rightValue as number)) * direction;
      });
  }, [
    activeValuations,
    companies,
    sortDirection,
    sortKey,
    visibleDefaultCompanies,
  ]);

  const scopedEvents = useMemo(
    () =>
      scopeRowsToActiveCompanies(
        data?.events ?? [],
        baseCompanies,
        activeDefaultIds,
      ),
    [activeDefaultIds, baseCompanies, data?.events],
  );
  const scopedHistory = useMemo(
    () =>
      scopeRowsToActiveCompanies(
        data?.history ?? [],
        baseCompanies,
        activeDefaultIds,
      ),
    [activeDefaultIds, baseCompanies, data?.history],
  );

  const handleSort = (next: SortKey) => {
    if (next === sortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(next);
      setSortDirection(next === "name" ? "asc" : "desc");
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`tab-${nextTab.id}`)?.focus();
    });
  };

  const aShareCount =
    companies.filter((company) => company.region === "A股").length +
    customCompanies.filter((company) => company.region === "A股").length;
  const observedCount = companies.length + customCompanies.length;
  const successCount = companies.filter(
    (company) => asString(company.coreStatus).toUpperCase() === "OK",
  ).length;
  const sampleCount = companies.length;
  const hotCount = activeValuations.filter(
    (valuation) => (asNumber(valuation.temperatureScore) ?? 0) >= 85,
  ).length;
  const coldCount = activeValuations.filter(
    (valuation) => (asNumber(valuation.temperatureScore) ?? 100) <= 30,
  ).length;
  const interval = Math.max(
    30,
    Math.round(asNumber(response?.refresh?.staleAfterSeconds) ?? pollIntervalSeconds),
  );
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const quoteDates =
    data?.quoteDateMin && data?.quoteDateMax
      ? data.quoteDateMin === data.quoteDateMax
        ? data.quoteDateMin
        : `${data.quoteDateMin} 至 ${data.quoteDateMax}`
      : "";
  const status = response?.status;
  const resultCount =
    activeTab === "overview" || activeTab === "valuation"
      ? visibleValuations.length
      : activeTab === "events"
        ? scopedEvents.filter((row) => textIncludes(row, query)).length
        : activeTab === "history"
          ? scopedHistory.filter((row) => textIncludes(row, query)).length
          : visibleCompanies.length;

  const handleExcelExport = async () => {
    if (excelExportState === "exporting") return;
    if (!data) {
      setExcelExportState("error");
      setExcelExportMessage("当前没有可导出的完整数据快照。");
      return;
    }

    setExcelExportState("exporting");
    setExcelExportMessage("正在生成 9 个工作表，请稍候…");
    try {
      const shareableCompanies: UnknownRecord[] = [
        ...companies,
        ...customCompanies,
      ].map((company) => {
        const shareable: UnknownRecord = { ...company };
        delete shareable.customNote;
        return shareable;
      });
      const exportInput: DashboardExcelExportInput = {
        asOf: data.asOf || "",
        generatedAt: data.generatedAt || "",
        quoteDateMin: data.quoteDateMin || "",
        quoteDateMax: data.quoteDateMax || "",
        fx: data.fx,
        summary: data.summary,
        companies: shareableCompanies,
        valuations: activeValuations as UnknownRecord[],
        events: scopedEvents,
        history: scopedHistory,
        methodology: data.methodology,
        status,
        filters: { query, group, region },
      };
      const { downloadDashboardExcel } = await import("@/lib/excel-export");
      const filename = await downloadDashboardExcel(exportInput);
      setExcelExportState("success");
      setExcelExportMessage(
        `已下载 ${filename}；共 ${shareableCompanies.length} 家公司，私人备注未导出。`,
      );
    } catch (exportError) {
      setExcelExportState("error");
      setExcelExportMessage(
        `导出失败：${
          exportError instanceof Error
            ? exportError.message
            : "浏览器未能生成工作簿"
        }`,
      );
    }
  };

  if (isLoading && !response) {
    return (
      <div className="dashboard-shell dashboard-loading">
        <div className="loading-brand">
          <span className="brand-mark" aria-hidden="true">
            科
          </span>
          <div>
            <strong>科技股长期估值与经营效率看板</strong>
            <p>正在连接数据并生成研究视图…</p>
          </div>
        </div>
        <div className="loading-grid" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <span key={item} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#dashboard-content">
        跳至主要内容
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            科
          </span>
          <div>
            <p>长期跟踪系统 · V1.1</p>
            <h1>科技股长期估值与经营效率看板</h1>
          </div>
        </div>
        <div className="update-controls">
          <button
            className="watch-pool-button"
            type="button"
            onClick={() => setWatchPoolOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={watchPoolOpen}
          >
            <span aria-hidden="true">◎</span>
            <span>
              观察池
              <small>
                默认 {companies.length}/{baseCompanies.length} · 自定义{" "}
                {customCompanies.length}
              </small>
            </span>
          </button>
          <button
            className={`excel-export-button is-${excelExportState}`}
            type="button"
            onClick={() => void handleExcelExport()}
            disabled={excelExportState === "exporting" || !data}
            aria-busy={excelExportState === "exporting"}
            aria-describedby="excel-export-feedback"
            aria-label={
              excelExportState === "exporting"
                ? "正在导出当前完整观察池 Excel"
                : "导出当前完整观察池 Excel"
            }
          >
            <span
              className={excelExportState === "exporting" ? "is-spinning" : ""}
              aria-hidden="true"
            >
              {excelExportState === "exporting" ? "◌" : "⇩"}
            </span>
            <span>
              {excelExportState === "exporting" ? "导出中" : "导出 Excel"}
              <small>完整观察池</small>
            </span>
          </button>
          <div className="auto-update">
            <span className="pulse-dot" aria-hidden="true" />
            <span>
              页面打开期间自动检查
              <small>
                {minutes}:{seconds.toString().padStart(2, "0")} 后检查
              </small>
            </span>
          </div>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void loadDashboard(true)}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "正在手动更新数据" : "立即手动更新数据"}
          >
            <span className={isRefreshing ? "is-spinning" : ""} aria-hidden="true">
              ↻
            </span>
            {isRefreshing ? "更新中" : "立即更新"}
          </button>
        </div>
      </header>

      <div
        id="excel-export-feedback"
        className={`excel-export-feedback is-${excelExportState}`}
        role={excelExportState === "error" ? "alert" : "status"}
        aria-live={excelExportState === "error" ? "assertive" : "polite"}
        hidden={excelExportState === "idle"}
      >
        <span aria-hidden="true">
          {excelExportState === "exporting"
            ? "◌"
            : excelExportState === "success"
              ? "✓"
              : "!"}
        </span>
        <span>{excelExportMessage}</span>
      </div>

      <div className={`status-strip ${statusClass(status)}`} role="status" aria-live="polite">
        <div>
          <span className="status-dot" aria-hidden="true" />
          <strong>{statusLabel(status)}</strong>
          <span>
            {error ||
              status?.message ||
              `最近成功更新 ${formatDateTime(status?.lastSuccessAt || data?.generatedAt)}`}
          </span>
        </div>
        <div className="status-meta">
          <span>估值基准日 {data?.asOf || "—"}</span>
          <span>行情日 {quoteDates || "—"}</span>
          <span>汇率日 {getFxDate(data?.fx) || "—"}</span>
          <span>财务 每日自动校验</span>
          <span>自动检查 {Math.round(interval / 60)} 分钟</span>
        </div>
      </div>

      <nav className="tab-navigation" aria-label="看板视图">
        <div role="tablist" aria-label="数据工作表">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span className="tab-full">{tab.label}</span>
              <span className="tab-short">{tab.shortLabel}</span>
            </button>
          ))}
        </div>
      </nav>

      <main id="dashboard-content" className="dashboard-main">
        <section className="overview-masthead" aria-labelledby="overview-title">
          <div>
            <p className="eyebrow">实时研究底稿</p>
            <h2 id="overview-title">把估值位置、经营效率与证据链放在同一张图上</h2>
            <p>
              当前观察 {observedCount} 家公司（默认 {companies.length}/
              {baseCompanies.length}，自定义 {customCompanies.length}），其中 A股{" "}
              {aShareCount} 家。自定义公司仅展示可验证行情，不进入财务、估值和同业统计。
            </p>
          </div>
          <div className="coverage-seal">
            <span>数据覆盖</span>
            <strong>
              {formatInteger(successCount)}/{formatInteger(sampleCount)}
            </strong>
            <small>关键数据完整</small>
          </div>
        </section>

        <section className="metric-grid" aria-label="系统概览指标">
          <MetricCard
            label="覆盖公司"
            value={`${observedCount} 家`}
            detail={`默认 ${companies.length} 家 · 自定义 ${customCompanies.length} 家`}
            tone="blue"
          />
          <MetricCard
            label="重点估值"
            value={`${activeValuations.length} 家`}
            detail="仅默认池内可审计公司"
            tone="sky"
          />
          <MetricCard
            label="估值温度"
            value={`${hotCount} 热 / ${coldCount} 冷`}
            detail="仅表示相对模型位置"
            tone="yellow"
          />
          <MetricCard
            label="可比行业"
            value={`${groups.length} 组`}
            detail="仅默认池参与同业统计"
            tone="green"
          />
        </section>

        <OverviewCharts
          companies={companies}
          valuations={activeValuations}
        />

        <div className="workspace-grid">
          <section
            className="content-panel"
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
          >
            {activeTab !== "methods" ? (
              <FilterBar
                query={query}
                onQuery={setQuery}
                group={group}
                onGroup={setGroup}
                region={region}
                onRegion={setRegion}
                groups={groups}
                regions={regions}
                resultCount={resultCount}
                sortKey={sortKey}
                showCompanyControls={
                  activeTab !== "events" && activeTab !== "history"
                }
                searchPlaceholder={
                  activeTab === "events"
                    ? "搜索事件、公司或代码"
                    : activeTab === "history"
                      ? "搜索历史、公司或代码"
                      : "搜索公司、代码或分组"
                }
                onSortKey={(value) => {
                  setSortKey(value);
                  setSortDirection(value === "name" ? "asc" : "desc");
                }}
              />
            ) : null}

            {activeTab === "overview" ? (
              <>
                <SectionHeading
                  eyebrow="A股重点观察"
                  title="合理区间与估值温度"
                  description="模型中枢由行业倍数与人均经营效率交叉验证形成。"
                  action={
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setActiveTab("valuation")}
                    >
                      查看全部明细 →
                    </button>
                  }
                />
                <ValuationTable
                  rows={visibleValuations}
                  compact
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <div className="overview-footnotes">
                  <article>
                    <span className="note-icon" aria-hidden="true">
                      i
                    </span>
                    <div>
                      <h3>如何阅读</h3>
                      <p>
                        先看当前/中枢和行业分组，再看置信度与结论。单一倍数不直接形成判断。
                      </p>
                    </div>
                  </article>
                  <article>
                    <span className="note-icon" aria-hidden="true">
                      ✓
                    </span>
                    <div>
                      <h3>可复核</h3>
                      <p>行情、官方报告和结构化来源均保留原始链接，可在“来源审计”中逐项打开。</p>
                    </div>
                  </article>
                </div>
              </>
            ) : null}

            {activeTab === "valuation" ? (
              <>
                <SectionHeading
                  eyebrow="合理估值区间"
                  title="A股重点观察公司估值明细"
                  description="单位为亿元人民币；点击“展开”可查看估值锚和各方法隐含市值。"
                />
                <ValuationTable
                  rows={visibleValuations}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
              </>
            ) : null}

            {activeTab === "core" ? (
              <>
                <SectionHeading
                  eyebrow="经营效率底表"
                  title="核心指标"
                  description="所有跨市场数据统一折算为人民币，人均指标统一为万元人民币/人。"
                />
                <CoreTable
                  companies={visibleCompanies}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
              </>
            ) : null}

            {activeTab === "peers" ? (
              <>
                <SectionHeading
                  eyebrow="同组比较"
                  title="可比组统计"
                  description="点击各市场桶可展开样本、P75 / 中位数 / P25 与插值过程；A股、中国成熟锚、美股按市场桶独立计算。"
                />
                <PeerTable companies={visibleDefaultCompanies} />
              </>
            ) : null}

            {activeTab === "events" ? (
              <>
                <SectionHeading
                  eyebrow="证据更新"
                  title="事件跟踪"
                  description="记录事实、影响变量、证据来源和下一步验证，避免只保留结论。"
                />
                <EventsTable rows={scopedEvents} query={query} />
              </>
            ) : null}

            {activeTab === "history" ? (
              <>
                <SectionHeading
                  eyebrow="可追溯快照"
                  title="历史记录"
                  description="每次成功更新保留当日关键估值与经营指标，支持后续对比。"
                />
                <HistoryTable rows={scopedHistory} query={query} />
              </>
            ) : null}

            {activeTab === "sources" ? (
              <>
                <SectionHeading
                  eyebrow="数据证据链"
                  title="来源审计"
                  description="行情、财报和结构化来源分列展示，便于交叉验证与回溯。"
                />
                <SourcesTable companies={visibleCompanies} />
              </>
            ) : null}

            {activeTab === "methods" ? (
              <>
                <SectionHeading
                  eyebrow="模型说明"
                  title="方法与假设"
                  description="把估值方法、权重、停用条件和使用限制公开展示。"
                />
                <MethodologyView methodology={data?.methodology} />
              </>
            ) : null}
          </section>

          <FormulaRail
            asOf={data?.asOf || ""}
            quoteDates={quoteDates}
            fxDate={getFxDate(data?.fx)}
          />
        </div>
      </main>

      <footer className="dashboard-footer">
        <p>科技股长期跟踪系统 · 研究支持用途 · 数据与模型均保留时点和来源</p>
        <p>
          最近生成：{formatDateTime(data?.generatedAt)} ·{" "}
          {response?.refresh?.automatic === false
            ? "自动检查未启用"
            : "本页打开期间每 5 分钟检查一次"}
        </p>
      </footer>

      <WatchPoolManager
        open={watchPoolOpen}
        defaultCompanies={defaultWatchCompanies}
        state={watchPool}
        storageWarning={storageWarning}
        customQuotesRefreshing={customQuotesRefreshing}
        onClose={closeWatchPool}
        onChange={setWatchPool}
        onRefreshCustom={(selected) => {
          void refreshCustomQuotes(selected);
        }}
      />
    </div>
  );
}

export default Dashboard;
