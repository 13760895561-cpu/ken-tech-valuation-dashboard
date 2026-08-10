#!/usr/bin/env python3
"""Refresh market, financial, employee and source-audit data for the tracker.

The script deliberately keeps raw inputs separate from spreadsheet formulas.
Market prices come from Tencent quotes; structured financial statements come
from Eastmoney through AKShare; official annual-report links come from CNINFO,
SEC EDGAR or the issuer's investor-relations website.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import csv
import io
import json
import math
import os
import re
import sys
import time
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from zoneinfo import ZoneInfo

warnings.filterwarnings("ignore")
os.environ.setdefault("TQDM_DISABLE", "1")

import akshare as ak
import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "companies.json"
LATEST_PATH = ROOT / "data" / "latest_snapshot.json"
HISTORY_PATH = ROOT / "data" / "valuation_history.csv"
EVENTS_AUTO_PATH = ROOT / "data" / "events_auto.csv"
STATUS_PATH = ROOT / "data" / "last_update_status.json"
CACHE_DIR = ROOT / "data" / "cache"
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

SEC_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT",
    (
        "KenTechValuationDashboard/1.2 "
        "13760895561-cpu@example.com"
    ),
)
SEC_HEADERS = {
    "User-Agent": SEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
}
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    )
}
TENCENT_FX_SOURCE = (
    "https://qt.gtimg.cn/q="
    "whEURCNY,whTWDCNY,whCNYJPY,whGBPCNY,whSGDCNY"
)
TENCENT_FX_MAPPING = {
    "whEURCNY": ("EUR", False),
    "whTWDCNY": ("TWD", False),
    "whCNYJPY": ("JPY", True),
    "whGBPCNY": ("GBP", False),
    "whSGDCNY": ("SGD", False),
}

FINANCIAL_DATA_FIELDS = (
    "official_report_source",
    "structured_source",
    "employees",
    "report_period",
    "report_date",
    "notice_date",
    "revenue_local_100m",
    "gross_profit_local_100m",
    "net_profit_local_100m",
    "revenue_growth",
    "gross_margin",
    "net_margin",
    "roic",
    "ocf_local_100m",
    "capex_local_100m",
    "cash_local_100m",
    "debt_local_100m",
    "errors",
)
QUOTE_DATA_FIELDS = (
    "name_quote",
    "price_local",
    "prev_close_local",
    "change_pct",
    "quote_date",
    "shares_million",
    "market_cap_local_100m",
    "quote_market_cap_check_100m",
)
FINANCIAL_CORE_NUMERIC_FIELDS = (
    "revenue_local_100m",
    "gross_profit_local_100m",
    "net_profit_local_100m",
)
FINANCIAL_DIAGNOSTIC_NUMERIC_FIELDS = (
    *FINANCIAL_CORE_NUMERIC_FIELDS,
    "ocf_local_100m",
    "capex_local_100m",
    "cash_local_100m",
    "debt_local_100m",
    "employees",
)


def finite_number(value: Any) -> Optional[float]:
    try:
        if value is None or pd.isna(value):
            return None
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def extract_financial_data(company: Optional[dict]) -> dict:
    if not company:
        return {}
    return {
        field: company[field]
        for field in FINANCIAL_DATA_FIELDS
        if field in company
    }


def extract_quote_data(company: Optional[dict]) -> dict:
    if not company:
        return {}
    return {
        field: company[field]
        for field in QUOTE_DATA_FIELDS
        if field in company
    }


def missing_financial_core_fields(financial: dict) -> list[str]:
    missing = [
        field
        for field in FINANCIAL_CORE_NUMERIC_FIELDS
        if finite_number(financial.get(field)) is None
    ]
    report_date = str(financial.get("report_date") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date):
        missing.insert(0, "report_date")
    return missing


def missing_financial_diagnostic_fields(financial: dict) -> list[str]:
    missing = [
        field
        for field in FINANCIAL_DIAGNOSTIC_NUMERIC_FIELDS
        if finite_number(financial.get(field)) is None
    ]
    report_date = str(financial.get("report_date") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date):
        missing.insert(0, "report_date")
    if not str(financial.get("official_report_source") or "").strip():
        missing.append("official_report_source")
    return missing


def text_date(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    try:
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    except Exception:
        return str(value)[:10]


def quote_date(value: Any) -> str:
    raw = str(value or "").strip()
    digits = re.sub(r"\D", "", raw)
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return text_date(raw)


def local_100m(value: Any) -> Optional[float]:
    number = finite_number(value)
    return None if number is None else number / 100_000_000


def pct_decimal(value: Any) -> Optional[float]:
    number = finite_number(value)
    return None if number is None else number / 100.0


def add_numbers(values: Iterable[Any]) -> Optional[float]:
    numbers = [finite_number(value) for value in values]
    valid = [value for value in numbers if value is not None]
    return sum(valid) if valid else None


def normalized_currency(value: Any) -> str:
    return str(value or "").strip().upper()


def required_currencies(companies: list[dict]) -> set[str]:
    return {
        currency
        for company in companies
        for currency in (
            normalized_currency(company.get("quote_currency")),
            normalized_currency(company.get("financial_currency")),
        )
        if currency
    }


def is_valuation_target(company: dict) -> bool:
    explicit = company.get("valuation_target")
    if isinstance(explicit, bool):
        return explicit
    role = str(company.get("role") or "").strip()
    if role:
        return role == "重点观察"
    # Older 31-company configurations predate valuation_target and role.
    return company.get("market") == "A"


def official_report_source_override(company: dict) -> str:
    return str(company.get("official_report_source_override") or "").strip()


def official_report_source_override_report_date(company: dict) -> str:
    return str(
        company.get("official_report_source_override_report_date") or ""
    ).strip()


def parse_tencent_fx_rates(text: str) -> dict[str, float]:
    rates: dict[str, float] = {}
    for match in re.finditer(r'v_([A-Za-z0-9._-]+)="(.*?)";', text):
        quote_code, payload = match.groups()
        definition = TENCENT_FX_MAPPING.get(quote_code)
        if not definition:
            continue
        currency, inverse = definition
        fields = payload.split("~")
        current = finite_number(fields[3] if len(fields) > 3 else None)
        if current is None or current <= 0:
            continue
        rates[currency] = 1 / current if inverse else current
    return rates


def fetch_tencent_fx_rates() -> dict[str, float]:
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            response = requests.get(
                TENCENT_FX_SOURCE,
                headers=DEFAULT_HEADERS,
                timeout=20,
            )
            response.raise_for_status()
            rates = parse_tencent_fx_rates(
                response.content.decode("gb18030", errors="replace")
            )
            if rates:
                return rates
            raise RuntimeError("Tencent FX response contained no usable rates")
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Tencent supplemental FX failed: {last_error}")


def request_json(
    url: str,
    *,
    params: Optional[dict] = None,
    headers: Optional[dict] = None,
    timeout: int = 25,
    retries: int = 2,
) -> dict:
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = requests.get(
                url,
                params=params,
                headers=headers or DEFAULT_HEADERS,
                timeout=timeout,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(0.7 * (attempt + 1))
    raise RuntimeError(f"JSON request failed: {url}: {last_error}")


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def valid_prior_snapshot(payload: dict, companies: list[dict]) -> bool:
    if not isinstance(payload, dict):
        return False
    prior_companies = {
        company.get("id"): company
        for company in payload.get("companies", [])
        if isinstance(company, dict) and company.get("id")
    }
    if set(prior_companies) != {company["id"] for company in companies}:
        return False
    for company in companies:
        prior = prior_companies[company["id"]]
        if (
            finite_number(prior.get("price_local")) is None
            or finite_number(prior.get("market_cap_local_100m")) is None
            or missing_financial_core_fields(prior)
        ):
            return False
    rates = payload.get("fx", {}).get("rates_to_cny", {})
    return all(
        (rate := finite_number(rates.get(currency))) is not None and rate > 0
        for currency in required_currencies(companies)
    )


def load_companies() -> list[dict]:
    companies = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(companies, list) or not companies:
        raise ValueError("companies.json must contain a non-empty list")

    expected_quote_currencies = {"A": "CNY", "US": "USD", "HK": "HKD"}
    seen_ids: set[str] = set()
    for company in companies:
        company_id = str(company.get("id") or "")
        market = company.get("market")
        if not company_id or company_id in seen_ids:
            raise ValueError(f"missing or duplicate company id: {company_id!r}")
        seen_ids.add(company_id)
        if market not in expected_quote_currencies:
            raise ValueError(f"{company_id}: unsupported market {market!r}")
        quote_currency = normalized_currency(company.get("quote_currency"))
        financial_currency = normalized_currency(company.get("financial_currency"))
        if quote_currency != expected_quote_currencies[market]:
            raise ValueError(
                f"{company_id}: expected quote currency "
                f"{expected_quote_currencies[market]}, got {quote_currency!r}"
            )
        if not re.fullmatch(r"[A-Z]{3}", financial_currency):
            raise ValueError(
                f"{company_id}: invalid explicit financial currency "
                f"{financial_currency!r}"
            )
        company["quote_currency"] = quote_currency
        company["financial_currency"] = financial_currency
        if "valuation_target" in company and not isinstance(
            company["valuation_target"], bool
        ):
            raise ValueError(f"{company_id}: valuation_target must be boolean")
        override = official_report_source_override(company)
        if override and not override.startswith("https://"):
            raise ValueError(
                f"{company_id}: official_report_source_override must use HTTPS"
            )
        override_report_date = official_report_source_override_report_date(company)
        if override and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", override_report_date):
            raise ValueError(
                f"{company_id}: official source override requires a bound report date"
            )
    return companies


def fetch_fx(companies: Optional[list[dict]] = None) -> dict:
    url = "https://api.frankfurter.app/latest"
    required = required_currencies(companies or []) or {"CNY", "USD", "HKD"}
    try:
        payload = request_json(
            url,
            params={"from": "USD", "to": "CNY,HKD"},
            timeout=20,
            retries=2,
        )
        usd_cny = finite_number(payload.get("rates", {}).get("CNY"))
        usd_hkd = finite_number(payload.get("rates", {}).get("HKD"))
        if not usd_cny or not usd_hkd:
            raise RuntimeError("missing FX rates")
        rates_to_cny: dict[str, Optional[float]] = {
            "CNY": 1.0,
            "USD": usd_cny,
            "HKD": usd_cny / usd_hkd,
        }
        supplemental_required = required - set(rates_to_cny)
        supplemental_status = "not_required"
        if supplemental_required:
            supplemental_rates = fetch_tencent_fx_rates()
            rates_to_cny.update(supplemental_rates)
            supplemental_status = "ok"
        missing = sorted(
            currency
            for currency in required
            if finite_number(rates_to_cny.get(currency)) is None
            or finite_number(rates_to_cny.get(currency)) <= 0
        )
        if missing:
            raise RuntimeError(
                "missing required FX rates: " + ", ".join(missing)
            )
        return {
            "date": payload.get("date", ""),
            "source": "https://api.frankfurter.app/latest?from=USD&to=CNY,HKD",
            "supplemental_source": TENCENT_FX_SOURCE,
            "supplemental_status": supplemental_status,
            "rates_to_cny": rates_to_cny,
            "status": "ok",
        }
    except Exception as exc:
        # Explicit, visible fallback: never silently substitute a stale rate.
        return {
            "date": "",
            "source": url,
            "supplemental_source": TENCENT_FX_SOURCE,
            "rates_to_cny": {
                currency: (1.0 if currency == "CNY" else None)
                for currency in sorted(required | {"CNY", "USD", "HKD"})
            },
            "status": f"failed: {exc}",
        }


def fetch_tencent_quotes(companies: list[dict]) -> tuple[dict, dict]:
    codes = [company["quote_code"] for company in companies]
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    last_error: Optional[Exception] = None
    text = ""
    for attempt in range(3):
        try:
            response = requests.get(url, headers=DEFAULT_HEADERS, timeout=20)
            response.raise_for_status()
            text = response.content.decode("gb18030", errors="replace")
            break
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.8 * (attempt + 1))
    if not text:
        raise RuntimeError(f"Tencent quote request failed after 3 attempts: {last_error}")

    parsed: dict[str, dict] = {}
    for match in re.finditer(r'v_([A-Za-z0-9]+)="(.*?)";', text):
        key, payload = match.groups()
        fields = payload.split("~")
        if len(fields) < 46:
            continue
        price = finite_number(fields[3])
        # Field 45 is total market cap in 100 million local-currency units
        # across A/HK/US quote formats. Share-count indices differ by market,
        # so derive shares from market cap instead of relying on a shifting index.
        market_cap_100m = finite_number(fields[45])
        shares = (
            market_cap_100m * 100_000_000 / price
            if price and market_cap_100m is not None
            else None
        )
        parsed[key] = {
            "name_quote": fields[1],
            "price_local": price,
            "prev_close_local": finite_number(fields[4]),
            "change_pct": pct_decimal(fields[32]),
            "quote_date": quote_date(fields[30]),
            "shares_million": shares / 1_000_000 if shares else None,
            "market_cap_local_100m": market_cap_100m,
            "quote_market_cap_check_100m": finite_number(fields[45]),
        }
    result = {
        company["id"]: parsed.get(company["quote_code"], {}) for company in companies
    }
    success_count = sum(
        1
        for value in result.values()
        if value.get("price_local") is not None
        and value.get("market_cap_local_100m") is not None
    )
    if success_count == 0:
        raise RuntimeError("Tencent quote response contained no usable quotes")
    meta = {
        "source": "https://qt.gtimg.cn/",
        "sample_count": len(companies),
        "success_count": success_count,
        "status": "ok" if success_count == len(companies) else "partial",
    }
    return result, meta


def latest_annual_a(df: pd.DataFrame) -> pd.Series:
    annual = df[df["REPORT_TYPE"].astype(str).eq("年报")].copy()
    if annual.empty:
        raise RuntimeError("no annual rows")
    annual["REPORT_DATE"] = pd.to_datetime(annual["REPORT_DATE"])
    return annual.sort_values("REPORT_DATE", ascending=False).iloc[0]


def matching_report_row(df: pd.DataFrame, report_date: str) -> pd.Series:
    if df.empty:
        raise RuntimeError("empty statement")
    dates = pd.to_datetime(df["REPORT_DATE"])
    target = pd.Timestamp(report_date)
    exact = df[dates.eq(target)]
    if not exact.empty:
        return exact.iloc[0]
    raise RuntimeError(f"statement has no exact row for {report_date}")


def cninfo_annual_report(code: str, report_year: int) -> str:
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
            io.StringIO()
        ):
            df = ak.stock_zh_a_disclosure_report_cninfo(
                symbol=code,
                market="沪深京",
                keyword=f"{report_year}年年度报告",
                category="年报",
                start_date=f"{report_year + 1}0101",
                end_date=f"{report_year + 1}0731",
            )
        if df.empty:
            return ""
        clean_title = df["公告标题"].astype(str).str.replace(
            r"<.*?>", "", regex=True
        )
        exact = df[
            clean_title.str.fullmatch(fr"{report_year}年年度报告", na=False)
        ]
        row = exact.iloc[0] if not exact.empty else df.iloc[-1]
        detail = str(row["公告链接"])
        ann = re.search(r"announcementId=(\d+)", detail)
        ann_date = text_date(row["公告时间"])
        if ann and ann_date:
            return (
                f"https://static.cninfo.com.cn/finalpage/{ann_date}/"
                f"{ann.group(1)}.PDF"
            )
        return detail
    except Exception:
        return ""


def fetch_a_company(company: dict) -> dict:
    code = company["id"]
    symbol = company["financial_symbol"]
    prefix = "SH" if symbol.endswith(".SH") else "SZ"
    errors: list[str] = []
    result: dict[str, Any] = {
        "financial_currency": company["financial_currency"],
        "structured_source": (
            "https://emweb.securities.eastmoney.com/pc_hsf10/pages/"
            f"index.html?type=web&code={prefix}{code}#/cwfx"
        ),
    }
    try:
        indicator = ak.stock_financial_analysis_indicator_em(
            symbol=symbol, indicator="按报告期"
        )
        row = latest_annual_a(indicator)
        report_date = text_date(row["REPORT_DATE"])
        report_year = int(report_date[:4])
        result.update(
            {
                "report_period": str(row.get("REPORT_DATE_NAME", "")),
                "report_date": report_date,
                "notice_date": text_date(row.get("NOTICE_DATE")),
                "revenue_local_100m": local_100m(row.get("TOTALOPERATEREVE")),
                "gross_profit_local_100m": local_100m(row.get("MLR")),
                "net_profit_local_100m": local_100m(row.get("PARENTNETPROFIT")),
                "revenue_growth": pct_decimal(row.get("TOTALOPERATEREVETZ")),
                "gross_margin": pct_decimal(row.get("XSMLL")),
                "net_margin": pct_decimal(row.get("XSJLL")),
                "roic": pct_decimal(row.get("ROIC")),
                "employees": finite_number(row.get("STAFF_NUM")),
                "official_report_source": cninfo_annual_report(code, report_year),
            }
        )

        try:
            cash_flow = ak.stock_cash_flow_sheet_by_report_em(
                symbol=f"{prefix}{code}"
            )
            cash_row = matching_report_row(cash_flow, report_date)
            ocf = finite_number(cash_row.get("NETCASH_OPERATE"))
            capex = finite_number(cash_row.get("CONSTRUCT_LONG_ASSET"))
            result["ocf_local_100m"] = local_100m(ocf)
            result["capex_local_100m"] = (
                local_100m(abs(capex)) if capex is not None else None
            )
        except Exception as exc:
            errors.append(f"cashflow: {exc}")

        try:
            balance = ak.stock_balance_sheet_by_report_em(
                symbol=f"{prefix}{code}"
            )
            balance_row = matching_report_row(balance, report_date)
            result["cash_local_100m"] = local_100m(
                balance_row.get("MONETARYFUNDS")
            )
            debt = add_numbers(
                [
                    balance_row.get("SHORT_LOAN"),
                    balance_row.get("LONG_LOAN"),
                    balance_row.get("BOND_PAYABLE"),
                    balance_row.get("SHORT_BOND_PAYABLE"),
                    balance_row.get("LEASE_LIAB"),
                ]
            )
            result["debt_local_100m"] = local_100m(debt)
        except Exception as exc:
            errors.append(f"balance: {exc}")
    except Exception as exc:
        errors.append(f"indicator: {exc}")
    result["errors"] = errors
    return result


def sec_ticker_map() -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / "sec_company_tickers.json"
    payload: dict
    try:
        if cache.exists() and (
            time.time() - cache.stat().st_mtime < 7 * 86400
        ):
            payload = json.loads(cache.read_text(encoding="utf-8"))
        else:
            payload = request_json(
                "https://www.sec.gov/files/company_tickers.json",
                headers=SEC_HEADERS,
                timeout=30,
                retries=1,
            )
            cache.write_text(json.dumps(payload), encoding="utf-8")
        return {value["ticker"].upper(): value for value in payload.values()}
    except Exception:
        return {}


def latest_sec_report(ticker: str, ticker_map: dict) -> dict:
    entry = ticker_map.get(ticker.upper())
    if not entry:
        return {}
    cik_int = int(entry["cik_str"])
    cik = str(cik_int).zfill(10)
    submission = request_json(
        f"https://data.sec.gov/submissions/CIK{cik}.json",
        headers=SEC_HEADERS,
        timeout=30,
        retries=1,
    )
    recent = submission["filings"]["recent"]
    preferred = ["10-K", "20-F", "40-F"]
    chosen = None
    for form in preferred:
        for index, candidate in enumerate(recent["form"]):
            if candidate == form:
                chosen = index
                break
        if chosen is not None:
            break
    if chosen is None:
        return {}
    accession_display = recent["accessionNumber"][chosen]
    accession = accession_display.replace("-", "")
    primary = recent["primaryDocument"][chosen]
    filing_date = recent["filingDate"][chosen]
    report_date = recent.get("reportDate", [""] * len(recent["form"]))[chosen]
    url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}/"
        f"{accession}/{primary}"
    )
    employee_count = None
    try:
        response = requests.get(url, headers=SEC_HEADERS, timeout=35)
        response.raise_for_status()
        filing_text = " ".join(
            BeautifulSoup(response.text, "html.parser").stripped_strings
        )
        candidates: list[int] = []
        patterns = [
            r"(?:had|have|employ|employed|workforce of|total of)\s+"
            r"(?:approximately\s+|about\s+)?([\d,]{3,})\s+"
            r"(?:full[- ]time\s+)?(?:employees|people)",
            r"([\d,]{3,})\s+(?:full[- ]time\s+)?(?:employees|people)",
        ]
        for pattern in patterns:
            for match in re.findall(pattern, filing_text, flags=re.I):
                value = int(match.replace(",", ""))
                if 300 <= value <= 1_000_000:
                    candidates.append(value)
        employee_count = max(candidates) if candidates else None
    except Exception:
        pass
    return {
        "url": url,
        "cik": cik,
        "accession_number": accession_display,
        "form": recent["form"][chosen],
        "filing_date": filing_date,
        "report_date": report_date,
        "employees": employee_count,
    }


def sec_usd_fact(
    company_facts: dict,
    tag: str,
    report_date: str,
    accession_number: str,
) -> Optional[float]:
    units = (
        company_facts.get("facts", {})
        .get("us-gaap", {})
        .get(tag, {})
        .get("units", {})
        .get("USD", [])
    )
    candidates = [
        row
        for row in units
        if row.get("end") == report_date
        and row.get("form") in {"10-K", "20-F", "40-F"}
        and (
            not accession_number
            or row.get("accn") == accession_number
        )
    ]
    if not candidates:
        candidates = [
            row
            for row in units
            if row.get("end") == report_date
            and row.get("form") in {"10-K", "20-F", "40-F"}
        ]
    if not candidates:
        return None
    candidates.sort(key=lambda row: str(row.get("filed") or ""))
    return finite_number(candidates[-1].get("val"))


def sec_debt_local_100m(sec: dict, report_date: str) -> Optional[float]:
    cik = str(sec.get("cik") or "")
    if not cik or not report_date:
        return None
    payload = request_json(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
        headers=SEC_HEADERS,
        timeout=35,
        retries=1,
    )
    accession = str(sec.get("accession_number") or "")
    # Prefer an issuer-reported all-in debt total when available.
    for tag in (
        "DebtAndCapitalLeaseObligations",
        "LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent",
    ):
        value = sec_usd_fact(payload, tag, report_date, accession)
        if value is not None:
            return value / 100_000_000

    # Some issuers disclose bank debt and convertible notes in separate tags.
    combined_debt = sec_usd_fact(
        payload,
        "DebtLongtermAndShorttermCombinedAmount",
        report_date,
        accession,
    )
    convertible_notes = sec_usd_fact(
        payload,
        "ConvertibleLongTermNotesPayable",
        report_date,
        accession,
    )
    components = [
        value
        for value in (combined_debt, convertible_notes)
        if value is not None
    ]
    return sum(components) / 100_000_000 if components else None


def latest_long_item(
    df: pd.DataFrame,
    *,
    date_column: str,
    name_column: str,
    amount_column: str,
    names: list[str],
    report_date: Optional[str] = None,
    sum_matches: bool = False,
) -> Optional[float]:
    if df.empty:
        return None
    dates = pd.to_datetime(df[date_column])
    target = pd.Timestamp(report_date) if report_date else dates.max()
    current = df[dates.eq(target)]
    if current.empty:
        return None
    matches = current[current[name_column].astype(str).isin(names)]
    values = [finite_number(value) for value in matches[amount_column]]
    values = [value for value in values if value is not None]
    if not values:
        return None
    return sum(values) if sum_matches else values[0]


def fetch_us_company(company: dict, ticker_map: dict) -> dict:
    ticker = company["financial_symbol"]
    errors: list[str] = []
    sec = latest_sec_report(company.get("sec_ticker", ticker), ticker_map)
    result: dict[str, Any] = {
        "financial_currency": company["financial_currency"],
        "official_report_source": sec.get("url", ""),
        "structured_source": (
            "https://emweb.eastmoney.com/PC_USF10/pages/"
            f"index.html?code={ticker}&type=web&color=w#/cwfx"
        ),
        "employees": sec.get("employees"),
    }
    try:
        indicator = ak.stock_financial_us_analysis_indicator_em(
            symbol=ticker, indicator="年报"
        )
        if indicator.empty:
            raise RuntimeError("empty annual indicator")
        indicator["REPORT_DATE"] = pd.to_datetime(indicator["REPORT_DATE"])
        row = indicator.sort_values("REPORT_DATE", ascending=False).iloc[0]
        report_date = text_date(row["REPORT_DATE"])
        result.update(
            {
                "report_period": f"截至{report_date}年报",
                "report_date": report_date,
                "notice_date": text_date(row.get("NOTICE_DATE")),
                "revenue_local_100m": local_100m(row.get("OPERATE_INCOME")),
                "gross_profit_local_100m": local_100m(row.get("GROSS_PROFIT")),
                "net_profit_local_100m": local_100m(
                    row.get("PARENT_HOLDER_NETPROFIT")
                ),
                "revenue_growth": pct_decimal(row.get("OPERATE_INCOME_YOY")),
                "gross_margin": pct_decimal(row.get("GROSS_PROFIT_RATIO")),
                "net_margin": pct_decimal(row.get("NET_PROFIT_RATIO")),
                "roic": None,
            }
        )
        if not result.get("notice_date") and sec:
            result["notice_date"] = sec.get("filing_date", "")
        if sec and sec.get("report_date") != report_date:
            errors.append(
                "official report period mismatch: "
                f"SEC {sec.get('report_date') or 'unknown'} vs "
                f"structured {report_date}"
            )
            result["official_report_source"] = ""

        try:
            cash_flow = ak.stock_financial_us_report_em(
                stock=ticker, symbol="现金流量表", indicator="年报"
            )
            ocf = latest_long_item(
                cash_flow,
                date_column="REPORT_DATE",
                name_column="ITEM_NAME",
                amount_column="AMOUNT",
                names=["经营活动产生的现金流量净额"],
                report_date=report_date,
            )
            capex = latest_long_item(
                cash_flow,
                date_column="REPORT_DATE",
                name_column="ITEM_NAME",
                amount_column="AMOUNT",
                names=["购买固定资产", "购建固定资产"],
                report_date=report_date,
                sum_matches=True,
            )
            result["ocf_local_100m"] = local_100m(ocf)
            result["capex_local_100m"] = (
                local_100m(abs(capex)) if capex is not None else None
            )
        except Exception as exc:
            errors.append(f"cashflow: {exc}")

        try:
            balance = ak.stock_financial_us_report_em(
                stock=ticker, symbol="资产负债表", indicator="年报"
            )
            cash = latest_long_item(
                balance,
                date_column="REPORT_DATE",
                name_column="ITEM_NAME",
                amount_column="AMOUNT",
                names=["现金及现金等价物"],
                report_date=report_date,
            )
            debt = latest_long_item(
                balance,
                date_column="REPORT_DATE",
                name_column="ITEM_NAME",
                amount_column="AMOUNT",
                names=[
                    "短期债务",
                    "一年内到期长期债务",
                    "长期债务",
                    "资本租赁债务(流动)",
                    "资本租赁债务(非流动)",
                ],
                report_date=report_date,
                sum_matches=True,
            )
            result["cash_local_100m"] = local_100m(cash)
            result["debt_local_100m"] = local_100m(debt)
        except Exception as exc:
            errors.append(f"balance: {exc}")
        if result.get("debt_local_100m") is None and sec:
            try:
                result["debt_local_100m"] = sec_debt_local_100m(
                    sec,
                    report_date,
                )
            except Exception as exc:
                errors.append(f"SEC debt facts: {exc}")
    except Exception as exc:
        errors.append(f"indicator: {exc}")
    result["errors"] = errors
    return result


def tencent_annual_report(report_year: int) -> str:
    reports_page = "https://www.tencent.com/en-us/investors/financial-reports.html"
    try:
        response = requests.get(
            reports_page,
            headers=DEFAULT_HEADERS,
            timeout=25,
        )
        response.raise_for_status()
        annual_links: list[tuple[str, str]] = []
        for anchor in BeautifulSoup(response.text, "html.parser").find_all(
            "a", href=True
        ):
            label = " ".join(anchor.stripped_strings)
            if "annual report" not in label.lower():
                continue
            annual_links.append(
                (
                    label,
                    requests.compat.urljoin(reports_page, anchor["href"]),
                )
            )
        year_pattern = re.compile(fr"\b{report_year}\s+Annual Report\b", re.I)
        for label, url in annual_links:
            if year_pattern.search(label):
                return url
    except Exception:
        pass
    return ""


def fetch_hk_company(company: dict, ticker_map: dict) -> dict:
    # Older seeds store a bare five-digit code while expanded catalog entries
    # may carry the display ticker suffix. AKShare's HK endpoints require the
    # bare code, so accept both representations.
    code = str(company["financial_symbol"]).upper().removesuffix(".HK").zfill(5)
    errors: list[str] = []
    sec = (
        latest_sec_report(company["sec_ticker"], ticker_map)
        if company.get("sec_ticker")
        else {}
    )
    official_source = sec.get("url") or ""
    result: dict[str, Any] = {
        "financial_currency": company["financial_currency"],
        "official_report_source": official_source,
        "structured_source": (
            "https://emweb.securities.eastmoney.com/PC_HKF10/"
            f"NewFinancialAnalysis/index?type=web&code={code}"
        ),
    }
    try:
        indicator = ak.stock_financial_hk_analysis_indicator_em(
            symbol=code, indicator="年度"
        )
        if indicator.empty:
            raise RuntimeError("empty annual indicator")
        indicator["REPORT_DATE"] = pd.to_datetime(indicator["REPORT_DATE"])
        row = indicator.sort_values("REPORT_DATE", ascending=False).iloc[0]
        report_date = text_date(row["REPORT_DATE"])
        if code == "00700":
            result["official_report_source"] = tencent_annual_report(
                int(report_date[:4])
            )
        try:
            profile = ak.stock_hk_company_profile_em(symbol=code)
            employee_count = finite_number(profile.iloc[0].get("员工人数"))
        except Exception:
            employee_count = sec.get("employees")
        result.update(
            {
                "report_period": report_date[:4] + "年报",
                "report_date": report_date,
                "notice_date": sec.get("filing_date", ""),
                "revenue_local_100m": local_100m(row.get("OPERATE_INCOME")),
                "gross_profit_local_100m": local_100m(row.get("GROSS_PROFIT")),
                "net_profit_local_100m": local_100m(row.get("HOLDER_PROFIT")),
                "revenue_growth": pct_decimal(row.get("OPERATE_INCOME_YOY")),
                "gross_margin": pct_decimal(row.get("GROSS_PROFIT_RATIO")),
                "net_margin": pct_decimal(row.get("NET_PROFIT_RATIO")),
                "roic": pct_decimal(row.get("ROIC_YEARLY")),
                "employees": employee_count,
            }
        )
        try:
            cash_flow = ak.stock_financial_hk_report_em(
                stock=code, symbol="现金流量表", indicator="年度"
            )
            ocf = latest_long_item(
                cash_flow,
                date_column="REPORT_DATE",
                name_column="STD_ITEM_NAME",
                amount_column="AMOUNT",
                names=["经营业务现金净额"],
                report_date=report_date,
            )
            capex = latest_long_item(
                cash_flow,
                date_column="REPORT_DATE",
                name_column="STD_ITEM_NAME",
                amount_column="AMOUNT",
                names=["购建固定资产", "购建无形资产及其他资产"],
                report_date=report_date,
                sum_matches=True,
            )
            result["ocf_local_100m"] = local_100m(ocf)
            result["capex_local_100m"] = (
                local_100m(abs(capex)) if capex is not None else None
            )
        except Exception as exc:
            errors.append(f"cashflow: {exc}")
        try:
            balance = ak.stock_financial_hk_report_em(
                stock=code, symbol="资产负债表", indicator="年度"
            )
            cash = latest_long_item(
                balance,
                date_column="REPORT_DATE",
                name_column="STD_ITEM_NAME",
                amount_column="AMOUNT",
                names=["现金及等价物", "短期存款"],
                report_date=report_date,
                sum_matches=True,
            )
            debt = latest_long_item(
                balance,
                date_column="REPORT_DATE",
                name_column="STD_ITEM_NAME",
                amount_column="AMOUNT",
                names=[
                    "短期贷款",
                    "长期贷款",
                    "融资租赁负债(流动)",
                    "融资租赁负债(非流动)",
                ],
                report_date=report_date,
                sum_matches=True,
            )
            result["cash_local_100m"] = local_100m(cash)
            result["debt_local_100m"] = local_100m(debt)
        except Exception as exc:
            errors.append(f"balance: {exc}")
    except Exception as exc:
        errors.append(f"indicator: {exc}")
    result["errors"] = errors
    return result


def data_quality_score(company: dict) -> int:
    numeric_fields = [
        "price_local",
        "market_cap_local_100m",
        "revenue_local_100m",
        "gross_profit_local_100m",
        "net_profit_local_100m",
        "employees",
    ]
    numeric_complete = sum(
        finite_number(company.get(field)) is not None for field in numeric_fields
    )
    source_complete = bool(str(company.get("official_report_source") or "").strip())
    completeness = (numeric_complete + source_complete) / (
        len(numeric_fields) + 1
    )
    score = round(completeness * 70)
    if str(company.get("official_report_source", "")).startswith("https://"):
        score += 20
    if not company.get("errors"):
        score += 10
    return min(score, 100)


def make_event_rows(companies: list[dict], as_of: str) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for company in companies:
        if not is_valuation_target(company):
            continue
        growth = company.get("revenue_growth")
        margin = company.get("net_margin")
        growth_text = f"{growth:.1%}" if growth is not None else "未取得"
        margin_text = f"{margin:.1%}" if margin is not None else "未取得"
        rows.append(
            [
                company.get("notice_date") or as_of,
                company["name"],
                company["id"],
                "年度业绩",
                (
                    f"{company.get('report_period','最新年报')}收入同比{growth_text}，"
                    f"归母净利率{margin_text}；已纳入基线。"
                ),
                "增长/盈利/现金流",
                "中性",
                "高",
                "A/B",
                company.get("official_report_source", ""),
                "下期财报核对收入、毛利率、经营现金流与员工数",
                "待复核",
            ]
        )
    return rows


def write_auto_events(rows: list[list[Any]]) -> None:
    headers = [
        "日期",
        "公司",
        "代码",
        "事件类别",
        "事实摘要",
        "影响变量",
        "方向",
        "重要性",
        "证据等级",
        "来源链接",
        "下一步验证",
        "状态",
    ]
    EVENTS_AUTO_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = EVENTS_AUTO_PATH.with_name(
        f".{EVENTS_AUTO_PATH.name}.{os.getpid()}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(headers)
            writer.writerows(rows)
        os.replace(temporary, EVENTS_AUTO_PATH)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def append_history(companies: list[dict], as_of: str) -> None:
    existing: list[dict] = []
    if HISTORY_PATH.exists():
        with HISTORY_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    target_snapshots = {
        (
            company["id"],
            company.get("quote_date") or as_of,
        )
        for company in companies
        if is_valuation_target(company)
    }
    existing = [
        row
        for row in existing
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", row.get("快照日期", ""))
        and (row.get("代码"), row.get("快照日期")) not in target_snapshots
    ]
    headers = [
        "快照日期",
        "代码",
        "公司",
        "分组",
        "地区",
        "币种",
        "财务报告期",
        "股价本币",
        "市值亿元人民币",
        "EV_Sales",
        "EV_GrossProfit",
        "PE",
        "P_FCF",
        "人均市值万元",
        "数据状态",
    ]
    rates = CURRENT_FX.get("rates_to_cny", {})
    new_rows: list[dict] = []
    for company in companies:
        if not is_valuation_target(company):
            continue
        quote_rate = company.get("quote_fx_to_cny") or rates.get(
            company.get("quote_currency")
        )
        financial_rate = company.get("financial_fx_to_cny") or rates.get(
            company.get("financial_currency")
        )
        mcap = company.get("market_cap_local_100m")
        revenue = company.get("revenue_local_100m")
        gross_profit = company.get("gross_profit_local_100m")
        net_profit = company.get("net_profit_local_100m")
        ocf = company.get("ocf_local_100m")
        capex = company.get("capex_local_100m")
        cash = company.get("cash_local_100m")
        debt = company.get("debt_local_100m")
        if quote_rate and financial_rate and mcap is not None:
            mcap_cny = mcap * quote_rate
            ev = (
                mcap_cny + debt * financial_rate - cash * financial_rate
                if debt is not None and cash is not None
                else None
            )
            fcf = (
                (ocf - capex) * financial_rate
                if ocf is not None and capex is not None
                else None
            )
            row = {
                "快照日期": company.get("quote_date") or as_of,
                "代码": company["id"],
                "公司": company["name"],
                "分组": company["group"],
                "地区": company["region"],
                "币种": company.get("quote_currency"),
                "财务报告期": company.get("report_period"),
                "股价本币": company.get("price_local"),
                "市值亿元人民币": mcap_cny,
                "EV_Sales": (
                    ev / (revenue * financial_rate)
                    if ev is not None and revenue
                    else ""
                ),
                "EV_GrossProfit": (
                    ev / (gross_profit * financial_rate)
                    if ev is not None and gross_profit
                    else ""
                ),
                "PE": (
                    mcap_cny / (net_profit * financial_rate)
                    if net_profit and net_profit > 0
                    else ""
                ),
                "P_FCF": mcap_cny / fcf if fcf is not None and fcf > 0 else "",
                "人均市值万元": (
                    mcap_cny * 10_000 / company["employees"]
                    if company.get("employees")
                    else ""
                ),
                "数据状态": "OK" if not company.get("errors") else "部分缺失",
            }
            new_rows.append(row)
    if not new_rows:
        return
    temporary = HISTORY_PATH.with_name(
        f".{HISTORY_PATH.name}.{os.getpid()}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            for row in existing:
                writer.writerow(row)
            for row in new_rows:
                writer.writerow(row)
        os.replace(temporary, HISTORY_PATH)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--quick",
        action="store_true",
        help="Reuse the latest financial inputs and refresh quotes/FX only.",
    )
    modes.add_argument(
        "--financial-only",
        action="store_true",
        help="Refresh annual financials while retaining the audited quote/FX snapshot.",
    )
    args = parser.parse_args()
    started = time.time()
    run_attempted_at = datetime.now(SHANGHAI_TZ).isoformat(timespec="seconds")
    companies = load_companies()
    mode_requested = (
        "quick" if args.quick else "financial_only" if args.financial_only else "full"
    )
    prior_payload: dict = {}
    snapshot_by_id: dict[str, dict] = {}
    if LATEST_PATH.exists():
        try:
            prior_payload = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
            snapshot_by_id = {
                company["id"]: company
                for company in prior_payload.get("companies", [])
            }
        except Exception:
            prior_payload = {}
            snapshot_by_id = {}
    prior_valid = valid_prior_snapshot(prior_payload, companies)

    def retain_prior_snapshot(
        failure_stage: str,
        reason: str,
        *,
        live_quote_success_count: int = 0,
    ) -> int:
        status = {
            "status": (
                "stale_snapshot_retained"
                if prior_valid
                else "failed_no_valid_snapshot"
            ),
            "mode_requested": mode_requested,
            "attempted_at": run_attempted_at,
            "failure_stage": failure_stage,
            "reason": reason,
            "retained_snapshot_as_of": (
                prior_payload.get("as_of", "") if prior_valid else ""
            ),
            "retained_snapshot_generated_at": (
                prior_payload.get("generated_at", "") if prior_valid else ""
            ),
            "live_quote_success_count": live_quote_success_count,
            "fallback_used": prior_valid,
        }
        atomic_write_json(STATUS_PATH, status)
        print(
            json.dumps(
                {
                    **status,
                    "output": str(LATEST_PATH),
                },
                ensure_ascii=False,
            )
        )
        return 0 if prior_valid else 2

    global CURRENT_FX
    if args.financial_only:
        if not prior_valid:
            return retain_prior_snapshot(
                "financial_only_input",
                "financial-only mode requires a valid prior quote/FX snapshot",
            )
        CURRENT_FX = prior_payload["fx"]
        quotes = {
            company["id"]: extract_quote_data(snapshot_by_id.get(company["id"]))
            for company in companies
        }
        quote_meta = {
            **prior_payload.get("quote_meta", {}),
            "sample_count": len(companies),
            "success_count": len(companies),
            "status": "retained_for_financial_refresh",
        }
    else:
        CURRENT_FX = fetch_fx(companies)
        if CURRENT_FX.get("status") != "ok":
            return retain_prior_snapshot(
                "fx",
                CURRENT_FX.get("status", "FX refresh failed"),
            )

        try:
            quotes, quote_meta = fetch_tencent_quotes(companies)
        except Exception as exc:
            return retain_prior_snapshot("quotes", str(exc))
        if quote_meta.get("success_count") != len(companies):
            return retain_prior_snapshot(
                "quotes",
                (
                    "Tencent quotes incomplete: "
                    f"{quote_meta.get('success_count', 0)}/{len(companies)}"
                ),
                live_quote_success_count=quote_meta.get("success_count", 0),
            )

    # A valid quick run never reaches financial sources; it reuses the snapshot.
    ticker_map = {} if args.quick and prior_valid else sec_ticker_map()

    def fetch_fresh_financial(company: dict) -> dict:
        candidates: list[dict] = []
        for attempt in range(3):
            try:
                if company["market"] == "A":
                    result = fetch_a_company(company)
                elif company["market"] == "HK":
                    result = fetch_hk_company(company, ticker_map)
                else:
                    result = fetch_us_company(company, ticker_map)
            except Exception as exc:
                result = {"errors": [f"financial fetch: {exc}"]}
            source_override = official_report_source_override(company)
            source_override_report_date = (
                official_report_source_override_report_date(company)
            )
            if (
                source_override
                and result.get("report_date") == source_override_report_date
            ):
                result["official_report_source"] = source_override
            candidates.append(result)
            if (
                not missing_financial_core_fields(result)
                and not missing_financial_diagnostic_fields(result)
                and not result.get("errors")
            ):
                return result
            if attempt < 2:
                time.sleep(0.8 * (2**attempt))
        return min(
            candidates,
            key=lambda item: (
                len(missing_financial_core_fields(item)),
                len(missing_financial_diagnostic_fields(item)),
                len(item.get("errors") or []),
            ),
        )

    def fetch_one(company: dict) -> dict:
        prior_company = snapshot_by_id.get(company["id"])
        prior_financial = extract_financial_data(prior_company)
        prior_diagnostic_missing = missing_financial_diagnostic_fields(
            prior_financial
        )
        attempted = not (
            args.quick
            and prior_company is not None
            and not prior_diagnostic_missing
        )
        fallback_used = False
        refresh_errors: list[str] = []

        if not attempted:
            financial = prior_financial
            refresh_status = "reused_prior_quick"
            refresh_core_missing: list[str] = []
            refresh_missing = missing_financial_diagnostic_fields(financial)
            source_generated_at = (
                prior_company.get("financial_source_generated_at")
                or prior_payload.get("generated_at", "")
            )
        else:
            fresh = fetch_fresh_financial(company)
            # Employee counts are often point-in-time profile values rather than
            # figures from the same annual report. Keep the previously audited
            # count unless the company has no prior value at all.
            if finite_number(prior_financial.get("employees")) is not None:
                fresh["employees"] = prior_financial["employees"]
            raw_errors = fresh.get("errors", [])
            if isinstance(raw_errors, list):
                refresh_errors = [str(error) for error in raw_errors]
            elif raw_errors:
                refresh_errors = [str(raw_errors)]
            refresh_core_missing = missing_financial_core_fields(fresh)
            refresh_missing = missing_financial_diagnostic_fields(fresh)
            if (
                refresh_missing
                and prior_company
                and not prior_diagnostic_missing
            ):
                financial = prior_financial
                fallback_used = True
                refresh_status = "reused_prior_after_full_failure"
                source_generated_at = (
                    prior_company.get("financial_source_generated_at")
                    or prior_payload.get("generated_at", "")
                )
            else:
                financial = fresh
                source_generated_at = run_attempted_at
                if refresh_core_missing:
                    refresh_status = "failed_no_prior"
                elif args.quick:
                    refresh_status = (
                        "refreshed_full_quick_bootstrap_with_warnings"
                        if refresh_errors or refresh_missing
                        else "refreshed_full_quick_bootstrap"
                    )
                else:
                    refresh_status = (
                        "refreshed_full_with_warnings"
                        if refresh_errors or refresh_missing
                        else "refreshed_full"
                    )
        report_date = str(financial.get("report_date") or "")[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date):
            financial["report_period"] = (
                f"截至{report_date}年报"
                if company["market"] == "US"
                else f"{report_date[:4]}年报"
            )
        quote = quotes.get(company["id"], {})
        merged = {**company, **quote, **financial}
        merged["quote_source"] = quote_meta["source"]
        merged["quote_status"] = (
            "retained_for_financial_refresh"
            if args.financial_only
            else "fresh"
        )
        merged["financial_refresh_status"] = refresh_status
        merged["financial_refresh_mode"] = mode_requested
        merged["financial_refresh_attempted"] = attempted
        merged["financial_refresh_attempted_at"] = (
            run_attempted_at if attempted else ""
        )
        merged["financial_refresh_automatic"] = bool(attempted and not args.quick)
        merged["financial_fallback_used"] = fallback_used
        merged["financial_refresh_errors"] = refresh_errors
        merged["financial_refresh_core_missing_fields"] = refresh_core_missing
        merged["financial_refresh_missing_fields"] = refresh_missing
        merged["financial_data_missing_fields"] = (
            missing_financial_diagnostic_fields(financial)
        )
        merged["financial_source_generated_at"] = source_generated_at
        merged["financial_source_report_date"] = report_date

        rates = CURRENT_FX.get("rates_to_cny", {})
        merged["quote_fx_to_cny"] = rates.get(merged["quote_currency"])
        merged["financial_fx_to_cny"] = rates.get(merged["financial_currency"])
        # Backward-compatible aliases for dashboards that still read one currency.
        merged["currency"] = merged["quote_currency"]
        merged["fx_to_cny"] = merged["quote_fx_to_cny"]
        merged["data_quality_score"] = data_quality_score(merged)
        return merged

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            refreshed = list(executor.map(fetch_one, companies))
    except Exception as exc:
        return retain_prior_snapshot(
            "company_refresh",
            f"company refresh raised an exception: {exc}",
            live_quote_success_count=quote_meta.get("success_count", 0),
        )

    now_shanghai = datetime.now(SHANGHAI_TZ)
    today = now_shanghai.date().isoformat()
    quote_dates = [
        company.get("quote_date")
        for company in refreshed
        if company.get("quote_date")
    ]
    as_of = max(quote_dates) if quote_dates else prior_payload.get("as_of", today)
    generated_at = now_shanghai.isoformat(timespec="seconds")
    financial_refresh_meta = {
        "mode": mode_requested,
        "automatic": not args.quick,
        "attempted_count": sum(
            bool(company.get("financial_refresh_attempted"))
            for company in refreshed
        ),
        "refreshed_count": sum(
            str(company.get("financial_refresh_status", "")).startswith(
                "refreshed_full"
            )
            for company in refreshed
        ),
        "reused_quick_count": sum(
            company.get("financial_refresh_status") == "reused_prior_quick"
            for company in refreshed
        ),
        "fallback_count": sum(
            bool(company.get("financial_fallback_used"))
            for company in refreshed
        ),
        "failed_count": sum(
            company.get("financial_refresh_status") == "failed_no_prior"
            for company in refreshed
        ),
        "warning_count": sum(
            bool(company.get("financial_refresh_errors"))
            or bool(company.get("financial_refresh_missing_fields"))
            for company in refreshed
        ),
        "latest_report_date": max(
            (
                company.get("financial_source_report_date", "")
                for company in refreshed
            ),
            default="",
        ),
    }
    if financial_refresh_meta["failed_count"]:
        financial_refresh_meta["status"] = "failed"
    elif financial_refresh_meta["fallback_count"]:
        financial_refresh_meta["status"] = "partial_fallback"
    elif args.quick and financial_refresh_meta["reused_quick_count"]:
        financial_refresh_meta["status"] = "quick_reuse"
    elif financial_refresh_meta["warning_count"]:
        financial_refresh_meta["status"] = "ok_with_warnings"
    else:
        financial_refresh_meta["status"] = "ok"

    payload = {
        "system_version": "1.2",
        "as_of": as_of,
        "run_date": today,
        "generated_at": generated_at,
        "quote_date_min": min(quote_dates) if quote_dates else "",
        "quote_date_max": max(quote_dates) if quote_dates else "",
        "fx": CURRENT_FX,
        "quote_meta": quote_meta,
        "financial_refresh_meta": financial_refresh_meta,
        "sample_count": len(refreshed),
        "success_count": sum(
            1
            for company in refreshed
            if company.get("price_local") is not None
            and company.get("revenue_local_100m") is not None
        ),
        "elapsed_seconds": round(time.time() - started, 2),
        "companies": refreshed,
    }

    failed = [
        company["id"]
        for company in refreshed
        if company.get("price_local") is None
        or missing_financial_core_fields(company)
    ]
    if failed:
        return retain_prior_snapshot(
            "candidate_validation",
            f"candidate snapshot missing core data for: {', '.join(failed)}",
            live_quote_success_count=quote_meta.get("success_count", 0),
        )

    write_auto_events(make_event_rows(refreshed, today))
    append_history(refreshed, as_of)
    atomic_write_json(LATEST_PATH, payload)
    atomic_write_json(
        STATUS_PATH,
        {
            "status": (
                "ok_with_financial_fallback"
                if financial_refresh_meta["fallback_count"]
                else "ok"
            ),
            "mode_requested": mode_requested,
            "attempted_at": run_attempted_at,
            "failure_stage": "",
            "reason": "",
            "retained_snapshot_as_of": "",
            "retained_snapshot_generated_at": "",
            "live_quote_success_count": quote_meta.get("success_count", 0),
            "quote_date_min": payload["quote_date_min"],
            "quote_date_max": payload["quote_date_max"],
            "fx_date": CURRENT_FX.get("date", ""),
            "financial_refresh_meta": financial_refresh_meta,
            "fallback_used": bool(financial_refresh_meta["fallback_count"]),
        },
    )

    print(
        json.dumps(
            {
                "sample_count": len(refreshed),
                "success_count": payload["success_count"],
                "success_rate": round(payload["success_count"] / len(refreshed), 4),
                "elapsed_seconds": payload["elapsed_seconds"],
                "failed_codes": failed,
                "quote_status": quote_meta["status"],
                "quote_fresh_count": (
                    0 if args.financial_only else quote_meta["success_count"]
                ),
                "quote_fallback_count": (
                    quote_meta["success_count"] if args.financial_only else 0
                ),
                "fx_status": CURRENT_FX.get("status"),
                "financial_refresh_meta": financial_refresh_meta,
                "as_of": as_of,
                "output": str(LATEST_PATH),
            },
            ensure_ascii=False,
        )
    )
    return 0 if not failed else 2


CURRENT_FX: dict = {}

if __name__ == "__main__":
    sys.exit(main())
