#!/usr/bin/env python3
"""Join ranked work IDs to the official works dump; prioritize available covers."""
import csv,gzip,json,re,urllib.request
from pathlib import Path
rank={}
with open("paper-gremlin-popularity-ranked.csv",newline="",encoding="utf-8") as h:
 for row in csv.DictReader(h):
  rank[row["work_key"]]=(int(row["rank"]),float(row["popularity_score"]))
print("Ranking candidates:",len(rank),flush=True)
hits=[]
url="https://openlibrary.org/data/ol_dump_works_latest.txt.gz"
req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinBulkCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"})
with urllib.request.urlopen(req,timeout=180) as response:
 with gzip.GzipFile(fileobj=response) as stream:
  for raw in stream:
   try:
    parts=raw.decode("utf-8").rstrip("\n").split("\t",4)
    if len(parts)!=5:continue
    key=parts[1].rsplit("/",1)[-1]
    if key not in rank:continue
    doc=json.loads(parts[4])
    title=doc.get("title")
    if not isinstance(title,str) or not title.strip():continue
    covers=[x for x in doc.get("covers",[]) if isinstance(x,int) and x>0]
    author_keys=[a.get("author",{}).get("key","").split("/")[-1] for a in doc.get("authors",[]) if isinstance(a,dict) and isinstance(a.get("author"),dict)]
    record={"work_key":key,"title":title[:350],"first_publish_date":doc.get("first_publish_date"),
      "subjects":(doc.get("subjects") or [])[:5],"cover_ids":covers[:1],"author_keys":author_keys[:5],
      "popularity_rank":rank[key][0],"popularity_score":rank[key][1]}
    hits.append(record)
   except (UnicodeDecodeError,ValueError,TypeError,AttributeError):continue
print("Candidate works matched:",len(hits),flush=True)
# Cover availability takes priority, then rank. Uncovered works fill gaps only.
hits.sort(key=lambda x:(not bool(x["cover_ids"]),x["popularity_rank"]))
selected=hits[:100000]
if len(selected)<100000:raise RuntimeError(f"Only {len(selected)} usable ranked works; refused to make incomplete queue")
with gzip.open("paper-gremlin-priority-100k.jsonl.gz","wt",encoding="utf-8",compresslevel=6) as out:
 for item in selected:out.write(json.dumps(item,ensure_ascii=False)+"\n")
with Path("priority-report.json").open("w") as out:
 json.dump({"selected":len(selected),"with_covers":sum(bool(x["cover_ids"]) for x in selected),"matched_candidates":len(hits),
  "top_20":selected[:20]},out,indent=2)
print("Selected 100000; with covers",sum(bool(x["cover_ids"]) for x in selected),flush=True)
