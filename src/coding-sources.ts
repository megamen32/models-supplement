import { canonicalId } from "./canonical";
import type { FetchStat } from "./provenance";
import type { SourceResult } from "./source";

export const AIDER_URL = "https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml";
export const LIVEBENCH_RELEASE = "20261106";
export const LIVEBENCH_TABLE_URL = "https://livebench.ai/data/20261106/table.csv";
export const LIVEBENCH_CATEGORIES_URL = "https://livebench.ai/data/20261106/categories.json";
export const TERMINAL_ROOT_URL = "https://api.github.com/repos/laude-institute/terminal-bench-leaderboard/contents/results/terminal-bench-core@0.1.1?ref=main";
export const TERMINAL_REPO_URL = "https://github.com/laude-institute/terminal-bench-leaderboard/tree/main/results/terminal-bench-core@0.1.1";

export interface AiderEntry { score:number; raw_score:number; pass_rate_1?:number; test_cases?:number; edit_format?:string; command?:string; date?:string; source_url:string; }
export interface LiveBenchEntry { score:number; raw_score:number; coding_score:number; long_agentic_score?:number; scores:Record<string,number>; release:string; source_url:string; categories_url:string; }
export interface TerminalBenchRun { score:number; raw_score:number; dataset:string; dataset_version:string; agent:string; attempts?:number; pass_at_k?:Record<string,number>; source_url:string; date?:string; }
export interface TerminalBenchEntry { score:number; raw_score:number; dataset:string; dataset_version:string; agent:string; attempts?:number; pass_at_k?:Record<string,number>; runs:TerminalBenchRun[]; source_url:string; }

