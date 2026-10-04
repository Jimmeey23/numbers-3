/* What can be verified without a DOM: the resolver and the answer engine. */
import fs from 'node:fs';
const g:any=globalThis; const store=new Map<string,string>();
g.window={location:{hash:''},innerWidth:1600,matchMedia:()=>({matches:false}),addEventListener(){},dispatchEvent(){}};
g.document={documentElement:{getAttribute:()=>'matte',setAttribute(){}}};
g.localStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)};
g.CustomEvent=class{constructor(public type:string,public detail?:unknown){}};
const {loadDataset}=await import('../src/data/ingest.ts');
const {SHEETS}=await import('../src/data/sheets.config.ts');
const {resolveUrl}=await import('../src/data/sources.ts');
const {computeScope}=await import('../src/state/data.ts');
const {DEFAULT_FILTERS}=await import('../src/state/filters.ts');
const {DEFAULT_THRESHOLDS}=await import('../src/state/view.ts');
const {ask}=await import('../src/api/ask.ts');
const {resolveTerm}=await import('../src/api/resolve.ts');
const F:Record<string,string>={new:'New',checkins:'Checkins',bookings:'Bookings',sales:'Sales',lapsed:'Lapsed',payroll:'Payroll',leads:'Leads'};
globalThis.fetch=(async(u:string)=>{const c=SHEETS.find(x=>resolveUrl(x)===u);const f=c?F[c.key]:undefined;
 if(!f||!fs.existsSync(`/tmp/${f}.csv`))return new Response('',{status:401,headers:{'content-type':'text/html'}});
 return new Response(fs.readFileSync(`/tmp/${f}.csv`),{status:200,headers:{'content-type':'text/csv'}});}) as any;

// Resolver works with no data at all.
const terms=['draw premium','attrition','one and done','no shows','revenue per head','speed to lead','fill','xyzzy'];
let bad=0;
console.log('RESOLVER');
for(const t of terms){const r=resolveTerm(t);
  const ok=t==='xyzzy'?r.kind==='unknown':r.kind==='metric';
  if(!ok)bad++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${t.padEnd(18)} → ${r.metric?.id ?? r.kind} (${r.confidence})`);}

if(!fs.existsSync('/tmp/Checkins.csv')){console.log('\nNo fixtures; skipping answer checks.');process.exit(bad?1:0);}
const ds=await loadDataset(undefined,true);
const sc=computeScope(ds,DEFAULT_FILTERS,1200,DEFAULT_THRESHOLDS);
console.log('\nANSWERS');
const checks:[string,(a:any)=>boolean][]=[
 ['what is draw premium',a=>a.intent==='define'&&a.metricId==='draw_premium_pp'],
 ['fill rate',a=>a.intent==='value'&&a.metricId==='v_fill_rate'&&a.answer.includes('%')],
 ['worst slots by fill rate',a=>a.intent==='rank'&&!!a.table&&a.table.rows.length>0],
 ['revenue by location',a=>a.intent==='breakdown'&&a.dimension==='location'],
 ['revenue per head',a=>a.intent==='value'&&!a.dimension],
 ['how did churn change',a=>a.intent==='compare'],
 ['visits by month',a=>a.intent==='trend'&&a.table?.rows.length===12],
 ['what should I worry about',a=>a.intent==='signals'],
 ['xyzzy nonsense',a=>a.unresolved===true],
];
for(const [q,pred] of checks){const a=ask(q,sc,DEFAULT_THRESHOLDS);const ok=pred(a);if(!ok)bad++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${q.padEnd(28)} [${a.intent}] ${a.answer.slice(0,70)}`);}
console.log(bad?`\n${bad} FAILURES`:'\nall checks pass');
process.exit(bad?1:0);
