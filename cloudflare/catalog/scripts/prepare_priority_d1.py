#!/usr/bin/env python3
"""Prepare only complete, source-verified new works for the 100K D1 catalog.

Require title, resolved author and cover. Keep year and subjects when available.
Each batch covers exactly one source window.
"""
import argparse
import gzip
import json
import re
import sys
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--start", type=int, required=True)
p.add_argument("--count", type=int, default=3000)
p.add_argument("--chunk", type=int, default=100)
p.add_argument("--editions", default=None)
a = p.parse_args()
if a.start < 0 or a.count < 1 or a.chunk < 1 or a.count % a.chunk:
    p.error("start >= 0, count > 0, chunk > 0 and count must be divisible by chunk")
if a.editions:
    p.error("Edition data must be part of each validated staged record; separate maps are not supported")

def q(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"

def required(d):
    key = d.get("work_key")
    title = d.get("title")
    year = re.search(r"\b(1[5-9][0-9]{2}|20[0-9]{2})\b", str(d.get("first_publish_date") or ""))
    covers = d.get("cover_ids") or []
    authors = d.get("authors") or []
    if not re.fullmatch(r"OL[0-9]+W", str(key)):
        raise ValueError("Invalid work key")
    if not isinstance(title, str) or not title.strip():
        raise ValueError(f"{key}: missing title")
    if not (isinstance(covers, list) and covers and isinstance(covers[0], int) and covers[0] > 0):
        raise ValueError(f"{key}: missing cover")
    if not isinstance(authors, list) or not authors:
        raise ValueError(f"{key}: missing resolved author names")
    clean = []
    for author in authors:
        if not isinstance(author, dict):
            raise ValueError(f"{key}: invalid author metadata")
        aid, name = author.get("author_key"), author.get("name")
        if not re.fullmatch(r"OL[0-9]+A", str(aid)) or not isinstance(name, str) or not name.strip():
            raise ValueError(f"{key}: invalid author metadata")
        clean.append((aid, name.strip()))
    return int(year.group()) if year else None, clean

out = Path("batches")
out.mkdir(exist_ok=True)
for old in out.glob("*.sql"):
    old.unlink()
count = chunks = skipped = 0
lines = []
with gzip.open("paper-gremlin-priority-100k.jsonl.gz", "rt", encoding="utf-8") as source:
    for i, raw in enumerate(source):
        if i < a.start:
            continue
        if count >= a.count:
            break
        count += 1
        try:
            d = json.loads(raw)
            if not isinstance(d, dict):
                raise ValueError('Invalid source record')
            year, authors = required(d)
            edition = d.get('edition')
            if edition and (not isinstance(edition, dict) or not re.fullmatch(r'OL[0-9]+M', str(edition.get('edition_key')))):
                raise ValueError(f"{d.get('work_key')}: invalid edition identifier")
        except (ValueError, TypeError, AttributeError) as exc:
            skipped += 1
            print(f'Skipping source offset {i}: {exc}', file=sys.stderr)
            if count % a.chunk == 0:
                (out / f"{chunks:06}.sql").write_text("\n".join(lines) + "\n" if lines else "-- empty source window\n", encoding="utf-8")
                chunks += 1
                lines = []
            continue
        key, title = d["work_key"], d["title"].strip()
        cover = d["cover_ids"][0]
        source_subjects = d.get("subjects")
        subjects = [s.strip() for s in source_subjects if isinstance(s, str) and s.strip()][:20] if isinstance(source_subjects, list) else []
        subtitle = d.get("subtitle") if isinstance(d.get("subtitle"), str) else None
        url = f"https://covers.openlibrary.org/b/id/{cover}-M.jpg"
        # Never overwrite a pre-existing row: legacy gaps are explicitly deferred.
        lines.append(
            "INSERT OR IGNORE INTO works(work_key,title,subtitle,first_publish_year,cover_url,subjects_json) VALUES ("
            + ",".join(q(x) for x in (key, title, subtitle, year, url, json.dumps(subjects, ensure_ascii=False))) + ");"
        )
        # The immediately preceding INSERT OR IGNORE into works gives changes()=1
        # only for a newly added work. Avoid scanning the entire FTS table.
        author_names = " ".join(name for _, name in authors)
        lines.append(f"INSERT INTO works_fts(work_key,title,author_names) SELECT {q(key)},{q(title)},{q(author_names)} WHERE changes()=1;")
        for aid, name in authors:
            lines.append(f"INSERT OR IGNORE INTO authors(author_key,name) VALUES ({q(aid)},{q(name)});")
            lines.append(f"INSERT OR IGNORE INTO work_authors(work_key,author_key) VALUES ({q(key)},{q(aid)});")
        edition = d.get("edition")
        if edition:
            eid = edition.get("edition_key")
            if not re.fullmatch(r"OL[0-9]+M", str(eid)):
                raise ValueError(f"{key}: invalid edition identifier")
            vals = (eid, key, edition.get("title"), edition.get("publisher"),
                    edition.get("publish_date"), edition.get("isbn_10"), edition.get("isbn_13"))
            lines.append("INSERT OR IGNORE INTO editions(edition_key,work_key,title,publisher,publish_date,isbn_10,isbn_13) VALUES (" +
                         ",".join(q(v) for v in vals) + ");")
        if count % a.chunk == 0:
            (out / f"{chunks:06}.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
            chunks += 1
            lines = []
if count != a.count:
    raise RuntimeError(f'Source ended early: expected {a.count}, scanned {count}; refusing cursor advance')
print(f'Prepared {count-skipped} validated works; skipped {skipped}; {chunks} source windows from offset {a.start}')
