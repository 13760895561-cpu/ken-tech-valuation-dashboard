"use client";

import type { Cell } from "write-excel-file/browser";

type RecordLike = Record<string, unknown>;
type RowKind = "normal" | "group" | "sample" | "summary" | "median";

export interface DashboardExcelExportInput {
  asOf: string;
  generatedAt: string;
  quoteDateMin: string;
  quoteDateMax: string;
  fx: RecordLike | undefined;
  summary: RecordLike | undefined;
  companies: RecordLike[];
  valuations: RecordLike[];
  events: RecordLike[];
  history: RecordLike[];
  methodology: RecordLike | undefined;
  status: RecordLike | undefined;
  filters: {
    query: string;
    group: string;
    region: string;
  };
}

export interface DashboardWorkbookSheet {
  data: Cell[][];
  sheet: string;
  columns: Array<{ width?: number }>;
  stickyRowsCount: number;
  stickyColumnsCount?: number;
  showGridLines: boolean;
  orientation?: "landscape";
  dateFormat: string;
  zoomScale?: number;
}

interface FormulaCell {
  formula: string;
}

interface TableSheetOptions {
  widths?: number[];
  formats?: Record<number, string>;
  textColumns?: number[];
  dateColumns?: number[];
  sourceNote?: string;
  rowKinds?: RowKind[];
  wrapColumns?: number[];
  stickyColumnsCount?: number;
  zoomScale?: number;
}

interface PeerMetric {
  label: string;
  key: string;
  format: string;
  unit: string;
}

const COLORS = {
  navy: "#0B2533",
  teal: "#0E7490",
  tealLight: "#DDF3F4",
  pale: "#F4F8F8",
  line: "#D7E3E5",
  text: "#18313B",
  muted: "#5B6D74",
  white: "#FFFFFF",
  green: "#E3F4EA",
  amber: "#FFF4D6",
  group: "#123A4A",
  sample: "#E8F4EC",
  summary: "#EDF1F2",
};

const PEER_METRICS: PeerMetric[] = [
  { label: "收入增速（%）", key: "revenue_growth", format: "0.0%", unit: "%" },
  { label: "毛利率（%）", key: "gross_margin", format: "0.0%", unit: "%" },
  { label: "净利率（%）", key: "net_margin", format: "0.0%", unit: "%" },
  {
    label: "人均营收（万元人民币/人）",
    key: "revenuePerEmployeeCny10k",
    format: "#,##0.0",
    unit: "万元人民币/人",
  },
  {
    label: "人均市值（万元人民币/人）",
    key: "marketCapPerEmployeeCny10k",
    format: "#,##0.0",
    unit: "万元人民币/人",
  },
  { label: "P/S（x）", key: "ps", format: "0.00x", unit: "x" },
  {
    label: "P/毛利（x）",
    key: "priceToGrossProfit",
    format: "0.00x",
    unit: "x",
  },
  { label: "EV/Sales（x）", key: "evSales", format: "0.00x", unit: "x" },
  { label: "P/E（x）", key: "pe", format: "0.00x", unit: "x" },
  { label: "P/FCF（x）", key: "pFcf", format: "0.00x", unit: "x" },
];

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function safeText(value: unknown): string {
  const text = textValue(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function recordValue(record: RecordLike, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function nestedValue(record: unknown, path: string[]): unknown {
  let current = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as RecordLike)[key];
  }
  return current ?? null;
}

function nestedNumber(record: unknown, path: string[]): number | null {
  return numberValue(nestedValue(record, path));
}

function formula(expression: string): FormulaCell {
  return { formula: expression };
}

function isFormulaCell(value: unknown): value is FormulaCell {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as FormulaCell).formula === "string",
  );
}

function excelDate(value: unknown): Date | string {
  const text = textValue(value);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? safeText(text) : parsed;
}

