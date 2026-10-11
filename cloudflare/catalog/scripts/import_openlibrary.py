#!/usr/bin/env python3
"""Convert Open Library tab-separated bulk dumps into resumable D1 SQL batches.

Usage:
  python3 import_openlibrary.py --works ol_dump_works_latest.txt.gz --authors ol_dump_authors_latest.txt.gz --out ./batches --limit 1000
  # Run generated SQL in order with: npx wrangler d1 execute paper-gremlin-catalog --remote --file=./batches/000001.sql

Open Library dump format: type<TAB>key<TAB>revision<TAB>last_modified<TAB>JSON.
No live API calls, credentials, or network access. Begin with a small --limit.
"""
import argparse
import gzip
import json
import pathlib
import re
import sqlite3

def records(path):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as stream:
        for line in stream:
            cols = line.rstrip("\n").split("\t", 4)
            if len(cols) != 5:
                continue
            try:
                yield json.loads(cols[4])
            except (ValueError, TypeError):
                continue

def key(value, kind):
    raw = value.get("key", "") if isinstance(value, dict) else str(value or "")
    m = re.fullmatch(r"/" + kind + r"/(OL\d+[AW])", raw)
    return m.group(1) if m else None

def quote(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"

def statement(table, fields):
    names = ", ".join(fields)
    values = ", ".join(quote(v) for v in fields.values())
    return f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({values});"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--works", required=True)
    ap.add_argument("--authors", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=1000, help="Maximum works (0 means unlimited)")
    ap.add_argument("--batch-size", type=int, default=100, help="Works per SQL file")
    args = ap.parse_args()
    if args.limit < 0 or args.batch_size < 1 or args.batch_size > 500:
        ap.error("limit must be >= 0 and batch-size between 1 and 500")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # SQLite disk-backed lookup avoids holding millions of authors in memory.
    cache = sqlite3.connect(str(out / "authors_lookup.sqlite"))
    cache.execute("CREATE TABLE IF NOT EXISTS authors (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    for author in records(args.authors):
        aid = key(author, "authors")
        name = author.get("name")
        if aid and isinstance(name, str) and name.strip():
            cache.execute("INSERT OR REPLACE INTO authors VALUES (?,?)", (aid, name.strip()))
    cache.commit()

    counter = 0
    batch_no = 0
    sql = []
    for work in records(args.works):
        wid = key(work, "works")
        title = work.get("title")
        if not wid or not isinstance(title, str) or not title.strip():
            continue
        raw_authors = work.get("authors", [])
        linked = []
        for item in raw_authors if isinstance(raw_authors, list) else []:
            a = item.get("author", item) if isinstance(item, dict) else {}
            aid = key(a, "authors")
            if aid:
                row = cache.execute("SELECT name FROM authors WHERE id=?", (aid,)).fetchone()
                if row:
                    linked.append((aid, row[0]))
        year_match = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", str(work.get("first_publish_date", "")))
        year = int(year_match.group(1)) if year_match else None
        covers = work.get("covers", [])
        cover_id = next((x for x in covers if isinstance(x, int) and x > 0), None) if isinstance(covers, list) else None
        subjects = [s for s in work.get("subjects", []) if isinstance(s, str)][:30] if isinstance(work.get("subjects"), list) else []
        sql.append(statement("works", {"work_key": wid, "title": title.strip(), "subtitle": work.get("subtitle") if isinstance(work.get("subtitle"), str) else None, "first_publish_year": year, "cover_url": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else None, "subjects_json": json.dumps(subjects, ensure_ascii=False)}))
        for aid, name in linked:
            sql.append(statement("authors", {"author_key": aid, "name": name}))
            sql.append(statement("work_authors", {"work_key": wid, "author_key": aid}))
        # Refresh FTS for re-imports as well as first-time inserts.
        sql.append(f"DELETE FROM works_fts WHERE work_key={quote(wid)};")
        sql.append(statement("works_fts", {"work_key": wid, "title": title.strip(), "author_names": " ".join(name for _, name in linked)}))
        counter += 1
        if counter % args.batch_size == 0:
            batch_no += 1
            (out / f"{batch_no:06d}.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
            sql = []
        if args.limit and counter >= args.limit:
            break
    if sql:
        batch_no += 1
        (out / f"{batch_no:06d}.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    cache.close()
    print(f"Prepared {counter} works in {batch_no} SQL files. No remote changes were made.")

if __name__ == "__main__":
    main()
