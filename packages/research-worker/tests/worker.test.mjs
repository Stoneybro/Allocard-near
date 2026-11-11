import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.ts';
const realFetch = globalThis.fetch;
const secret = 's'.repeat(40);
process.env.ALLOCARD_AGENT_SECRET = secret;
process.env.ALLOCARD_APP_URL = 'https://app.example';
process.env.NEARAI_API_KEY = 'model-key';
const job = { id: '00000000-0000-4000-8000-000000000001', digest: 'a'.repeat(64), prompt: 'A browser supplied prompt that must not be trusted', deadline: Date.now()+180000 };
let pending = [];
globalThis[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil: p => pending.push(p) }) };
afterEach(async () => { await Promise.all(pending); pending=[]; globalThis.fetch=realFetch; });
async function request(route, method='GET', authorization=`Bearer ${secret}`) {
 let result;
 const response = { statusCode:0, setHeader(){}, end(text){result={status:this.statusCode,data:JSON.parse(text)}} };
 await handler({ url:`/api/index?route=${route}`,method,headers:{authorization},body:method==='POST'?job:undefined }, response);
 return result;
}
const modelCatalog = {models:[{modelId:'Qwen/Qwen3.8-27B',inputCostPerToken:{currency:'USD',amount:0,scale:0},outputCostPerToken:{currency:'USD',amount:0,scale:0}}]};
function provider(url) {
 if(url.endsWith('/model/list'))return Response.json(modelCatalog);
 if(url.endsWith('/services'))return Response.json({services:[{serviceName:'web_search',isActive:true,costPerUnit:0}]});
}
test('rejects an unauthenticated request before accessing tasks or model APIs',async()=>{
 globalThis.fetch=()=>{throw Error('Must not fetch')};
 assert.equal((await request('jobs','POST','wrong')).status,401);
});
test('an existing claim returns status without invoking the model again',async()=>{
 let modelCalls=0;
 globalThis.fetch=async(url,options)=>{
  const price=provider(String(url));if(price)return price;
  if(String(url).includes('cloud-api')){modelCalls++;throw Error('No model call allowed')}
  const body=JSON.parse(options.body);
  return Response.json(body.action==='claim'?{claimed:false}:{state:'running',claimed:true});
 };
 assert.equal((await request('jobs','POST')).status,202);
 assert.equal(modelCalls,0);
});
test('uses the database brief and persists a sourced result through the original binding',async()=>{
 const actions=[];let suppliedPrompt;
 globalThis.fetch=async(url,options)=>{
  const price=provider(String(url));if(price)return price;
  if(String(url).endsWith('/responses')){ suppliedPrompt=JSON.parse(options.body).input[1].content;return Response.json({output:[{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:'## Report\nSource: https://example.com/pricing'}]}]}); }
  const body=JSON.parse(options.body);actions.push(body);
  return Response.json(body.action==='claim'?{claimed:true,prompt:'The approved database brief'}:{saved:true});
 };
 assert.equal((await request('jobs','POST')).status,202);
 await Promise.all(pending);
 assert.equal(suppliedPrompt,'The approved database brief');
 assert.deepEqual(actions.map(a=>a.action),['claim','complete']);
 assert.equal(actions[0].sessionId,actions[1].sessionId);
});
test('status comes from durable task storage and allows recovery only when no claim exists',async()=>{
 globalThis.fetch=async()=>Response.json({state:'needs_reconciliation',claimed:false,session_id:null});
 const r=await request(`jobs/${job.id}/${job.digest}`);
 assert.equal(r.status,200);assert.equal(r.data.retryable,true);
});
