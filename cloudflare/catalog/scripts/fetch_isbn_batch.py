"""Fetch real ISBN-bearing editions for a bounded batch of existing work IDs.

Uses Open Library search's edition subquery; never associates a work-wide ISBN
list with an arbitrary edition. No database writes. Results are cached locally.
"""
import argparse
import hashlib
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request


def valid_isbn(value):
    value = re.sub(r"[\s-]", "", str(value)).upper()
    if re.fullmatch(r"\d{9}[\dX]", value):
        if sum((10-i)*(10 if c == 'X' else int(c)) for i,c in enumerate(value)) % 11 == 0:
            return value
    if re.fullmatch(r"97[89]\d{10}", value):
        if sum(int(c)*(1 if i % 2 == 0 else 3) for i,c in enumerate(value)) % 10 == 0:
            return value
    return None


def fetch_batch(keys):
    if not keys or len(keys) > 100 or any(not re.fullmatch(r"OL\d+W", k) for k in keys):
        raise ValueError("Expected 1–100 valid work IDs")
    fields = 'key,editions,editions.key,editions.isbn,editions.title,editions.publisher,editions.publish_date'
    query = 'key:(' + ' OR '.join('/works/'+k for k in keys) + ') AND isbn:*'
    url = 'https://openlibrary.org/search.json?' + urllib.parse.urlencode({'q':query,'fields':fields,'limit':100})
    req = urllib.request.Request(url, headers={'User-Agent':'PaperGremlinCatalog/1.0 (threegremlinsliteraryagency@gmail.com)'})
    cache = pathlib.Path('isbn-cache'); cache.mkdir(exist_ok=True)
    dest = cache / (hashlib.sha256(url.encode()).hexdigest()+'.json')
    if dest.exists():
        data = json.loads(dest.read_text())
    else:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('Response size limit exceeded')
        data = json.loads(raw)
        dest.write_text(json.dumps(data))
        time.sleep(1)
    wanted = set(keys)
    records = []
    for work in data.get('docs', []):
        wid = work.get('key', '').split('/')[-1]
        if wid not in wanted:
            raise ValueError('Unexpected work in response')
        for edition in work.get('editions', {}).get('docs', []):
            eid = edition.get('key','').split('/')[-1]
            if not re.fullmatch(r'OL\d+M', eid):
                continue
            values = [v for raw in edition.get('isbn',[]) if (v := valid_isbn(raw))]
            ten = next((v for v in values if len(v)==10), None)
            thirteen = next((v for v in values if len(v)==13), None)
            if ten and thirteen:
                prefix = '978'+ten[:9]
                paired = prefix + str((-sum(int(c)*(1 if i%2==0 else 3) for i,c in enumerate(prefix)))%10)
                if paired in values:
                    thirteen = paired
            if not ten and not thirteen:
                continue
            def first(field):
                v = edition.get(field)
                return next((x for x in v if isinstance(x,str)), None) if isinstance(v,list) else v if isinstance(v,str) else None
            records.append([eid,wid,first('title'),first('publisher'),first('publish_date'),ten,thirteen])
            break
    return records


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--keys',required=True,help='One existing work ID per line')
    p.add_argument('--start',type=int,required=True)
    a = p.parse_args()
    keys = pathlib.Path(a.keys).read_text().splitlines()[a.start:a.start+100]
    print(json.dumps({'start':a.start,'attempted':len(keys),'records':fetch_batch(keys)}))
