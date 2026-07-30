export type PeerMetricKey =
  | "revenueGrowth"
  | "grossMargin"
  | "netMargin"
  | "revenuePerEmployee"
  | "marketCapPerEmployee"
  | "ps"
  | "priceToGrossProfit"
  | "evSales"
  | "pe"
  | "pFcf";

export interface PeerMetricDefinition {
  key: PeerMetricKey;
  label: string;
  shortLabel: string;
  kind: "percent" | "perEmployee" | "multiple";
  sourceKeys: string[];
}

export interface PeerCompanyInput {
  id: string;
  name: string;
  ticker: string;
  group: string;
  region: string;
  trackingOrigin?: "default" | "custom";
  [key: string]: unknown;
}

export interface PercentileIncResult {
  percentile: number;
  value: number | null;
  count: number;
  sortedValues: number[];
  rank: number | null;
  lowerIndex: number | null;
  upperIndex: number | null;
  fraction: number | null;
  lowerValue: number | null;
  upperValue: number | null;
}

export interface PeerMetricSample {
  id: string;
  name: string;
  ticker: string;
  value: number;
}

export interface PeerMetricStatistics {
  metric: PeerMetricDefinition;
  validCount: number;
  lowConfidence: boolean;
  sortedSamples: PeerMetricSample[];
  p75: PercentileIncResult;
  median: PercentileIncResult;
  p25: PercentileIncResult;
}

export interface PeerMarketBucket {
  id: string;
  label: string;
  description: string;
  companies: PeerCompanyInput[];
  metrics: PeerMetricStatistics[];
  lowConfidence: boolean;
}

export interface PeerGroupStatistics {
  group: string;
  count: number;
  aShareCount: number;
  globalCount: number;
  lowConfidence: boolean;
  summary: {
    revenuePerEmployeeMedian: number | null;
    marketCapPerEmployeeMedian: number | null;
    psMedian: number | null;
    evSalesMedian: number | null;
    evGrossProfitMedian: number | null;
  };
  buckets: PeerMarketBucket[];
}

export const PEER_METRICS: PeerMetricDefinition[] = [
  {
    key: "revenueGrowth",
    label: "收入增速",
    shortLabel: "收入增速",
    kind: "percent",
    sourceKeys: ["revenue_growth", "revenueGrowth"],
  },
  {
    key: "grossMargin",
    label: "毛利率",
    shortLabel: "毛利率",
    kind: "percent",
    sourceKeys: ["gross_margin", "grossMargin"],
  },
  {
    key: "netMargin",
    label: "净利率",
    shortLabel: "净利率",
    kind: "percent",
    sourceKeys: ["net_margin", "netMargin"],
  },
  {
    key: "revenuePerEmployee",
    label: "人均营收",
    shortLabel: "人均营收",
    kind: "perEmployee",
    sourceKeys: ["revenuePerEmployeeCny10k"],
  },
  {
    key: "marketCapPerEmployee",
    label: "人均市值",
    shortLabel: "人均市值",
    kind: "perEmployee",
    sourceKeys: ["marketCapPerEmployeeCny10k"],
  },
  {
    key: "ps",
    label: "P/S",
    shortLabel: "P/S",
    kind: "multiple",
    sourceKeys: ["ps"],
  },
  {
    key: "priceToGrossProfit",
    label: "P/毛利",
    shortLabel: "P/毛利",
    kind: "multiple",
    sourceKeys: ["priceToGrossProfit"],
  },
  {
    key: "evSales",
    label: "EV/Sales",
    shortLabel: "EV/Sales",
    kind: "multiple",
    sourceKeys: ["evSales"],
  },
  {
    key: "pe",
    label: "P/E",
    shortLabel: "P/E",
    kind: "multiple",
    sourceKeys: ["pe"],
  },
  {
    key: "pFcf",
    label: "P/FCF",
    shortLabel: "P/FCF",
    kind: "multiple",
    sourceKeys: ["pFcf"],
  },
];

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstFinite(
  company: PeerCompanyInput,
  sourceKeys: string[],
): number | null {
  for (const key of sourceKeys) {
    const value = finiteNumber(company[key]);
    if (value !== null) return value;
  }
  return null;
}

export function peerMetricValue(
  company: PeerCompanyInput,
  metric: PeerMetricDefinition,
): number | null {
  return firstFinite(company, metric.sourceKeys);
}

