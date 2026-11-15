#!/usr/bin/env python3
"""Prepare only complete, source-verified new works for the 100K D1 catalog.

Does not repair existing rows. Refuses to advance the import cursor when the
staged record lacks a usable author, cover or required catalog metadata.
"""
import argparse
import gzip
import json
import re
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
    subjects = d.get("subjects") or []
    if not re.fullmatch(r"OL[0-9]+W", str(key)):
        raise ValueError("Invalid work key")
    if not isinstance(title, str) or not title.strip():
        raise ValueError(f"{key}: missing title")
    if not year:
        raise ValueError(f"{key}: missing first publication year")
    if not (isinstance(covers, list) and covers and isinstance(covers[0], int) and covers[0] > 0):
        raise ValueError(f"{key}: missing cover")
    if not (isinstance(subjects, list) and any(isinstance(s, str) and s.strip() for s in subjects)):
        raise ValueError(f"{key}: missing subjects")
    if not isinstance(authors, list) or not authors:
        raise ValueError(f"{key}: missing resolved author names")
    clean = []
    for author in authors:
        aid, name = author.get("author_key"), author.get("name")
        if not re.fullmatch(r"OL[0-9]+A", str(aid)) or not isinstance(name, str) or not name.strip():
            raise ValueError(f"{key}: invalid author metadata")
        clean.append((aid, name.strip()))
    return int(year.group()), clean

out = Path("batches")
out.mkdir(exist_ok=True)
for old in out.glob("*.sql"):
    old.unlink()
count = chunks = 0
lines = []
with gzip.open("paper-gremlin-priority-100k.jsonl.gz", "rt", encoding="utf-8") as source:
    for i, raw in enumerate(source):
        if i < a.start:
            continue
        if count >= a.count:
            break
        d = json.loads(raw)
        year, authors = required(d)
        key, title = d["work_key"], d["title"].strip()
        cover = d["cover_ids"][0]
        subjects = [s.strip() for s in d["subjects"] if isinstance(s, str) and s.strip()][:20]
        subtitle = d.get("subtitle") if isinstance(d.get("subtitle"), str) else None
        url = f"https://covers.openlibrary.org/b/id/{cover}-M.jpg"
        # Never overwrite a pre-existing row: legacy gaps are explicitly deferred.
        lines.append(
            "INSERT OR IGNORE INTO works(work_key,title,subtitle,first_publish_year,cover_url,subjects_json) VALUES ("
            + ",".join(q(x) for x in (key, title, subtitle, year, url, json.dumps(subjects, ensure_ascii=False))) + ");"
        )
        for aid, name in authors:
            lines.append(f"INSERT OR IGNORE INTO authors(author_key,name) VALUES ({q(aid)},{q(name)});")
            lines.append(f"INSERT OR IGNORE INTO work_authors(work_key,author_key) VALUES ({q(key)},{q(aid)});")
        # FTS entries now contain the same actual author names as the catalog.
        author_names = " ".join(name for _, name in authors)
        lines.append(f"INSERT INTO works_fts(work_key,title,author_names) SELECT {q(key)},{q(title)},{q(author_names)} WHERE NOT EXISTS(SELECT 1 FROM works_fts WHERE work_key={q(key)});")
        edition = d.get("edition")
        if edition:
            eid = edition.get("edition_key")
            if not re.fullmatch(r"OL[0-9]+M", str(eid)):
                raise ValueError(f"{key}: invalid edition identifier")
            vals = (eid, key, edition.get("title"), edition.get("publisher"),
                    edition.get("publish_date"), edition.get("isbn_10"), edition.get("isbn_13"))
            lines.append("INSERT OR IGNORE INTO editions(edition_key,work_key,title,publisher,publish_date,isbn_10,isbn_13) VALUES (" +
                         ",".join(q(v) for v in vals) + ");")
        count += 1
        if count % a.chunk == 0:
            (out / f"{chunks:06}.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
            chunks += 1
            lines = []
if lines:
    (out / f"{chunks:06}.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    chunks += 1
if not count:
    raise RuntimeError("No work rows at requested offset")
print(f"Prepared {count} validated work rows in {chunks} SQL batches from offset {a.start}")
