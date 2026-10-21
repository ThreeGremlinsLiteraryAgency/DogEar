#!/usr/bin/env python3
"""Small API-backed D1 smoke test; not a replacement for bulk Open Library dumps."""
import argparse, json, pathlib, urllib.parse, urllib.request, re
def quote(x):
    return "NULL" if x is None else "'" + str(x).replace("'", "''") + "'"
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--limit",type=int,default=25)
    p.add_argument("--out",default="batches")
    p.add_argument("--page",type=int,default=1,help="Search results page (1..100)")
    a=p.parse_args()
    if not 1<=a.limit<=100: p.error("limit must be 1..100")
    if not 1<=a.page<=100: p.error("page must be 1..100")
    # Targeted subjects avoid the expensive, broad language-only search.
    # Keep each request small and retry transient upstream failures.
    import time, urllib.error
    docs=[]; collected=set()
    subjects=("fantasy","science_fiction","mystery","history","romance")
    for subject in subjects:
        if len(docs)>=a.limit: break
        params=urllib.parse.urlencode({"subject":subject,"page":a.page,"limit":min(20,a.limit-len(docs)),"fields":"key,title,author_name,author_key,first_publish_year,cover_i"})
        url="https://openlibrary.org/search.json?"+params
        for attempt in range(4):
            try:
                req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinCatalogValidation/1.0 (threegremlinsliteraryagency@gmail.com)","Accept":"application/json"})
                with urllib.request.urlopen(req,timeout=35) as resp:
                    results=json.load(resp).get("docs",[])
                for item in results:
                    k=item.get("key")
                    if k and k not in collected:
                        collected.add(k); docs.append(item)
                break
            except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as exc:
                print(f"Subject {subject}: attempt {attempt+1}/4 failed: {exc}",flush=True)
                if attempt<3: time.sleep(2**attempt)
        if len(docs)>=a.limit: break
    docs=docs[:a.limit]
    lines=[]; seen=set()
    for d in docs:
        wid=d.get("key","").rsplit("/",1)[-1]
        title=d.get("title")
        if not re.fullmatch(r"OL[0-9]+W",wid) or not isinstance(title,str): continue
        if wid in seen: continue
        seen.add(wid)
        year=d.get("first_publish_year")
        year=year if isinstance(year,int) else None
        cover=d.get("cover_i")
        cover_url=f"https://covers.openlibrary.org/b/id/{cover}-M.jpg" if isinstance(cover,int) and cover>0 else None
        lines.append(f"INSERT INTO works(work_key,title,first_publish_year,cover_url,subjects_json) VALUES ({quote(wid)},{quote(title)},{quote(year)},{quote(cover_url)},'[]') ON CONFLICT(work_key) DO UPDATE SET title=excluded.title,first_publish_year=excluded.first_publish_year,cover_url=excluded.cover_url;")
        names=d.get("author_name") or []; keys=d.get("author_key") or []
        for aid,name in zip(keys,names):
            if not re.fullmatch(r"OL[0-9]+A",str(aid)) or not isinstance(name,str):continue
            lines.append(f"INSERT INTO authors(author_key,name) VALUES ({quote(aid)},{quote(name)}) ON CONFLICT(author_key) DO UPDATE SET name=excluded.name;")
            lines.append(f"INSERT OR IGNORE INTO work_authors(work_key,author_key) VALUES ({quote(wid)},{quote(aid)});")
        lines.append(f"DELETE FROM works_fts WHERE work_key={quote(wid)};")
        lines.append(f"INSERT INTO works_fts(work_key,title,author_names) VALUES ({quote(wid)},{quote(title)},{quote(' '.join(names))});")
    if not seen: raise RuntimeError("Open Library returned no usable works")
    out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
    (out/"000001.sql").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(f"Prepared {len(seen)} works from page {a.page}; no D1 writes made")
if __name__=="__main__":main()
