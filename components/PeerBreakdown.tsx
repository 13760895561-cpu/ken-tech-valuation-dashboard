"use client";

import { Fragment, useId, useMemo, useState } from "react";
import {
  buildPeerGroupStatistics,
  peerMetricValue,
  type PeerCompanyInput,
  type PeerMetricDefinition,
  type PercentileIncResult,
} from "@/lib/peer-statistics";

interface PeerBreakdownProps {
  companies: PeerCompanyInput[];
}

function formatNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMetricValue(
  value: number | null,
  metric: PeerMetricDefinition,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (metric.kind === "percent") return `${formatNumber(value * 100, 1)}%`;
  if (metric.kind === "perEmployee") {
    return `${formatNumber(value, 1)} 万元/人`;
  }
  return `${formatNumber(value, 2)}x`;
}

function percentileLabel(percentile: number): string {
  if (percentile === 0.75) return "P75";
  if (percentile === 0.5) return "中位数（P50）";
  return "P25";
}

function interpolationText(
  calculation: PercentileIncResult,
  metric: PeerMetricDefinition,
): string {
  const label = percentileLabel(calculation.percentile);
  if (
    calculation.value === null ||
    calculation.rank === null ||
    calculation.lowerIndex === null ||
    calculation.upperIndex === null ||
    calculation.fraction === null ||
    calculation.lowerValue === null ||
    calculation.upperValue === null
  ) {
    return `${label}：无有效值，结果留空。`;
  }
  const percentile = `${calculation.percentile * 100}%`;
  const rank = formatNumber(calculation.rank, 2);
  const result = formatMetricValue(calculation.value, metric);
  if (calculation.lowerIndex === calculation.upperIndex) {
    return `${label}：n=${calculation.count}，r = (n−1) × ${percentile} = (${
      calculation.count
    }−1) × ${percentile} = ${rank}；落在升序第 ${
      calculation.lowerIndex + 1
    } 个值，结果 = ${result}。`;
  }
  const lower = formatMetricValue(calculation.lowerValue, metric);
  const upper = formatMetricValue(calculation.upperValue, metric);
  const fraction = formatNumber(calculation.fraction, 2);
  return `${label}：n=${calculation.count}，r = (n−1) × ${percentile} = (${
    calculation.count
  }−1) × ${percentile} = ${rank}；第 ${
    calculation.lowerIndex + 1
  } 个值 ${lower} +（第 ${
    calculation.upperIndex + 1
  } 个值 ${upper} − ${lower}）× ${fraction} = ${result}。`;
}

