#!/usr/bin/env python3
"""Small API-backed D1 smoke test; not a replacement for bulk Open Library dumps."""
import argparse, json, pathlib, urllib.parse, urllib.request, re
def quote(x):
    return "NULL" if x is None else "'" + str(x).replace("'", "''") + "'"
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--limit",type=int,default=25)
    p.add_argument("--out",default="batches")
    a=p.parse_args()
    if not 1<=a.limit<=100: p.error("limit must be 1..100")
    params=urllib.parse.urlencode({"q":"language:eng","limit":a.limit,"fields":"key,title,author_name,author_key,first_publish_year,cover_i,edition_key,isbn"})
    url="https://openlibrary.org/search.json?"+params
    req=urllib.request.Request(url,headers={"User-Agent":"PaperGremlinCatalogValidation/1.0 (threegremlinsliteraryagency@gmail.com)"})
    with urllib.request.urlopen(req,timeout=45) as resp:
        docs=json.load(resp).get("docs",[])
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
    print(f"Prepared {len(seen)} works for API smoke test; no D1 writes made")
if __name__=="__main__":main()
