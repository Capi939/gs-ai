/* Render only text and predefined components; model output never becomes executable markup. */
(()=>{
 const $=id=>document.getElementById(id);
 const ui={controller:null,busy:false,text:'',task:null,projectId:null,history:[],messages:[],audioUrl:null,voiceSerial:0,voiceCommand:false,loadedHistory:false};
 const micIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
 const labels={idle:'Bereit für deine Aufgabe',listening:'JARVIS hört zu',thinking:'Aufgabe wird verstanden',writing:'Dein Ergebnis entsteht live',saving:'Projekt wird gespeichert',done:'Dein Ergebnis ist bereit',speaking:'JARVIS spricht',paused:'JARVIS ist pausiert',error:'Aufgabe nicht abgeschlossen',cancelled:'Aufgabe abgebrochen'};
 titles.email='E-Mail Studio';titles.calendar='Terminplanung';samples.email='Erstelle einen E-Mail-Entwurf. Frage nach Empfänger und Anlass.';samples.calendar='Plane einen Termin. Frage nach Datum und Uhrzeit.';
 const views={calendar:['Terminplanung','TERMIN-ENTWURF'],email:['E-Mail Studio','E-MAIL-ENTWURF'],plan:['Wochenplan','CONTENT-PLAN'],offer:['Offerten Studio','OFFERTEN-ENTWURF'],social:['Social Studio','SOCIAL-MEDIA-POST'],ad:['Ad Creator','WERBEANZEIGE'],reply:['Kundenantwort','ANTWORT-ENTWURF'],overview:['Business Übersicht','DEIN BUSINESS'],chat:['JARVIS Workspace','ANTWORT']};
 function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element}
 function state(next){
  $('liveConsole').dataset.state=next;$('liveCoreState').textContent=labels[next]||next;$('jarvisReady').textContent='JARVIS';$('jarvisCoreHint').textContent=next==='idle'?'SPRICH ODER SCHREIBE':next==='paused'?'AKTIONEN GESPERRT':'LIVE WORKSPACE';
  $('liveConnection').textContent=next==='paused'?'● Pausiert':ui.busy?'● Live verbunden':next==='error'?'● Fehler':'● Bereit';
  $('liveRunBtn').disabled=jarvisPaused||ui.busy;$('liveRunBtn').textContent=ui.busy?'Läuft…':'Starten ↗';
  $('liveCancelBtn').classList.toggle('hidden',!ui.busy);$('liveSurface').setAttribute('aria-busy',String(ui.busy));
 }
 function log(message){
  const p=node('p','',message),time=node('time','',new Date().toLocaleTimeString('de-CH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));p.prepend(time);$('liveActivityLog').append(p);
  while($('liveActivityLog').children.length>8)$('liveActivityLog').firstElementChild.remove();
 }
 function localView(q){
  const s=q.toLowerCase();if(/e-?mail|gmail|mail senden|nachricht senden/.test(s))return 'email';if(/content.?plan|wochenplan|monatsplan|7.?tage|sieben tage|plan.*post/.test(s))return 'plan';if(/offerte|kostenvoranschlag|angebot (erstellen|schreiben)/.test(s))return 'offer';if(/instagram|social|post|caption|story|hashtag|reel/.test(s))return 'social';if(/werbung|werbeanzeige|inserat|fahrzeuganzeige/.test(s))return 'ad';if(/kalender|termin|besprechung|meeting/.test(s))return 'calendar';if(/antwort|kundenanfrage|reply/.test(s))return 'reply';if(/übersicht|dashboard|projekte zeigen|projekte öffnen/.test(s))return 'overview';return 'chat';
 }
 function openView(view){
  const spec=views[view]||views.chat;$('liveConsole').dataset.view=view;$('liveViewTitle').textContent=spec[0];$('liveViewType').textContent=spec[1];
  $('liveSurface').classList.remove('hidden','error');$('liveWelcome').classList.add('hidden');
  const draft=view==='email'||view==='calendar';$('liveDraftNote').classList.toggle('hidden',!draft);
  $('liveDraftNote').textContent=view==='email'?'E-Mail-Entwurf. Es wurde keine E-Mail versendet.':view==='calendar'?'Termin-Entwurf. Es wurde kein Termin im Google Kalender angelegt.':'';
 }
 function dataCard(label,value){const card=node('div','liveDataCard');card.append(node('span','',label),node('strong','',String(value)));return card}
 function showContext(event){
  const target=$('liveContextCards');target.replaceChildren();target.classList.remove('hidden');
  target.append(dataCard('UNTERNEHMEN',event.company||'Profil noch einrichten'),dataCard('KI-NUTZUNG DIESEN MONAT',event.usage??0));
  if(event.projects?.length)for(const p of event.projects.slice(0,4))target.append(dataCard('GESPEICHERTES PROJEKT',p.title));
  else target.append(dataCard('DEINE PROJEKTE','Noch keine gespeicherten Projekte'));
 }
 function formattedResult(text,view){
  const out=$('liveOutput');out.replaceChildren();out.classList.remove('streaming','liveDocument');
  if(view==='plan'){
   const heading=/^\s*#{0,3}\s*(?:\*\*)?((?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Tag\s*\d+)[^\n]*?)(?:\*\*)?\s*$/gim;
   const matches=[...text.matchAll(heading)];
   if(matches.length>=2){
    const intro=text.slice(0,matches[0].index).trim();if(intro)out.append(node('p','',intro));const grid=node('div','livePlanGrid');
    for(let i=0;i<matches.length;i++){const card=node('article','liveDayCard');card.append(node('h3','',matches[i][1].replace(/\*\*/g,'')),node('p','',text.slice(matches[i].index+matches[i][0].length,matches[i+1]?.index??text.length).trim()));grid.append(card)}out.append(grid);return;
   }
  }
  if(view==='social'||view==='ad'){
   const post=node('article','livePost'),header=node('div','livePostHeader');header.append(node('span','livePostAvatar','GS'),node('span','',profile.company||'Dein Unternehmen'));post.append(header,node('div','livePostBody',text));out.append(post);return;
  }
  if(view==='email'){
   const subject=/^\s*(?:\*\*)?Betreff\s*:(?:\*\*)?\s*(.+)$/im.exec(text);if(subject){out.append(node('div','liveEmailSubject','Betreff: '+subject[1].replace(/\*\*/g,'')));out.append(node('div','',text.slice(0,subject.index)+text.slice(subject.index+subject[0].length).trimStart()));return}
  }
  if(view==='calendar'){
   const fields=[...text.matchAll(/^\s*(?:\*\*)?(Titel|Datum|Beginn|Ende|Beschreibung)\s*:(?:\*\*)?\s*([^\n]+)$/gim)];
   if(fields.length>=2){const grid=node('div','liveCalendarFields');for(const f of fields)grid.append(dataCard(f[1].toUpperCase(),f[2].replace(/\*\*/g,'')));out.append(grid);const remainder=text.replace(/^\s*(?:\*\*)?(Titel|Datum|Beginn|Ende|Beschreibung)\s*:(?:\*\*)?\s*[^\n]+$/gim,'').trim();if(remainder)out.append(node('div','',remainder));return}
  }
  if(view==='offer')out.classList.add('liveDocument');out.textContent=text;
 }
 function renderHistory(){
  const target=$('liveHistory');target.replaceChildren();
  if(!ui.history.length){target.append(node('p','','Noch keine gespeicherten Aufgaben.'));return}
  for(const item of ui.history.slice(0,5)){const button=node('button','',item.title);button.addEventListener('click',()=>openHistory(item));target.append(button)}
 }
 async function openHistory(item){
  if(ui.busy){setVoiceState('Bitte erst die aktuelle Aufgabe abschliessen oder abbrechen.');return}
  showPage('dashboard');ui.text=item.output;ui.projectId=item.id;ui.task={view:localView(item.prompt||''),mode:item.mode,label:item.title};openView(ui.task.view);formattedResult(ui.text,ui.task.view);$('liveResultActions').classList.remove('hidden');$('liveResultStatus').textContent='Gespeichertes Projekt';$('liveTranscript').classList.remove('hidden');$('liveTranscriptText').textContent=item.prompt||'';state(jarvisPaused?'paused':'done');
 }
 async function loadHistory(){try{const d=await api('/api/projects');ui.history=d.projects||[];renderHistory()}catch{}}
 function stopAudio(){ui.voiceSerial++;if(jarvisAudio){jarvisAudio.pause();jarvisAudio=null}if(ui.audioUrl){URL.revokeObjectURL(ui.audioUrl);ui.audioUrl=null}window.speechSynthesis?.cancel()}
 function abortRun(reason){
  if(ui.controller)ui.controller.abort();ui.controller=null;ui.busy=false;stopAudio();
  $('liveOutput').classList.remove('streaming');$('liveResultActions').classList.add('hidden');
  if(reason==='paused'){$('liveResultStatus').textContent='Pausiert';state('paused')}else{$('liveResultStatus').textContent='Abgebrochen';state('cancelled');log('Aufgabe manuell abgebrochen.');setVoiceState('Aufgabe abgebrochen. Du kannst eine neue Aufgabe starten.')}
  ['stepListen','stepThink','stepAct','stepSave','stepDone'].forEach(id=>$(id).classList.remove('active'));
 }
 function handle(event,ensure){
  ensure();
  if(event.type==='task'){ui.task=event;mode=event.mode;openView(event.view);log(event.title+' geöffnet.');return}
  if(event.type==='context'){showContext(event);return}
  if(event.type==='status'){
   state(event.stage);jarvisProgress({thinking:'think',writing:'act',saving:'save'}[event.stage]||'think');$('liveResultStatus').textContent=event.stage==='saving'?'Wird gespeichert':event.stage==='writing'?'Live-Ausgabe':'Wird vorbereitet';setVoiceState(event.message);log(event.message);return;
  }
  if(event.type==='delta'){ui.text+=event.text||'';$('liveOutput').textContent=ui.text;$('liveOutput').classList.add('streaming');return}
  if(event.type==='error'){const error=new Error(event.message||'Die Aufgabe konnte nicht abgeschlossen werden.');error.code=event.code;throw error}
  if(event.type==='done'){
   ui.text=event.text;ui.projectId=event.projectId;ui.busy=false;formattedResult(ui.text,event.view);$('liveResultStatus').textContent='✓ Als Projekt gespeichert';$('liveResultActions').classList.remove('hidden');jarvisProgress('done');state('done');setVoiceState('✓ '+event.label+' erstellt und als Projekt gespeichert.');log('Projekt #'+event.projectId+' gespeichert.');
   if(window.account){window.account.usage={month:event.usage};renderPlan()}
   ui.history.unshift({id:event.projectId,title:event.label,mode:event.mode,prompt:$('liveTranscriptText').textContent,output:ui.text});renderHistory();
   ui.messages.push({role:'user',content:$('liveTranscriptText').textContent},{role:'assistant',content:ui.text});ui.messages=ui.messages.slice(-4);
   speakJarvis(event.view==='email'?'Dein E-Mail-Entwurf ist bereit. Es wurde keine E-Mail versendet.':event.view==='calendar'?'Dein Termin-Entwurf ist bereit. Es wurde kein Kalendertermin angelegt.':event.label+' ist bereit und wurde als Projekt gespeichert.');
  }
 }
 // The HTTP response is NDJSON. Keep incomplete lines until the next chunk arrives.
 async function readLive(body,onEvent){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(line)onEvent(JSON.parse(line))}if(done)break}if(buffer.trim())onEvent(JSON.parse(buffer))}finally{reader.releaseLock()}
 }
 runJarvis=async function(){
  if(jarvisPaused){setVoiceState('JARVIS ist pausiert. Bitte manuell reaktivieren.');return}if(ui.busy){setVoiceState('JARVIS arbeitet bereits. Du kannst die aktuelle Aufgabe abbrechen.');return}
  const q=$('jarvisCommand').value.trim();if(!q)return;
  showPage('dashboard');$('stepListen').textContent=ui.voiceCommand?'01 · Sprache erkannt':'01 · Aufgabe erhalten';ui.voiceCommand=false;if(recognition&&isListening)recognition.stop();stopAudio();
  const epoch=jarvisEpoch,controller=new AbortController();ui.controller=controller;ui.busy=true;ui.text='';ui.projectId=null;ui.task={view:localView(q)};
  const ensure=()=>{if(jarvisPaused||epoch!==jarvisEpoch||controller.signal.aborted)throw new DOMException('Aufgabe abgebrochen','AbortError')};
  $('liveTranscript').classList.remove('hidden');$('liveTranscriptText').textContent=q;$('liveOutput').replaceChildren();$('liveOutput').classList.add('streaming');$('liveResultActions').classList.add('hidden');$('liveContextCards').classList.add('hidden');$('liveContextCards').replaceChildren();$('liveActivityLog').replaceChildren();
  openView(ui.task.view);state('thinking');jarvisProgress('think');$('liveResultStatus').textContent='Wird vorbereitet';setVoiceState('JARVIS verbindet sich mit der KI…');log('Aufgabe an JARVIS übergeben.');let completed=false;
  try{
   const r=await fetch('/api/jarvis/stream',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:q,tone:'Professionell & modern',history:ui.messages})});ensure();
   if(!r.ok){const d=await r.json().catch(()=>({}));const e=new Error(d.error||'Die Verbindung ist fehlgeschlagen.');e.code=d.code;throw e}
   if(!r.body)throw new Error('Dieser Browser unterstützt keine Live-Ausgabe.');
   await readLive(r.body,event=>{handle(event,ensure);if(event.type==='done')completed=true});ensure();if(!completed)throw new Error('Die Verbindung wurde unterbrochen. Das Ergebnis wurde nicht vollständig gespeichert.');
  }catch(e){
   if(ui.controller!==controller)return;
   if(e.code==='JARVIS_PAUSED'){await refreshJarvisControl();abortRun('paused');return}
   if(controller.signal.aborted||jarvisPaused||epoch!==jarvisEpoch){if(jarvisPaused)state('paused');return}
   ui.busy=false;state('error');$('liveSurface').classList.add('error');$('liveOutput').classList.remove('streaming');$('liveResultStatus').textContent='Nicht abgeschlossen';setVoiceState(e.message);log(e.message);if(!ui.text)$('liveOutput').textContent=e.message;
   ['stepListen','stepThink','stepAct','stepSave','stepDone'].forEach(id=>$(id).classList.remove('active','done'));
  }finally{if(ui.controller===controller){ui.controller=null;ui.busy=false;state(jarvisPaused?'paused':$('liveConsole').dataset.state)}}
 };
 toggleVoice=function(){
  if(jarvisPaused){setVoiceState('JARVIS ist pausiert.');return}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){setVoiceState('Dein Browser unterstützt diese Spracherkennung nicht. Bitte Aufgabe eintippen oder Chrome/Edge verwenden.');return}
  if(isListening&&recognition){recognition.stop();return}
  if(ui.busy)abortRun('cancelled');stopAudio();
  recognition=new SR();const current=recognition;current.lang='de-DE';current.interimResults=true;current.continuous=false;let submitted=false;
  current.onstart=()=>{if(jarvisPaused||recognition!==current){current.abort();return}isListening=true;$('stepListen').textContent='01 · Sprache aufnehmen';state('listening');jarvisProgress('listen');$('voiceBtn').classList.add('listening');$('voiceBtn').textContent='●';setVoiceState('JARVIS hört zu. Sprich deine Aufgabe aus.');$('liveTranscript').classList.remove('hidden');$('liveTranscriptText').textContent='…';log('Mikrofon aktiv.');};
  current.onresult=e=>{if(jarvisPaused||recognition!==current)return;let transcript='';for(let i=0;i<e.results.length;i++)transcript+=e.results[i][0].transcript+' ';transcript=transcript.trim();$('jarvisCommand').value=transcript;$('liveTranscriptText').textContent=transcript;if(e.results[e.results.length-1].isFinal&&!submitted){submitted=true;ui.voiceCommand=true;current.stop();runJarvis()}};
  current.onerror=e=>{isListening=false;state(jarvisPaused?'paused':'error');const message=e.error==='not-allowed'?'Bitte den Mikrofonzugriff im Browser erlauben.':'Mikrofon: '+e.error;setVoiceState(message);log(message)};
  current.onend=()=>{if(recognition!==current)return;isListening=false;$('voiceBtn').classList.remove('listening');$('voiceBtn').innerHTML=micIcon;if(!ui.busy&&!submitted)state(jarvisPaused?'paused':'idle')};
  try{current.start()}catch(e){setVoiceState('Mikrofon konnte nicht gestartet werden: '+e.message);state('error')}
 };
 speakJarvis=async function(text){
  if(!text||jarvisPaused)return;stopAudio();const serial=ui.voiceSerial,epoch=jarvisEpoch;
  const valid=()=>!jarvisPaused&&epoch===jarvisEpoch&&serial===ui.voiceSerial&&!isListening;
  const clean=String(text).replace(/[#*_]/g,' ').replace(/https?:\/\/\S+/g,'').slice(0,1200);
  try{const r=await fetch('/api/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean})});if(r.status===423){await refreshJarvisControl();return}if(!r.ok)throw new Error('Sprachausgabe nicht verfügbar');const blob=await r.blob();if(!valid())return;ui.audioUrl=URL.createObjectURL(blob);jarvisAudio=new Audio(ui.audioUrl);jarvisAudio.onplaying=()=>{if(valid())state('speaking')};jarvisAudio.onended=()=>{if(valid())state('done')};await jarvisAudio.play()}
  catch{if(!valid())return;if('speechSynthesis' in window){const utterance=new SpeechSynthesisUtterance(clean);utterance.lang='de-DE';utterance.rate=.94;utterance.pitch=.82;utterance.onstart=()=>{if(valid())state('speaking')};utterance.onend=()=>{if(valid())state('done')};window.speechSynthesis.speak(utterance)}}
 };
 window.jarvisLive={
  pause(){abortRun('paused')},
  control(status){$('jarvisReady').textContent='JARVIS';$('jarvisCoreHint').textContent=status.paused?'AKTIONEN GESPERRT':ui.busy?'LIVE WORKSPACE':'SPRICH ODER SCHREIBE';if(status.paused){state('paused')}else if($('liveConsole').dataset.state==='paused'){state('idle');$('voiceBtn').innerHTML=micIcon}if(!ui.loadedHistory&&window.account){ui.loadedHistory=true;loadHistory()}$('liveRunBtn').disabled=status.paused||ui.busy},
  cancel(){abortRun('cancelled')},
  async copy(){if(!ui.text)return;try{await navigator.clipboard.writeText(ui.text);setVoiceState('Text in die Zwischenablage kopiert.')}catch{setVoiceState('Kopieren ist hier nicht verfügbar. Markiere den Text im Ergebnis.')}},
  edit(){if(!ui.text)return;const mode=['social','ad','reply','plan','offer','chat'].includes(ui.task?.mode)?ui.task.mode:'chat';openTool(mode);$('prompt').value=$('liveTranscriptText').textContent;$('output').textContent=ui.text},
  readLive,formattedResult
 };
 $('jarvisCommand').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();runJarvis()}});
})();
