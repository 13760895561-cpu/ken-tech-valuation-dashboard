import type {
  CompanySnapshot,
  DashboardData,
  DashboardDataset,
  DashboardSummary,
  DerivedCompany,
  Methodology,
  ValuationBand,
  ValuationResult,
} from "./dashboard-types";

type MetricKey =
  | "ps"
  | "priceToGrossProfit"
  | "pe"
  | "pFcf"
  | "marketCapPerEmployeeCny10k";

type BandMode = "low" | "center" | "high";

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function multiply(left: unknown, right: unknown): number | null {
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  return a === null || b === null ? null : a * b;
}

function normalizedCurrency(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : fallback;
}

function currencyFxToCny(
  explicitFx: unknown,
  currency: string,
  legacyCurrency: string,
  legacyFx: unknown,
): number | null {
  const explicit = finiteNumber(explicitFx);
  if (explicit !== null) return explicit;
  if (currency === "CNY") return 1;
  return currency === legacyCurrency ? finiteNumber(legacyFx) : null;
}

function divide(
  numerator: unknown,
  denominator: unknown,
  requirePositiveDenominator = false,
): number | null {
  const a = finiteNumber(numerator);
  const b = finiteNumber(denominator);
  if (
    a === null ||
    b === null ||
    b === 0 ||
    (requirePositiveDenominator && b <= 0)
  ) {
    return null;
  }
  return a / b;
}

function median(values: Array<number | null | undefined>): number | null {
  const valid = values
    .filter((value): value is number => value !== null && value !== undefined)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  const midpoint = Math.floor(valid.length / 2);
  return valid.length % 2
    ? valid[midpoint]
    : (valid[midpoint - 1] + valid[midpoint]) / 2;
}

function stat(
  values: Array<number | null | undefined>,
  mode: BandMode,
): number | null {
  const valid = values
    .filter((value): value is number => value !== null && value !== undefined)
    .filter(Number.isFinite);
  if (!valid.length) return null;
  if (mode === "low") return Math.min(...valid);
  if (mode === "high") return Math.max(...valid);
  return median(valid);
}