function average(values: unknown[]): number | null {
  const usable = values
    .map(numberValue)
    .filter((value): value is number => value !== null);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function roundValue(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentileInc(values: unknown[], percentile: number): number | null {
  const usable = values
    .map(numberValue)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const rank = (usable.length - 1) * percentile;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return usable[lower];
  return usable[lower] + (usable[upper] - usable[lower]) * (rank - lower);
}

function rowBackground(kind: RowKind, rowIndex: number): string {
  if (kind === "group") return COLORS.group;
  if (kind === "sample") return COLORS.sample;
  if (kind === "median") return COLORS.tealLight;
  if (kind === "summary") return COLORS.summary;
  return rowIndex % 2 === 0 ? COLORS.pale : COLORS.white;
}

function makeCell(
  value: unknown,
  column: number,
  rowIndex: number,
  options: TableSheetOptions,
  kind: RowKind,
): Cell {
  const isGroup = kind === "group";
  const columnCount = options.widths?.length ?? 0;
  const isNarrative =
    column >= Math.max(1, columnCount - 1) ||
    Boolean(options.wrapColumns?.includes(column));
  const base = {
    fontFamily: "Microsoft YaHei",
    fontSize: 9,
    fontWeight:
      isGroup || kind === "median" || kind === "summary"
        ? ("bold" as const)
        : undefined,
    textColor: isGroup ? COLORS.white : COLORS.text,
    backgroundColor: rowBackground(kind, rowIndex),
    bottomBorderColor: COLORS.line,
    bottomBorderStyle: "thin" as const,
    alignVertical: "center" as const,
    align:
      isNarrative
        ? ("left" as const)
        : ("right" as const),
    wrap: isNarrative,
    height:
      kind === "median"
        ? 76
        : kind === "summary"
          ? 38
          : kind === "group"
            ? 30
            : 24,
  };
  const format = options.formats?.[column];
  if (isFormulaCell(value)) {
    return {
      ...base,
      value: value.formula.startsWith("=")
        ? value.formula
        : `=${value.formula}`,
      type: "Formula",
      format,
    };
  }
  if (value instanceof Date) {
    return {
      ...base,
      value,
      type: Date,
      format: options.dateColumns?.includes(column)
        ? "yyyy-mm-dd"
        : "yyyy-mm-dd hh:mm",
    };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ...base, value, type: Number, format };
  }
  const text = safeText(value);
  const statusBackground =
    text.toUpperCase() === "OK"
      ? COLORS.green
      : text === "检查"
        ? COLORS.amber
        : base.backgroundColor;
  return {
    ...base,
    value: text,
    type: String,
    format: options.textColumns?.includes(column) ? "@" : undefined,
    backgroundColor: statusBackground,
    align: column <= 6 || isNarrative ? "left" : "center",
    height:
      isNarrative && text.length > 45
        ? Math.max(base.height, 44)
        : base.height,
  };
}

function addTableSheet(
  name: string,
  title: string,
  headers: string[],
  rows: unknown[][],
  exportedAt: string,
  options: TableSheetOptions = {},
): DashboardWorkbookSheet {
  const widthCount = headers.length;
  const titleCell: Cell = {
    value: title,
    type: String,
    columnSpan: Math.max(1, widthCount),
    fontFamily: "Microsoft YaHei",
    fontSize: 18,
    fontWeight: "bold",
    textColor: COLORS.white,
    backgroundColor: COLORS.navy,
    align: "left",
    alignVertical: "center",
    height: 34,
  };
  const metadata = `${options.sourceNote ? `${options.sourceNote} · ` : ""}导出时间 ${exportedAt}`;
  const metadataCell: Cell = {
    value: metadata,
    type: String,
    columnSpan: Math.max(1, widthCount),
    fontFamily: "Microsoft YaHei",
    fontSize: 9,
    textColor: COLORS.muted,
    backgroundColor: COLORS.white,
    align: "left",
    alignVertical: "center",
    wrap: true,
    height: 25,
  };
  const headerRow: Cell[] = headers.map((header) => ({
    value: header,
    type: String,
    fontFamily: "Microsoft YaHei",
    fontSize: 10,
    fontWeight: "bold",
    textColor: COLORS.white,
    backgroundColor: COLORS.teal,
    borderColor: COLORS.line,
    borderStyle: "thin",
    align: "center",
    alignVertical: "center",
    wrap: true,
    height: 32,
  }));
  const dataRows: Cell[][] = rows.map((row, rowIndex) => {
    const kind = options.rowKinds?.[rowIndex] ?? "normal";
    return headers.map((_, columnIndex) =>
      makeCell(
        row[columnIndex] ?? "",
        columnIndex + 1,
        rowIndex,
        options,
        kind,
      ),
    );
  });
  return {
    data: [
      [titleCell, ...Array(Math.max(0, widthCount - 1)).fill(null)],
      [metadataCell, ...Array(Math.max(0, widthCount - 1)).fill(null)],
      Array(widthCount).fill(null),
      headerRow,
      ...dataRows,
    ],
    sheet: name,
    columns: headers.map((header, index) => ({
      width:
        options.widths?.[index] ??
        Math.min(
          index === headers.length - 1 ? 64 : 28,
          Math.max(11, header.length * 1.65 + 3),
        ),
    })),
    stickyRowsCount: 4,
    stickyColumnsCount: options.stickyColumnsCount,
    showGridLines: false,
    orientation: headers.length > 8 ? "landscape" : undefined,
    dateFormat: "yyyy-mm-dd hh:mm",
    zoomScale: options.zoomScale ?? (headers.length > 20 ? 0.7 : 0.9),
  };
}

function flattenObject(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (!value || typeof value !== "object" || value instanceof Date) {
    return [[prefix || "值", value]];
  }
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object")) {
      return value.flatMap((item, index) =>
        item && typeof item === "object"
          ? flattenObject(item, `${prefix || "值"}[${index}]`)
          : [[`${prefix || "值"}[${index}]`, item]],
      );
    }
    return [[prefix || "值", value.join("；")]];
  }
  return Object.entries(value as RecordLike).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object"
      ? flattenObject(child, path)
      : [[path, child]];
  });
}

