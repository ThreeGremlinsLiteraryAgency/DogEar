#!/usr/bin/env python3
"""Bounded ISBN enrichment for existing Paper Gremlin Open Library works."""
import json,re,sys,time,urllib.request,urllib.error
from pathlib import Path

def valid(value):
    s=re.sub(r"[-\\s]","",str(value)).upper()
    if re.fullmatch(r"[0-9]{9}[0-9X]",s):
        return s if sum((10-i)*(10 if c=="X" else int(c)) for i,c in enumerate(s))%11==0 else None
    if re.fullmatch(r"97[89][0-9]{10}",s):
        return s if sum(int(c)*(1 if i%2==0 else 3) for i,c in enumerate(s))%10==0 else None
    return None

def quote(s):
    return "NULL" if s is None else "'"+str(s).replace("'","''")+"'"

records=json.loads(Path("isbn-candidates.json").read_text())
if not isinstance(records,list) or len(records)>25: raise ValueError("Bounded to 25 candidates")
lines=[]
found=0
for item in records:
    work=item["work_key"]
    if not re.fullmatch(r"OL[0-9]+W",work):raise ValueError(work)
    url="https://openlibrary.org/works/"+work+"/editions.json?limit=50"
    req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinCatalog/1.0 (threegremlinsliteraryagency@gmail.com)"})
    try:
        with urllib.request.urlopen(req,timeout=20) as f:
            data=json.load(f)
    except (urllib.error.URLError,TimeoutError,ValueError) as e:
        raise RuntimeError("Open Library unavailable, keeping cursor for retry: "+work) from e
    for d in data.get("entries",[]):
        key=str(d.get("key","")).split("/")[-1]
        if not re.fullmatch(r"OL[0-9]+M",key):continue
        ten=next((x for v in d.get("isbn_10",[]) if (x:=valid(v)) and len(x)==10),None)
        thirteen=next((x for v in d.get("isbn_13",[]) if (x:=valid(v)) and len(x)==13),None)
        if not (ten or thirteen):continue
        title=d.get("title") if isinstance(d.get("title"),str) else None
        publisher=next((x for x in d.get("publishers",[]) if isinstance(x,str)),None)
        date=d.get("publish_date") if isinstance(d.get("publish_date"),str) else None
        lines.append("INSERT OR IGNORE INTO editions(edition_key,work_key,title,publisher,publish_date,isbn_10,isbn_13) VALUES ("+",".join(quote(v) for v in (key,work,title,publisher,date,ten,thirteen))+");")
        found+=1
        if found>=75:break
    if found>=75:break
    time.sleep(1)
if records:
    last=records[-1]["work_key"]
    lines.append("UPDATE catalog_isbn_enrichment_progress SET last_work_key="+quote(last)+",attempted=attempted+"+str(len(records))+",imported=imported+"+str(found)+",updated_at=CURRENT_TIMESTAMP WHERE id=1;")
Path("isbn-enrich.sql").write_text("\n".join(lines)+"\n")
print("Scanned",len(records),"work IDs; found",found,"valid ISBN editions")
