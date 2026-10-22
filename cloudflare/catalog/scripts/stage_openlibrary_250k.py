#!/usr/bin/env python3
"""Stage up to 250,000 unique Open Library works from the official bulk dump."""
import gzip, json, os, re, time, urllib.request
from pathlib import Path

URL = "https://openlibrary.org/data/ol_dump_works_latest.txt.gz"
TARGET = 250000
DEST = Path("openlibrary-250k-works.jsonl.gz")
KEY = re.compile(r"^/works/(OL[0-9]+W)$")
seen = set()
count = 0
request = urllib.request.Request(URL, headers={
    "User-Agent": "PaperGremlinBulkCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"
})
with urllib.request.urlopen(request, timeout=180) as response:
    with gzip.GzipFile(fileobj=response, mode="rb") as source:
        with gzip.open(DEST, "wt", encoding="utf-8", compresslevel=6) as output:
            for raw in source:
                try:
                    parts = raw.decode("utf-8").rstrip("\n").split("\t", 4)
                    if len(parts) != 5: continue
                    match = KEY.fullmatch(parts[1])
                    if not match or match.group(1) in seen: continue
                    doc = json.loads(parts[4])
                    title = doc.get("title")
                    if not isinstance(title, str) or not title.strip(): continue
                    seen.add(match.group(1))
                    authors = [
                        a.get("author", {}).get("key", "").split("/")[-1]
                        for a in doc.get("authors", [])
                        if isinstance(a, dict) and isinstance(a.get("author"), dict)
                    ]
                    row = {
                        "work_key": match.group(1), "title": title,
                        "description": (doc.get("description", {}).get("value") if isinstance(doc.get("description"), dict) else doc.get("description")),
                        "first_publish_date": doc.get("first_publish_date"),
                        "subjects": doc.get("subjects", [])[:20],
                        "author_keys": authors,
                        "cover_ids": doc.get("covers", [])[:1],
                    }
                    output.write(json.dumps(row, ensure_ascii=False) + "\n")
                    count += 1
                    if count % 25000 == 0: print(f"Staged {count:,} works", flush=True)
                    if count >= TARGET: break
                except (ValueError, UnicodeDecodeError, TypeError, AttributeError):
                    continue
if count != TARGET:
    raise RuntimeError(f"Dump yielded only {count} usable unique works (expected {TARGET})")
print(f"Successfully staged {count:,} unique works; compressed artifact bytes={DEST.stat().st_size}")