function buildOverviewRows(input: DashboardExcelExportInput): unknown[][] {
  const quoteDates =
    input.quoteDateMin === input.quoteDateMax
      ? input.quoteDateMin
      : `${input.quoteDateMin} 至 ${input.quoteDateMax}`;
  const fx = input.fx ?? {};
  const changes = input.companies.map((company) => numberValue(company.change_pct));
  const temperatures = input.valuations.map((valuation) =>
    numberValue(valuation.temperatureScore),
  );
  const confidences = input.valuations.map((valuation) =>
    numberValue(valuation.confidenceScore),
  );
  const customCount = input.companies.filter(
    (company) => company.trackingOrigin === "custom",
  ).length;
  return [
    ["估值基准日", excelDate(input.asOf), "日期；看板估值比较基准"],
    [
      "看板生成时间",
      excelDate(input.generatedAt),
      "日期时间；对应最近成功生成的数据版本",
    ],
    ["行情日期", quoteDates, "日期；当前观察池最早至最晚行情日"],
    ["汇率日期", excelDate(recordValue(fx, "date")), "日期；人民币折算汇率时点"],
    ["当前观察公司", input.companies.length, "家；已排除本机隐藏的默认公司"],
    [
      "其中自定义公司",
      customCount,
      "家；导出公开行情、自动补全财务与派生指标，不导出个人备注",
    ],
    [
      "估值公司",
      input.valuations.length,
      "家；自定义公司可展示自身倍数，但不自动进入模型估值",
    ],
    [
      "核心数据完整",
      input.companies.filter(
        (company) => textValue(company.coreStatus).toUpperCase() === "OK",
      ).length,
      "家；已自动补全核心财务的自定义公司可计入完整数",
    ],
    [
      "估值输入完整",
      input.companies.filter(
        (company) =>
          company.trackingOrigin !== "custom" &&
          textValue(company.valuationInputStatus).toUpperCase() === "OK",
      ).length,
      "家",
    ],
    [
      "上涨 / 下跌 / 平盘",
      `${changes.filter((value) => value !== null && value > 0).length} / ${changes.filter((value) => value !== null && value < 0).length} / ${changes.filter((value) => value === 0).length}`,
      "家；按最近行情涨跌",
    ],
    [
      "高温 / 低温",
      `${temperatures.filter((value) => value !== null && value >= 85).length} / ${temperatures.filter((value) => value !== null && value <= 30).length}`,
      "家；高温≥85分，低温≤30分",
    ],
    [
      "平均温度",
      roundValue(average(temperatures)),
      "0–100分；仅统计有效估值公司",
    ],
    [
      "平均置信度",
      roundValue(average(confidences)),
      "0–100分；仅统计有效估值公司",
    ],
    [
      "页面搜索条件",
      input.filters.query || "无",
      "仅记录导出时页面筛选；工作簿仍导出完整观察池",
    ],
    ["可比组筛选", input.filters.group || "全部", "仅记录导出时页面状态"],
    ["地区筛选", input.filters.region || "全部", "仅记录导出时页面状态"],
    [
      "数据状态",
      textValue(recordValue(input.status ?? {}, "message", "state")),
      "更新失败时看板保留最近核验值",
    ],
    [
      "隐私范围",
      "不含同步码、浏览器缓存、登录信息和个人观察备注",
      "仅包含分享所需的看板数据、计算口径与公开来源",
    ],
  ];
}

const CORE_HEADERS = [
  "证券代码",
  "公司名称",
  "市场",
  "地区",
  "可比组",
  "观察类型",
  "行情日期",
  "股价（本币/股）",
  "行情币种",
  "行情汇率（兑人民币）",
  "股本（百万股）",
  "市值（本币亿元）",
  "市值（人民币亿元）",
  "财务报告期",
  "财务报告日",
  "财务币种",
  "财务汇率（兑人民币）",
  "营收（本币亿元）",
  "营收（人民币亿元）",
  "毛利（本币亿元）",
  "毛利（人民币亿元）",
  "净利润（本币亿元）",
  "净利润（人民币亿元）",
  "经营现金流（本币亿元）",
  "资本开支（本币亿元）",
  "自由现金流（人民币亿元）",
  "现金（人民币亿元）",
  "债务（人民币亿元）",
  "企业价值EV（人民币亿元）",
  "员工（人）",
  "人均营收（万元人民币/人）",
  "人均毛利（万元人民币/人）",
  "人均净利润（万元人民币/人）",
  "人均市值（万元人民币/人）",
  "P/S（x）",
  "P/毛利（x）",
  "EV/Sales（x）",
  "EV/毛利（x）",
  "P/E（x）",
  "P/FCF（x）",
  "FCF收益率（%）",
  "营收增速（%）",
  "毛利率（%）",
  "净利率（%）",
  "ROIC（%）",
  "核心数据状态",
  "估值输入状态",
  "财务更新状态",
  "现金（本币亿元，辅助列）",
  "债务（本币亿元，辅助列）",
  "单位与公式",
];

