const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('pause blocks actions, aborts pending work, isolates accounts and survives restart',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'jarvis-control-'));let child;
 let port=18000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 const start=async()=>{
  child=spawn(process.execPath,['-e',`global.fetch=async(url,options)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,500);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'))},{once:true})});return {ok:true,json:async()=>({output_text:'Test output'}),arrayBuffer:async()=>new ArrayBuffer(1)}};require('./server.js')`],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,NODE_ENV:'test',OPENAI_API_KEY:'test-only'}});
  child.stderr.on('data',d=>process.stderr.write(d));let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health',{headers:{Connection:'close'}})).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,'server starts');
 };
 const stop=async()=>{const current=child;if(current&&current.exitCode===null){current.kill();await new Promise(r=>current.once('exit',r))}};
 const request=async(route,method='GET',body,cookie)=>{let r;try{r=await fetch(base+route,{method,headers:{Connection:'close','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch(e){e.message=route+' '+method+': '+e.message;throw e}return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const register=async(email)=>(await request('/api/auth/register','POST',{name:'Pause test',email,password:'test-password-123'})).cookie;
 try{
  await start();assert.equal((await request('/api/jarvis/control','PUT',{paused:true})).status,401);
  let a=await register('a@test.example'),b=await register('b@test.example');
  assert.equal((await request('/api/jarvis/control','PUT',{paused:'true'},a)).status,400);
  const pending=request('/api/generate','POST',{prompt:'pending'},a);
  await new Promise(r=>setTimeout(r,100));
  assert.equal((await request('/api/jarvis/control','PUT',{paused:true},a)).body.paused,true);
  assert.equal((await pending).status,423);
  for(const route of ['/api/generate','/api/speech','/api/actions/email','/api/actions/calendar'])assert.equal((await request(route,'POST',{text:'test'},a)).status,423,route);
  assert.equal((await request('/api/generate','POST',{prompt:'other account'},b)).status,200);
  assert.equal((await request('/api/profile','GET',null,a)).status,200);
  await stop();port++;base=`http://127.0.0.1:${port}`;await start();a=(await request('/api/auth/login','POST',{email:'a@test.example',password:'test-password-123'})).cookie;
  assert.equal((await request('/api/jarvis/control','GET',null,a)).body.paused,true);
  assert.equal((await request('/api/generate','POST',{prompt:'still paused'},a)).status,423);
  assert.equal((await request('/api/jarvis/control','PUT',{paused:false},a)).body.paused,false);
  assert.equal((await request('/api/generate','POST',{prompt:'resumed'},a)).status,200);
 }finally{await stop();rmSync(dataDir,{recursive:true,force:true})}
});

test('browser pause stops microphone and audio and disables generation until resume',async()=>{
 const vm=require('node:vm'),{readFileSync}=require('node:fs');let state={paused:false,revision:0},micStopped=0,audioStopped=0,synthesisStopped=0;
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{innerText:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}}});return elements.get(id)};
 const context=vm.createContext({document:{getElementById:element,addEventListener(){}},window:{speechSynthesis:{cancel(){synthesisStopped++}}},setInterval(){},setTimeout,console,fetch:async(url,opt={})=>{if(opt.method==='PUT')state={paused:JSON.parse(opt.body).paused,revision:state.revision+1};return {ok:true,json:async()=>state}}});
 const script=readFileSync(path.join(__dirname,'../public/index.html'),'utf8').split('<script>')[1].split('</script>')[0].replace('boot();','');
 vm.runInContext(script,context);context.mic={abort(){micStopped++}};context.audio={pause(){audioStopped++}};
 await vm.runInContext('refreshJarvisControl()',context);
 vm.runInContext('recognition=mic;jarvisAudio=audio;',context);
 await vm.runInContext('toggleJarvisPause()',context);
 assert.equal(state.paused,true);assert.ok(micStopped>=1);assert.equal(audioStopped,1);assert.ok(synthesisStopped>=1);assert.equal(element('voiceBtn').disabled,true);assert.equal(element('generateBtn').disabled,true);
 assert.equal(element('jarvisPauseBtn').innerText,'JARVIS reaktivieren');
 await vm.runInContext('toggleJarvisPause()',context);
 assert.equal(state.paused,false);assert.equal(element('generateBtn').disabled,false);assert.equal(element('jarvisControlStatus').innerText,'● JARVIS AKTIV');
});
