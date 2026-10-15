'use strict';
// Los datos de canal y la clave de lectura NO se incluyen en este archivo.
// Se almacenan en .env y se usan solamente en server.js.
const fields=[
 {k:'field1',title:'Temperatura',unit:'°C',color:'#ffb86c',digits:1},
 {k:'field2',title:'Voltaje de red',unit:'V',color:'#77b7ff',digits:2},
 {k:'field3',title:'Corriente experimental',unit:'A',color:'#a58aff',digits:3},
 {k:null,electricalKey:'activePowerW',title:'Potencia activa',unit:'W',color:'#52dbb7',digits:1,pending:'PENDIENTE'},
 {k:null,electricalKey:'energyKWh',title:'Energía consumida',unit:'kWh',color:'#eab76a',digits:5,pending:'PENDIENTE'},
 {k:null,electricalKey:'estimatedCostGTQ',title:'Costo estimado',unit:'Q',color:'#ff849e',digits:4,pending:'PENDIENTE'},
 {k:'field7',title:'Señal ADC sin calibrar',unit:'mV',color:'#81c1ea',digits:1}
];
const $=id=>document.getElementById(id);
const state={feeds:[],electrical:null,busy:false};
$('cards').innerHTML=fields.map((f,i)=>`<article class="card"><div class="name">${f.title}</div><div class="val"><span id="v${i}">—</span><span class="unit">${f.unit}</span></div></article>`).join('')+'<article class="card"><div class="name">Estado de los datos</div><div class="val" id="quality" style="font-size:21px">Esperando</div></article>';
$('charts').innerHTML=fields.map((f,i)=>`<section class="panel chartbox" style="--chart-color:${f.color}"><div class="chart-heading"><h3>${f.title}</h3><span class="chart-unit">${f.unit}</span></div><div class="chart-canvas-wrap"><canvas id="c${i}" role="img" aria-label="Historial de ${f.title}"></canvas><div class="chart-tooltip" role="tooltip" aria-hidden="true"><span class="chart-tooltip-time"></span><strong class="chart-tooltip-value"></strong></div></div></section>`).join('');
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
  if(!Array.isArray(json.feeds) || !json.feeds.length)throw new Error('Sin datos');
  state.feeds=json.feeds;
  state.electrical=json.electrical||null;
  render();
  const last=state.feeds.at(-1),age=(Date.now()-Date.parse(last.created_at))/1000;
  setStatus(age>120?'DATOS ANTIGUOS · REVISAR ESP32':'THINGSPEAK CONECTADO',age>120?'bad':'good');
 }catch(e){
  const noData=e.message==='Sin datos';
  setStatus(noData?'SIN DATOS':'SIN CONEXIÓN','bad');
  $('quality').textContent=noData?'Sin datos':'Sin conexión';
  $('updated').textContent=noData?'Esperando una medición válida':'Último intento fallido';
  console.error(e);
 }finally{state.busy=false;}
}
function render(){
 const data=state.feeds;if(!data.length)return;
 const last=data.at(-1);
 fields.forEach((f,i)=>{
  const valueElement=$('v'+i);
  if(!f.k){
   const electrical=state.electrical;
   const valid=electrical?.valid?.[f.electricalKey]===true;
   const futureValue=valid?number(electrical[f.electricalKey]):null;
   valueElement.textContent=futureValue===null?(f.pending||'Pendiente'):futureValue.toFixed(f.digits);
   valueElement.nextElementSibling.textContent=futureValue===null?'':f.unit;
   drawChart($('c'+i),f,data);return;
  }
  const val=number(last[f.k]);
  valueElement.textContent=val===null||(f.k==='field1'&&val===-127)?'Sin datos':val.toFixed(f.digits);
  valueElement.nextElementSibling.textContent=f.unit;
  drawChart($('c'+i),f,data);
 });
 const temp=number(last.field1);
 $('quality').textContent=temp===-127?'Sensor temp. ERROR':'Datos reales · ThingSpeak';
 $('updated').textContent='Último registro: '+new Date(last.created_at).toLocaleString('es-GT',{dateStyle:'short',timeStyle:'medium'});
}
const chartViews=new WeakMap();
const interactiveCharts=new WeakSet();
const chartColor=(hex,alpha)=>{const value=hex.replace('#','');const full=value.length===3?value.split('').map(c=>c+c).join(''):value;return `rgba(${parseInt(full.slice(0,2),16)},${parseInt(full.slice(2,4),16)},${parseInt(full.slice(4,6),16)},${alpha})`;};
const chartTime=value=>new Date(value).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit'});