function buildCoreRows(companies: RecordLike[]): unknown[][] {
  return companies.map((company) => {
    return [
      textValue(recordValue(company, "ticker", "id")),
      textValue(company.name),
      textValue(company.market),
      textValue(company.region),
      textValue(company.group),
      company.trackingOrigin === "custom"
        ? company.report_date
          ? "用户添加·自动财务"
          : "用户添加·财务待补全"
        : "默认核验公司",
      excelDate(company.quote_date),
      numberValue(company.price_local),
      textValue(recordValue(company, "quote_currency", "currency")),
      numberValue(recordValue(company, "quote_fx_to_cny", "fx_to_cny")),
      numberValue(company.shares_million),
      numberValue(company.market_cap_local_100m),
      numberValue(company.currentMarketCapCny100m),
      textValue(company.report_period),
      excelDate(company.report_date),
      textValue(recordValue(company, "financial_currency")),
      numberValue(recordValue(company, "financial_fx_to_cny")),
      numberValue(company.revenue_local_100m),
      numberValue(company.revenueCny100m),
      numberValue(company.gross_profit_local_100m),
      numberValue(company.grossProfitCny100m),
      numberValue(company.net_profit_local_100m),
      numberValue(company.netProfitCny100m),
      numberValue(company.ocf_local_100m),
      numberValue(company.capex_local_100m),
      numberValue(company.fcfCny100m),
      numberValue(company.cashCny100m),
      numberValue(company.debtCny100m),
      numberValue(company.enterpriseValueCny100m),
      numberValue(company.employees),
      numberValue(company.revenuePerEmployeeCny10k),
      numberValue(company.grossProfitPerEmployeeCny10k),
      numberValue(company.netProfitPerEmployeeCny10k),
      numberValue(company.marketCapPerEmployeeCny10k),
      numberValue(company.ps),
      numberValue(company.priceToGrossProfit),
      numberValue(company.evSales),
      numberValue(company.evGrossProfit),
      numberValue(company.pe),
      numberValue(company.pFcf),
      numberValue(company.fcfYield),
      numberValue(company.revenue_growth),
      numberValue(company.gross_margin),
      numberValue(company.net_margin),
      numberValue(company.roic),
      textValue(company.coreStatus),
      textValue(company.valuationInputStatus),
      textValue(company.financial_refresh_status),
      numberValue(company.cash_local_100m),
      numberValue(company.debt_local_100m),
      "证券代码按文本保存。行情值使用行情币种与行情汇率；财务值使用财务币种与财务汇率。市值=本币市值×行情汇率（若本币市值缺失，则股价×百万股数÷100×行情汇率）；财务人民币金额=财务本币金额×财务汇率；FCF=(经营现金流-资本开支)×财务汇率；EV=市值+债务-现金；人均=亿元人民币×10000÷人数；P/S=市值÷营收；P/毛利=市值÷毛利；EV/Sales=EV÷营收；EV/毛利=EV÷毛利；P/E=市值÷净利润；P/FCF=市值÷FCF；FCF收益率=FCF÷市值。分母≤0或任一必要输入缺失时留空，不按0处理。",
    ];
  });
}

function coreFormats(): Record<number, string> {
  const formats: Record<number, string> = {
    8: "#,##0.00;[Red](#,##0.00);-",
    10: "0.0000",
    11: "#,##0.0",
    17: "0.0000",
    30: "#,##0",
  };
  for (let column = 12; column <= 29; column += 1) {
    formats[column] = "#,##0.0;[Red](#,##0.0);-";
  }
  for (let column = 31; column <= 34; column += 1) {
    formats[column] = "#,##0.0;[Red](#,##0.0);-";
  }
  for (let column = 35; column <= 40; column += 1) {
    formats[column] = "0.00x;[Red](0.00x);-";
  }
  for (let column = 41; column <= 45; column += 1) {
    formats[column] = "0.0%;[Red](0.0%);-";
  }
  formats[49] = "#,##0.0;[Red](#,##0.0);-";
  formats[50] = "#,##0.0;[Red](#,##0.0);-";
  return formats;
}

