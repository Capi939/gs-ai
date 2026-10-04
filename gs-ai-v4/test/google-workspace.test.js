const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {mkdtempSync,rmSync}=require('node:fs');const path=require('node:path');const {tmpdir}=require('node:os');const Database=require('better-sqlite3');
test('Google OAuth consumes state, encrypts tokens, validates actions and prevents repeat sends',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'jarvis-google-')),port=41000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
 const mock=`let sends=0;global.fetch=async(url,opt)=>{if(url.includes('/token'))return {ok:true,json:async()=>({access_token:'mock-secret-access',refresh_token:'mock-secret-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events'})};if(url.includes('userinfo'))return {ok:true,json:async()=>({email:'owner@test.example',email_verified:true})};sends++;return {ok:true,json:async()=>({id:'action-'+sends})}};require('./server');`;
 const child=spawn(process.execPath,['-e',mock],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'test',SESSION_SECRET:'test-secret',GOOGLE_CLIENT_ID:'mock-client',GOOGLE_CLIENT_SECRET:'mock-secret'}});let errors='';child.stderr.on('data',x=>errors+=x);let cookie='';
 const request=(url,method='GET',body,headers={})=>fetch(base+url,{redirect:'manual',method,headers:{Connection:'close',Cookie:cookie,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 try{let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,errors);
 assert.equal((await request('/api/google/status')).status,401);
 const reg=await request('/api/auth/register','POST',{name:'Google Test',email:'google@test.example',password:'testpassword123'});cookie=reg.headers.get('set-cookie').split(';')[0];await reg.json();
 assert.equal((await(await request('/api/google/status')).json()).connected,false);
 const connect=await request('/api/google/connect');assert.equal(connect.status,302);const url=new URL(connect.headers.get('location'));assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('access_type'),'offline');const state=url.searchParams.get('state');
 const callback=await request('/api/google/callback?state='+state+'&code=fake');assert.equal(callback.headers.get('location'),'/?google=connected');
 assert.equal((await request('/api/google/callback?state='+state+'&code=fake')).status,400,'state consumed once');
 const status=await(await request('/api/google/status')).json();assert.equal(status.connected,true);assert.equal(status.email,'owner@test.example');assert.ok(!JSON.stringify(status).includes('mock-secret'));
 const db=new Database(path.join(dir,'gs-ai.sqlite'));const tokens=db.prepare('SELECT tokens FROM google_integrations').get().tokens;assert.ok(!tokens.includes('mock-secret'));db.close();
 const body={to:'customer@test.example',subject:'Grüsse',body:'Hallo Zürich',confirmed:true},headers={'Idempotency-Key':'test-request-00001'};
 assert.equal((await request('/api/actions/email','POST',{...body,confirmed:false},headers)).status,400);
 assert.equal((await request('/api/actions/email','POST',{...body,to:'bad\r\nBcc:evil@example.com'},headers)).status,400);
 const sent=await(await request('/api/actions/email','POST',body,headers)).json();assert.equal(sent.id,'action-1');assert.deepEqual(await(await request('/api/actions/email','POST',body,headers)).json(),sent);
 assert.equal((await request('/api/actions/email','POST',{...body,subject:'changed'},headers)).status,409);
 assert.equal((await request('/api/actions/calendar','POST',{confirmed:true,summary:'Meeting',start:'2026-10-05T10:00',end:'2026-10-05T11:00'},{'Idempotency-Key':'calendar-request-001'})).status,400);
 assert.equal((await request('/api/actions/calendar','POST',{confirmed:true,summary:'Meeting',start:'2026-10-05T10:00:00+02:00',end:'2026-10-05T11:00:00+02:00'},{'Idempotency-Key':'calendar-request-001'})).status,200);
 const concurrent=await Promise.all([request('/api/actions/email','POST',body,{'Idempotency-Key':'concurrent-request-001'}),request('/api/actions/email','POST',body,{'Idempotency-Key':'concurrent-request-001'})]);assert.ok(concurrent.some(r=>r.status===200));assert.ok(concurrent.every(r=>[200,409].includes(r.status)));const again=await(await request('/api/actions/email','POST',body,{'Idempotency-Key':'concurrent-request-001'})).json();assert.equal(again.id,'action-3');
 await request('/api/jarvis/control','PUT',{paused:true});assert.equal((await request('/api/actions/email','POST',body,{'Idempotency-Key':'test-request-00002'})).status,423);
 await request('/api/google/disconnect','POST',{});assert.equal((await(await request('/api/google/status')).json()).connected,false);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true})}
});
