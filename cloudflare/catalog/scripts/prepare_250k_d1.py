#!/usr/bin/env python3
"""Build resumable D1 SQL chunks from staged Open Library works."""
import argparse, gzip, json, re
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("--start",type=int,required=True)
p.add_argument("--count",type=int,default=2000)
p.add_argument("--chunk",type=int,default=100)
a=p.parse_args()
def q(x):
    return "NULL" if x is None else "'"+str(x).replace("'","''")+"'"
out=Path("batches"); out.mkdir(exist_ok=True)
total=0; chunks=0; lines=[]
with gzip.open("openlibrary-250k-works.jsonl.gz","rt",encoding="utf-8") as source:
    for i,raw in enumerate(source):
        if i<a.start:continue
        if total>=a.count:break
        d=json.loads(raw)
        key=d["work_key"]; title=d["title"]
        if not re.fullmatch(r"OL[0-9]+W",key):raise ValueError(key)
        yr=re.search(r"\\b(1[5-9][0-9]{2}|20[0-9]{2})\\b",str(d.get("first_publish_date") or ""))
        cover=d.get("cover_ids") or []
        url=f"https://covers.openlibrary.org/b/id/{cover[0]}-M.jpg" if cover and isinstance(cover[0],int) and cover[0]>0 else None
        # Keep subjects short to preserve D1 space. API smoke importer already manages FTS.
        subjects=json.dumps((d.get("subjects") or [])[:5],ensure_ascii=False)[:500]
        lines.append(f"INSERT OR IGNORE INTO works(work_key,title,first_publish_year,cover_url,subjects_json) VALUES ({q(key)},{q(title)},{q(int(yr.group(1)) if yr else None)},{q(url)},{q(subjects)});")
        # Unknown author names cannot be inserted safely. Work-author links are deferred.
        lines.append(f"INSERT INTO works_fts(work_key,title,author_names) SELECT {q(key)},{q(title)},'' WHERE NOT EXISTS(SELECT 1 FROM works_fts WHERE work_key={q(key)});")
        total+=1
        if total%a.chunk==0 or total==a.count:
            if lines:
                (out/f"{chunks:06}.sql").write_text("\n".join(lines)+"\n",encoding="utf-8")
                chunks+=1; lines=[]
if lines:
    (out/f"{chunks:06}.sql").write_text("\n".join(lines)+"\n",encoding="utf-8");chunks+=1
print(f"Prepared {total} work rows in {chunks} SQL files from offset {a.start}")
if not total:raise RuntimeError("No records to import")
