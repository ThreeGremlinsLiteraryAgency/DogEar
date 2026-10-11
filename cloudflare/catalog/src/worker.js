const json=(value,status=200,origin="")=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=120","access-control-allow-origin":origin,"vary":"Origin"}});
function cors(request,env){const origin=request.headers.get("Origin")||"";return origin===env.ALLOWED_ORIGIN?origin:"";}
function cleanQuery(q){return String(q||"").normalize("NFKC").trim().slice(0,120);}
export default {
  async fetch(request,env){
    const origin=cors(request,env);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"content-type","vary":"Origin"}});
    if(request.method!=="GET")return json({error:"Method not allowed"},405,origin);
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,service:"paper-gremlin-catalog"},200,origin);
    try{
      if(url.pathname==="/search"){
        const q=cleanQuery(url.searchParams.get("q"));
        if(q.length<2)return json({books:[],total:0},200,origin);
        const limit=Math.min(40,Math.max(1,Number.parseInt(url.searchParams.get("limit")||"20",10)||20));
        const offset=Math.min(1000,Math.max(0,Number.parseInt(url.searchParams.get("offset")||"0",10)||0));
        const terms=q.split(/\s+/).filter(Boolean).map(t=>'"'+t.replace(/"/g,'""')+'"*').join(" AND ");
        const stmt=env.CATALOG_DB.prepare(`SELECT w.work_key,w.title,w.subtitle,w.first_publish_year,w.cover_url,w.subjects_json,
          (SELECT group_concat(a.name, ', ') FROM work_authors wa JOIN authors a ON a.author_key=wa.author_key WHERE wa.work_key=w.work_key) author_names
          FROM works_fts f JOIN works w ON w.work_key=f.work_key WHERE works_fts MATCH ? LIMIT ? OFFSET ?`);
        const result=await stmt.bind(terms,limit,offset).all();
        return json({books:(result.results||[]).map(r=>({...r,author_names:r.author_names?r.author_names.split(", "):[],subjects:JSON.parse(r.subjects_json||"[]"),subjects_json:undefined})),limit,offset},200,origin);
      }
      if(url.pathname.startsWith("/works/")){
        const key=decodeURIComponent(url.pathname.slice(7));
        if(!/^OL\d+W$/.test(key))return json({error:"Invalid work ID"},400,origin);
        const row=await env.CATALOG_DB.prepare("SELECT * FROM works WHERE work_key=?").bind(key).first();
        return row?json(row,200,origin):json({error:"Not found"},404,origin);
      }
      return json({error:"Not found"},404,origin);
    }catch(e){console.error("catalog error",e);return json({error:"Catalog temporarily unavailable"},503,origin);}
  }
};
