#!/usr/bin/env python3
"""Fail closed on an unusable popularity queue, emit a human-readable report."""
import csv, json, statistics
from pathlib import Path
p=Path("paper-gremlin-popularity-ranked.csv")
with p.open(encoding="utf-8",newline="") as h:
    rows=list(csv.DictReader(h))
n=len(rows)
keys=[r["work_key"] for r in rows]
scores=[float(r["popularity_score"]) for r in rows]
activity=[sum(int(r[c]) for c in ("want_to_read","currently_reading","already_read","rating_count")) for r in rows]
checks={
 "at_least_100000_ranked":n>=100000,
 "unique_work_ids":len(set(keys))==n,
 "valid_work_ids":all(k.startswith("OL") and k.endswith("W") and k[2:-1].isdigit() for k in keys),
 "scores_descending":all(scores[i]>=scores[i+1] for i in range(n-1)),
 "nonzero_activity_at_top":all(x>0 for x in activity[:min(n,100)]),
 "rating_or_reading_activity":sum(x>0 for x in activity)>n*0.9,
}
report={"ranked_rows":n,"unique_works":len(set(keys)),"checks":checks,
        "top_20":[{"rank":r["rank"],"work_key":r["work_key"],
                   "score":r["popularity_score"],"shelves":int(r["want_to_read"])+int(r["currently_reading"])+int(r["already_read"]),
                   "ratings":r["rating_count"]} for r in rows[:20]],
        "score_at_rank_100000":scores[99999] if n>=100000 else None}
Path("popularity-validation.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
if not all(checks.values()):raise SystemExit("Validation failed: don't use queue for production imports")
