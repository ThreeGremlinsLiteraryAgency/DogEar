#!/usr/bin/env python3
"""Paced D1 importer: measures actual rows written and checkpoints in D1.
The reserve is intentionally below Cloudflare's account-wide free-tier caps.
"""
import glob,json,os,re,subprocess,sys
from datetime import datetime,timezone

DB="paper-gremlin-catalog"
MAX_WRITES=30000
MAX_BOOKS=3000
MAX_DB_BYTES=450000000
BATCH_SIZE=100
def run(*args):
    p=subprocess.run(["npx","wrangler","d1",*args],capture_output=True,text=True)
    if p.returncode:
        raise RuntimeError("Wrangler command failed: "+p.stderr[-1200:]+p.stdout[-500:])
    return p.stdout

def rows(sql):
    raw=run("execute",DB,"--remote","--command="+sql,"--json")
    data=json.loads(raw)
    if isinstance(data,dict): data=data.get("result",data.get("results",[]))
    if isinstance(data,list) and data and isinstance(data[0],dict) and "results" in data[0]:
        return data[0]["results"]
    return data

def storage():
    d=json.loads(run("info",DB,"--json"))
    if isinstance(d,list):
        d=d[0] if d else {}
    if isinstance(d,dict) and isinstance(d.get("result"),dict):
        d=d["result"]
    size=d.get("file_size",d.get("fileSize",d.get("database_size",d.get("databaseSize"))))
    if not isinstance(size,(int,float)) or size<=0:
        raise RuntimeError("Cannot verify DB size: fail closed")
    return size

def parse_writes(output):
    # Wrangler's remote --file output displays '<n> rows written'.
    m=re.search(r"([0-9][0-9,]*)\s+rows written",output,re.I)
    if not m:
        raise RuntimeError("Cannot measure rows written: stopping rather than guessing")
    return int(m.group(1).replace(",",""))

run("execute",DB,"--remote","--command=CREATE TABLE IF NOT EXISTS catalog_import_budget (day_utc TEXT PRIMARY KEY, rows_written INTEGER NOT NULL DEFAULT 0);","--yes")
day=datetime.now(timezone.utc).strftime("%Y-%m-%d")
run("execute",DB,"--remote","--command=INSERT OR IGNORE INTO catalog_import_budget(day_utc,rows_written) VALUES ('"+day+"',0);","--yes")
offset=int(rows("SELECT next_offset FROM catalog_priority_progress WHERE id=1")[0]["next_offset"])
used=int(rows("SELECT rows_written FROM catalog_import_budget WHERE day_utc='"+day+"'")[0]["rows_written"])
processed=0
for file in sorted(glob.glob("batches/*.sql")):
    if processed>=MAX_BOOKS or offset>=100000:
        break
    if storage()>=MAX_DB_BYTES:
        print("Storage stop reached");break
    # 2000-row buffer per next 100 works, plus 30000 daily internal cap.
    if used+2000>MAX_WRITES:
        print("Conservative D1 write budget reached");break
    result=run("execute",DB,"--remote","--file="+file,"--yes")
    actual=parse_writes(result)
    if actual>2000:
        raise RuntimeError("Single batch exceeded 2000 written rows; manual review required")
    # Update cursor only after successful file import; use idempotent INSERT OR IGNORE SQL.
    # Transactional SQL prevents advancing the cursor without recording batch usage.
    sql=("UPDATE catalog_priority_progress SET next_offset=next_offset+"+str(BATCH_SIZE)+
         ",updated_at=CURRENT_TIMESTAMP WHERE id=1 AND next_offset="+str(offset)+";"+
         "UPDATE catalog_import_budget SET rows_written=rows_written+"+str(actual+2)+
         " WHERE day_utc='"+day+"';")
    run("execute",DB,"--remote","--command="+sql,"--yes")
    offset+=BATCH_SIZE
    used+=actual+2
    processed+=BATCH_SIZE
    print("Imported batch; source offset",offset,"measured writes",actual,"tracked today's writes",used,flush=True)
print("Finished",processed,"source works this run; current offset",offset)
