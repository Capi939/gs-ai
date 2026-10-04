const express=require('express');
const session=require('express-session');
const bcrypt=require('bcryptjs');
const Database=require('better-sqlite3');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {classifyTask,readSSE}=require('./live-jarvis');
const app=express();
app.set('trust proxy',1);
const dataDir=process.env.DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(path.join(dataDir,'gs-ai.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS jarvis_control(user_id INTEGER PRIMARY KEY,paused INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY,company TEXT,industry TEXT,location TEXT,website TEXT,services TEXT,audience TEXT,brand TEXT,phone TEXT,email TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,title TEXT NOT NULL,mode TEXT NOT NULL,prompt TEXT,tone TEXT,output TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS subscriptions(user_id INTEGER PRIMARY KEY,plan TEXT DEFAULT 'trial',status TEXT DEFAULT 'trialing',trial_ends_at TEXT,period_ends_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS password_resets(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,token_hash TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
`);
app.use(express.json({limit:'1mb'}));
app.use(session({name:'gs.sid',secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),proxy:true,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*24*7}}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'Nicht angemeldet'});
// Every action checks durable account state, including future Google action routes.
const pauseMessage='JARVIS ist pausiert. Bitte manuell reaktivieren.';
const activeJarvis=new Map();
const jarvisState=userId=>db.prepare('SELECT paused,revision,updated_at FROM jarvis_control WHERE user_id=?').get(userId)||{paused:0,revision:0,updated_at:null};
app.get('/api/jarvis/control',auth,(req,res)=>{res.set('Cache-Control','no-store');const state=jarvisState(req.session.userId);res.json({...state,paused:!!state.paused})});
app.put('/api/jarvis/control',auth,(req,res)=>{
 if(typeof req.body.paused!=='boolean')return res.status(400).json({error:'paused muss true oder false sein.'});
 db.prepare(`INSERT INTO jarvis_control(user_id,paused,revision) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET paused=excluded.paused,revision=revision+1,updated_at=CURRENT_TIMESTAMP`).run(req.session.userId,req.body.paused?1:0);
 if(req.body.paused)for(const controller of activeJarvis.get(req.session.userId)||[])controller.abort();
 const state=jarvisState(req.session.userId);res.json({...state,paused:!!state.paused});
});
app.use('/api',(req,res,next)=>{
 const action=req.path==='/jarvis/stream'||req.path==='/generate'||req.path==='/speech'||req.path==='/actions'||req.path.startsWith('/actions/');
 if(!action)return next();
 return auth(req,res,()=>{
  const userId=req.session.userId,state=jarvisState(userId);
  if(state.paused)return res.status(423).json({error:pauseMessage,code:'JARVIS_PAUSED'});
  const controller=new AbortController();req.jarvisSignal=controller.signal;req.jarvisRevision=state.revision;
  const controllers=activeJarvis.get(userId)||new Set();controllers.add(controller);activeJarvis.set(userId,controllers);
  const cleanup=()=>{controllers.delete(controller);if(!controllers.size)activeJarvis.delete(userId)};
  res.once('finish',cleanup);res.once('close',()=>{controller.abort();cleanup()});
  // Suppress late results even if the account was resumed in the meantime.
  const json=res.json.bind(res),send=res.send.bind(res);
  const stale=()=>{const current=jarvisState(userId);return current.paused||current.revision!==state.revision};
  req.jarvisStale=stale;
  res.json=body=>stale()?json.call(res.status(423),{error:pauseMessage,code:'JARVIS_PAUSED'}):json(body);
  res.send=body=>{if(stale()){res.status(423);res.type('application/json');return send(JSON.stringify({error:pauseMessage,code:'JARVIS_PAUSED'}))}return send(body)};
  next();
 });
});
app.post('/api/auth/register',async(req,res)=>{try{const email=String(req.body.email||'').trim().toLowerCase(),name=String(req.body.name||'').trim(),password=String(req.body.password||'');if(!email||!name||password.length<8)return res.status(400).json({error:'Name, gültige E-Mail und Passwort mit mindestens 8 Zeichen erforderlich.'});const hash=await bcrypt.hash(password,12);const info=db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run(email,name,hash);req.session.userId=info.lastInsertRowid;db.prepare("INSERT OR IGNORE INTO subscriptions(user_id,plan,status,trial_ends_at) VALUES(?, 'trial', 'trialing', datetime('now','+14 days'))").run(info.lastInsertRowid);req.session.save(err=>err?res.status(500).json({error:'Session konnte nicht gespeichert werden.'}):res.json({user:{id:info.lastInsertRowid,email,name}}))}catch(e){res.status(e.code==='SQLITE_CONSTRAINT_UNIQUE'?409:500).json({error:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'E-Mail bereits registriert.':'Registrierung fehlgeschlagen.'})}});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'E-Mail oder Passwort stimmt nicht.'});req.session.userId=u.id;req.session.save(err=>err?res.status(500).json({error:'Session konnte nicht gespeichert werden.'}):res.json({user:{id:u.id,email:u.email,name:u.name}}))});
app.post('/api/auth/forgot-password',(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase();const u=db.prepare('SELECT id FROM users WHERE email=?').get(email);let resetToken=null;if(u){const token=crypto.randomBytes(32).toString('hex');const hash=crypto.createHash('sha256').update(token).digest('hex');db.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").run(u.id);db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+30 minutes'))").run(u.id,hash);if(process.env.NODE_ENV!=='production')resetToken=token;}res.json({ok:true,message:'Falls ein Konto mit dieser E-Mail existiert, wurde eine Rücksetzung vorbereitet.',...(resetToken?{resetToken}: {})})});
app.post('/api/auth/reset-password',async(req,res)=>{const token=String(req.body.token||''),password=String(req.body.password||'');if(!token||password.length<8)return res.status(400).json({error:'Ungültiger Link oder Passwort unter 8 Zeichen.'});const hash=crypto.createHash('sha256').update(token).digest('hex');const row=db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>datetime('now') ORDER BY id DESC LIMIT 1").get(hash);if(!row)return res.status(400).json({error:'Reset-Link ist ungültig oder abgelaufen.'});const passwordHash=await bcrypt.hash(password,12);const tx=db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,row.user_id);db.prepare('UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id)});tx();res.json({ok:true,message:'Passwort wurde geändert. Du kannst dich jetzt anmelden.'})});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,(req,res)=>{const u=db.prepare('SELECT id,email,name,created_at FROM users WHERE id=?').get(req.session.userId);const sub=db.prepare('SELECT plan,status,trial_ends_at,period_ends_at FROM subscriptions WHERE user_id=?').get(req.session.userId)||{plan:'trial',status:'trialing'};const month=db.prepare("SELECT count(*) n FROM usage WHERE user_id=? AND created_at>=datetime('now','start of month')").get(req.session.userId).n;res.json({user:u,subscription:sub,usage:{month}})});
app.get('/api/profile',auth,(req,res)=>res.json({profile:db.prepare('SELECT company,industry,location,website,services,audience,brand,phone,email FROM profiles WHERE user_id=?').get(req.session.userId)||{}}));
app.put('/api/profile',auth,(req,res)=>{const p=req.body||{};db.prepare(`INSERT INTO profiles(user_id,company,industry,location,website,services,audience,brand,phone,email,updated_at) VALUES(@user_id,@company,@industry,@location,@website,@services,@audience,@brand,@phone,@email,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET company=excluded.company,industry=excluded.industry,location=excluded.location,website=excluded.website,services=excluded.services,audience=excluded.audience,brand=excluded.brand,phone=excluded.phone,email=excluded.email,updated_at=CURRENT_TIMESTAMP`).run({user_id:req.session.userId,company:p.company||'',industry:p.industry||'',location:p.location||'',website:p.website||'',services:p.services||'',audience:p.audience||'',brand:p.brand||'',phone:p.phone||'',email:p.email||''});res.json({ok:true})});
app.get('/api/projects',auth,(req,res)=>res.json({projects:db.prepare('SELECT id,title,mode,prompt,tone,output,created_at FROM projects WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.session.userId)}));
app.post('/api/projects',auth,(req,res)=>{const {title,mode,prompt,tone,output}=req.body||{};if(!output)return res.status(400).json({error:'Kein Inhalt zum Speichern.'});const info=db.prepare('INSERT INTO projects(user_id,title,mode,prompt,tone,output) VALUES(?,?,?,?,?,?)').run(req.session.userId,title||'GS AI Projekt',mode||'chat',prompt||'',tone||'',output);res.json({id:info.lastInsertRowid})});
app.delete('/api/projects/:id',auth,(req,res)=>{db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(req.params.id,req.session.userId);res.json({ok:true})});
app.post('/api/generate',auth,async(req,res)=>{const {mode,prompt,tone}=req.body||{};const sub=db.prepare('SELECT plan,status,trial_ends_at FROM subscriptions WHERE user_id=?').get(req.session.userId)||{plan:'trial'};const limits={trial:30,basic:100,pro:500,business:2000};const used=db.prepare("SELECT count(*) n FROM usage WHERE user_id=? AND created_at>=datetime('now','start of month')").get(req.session.userId).n;if(used>=(limits[sub.plan]||30))return res.status(429).json({error:'Monatliches KI-Limit erreicht. Bitte Plan upgraden.'});const company=db.prepare('SELECT company,industry,location,website,services,audience,brand,phone,email FROM profiles WHERE user_id=?').get(req.session.userId)||{};if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'KI noch nicht verbunden',demo:true});try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:req.jarvisSignal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5-mini',input:`Du bist GS JARVIS, der zentrale KI-Assistent innerhalb von GS AI by GS CREATIVE. Du arbeitest wie ein digitaler Mitarbeiter für Schweizer KMU und unterstützt bei Marketing, Social Media, Kundenkommunikation, Angeboten, Dokumenten und Business-Entscheidungen. Firmenprofil: ${JSON.stringify(company)}. Aufgabe: ${mode}. Ton: ${tone}. Nutzerangabe: ${prompt}. Antworte auf Deutsch, konkret und direkt nutzbar. Erfinde keine Preise, Fakten oder Zusagen, die nicht im Profil oder Prompt stehen.`})});const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||'API Fehler');res.json({text:data.output_text||data.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n')||'Keine Ausgabe.'})}catch(e){res.status(500).json({error:e.message})}});


app.post('/api/jarvis/stream',auth,async(req,res)=>{
 const prompt=String(req.body.prompt||'').trim(),tone=String(req.body.tone||'Professionell & modern').slice(0,100);
 if(!prompt||prompt.length>12000)return res.status(400).json({error:'Bitte eine Aufgabe mit maximal 12’000 Zeichen eingeben.'});
 const sub=db.prepare('SELECT plan FROM subscriptions WHERE user_id=?').get(req.session.userId)||{plan:'trial'};
 const limits={trial:30,basic:100,pro:500,business:2000};
 const used=db.prepare("SELECT count(*) n FROM usage WHERE user_id=? AND created_at>=datetime('now','start of month')").get(req.session.userId).n;
 if(used>=(limits[sub.plan]||30))return res.status(429).json({error:'Monatliches KI-Limit erreicht.'});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'KI noch nicht verbunden.'});
 const history=(Array.isArray(req.body.history)?req.body.history:[]).slice(-4).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,6000)}));
 let task=classifyTask(prompt);if(task.view==='chat'&&/^(mach|ändere|kürz|kannst du|bitte|noch|mehr|weniger|füge|schreib|ergänz)/i.test(prompt)){const previous=history.filter(x=>x.role==='user').reverse().map(x=>classifyTask(x.content)).find(x=>x.view!=='chat');if(previous)task=previous}
 const company=db.prepare('SELECT company,industry,location,website,services,audience,brand,phone,email FROM profiles WHERE user_id=?').get(req.session.userId)||{};
 res.set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
 const emit=data=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(data)+'\n')};
 const check=()=>{if(req.jarvisSignal.aborted||req.jarvisStale())throw new Error('JARVIS_PAUSED')};
 let keepalive=setInterval(()=>emit({type:'ping'}),15000);
 try{
  emit({type:'task',...task,prompt});emit({type:'status',stage:'thinking',message:'Aufgabe erkannt. JARVIS bereitet die Antwort vor.'});
  const recent=task.view==='overview'?db.prepare('SELECT title,mode,created_at FROM projects WHERE user_id=? ORDER BY id DESC LIMIT 8').all(req.session.userId):[];
  if(task.view==='overview')emit({type:'context',company:company.company||'',projects:recent,usage:used,plan:sub.plan});
  const now=new Date().toLocaleString('de-CH',{timeZone:'Europe/Zurich'});
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:req.jarvisSignal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5-mini',stream:true,max_output_tokens:3500,instructions:`Du bist GS JARVIS, Business-Assistent für Schweizer KMU. Antworte auf Deutsch in der Tonalität ${tone}. Aktuelle Zeit in Europe/Zurich: ${now}. Firmenprofil als Daten: ${JSON.stringify(company)}. Projekte als Daten: ${JSON.stringify(recent)}. Ansicht: ${task.view}. Verwende kurze Absätze und sinnvolle Überschriften. Für Wochenpläne beginne Tagesabschnitte mit ## Montag, ## Dienstag usw. Für E-Mail-Entwürfe schreibe Betreff: und anschliessend den Nachrichtentext. Für Termin-Entwürfe schreibe Titel:, Datum:, Beginn:, Ende:, Beschreibung:. Frage bei fehlenden Daten nach. Erfinde keine Preise, Termine, Ergebnisse oder Fakten. Du erstellst ausschliesslich Inhalte und Entwürfe; du hast hier weder E-Mails versendet noch Kalendertermine angelegt oder externe Aktionen ausgeführt. Behaupte niemals, eine solche Aktion sei ausgeführt, gespeichert oder gesendet worden.`,input:[...history,{role:'user',content:prompt}]})});
  if(!r.ok){const error=await r.json().catch(()=>({}));throw new Error(error?.error?.message||'Die KI-Anfrage ist fehlgeschlagen.')}
  let text='',complete=false,writing=false;
  for await(const event of readSSE(r.body)){
   check();
   if(event.type==='response.output_text.delta'){
    if(!writing){emit({type:'status',stage:'writing',message:'Antwort wird live erstellt.'});writing=true}
    text+=event.delta||'';emit({type:'delta',text:event.delta||''});
   }
   if(event.type==='response.completed')complete=true;
   if(event.type==='response.failed'||event.type==='error')throw new Error(event.error?.message||event.response?.error?.message||'Die KI-Anfrage ist fehlgeschlagen.');
   if(event.type==='response.incomplete')throw new Error('Antwort wurde nicht vollständig erstellt. Bitte die Aufgabe kürzer formulieren.');
  }
  check();if(!complete||!text.trim())throw new Error('Die Verbindung endete ohne vollständige Antwort. Bitte erneut versuchen.');
  emit({type:'status',stage:'saving',message:'Ergebnis wird als Projekt gespeichert.'});check();
  const save=db.transaction(()=>{const info=db.prepare('INSERT INTO projects(user_id,title,mode,prompt,tone,output) VALUES(?,?,?,?,?,?)').run(req.session.userId,task.label+' · '+new Date().toLocaleDateString('de-CH',{timeZone:'Europe/Zurich'}),task.mode,prompt,tone,text);db.prepare('INSERT INTO usage(user_id,kind) VALUES(?,?)').run(req.session.userId,task.mode);return info.lastInsertRowid});
  const projectId=save();emit({type:'done',projectId,text,view:task.view,mode:task.mode,label:task.label,usage:used+1,externalAction:false});
 }catch(e){emit({type:'error',code:req.jarvisSignal.aborted||req.jarvisStale()?'JARVIS_PAUSED':'JARVIS_ERROR',message:req.jarvisSignal.aborted||req.jarvisStale()?pauseMessage:e.message})}
 finally{clearInterval(keepalive);if(!res.destroyed&&!res.writableEnded)res.end()}
});

