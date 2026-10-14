"use strict";
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');

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
const PORT=Number(process.env.PORT||3000);
const publicRoot=path.resolve(__dirname,'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.ico':'image/x-icon'};
function respond(res,status,data,contentType='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(typeof data==='string'?data:JSON.stringify(data));
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
  return respond(res,200,{feeds:data.feeds.map(f=>({created_at:f.created_at,field1:f.field1,field2:f.field2,field3:f.field3,field4:f.field4,field5:f.field5,field6:f.field6,field7:f.field7}))});
 }catch(error){
  console.error('Error consultando ThingSpeak:',error.message);
  return respond(res,502,{error:'No se pudo consultar ThingSpeak. Verifica la conexión a internet y la configuración.'});
 }
}
const server=http.createServer((req,res)=>{
 if(req.method!=='GET')return respond(res,405,{error:'Método no permitido'});
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/feeds'){getFeeds(res);return;}
 const targets={'/':'index.html','/index.html':'index.html','/css/styles.css':'css/styles.css','/js/app.js':'js/app.js'};
 const target=targets[pathname];
 if(!target)return respond(res,404,{error:'Ruta no encontrada'});
 const file=path.join(publicRoot,target);
 fs.readFile(file,(err,data)=>{
  if(err)return respond(res,404,{error:'Archivo no encontrado'});
  const mime=types[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(data);
 });
});
server.listen(PORT,'127.0.0.1',()=>{
 console.log(`Monitor disponible en http://localhost:${PORT}`);
 console.log(READ_API_KEY && !READ_API_KEY.startsWith('PEGA_AQUI')?'Read API Key configurada':'Falta configurar READ_API_KEY en .env');
});
