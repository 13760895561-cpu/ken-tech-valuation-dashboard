#!/usr/bin/env python3
"""Build the browser-searchable security catalog from a Tencent A-share snapshot."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from pypinyin import Style, lazy_pinyin
except ImportError:  # Existing aliases keep regeneration deterministic without it.
    Style = None
    lazy_pinyin = None


CURATED_SECURITIES: list[dict[str, Any]] = [
    {"market": "HK", "code": "00700", "nameZh": "腾讯控股", "nameEn": "Tencent Holdings", "aliases": ["腾讯", "Tencent", "txkg"]},
    {"market": "HK", "code": "09988", "nameZh": "阿里巴巴", "nameEn": "Alibaba Group", "aliases": ["Alibaba", "BABA", "albb"]},
    {"market": "HK", "code": "01810", "nameZh": "小米集团", "nameEn": "Xiaomi", "aliases": ["小米", "Xiaomi", "xmjt"]},
    {"market": "HK", "code": "03690", "nameZh": "美团", "nameEn": "Meituan", "aliases": ["Meituan", "mt"]},
    {"market": "HK", "code": "09618", "nameZh": "京东集团", "nameEn": "JD.com", "aliases": ["京东", "JD", "jdjt"]},
    {"market": "HK", "code": "00981", "nameZh": "中芯国际", "nameEn": "SMIC", "aliases": ["SMIC", "zxgj"]},
    {"market": "HK", "code": "09888", "nameZh": "百度集团", "nameEn": "Baidu", "aliases": ["百度", "Baidu", "bdjt"]},
    {"market": "HK", "code": "09626", "nameZh": "哔哩哔哩", "nameEn": "Bilibili", "aliases": ["B站", "Bilibili", "blbl"]},
    {"market": "HK", "code": "00285", "nameZh": "比亚迪电子", "nameEn": "BYD Electronic", "aliases": ["BYD Electronic", "byddz"]},
    {"market": "HK", "code": "09868", "nameZh": "小鹏汽车", "nameEn": "XPeng", "aliases": ["XPeng", "x汽车", "xpqc"]},
    {"market": "US", "code": "NVDA", "nameZh": "英伟达", "nameEn": "NVIDIA", "aliases": ["Nvidia", "yingweida", "ywd"]},
    {"market": "US", "code": "AMD", "nameZh": "超威半导体", "nameEn": "Advanced Micro Devices", "aliases": ["AMD", "chaoweibandaoti", "cwbdt"]},
    {"market": "US", "code": "AVGO", "nameZh": "博通", "nameEn": "Broadcom", "aliases": ["Broadcom", "botong", "bt"]},
    {"market": "US", "code": "COHR", "nameZh": "高意", "nameEn": "Coherent", "aliases": ["Coherent"]},
    {"market": "US", "code": "LITE", "nameZh": "Lumentum", "nameEn": "Lumentum", "aliases": []},
    {"market": "US", "code": "FN", "nameZh": "Fabrinet", "nameEn": "Fabrinet", "aliases": []},
    {"market": "US", "code": "MSFT", "nameZh": "微软", "nameEn": "Microsoft", "aliases": ["Microsoft", "weiruan", "wr"]},
    {"market": "US", "code": "GOOGL", "nameZh": "谷歌", "nameEn": "Alphabet", "aliases": ["Google", "Alphabet", "guge", "gg"]},
    {"market": "US", "code": "ADBE", "nameZh": "奥多比", "nameEn": "Adobe", "aliases": ["Adobe"]},
    {"market": "US", "code": "DELL", "nameZh": "戴尔科技", "nameEn": "Dell Technologies", "aliases": ["Dell", "daier", "dekj"]},
    {"market": "US", "code": "HPE", "nameZh": "慧与科技", "nameEn": "Hewlett Packard Enterprise", "aliases": ["HPE", "huiyu", "hykj"]},
    {"market": "US", "code": "SMCI", "nameZh": "超微电脑", "nameEn": "Super Micro Computer", "aliases": ["Supermicro", "chaoweidiannao", "cwdn"]},
    {"market": "US", "code": "ARW", "nameZh": "艾睿电子", "nameEn": "Arrow Electronics", "aliases": ["Arrow"]},
    {"market": "US", "code": "AVT", "nameZh": "安富利", "nameEn": "Avnet", "aliases": ["Avnet"]},
    {"market": "US", "code": "AAPL", "nameZh": "苹果", "nameEn": "Apple", "aliases": ["Apple", "pingguo", "pg"]},
    {"market": "US", "code": "AMZN", "nameZh": "亚马逊", "nameEn": "Amazon", "aliases": ["Amazon", "yamaxun", "ymx"]},
    {"market": "US", "code": "META", "nameZh": "Meta", "nameEn": "Meta Platforms", "aliases": ["Facebook", "FB"]},
    {"market": "US", "code": "TSLA", "nameZh": "特斯拉", "nameEn": "Tesla", "aliases": ["Tesla", "tesila", "tsl"]},
    {"market": "US", "code": "PLTR", "nameZh": "帕兰提尔", "nameEn": "Palantir", "aliases": ["Palantir", "palantier", "plte"]},
    {"market": "US", "code": "ORCL", "nameZh": "甲骨文", "nameEn": "Oracle", "aliases": ["Oracle", "jiaguwen", "jgw"]},
    {"market": "US", "code": "CRM", "nameZh": "赛富时", "nameEn": "Salesforce", "aliases": ["Salesforce", "saifushi", "sfs"]},
    {"market": "US", "code": "INTC", "nameZh": "英特尔", "nameEn": "Intel", "aliases": ["Intel", "yingteer", "yte"]},
    {"market": "US", "code": "QCOM", "nameZh": "高通", "nameEn": "Qualcomm", "aliases": ["Qualcomm", "gaotong", "gt"]},
    {"market": "US", "code": "MU", "nameZh": "美光科技", "nameEn": "Micron", "aliases": ["Micron", "meiguang", "mgkj"]},
    {"market": "US", "code": "ARM", "nameZh": "Arm", "nameEn": "Arm Holdings", "aliases": []},
    {"market": "US", "code": "ASML", "nameZh": "阿斯麦", "nameEn": "ASML", "aliases": ["asimai", "asm"]},
    {"market": "US", "code": "TSM", "nameZh": "台积电", "nameEn": "Taiwan Semiconductor", "aliases": ["TSMC", "taijidian", "tjd"]},
    {"market": "US", "code": "AMAT", "nameZh": "应用材料", "nameEn": "Applied Materials", "aliases": ["Applied Materials", "yycl"]},
    {"market": "US", "code": "LRCX", "nameZh": "泛林集团", "nameEn": "Lam Research", "aliases": ["Lam Research", "fanlin", "fljt"]},
    {"market": "US", "code": "KLAC", "nameZh": "科磊", "nameEn": "KLA", "aliases": ["KLA", "kelei", "kl"]},
    {"market": "US", "code": "MRVL", "nameZh": "迈威尔科技", "nameEn": "Marvell Technology", "aliases": ["Marvell", "maiweier", "mwekj"]},
    {"market": "US", "code": "ANET", "nameZh": "Arista Networks", "nameEn": "Arista Networks", "aliases": ["Arista"]},
]


def pinyin_aliases(name: str) -> list[str]:
    if lazy_pinyin is None or Style is None:
        return []
    cleaned = re.sub(r"^[*ＮNＣCU]+", "", name, flags=re.IGNORECASE).strip()
    full = "".join(lazy_pinyin(cleaned, errors="ignore"))
    initials = "".join(lazy_pinyin(cleaned, style=Style.FIRST_LETTER, errors="ignore"))
    return list(dict.fromkeys(value for value in (full, initials) if value))


def a_exchange(code: str) -> tuple[str, str, str]:
    if code.startswith(("4", "8", "92")):
        return "BSE", "BJ", f"bj{code}"
    if code.startswith(("5", "6", "9")):
        return "SSE", "SH", f"sh{code}"
    return "SZSE", "SZ", f"sz{code}"


def candidate(market: str, code: str, name_zh: str, name_en: str = "", aliases: list[str] | None = None) -> dict[str, Any]:
    code = code.upper()
    if market == "A":
        exchange, suffix, quote_code = a_exchange(code)
        ticker = f"{code}.{suffix}"
        currency = "CNY"
    elif market == "HK":
        code = code.zfill(5)
        exchange, quote_code, ticker, currency = "HKEX", f"hk{code}", f"{code}.HK", "HKD"
    else:
        exchange, quote_code, ticker, currency = "US", f"us{code}", code, "USD"
    all_aliases = [*(aliases or []), *pinyin_aliases(name_zh)]
    if name_en:
        all_aliases.append(re.sub(r"[^a-z0-9]", "", name_en.lower()))
        all_aliases.append("".join(word[0] for word in re.findall(r"[A-Za-z0-9]+", name_en)).lower())
    return {
        "canonicalKey": f"{market}:{exchange}:{code}",
        "market": market,
        "exchange": exchange,
        "code": code,
        "ticker": ticker,
        "quoteCode": quote_code,
        "nameZh": name_zh,
        "nameEn": name_en,
        "aliases": list(dict.fromkeys(alias for alias in all_aliases if alias)),
        "currency": currency,
        "instrumentType": "stock",
        "listingStatus": "listed",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quotes", required=True)
    parser.add_argument("--seed", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    quote_payload = json.loads(Path(args.quotes).read_text(encoding="utf-8"))
    seed = json.loads(Path(args.seed).read_text(encoding="utf-8"))
    default_by_ticker = {
        item["ticker"].upper(): item["id"] for item in seed["snapshot"]["companies"]
    }

    securities: dict[str, dict[str, Any]] = {}
    for item in quote_payload.get("data", []):
        raw_code = str(item.get("code", ""))
        code_match = re.search(r"(\d{6})$", raw_code)
        name = str(item.get("name", "")).strip()
        if not code_match or not name:
            continue
        code = code_match.group(1)
        if code == "688825":
            name = "长鑫科技"
        source_aliases = item.get("aliases", [])
        entry = candidate(
            "A",
            code,
            name,
            aliases=source_aliases if isinstance(source_aliases, list) else [],
        )
        if code == "688825":
            # “长”在公司名中读 chang；通用拼音库可能按 zhang 处理，
            # 因此保留自动别名并显式补上正确全拼和常用简称。
            entry["aliases"].extend(
                ["长鑫", "ChangXin", "CXMT", "cxkj", "changxinkeji"]
            )
            entry["aliases"] = list(dict.fromkeys(entry["aliases"]))
        securities[entry["canonicalKey"]] = entry

    for item in CURATED_SECURITIES:
        entry = candidate(
            item["market"],
            item["code"],
            item["nameZh"],
            item.get("nameEn", ""),
            item.get("aliases", []),
        )
        securities[entry["canonicalKey"]] = entry

    for entry in securities.values():
        default_id = default_by_ticker.get(entry["ticker"].upper())
        if default_id:
            entry["defaultId"] = default_id

    ordered = sorted(
        securities.values(),
        key=lambda item: ({"A": 0, "HK": 1, "US": 2}[item["market"]], item["code"]),
    )
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceAsOf": quote_payload.get("meta", {}).get("update_time", ""),
        "sources": [
            {
                "name": "腾讯全市场行情证券简称",
                "url": "https://qt.gtimg.cn/",
                "note": "A股代码与简称用于本地检索；行情与正式数据仍按看板各自校验链路更新。",
            },
            {
                "name": "看板科技股补充目录",
                "url": "",
                "note": "港股、美股和常用英文别名为看板维护的补充索引。",
            },
        ],
        "securities": ordered,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(ordered)} securities to {output}")


if __name__ == "__main__":
    main()