export default function PeerBreakdown({
  companies,
}: PeerBreakdownProps) {
  const groups = useMemo(
    () => buildPeerGroupStatistics(companies),
    [companies],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const instanceId = useId().replace(/:/g, "");

  const toggleGroup = (group: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <div className="table-scroll peer-table-scroll">
      <table className="data-table peer-table">
        <caption className="sr-only">
          按行业可比组统计的样本数与中位数；每行可展开查看市场桶、公司样本和分位数插值过程
        </caption>
        <thead>
          <tr>
            <th scope="col">可比组</th>
            <th scope="col">样本数</th>
            <th scope="col">A股 / 全球参考</th>
            <th scope="col">人均营收中位数</th>
            <th scope="col">人均市值中位数</th>
            <th scope="col">P/S 中位数</th>
            <th scope="col">EV/Sales 中位数</th>
            <th scope="col">EV/毛利中位数</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((row, index) => {
            const expanded = expandedGroups.has(row.group);
            const toggleId = `${instanceId}-peer-toggle-${index}`;
            const panelId = `${instanceId}-peer-panel-${index}`;
            return (
              <Fragment key={row.group}>
                <tr className={expanded ? "peer-summary-row is-expanded" : "peer-summary-row"}>
                  <th scope="row">
                    <button
                      id={toggleId}
                      type="button"
                      className="peer-expand-button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => toggleGroup(row.group)}
                    >
                      <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                      <strong>{row.group}</strong>
                      <small>{expanded ? "收起样本与分位数" : "展开样本与分位数"}</small>
                    </button>
                    {row.lowConfidence ? (
                      <span className="peer-confidence-badge is-low">
                        市场桶 n&lt;5
                      </span>
                    ) : null}
                  </th>
                  <td className="number-cell">{row.count}</td>
                  <td className="number-cell">
                    {row.aShareCount} / {row.globalCount}
                  </td>
                  <td className="number-cell">
                    {formatNumber(row.summary.revenuePerEmployeeMedian, 1)}
                    <small>万元/人</small>
                  </td>
                  <td className="number-cell">
                    {formatNumber(row.summary.marketCapPerEmployeeMedian, 1)}
                    <small>万元/人</small>
                  </td>
                  <td className="number-cell">
                    {formatNumber(row.summary.psMedian, 2)}x
                  </td>
                  <td className="number-cell">
                    {formatNumber(row.summary.evSalesMedian, 2)}x
                  </td>
                  <td className="number-cell">
                    {formatNumber(row.summary.evGrossProfitMedian, 2)}x
                  </td>
                </tr>
                <tr className="peer-detail-row" hidden={!expanded}>
                  <td colSpan={8}>
                    <div
                      id={panelId}
                      className="peer-expansion-panel"
                      role="region"
                      aria-labelledby={toggleId}
                    >
                      <header className="peer-panel-header">
                        <div>
                          <p className="eyebrow">样本穿透与分位审计</p>
                          <h3>{row.group}</h3>
                        </div>
                        <p>
                          每个市场桶独立计算；每项指标先排除空值，再按升序使用
                          PERCENTILE.INC。有效样本 n&lt;5 时标记为低置信度。
                        </p>
                      </header>

                      <div className="peer-bucket-list">
                        {row.buckets.map((bucket) => (
                          <section
                            className="peer-bucket-card"
                            key={`${row.group}-${bucket.id}`}
                            aria-labelledby={`${panelId}-${bucket.id}-title`}
                          >
                            <header className="peer-bucket-header">
                              <div>
                                <h4 id={`${panelId}-${bucket.id}-title`}>
                                  {bucket.label}
                                </h4>
                                <p>{bucket.description}</p>
                              </div>
                              <div className="peer-bucket-count">
                                <strong>{bucket.companies.length}</strong>
                                <span>家公司</span>
                                {bucket.lowConfidence ? (
                                  <em>低置信度</em>
                                ) : (
                                  <em className="is-ok">样本充足</em>
                                )}
                              </div>
                            </header>

                            {bucket.companies.length ? (
                              <div className="peer-nested-scroll">
                                <table className="peer-sample-table">
                                  <caption className="sr-only">
                                    {row.group} {bucket.label}逐家公司指标
                                  </caption>
                                  <thead>
                                    <tr>
                                      <th scope="col">公司 / 代码</th>
                                      <th scope="col">市场</th>
                                      {bucket.metrics.map(({ metric }) => (
                                        <th scope="col" key={metric.key}>
                                          {metric.shortLabel}
                                          {metric.kind === "perEmployee" ? (
                                            <small>万元/人</small>
                                          ) : metric.kind === "multiple" ? (
                                            <small>x</small>
                                          ) : (
                                            <small>%</small>
                                          )}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {bucket.companies.map((company) => (
                                      <tr key={company.id}>
                                        <th scope="row">
                                          <strong>{company.name}</strong>
                                          <small>{company.ticker}</small>
                                        </th>
                                        <td>{company.region}</td>
                                        {bucket.metrics.map(({ metric }) => (
                                          <td
                                            className="number-cell"
                                            key={metric.key}
                                          >
                                            {formatMetricValue(
                                              peerMetricValue(company, metric),
                                              metric,
                                            )}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="peer-empty-bucket">
                                当前观察池在该市场桶没有样本。
                              </p>
                            )}

                            <div className="peer-nested-scroll">
                              <table className="peer-percentile-table">
                                <caption className="sr-only">
                                  {row.group} {bucket.label}分位数统计
                                </caption>
                                <thead>
                                  <tr>
                                    <th scope="col">指标</th>
                                    <th scope="col">有效 n</th>
                                    <th scope="col">P75</th>
                                    <th scope="col">中位数（P50）</th>
                                    <th scope="col">P25</th>
                                    <th scope="col">置信度</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bucket.metrics.map((metricStats) => (
                                    <tr key={metricStats.metric.key}>
                                      <th scope="row">
                                        {metricStats.metric.label}
                                      </th>
                                      <td className="number-cell">
                                        {metricStats.validCount}
                                      </td>
                                      <td className="number-cell">
                                        {formatMetricValue(
                                          metricStats.p75.value,
                                          metricStats.metric,
                                        )}
                                      </td>
                                      <td className="number-cell">
                                        {formatMetricValue(
                                          metricStats.median.value,
                                          metricStats.metric,
                                        )}
                                      </td>
                                      <td className="number-cell">
                                        {formatMetricValue(
                                          metricStats.p25.value,
                                          metricStats.metric,
                                        )}
                                      </td>
                                      <td>
                                        <span
                                          className={`peer-confidence-badge ${
                                            metricStats.lowConfidence
                                              ? "is-low"
                                              : "is-ok"
                                          }`}
                                        >
                                          {metricStats.lowConfidence
                                            ? "低置信度"
                                            : "样本充足"}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <details className="peer-percentile-audit">
                              <summary>
                                查看排序后的有效值与 PERCENTILE.INC 插值过程
                              </summary>
                              <div className="peer-audit-grid">
                                {bucket.metrics.map((metricStats) => (
                                  <article
                                    className="peer-audit-card"
                                    key={metricStats.metric.key}
                                  >
                                    <header>
                                      <h5>{metricStats.metric.label}</h5>
                                      <span
                                        className={`peer-confidence-badge ${
                                          metricStats.lowConfidence
                                            ? "is-low"
                                            : "is-ok"
                                        }`}
                                      >
                                        n={metricStats.validCount}
                                      </span>
                                    </header>
                                    {metricStats.sortedSamples.length ? (
                                      <>
                                        <p>有效值升序：</p>
                                        <ol className="peer-sorted-values">
                                          {metricStats.sortedSamples.map(
                                            (sample) => (
                                              <li key={sample.id}>
                                                <span>
                                                  {formatMetricValue(
                                                    sample.value,
                                                    metricStats.metric,
                                                  )}
                                                </span>
                                                <small>
                                                  {sample.name} ·{" "}
                                                  {sample.ticker}
                                                </small>
                                              </li>
                                            ),
                                          )}
                                        </ol>
                                      </>
                                    ) : (
                                      <p>有效值升序：无；空值已排除。</p>
                                    )}
                                    <ul className="peer-interpolation-list">
                                      {[
                                        metricStats.p75,
                                        metricStats.median,
                                        metricStats.p25,
                                      ].map((calculation) => (
                                        <li key={calculation.percentile}>
                                          {interpolationText(
                                            calculation,
                                            metricStats.metric,
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </article>
                                ))}
                              </div>
                            </details>
                          </section>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
