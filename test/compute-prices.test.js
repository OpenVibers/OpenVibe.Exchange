'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./helpers/boot');
const {createFakeAi}=require('./helpers/ai');
(async()=>{
 const t=await boot({ai:createFakeAi()});
 try {
  const r=await t.get('/api/compute/prices');assert.equal(r.status,200,r.text);
  assert.equal(r.headers.get('access-control-allow-origin'),'*');assert.match(r.headers.get('cache-control'),/max-age=60/);
  const options=await t.get('/api/compute/prices',{method:'OPTIONS'});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'*');
  const data=JSON.parse(r.text);assert.equal(data.prices.length,10);
  assert.equal(data.prices.find(p=>p.id==='daytona-4090-preemptible').interruptible,true);
  for(const p of data.prices){assert.ok(p.hourly>0);assert.ok(p.expires_at>Date.parse(p.checked_at));assert.ok(p.source.startsWith('https://'));assert.equal(p.per_second,p.hourly/3600);}
  const page=await t.get('/compute');assert.equal(page.status,200);assert.match(page.text,/Compute prices/);assert.match(page.text,/Model prices/);
  assert.match((await t.get('/')).text,/href="\/compute"/);
  assert.match(page.text,/openvibe\.compare\/compute/);
  const docs=await t.get('/api');assert.match(docs.text,/GET \/api\/compute\/prices/);assert.match(docs.text,/Access-Control-Allow-Origin: \*/);assert.match(docs.text,/max-age=60/);
  const map=await t.get('/sitemap.xml');assert.match(map.text,/https:\/\/openvibe\.exchange\/compute<\/loc>/);
  assert.match((await t.get('/llms.txt')).text,/https:\/\/openvibe\.exchange\/compute/);
  process.stdout.write('compute catalogue: dated source prices, spot distinction, units and model/compute links passed\n');
 }finally{await t.close();}
})().catch(e=>{process.stderr.write(String(e.stack)+'\n');process.exitCode=1;});
