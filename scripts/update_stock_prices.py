#!/usr/bin/env python3
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests


class ProviderFailure(RuntimeError):
    def __init__(self, message: str, provider_errors: list[dict[str, str]]) -> None:
        super().__init__(message)
        self.provider_errors = provider_errors


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def parse_day(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return date.fromisoformat(text[:10])
    if len(text) == 8 and text.isdigit():
        return date.fromisoformat(f"{text[:4]}-{text[4:6]}-{text[6:8]}")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def format_ak_date(day: date) -> str:
    return day.strftime("%Y%m%d")


def normalize_number(value: Any, digits: int = 2) -> float | int | None:
    if value is None:
        return None
    text = str(value).replace(",", "").replace("%", "").strip()
    if text in {"", "-", "--", "nan", "None"}:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if digits == 0:
        return int(round(number))
    return round(number, digits)


def pick(row: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def active_stocks(data_dir: Path, stock_id: str = "") -> list[dict[str, Any]]:
    target = stock_id.upper()
    stocks = [row for row in read_jsonl(data_dir / "stocks.jsonl") if row.get("status") != "archived"]
    if target:
        stocks = [row for row in stocks if str(row.get("stock_id", "")).upper() == target]
    return stocks


def fetch_a_share_trade_dates(ak: Any, start_day: date, end_day: date) -> set[str]:
    if ak is None:
        return set()
    try:
        df = ak.tool_trade_date_hist_sina()
    except Exception:
        return set()
    dates = set()
    for raw in df.to_dict("records"):
        day = parse_day(raw.get("trade_date") or raw.get("日期"))
        if day and start_day <= day <= end_day:
            dates.add(day.isoformat())
    return dates


def classify_error(message: str) -> str:
    text = str(message or "")
    lowered = text.lower()
    if "proxy" in lowered or "remote end closed connection" in lowered:
        return "网络代理连接异常，已尝试备用行情源；如果仍失败，请检查代理/VPN 或稍后重试。"
    if "akshare is not installed" in lowered or "no module named" in lowered:
        return "未检测到 AkShare，A 股会尝试腾讯备用源；港股、美股仍需要后续接入对应备用源。"
    if "timeout" in lowered or "timed out" in lowered:
        return "行情接口响应超时，可以稍后重试，或缩小单次更新范围。"
    if "name resolution" in lowered or "nodename nor servname" in lowered or "failed to resolve" in lowered:
        return "网络 DNS 解析失败，请检查网络连接或代理设置。"
    if "no data" in lowered or "empty" in lowered or "返回为空" in text:
        return "接口没有返回行情，可能是停牌、代码暂不支持，或所选日期范围没有交易。"
    if "unsupported" in lowered or "暂不支持" in text:
        return "当前市场暂未接入备用行情源。"
    return "行情接口请求失败，请稍后重试；如果持续失败，可以切换网络或代理后再更新。"


def choose_start_date(stock: dict[str, Any], existing: list[dict[str, Any]], end_day: date, args: argparse.Namespace) -> date:
    explicit = parse_day(args.start_date)
    if explicit:
        return explicit

    existing_days = [
        parse_day(row.get("trade_date"))
        for row in existing
        if row.get("stock_id") == stock.get("stock_id")
    ]
    existing_days = [day for day in existing_days if day]
    if len(existing_days) >= 6:
        return max(existing_days) - timedelta(days=args.refresh_days)

    lookback_day = end_day - timedelta(days=args.lookback_days)
    return lookback_day


def fetch_stock_history(ak: Any, stock: dict[str, Any], start_day: date, end_day: date, adjust: str) -> tuple[str, Any]:
    code = str(stock.get("code") or "").upper()
    exchange = str(stock.get("exchange") or "").upper()
    start = format_ak_date(start_day)
    end = format_ak_date(end_day)

    if exchange in {"SH", "SZ", "BJ"}:
        source = "akshare.stock_zh_a_hist"
        return source, ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust=adjust)

    if exchange == "HK":
        source = "akshare.stock_hk_hist"
        try:
            return source, ak.stock_hk_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust=adjust)
        except TypeError:
            return source, ak.stock_hk_hist(symbol=code, period="daily", start_date=start, end_date=end)

    if exchange == "US":
        source = "akshare.stock_us_hist"
        try:
            return source, ak.stock_us_hist(symbol=code, period="daily", start_date=start, end_date=end, adjust=adjust)
        except TypeError:
            return source, ak.stock_us_hist(symbol=code, period="daily", start_date=start, end_date=end)

    raise ValueError(f"暂不支持 {exchange or '未知市场'} 行情更新")


