#!/usr/bin/env python3
"""Generate D1 SQL batches of editions linked to imported Open Library works.

Run after import_openlibrary.py work batches. All operations are local until
the generated SQL is explicitly applied via Wrangler. No HTTP requests.
"""
import argparse
import gzip
import json
import pathlib
import re
import sqlite3

KEYS = re.compile(r"^/(?:works|books)/(OL[0-9]+[WM])$")


def records(path):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as source:
        for line in source:
            parts = line.rstrip("\n").split("\t", 4)
            if len(parts) != 5:
                continue
            try:
                obj = json.loads(parts[-1])
            except (ValueError, TypeError):
                continue
            if isinstance(obj, dict):
                yield obj


def identifier(value, suffix):
    path = value.get("key") if isinstance(value, dict) else value
    match = KEYS.fullmatch(path) if isinstance(path, str) else None
    if match and match.group(1).endswith(suffix):
        return match.group(1)
    return None


def sql_string(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def first_isbn(entry, field, pattern):
    values = entry.get(field)
    if not isinstance(values, list):
        return None
    return next((v for v in values if isinstance(v, str) and re.fullmatch(pattern, v)), None)


def build(args):
    if args.limit < 0 or not 1 <= args.batch_size <= 500:
        raise ValueError("limit must be >= 0 and batch-size between 1 and 500")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(out / "edition_work_keys.sqlite"))
    db.execute("CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY)")
    db.execute("DELETE FROM works")
    selected = 0
    for work in records(args.works):
        key = identifier(work, "W")
        title = work.get("title")
        if not key or not isinstance(title, str) or not title.strip():
            continue
        db.execute("INSERT OR IGNORE INTO works (id) VALUES (?)", (key,))
        selected += 1
        if args.limit and selected >= args.limit:
            break
    db.commit()

    for old in out.glob("editions_??????.sql"):
        old.unlink()

    count = batch = 0
    statements = []

    def write_batch():
        nonlocal batch, statements
        if not statements:
            return
        batch += 1
        (out / f"editions_{batch:06d}.sql").write_text(
            "\n".join(statements) + "\n", encoding="utf-8")
        statements = []

    for edition in records(args.editions):
        eid = identifier(edition, "M")
        if not eid:
            continue
        works = edition.get("works")
        if not isinstance(works, list):
            continue
        matched = None
        for candidate in works:
            work_id = identifier(candidate, "W")
            if work_id and db.execute("SELECT 1 FROM works WHERE id=?", (work_id,)).fetchone():
                matched = work_id
                break
        if not matched:
            continue
        publishers = edition.get("publishers")
        publisher = next((p for p in publishers if isinstance(p, str)), None) if isinstance(publishers, list) else None
        title = edition.get("title")
        date = edition.get("publish_date")
        fields = {
            "edition_key": eid, "work_key": matched,
            "title": title if isinstance(title, str) else None,
            "publisher": publisher,
            "publish_date": date if isinstance(date, str) else None,
            "isbn_10": first_isbn(edition, "isbn_10", r"[0-9]{9}[0-9Xx]"),
            "isbn_13": first_isbn(edition, "isbn_13", r"[0-9]{13}"),
        }
        cols = ", ".join(fields)
        vals = ", ".join(sql_string(v) for v in fields.values())
        updates = ", ".join(f"{col}=excluded.{col}" for col in fields if col != "edition_key")
        statements.append(
            f"INSERT INTO editions ({cols}) VALUES ({vals}) "
            f"ON CONFLICT(edition_key) DO UPDATE SET {updates};")
        count += 1
        if count % args.batch_size == 0:
            write_batch()
    write_batch()
    db.close()
    print(f"Prepared {count} editions across {batch} SQL batches for {selected} selected works. No remote changes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--works", required=True, help="The same work dump used in the work import")
    parser.add_argument("--editions", required=True, help="Open Library editions dump (.txt or .txt.gz)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=1000, help="Match the work import limit (0 = all)")
    parser.add_argument("--batch-size", type=int, default=100)
    build(parser.parse_args())