function deriveCompany(company: CompanySnapshot): DerivedCompany {
  const legacyCurrency = normalizedCurrency(company.currency, "");
  const quoteCurrency = normalizedCurrency(
    company.quote_currency,
    legacyCurrency,
  );
  const financialCurrency = normalizedCurrency(
    company.financial_currency,
    legacyCurrency,
  );
  const quoteFxToCny = currencyFxToCny(
    company.quote_fx_to_cny,
    quoteCurrency,
    legacyCurrency,
    company.fx_to_cny,
  );
  const financialFxToCny = currencyFxToCny(
    company.financial_fx_to_cny,
    financialCurrency,
    legacyCurrency,
    company.fx_to_cny,
  );
  const currentMarketCapCny100m = multiply(
    company.market_cap_local_100m,
    quoteFxToCny,
  );
  const revenueCny100m = multiply(
    company.revenue_local_100m,
    financialFxToCny,
  );
  const grossProfitCny100m = multiply(
    company.gross_profit_local_100m,
    financialFxToCny,
  );
  const netProfitCny100m = multiply(
    company.net_profit_local_100m,
    financialFxToCny,
  );
  const ocfCny100m = multiply(company.ocf_local_100m, financialFxToCny);
  const capexCny100m = multiply(company.capex_local_100m, financialFxToCny);
  const fcfCny100m =
    ocfCny100m === null || capexCny100m === null
      ? null
      : ocfCny100m - capexCny100m;
  const cashCny100m = multiply(company.cash_local_100m, financialFxToCny);
  const debtCny100m = multiply(company.debt_local_100m, financialFxToCny);
  const enterpriseValueCny100m =
    currentMarketCapCny100m === null ||
    cashCny100m === null ||
    debtCny100m === null
      ? null
      : currentMarketCapCny100m + debtCny100m - cashCny100m;
  const employees = finiteNumber(company.employees);
  const perEmployee = (value: number | null) =>
    value === null || employees === null || employees <= 0
      ? null
      : (value * 10_000) / employees;

  const coreValues = [
    currentMarketCapCny100m,
    revenueCny100m,
    grossProfitCny100m,
    netProfitCny100m,
    employees,
  ];
  const valuationValues = [
    fcfCny100m,
    cashCny100m,
    debtCny100m,
    enterpriseValueCny100m,
  ];

  return {
    ...company,
    quote_currency: quoteCurrency,
    financial_currency: financialCurrency,
    quote_fx_to_cny: quoteFxToCny,
    financial_fx_to_cny: financialFxToCny,
    currentMarketCapCny100m,
    revenueCny100m,
    grossProfitCny100m,
    netProfitCny100m,
    fcfCny100m,
    cashCny100m,
    debtCny100m,
    enterpriseValueCny100m,
    revenuePerEmployeeCny10k: perEmployee(revenueCny100m),
    grossProfitPerEmployeeCny10k: perEmployee(grossProfitCny100m),
    netProfitPerEmployeeCny10k: perEmployee(netProfitCny100m),
    marketCapPerEmployeeCny10k: perEmployee(currentMarketCapCny100m),
    ps: divide(currentMarketCapCny100m, revenueCny100m),
    priceToGrossProfit: divide(
      currentMarketCapCny100m,
      grossProfitCny100m,
    ),
    evSales: divide(enterpriseValueCny100m, revenueCny100m),
    evGrossProfit: divide(enterpriseValueCny100m, grossProfitCny100m),
    pe: divide(currentMarketCapCny100m, netProfitCny100m, true),
    pFcf: divide(currentMarketCapCny100m, fcfCny100m, true),
    fcfYield:
      currentMarketCapCny100m !== null && currentMarketCapCny100m > 0
        ? divide(fcfCny100m, currentMarketCapCny100m)
        : null,
    coreStatus: coreValues.every((value) => finiteNumber(value) !== null)
      ? "OK"
      : "REVIEW",
    valuationInputStatus:
      valuationValues.every((value) => finiteNumber(value) !== null) &&
      Boolean(company.report_date)
        ? "OK"
        : "PARTIAL",
  };
}

export function deriveCompanies(
  companies: CompanySnapshot[],
): DerivedCompany[] {
  return companies.map(deriveCompany);
}

function metricValue(
  company: DerivedCompany,
  metric: MetricKey,
): number | null {
  return finiteNumber(company[metric]);
}

function dualAnchorBand(
  target: DerivedCompany,
  companies: DerivedCompany[],
  metric: MetricKey,
  globalDiscount: number,
): ValuationBand {
  const domestic = companies.filter(
    (company) =>
      company.group === target.group &&
      company.market === "A" &&
      company.id !== target.id &&
      company.include_in_stats,
  );
  const global = companies.filter(
    (company) =>
      company.group === target.group &&
      company.market !== "A" &&
      company.include_in_stats,
  );

  const combine = (mode: BandMode): number | null => {
    const domesticStat = stat(
      domestic.map((company) => metricValue(company, metric)),
      mode,
    );
    const globalStat = stat(
      global.map((company) => metricValue(company, metric)),
      mode,
    );
    const discountedGlobal =
      globalStat === null ? null : globalStat * globalDiscount;
    if (domesticStat !== null && discountedGlobal !== null) {
      return median([domesticStat, discountedGlobal]);
    }
    return domesticStat ?? discountedGlobal;
  };

  return {
    low: combine("low"),
    center: combine("center"),
    high: combine("high"),
  };
}

function impliedBand(
  operatingValue: number | null,
  anchor: ValuationBand,
  divisor = 1,
): ValuationBand {
  const calculate = (anchorValue: number | null) =>
    operatingValue !== null &&
    operatingValue > 0 &&
    anchorValue !== null &&
    anchorValue > 0
      ? (operatingValue * anchorValue) / divisor
      : null;
  return {
    low: calculate(anchor.low),
    center: calculate(anchor.center),
    high: calculate(anchor.high),
  };
}

