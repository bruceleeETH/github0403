#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def infer_exchange(code: str) -> str:
    code = str(code or "").strip().upper()
    if code.startswith(("6", "9")):
        return "SH"
    if code.startswith(("0", "2", "3")):
        return "SZ"
    if code.startswith(("4", "8")):
        return "BJ"
    return "CN"


def normalize_a_share_row(row: dict, updated_at: str) -> dict:
    code = str(row.get("code") or row.get("代码") or "").strip().upper()
    name = str(row.get("name") or row.get("名称") or "").strip()
    exchange = infer_exchange(code)
    return {
        "stock_id": f"{exchange}.{code}",
        "code": code,
        "exchange": exchange,
        "name": name,
        "market": "A股",
        "industry": "",
        "source": "akshare",
        "updated_at": updated_at,
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Update local stock catalog from AkShare.")
    parser.add_argument("--data-dir", required=True, help="stock_tracking data directory")
    args = parser.parse_args()

    try:
        import akshare as ak
    except ModuleNotFoundError as exc:
        raise SystemExit("No module named 'akshare'. Install with: pip install akshare") from exc

    updated_at = datetime.now(timezone.utc).isoformat()
    catalog_dir = Path(args.data_dir) / "catalog"
    catalog_dir.mkdir(parents=True, exist_ok=True)

    stock_df = ak.stock_info_a_code_name()
    records = []
    seen = set()
    for raw in stock_df.to_dict("records"):
        record = normalize_a_share_row(raw, updated_at)
        if not record["code"] or not record["name"] or record["stock_id"] in seen:
            continue
        seen.add(record["stock_id"])
        records.append(record)

    records.sort(key=lambda item: (item["exchange"], item["code"]))
    markets = {"A股": len(records)}
    meta = {
        "source": "akshare",
        "updated_at": updated_at,
        "total": len(records),
        "markets": markets,
        "reserved_markets": ["港股", "美股"],
    }

    write_jsonl(catalog_dir / "stock_universe.jsonl", records)
    (catalog_dir / "update_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "total": len(records), "markets": markets}, ensure_ascii=False))


if __name__ == "__main__":
    main()
