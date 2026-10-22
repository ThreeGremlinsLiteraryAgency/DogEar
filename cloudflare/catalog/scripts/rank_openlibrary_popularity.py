#!/usr/bin/env python3
"""Rank Open Library works by reading shelf activity and ratings; no D1 writes."""
import csv, gzip, math, re
from collections import defaultdict
from pathlib import Path

work_pattern=re.compile(r"^/?(?:works/)?(OL[0-9]+W)$")
counts=defaultdict(lambda:[0,0,0,0,0.0])
def records(path):
    with gzip.open(path,"rt",encoding="utf-8",errors="replace",newline="") as handle:
        for row in csv.reader(handle,delimiter="\t"):
            if len(row)>=4:
                match=work_pattern.fullmatch(row[0].strip())
                if match:yield match.group(1),row

for key,row in records("ol_dump_reading-log_latest.txt.gz"):
    shelf=row[2].lower().strip().replace("_","-")
    stats=counts[key]
    if shelf in ("want-to-read","to-read"):stats[0]+=1
    elif shelf in ("currently-reading","reading"):stats[1]+=1
    elif shelf in ("already-read","read"):stats[2]+=1
for key,row in records("ol_dump_ratings_latest.txt.gz"):
    try:rating=float(row[2])
    except ValueError:continue
    if 1<=rating<=5:
        counts[key][3]+=1
        counts[key][4]+=rating

def score(st):
    want,reading,read,n,rating_sum=st
    mean=rating_sum/n if n else 0
    # Log-scaled engagement reduces bias from a handful of enormous outliers.
    return round(5*math.log1p(want)+6*math.log1p(reading)+4*math.log1p(read)+
                 3*math.log1p(n)+ (mean-3)*min(n,20)/20,5)

top=sorted(counts.items(),key=lambda item:(-score(item[1]),item[0]))[:150000]
with open("paper-gremlin-popularity-ranked.csv","w",newline="",encoding="utf-8") as out:
    writer=csv.writer(out)
    writer.writerow(["rank","work_key","popularity_score","want_to_read","currently_reading","already_read","rating_count","rating_average"])
    for rank,(key,st) in enumerate(top,1):
        writer.writerow([rank,key,score(st),st[0],st[1],st[2],st[3],round(st[4]/st[3],3) if st[3] else ""])
print(f"Ranked {len(counts):,} unique work IDs; saved top {len(top):,}")
for rank,(key,st) in enumerate(top[:10],1):print(rank,key,score(st),st[:4])