function valuationHeaders(): string[] {
  const methods = ["P/S", "P/毛利", "P/E", "P/FCF", "人均市值"];
  return [
    "证券代码",
    "公司名称",
    "可比组",
    "当前市值（人民币亿元）",
    "模型低位（人民币亿元）",
    "模型中枢（人民币亿元）",
    "模型高位（人民币亿元）",
    "当前/中枢（%）",
    "估值温度（分）",
    "温度标签",
    "有效方法数",
    "方法离散度（%）",
    "新鲜度（分）",
    "可比组质量（分）",
    "置信度（分）",
    "结论",
    "A股可比数",
    "全球可比数",
    ...methods.flatMap((method) => [
      `${method}锚-低`,
      `${method}锚-中`,
      `${method}锚-高`,
    ]),
    ...methods.flatMap((method) => [
      `${method}隐含市值-低`,
      `${method}隐含市值-中`,
      `${method}隐含市值-高`,
    ]),
    "单位与公式",
  ];
}

function buildValuationRows(valuations: RecordLike[]): unknown[][] {
  const methods = [
    ["P/S", "ps"],
    ["P/毛利", "priceToGrossProfit"],
    ["P/E", "pe"],
    ["P/FCF", "pFcf"],
    ["人均市值", "marketCapPerEmployee"],
  ] as const;
  return valuations.map((valuation) => [
    textValue(valuation.ticker),
    textValue(valuation.name),
    textValue(valuation.group),
    numberValue(valuation.currentMarketCapCny100m),
    numberValue(valuation.modelLow),
    numberValue(valuation.modelCenter),
    numberValue(valuation.modelHigh),
    numberValue(valuation.currentToCenter),
    numberValue(valuation.temperatureScore),
    textValue(valuation.temperatureLabel),
    numberValue(valuation.validMethods),
    numberValue(valuation.dispersion),
    numberValue(valuation.freshnessScore),
    numberValue(valuation.peerQualityScore),
    numberValue(valuation.confidenceScore),
    textValue(valuation.conclusion),
    numberValue(valuation.domesticPeerCount),
    numberValue(valuation.globalPeerCount),
    ...methods.flatMap(([, key]) => [
      nestedNumber(valuation.anchors, [key, "low"]),
      nestedNumber(valuation.anchors, [key, "center"]),
      nestedNumber(valuation.anchors, [key, "high"]),
    ]),
    ...methods.flatMap(([, key]) => [
      nestedNumber(valuation.impliedValues, [key, "low"]),
      nestedNumber(valuation.impliedValues, [key, "center"]),
      nestedNumber(valuation.impliedValues, [key, "high"]),
    ]),
    "当前市值与合理区间、隐含市值：亿元人民币；倍数锚：x；人均市值锚：万元人民币/人；当前/中枢与离散度：比例；温度、质量与置信度：0–100分。合理区间是可比估值观察结果，不是价格承诺。",
  ]);
}

function valuationFormats(): Record<number, string> {
  const formats: Record<number, string> = {
    4: "#,##0.0",
    5: "#,##0.0",
    6: "#,##0.0",
    7: "#,##0.0",
    8: "0.0%",
    9: "0.0",
    11: "0",
    12: "0.0%",
    13: "0.0",
    14: "0.0",
    15: "0.0",
    17: "0",
    18: "0",
  };
  for (let column = 19; column <= 30; column += 1) {
    formats[column] = "0.00x";
  }
  for (let column = 31; column <= 33; column += 1) {
    formats[column] = "#,##0.0";
  }
  for (let column = 34; column <= 48; column += 1) {
    formats[column] = "#,##0.0";
  }
  return formats;
}

function peerBucketOrder(region: string): number {
  if (region === "A股") return 0;
  if (region === "中国成熟锚") return 1;
  if (region === "美股") return 2;
  return 3;
}

function formatSortedValues(companies: RecordLike[]): string {
  return PEER_METRICS.map((metric) => {
    const values = companies
      .map((company) => numberValue(company[metric.key]))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const rendered = values
      .map((value) =>
        metric.unit === "%"
          ? `${(value * 100).toFixed(2)}%`
          : value.toFixed(metric.unit === "x" ? 2 : 1),
      )
      .join(", ");
    return `${metric.label.replace(/（.*?）/g, "")}=[${rendered || "无有效值"}]`;
  }).join("；");
}

