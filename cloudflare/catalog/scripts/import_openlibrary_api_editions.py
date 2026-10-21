#!/usr/bin/env python3
"""Generate idempotent D1 edition upserts for a few existing Open Library works."""
import json,re,time,urllib.request,urllib.error,pathlib
keys=["OL15358691W","OL15450W","OL16597059W","OL17546674W","OL17610507W"]
def q(x):return "NULL" if x is None else "'"+str(x).replace("'","''")+"'"
sql=[]
for work in keys:
    url=f"https://openlibrary.org/works/{work}/editions.json?limit=5"
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinCatalogValidation/1.0 (threegremlinsliteraryagency@gmail.com)"})
            with urllib.request.urlopen(req,timeout=35) as response: data=json.load(response)
            break
        except (urllib.error.URLError,TimeoutError) as e:
            if attempt==3:raise
            print("Retry",work,e,flush=True);time.sleep(2**attempt)
    for item in data.get("entries",[]):
        edition=str(item.get("key","")).split("/")[-1]
        if not re.fullmatch(r"OL[0-9]+M",edition):continue
        def first(name):
            values=item.get(name) or []
            return values[0] if isinstance(values,list) and values and isinstance(values[0],str) else None
        vals=[edition,work,item.get("title"),first("publishers"),item.get("publish_date"),first("isbn_10"),first("isbn_13")]
        sql.append("INSERT INTO editions(edition_key,work_key,title,publisher,publish_date,isbn_10,isbn_13) VALUES ("+",".join(q(v) for v in vals)+") ON CONFLICT(edition_key) DO UPDATE SET work_key=excluded.work_key,title=excluded.title,publisher=excluded.publisher,publish_date=excluded.publish_date,isbn_10=excluded.isbn_10,isbn_13=excluded.isbn_13;")
    time.sleep(0.3)
if not sql:raise RuntimeError("No editions returned")
pathlib.Path("batches").mkdir(exist_ok=True)
pathlib.Path("batches/editions.sql").write_text("\n".join(sql)+"\n")
print("Generated",len(sql),"edition upserts; no production writes")