def fetch_tencent_a_share_history(stock: dict[str, Any], start_day: date, end_day: date, adjust: str) -> tuple[str, list[dict[str, Any]]]:
    code = str(stock.get("code") or "").upper()
    exchange = str(stock.get("exchange") or "").upper()
    prefix = {"SH": "sh", "SZ": "sz", "BJ": "bj"}.get(exchange)
    if not prefix:
        raise ValueError(f"腾讯备用源暂不支持 {exchange or '未知市场'}")

    tencent_code = f"{prefix}{code}"
    adjust_flag = adjust if adjust in {"qfq", "hfq"} else ""
    param_parts = [tencent_code, "day", start_day.isoformat(), end_day.isoformat(), "640"]
    if adjust_flag:
        param_parts.append(adjust_flag)
    response = requests.get(
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
        params={"param": ",".join(param_parts)},
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=12,
    )
    response.raise_for_status()
    payload = response.json()
    stock_data = (payload.get("data") or {}).get(tencent_code) or {}
    rows = stock_data.get(f"{adjust_flag}day") if adjust_flag else None
    rows = rows or stock_data.get("day") or stock_data.get("qfqday") or []
    if not rows:
        raise ValueError("腾讯备用源返回为空")

    mapped = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 5:
            continue
        mapped.append({
            "date": row[0],
            "open": row[1],
            "close": row[2],
            "high": row[3],
            "low": row[4],
            "volume": row[5] if len(row) > 5 else None,
        })
    if not mapped:
        raise ValueError("腾讯备用源没有可解析的日 K 数据")
    return "tencent.fqkline", mapped


def fetch_stock_history_with_fallback(
    ak: Any,
    stock: dict[str, Any],
    start_day: date,
    end_day: date,
    adjust: str,
) -> tuple[str, list[dict[str, Any]], list[dict[str, str]]]:
    provider_errors: list[dict[str, str]] = []
    if ak is None:
        message = "akshare is not installed"
        provider_errors.append({
            "provider": "akshare",
            "error": message,
            "hint": classify_error(message),
        })
    else:
        try:
            source, df = fetch_stock_history(ak, stock, start_day, end_day, adjust)
            rows = df.to_dict("records")
            if not rows:
                raise ValueError("AkShare 返回为空")
            return source, rows, provider_errors
        except Exception as exc:  # noqa: BLE001 - provider fallback should include original reason.
            message = str(exc)
            provider_errors.append({
                "provider": "akshare",
                "error": message,
                "hint": classify_error(message),
            })

    exchange = str(stock.get("exchange", "")).upper()
    if exchange in {"SH", "SZ", "BJ"}:
        try:
            source, rows = fetch_tencent_a_share_history(stock, start_day, end_day, adjust)
            return source, rows, provider_errors
        except Exception as exc:  # noqa: BLE001 - final failure should include both providers.
            message = str(exc)
            provider_errors.append({
                "provider": "tencent",
                "error": message,
                "hint": classify_error(message),
            })

    combined = "；".join(f"{item['provider']}: {item['error']}" for item in provider_errors)
    raise ProviderFailure(combined or "行情接口全部失败", provider_errors)


def normalize_price_rows(
    stock: dict[str, Any],
    source: str,
    rows: list[dict[str, Any]],
    adjust: str,
    captured_at: str,
    valid_trade_dates: set[str] | None = None,
) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        day = parse_day(pick(row, ["日期", "date", "trade_date"]))
        close = normalize_number(pick(row, ["收盘", "close", "收盘价"]))
        if not day or close is None:
            continue
        if valid_trade_dates is not None and day.isoformat() not in valid_trade_dates:
            continue
        normalized.append({
            "stock_id": stock["stock_id"],
            "trade_date": day.isoformat(),
            "open": normalize_number(pick(row, ["开盘", "open", "开盘价"])),
            "close": close,
            "high": normalize_number(pick(row, ["最高", "high", "最高价"])),
            "low": normalize_number(pick(row, ["最低", "low", "最低价"])),
            "prev_close": None,
            "change_amount": normalize_number(pick(row, ["涨跌额", "change_amount", "涨跌"])),
            "pct_change": normalize_number(pick(row, ["涨跌幅", "pct_change", "涨幅"])),
            "volume": normalize_number(pick(row, ["成交量", "volume"]), 0),
            "amount": normalize_number(pick(row, ["成交额", "amount", "成交金额"])),
            "amplitude": normalize_number(pick(row, ["振幅", "amplitude"])),
            "turnover": normalize_number(pick(row, ["换手率", "turnover"])),
            "adjust": adjust,
            "source": source,
            "captured_at": captured_at,
        })

    normalized.sort(key=lambda item: item["trade_date"])
    previous_close = None
    for item in normalized:
        item["prev_close"] = previous_close
        if item["pct_change"] is None and previous_close:
            item["pct_change"] = round(((item["close"] / previous_close) - 1) * 100, 2)
        if item["change_amount"] is None and previous_close:
            item["change_amount"] = round(item["close"] - previous_close, 2)
        previous_close = item["close"]
    return normalized