function paintChart(canvas,model,progress=1){
 const {f,feeds}=model,rect=canvas.getBoundingClientRect(),w=Math.max(rect.width,250),h=Math.max(rect.height,230),dpr=Math.min(devicePixelRatio||1,2);
 const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);
 if(canvas.width!==pixelW||canvas.height!==pixelH){canvas.width=pixelW;canvas.height=pixelH;}
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const values=feeds.map((e,i)=>({index:i,y:(f.k==='field1'&&number(e[f.k])===-127?null:number(e[f.k])),at:e.created_at}));
 const valid=values.filter(point=>point.y!==null),L=w<390?45:55,R=15,T=18,B=37,iw=w-L-R,ih=h-T-B;
 ctx.font='500 10px ui-monospace,SFMono-Regular,Consolas,monospace';ctx.lineWidth=1;
 if(!valid.length){ctx.fillStyle='#718095';ctx.textAlign='center';ctx.fillText('SIN DATOS DISPONIBLES',w/2,h/2);model.geometry={points:[]};return;}
 let min=Math.min(...valid.map(point=>point.y)),max=Math.max(...valid.map(point=>point.y));
 const pad=(max-min)*.14||Math.max(Math.abs(max)*.06,.02);min-=pad;max+=pad;
 const range=max-min,maxAbs=Math.max(Math.abs(min),Math.abs(max));
 const axisDigits=maxAbs>=100?0:maxAbs>=10?1:range<.1?Math.min(f.digits,4):2;
 const xp=index=>L+(feeds.length<=1?iw/2:index/(feeds.length-1)*iw),yp=value=>T+(max-value)/range*ih;

 ctx.textBaseline='middle';ctx.textAlign='right';
 for(let j=0;j<=4;j++){
  const y=T+j*ih/4,label=max-range*j/4;
  ctx.setLineDash(j===4?[]:[2,6]);ctx.strokeStyle=j===4?'rgba(125,145,170,.25)':'rgba(125,145,170,.11)';
  ctx.beginPath();ctx.moveTo(L,y+.5);ctx.lineTo(w-R,y+.5);ctx.stroke();
  ctx.fillStyle='#68798f';ctx.fillText(label.toFixed(axisDigits),L-9,y);
 }
 ctx.setLineDash([]);
 const labelIndexes=feeds.length<3?[0,feeds.length-1]:[0,Math.floor((feeds.length-1)/2),feeds.length-1];
 ctx.setLineDash([2,7]);ctx.strokeStyle='rgba(125,145,170,.075)';
 labelIndexes.forEach(index=>{ctx.beginPath();ctx.moveTo(xp(index)+.5,T);ctx.lineTo(xp(index)+.5,T+ih);ctx.stroke();});
 ctx.setLineDash([]);ctx.fillStyle='#68798f';ctx.textBaseline='alphabetic';
 labelIndexes.forEach((index,pos)=>{ctx.textAlign=pos===0?'left':pos===labelIndexes.length-1?'right':'center';ctx.fillText(chartTime(feeds[index].created_at),xp(index),h-8);});

 const screenPoints=valid.map(point=>({...point,x:xp(point.index),screenY:yp(point.y)}));
 const segments=[];let segment=[];
 values.forEach(point=>{if(point.y===null){if(segment.length)segments.push(segment);segment=[];return;}segment.push({...point,x:xp(point.index),screenY:yp(point.y)});});
 if(segment.length)segments.push(segment);
 ctx.save();ctx.beginPath();ctx.rect(L,T,Math.max(0,iw*progress),ih+2);ctx.clip();
 segments.forEach(points=>{
  if(points.length>1){
   const fill=ctx.createLinearGradient(0,T,0,T+ih);fill.addColorStop(0,chartColor(f.color,.27));fill.addColorStop(.55,chartColor(f.color,.07));fill.addColorStop(1,chartColor(f.color,0));
   ctx.beginPath();ctx.moveTo(points[0].x,T+ih);ctx.lineTo(points[0].x,points[0].screenY);points.slice(1).forEach(point=>ctx.lineTo(point.x,point.screenY));ctx.lineTo(points.at(-1).x,T+ih);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  }
  ctx.beginPath();points.forEach((point,index)=>index?ctx.lineTo(point.x,point.screenY):ctx.moveTo(point.x,point.screenY));
  const stroke=ctx.createLinearGradient(L,0,w-R,0);stroke.addColorStop(0,chartColor(f.color,.72));stroke.addColorStop(.18,f.color);stroke.addColorStop(.82,f.color);stroke.addColorStop(1,chartColor(f.color,.76));
  ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=chartColor(f.color,.42);ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;
 });
 ctx.restore();

 const latest=screenPoints.at(-1);
 if(progress>=.995){ctx.fillStyle=chartColor(f.color,.12);ctx.beginPath();ctx.arc(latest.x,latest.screenY,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#09121f';ctx.strokeStyle=f.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(latest.x,latest.screenY,3.8,0,Math.PI*2);ctx.fill();ctx.stroke();}
 if(model.hoverIndex!==null){
  const selected=screenPoints.find(point=>point.index===model.hoverIndex);
  if(selected){ctx.strokeStyle=chartColor(f.color,.42);ctx.lineWidth=1;ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(selected.x,T);ctx.lineTo(selected.x,T+ih);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=f.color;ctx.strokeStyle='#07101c';ctx.lineWidth=3;ctx.beginPath();ctx.arc(selected.x,selected.screenY,5,0,Math.PI*2);ctx.fill();ctx.stroke();}
 }
 model.geometry={points:screenPoints};
}

function bindChartTooltip(canvas){
 if(interactiveCharts.has(canvas))return;interactiveCharts.add(canvas);
 const show=event=>{
  const model=chartViews.get(canvas);if(!model?.geometry?.points.length)return;
  if(model.frame)cancelAnimationFrame(model.frame);model.frame=0;
  const rect=canvas.getBoundingClientRect(),pointerX=event.clientX-rect.left;
  const point=model.geometry.points.reduce((nearest,current)=>Math.abs(current.x-pointerX)<Math.abs(nearest.x-pointerX)?current:nearest);
  model.hoverIndex=point.index;paintChart(canvas,model,1);
  const tooltip=canvas.parentElement.querySelector('.chart-tooltip');
  tooltip.querySelector('.chart-tooltip-time').textContent=new Date(point.at).toLocaleString('es-GT',{dateStyle:'short',timeStyle:'medium'});
  tooltip.querySelector('.chart-tooltip-value').textContent=`${point.y.toFixed(model.f.digits)} ${model.f.unit}`;
  tooltip.classList.add('visible');tooltip.setAttribute('aria-hidden','false');
  const left=canvas.offsetLeft+point.x,top=canvas.offsetTop+point.screenY;
  const half=tooltip.offsetWidth/2,limit=canvas.parentElement.clientWidth-10;
  tooltip.style.left=`${Math.min(Math.max(left,half+10),limit-half)}px`;tooltip.style.top=`${Math.max(8,top-tooltip.offsetHeight-14)}px`;
 };
 canvas.addEventListener('pointermove',show);canvas.addEventListener('pointerdown',show);
 canvas.addEventListener('pointerleave',()=>{const model=chartViews.get(canvas);if(!model)return;model.hoverIndex=null;paintChart(canvas,model,1);const tooltip=canvas.parentElement.querySelector('.chart-tooltip');tooltip.classList.remove('visible');tooltip.setAttribute('aria-hidden','true');});
}

function drawChart(canvas,f,feeds){
 const previous=chartViews.get(canvas);if(previous?.frame)cancelAnimationFrame(previous.frame);if(previous?.timer)clearTimeout(previous.timer);
 const model={f,feeds,hoverIndex:null,geometry:null,frame:0,timer:0};chartViews.set(canvas,model);bindChartTooltip(canvas);
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 if(reduced){paintChart(canvas,model,1);return;}
 const started=performance.now(),duration=780;
 const animate=now=>{const linear=Math.min((now-started)/duration,1),eased=1-Math.pow(1-linear,4);paintChart(canvas,model,eased);if(linear<1)model.frame=requestAnimationFrame(animate);else{model.frame=0;if(model.timer)clearTimeout(model.timer);model.timer=0;}};
 model.frame=requestAnimationFrame(animate);
 model.timer=setTimeout(()=>{if(chartViews.get(canvas)!==model)return;if(model.frame)cancelAnimationFrame(model.frame);model.frame=0;model.timer=0;paintChart(canvas,model,1);},duration+80);
}

$('refresh').addEventListener('click',readThingspeak);
window.addEventListener('resize',()=>{if(state.feeds.length)render();});
readThingspeak();
setInterval(readThingspeak,20000);
