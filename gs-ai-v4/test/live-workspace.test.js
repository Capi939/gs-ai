const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {classifyTask,readSSE}=require('../live-jarvis');

test('task classification opens the requested business view',()=>{
 for(const [q,view] of [['Erstelle eine E-Mail an den Kunden','email'],['E-Mail wegen eines Termins','email'],['Social Post über einen Termin','social'],['Termin morgen','calendar'],['Content-Plan für Instagram','plan'],['Offerte erstellen','offer'],['Instagram Post','social'],['Übersicht meiner Projekte','overview']])assert.equal(classifyTask(q).view,view);
});
test('SSE decoder preserves split UTF-8 and handles CRLF, comments and final unterminated event',async()=>{
 const raw=Buffer.from(': heartbeat\r\n\r\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Grüsse 🚘'})+'\r\n\r\ndata: '+JSON.stringify({type:'response.completed'}));
 async function* chunks(){for(let i=0;i<raw.length;i++)yield raw.subarray(i,i+1)}
 const result=[];for await(const event of readSSE(chunks()))result.push(event);
 assert.deepEqual(result,[{type:'response.output_text.delta',delta:'Grüsse 🚘'},{type:'response.completed'}]);
});

test('live route streams real deltas, saves only complete results and aborts on pause',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'jarvis-live-')),port=30000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 const mock=`global.fetch=async(url,options)=>{const request=JSON.parse(options.body),prompt=typeof request.input==='string'?request.input:request.input.at(-1).content;const delay=ms=>new Promise((resolve,reject)=>{if(options.signal.aborted)return reject(new Error('aborted'));const timer=setTimeout(resolve,ms);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'))},{once:true})});return {ok:true,body:(async function*(){const events=[{type:'response.output_text.delta',delta:'Grüsse '},{type:'response.output_text.delta',delta:'aus Zürich 🚘'},{type:prompt.includes('incomplete')?'response.incomplete':'response.completed'}];for(let i=0;i<events.length;i++){await delay(prompt.includes('pause')&&i===1?5000:35);const chunk=Buffer.from('data: '+JSON.stringify(events[i])+'\\n\\n');for(let j=0;j<chunk.length;j+=7)yield chunk.subarray(j,j+7);if(prompt.includes('disconnect')&&i===0)return}})()}};require('./server.js');`;
 const child=spawn(process.execPath,['-e',mock],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,NODE_ENV:'test',OPENAI_API_KEY:'test-only'}});let stderr='';child.stderr.on('data',d=>stderr+=d);
 let cookie;
 const request=(route,method='GET',body)=>fetch(base+route,{method,headers:{Connection:'close','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const collect=async response=>(await response.text()).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await request('/api/health')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,stderr);
  assert.equal((await request('/api/jarvis/stream','POST',{prompt:'hello'})).status,401);
  const registration=await request('/api/auth/register','POST',{name:'Test',email:'live@test.example',password:'test-password-123'});cookie=registration.headers.get('set-cookie').split(';')[0];await registration.json();
  assert.equal((await request('/api/jarvis/stream','POST',{prompt:''})).status,400);
  const response=await request('/api/jarvis/stream','POST',{prompt:'Erstelle einen Content-Plan'});assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
  const reader=response.body.getReader(),first=await reader.read();assert.ok(new TextDecoder().decode(first.value).includes('"type":"task"'),'task arrives before completion');
  let remaining=new TextDecoder().decode(first.value);while(true){const chunk=await reader.read();if(chunk.done)break;remaining+=new TextDecoder().decode(chunk.value)}
  const events=remaining.trim().split('\n').map(x=>JSON.parse(x));assert.equal(events[0].view,'plan');assert.equal(events.filter(x=>x.type==='delta').map(x=>x.text).join(''),'Grüsse aus Zürich 🚘');assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).externalAction,false);
  let projects=await (await request('/api/projects')).json();assert.equal(projects.projects.length,1);assert.equal(projects.projects[0].output,'Grüsse aus Zürich 🚘');
  let me=await (await request('/api/me')).json();assert.equal(me.usage.month,1);
  for(const prompt of ['incomplete','disconnect']){const broken=await collect(await request('/api/jarvis/stream','POST',{prompt}));assert.equal(broken.at(-1).type,'error');assert.ok(!broken.some(x=>x.type==='done'))}
  projects=await (await request('/api/projects')).json();assert.equal(projects.projects.length,1,'partial outputs are not saved');
  const paused=await request('/api/jarvis/stream','POST',{prompt:'pause test'});const pr=paused.body.getReader();await pr.read();const pauseResponse=await request('/api/jarvis/control','PUT',{paused:true});await pauseResponse.json();let pauseText='';while(true){const chunk=await pr.read();if(chunk.done)break;pauseText+=new TextDecoder().decode(chunk.value)}assert.match(pauseText,/JARVIS_PAUSED/);assert.ok(!pauseText.includes('"type":"done"'));
  assert.equal((await request('/api/jarvis/stream','POST',{prompt:'blocked'})).status,423);
  await (await request('/api/jarvis/control','PUT',{paused:false})).json();
  const overview=await collect(await request('/api/jarvis/stream','POST',{prompt:'Zeige Übersicht meiner Projekte'}));assert.equal(overview.find(x=>x.type==='context').projects.length,1);assert.equal(overview.at(-1).type,'done');
  me=await (await request('/api/me')).json();assert.equal(me.usage.month,2,'failed and paused streams do not use quota');
 }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r))}rmSync(dataDir,{recursive:true,force:true})}
});