type JR<T> = { data:T; stat:FetchStat };
async function text(url:string, timeout=30000):Promise<JR<string>> {
  const t=performance.now(), fetched_at=new Date().toISOString();
  const base=(x:Partial<FetchStat>={}):FetchStat=>({name:url,url,ok:false,fetched_at,duration_ms:Math.round(performance.now()-t),bytes:0,sha256:"",...x});
  try {
    const r=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{Accept:"text/plain,application/json","User-Agent":"models-supplement/1"}});
    if(!r.ok)return{data:"",stat:base({error:"HTTP "+r.status})};
    const body=await r.text(); const {sha256}=await import("./provenance");
    return{data:body,stat:base({ok:true,bytes:body.length,sha256:sha256(body)})};
  }catch(e){return{data:"",stat:base({error:String(e)})};}
}
async function json<T>(url:string,timeout=30000):Promise<JR<T>> {
  const r=await text(url,timeout); if(!r.stat.ok)return{data:undefined as T,stat:r.stat};
  try{return{data:JSON.parse(r.data) as T,stat:r.stat};}catch(e){return{data:undefined as T,stat:{...r.stat,ok:false,error:"invalid JSON: "+String(e)}};}
}
const num=(v:unknown):number|undefined=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:undefined;};
const scalar=(v:string):string|number|boolean|null=>{const s=v.trim().replace(/^["']|["']$/g,"");if(!s||s==="null")return null;if(s==="true")return true;if(s==="false")return false;const n=Number(s);return Number.isFinite(n)?n:s;};

export function parseAiderYaml(s:string):Array<Record<string,string|number|boolean|null>>{
  const out:Array<Record<string,string|number|boolean|null>>=[];let row:Record<string,string|number|boolean|null>|null=null;
  for(const line of s.split(/\r?\n/)){const start=line.match(/^- dirname:\s*(.*)$/);if(start){row={dirname:scalar(start[1])};out.push(row);continue;}const f=line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.*)$/);if(f&&row)row[f[1]]=scalar(f[2]);}return out;
}
function aiderId(row:Record<string,string|number|boolean|null>):string|null{
  const model=typeof row.model==="string"?row.model:"";const command=typeof row.command==="string"?row.command:"";
  if(!model||/[+]|architect|editor/i.test(model+" "+command))return null;
  const m=command.match(/(?:^|\s)--model\s+["']?([^"'\\s]+)/);const raw=(m?.[1]??model).replace(/^openrouter\//,"");const slash=raw.indexOf("/");
  return slash>=0?canonicalId(raw.slice(0,slash),raw.slice(slash+1)):canonicalId(null,raw);
}
export async function fetchAider():Promise<SourceResult<Record<string,AiderEntry>>>{
  const r=await text(AIDER_URL,60000), out:Record<string,AiderEntry>={};
  if(r.stat.ok)for(const row of parseAiderYaml(r.data)){const id=aiderId(row),raw=num(row.pass_rate_2);if(!id||raw===undefined||raw<0)continue;const e:AiderEntry={score:raw/100,raw_score:raw,...(num(row.pass_rate_1)!==undefined?{pass_rate_1:num(row.pass_rate_1)}:{}),...(num(row.test_cases)!==undefined?{test_cases:num(row.test_cases)}:{}),...(typeof row.edit_format==="string"?{edit_format:row.edit_format}:{}),...(typeof row.command==="string"?{command:row.command}:{}),...(typeof row.date==="string"?{date:row.date}:{}),source_url:AIDER_URL};const old=out[id];out[id]=!old||((e.date??"")>(old.date??"")||((e.date??"")===(old.date??"")&&e.raw_score>=old.raw_score))?e:old;}
  return{ok:r.stat.ok&&Object.keys(out).length>0,records:out,error:r.stat.error,stats:[{...r.stat,name:"aider_polyglot"}]};
}
function csvLine(line:string):string[]{const out:string[]=[];let value="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(value);value="";}else value+=ch;}out.push(value);return out;}
export function parseLiveBenchCsv(s:string):Array<Record<string,string>>{const l=s.trim().split(/\r?\n/);if(l.length<2)return[];const h=csvLine(l[0]);return l.slice(1).filter(Boolean).map(x=>{const v=csvLine(x);return Object.fromEntries(h.map((k,i)=>[k,v[i]??""]));});}
export async function fetchLiveBench():Promise<SourceResult<Record<string,LiveBenchEntry>>>{
  const [t,c]=await Promise.all([text(LIVEBENCH_TABLE_URL),json<Record<string,unknown>>(LIVEBENCH_CATEGORIES_URL)]);const out:Record<string,LiveBenchEntry>={};
  if(t.stat.ok)for(const row of parseLiveBenchCsv(t.data)){const coding=num(row.coding),id=row.model?canonicalId(null,row.model.trim()):null;if(!id||coding===undefined)continue;const scores:Record<string,number>={};for(const[k,v]of Object.entries(row)){if(k!=="model"&&num(v)!==undefined)scores[k]=num(v)!;}out[id]={score:coding/100,raw_score:coding,coding_score:coding,...(num(row.long_agentic)!==undefined?{long_agentic_score:num(row.long_agentic)}:{}),scores,release:LIVEBENCH_RELEASE,source_url:LIVEBENCH_TABLE_URL,categories_url:LIVEBENCH_CATEGORIES_URL};}
  return{ok:t.stat.ok&&Object.keys(out).length>0,records:out,error:t.stat.error??c.stat.error,stats:[{...t.stat,name:"livebench:table"},{...c.stat,name:"livebench:categories"}]};
}
type Api={name:string;path:string;type:string;url:string;download_url?:string|null};
function fallback(path:string){const n=path.split("/").at(-1)??"",m=n.match(/^\d{8}_(.+?)_(.+)$/);return m?{agent:m[1],model:m[2].replace(/_/g," ")}:null;}
function terminal(meta:Record<string,unknown>,path:string):{id:string;run:TerminalBenchRun}|null{
  const f=fallback(path),model=typeof meta.model_name==="string"&&meta.model_name.trim()?meta.model_name.trim():f?.model;if(!model)return null;const id=canonicalId(null,model),score=num(meta.accuracy);if(!id||score===undefined||score<0)return null;const raw=score<=1?score*100:score;const run:TerminalBenchRun={score:raw/100,raw_score:raw,dataset:typeof meta.dataset_name==="string"?meta.dataset_name:"terminal-bench-core",dataset_version:typeof meta.dataset_version==="string"?meta.dataset_version:"0.1.1",agent:typeof meta.agent_name==="string"?meta.agent_name:(f?.agent??"unknown"),...(num(meta.n_attempts)!==undefined?{attempts:num(meta.n_attempts)}:{}),...(meta.pass_at_k&&typeof meta.pass_at_k==="object"?{pass_at_k:meta.pass_at_k as Record<string,number>}:{}),source_url:TERMINAL_REPO_URL+"/"+(path.split("/").at(-1)??"")+"/run_metadata.json",...(typeof meta.end_time==="string"?{date:meta.end_time.slice(0,10)}:{})};return{id,run};
}
export async function fetchTerminalBench():Promise<SourceResult<Record<string,TerminalBenchEntry>>>{
  const root=await json<Api[]>(TERMINAL_ROOT_URL),out:Record<string,TerminalBenchEntry>={};if(!root.stat.ok||!Array.isArray(root.data))return{ok:false,records:out,error:root.stat.error,stats:[{...root.stat,name:"terminal_bench:root"}]};
  const dirs=root.data.filter(x=>x.type==="dir"),lists=await Promise.all(dirs.map(d=>json<Api[]>(d.url))),meta=lists.flatMap(x=>x.stat.ok&&Array.isArray(x.data)?x.data.filter(e=>e.name==="run_metadata.json"&&e.download_url):[]),runs=await Promise.all(meta.map(e=>json<Record<string,unknown>>(e.download_url!,30000)));
  for(let i=0;i<meta.length;i++){if(!runs[i].stat.ok||!runs[i].data)continue;const item=terminal(runs[i].data,meta[i].path);if(!item)continue;const old=out[item.id],all=[...(old?.runs??[]),item.run];const best=all.reduce((a,b)=>a.raw_score>=b.raw_score?a:b);out[item.id]={score:best.score,raw_score:best.raw_score,dataset:best.dataset,dataset_version:best.dataset_version,agent:best.agent,...(best.attempts!==undefined?{attempts:best.attempts}:{}),...(best.pass_at_k?{pass_at_k:best.pass_at_k}:{}),runs:all,source_url:TERMINAL_REPO_URL};}
  const stats=[{...root.stat,name:"terminal_bench:root"},...lists.map(x=>({...x.stat,name:"terminal_bench:listing"})),...runs.map(x=>({...x.stat,name:"terminal_bench:metadata"}))];
  return{ok:Object.keys(out).length>0,records:out,error:meta.length>0&&Object.keys(out).length===0?"no usable model scores":undefined,stats};
}
