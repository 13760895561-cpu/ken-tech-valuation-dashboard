export type MaybeNumber = number | null | undefined;

export interface FxSnapshot {
  date: string;
  source: string;
  rates_to_cny: {
    CNY: number;
    USD: number | null;
    HKD: number | null;
    [currency: string]: number | null;
  };
  status: string;
}

export interface QuoteMeta {
  source: string;
  sample_count: number;
  success_count: number;
  status: string;
}

export interface CompanySnapshot {
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
  name_quote?: string;
  price_local: MaybeNumber;
  prev_close_local: MaybeNumber;
  change_pct: MaybeNumber;
  quote_date: string;
  shares_million: MaybeNumber;
  market_cap_local_100m: MaybeNumber;
  quote_market_cap_check_100m: MaybeNumber;
  currency: string;
  structured_source: string;
  report_period: string;
  report_date: string;
  notice_date?: string;
  revenue_local_100m: MaybeNumber;
  gross_profit_local_100m: MaybeNumber;
  net_profit_local_100m: MaybeNumber;
  revenue_growth: MaybeNumber;
  gross_margin: MaybeNumber;
  net_margin: MaybeNumber;
  roic: MaybeNumber;
  employees: MaybeNumber;
  official_report_source: string;
  ocf_local_100m: MaybeNumber;
  capex_local_100m: MaybeNumber;
  cash_local_100m: MaybeNumber;
  debt_local_100m: MaybeNumber;
  errors: string[];
  financial_refresh_status?: string;
  financial_source_generated_at?: string;
  quote_source?: string;
  quote_status?: string;
  fx_to_cny: MaybeNumber;
  data_quality_score: MaybeNumber;
  [key: string]: unknown;
}

export interface Snapshot {
  system_version: string;
  as_of: string;
  run_date: string;
  generated_at: string;
  quote_date_min: string;
  quote_date_max: string;
  fx: FxSnapshot;
  quote_meta: QuoteMeta;
  sample_count: number;
  success_count: number;
  elapsed_seconds: number;
  companies: CompanySnapshot[];
  [key: string]: unknown;
}

export interface TemperatureThreshold {
  max_ratio: number;
  score: number;
  label: string;
}

export interface Methodology {
  version: string;
  valuation_date_source: string;
  global_multiple_discount: number;
  temperature_thresholds: TemperatureThreshold[];
  valuation_aggregation: {
    method: string;
    weights_enabled: boolean;
    note: string;
  };
  confidence_weights: {
    source_quality: number;
    freshness: number;
    peer_quality: number;
    method_completeness: number;
    method_convergence: number;
  };
  principles: string[];
}

export type EventRecord = Record<string, string>;
export type HistoryRecord = Record<string, string>;

export interface DashboardDataset {
  exportedAt: string;
  snapshot: Snapshot;
  methodology: Methodology;
  events: EventRecord[];
  history: HistoryRecord[];
}

export interface DerivedCompany extends CompanySnapshot {
  currentMarketCapCny100m: number | null;
  revenueCny100m: number | null;
  grossProfitCny100m: number | null;
  netProfitCny100m: number | null;
  fcfCny100m: number | null;
  cashCny100m: number | null;
  debtCny100m: number | null;
  enterpriseValueCny100m: number | null;
  revenuePerEmployeeCny10k: number | null;
  grossProfitPerEmployeeCny10k: number | null;
  netProfitPerEmployeeCny10k: number | null;
  marketCapPerEmployeeCny10k: number | null;
  ps: number | null;
  priceToGrossProfit: number | null;
  evSales: number | null;
  evGrossProfit: number | null;
  pe: number | null;
  pFcf: number | null;
  fcfYield: number | null;
  coreStatus: "OK" | "REVIEW";
  valuationInputStatus: "OK" | "PARTIAL";
}

export interface ValuationBand {
  low: number | null;
  center: number | null;
  high: number | null;
}

export interface ValuationAnchors {
  ps: ValuationBand;
  priceToGrossProfit: ValuationBand;
  pe: ValuationBand;
  pFcf: ValuationBand;
  marketCapPerEmployee: ValuationBand;
}

export interface ValuationResult {
  id: string;
  name: string;
  ticker: string;
  group: string;
  currentMarketCapCny100m: number | null;
  modelLow: number | null;
  modelCenter: number | null;
  modelHigh: number | null;
  currentToCenter: number | null;
  temperatureScore: number | null;
  temperatureLabel: string;
  validMethods: number;
  dispersion: number | null;
  freshnessScore: number | null;
  peerQualityScore: number;
  confidenceScore: number | null;
  conclusion: string;
  domesticPeerCount: number;
  globalPeerCount: number;
  anchors: ValuationAnchors;
  impliedValues: {
    ps: ValuationBand;
    priceToGrossProfit: ValuationBand;
    pe: ValuationBand;
    pFcf: ValuationBand;
    marketCapPerEmployee: ValuationBand;
  };
}

export interface DashboardSummary {
  companyCount: number;
  targetCompanyCount: number;
  valuationCount: number;
  completeCoreCount: number;
  completeValuationInputCount: number;
  advancingCount: number;
  decliningCount: number;
  unchangedCount: number;
  hotCount: number;
  coldCount: number;
  averageTemperature: number | null;
  averageConfidence: number | null;
}

export interface DashboardData {
  asOf: string;
  generatedAt: string;
  quoteDateMin: string;
  quoteDateMax: string;
  fx: FxSnapshot;
  companies: DerivedCompany[];
  valuations: ValuationResult[];
  events: EventRecord[];
  history: HistoryRecord[];
  methodology: Methodology;
  summary: DashboardSummary;
}

export type DashboardState =
  | "fresh"
  | "stale"
  | "refreshing"
  | "stale-retained";

export interface DashboardStatus {
  state: DashboardState;
  stale: boolean;
  initializedFromSeed: boolean;
  refreshAttempted: boolean;
  refreshed: boolean;
  source: "seed" | "stored" | "live";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  message: string;
}

export interface DashboardResponse {
  ok: boolean;
  data: DashboardData;
  status: DashboardStatus;
  refresh: {
    automatic: true;
    staleAfterSeconds: number;
    manual: {
      method: "POST";
      endpoint: "/api/dashboard";
      body: { action: "refresh" };
    };
    sources: {
      quotes: string;
      fx: string;
    };
  };
}
