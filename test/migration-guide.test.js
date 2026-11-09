'use strict';
const assert=require('node:assert/strict');
const {boot}=require('./helpers/boot');
(async()=>{const t=await boot();try{const r=await t.get('/docs/migrate');assert.equal(r.status,200);for(const text of ['<h1>','TechArticle','OpenRouter','LiteLLM','Vercel','Portkey','routing/preview','Idempotency-Key','still under review'])assert.ok(r.text.includes(text),text);assert.ok(!r.text.includes('sk-'));}finally{await t.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