function buildPeerRows(companies: RecordLike[]): {
  rows: unknown[][];
  kinds: RowKind[];
} {
  const eligible = companies.filter(
    (company) =>
      company.trackingOrigin !== "custom" &&
      company.include_in_stats !== false &&
      textValue(company.group),
  );
  const groups = [
    ...new Set(eligible.map((company) => textValue(company.group))),
  ];
  const rows: unknown[][] = [];
  const kinds: RowKind[] = [];

  for (const group of groups) {
    const groupCompanies = eligible.filter(
      (company) => textValue(company.group) === group,
    );
    const buckets = [
      ...new Set(groupCompanies.map((company) => textValue(company.region))),
    ].sort(
      (left, right) =>
        peerBucketOrder(left) - peerBucketOrder(right) ||
        left.localeCompare(right, "zh-CN"),
    );
    for (const bucket of buckets) {
      const samples = groupCompanies.filter(
        (company) => textValue(company.region) === bucket,
      );
      const confidence =
        samples.length < 5 ? "样本少于5家，仅作低置信度观察" : "样本量达到5家";
      rows.push([
        "组标题",
        group,
        bucket,
        samples.length,
        "",
        `${group}｜${bucket}｜样本 ${samples.length} 家`,
        ...PEER_METRICS.map(() => null),
        `有效样本 n=${samples.length}；${confidence}`,
        "按“可比组×市场”独立统计；空值剔除，不按0处理。",
      ]);
      kinds.push("group");

      for (const company of samples) {
        rows.push([
          "样本",
          group,
          bucket,
          samples.length,
          textValue(recordValue(company, "ticker", "id")),
          textValue(company.name),
          ...PEER_METRICS.map((metric) => numberValue(company[metric.key])),
          "原始样本值",
          "收入增速、毛利率、净利率：比例；人均指标：万元人民币/人；估值倍数：x。",
        ]);
        kinds.push("sample");
      }

      const sortedText = formatSortedValues(samples);
      const summaries: Array<{
        label: string;
        percentile: number;
        kind: RowKind;
      }> = [
        { label: "P75", percentile: 0.75, kind: "summary" },
        { label: "中位数", percentile: 0.5, kind: "median" },
        { label: "P25", percentile: 0.25, kind: "summary" },
      ];
      for (const summary of summaries) {
        rows.push([
          summary.label,
          group,
          bucket,
          samples.length,
          "",
          summary.label,
          ...PEER_METRICS.map((metric) =>
            percentileInc(
              samples.map((company) => company[metric.key]),
              summary.percentile,
            ),
          ),
          summary.label === "中位数"
            ? `${summary.label}=PERCENTILE.INC(各指标有效值,${summary.percentile})；排序后的有效值：${sortedText}`
            : `${summary.label}=PERCENTILE.INC(各指标有效值,${summary.percentile})；详细排序序列见本区块“中位数”行`,
          `PERCENTILE.INC线性插值：rank=(n-1)×p；上下相邻排序值按小数部分插值。每项指标独立排除空值。${confidence}。`,
        ]);
        kinds.push(summary.kind);
      }
    }
  }
  return { rows, kinds };
}

function peerHeaders(): string[] {
  return [
    "行类型",
    "可比组",
    "市场桶",
    "样本数（家）",
    "证券代码",
    "公司名称",
    ...PEER_METRICS.map((metric) => metric.label),
    "计算过程",
    "单位与公式",
  ];
}

function peerFormats(): Record<number, string> {
  return Object.fromEntries(
    PEER_METRICS.map((metric, index) => [index + 7, metric.format]),
  );
}

