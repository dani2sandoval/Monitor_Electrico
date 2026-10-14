'use strict';
// Los datos de canal y la clave de lectura NO se incluyen en este archivo.
// Se almacenan en .env y se usan solamente en server.js.
const fields=[
 {k:'field1',title:'Temperatura',unit:'°C',color:'#ffb86c',digits:1},
 {k:'field2',title:'Voltaje',unit:'V',color:'#77b7ff',digits:1},
 {k:'field3',title:'Corriente',unit:'A',color:'#a58aff',digits:2},
 {k:'field4',title:'Potencia',unit:'W',color:'#52dbb7',digits:1},
 {k:'field5',title:'Energía',unit:'kWh',color:'#eab76a',digits:5},
 {k:'field6',title:'Costo acumulado',unit:'Q',color:'#ff849e',digits:4},
 {k:'field7',title:'Señal ADC',unit:'V',color:'#81c1ea',digits:3}
];
const $=id=>document.getElementById(id);
const state={feeds:[],busy:false};
$('cards').innerHTML=fields.map((f,i)=>`<article class="card"><div class="name">${f.title}</div><div class="val"><span id="v${i}">—</span><span class="unit">${f.unit}</span></div></article>`).join('')+'<article class="card"><div class="name">Estado de los datos</div><div class="val" id="quality" style="font-size:21px">Esperando</div></article>';
$('charts').innerHTML=fields.map((f,i)=>`<section class="panel chartbox"><h3>${f.title} (${f.unit})</h3><canvas id="c${i}" role="img" aria-label="Historial de ${f.title}"></canvas></section>`).join('');
const number=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);

function setStatus(message,kind){
 const el=$('status');el.textContent=message;el.className='pill '+(kind==='good'?'good':kind==='bad'?'bad':'');
 $('connection').textContent=kind==='good'?'CONECTADO':kind==='bad'?'SIN DATOS':'CONECTANDO';
 $('connection').className=el.className;
}
async function readThingspeak(){
 if(state.busy)return;
 state.busy=true;
 setStatus('CONSULTANDO THINGSPEAK','normal');
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  let response;
  try{response=await fetch('/api/feeds',{signal:controller.signal,cache:'no-store'});}
  finally{clearTimeout(timer);}
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json.error || `HTTP ${response.status}`);
  if(!Array.isArray(json.feeds) || !json.feeds.length)throw new Error('Canal sin datos');
  state.feeds=json.feeds;
  render();
  const last=state.feeds.at(-1),age=(Date.now()-Date.parse(last.created_at))/1000;
  setStatus(age>120?'DATOS ANTIGUOS · REVISAR ESP32':'THINGSPEAK CONECTADO',age>120?'bad':'good');
 }catch(e){
  setStatus('NO SE PUDO ACTUALIZAR','bad');
  $('quality').textContent='Sin actualizar';
  $('updated').textContent='Detalle: '+e.message;
  console.error(e);
 }finally{state.busy=false;}
}
function render(){const data=state.feeds;if(!data.length)return;const last=data.at(-1);fields.forEach((f,i)=>{const val=number(last[f.k]);$('v'+i).textContent=val===null||(i===0&&val===-127)?'—':val.toFixed(f.digits);drawChart($('c'+i),f,data);});let temp=number(last.field1);$('quality').textContent=temp===-127?'Sensor temp. ERROR':'Recibido';$('updated').textContent='Último registro: '+new Date(last.created_at).toLocaleString('es-GT',{dateStyle:'short',timeStyle:'medium'});}
function drawChart(canvas,f,feeds){const rect=canvas.getBoundingClientRect(),w=Math.max(rect.width,250),h=230,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const pts=feeds.map((e,i)=>({x:i,y:(f.k==='field1'&&number(e[f.k])===-127?null:number(e[f.k])),at:e.created_at})).filter(v=>v.y!==null);const L=48,R=12,T=20,B=31,iw=w-L-R,ih=h-T-B;ctx.font='11px system-ui';ctx.lineWidth=1;if(!pts.length){ctx.fillStyle='#a9beda';ctx.fillText('Sin datos',L+10,60);return;}let min=Math.min(...pts.map(a=>a.y)),max=Math.max(...pts.map(a=>a.y));let pad=(max-min)*.12||Math.max(Math.abs(max)*.06,.02);min-=pad;max+=pad;ctx.strokeStyle='#283c55';ctx.fillStyle='#b3c6df';for(let j=0;j<=4;j++){let y=T+j*ih/4;ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText((max-(max-min)*j/4).toFixed(max<10?2:1),4,y+4);}const xp=i=>L+(feeds.length<=1?iw/2:i/(feeds.length-1)*iw),yp=v=>T+(max-v)/(max-min)*ih;ctx.strokeStyle=f.color;ctx.lineWidth=2;ctx.beginPath();let moved=false;feeds.forEach((e,i)=>{const val=(f.k==='field1'&&number(e[f.k])===-127?null:number(e[f.k]));if(val===null){moved=false;return;}const x=xp(i),y=yp(val);if(!moved){ctx.moveTo(x,y);moved=true;}else ctx.lineTo(x,y);});ctx.stroke();let latest=pts.at(-1);ctx.fillStyle=f.color;ctx.beginPath();ctx.arc(xp(latest.x),yp(latest.y),3,0,2*Math.PI);ctx.fill();ctx.fillStyle='#b3c6df';ctx.fillText(new Date(feeds[0].created_at).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit'}),L,h-8);let text=new Date(feeds.at(-1).created_at).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit'});ctx.fillText(text,w-R-45,h-8);}

$('refresh').addEventListener('click',readThingspeak);
window.addEventListener('resize',()=>{if(state.feeds.length)render();});
readThingspeak();
setInterval(readThingspeak,20000);