def upsert_prices(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in existing + incoming:
        key = (str(row.get("stock_id", "")), str(row.get("trade_date", "")), str(row.get("adjust") or "qfq"))
        if key[0] and key[1]:
            by_key[key] = row
    return sorted(by_key.values(), key=lambda item: (item.get("stock_id", ""), item.get("trade_date", ""), item.get("adjust", "")))


def keep_existing_price(
    row: dict[str, Any],
    active_ids: set[str],
    exchange_by_id: dict[str, str] | None = None,
    valid_trade_dates: set[str] | None = None,
) -> bool:
    if row.get("stock_id") not in active_ids:
        return False
    if row.get("source") == "test":
        return False
    exchange = (exchange_by_id or {}).get(str(row.get("stock_id")), "")
    day = parse_day(row.get("trade_date"))
    if exchange in {"SH", "SZ", "BJ"} and valid_trade_dates and day and day.isoformat() not in valid_trade_dates:
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Update real daily prices for active watchlist stocks only.")
    parser.add_argument("--data-dir", required=True, help="stock_tracking data directory")
    parser.add_argument("--stock-id", default="", help="optional stock_id, e.g. SH.688981")
    parser.add_argument("--start-date", default="", help="optional YYYY-MM-DD or YYYYMMDD")
    parser.add_argument("--end-date", default="", help="optional YYYY-MM-DD or YYYYMMDD")
    parser.add_argument("--adjust", default="qfq", choices=["", "qfq", "hfq"], help="AkShare adjust option")
    parser.add_argument("--lookback-days", type=int, default=120, help="initial fetch window when no price exists")
    parser.add_argument("--refresh-days", type=int, default=7, help="overlap window when refreshing existing prices")
    args = parser.parse_args()

    try:
        import akshare as ak
    except ModuleNotFoundError:
        ak = None

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    price_path = data_dir / "daily_prices.jsonl"
    meta_path = data_dir / "price_update_meta.json"
    captured_at = datetime.now(timezone.utc).isoformat()
    end_day = parse_day(args.end_date) or date.today()
    all_active_stocks = active_stocks(data_dir)
    active_ids = {str(stock.get("stock_id")) for stock in all_active_stocks if stock.get("stock_id")}
    exchange_by_id = {
        str(stock.get("stock_id")): str(stock.get("exchange", "")).upper()
        for stock in all_active_stocks
        if stock.get("stock_id")
    }
    existing = [row for row in read_jsonl(price_path) if keep_existing_price(row, active_ids)]
    stocks = active_stocks(data_dir, args.stock_id)
    earliest_start = min((choose_start_date(stock, existing, end_day, args) for stock in stocks), default=end_day)
    existing_a_share_days = [
        day for row in existing
        if exchange_by_id.get(str(row.get("stock_id"))) in {"SH", "SZ", "BJ"}
        for day in [parse_day(row.get("trade_date"))]
        if day
    ]
    calendar_start = min([earliest_start, *existing_a_share_days], default=earliest_start)
    a_share_trade_dates = fetch_a_share_trade_dates(ak, calendar_start, end_day) if any(
        str(stock.get("exchange", "")).upper() in {"SH", "SZ", "BJ"} for stock in stocks
    ) else set()
    if a_share_trade_dates:
        existing = [
            row for row in existing
            if keep_existing_price(row, active_ids, exchange_by_id, a_share_trade_dates)
        ]

    incoming: list[dict[str, Any]] = []
    items = []
    failures = []
    for stock in stocks:
        try:
            start_day = choose_start_date(stock, existing, end_day, args)
            source, raw_rows, provider_errors = fetch_stock_history_with_fallback(ak, stock, start_day, end_day, args.adjust)
            valid_trade_dates = a_share_trade_dates if str(stock.get("exchange", "")).upper() in {"SH", "SZ", "BJ"} and a_share_trade_dates else None
            rows = normalize_price_rows(stock, source, raw_rows, args.adjust, captured_at, valid_trade_dates)
            if not rows:
                raise ValueError("行情接口返回为空或全部被交易日历过滤")
            incoming.extend(rows)
            latest_trade_date = rows[-1]["trade_date"] if rows else ""
            items.append({
                "stock_id": stock.get("stock_id"),
                "name": stock.get("name"),
                "rows": len(rows),
                "start_date": start_day.isoformat(),
                "end_date": end_day.isoformat(),
                "latest_trade_date": latest_trade_date,
                "source": source,
                "used_fallback": bool(provider_errors),
                "provider_errors": provider_errors,
            })
        except Exception as exc:  # noqa: BLE001 - keep one-stock failure isolated.
            error_message = str(exc)
            provider_errors = getattr(exc, "provider_errors", [])
            failures.append({
                "stock_id": stock.get("stock_id"),
                "name": stock.get("name"),
                "error": error_message,
                "hint": classify_error(error_message),
                "provider_errors": provider_errors,
            })

    merged = upsert_prices(existing, incoming)
    write_jsonl(price_path, merged)
    latest_trade_date = max((row.get("trade_date", "") for row in merged), default="")
    result = {
        "ok": not failures,
        "updated": len(items),
        "failed": len(failures),
        "price_count": len(merged),
        "stock_count": len({row.get("stock_id") for row in merged if row.get("stock_id")}),
        "latest_trade_date": latest_trade_date,
        "items": items,
        "failures": failures,
        "fallback_count": len([item for item in items if item.get("used_fallback")]),
    }
    sources = sorted({str(item.get("source")) for item in items if item.get("source")})
    meta = {
        "source": " / ".join(sources) if sources else "akshare",
        "adjust": args.adjust,
        "updated_at": captured_at,
        "last_result": result,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