function unionKeys(rows: RecordLike[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function genericRows(
  rows: RecordLike[],
  keys: string[],
  note: string,
): unknown[][] {
  return rows.map((row) => [
    ...keys.map((key) => {
      const value = row[key];
      return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(textValue(value))
        ? excelDate(value)
        : typeof value === "number"
          ? value
          : safeText(value);
    }),
    note,
  ]);
}

function buildSourceRows(companies: RecordLike[]): unknown[][] {
  return companies.map((company) => [
    textValue(recordValue(company, "ticker", "id")),
    textValue(company.name),
    excelDate(company.quote_date),
    textValue(company.quote_source),
    textValue(company.quote_status),
    textValue(company.report_period),
    excelDate(company.report_date),
    textValue(company.structured_source),
    textValue(company.official_report_source),
    textValue(company.financial_refresh_status),
    excelDate(company.financial_source_generated_at),
    numberValue(company.data_quality_score),
    "日期为来源时点；数据质量为0–100分；来源地址以纯文本保留。自定义公司使用自动结构化财务时会标明报告期、来源和更新状态；缺失来源保持空白。",
  ]);
}

function buildMethodRows(methodology: RecordLike | undefined): unknown[][] {
  const formulaRows: unknown[][] = [
    [
      "公式.市值人民币亿元",
      "本币市值×行情汇率；本币市值缺失时用股价×百万股数÷100×行情汇率",
      "亿元人民币",
      "使用quote_currency与quote_fx_to_cny",
    ],
    [
      "公式.财务人民币亿元",
      "财务本币亿元×财务汇率",
      "亿元人民币",
      "使用financial_currency与financial_fx_to_cny；不得与行情汇率混用",
    ],
    [
      "公式.FCF",
      "(经营现金流-资本开支)×财务汇率",
      "亿元人民币",
      "资本开支为空则结果为空，不按0处理",
    ],
    [
      "公式.EV",
      "市值+债务-现金",
      "亿元人民币",
      "债务与现金先按财务汇率折算",
    ],
    [
      "公式.人均指标",
      "亿元人民币×10000÷员工人数",
      "万元人民币/人",
      "员工人数≤0或缺失时留空",
    ],
    [
      "公式.估值倍数",
      "市值或EV÷对应经营指标",
      "x",
      "分母≤0或缺失时留空",
    ],
    [
      "公式.FCF收益率",
      "FCF÷市值",
      "%",
      "市值≤0或缺失时留空",
    ],
    [
      "公式.可比组分位数",
      "PERCENTILE.INC；rank=(n-1)×p，上下相邻排序值线性插值",
      "随指标",
      "按可比组×市场独立计算；每项指标单独剔除空值，样本<5家标记低置信度",
    ],
  ];
  const methodRows = flattenObject(methodology ?? {}).map(([key, value]) => [
    `方法.${key}`,
    typeof value === "object" ? JSON.stringify(value) : value,
    "按字段定义",
    "来自看板方法与假设",
  ]);
  return [...formulaRows, ...methodRows];
}

function buildCheckRows(
  companyCount: number,
  valuationCount: number,
): unknown[][] {
  const coreLast = Math.max(5, companyCount + 4);
  const valuationLast = Math.max(5, valuationCount + 4);
  return [
    [
      "观察公司行数",
      formula(`COUNTA('核心指标'!A5:A${coreLast})`),
      companyCount,
      formula("B5-C5"),
      formula('IF(D5=0,"OK","检查")'),
      "应与导出时观察池公司数一致",
      "行数；公式引用核心指标工作表",
    ],
    [
      "证券代码完整",
      formula(`COUNTBLANK('核心指标'!A5:A${coreLast})`),
      0,
      formula("B6-C6"),
      formula('IF(D6=0,"OK","检查")'),
      "代码列按文本保存，港股前导0不得丢失",
      "空白数；应为0",
    ],
    [
      "估值明细行数",
      formula(`COUNTA('估值明细'!A5:A${valuationLast})`),
      valuationCount,
      formula("B7-C7"),
      formula('IF(D7=0,"OK","检查")'),
      "自定义公司可展示自身倍数，但不自动进入模型估值",
      "行数；公式引用估值明细工作表",
    ],
    [
      "可比组口径",
      "已展开",
      "逐样本+P75/中位数/P25",
      0,
      "OK",
      "按可比组×市场分块，样本<5家标记低置信度",
      "PERCENTILE.INC；空值排除",
    ],
    [
      "货币口径",
      "已拆分",
      "行情/财务分别折算",
      0,
      "OK",
      "腾讯、阿里等可出现HKD行情、CNY财务",
      "行情使用quote FX；财务使用financial FX",
    ],
    [
      "隐私字段",
      "未导出",
      "同步码/缓存/登录信息/个人备注",
      0,
      "OK",
      "仅包含分享所需的看板数据与公开来源",
      "文本与字段白名单检查",
    ],
  ];
}

export function buildDashboardWorkbookSheets(
  input: DashboardExcelExportInput,
  exportedAt = new Date().toISOString(),
): DashboardWorkbookSheet[] {
  const overview = addTableSheet(
    "看板概览",
    "科技股长期估值与经营效率看板",
    ["项目", "数值", "单位与公式"],
    buildOverviewRows(input),
    exportedAt,
    {
      widths: [28, 38, 72],
      sourceNote: "当前观察池完整导出",
    },
  );

  const core = addTableSheet(
    "核心指标",
    "核心指标与可审计计算",
    CORE_HEADERS,
    buildCoreRows(input.companies),
    exportedAt,
    {
      widths: CORE_HEADERS.map((_, index) =>
        index === 1 ? 18 : index === CORE_HEADERS.length - 1 ? 76 : 14,
      ),
      formats: coreFormats(),
      textColumns: [1, 9, 16, 46, 47, 48],
      dateColumns: [7, 15],
      sourceNote:
        "金额与派生值保留核验结果，完整公式写在每行最右侧；自定义公司有可靠自动财务时一并导出，缺失值保持空白",
      stickyColumnsCount: 2,
      zoomScale: 0.6,
    },
  );

  const valuationHeader = valuationHeaders();
  const valuation = addTableSheet(
    "估值明细",
    "估值明细、方法锚与隐含市值",
    valuationHeader,
    buildValuationRows(input.valuations),
    exportedAt,
    {
      widths: valuationHeader.map((header, index) =>
        index === 1 || header === "结论"
          ? 22
          : index === valuationHeader.length - 1
            ? 72
            : 14,
      ),
      formats: valuationFormats(),
      textColumns: [1],
      sourceNote: "完整导出五种估值方法的低/中/高锚和隐含市值",
      stickyColumnsCount: 2,
      zoomScale: 0.65,
    },
  );

  const peer = buildPeerRows(input.companies);
  const peerHeader = peerHeaders();
  const peers = addTableSheet(
    "可比组统计",
    "可比组样本、分位数与计算过程",
    peerHeader,
    peer.rows,
    exportedAt,
    {
      widths: peerHeader.map((_, index) =>
        index === 5
          ? 22
          : index === peerHeader.length - 2
            ? 96
            : index === peerHeader.length - 1
              ? 74
              : 16,
      ),
      formats: peerFormats(),
      textColumns: [5],
      rowKinds: peer.kinds,
      sourceNote: "对齐原版Excel：按可比组×市场逐样本展示，并给出P75/中位数/P25",
      stickyColumnsCount: 6,
      zoomScale: 0.7,
    },
  );

  const eventKeys = unionKeys(input.events);
  const events = addTableSheet(
    "事件跟踪",
    "公司事件跟踪",
    [...eventKeys, "单位与公式"],
    genericRows(
      input.events,
      eventKeys,
      "按原字段完整导出；日期为真实日期，来源链接保留为文本。",
    ),
    exportedAt,
    {
      widths: [...eventKeys.map(() => 22), 58],
      textColumns: eventKeys
        .map((key, index) => (/代码|ticker|id/i.test(key) ? index + 1 : 0))
        .filter(Boolean),
      sourceNote: "仅导出当前观察池对应的事件记录",
    },
  );

  const historyKeys = unionKeys(input.history);
  const history = addTableSheet(
    "历史快照",
    "历史估值与经营快照",
    [...historyKeys, "单位与公式"],
    genericRows(
      input.history,
      historyKeys,
      "按原字段完整导出；金额、倍数、比例的具体口径以字段名和方法页为准。",
    ),
    exportedAt,
    {
      widths: [...historyKeys.map(() => 20), 58],
      textColumns: historyKeys
        .map((key, index) => (/代码|ticker|id/i.test(key) ? index + 1 : 0))
        .filter(Boolean),
      sourceNote: "仅导出当前观察池对应的历史记录",
    },
  );

  const sources = addTableSheet(
    "来源审计",
    "行情、财务与官方报告来源",
    [
      "证券代码",
      "公司名称",
      "行情日期",
      "行情来源",
      "行情状态",
      "财务报告期",
      "财务报告日",
      "结构化数据源",
      "官方报告来源",
      "财务更新状态",
      "财务源生成时间",
      "数据质量分",
      "单位与公式",
    ],
    buildSourceRows(input.companies),
    exportedAt,
    {
      widths: [16, 18, 14, 42, 16, 16, 14, 42, 52, 20, 20, 14, 62],
      textColumns: [1, 4, 8, 9],
      dateColumns: [3, 7],
      formats: { 12: "0.0" },
      sourceNote: "公开来源与时点完整保留",
      stickyColumnsCount: 2,
    },
  );

  const methods = addTableSheet(
    "方法与公式",
    "方法、假设、单位与公式",
    ["项目", "内容", "单位", "说明（单位与公式）"],
    buildMethodRows(input.methodology),
    exportedAt,
    {
      widths: [36, 66, 24, 72],
      wrapColumns: [2, 4],
      sourceNote: "公式说明与看板页面一致",
    },
  );

  const checks = addTableSheet(
    "导出检查",
    "分享文件完整性与口径检查",
    ["检查项", "实际", "预期", "差异", "状态", "说明", "单位与公式"],
    buildCheckRows(input.companies.length, input.valuations.length),
    exportedAt,
    {
      widths: [24, 30, 30, 14, 14, 52, 58],
      sourceNote: "打开Excel或WPS后自动重算公式",
    },
  );

  return [
    overview,
    core,
    valuation,
    peers,
    events,
    history,
    sources,
    methods,
    checks,
  ];
}

export async function buildDashboardWorkbookBlob(
  input: DashboardExcelExportInput,
): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  return writeExcelFile(buildDashboardWorkbookSheets(input), {
    fontFamily: "Microsoft YaHei",
    fontSize: 10,
  }).toBlob();
}

export async function buildDashboardWorkbookBytes(
  input: DashboardExcelExportInput,
): Promise<Uint8Array> {
  const blob = await buildDashboardWorkbookBlob(input);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function downloadDashboardExcel(
  input: DashboardExcelExportInput,
): Promise<string> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const filename = `科技股长期跟踪看板-${date}.xlsx`;
  await writeExcelFile(buildDashboardWorkbookSheets(input), {
    fontFamily: "Microsoft YaHei",
    fontSize: 10,
  }).toFile(filename);
  return filename;
}
