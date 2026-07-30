import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTencentFxRates } from "../lib/market-refresh";

test("supplemental FX parsing converts direct and inverse CNY pairs", () => {
  const rates = parseTencentFxRates(
    [
      'v_whEURCNY="310~欧元人民币~EURCNY~7.7288~0";',
      'v_whTWDCNY="310~台币人民币~TWDCNY~0.2076~0";',
      'v_whCNYJPY="310~人民币日元~CNYJPY~24.2264~0";',
      'v_whGBPCNY="310~英镑人民币~GBPCNY~9.0137~0";',
      'v_whSGDCNY="310~新加坡元人民币~SGDCNY~5.2335~0";',
    ].join("\n"),
  );
  assert.equal(rates.EUR, 7.7288);
  assert.equal(rates.TWD, 0.2076);
  assert.equal(rates.GBP, 9.0137);
  assert.equal(rates.SGD, 5.2335);
  assert.ok(Math.abs(rates.JPY - 1 / 24.2264) < 1e-12);
});

test("supplemental FX parsing ignores unknown, zero, and malformed rows", () => {
  const rates = parseTencentFxRates(
    [
      'v_whEURCNY="310~欧元人民币~EURCNY~0~0";',
      'v_whTWDCNY="310~台币人民币~TWDCNY~not-a-number~0";',
      'v_whAUDCNY="310~澳元人民币~AUDCNY~4.70~0";',
    ].join("\n"),
  );
  assert.deepEqual(rates, {});
});
