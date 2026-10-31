#!/usr/bin/env python3
"""Fetch a bounded set of ISBN-bearing editions before the daily work import.

This is a small API pre-enrichment pass, not a replacement for a bulk editions
snapshot. We deliberately limit calls so normal book imports stay practical.
"""
import argparse, gzip, json, re, time, urllib.error, urllib.request
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--start", type=int, required=True)
p.add_argument("--count", type=int, default=3000)
p.add_argument("--max-lookups", type=int, default=100)
p.add_argument("--out", default="preimport-editions.json")
a = p.parse_args()
if a.start < 0 or a.count < 1 or not 0 <= a.max_lookups <= 100:
    raise ValueError("Invalid offset/count or API request budget")

def valid(value):
    s = re.sub(r"[-\s]", "", str(value)).upper()
    if re.fullmatch(r"[0-9]{9}[0-9X]", s):
        return s if sum((10-i)*(10 if c == "X" else int(c)) for i,c in enumerate(s)) % 11 == 0 else None
    if re.fullmatch(r"97[89][0-9]{10}", s):
        return s if sum(int(c)*(1 if i%2 == 0 else 3) for i,c in enumerate(s)) % 10 == 0 else None
    return None

works = []
with gzip.open("paper-gremlin-priority-100k.jsonl.gz", "rt", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if i < a.start:
            continue
        if i >= a.start + min(a.count,a.max_lookups):
            break
        d = json.loads(line)
        key = d.get("work_key")
        if not re.fullmatch(r"OL[0-9]+W", str(key)):
            raise ValueError("Invalid Open Library work ID")
        works.append(key)

results = {}
for key in works:
    url = "https://openlibrary.org/works/" + key + "/editions.json?limit=50"
    request = urllib.request.Request(url, headers={"User-Agent":"PaperGremlinCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        # Fail safely: no database writes occur until a full preparation succeeds.
        raise RuntimeError("ISBN pre-enrichment failed at " + key) from exc
    for edition in data.get("entries", []):
        ek = str(edition.get("key","")).split("/")[-1]
        if not re.fullmatch(r"OL[0-9]+M", ek):
            continue
        ten = next((x for v in edition.get("isbn_10",[]) if (x := valid(v)) and len(x)==10),None)
        thirteen = next((x for v in edition.get("isbn_13",[]) if (x := valid(v)) and len(x)==13),None)
        if ten or thirteen:
            results[key] = {
                "edition_key": ek, "isbn_10": ten, "isbn_13": thirteen,
                "title": edition.get("title") if isinstance(edition.get("title"),str) else None,
                "publisher": next((v for v in edition.get("publishers",[]) if isinstance(v,str)),None),
                "publish_date": edition.get("publish_date") if isinstance(edition.get("publish_date"),str) else None
            }
            break
    time.sleep(1)
Path(a.out).write_text(json.dumps(results,ensure_ascii=False),encoding="utf-8")
print(f"ISBN pre-enrichment: checked {len(works)} works; found {len(results)} editions")
