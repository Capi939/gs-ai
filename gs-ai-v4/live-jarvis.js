'use strict';
function classifyTask(prompt){
 const q=String(prompt).toLowerCase();
 if(/e-?mail|gmail|mail senden|nachricht senden/.test(q))return {view:'email',mode:'email',title:'E-Mail Studio',label:'E-Mail-Entwurf'};
 if(/content.?plan|wochenplan|monatsplan|7.?tage|sieben tage|plan.*post/.test(q))return {view:'plan',mode:'plan',title:'Wochenplan',label:'Content-Plan'};
 if(/offerte|kostenvoranschlag|angebot (erstellen|schreiben)/.test(q))return {view:'offer',mode:'offer',title:'Offerten Studio',label:'Offerten-Entwurf'};
 if(/instagram|social|post|caption|story|hashtag|reel/.test(q))return {view:'social',mode:'social',title:'Social Studio',label:'Social-Media-Post'};
 if(/werbung|werbeanzeige|inserat|fahrzeuganzeige/.test(q))return {view:'ad',mode:'ad',title:'Ad Creator',label:'Werbeanzeige'};
 if(/kalender|termin|besprechung|meeting/.test(q))return {view:'calendar',mode:'calendar',title:'Terminplanung',label:'Termin-Entwurf'};
 if(/antwort|kundenanfrage|reply/.test(q))return {view:'reply',mode:'reply',title:'Kundenantwort',label:'Antwort-Entwurf'};
 if(/übersicht|dashboard|projekte zeigen|projekte öffnen/.test(q))return {view:'overview',mode:'chat',title:'Business Übersicht',label:'Übersicht'};
 return {view:'chat',mode:'chat',title:'JARVIS Workspace',label:'Antwort'};
}
// Decode complete SSE events, including UTF-8 split across network chunks.
async function* readSSE(body){
 const decoder=new TextDecoder();let buffer='';
 const decode=frame=>frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
 for await(const chunk of body){
  buffer+=decoder.decode(chunk,{stream:true});let match;
  while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=decode(frame);if(data&&data!=='[DONE]')yield JSON.parse(data)}
 }
 buffer+=decoder.decode();const data=decode(buffer);if(data&&data!=='[DONE]')yield JSON.parse(data);
}
module.exports={classifyTask,readSSE};
