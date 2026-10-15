"use strict";
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');
const {createClient}=require('@supabase/supabase-js');

// Cargar la configuración local, sin dependencias.
const envPath=path.join(__dirname,'.env');
if(fs.existsSync(envPath)){
  for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){
    const clean=line.trim();
    if(!clean||clean.startsWith('#'))continue;
    const idx=clean.indexOf('=');
    if(idx<1)continue;
    const key=clean.slice(0,idx).trim();
    let value=clean.slice(idx+1).trim();
    if(/^(["']).*\1$/.test(value))value=value.slice(1,-1);
    if(!(key in process.env))process.env[key]=value;
  }
}
const CHANNEL_ID=(process.env.CHANNEL_ID||'').trim();
const READ_API_KEY=(process.env.READ_API_KEY||'').trim();
const SUPABASE_URL=(process.env.SUPABASE_URL||'').trim();
const SUPABASE_SERVICE_KEY=(process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_SECRET_KEY||'').trim();
const PORT=Number(process.env.PORT||3000);
let supabase=null;
if(SUPABASE_URL&&SUPABASE_SERVICE_KEY){
 try{
  supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY,{
   auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false},
   db:{schema:'public'}
  });
 }catch(error){
  console.error('No se pudo inicializar Supabase:',error.message||error);
 }
}
let persistenceQueue=Promise.resolve();
const runtimeRoot=process.env.VERCEL?require('node:os').tmpdir():__dirname;
const syncStatePath=path.join(runtimeRoot,'.thingspeak-sync-state.json');
let lastProcessedEntryId=loadSyncCursor();
let syncCursorReady=null;
const publicRoot=path.resolve(__dirname,'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.ico':'image/x-icon'};
const rateBuckets=new Map();
const RATE_WINDOW_MS=60_000;
const RATE_LIMITS={feeds:30,history:60};
function requestAddress(req){
 const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
 return forwarded||req.socket?.remoteAddress||'unknown';
}
function allowRequest(req,bucket){
 const now=Date.now();
 const key=`${bucket}:${requestAddress(req)}`;
 const current=rateBuckets.get(key);
 if(!current||now-current.startedAt>=RATE_WINDOW_MS){rateBuckets.set(key,{startedAt:now,count:1});return true;}
 current.count+=1;
 return current.count<=RATE_LIMITS[bucket];
}
setInterval(()=>{
 const threshold=Date.now()-RATE_WINDOW_MS;
 for(const [key,value] of rateBuckets)if(value.startedAt<threshold)rateBuckets.delete(key);
},RATE_WINDOW_MS).unref?.();
function respond(res,status,data,contentType='application/json; charset=utf-8'){
 res.writeHead(status,{
  'Content-Type':contentType,
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  'Strict-Transport-Security':'max-age=31536000; includeSubDomains'
 });
 res.end(typeof data==='string'?data:JSON.stringify(data));
}
const finiteNumber=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
function loadSyncCursor(){
 try{
  if(!fs.existsSync(syncStatePath))return null;
  const state=JSON.parse(fs.readFileSync(syncStatePath,'utf8'));
  const entryId=Number(state.last_entry_id);
  return String(state.channel_id)===CHANNEL_ID&&Number.isInteger(entryId)&&entryId>=0?entryId:null;
 }catch(error){
  console.error('No se pudo leer el cursor de ThingSpeak:',error.message||error);
  return null;
 }
}
function saveSyncCursor(entryId){
 lastProcessedEntryId=entryId;
 try{
  fs.writeFileSync(syncStatePath,JSON.stringify({channel_id:CHANNEL_ID,last_entry_id:entryId,updated_at:new Date().toISOString()},null,2));
 }catch(error){
  console.error('No se pudo persistir el cursor local de ThingSpeak:',error.message||error);
 }
}
async function recoverSyncCursorFromSupabase(){
 if(!supabase)return null;
 const {data,error}=await supabase
  .from('mediciones_electricas')
  .select('created_at')
  .order('created_at',{ascending:false})
  .limit(1)
  .maybeSingle();
 if(error)throw error;
 if(!data?.created_at)return null;
 const api=new URL(`https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json`);
 api.searchParams.set('api_key',READ_API_KEY);
 api.searchParams.set('results','8000');
 const response=await fetch(api,{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`ThingSpeak devolvió HTTP ${response.status} al recuperar el cursor`);
 const payload=await response.json();
 const storedTime=Date.parse(data.created_at);
 const matching=(payload.feeds||[]).find(feed=>Date.parse(feed.created_at)===storedTime);
 const entryId=Number(matching?.entry_id);
 return Number.isInteger(entryId)&&entryId>=0?entryId:null;
}
async function initializeSyncCursor(){
 if(lastProcessedEntryId!==null)return;
 if(!/^\d+$/.test(CHANNEL_ID)||!READ_API_KEY||READ_API_KEY.startsWith('PEGA_AQUI'))throw new Error('ThingSpeak no está configurado');
 const recoveredEntryId=await recoverSyncCursorFromSupabase();
 if(recoveredEntryId!==null){
  saveSyncCursor(recoveredEntryId);
  console.log(`Sincronización reanudada desde entry_id ${recoveredEntryId}`);
  return;
 }
 const api=new URL(`https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds/last.json`);
 api.searchParams.set('api_key',READ_API_KEY);
 const response=await fetch(api,{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`ThingSpeak devolvió HTTP ${response.status} al inicializar el cursor`);
 const feed=await response.json();
 const entryId=Number(feed.entry_id);
 if(!Number.isInteger(entryId)||entryId<0)throw new Error('ThingSpeak no devolvió un entry_id válido');
 saveSyncCursor(entryId);
 console.log(`Sincronización iniciada desde entry_id ${entryId}; no se importará historial previo`);
}
async function ensureSyncCursor(){
 if(lastProcessedEntryId!==null)return true;
 if(!syncCursorReady){
  syncCursorReady=initializeSyncCursor().finally(()=>{syncCursorReady=null;});
 }
 try{
  await syncCursorReady;
  return lastProcessedEntryId!==null;
 }catch(error){
  console.error('No se pudo inicializar el cursor de sincronización:',error.message||error);
  return false;
 }
}
function mapThingSpeakFeed(feed){
 const timestamp=Date.parse(feed.created_at);
 const entryId=Number(feed.entry_id);
 if(!Number.isFinite(timestamp)||!Number.isInteger(entryId)||entryId<0)return null;
 const measurement={
  created_at:new Date(timestamp).toISOString(),
  temperatura:finiteNumber(feed.field1),
  voltaje:null,
  corriente:finiteNumber(feed.field2),
  potencia:null,
  energia:null,
  costo:null,
  senal_adc:finiteNumber(feed.field3)
 };
 const hasReading=['temperatura','voltaje','corriente','potencia','energia','costo','senal_adc'].some(key=>measurement[key]!==null);
 return hasReading?{entryId,measurement}:null;
}
async function persistMeasurements(feeds){
 if(!supabase)return;
 if(!await ensureSyncCursor())return;
 const byTimestamp=new Map();
 for(const feed of feeds){
  const item=mapThingSpeakFeed(feed);
  if(item&&item.entryId>lastProcessedEntryId)byTimestamp.set(item.measurement.created_at,item);
 }
 const items=[...byTimestamp.values()].sort((a,b)=>a.entryId-b.entryId);
 if(!items.length)return;
 const measurements=items.map(item=>item.measurement);
 const timestamps=measurements.map(item=>Date.parse(item.created_at));
 const from=new Date(Math.min(...timestamps)).toISOString();
 const to=new Date(Math.max(...timestamps)).toISOString();
 const {data:stored,error:readError}=await supabase
  .from('mediciones_electricas')
  .select('created_at')
  .gte('created_at',from)
  .lte('created_at',to);
 if(readError)throw readError;
 const existing=new Set((stored||[]).map(row=>Date.parse(row.created_at)).filter(Number.isFinite));
 const pending=measurements.filter(item=>!existing.has(Date.parse(item.created_at)));
 if(pending.length){
  const {error:insertError}=await supabase.from('mediciones_electricas').insert(pending);
  if(insertError)throw insertError;
 }
 saveSyncCursor(items.at(-1).entryId);
}
function queueMeasurements(feeds){
 persistenceQueue=persistenceQueue
  .then(()=>persistMeasurements(feeds))
  .catch(error=>console.error('Error guardando mediciones en Supabase:',error.message||error));
 return persistenceQueue;
}
async function getFeeds(res){
 if(!/^\d+$/.test(CHANNEL_ID)||!READ_API_KEY||READ_API_KEY.startsWith('PEGA_AQUI')){
   return respond(res,503,{error:'Configura CHANNEL_ID y READ_API_KEY en el archivo .env y reinicia npm start.'});
 }
 const api=new URL(`https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json`);
 api.searchParams.set('api_key',READ_API_KEY);
 api.searchParams.set('results','80');
 try{
  const response=await fetch(api,{signal:AbortSignal.timeout(12000)});
  if(!response.ok) return respond(res,502,{error:`ThingSpeak devolvió HTTP ${response.status}. Revisa la Read API Key.`});
  const data=await response.json();
  if(!Array.isArray(data.feeds))throw new Error('Respuesta inválida');
  const feeds=data.feeds.map(f=>({created_at:f.created_at,field1:f.field1,field2:f.field2,field3:f.field3,field4:f.field4,field5:f.field5,field6:f.field6,field7:f.field7}));
  await queueMeasurements(data.feeds);
  return respond(res,200,{feeds});
 }catch(error){
  console.error('Error consultando ThingSpeak:',error.message);
  return respond(res,502,{error:'No se pudo consultar ThingSpeak. Verifica la conexión a internet y la configuración.'});
 }
}
async function getHistory(res){
 if(!supabase)return respond(res,503,{error:'Supabase no está configurado en el servidor.'});
 try{
  const {data,error}=await supabase
   .from('mediciones_electricas')
   .select('id,created_at,temperatura,voltaje,corriente,potencia,energia,costo,senal_adc')
   .order('created_at',{ascending:false});
  if(error)throw error;
  return respond(res,200,{mediciones:data||[]});
 }catch(error){
  console.error('Error consultando el historial en Supabase:',error.message||error);
  return respond(res,502,{error:'No se pudo consultar el historial de mediciones.'});
 }
}
function handleRequest(req,res){
 if(req.method!=='GET')return respond(res,405,{error:'Método no permitido'});
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/feeds'){
  if(!allowRequest(req,'feeds'))return respond(res,429,{error:'Demasiadas solicitudes. Intenta nuevamente en un minuto.'});
  getFeeds(res);return;
 }
 if(pathname==='/api/historial'){
  if(!allowRequest(req,'history'))return respond(res,429,{error:'Demasiadas solicitudes. Intenta nuevamente en un minuto.'});
  getHistory(res);return;
 }
 const targets={'/':'index.html','/index.html':'index.html','/historial.html':'historial.html','/css/styles.css':'css/styles.css','/css/historial.css':'css/historial.css','/js/app.js':'js/app.js','/js/historial.js':'js/historial.js','/js/export.js':'js/export.js','/vendor/jspdf.min.js':'vendor/jspdf.min.js','/vendor/jspdf-autotable.min.js':'vendor/jspdf-autotable.min.js','/vendor/write-excel-file.min.js':'vendor/write-excel-file.min.js'};
 const target=targets[pathname];
 if(!target)return respond(res,404,{error:'Ruta no encontrada'});
 const file=path.join(publicRoot,target);
 fs.readFile(file,(err,data)=>{
  if(err)return respond(res,404,{error:'Archivo no encontrado'});
  const mime=types[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{
   'Content-Type':mime,
   'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff',
   'X-Frame-Options':'DENY',
   'Referrer-Policy':'no-referrer',
   'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
   'Content-Security-Policy':"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
   'Strict-Transport-Security':'max-age=31536000; includeSubDomains'
  });
  res.end(data);
 });
}
if(require.main===module){
 const server=http.createServer(handleRequest);
 server.listen(PORT,'127.0.0.1',()=>{
  console.log(`Monitor disponible en http://localhost:${PORT}`);
  console.log(READ_API_KEY && !READ_API_KEY.startsWith('PEGA_AQUI')?'Read API Key configurada':'Falta configurar READ_API_KEY en .env');
  console.log(supabase?'Supabase configurado en el backend':'Supabase no configurado; el historial estará deshabilitado');
  ensureSyncCursor();
 });
}
module.exports=handleRequest;
