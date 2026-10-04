/* Widget system: spec validation, natural-language build intent, and live recomputation. */
import fs from 'node:fs';
const g:any=globalThis; const store=new Map<string,string>();
g.window={location:{hash:''},innerWidth:1600,matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){},dispatchEvent(){}};
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
const {addWidget,readWidgets,normaliseSpec,removeWidget}=await import('../src/api/widgets.ts');
const {rollupLevel,metricValues}=await import('../src/semantics/aggregations.ts');
const {metric}=await import('../src/semantics/metrics.ts');
const F:Record<string,string>={new:'New',checkins:'Checkins',bookings:'Bookings',sales:'Sales',lapsed:'Lapsed',payroll:'Payroll',leads:'Leads'};
globalThis.fetch=(async(u:string)=>{const c=SHEETS.find(x=>resolveUrl(x)===u);const f=c?F[c.key]:undefined;
 if(!f||!fs.existsSync(`/tmp/${f}.csv`))return new Response('',{status:401,headers:{'content-type':'text/html'}});
 return new Response(fs.readFileSync(`/tmp/${f}.csv`),{status:200,headers:{'content-type':'text/csv'}});}) as any;
let bad=0; const chk=(ok:boolean,msg:string)=>{if(!ok)bad++;console.log(`  ${ok?'ok  ':'FAIL'} ${msg}`);};

console.log('VALIDATION (no data needed)');
chk(!!normaliseSpec({kind:'table',metrics:['visits'],groupBy:'location'}).spec, 'valid table accepted');
chk(!!normaliseSpec({kind:'table',metrics:['nope']}).error, 'unknown metric rejected');
chk(!!normaliseSpec({kind:'table',metrics:['visits','gross_revenue']}).error, 'mixed grains rejected');
chk(!!normaliseSpec({kind:'column',metrics:['visits']}).error, 'chart without grouping rejected');
chk(!!normaliseSpec({kind:'heatmap',metrics:['visits'],groupBy:'day'}).error, 'heatmap without 2nd axis rejected');
chk(normaliseSpec({kind:'table',metrics:['visits'],groupBy:'location',limit:9999}).spec?.limit===200,'limit clamped');
chk(normaliseSpec({kind:'metric',metrics:['gross_revenue']}).spec?.tab==='sales','tab inferred from grain');

if(!fs.existsSync('/tmp/Checkins.csv')){console.log('\nNo fixtures; skipping live checks.');process.exit(bad?1:0);}
const ds=await loadDataset(undefined,true);
const sc=computeScope(ds,DEFAULT_FILTERS,1200,DEFAULT_THRESHOLDS);

console.log('\nNATURAL LANGUAGE → SPEC');
for(const [q,want] of [
  ['add fill rate by location to the classes tab','column|table'],
  ['build a chart of visits by day','column'],
  ['pin revenue as a card','metric'],
  ['create a heatmap of no show rate by day','heatmap'],
  ['make a table of churn rate by membership type','table'],
  ['add visits over time','trend'],
] as [string,string][]) {
  const r=ask(q,sc,DEFAULT_THRESHOLDS);
  const ok=r.intent==='build'&&!!r.buildSpec&&want.split('|').includes(r.buildSpec.kind!);
  chk(ok, `"${q}" → ${r.buildSpec?.kind ?? r.intent} of ${r.buildSpec?.metrics?.[0] ?? '—'}${r.buildSpec?.groupBy?' by '+r.buildSpec.groupBy:''} → ${r.buildSpec?.tab ?? '—'}`);
}

console.log('\nPERSISTENCE + LIVE RECOMPUTE');
const {id,error}=addWidget({tab:'classes',kind:'table',metrics:['visits','v_fill_rate'],groupBy:'location',source:'agent'});
chk(!!id&&!error, `widget saved (${id})`);
chk(readWidgets().length===1 && store.has('atlas.widgets.v1'), 'persisted to storage');
const w=readWidgets()[0];
const nodes=rollupLevel(sc.tables[metric(w.metrics[0]).table],[w.groupBy!],0,w.metrics,sc.ctx);
chk(nodes.length>0, `renders ${nodes.length} rows: ${nodes.slice(0,3).map(n=>`${n.label}=${n.values.visits.value}`).join(', ')}`);
// the same spec against a different scope must produce different numbers — proving it is live
const wide=computeScope(ds,{...DEFAULT_FILTERS,preset:'all'},1200,DEFAULT_THRESHOLDS);
const a=metricValues(sc.tables.visits,['visits'],sc.ctx).visits.value;
const b=metricValues(wide.tables.visits,['visits'],wide.ctx).visits.value;
chk(a!==b, `recomputes with scope: ${a} in ${sc.period.label} vs ${b} all-time`);
removeWidget(id!); chk(readWidgets().length===0,'removal works');
console.log(bad?`\n${bad} FAILURES`:'\nall checks pass');
process.exit(bad?1:0);
