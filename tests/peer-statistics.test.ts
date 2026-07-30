import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PEER_METRICS,
  buildPeerGroupStatistics,
  percentileInc,
  type PeerCompanyInput,
} from "../lib/peer-statistics";

test("PERCENTILE.INC matches Excel inclusive interpolation", () => {
  const values = [6, 1, 5, 2, 4, 3, null, Number.NaN];
  const p75 = percentileInc(values, 0.75);
  const median = percentileInc(values, 0.5);
  const p25 = percentileInc(values, 0.25);

  assert.deepEqual(p75.sortedValues, [1, 2, 3, 4, 5, 6]);
  assert.equal(p75.rank, 3.75);
  assert.equal(p75.lowerIndex, 3);
  assert.equal(p75.upperIndex, 4);
  assert.equal(p75.fraction, 0.75);
  assert.equal(p75.value, 4.75);
  assert.equal(median.value, 3.5);
  assert.equal(p25.value, 2.25);
});

test("PERCENTILE.INC excludes blanks and preserves an explicit empty result", () => {
  const empty = percentileInc([null, undefined, "", Number.NaN], 0.5);
  assert.equal(empty.count, 0);
  assert.equal(empty.value, null);
  assert.deepEqual(empty.sortedValues, []);
  assert.throws(() => percentileInc([1], 1.1), /0–1/);
});

test("peer groups calculate A-share, China anchor, and US buckets independently", () => {
  const companies: PeerCompanyInput[] = [
    {
      id: "a1",
      name: "A1",
      ticker: "000001.SZ",
      group: "测试组",
      region: "A股",
      revenue_growth: 0.1,
      gross_margin: 0.4,
      net_margin: 0.2,
      revenuePerEmployeeCny10k: 100,
      marketCapPerEmployeeCny10k: 200,
      ps: 2,
      priceToGrossProfit: 5,
      evSales: 1.8,
      evGrossProfit: 4.5,
      pe: 10,
      pFcf: 12,
    },
    {
      id: "a2",
      name: "A2",
      ticker: "000002.SZ",
      group: "测试组",
      region: "A股",
      revenue_growth: 0.2,
      gross_margin: 0.5,
      net_margin: 0.25,
      revenuePerEmployeeCny10k: 200,
      marketCapPerEmployeeCny10k: 400,
      ps: 4,
      priceToGrossProfit: 8,
      evSales: 3.8,
      evGrossProfit: 7.6,
      pe: 16,
      pFcf: null,
    },
    {
      id: "c1",
      name: "成熟锚1",
      ticker: "0700.HK",
      group: "测试组",
      region: "中国成熟锚",
      ps: 20,
      pFcf: 40,
    },
    {
      id: "c2",
      name: "成熟锚2",
      ticker: "9988.HK",
      group: "测试组",
      region: "中国成熟锚",
      ps: 40,
      pFcf: 60,
    },
    {
      id: "u1",
      name: "U1",
      ticker: "U1",
      group: "测试组",
      region: "美股",
      revenue_growth: 0.3,
      gross_margin: 0.6,
      net_margin: 0.3,
      revenuePerEmployeeCny10k: 300,
      marketCapPerEmployeeCny10k: 600,
      ps: 200,
      priceToGrossProfit: 10,
      evSales: 5.8,
      evGrossProfit: 9.7,
      pe: 20,
      pFcf: 220,
    },
    {
      id: "u2",
      name: "U2",
      ticker: "U2",
      group: "测试组",
      region: "美股",
      ps: 400,
      pFcf: 440,
    },
    {
      id: "custom",
      name: "自定义",
      ticker: "CUSTOM",
      group: "测试组",
      region: "美股",
      trackingOrigin: "custom",
      ps: 999,
    },
  ];

  const [group] = buildPeerGroupStatistics(companies);
  assert.equal(group.count, 6);
  assert.equal(group.aShareCount, 2);
  assert.equal(group.globalCount, 4);
  assert.equal(group.lowConfidence, true);
  assert.equal(group.summary.revenuePerEmployeeMedian, 150);
  assert.equal(group.summary.psMedian, 30);

  const aShare = group.buckets[0];
  assert.deepEqual(
    group.buckets.map((bucket) => ({
      label: bucket.label,
      companies: bucket.companies.map((company) => company.id),
      psMedian: bucket.metrics.find((metric) => metric.metric.key === "ps")
        ?.median.value,
    })),
    [
      {
        label: "A股样本",
        companies: ["a1", "a2"],
        psMedian: 3,
      },
      {
        label: "中国成熟锚",
        companies: ["c1", "c2"],
        psMedian: 30,
      },
      {
        label: "美股样本",
        companies: ["u1", "u2"],
        psMedian: 300,
      },
    ],
  );
  assert.ok(
    group.buckets.every((bucket) =>
      bucket.description.includes("按该市场桶独立计算"),
    ),
  );
  assert.equal(aShare.metrics.length, 10);
  assert.deepEqual(
    aShare.metrics.map((metric) => metric.metric.label),
    [
      "收入增速",
      "毛利率",
      "净利率",
      "人均营收",
      "人均市值",
      "P/S",
      "P/毛利",
      "EV/Sales",
      "P/E",
      "P/FCF",
    ],
  );
  const pFcf = aShare.metrics.find((metric) => metric.metric.key === "pFcf");
  assert.equal(pFcf?.validCount, 1);
  assert.equal(pFcf?.lowConfidence, true);
  assert.deepEqual(
    pFcf?.sortedSamples.map((sample) => sample.value),
    [12],
  );
  assert.equal(PEER_METRICS.length, 10);
});

test("expanded peer component exposes accessible controls and audit copy", () => {
  const source = readFileSync(
    new URL("../components/PeerBreakdown.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /role="region"/);
  assert.match(source, /PERCENTILE\.INC/);
  assert.match(source, /有效值升序/);
  assert.match(source, /低置信度/);
});