export function percentileInc(
  values: unknown[],
  percentile: number,
): PercentileIncResult {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new Error("PERCENTILE.INC 的分位参数必须在 0–1 之间");
  }
  const sortedValues = values
    .map(finiteNumber)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const count = sortedValues.length;
  if (!count) {
    return {
      percentile,
      value: null,
      count: 0,
      sortedValues,
      rank: null,
      lowerIndex: null,
      upperIndex: null,
      fraction: null,
      lowerValue: null,
      upperValue: null,
    };
  }

  const rank = (count - 1) * percentile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const fraction = rank - lowerIndex;
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];
  const value = lowerValue + (upperValue - lowerValue) * fraction;
  return {
    percentile,
    value,
    count,
    sortedValues,
    rank,
    lowerIndex,
    upperIndex,
    fraction,
    lowerValue,
    upperValue,
  };
}

function metricStatistics(
  companies: PeerCompanyInput[],
  metric: PeerMetricDefinition,
): PeerMetricStatistics {
  const sortedSamples = companies
    .map((company) => {
      const value = peerMetricValue(company, metric);
      return value === null
        ? null
        : {
            id: company.id,
            name: company.name,
            ticker: company.ticker,
            value,
          };
    })
    .filter((sample): sample is PeerMetricSample => sample !== null)
    .sort(
      (left, right) =>
        left.value - right.value ||
        left.name.localeCompare(right.name, "zh-CN"),
    );
  const values = sortedSamples.map((sample) => sample.value);
  return {
    metric,
    validCount: values.length,
    lowConfidence: values.length < 5,
    sortedSamples,
    p75: percentileInc(values, 0.75),
    median: percentileInc(values, 0.5),
    p25: percentileInc(values, 0.25),
  };
}

function medianFor(
  companies: PeerCompanyInput[],
  sourceKeys: string[],
): number | null {
  return percentileInc(
    companies.map((company) => firstFinite(company, sourceKeys)),
    0.5,
  ).value;
}

function marketBucket(
  id: string,
  label: string,
  description: string,
  companies: PeerCompanyInput[],
): PeerMarketBucket {
  return {
    id,
    label,
    description,
    companies,
    metrics: PEER_METRICS.map((metric) =>
      metricStatistics(companies, metric),
    ),
    lowConfidence: companies.length < 5,
  };
}

function regionPriority(region: string): number {
  if (region === "A股") return 0;
  if (region === "中国成熟锚") return 1;
  if (region === "美股") return 2;
  return 3;
}

function regionLabel(region: string): string {
  if (region === "A股") return "A股样本";
  if (region === "美股") return "美股样本";
  return region;
}

export function buildPeerGroupStatistics(
  companies: PeerCompanyInput[],
): PeerGroupStatistics[] {
  const eligible = companies.filter(
    (company) => company.trackingOrigin !== "custom" && company.group,
  );
  const groups = [
    ...new Set(eligible.map((company) => company.group).filter(Boolean)),
  ];

  return groups.map((group) => {
    const groupCompanies = eligible.filter(
      (company) => company.group === group,
    );
    const aShares = groupCompanies.filter(
      (company) => company.region === "A股",
    );
    const global = groupCompanies.filter(
      (company) => company.region !== "A股",
    );
    const regions = [
      ...new Set(groupCompanies.map((company) => company.region).filter(Boolean)),
    ].sort(
      (left, right) =>
        regionPriority(left) - regionPriority(right) ||
        left.localeCompare(right, "zh-CN"),
    );
    const buckets = regions.map((region, index) =>
      marketBucket(
        `region-${index}`,
        regionLabel(region),
        `region = ${region}；与原版 Excel 一致，按该市场桶独立计算分位数。`,
        groupCompanies.filter((company) => company.region === region),
      ),
    );
    return {
      group,
      count: groupCompanies.length,
      aShareCount: aShares.length,
      globalCount: global.length,
      lowConfidence: buckets.some((bucket) => bucket.lowConfidence),
      summary: {
        revenuePerEmployeeMedian: medianFor(aShares, [
          "revenuePerEmployeeCny10k",
        ]),
        marketCapPerEmployeeMedian: medianFor(aShares, [
          "marketCapPerEmployeeCny10k",
        ]),
        psMedian: medianFor(groupCompanies, ["ps"]),
        evSalesMedian: medianFor(groupCompanies, ["evSales"]),
        evGrossProfitMedian: medianFor(groupCompanies, ["evGrossProfit"]),
      },
      buckets,
    };
  });
}