function dateDiffDays(later: string, earlier: string): number | null {
  const laterTime = Date.parse(`${later}T00:00:00Z`);
  const earlierTime = Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(laterTime) || !Number.isFinite(earlierTime)) return null;
  return Math.floor((laterTime - earlierTime) / 86_400_000);
}

function scoreFreshness(asOf: string, reportDate: string): number | null {
  const days = dateDiffDays(asOf, reportDate);
  if (days === null) return null;
  if (days <= 365) return 100;
  if (days <= 550) return 70;
  return 40;
}

function temperature(
  ratio: number | null,
  methodology: Methodology,
): { score: number | null; label: string } {
  if (ratio === null) return { score: null, label: "数据不足" };
  const thresholds = [...methodology.temperature_thresholds].sort(
    (a, b) => a.max_ratio - b.max_ratio,
  );
  const selected = thresholds.find((threshold) => ratio <= threshold.max_ratio);
  return selected
    ? { score: selected.score, label: selected.label }
    : { score: 100, label: "极热" };
}

function conclusion(
  temperatureScore: number | null,
  confidenceScore: number | null,
): string {
  if (temperatureScore === null || confidenceScore === null) return "数据不足";
  if (temperatureScore <= 35 && confidenceScore >= 70) {
    return "重点复核区（非买入信号）";
  }
  if (temperatureScore >= 85) return "估值很热";
  if (confidenceScore < 55) return "证据不足";
  if (temperatureScore <= 50) return "偏冷/继续验证";
  return "继续跟踪";
}

export function calculateValuations(
  companies: DerivedCompany[],
  methodology: Methodology,
  asOf: string,
): ValuationResult[] {
  const globalDiscount = methodology.global_multiple_discount;
  const weights = methodology.confidence_weights;

  return companies
    .filter((company) => company.market === "A")
    .map((target) => {
      const domesticPeerCount = companies.filter(
        (company) =>
          company.group === target.group &&
          company.market === "A" &&
          company.id !== target.id &&
          company.include_in_stats,
      ).length;
      const globalPeerCount = companies.filter(
        (company) =>
          company.group === target.group &&
          company.market !== "A" &&
          company.include_in_stats,
      ).length;

      const anchors = {
        ps: dualAnchorBand(target, companies, "ps", globalDiscount),
        priceToGrossProfit: dualAnchorBand(
          target,
          companies,
          "priceToGrossProfit",
          globalDiscount,
        ),
        pe: dualAnchorBand(target, companies, "pe", globalDiscount),
        pFcf: dualAnchorBand(target, companies, "pFcf", globalDiscount),
        marketCapPerEmployee: dualAnchorBand(
          target,
          companies,
          "marketCapPerEmployeeCny10k",
          globalDiscount,
        ),
      };

      const impliedValues = {
        ps: impliedBand(target.revenueCny100m, anchors.ps),
        priceToGrossProfit: impliedBand(
          target.grossProfitCny100m,
          anchors.priceToGrossProfit,
        ),
        pe: impliedBand(target.netProfitCny100m, anchors.pe),
        pFcf: impliedBand(target.fcfCny100m, anchors.pFcf),
        marketCapPerEmployee: impliedBand(
          finiteNumber(target.employees),
          anchors.marketCapPerEmployee,
          10_000,
        ),
      };

      const modelLow = median(
        Object.values(impliedValues).map((band) => band.low),
      );
      const modelCenter = median(
        Object.values(impliedValues).map((band) => band.center),
      );
      const modelHigh = median(
        Object.values(impliedValues).map((band) => band.high),
      );
      const centerMethods = Object.values(impliedValues)
        .map((band) => band.center)
        .filter((value): value is number => value !== null);
      const validMethods = centerMethods.length;
      const minCenter = centerMethods.length ? Math.min(...centerMethods) : null;
      const maxCenter = centerMethods.length ? Math.max(...centerMethods) : null;
      const dispersion =
        centerMethods.length >= 2 &&
        minCenter !== null &&
        minCenter > 0 &&
        maxCenter !== null
          ? maxCenter / minCenter - 1
          : null;
      const currentToCenter =
        target.currentMarketCapCny100m !== null &&
        target.currentMarketCapCny100m > 0 &&
        modelCenter !== null &&
        modelCenter > 0
          ? target.currentMarketCapCny100m / modelCenter
          : null;
      const temperatureResult = temperature(currentToCenter, methodology);
      const freshnessScore = scoreFreshness(asOf, target.report_date);
      const peerQualityScore =
        domesticPeerCount + globalPeerCount >= 5
          ? 100
          : domesticPeerCount + globalPeerCount >= 3
            ? 75
            : 50;
      const sourceQuality = finiteNumber(target.data_quality_score);
      const methodCompleteness = (validMethods / 5) * 100;
      const convergence =
        dispersion === null ? 0 : Math.max(0, 100 - dispersion * 100);
      const confidenceScore =
        sourceQuality === null || freshnessScore === null
          ? null
          : Math.round(
              sourceQuality * weights.source_quality +
                freshnessScore * weights.freshness +
                peerQualityScore * weights.peer_quality +
                methodCompleteness * weights.method_completeness +
                convergence * weights.method_convergence,
            );

      return {
        id: target.id,
        name: target.name,
        ticker: target.ticker,
        group: target.group,
        currentMarketCapCny100m: target.currentMarketCapCny100m,
        modelLow,
        modelCenter,
        modelHigh,
        currentToCenter,
        temperatureScore: temperatureResult.score,
        temperatureLabel: temperatureResult.label,
        validMethods,
        dispersion,
        freshnessScore,
        peerQualityScore,
        confidenceScore,
        conclusion: conclusion(
          temperatureResult.score,
          confidenceScore,
        ),
        domesticPeerCount,
        globalPeerCount,
        anchors,
        impliedValues,
      };
    });
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
}

