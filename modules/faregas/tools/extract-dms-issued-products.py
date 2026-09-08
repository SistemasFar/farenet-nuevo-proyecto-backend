#!/usr/bin/env python3
"""Extract exact site-to-SKU evidence from DMS Fact issued-document exports.

The script reads the DMS XLSX format with Python's standard library only. It
does not modify the source workbooks or connect to PostgreSQL/Nubefact.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
CELL_REF = re.compile(r"([A-Z]+)(\d+)")
DOCUMENT_NUMBER = re.compile(r"([A-Z]+\d+)-(\d+)")


def column_index(reference: str) -> int:
    match = CELL_REF.fullmatch(reference)
    if not match:
        raise ValueError(f"Referencia de celda inválida: {reference}")
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.text or "" for node in item.findall(".//a:t", NS))
            for item in root.findall("a:si", NS)]


def cell_value(cell: ET.Element, strings: list[str]):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//a:t", NS))
    value_node = cell.find("a:v", NS)
    if value_node is None:
        return None
    raw = value_node.text or ""
    if cell_type == "s":
        return strings[int(raw)]
    if cell_type in {"str", "b"}:
        return raw
    try:
        return Decimal(raw)
    except InvalidOperation:
        return raw


def first_worksheet_rows(path: Path):
    with ZipFile(path) as archive:
        strings = shared_strings(archive)
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for row in root.findall(".//a:sheetData/a:row", NS):
            values: dict[int, object] = {}
            for cell in row.findall("a:c", NS):
                values[column_index(cell.attrib["r"])] = cell_value(cell, strings)
            yield int(row.attrib["r"]), values


def text(value) -> str:
    return str(value or "").strip()


def decimal(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except InvalidOperation as error:
        raise ValueError(f"Importe inválido en el reporte DMS: {value}") from error


def issue_date(value) -> str:
    if isinstance(value, Decimal):
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    raw = text(value)
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"Fecha de emisión DMS no reconocida: {raw}")


def extract(files: list[Path], series: set[str], accepted_status: str) -> list[dict]:
    records: dict[tuple, dict] = {}
    for path in files:
        if not path.is_file():
            raise FileNotFoundError(path)
        for row_number, row in first_worksheet_rows(path):
            if row_number < 8:
                continue
            number = text(row.get(1)).upper()
            match = DOCUMENT_NUMBER.fullmatch(number)
            if not match or match.group(1) not in series:
                continue
            status = text(row.get(17))
            if status.casefold() != accepted_status.casefold():
                continue
            record = {
                "source": path.name,
                "document_type": text(row.get(0)),
                "document_number": number,
                "series": match.group(1),
                "sequence": int(match.group(2)),
                "issue_date": issue_date(row.get(2)),
                "status": status,
                "sku": text(row.get(34)),
                "description": text(row.get(35)),
                "unit": text(row.get(36)).upper(),
                "quantity": decimal(row.get(37)),
                "unit_value": decimal(row.get(39)),
                "reference_price": decimal(row.get(40)),
                "item_total": decimal(row.get(44)),
            }
            key = (record["document_number"], record["sku"], record["description"],
                   record["unit"], record["reference_price"])
            records[key] = record
    return list(records.values())


def aggregate(records: list[dict]) -> list[dict]:
    groups = defaultdict(lambda: {"invoices": set(), "receipts": set(), "dates": set()})
    for record in records:
        key = (record["sku"], record["description"], record["unit"], record["reference_price"])
        destination = "invoices" if record["series"].startswith("FE") else "receipts"
        groups[key][destination].add(record["document_number"])
        groups[key]["dates"].add(record["issue_date"])
    return [{
        "sku": key[0],
        "description": key[1],
        "unit": key[2],
        "reference_price": float(key[3]),
        "invoices": len(group["invoices"]),
        "receipts": len(group["receipts"]),
        "last_date": max(group["dates"]),
    } for key, group in sorted(groups.items())]


def print_markdown(rows: list[dict]) -> None:
    print("| SKU | Descripción | Unidad | Precio ref. | Facturas | Boletas | Última fecha |")
    print("|---|---|---|---:|---:|---:|---|")
    for row in rows:
        print(f"| {row['sku']} | {row['description']} | {row['unit']} | "
              f"{row['reference_price']:.2f} | {row['invoices']} | "
              f"{row['receipts']} | {row['last_date']} |")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="Exportes XLSX de DMS Fact")
    parser.add_argument("--series", action="append", required=True,
                        help="Serie permitida; repetir, por ejemplo --series FE15 --series BE15")
    parser.add_argument("--status", default="Aceptado", help="Estado DMS requerido")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    args = parser.parse_args()

    records = extract(args.files, {value.strip().upper() for value in args.series}, args.status)
    rows = aggregate(records)
    if args.format == "json":
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print_markdown(rows)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, KeyError, ET.ParseError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
