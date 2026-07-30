import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchCustomFinancial,
  fetchCustomFinancials,
  normalizeFinancialSecurity,
  type CustomFinancialRequest,
} from "../lib/custom-financials";

type MockHandler = (url: URL, init?: RequestInit) => unknown | Promise<unknown>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function rows(data: unknown[]): unknown {
  return { success: true, result: { data } };
}

function mockFetch(handler: MockHandler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    return jsonResponse(await handler(url, init));
  }) as typeof fetch;
}

function reportName(url: URL): string {
  return url.searchParams.get("reportName") ?? url.searchParams.get("type") ?? "";
}

const fixedNow = () => new Date("2026-07-30T08:00:00.000Z");

test("normalizes only supported securities and never accepts an arbitrary URL", () => {
  assert.deepEqual(
    normalizeFinancialSecurity({ market: "A", ticker: "300308.SZ" }),
    {
      market: "A",
      securityCode: "300308.SZ",
      eastmoneyCode: "300308.SZ",
      structuredSource:
        "https://emweb.securities.eastmoney.com/pc_hsf10/pages/index.html?type=web&code=SZ300308#/cwfx",
    },
  );
  assert.equal(
    normalizeFinancialSecurity({ market: "HK", ticker: "700" }).securityCode,
    "00700.HK",
  );
  assert.equal(
    normalizeFinancialSecurity({ market: "US", ticker: "nvda" }).securityCode,
    "NVDA",
  );
  assert.throws(
    () =>
      normalizeFinancialSecurity({
        market: "US",
        ticker: "https://example.com/",
      }),
    /仅支持/,
  );
  assert.throws(
    () =>
      normalizeFinancialSecurity({
        market: "A",
        ticker: '300308") OR (1=1',
      }),
    /6位数字/,
  );
});

test("A-share fetch selects the latest annual report and converts amounts and percentages", async () => {
  const called: string[] = [];
  const fetch = mockFetch((url) => {
    called.push(url.toString());
    const name = reportName(url);
    assert.equal(url.origin, "https://datacenter.eastmoney.com");
    if (name === "RPT_F10_FINANCE_MAINFINADATA") {
      return rows([
        {
          REPORT_DATE: "2026-03-31 00:00:00",
          REPORT_TYPE: "一季报",
          TOTALOPERATEREVE: 999,
        },
        {
          REPORT_DATE: "2025-12-31 00:00:00",
          REPORT_TYPE: "年报",
          REPORT_DATE_NAME: "2025年报",
          NOTICE_DATE: "2026-03-31 00:00:00",
          CURRENCY: "CNY",
          TOTALOPERATEREVE: 38_240_000_000,
          MLR: 16_074_000_000,
          PARENTNETPROFIT: 10_000_000_000,
          TOTALOPERATEREVETZ: 60.25,
          XSMLL: 42.04,
          XSJLL: 26.15,
          ROIC: 19.5,
          STAFF_NUM: 11_625,
        },
      ]);
    }
    if (name === "RPT_F10_FINANCE_GBALANCE") {
      assert.match(url.searchParams.get("filter") ?? "", /2025-12-31/);
      return rows([
        {
          REPORT_DATE: "2025-12-31 00:00:00",
          MONETARYFUNDS: 12_000_000_000,
          SHORT_LOAN: 1_000_000_000,
          LONG_LOAN: 2_000_000_000,
          BOND_PAYABLE: 3_000_000_000,
          LEASE_LIAB: 500_000_000,
        },
      ]);
    }
    if (name === "RPT_F10_FINANCE_GCASHFLOW") {
      return rows([
        {
          REPORT_DATE: "2025-12-31 00:00:00",
          NETCASH_OPERATE: 10_896_000_000,
          CONSTRUCT_LONG_ASSET: -2_760_000_000,
        },
      ]);
    }
    throw new Error(`unexpected ${name}`);
  });

  const result = await fetchCustomFinancial(
    { market: "A", ticker: "300308.SZ" },
    { fetch, retries: 0, now: fixedNow },
  );

  assert.equal(result.status, "fresh");
  assert.equal(result.reportDate, "2025-12-31");
  assert.equal(result.financialCurrency, "CNY");
  assert.equal(result.revenueLocal100m, 382.4);
  assert.equal(result.grossProfitLocal100m, 160.74);
  assert.equal(result.netProfitLocal100m, 100);
  assert.equal(result.ocfLocal100m, 108.96);
  assert.equal(result.capexLocal100m, 27.6);
  assert.equal(result.cashLocal100m, 120);
  assert.equal(result.debtLocal100m, 65);
  assert.equal(result.employees, 11_625);
  assert.equal(result.revenueGrowth, 0.6025);
  assert.equal(result.grossMargin, 0.4204);
  assert.equal(result.netMargin, 0.2615);
  assert.equal(result.roic, 0.195);
  assert.equal(result.dataQualityScore, 100);
  assert.equal(called.length, 3);
});