function buildSummary(
  companies: DerivedCompany[],
  valuations: ValuationResult[],
): DashboardSummary {
  const changeValues = companies.map((company) =>
    finiteNumber(company.change_pct),
  );
  return {
    companyCount: companies.length,
    targetCompanyCount: companies.filter((company) => company.market === "A")
      .length,
    valuationCount: valuations.length,
    completeCoreCount: companies.filter(
      (company) => company.coreStatus === "OK",
    ).length,
    completeValuationInputCount: companies.filter(
      (company) => company.valuationInputStatus === "OK",
    ).length,
    advancingCount: changeValues.filter(
      (value) => value !== null && value > 0,
    ).length,
    decliningCount: changeValues.filter(
      (value) => value !== null && value < 0,
    ).length,
    unchangedCount: changeValues.filter((value) => value === 0).length,
    hotCount: valuations.filter(
      (valuation) =>
        valuation.temperatureScore !== null &&
        valuation.temperatureScore >= 85,
    ).length,
    coldCount: valuations.filter(
      (valuation) =>
        valuation.temperatureScore !== null &&
        valuation.temperatureScore <= 30,
    ).length,
    averageTemperature: average(
      valuations.map((valuation) => valuation.temperatureScore),
    ),
    averageConfidence: average(
      valuations.map((valuation) => valuation.confidenceScore),
    ),
  };
}

export function buildDashboardData(dataset: DashboardDataset): DashboardData {
  const companies = deriveCompanies(dataset.snapshot.companies);
  const valuations = calculateValuations(
    companies,
    dataset.methodology,
    dataset.snapshot.as_of,
  );
  return {
    asOf: dataset.snapshot.as_of,
    generatedAt: dataset.snapshot.generated_at,
    quoteDateMin: dataset.snapshot.quote_date_min,
    quoteDateMax: dataset.snapshot.quote_date_max,
    fx: dataset.snapshot.fx,
    companies,
    valuations,
    events: dataset.events,
    history: dataset.history,
    methodology: dataset.methodology,
    summary: buildSummary(companies, valuations),
  };
}
