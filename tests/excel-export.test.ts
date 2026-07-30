import assert from "node:assert/strict";
import { test } from "node:test";
import writeExcelFile from "write-excel-file/node";
import seedData from "../lib/seed-data.json";
import type { DashboardDataset } from "../lib/dashboard-types";
import {
  buildDashboardWorkbookSheets,
  type DashboardExcelExportInput,
} from "../lib/excel-export";
import { buildDashboardData } from "../lib/model";

function exportInput(): DashboardExcelExportInput {
  const data = buildDashboardData(seedData as DashboardDataset);
  return {
    asOf: data.asOf,
    generatedAt: data.generatedAt,
    quoteDateMin: data.quoteDateMin,
    quoteDateMax: data.quoteDateMax,
    fx: data.fx as unknown as Record<string, unknown>,
    summary: data.summary as unknown as Record<string, unknown>,
    companies: data.companies,
    valuations: data.valuations as unknown as Array<Record<string, unknown>>,
    events: data.events,
    history: data.history,
    methodology: data.methodology as unknown as Record<string, unknown>,
    status: { state: "fresh", message: "测试数据完整" },
    filters: { query: "", group: "全部", region: "全部" },
  };
}

function cellValue(cell: unknown): unknown {
  if (cell && typeof cell === "object" && "value" in cell) {
    return (cell as { value?: unknown }).value;
  }
  return cell;
}

test("完整Excel导出包含九个视图、公式、可比样本和安全文本", async () => {
  const input = exportInput();
  input.companies = [
    ...input.companies,
    {
      id: "custom:test",
      ticker: "=DANGEROUS",
      name: "测试自定义公司",
      market: "OTHER",
      region: "其他市场",
      group: "",
      trackingOrigin: "custom",
      customNote: "绝不能进入分享文件的私人备注",
      quote_currency: "USD",
      quote_fx_to_cny: 7,
      price_local: 1,
      market_cap_local_100m: 2,
    },
  ];
  const sheets = buildDashboardWorkbookSheets(
    input,
    "2026-07-30T12:00:00.000Z",
  );

  assert.deepEqual(
    sheets.map((sheet) => sheet.sheet),
    [
      "看板概览",
      "核心指标",
      "估值明细",
      "可比组统计",
      "事件跟踪",
      "历史快照",
      "来源审计",
      "方法与公式",
      "导出检查",
    ],
  );
  for (const sheet of sheets) {
    const lastHeader = cellValue(sheet.data[3].at(-1));
    assert.match(
      String(lastHeader),
      /单位与公式/,
      `${sheet.sheet} 最右列必须标注单位与公式`,
    );
  }

  const core = sheets[1].data;
  const coreHeaders = core[3].map(cellValue);
  const tickerColumn = coreHeaders.indexOf("证券代码");
  const quoteCurrencyColumn = coreHeaders.indexOf("行情币种");
  const financialCurrencyColumn = coreHeaders.indexOf("财务币种");
  const marketCapColumn = coreHeaders.indexOf("市值（人民币亿元）");
  const revenueCnyColumn = coreHeaders.indexOf("营收（人民币亿元）");
  const tencentRow = core.find(
    (row) => cellValue(row[tickerColumn]) === "00700.HK",
  );
  assert.ok(tencentRow, "腾讯行必须保留港股前导0");
  assert.equal(cellValue(tencentRow[quoteCurrencyColumn]), "HKD");
  assert.equal(cellValue(tencentRow[financialCurrencyColumn]), "CNY");
  assert.equal(
    typeof cellValue(tencentRow[marketCapColumn]),
    "number",
    "派生值应直接可见，公式口径放在最右侧注释",
  );
  const alibabaRow = core.find(
    (row) => cellValue(row[tickerColumn]) === "09988.HK",
  );
  assert.ok(alibabaRow, "阿里巴巴行必须保留港股前导0");
  assert.equal(cellValue(alibabaRow[quoteCurrencyColumn]), "HKD");
  assert.equal(cellValue(alibabaRow[financialCurrencyColumn]), "CNY");

  const customRow = core.find(
    (row) => cellValue(row[1]) === "测试自定义公司",
  );
  assert.ok(customRow);
  assert.equal(cellValue(customRow[tickerColumn]), "'=DANGEROUS");
  assert.equal(
    (customRow[tickerColumn] as { type?: unknown }).type,
    String,
  );
  assert.equal(cellValue(customRow[financialCurrencyColumn]), "");
  assert.equal(
    cellValue(customRow[revenueCnyColumn]),
    "",
    "自定义仅行情公司的财务数据必须留空，不能填0",
  );
  assert.equal(
    JSON.stringify(sheets).includes("绝不能进入分享文件的私人备注"),
    false,
  );
  assert.equal(
    JSON.stringify(sheets).includes("[object Object]"),
    false,
    "对象数组必须展开为可读字段，不能退化成占位文本",
  );

  const peerText = JSON.stringify(sheets[3].data);
  assert.match(peerText, /寒武纪/);
  assert.match(peerText, /英伟达/);
  assert.match(peerText, /P75/);
  assert.match(peerText, /中位数/);
  assert.match(peerText, /P25/);
  assert.match(peerText, /PERCENTILE\.INC/);
  assert.match(peerText, /样本少于5家/);
  assert.ok(
    sheets[8].data.some((row) =>
      row.some(
        (cell) =>
          cell &&
          typeof cell === "object" &&
          "type" in cell &&
          (cell as { type?: unknown }).type === "Formula",
      ),
    ),
    "导出检查页应保留可重算公式",
  );

  const buffer = await writeExcelFile(sheets, {
    fontFamily: "Microsoft YaHei",
    fontSize: 10,
  }).toBuffer();
  assert.ok(buffer.byteLength > 25_000, "生成的工作簿不应为空壳");
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
});