test("HK fetch uses report-summary currency and sums cash, debt and capex line items", async () => {
  const fetch = mockFetch((url) => {
    const name = reportName(url);
    if (name === "RPT_HKF10_FN_MAININDICATOR") {
      return rows([
        {
          REPORT_DATE: "2025-12-31 00:00:00",
          DATE_TYPE_CODE: "001",
          CURRENCY: "HKD",
          OPERATE_INCOME: 751_766_000_000,
          GROSS_PROFIT: 422_593_000_000,
          HOLDER_PROFIT: 224_842_000_000,
          OPERATE_INCOME_YOY: 13.86,
          GROSS_PROFIT_RATIO: 56.21,
          NET_PROFIT_RATIO: 30.57,
          ROIC_YEARLY: 15.25,
        },
      ]);
    }
    if (name === "RPT_HKF10_INFO_ORGPROFILE") {
      return rows([{ EMP_NUM: 87_412 }]);
    }
    if (name === "RPT_CUSTOM_HKSK_APPFN_CASHFLOW_SUMMARY") {
      return rows([
        {
          REPORT_LIST: [
            {
              REPORT_DATE: "2026-03-31 00:00:00",
              REPORT_TYPE: "一季报",
              CURRENCY: "人民币",
            },
            {
              REPORT_DATE: "2025-12-31 00:00:00",
              REPORT_TYPE: "年报",
              CURRENCY: "人民币",
            },
          ],
        },
      ]);
    }
    if (name === "RPT_HKF10_FN_BALANCE_PC") {
      assert.equal(
        url.searchParams.get("filter"),
        `(SECUCODE="00700.HK")(REPORT_DATE in ('2025-12-31 00:00:00'))`,
      );
      return rows([
        { STD_ITEM_NAME: "现金及等价物", AMOUNT: 141_041_000_000 },
        { STD_ITEM_NAME: "短期存款", AMOUNT: 236_801_000_000 },
        { STD_ITEM_NAME: "短期贷款", AMOUNT: 42_618_000_000 },
        { STD_ITEM_NAME: "长期贷款", AMOUNT: 208_369_000_000 },
        { STD_ITEM_NAME: "融资租赁负债(流动)", AMOUNT: 5_386_000_000 },
        {
          STD_ITEM_NAME: "融资租赁负债(非流动)",
          AMOUNT: 13_280_000_000,
        },
      ]);
    }
    if (name === "RPT_HKF10_FN_CASHFLOW_PC") {
      assert.equal(
        url.searchParams.get("filter"),
        `(SECUCODE="00700.HK")(REPORT_DATE in ('2025-12-31 00:00:00'))`,
      );
      return rows([
        { STD_ITEM_NAME: "经营业务现金净额", AMOUNT: 303_052_000_000 },
        { STD_ITEM_NAME: "购建固定资产", AMOUNT: 87_482_000_000 },
        {
          STD_ITEM_NAME: "购建无形资产及其他资产",
          AMOUNT: 25_393_000_000,
        },
      ]);
    }
    throw new Error(`unexpected ${name}`);
  });

  const result = await fetchCustomFinancial(
    { market: "HK", ticker: "00700.HK" },
    { fetch, retries: 0, now: fixedNow },
  );

  assert.equal(result.status, "fresh");
  assert.equal(result.financialCurrency, "CNY");
  assert.equal(result.reportDate, "2025-12-31");
  assert.equal(result.revenueLocal100m, 7_517.66);
  assert.equal(result.ocfLocal100m, 3_030.52);
  assert.equal(result.capexLocal100m, 1_128.75);
  assert.equal(result.cashLocal100m, 3_778.42);
  assert.equal(result.debtLocal100m, 2_696.53);
  assert.equal(result.employees, 87_412);
  assert.equal(result.grossMargin, 0.5621);
  assert.equal(result.sources.length, 5);
});

