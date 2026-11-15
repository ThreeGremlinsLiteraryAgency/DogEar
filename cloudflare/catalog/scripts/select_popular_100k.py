#!/usr/bin/env python3
"""Join ranked work IDs to the official works dump; prioritize available covers."""
import csv,gzip,json,re,urllib.request,os,time
from pathlib import Path
rank={}
with open("paper-gremlin-popularity-ranked.csv",newline="",encoding="utf-8") as h:
 for row in csv.DictReader(h):
  rank[row["work_key"]]=(int(row["rank"]),float(row["popularity_score"]))
print("Ranking candidates:",len(rank),flush=True)
hits=[]
url="https://openlibrary.org/data/ol_dump_works_latest.txt.gz"
req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinBulkCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"})
class LimitedStream:
 def __init__(self, source, limit):
  self.source=source
  self.limit=limit
  self.used=0
 def read(self,n=-1):
  if self.used>=self.limit:
   raise RuntimeError("Compressed download exceeded safety limit")
  allowed=min(n if n>=0 else 65536,self.limit-self.used+1)
  data=self.source.read(allowed)
  self.used+=len(data)
  if self.used>self.limit:
   raise RuntimeError("Compressed download exceeded safety limit")
  return data
MAX_DOWNLOAD=int(os.environ.get("PG_MAX_DOWNLOAD_BYTES","5000000000"))
START=time.monotonic()
with urllib.request.urlopen(req,timeout=180) as response:
 length=response.headers.get("Content-Length")
 if length and int(length)>MAX_DOWNLOAD:
  raise RuntimeError("Declared dump size exceeds download ceiling")
 limited=LimitedStream(response,MAX_DOWNLOAD)
 with gzip.GzipFile(fileobj=limited) as stream:
  for raw in stream:
   if time.monotonic()-START>3300:
    raise RuntimeError("Download processing exceeded 55-minute ceiling")
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
      "subtitle":doc.get("subtitle") if isinstance(doc.get("subtitle"),str) else None,\n      "subjects":(doc.get("subjects") or [])[:20],"cover_ids":covers[:1],"author_keys":author_keys[:8],
      "popularity_rank":rank[key][0],"popularity_score":rank[key][1]}
    hits.append(record)
   except (UnicodeDecodeError,ValueError,TypeError,AttributeError):continue
print("Compressed bytes downloaded:",limited.used,flush=True)
print("Candidate works matched:",len(hits),flush=True)
# Only stage genuinely usable new works. Unknown metadata must not silently
# produce incomplete records; legacy records are intentionally not touched.
year_re=re.compile(r"\\b(1[5-9][0-9]{2}|20[0-9]{2})\\b")
def usable(d):
 return (d["cover_ids"] and d["author_keys"] and
         year_re.search(str(d.get("first_publish_date") or "")) and
         any(isinstance(v,str) and v.strip() for v in d["subjects"]))
hits=[d for d in hits if usable(d)]
hits.sort(key=lambda x:x["popularity_rank"])
print("Works meeting initial completeness requirements:",len(hits),flush=True)
if len(hits)<100000:raise RuntimeError("Fewer than 100,000 covered works have author references, publication year and subjects")

# Resolve author names in bulk from the official authors dump, without making
# 100,000+ individual API requests. Scan once and retain only needed authors.
needed={k for d in hits for k in d["author_keys"]}
author_names={}
author_url="https://openlibrary.org/data/ol_dump_authors_latest.txt.gz"
req=urllib.request.Request(author_url,headers={"User-Agent":"PaperGremlinBulkCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"})
with urllib.request.urlopen(req,timeout=180) as response:
 length=response.headers.get("Content-Length")
 if length and int(length)>MAX_DOWNLOAD:raise RuntimeError("Author dump exceeds compressed download safety limit")
 limited_authors=LimitedStream(response,MAX_DOWNLOAD)
 with gzip.GzipFile(fileobj=limited_authors) as stream:
  for raw in stream:
   try:
    parts=raw.decode("utf-8").rstrip("\\n").split("\\t",4)
    if len(parts)!=5:continue
    aid=parts[1].rsplit("/",1)[-1]
    if aid not in needed:continue
    doc=json.loads(parts[4])
    name=doc.get("name")
    if isinstance(name,str) and name.strip():author_names[aid]=name.strip()
   except (UnicodeDecodeError,ValueError,TypeError,AttributeError):continue
print("Resolved author names:",len(author_names),"of",len(needed),flush=True)
selected=[]
for d in hits:
 authors=[{"author_key":k,"name":author_names[k]} for k in d["author_keys"] if k in author_names]
 # Require every referenced author to be resolvable; do not conceal gaps.
 if len(authors)!=len(d["author_keys"]):continue
 d["authors"]=authors
 selected.append(d)
 if len(selected)>=100000:break
if len(selected)<100000:raise RuntimeError(f"Only {len(selected)} works meet author and core metadata requirements; no incomplete priority artifact published")
with gzip.open("paper-gremlin-priority-100k.jsonl.gz","wt",encoding="utf-8",compresslevel=6) as out:
 for item in selected:out.write(json.dumps(item,ensure_ascii=False)+"\\n")
with Path("priority-report.json").open("w") as out:
 json.dump({"selected":len(selected),"with_covers":sum(bool(x["cover_ids"]) for x in selected),"matched_candidates":len(hits),
  "with_resolved_authors":len(selected),"top_20":selected[:20]},out,indent=2)
print("Selected 100000 complete core catalog records",flush=True)