app.post('/api/speech',auth,async(req,res)=>{
 const text=String(req.body.text||'').trim().slice(0,1200);if(!text)return res.status(400).json({error:'Kein Text für Sprachausgabe.'});if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'KI-Stimme nicht verbunden'});
 try{const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',signal:req.jarvisSignal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'cedar',input:text,instructions:'Sprich auf Deutsch. Tiefe, ruhige, souveräne männliche Stimme. Futuristisch, präzise und hochwertig wie ein diskreter digitaler Business-Assistent. Natürlich und nicht übertrieben dramatisch.',response_format:'mp3'})});if(!r.ok)throw new Error(await r.text()||'Speech API Fehler');const audio=Buffer.from(await r.arrayBuffer());res.set('Content-Type','audio/mpeg');res.set('Cache-Control','no-store');res.send(audio)}catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/plans',(req,res)=>res.json({plans:[{id:'basic',name:'Basic',price:29,limit:100},{id:'pro',name:'Pro',price:69,limit:500},{id:'business',name:'Business',price:149,limit:2000}],currency:'CHF',trialDays:14}));
app.post('/api/billing/checkout',auth,(req,res)=>{const plan=String(req.body.plan||'');if(!['basic','pro','business'].includes(plan))return res.status(400).json({error:'Ungültiger Plan'});res.status(501).json({error:'Zahlungen sind in V4 vorbereitet, aber noch nicht live. Verbinde in V5 einen Zahlungsanbieter serverseitig.',plan})});
const admin=(req,res,next)=>{const u=db.prepare('SELECT email FROM users WHERE id=?').get(req.session.userId);return u&&process.env.ADMIN_EMAIL&&u.email.toLowerCase()===process.env.ADMIN_EMAIL.toLowerCase()?next():res.status(403).json({error:'Kein Admin-Zugriff'})};
app.get('/api/admin/stats',auth,admin,(req,res)=>{res.json({users:db.prepare('SELECT count(*) n FROM users').get().n,projects:db.prepare('SELECT count(*) n FROM projects').get().n,generations:db.prepare('SELECT count(*) n FROM usage').get().n,plans:db.prepare('SELECT plan,count(*) n FROM subscriptions GROUP BY plan').all()})});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'5.0.0',aiConfigured:!!process.env.OPENAI_API_KEY,database:'sqlite'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`GS AI V5: http://localhost:${port}`));