test("US fetch resolves Eastmoney market code and uses FY statement rows", async () => {
  const fetch = mockFetch((url) => {
    const name = reportName(url);
    if (name === "RPT_USF10_INFO_ORGPROFILE") {
      assert.match(url.searchParams.get("filter") ?? "", /NVDA/);
      return rows([{ SECUCODE: "NVDA.O", EMP_NUM: 42_000 }]);
    }
    if (name === "RPT_USF10_FN_GMAININDICATOR") {
      return rows([
        {
          REPORT_DATE: "2026-01-25 00:00:00",
          NOTICE_DATE: "2026-02-25 00:00:00",
          DATE_TYPE_CODE: "001",
          REPORT_TYPE: "2025/FY",
          REPORT_DATA_TYPE: "2025年 年报",
          CURRENCY: "美元",
          CURRENCY_ABBR: "USD",
          OPERATE_INCOME: 215_938_000_000,
          GROSS_PROFIT: 153_463_000_000,
          PARENT_HOLDER_NETPROFIT: 120_067_000_000,
          OPERATE_INCOME_YOY: 65.47,
          GROSS_PROFIT_RATIO: 71.07,
          NET_PROFIT_RATIO: 55.6,
        },
      ]);
    }
    if (name === "RPT_USF10_FN_BALANCE") {
      assert.equal(
        url.searchParams.get("filter"),
        `(SECUCODE="NVDA.O")(REPORT in ("2025/FY"))`,
      );
      return rows([
        { ITEM_NAME: "现金及现金等价物", AMOUNT: 10_605_000_000 },
        { ITEM_NAME: "短期债务", AMOUNT: 999_000_000 },
        { ITEM_NAME: "长期债务", AMOUNT: 8_500_000_000 },
        { ITEM_NAME: "资本租赁债务(非流动)", AMOUNT: 2_572_000_000 },
      ]);
    }
    if (name === "RPT_USSK_FN_CASHFLOW") {
      assert.equal(
        url.searchParams.get("filter"),
        `(SECUCODE="NVDA.O")(REPORT in ("2025/FY"))`,
      );
      return rows([
        { ITEM_NAME: "经营活动产生的现金流量净额", AMOUNT: 102_718_000_000 },
        { ITEM_NAME: "购买固定资产", AMOUNT: -6_042_000_000 },
      ]);
    }
    throw new Error(`unexpected ${name}`);
  });

  const result = await fetchCustomFinancial(
    { market: "US", ticker: "nvda" },
    { fetch, retries: 0, now: fixedNow },
  );

  assert.equal(result.status, "fresh");
  assert.equal(result.securityCode, "NVDA");
  assert.equal(result.reportDate, "2026-01-25");
  assert.equal(result.financialCurrency, "USD");
  assert.equal(result.revenueLocal100m, 2_159.38);
  assert.equal(result.grossProfitLocal100m, 1_534.63);
  assert.equal(result.netProfitLocal100m, 1_200.67);
  assert.equal(result.ocfLocal100m, 1_027.18);
  assert.equal(result.capexLocal100m, 60.42);
  assert.equal(result.cashLocal100m, 106.05);
  assert.equal(result.debtLocal100m, 120.71);
  assert.equal(result.revenueGrowth, 0.6547);
});

test("retries transient failures once and reports partial statement failures", async () => {
  let mainAttempts = 0;
  const retryingFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    const name = reportName(url);
    if (name === "RPT_F10_FINANCE_MAINFINADATA") {
      mainAttempts += 1;
      if (mainAttempts === 1) {
        return new Response("temporary", { status: 503 });
      }
      return jsonResponse(
        rows([
          {
            REPORT_DATE: "2025-12-31",
            REPORT_TYPE: "年报",
            CURRENCY: "CNY",
            TOTALOPERATEREVE: 1_000_000_000,
            MLR: 400_000_000,
            PARENTNETPROFIT: 100_000_000,
            STAFF_NUM: 1_000,
          },
        ]),
      );
    }
    if (name === "RPT_F10_FINANCE_GBALANCE") {
      return new Response("bad gateway", { status: 502 });
    }
    return jsonResponse(
      rows([
        {
          REPORT_DATE: "2025-12-31",
          NETCASH_OPERATE: 200_000_000,
          CONSTRUCT_LONG_ASSET: 50_000_000,
        },
      ]),
    );
  }) as typeof globalThis.fetch;

  const result = await fetchCustomFinancial(
    { market: "A", ticker: "600519" },
    { fetch: retryingFetch, retries: 1, retryDelayMs: 0, now: fixedNow },
  );

  assert.equal(mainAttempts, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.revenueLocal100m, 10);
  assert.equal(result.cashLocal100m, null);
  assert.ok(result.errors.some((error) => error.includes("资产负债表")));
});

test("batch requests cap company concurrency and isolate one invalid security", async () => {
  let active = 0;
  let peak = 0;
  const fetch = mockFetch(async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    const name = reportName(url);
    if (name === "RPT_F10_FINANCE_MAINFINADATA") {
      return rows([
        {
          REPORT_DATE: "2025-12-31",
          REPORT_TYPE: "年报",
          CURRENCY: "CNY",
          TOTALOPERATEREVE: 1,
        },
      ]);
    }
    if (name === "RPT_F10_FINANCE_GBALANCE") return rows([]);
    if (name === "RPT_F10_FINANCE_GCASHFLOW") return rows([]);
    throw new Error(`unexpected ${name}`);
  });
  const requests: CustomFinancialRequest[] = [
    { market: "A", ticker: "600519" },
    { market: "A", ticker: "000001" },
    { market: "US", ticker: "https://evil.example/" },
    { market: "A", ticker: "300308" },
  ];

  const results = await fetchCustomFinancials(requests, {
    fetch,
    retries: 0,
    concurrency: 2,
    now: fixedNow,
  });

  assert.equal(results.length, requests.length);
  assert.equal(results[2].status, "unavailable");
  assert.match(results[2].message, /财务数据暂不可用/);
  assert.ok(results[0].status === "partial");
  assert.ok(results[1].status === "partial");
  // Each company may request its balance sheet and cash-flow statement together.
  assert.ok(peak <= 4);
});
