import {GarmentController} from './controller.js';
import {rackPositions,slideStep} from './rack-layout.js';
import {mobileRailPositions,mobileSwipeDestination} from './mobile-rail.js';
import {validateCatalog,validateManifest} from './catalog.js';

const $=selector=>document.querySelector(selector);
const rack=$('#rack'),holder=$('#rack-items');
const mobile=matchMedia('(max-width:700px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
let catalog,states=[],active=-1,selected=0,pending=-1,intentTimer,ready=false,raf=0,lastTime=0,drag=null,railOffset=0,railVelocity=0,suppressClickUntil=0;
const manifestUrl=item=>new URL('../public/'+item.motion,import.meta.url);
const assetUrl=(item,file)=>new URL(file,manifestUrl(item));
const variantOf=(item,state)=>state?.variant||null;
const effectiveColor=(item,state)=>variantOf(item,state)?.color||item.color;
const effectiveBack=(item,state)=>variantOf(item,state)?.back||item.back;
const variantAsset=(item,state,file)=>new URL(file,new URL('../public/'+(variantOf(item,state)?.motion||item.motion),import.meta.url));
let detailBack=false;
function updateInfo(index){
  selected=index;const item=catalog.items[index];
  $('#selected-index').textContent=String(index+1).padStart(2,'0')+' / '+String(states.length).padStart(2,'0');
  $('#selected-name').textContent=item.name;$('#selected-type').textContent=[item.type,effectiveColor(item,states[index])].filter(Boolean).join(' · ');
  $('#previous').disabled=!ready||index===0;$('#next').disabled=!ready||index===states.length-1;
}
function paint(s,frame){
  if(!s.image)return;
  const {width:w,height:h,columns}=s.manifest;
  s.ctx.clearRect(0,0,w,h);s.ctx.drawImage(s.image,(frame%columns)*w,Math.floor(frame/columns)*h,w,h,0,0,w,h);
  s.button.dataset.frame=String(frame);
}
function activate(index){
  if(!ready)return;
  active=index;
  states.forEach((s,i)=>{s.button.classList.toggle('active',i===index);s.controller.setTarget(i===index?1:0,{immediate:reduced.matches});});
  if(index>=0)updateInfo(index);
  wake();
}
function cancelIntent(){clearTimeout(intentTimer);intentTimer=undefined;pending=-1;}
function intend(index){
  if(!ready||pending===index||active===index)return;
  cancelIntent();pending=index;
  if(index<0){activate(-1);return;}
  intentTimer=setTimeout(()=>{pending=-1;activate(index);},catalog.timing.intentMs);
}
function targets(){
  const width=rack.clientWidth,garmentWidth=states[0]?.displayWidth||370;
  if(mobile.matches)return mobileRailPositions({width,items:states.map(s=>({half:s.displayWidth*(.08+.35*s.controller.position)})),focus:selected,offset:railOffset,gap:12});
  return rackPositions({count:states.length,width,garmentWidth,active,minimumSpread:35});
}
function tick(time){
  const dt=lastTime?Math.min(50,time-lastTime):0;lastTime=time;
  let moving=false;
  if(mobile.matches&&!drag){
    const next=slideStep(railOffset,railVelocity,0,dt,23);railOffset=next.position;railVelocity=next.velocity;
    moving ||=Math.abs(railOffset)>.03||Math.abs(railVelocity)>.2;
    if(!moving&&active!==selected)intend(selected);
  }
  for(const s of states)moving=s.controller.step(dt)||moving;
  const positions=targets();
  states.forEach((s,i)=>{
    const next=reduced.matches?{position:positions[i],velocity:0}:slideStep(s.position,s.velocity,positions[i],dt,active<0?22:20);
    s.position=next.position;s.velocity=next.velocity;s.button.style.left=s.position+'px';
    moving ||=Math.abs(s.position-positions[i])>.03||Math.abs(s.velocity)>.2;
  });
  if(moving)raf=requestAnimationFrame(tick);else{raf=0;lastTime=0;}
}
function wake(){if(!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
function stop(){cancelAnimationFrame(raf);raf=0;lastTime=0;}
function layout(){
  if(!states.length)return;
  const displayWidth=mobile.matches?315:innerWidth>=1400?400:370;
  states.forEach(s=>{s.displayWidth=displayWidth;s.button.style.setProperty('--garment-width',displayWidth+'px');});
  $('#interaction-hint').textContent=mobile.matches?'Swipe to browse · Tap to inspect':'Hover to turn a garment · Click to inspect';
  cancelIntent();drag=null;railOffset=0;railVelocity=0;
  const positions=targets();states.forEach((s,i)=>{s.position=positions[i];s.velocity=0;s.button.style.left=s.position+'px';});
  activate(mobile.matches?selected:-1);wake();
}
function hitAt(x){
  let nearest=-1,best=Infinity;
  states.forEach((s,i)=>{const d=Math.abs(x-s.position),half=i===active?s.displayWidth*.43:30;if(d<=half&&d<best){nearest=i;best=d;}});
  return nearest;
}
rack.addEventListener('pointermove',event=>{
  if(!ready||$('#product-dialog').open||$('#about-dialog').open)return;
  if(drag&&event.pointerId===drag.id){
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    if(!drag.horizontal&&Math.abs(dx)>7&&Math.abs(dx)>Math.abs(dy)*1.2){drag.horizontal=true;rack.setPointerCapture(event.pointerId);cancelIntent();activate(-1);}
    if(!drag.horizontal)return;
    const now=performance.now();drag.velocity=(event.clientX-drag.lastX)/Math.max(1,now-drag.lastTime);drag.lastX=event.clientX;drag.lastTime=now;
    railOffset=dx;railVelocity=0;wake();return;
  }
  if(!mobile.matches&&event.pointerType!=='touch')intend(hitAt(event.clientX-rack.getBoundingClientRect().left));
});
rack.addEventListener('pointerleave',()=>{if(!mobile.matches&&!drag){cancelIntent();activate(-1);}});
rack.addEventListener('pointerdown',event=>{
  if(!ready||!mobile.matches||event.button!==0)return;
  const now=performance.now();drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastTime:now,velocity:0,horizontal:false};
});
function endDrag(event){
  if(!drag||event.pointerId!==drag.id)return;
  const previous=drag;drag=null;
  if(previous.horizontal){
    const width=rack.clientWidth,positions=targets();
    const next=mobileSwipeDestination({positions,width,focus:selected,delta:railOffset,velocity:previous.velocity});
    const offset=positions[next]-width/2;selected=next;railOffset=offset;railVelocity=0;updateInfo(next);suppressClickUntil=performance.now()+450;
    if(rack.hasPointerCapture(event.pointerId))rack.releasePointerCapture(event.pointerId);
    if(reduced.matches)railOffset=0;
    wake();
  }
}
rack.addEventListener('pointerup',endDrag);rack.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId){drag=null;railOffset=0;railVelocity=0;wake();}});
rack.addEventListener('click',event=>{
  if(!ready||performance.now()<suppressClickUntil)return;
  const button=event.target.closest('.garment');if(!button)return;
  const index=Number(button.dataset.index);
  if(mobile.matches&&index!==selected){browse(index);return;}
  openProduct(index);
});
function browse(index){
  if(!ready)return;
  index=Math.max(0,Math.min(states.length-1,index));cancelIntent();
  if(mobile.matches){const p=targets();railOffset=p[index]-rack.clientWidth/2;railVelocity=0;selected=index;activate(-1);if(reduced.matches)railOffset=0;updateInfo(index);wake();}
  else activate(index);
}
$('#previous').addEventListener('click',()=>browse(selected-1));$('#next').addEventListener('click',()=>browse(selected+1));
$('#inspect').addEventListener('click',()=>openProduct(selected));
function detailSide(back){
  const item=catalog.items[selected],s=states[selected];
  const backPath=effectiveBack(item,s);
  detailBack=back&&!!backPath;
  $('#detail-image').src=detailBack?new URL('../public/'+backPath,import.meta.url).href:variantAsset(item,s,s.manifest.front).href;
  $('#detail-image').alt=item.name+' — '+(detailBack?'back':'front');
  $('#view-front').setAttribute('aria-pressed',String(!detailBack));$('#view-back').setAttribute('aria-pressed',String(detailBack));
}
async function setVariant(index,variantId){
  const item=catalog.items[index],s=states[index];
  const variant=variantId?item.variants.find(v=>v.id===variantId):null;
  if(variantId&&!variant)return;
  if((s.variant?.id||null)===(variant?.id||null))return;
  try{
    const path=variant?variant.motion:item.motion;
    const base=new URL('../public/'+path,import.meta.url);
    const res=await fetch(base);if(!res.ok)throw new Error('Variant manifest not found.');
    const manifest=validateManifest(await res.json());
    const image=new Image();image.src=new URL(manifest.atlas,base).href;await image.decode();
    if(image.naturalWidth!==manifest.width*manifest.columns||image.naturalHeight!==manifest.height*Math.ceil(manifest.frameCount/manifest.columns))throw new Error('Variant atlas dimensions do not match manifest.');
    s.manifest=manifest;s.image=image;s.variant=variant||null;
    s.button.querySelector('img').src=new URL(manifest.profile,base).href;
    paint(s,s.controller.frame);
    $('#product-color').textContent=variant?variant.color:item.color||'—';
    const back=variant?variant.back:item.back;
    $('#view-back').hidden=!back;$('#view-back').disabled=!back;
    detailSide(detailBack&&!!back);
    updateInfo(index);
    document.querySelectorAll('#variant-picker button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.variantId===(variant?.id||''))));
  }catch(error){console.error(error.message);}
}
function openProduct(index){
  if(!ready)return;
  cancelIntent();activate(index);const item=catalog.items[index];
  $('#product-title').textContent=item.name;$('#product-type').textContent=item.type||'';$('#product-description').textContent=item.description||'';$('#product-color').textContent=effectiveColor(item,states[index])||'—';
  $('#product-preview').textContent=item.previewLabel||(states[index].manifest.source?.kind==='original-procedural-illustration'?'Original illustration':'Prepared product frames');
  const backPath=effectiveBack(item,states[index]);
  $('#view-back').hidden=!backPath;$('#view-back').disabled=!backPath;
  const picker=$('#variant-picker');picker.innerHTML='';
  const variants=item.variants||[];picker.hidden=variants.length===0;
  if(variants.length){
    const base=document.createElement('button');base.textContent=item.color||'Base';base.dataset.variantId='';base.setAttribute('aria-pressed',String(!states[index].variant));base.addEventListener('click',()=>setVariant(index,null));picker.append(base);
    for(const v of variants){const b=document.createElement('button');b.textContent=v.color;b.dataset.variantId=v.id;b.setAttribute('aria-pressed',String(states[index].variant?.id===v.id));b.addEventListener('click',()=>setVariant(index,v.id));picker.append(b);}
  }
  const link=$('#product-link');link.hidden=!item.productUrl;if(item.productUrl)link.href=item.productUrl;
  detailSide(false);$('#product-dialog').showModal();
}
$('#view-front').addEventListener('click',()=>detailSide(false));$('#view-back').addEventListener('click',()=>detailSide(true));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('close',()=>{if(!mobile.matches)activate(-1);});
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();});
});
addEventListener('resize',layout);mobile.addEventListener('change',layout);reduced.addEventListener('change',()=>activate(active));
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelIntent();stop();}else wake();});
async function boot(){
  try{
    const response=await fetch(new URL('../config/catalog.json',import.meta.url));if(!response.ok)throw new Error('Catalog not found.');
    catalog=validateCatalog(await response.json());$('#site-title').firstChild.textContent=catalog.title||'Garment Showcase';
    for(const [i,item] of catalog.items.entries()){
      const res=await fetch(manifestUrl(item));if(!res.ok)throw new Error('Motion manifest not found: '+item.id);
      const manifest=validateManifest(await res.json());
      const button=document.createElement('button');button.className='garment';button.dataset.index=String(i);button.setAttribute('aria-label','Inspect '+item.name);button.disabled=true;
      const wire=document.createElement('span');wire.className='wire';wire.setAttribute('aria-hidden','true');
      const fallback=document.createElement('img');fallback.src=assetUrl(item,manifest.profile).href;fallback.alt='';fallback.width=manifest.width;fallback.height=manifest.height;
      const canvas=document.createElement('canvas');canvas.width=manifest.width;canvas.height=manifest.height;canvas.setAttribute('aria-hidden','true');
      button.append(wire,fallback,canvas);holder.append(button);
      const state={button,manifest,canvas,ctx:canvas.getContext('2d'),image:null,position:0,velocity:0,displayWidth:370};
      state.controller=new GarmentController({frameCount:manifest.frameCount,durationMs:catalog.timing.turnMs,returnDurationMs:catalog.timing.returnMs,endpointWindow:catalog.timing.endpointWindow,onFrame:frame=>paint(state,frame)});
      button.addEventListener('focus',()=>{if(button.matches(':focus-visible'))browse(i);});
      button.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=Math.max(0,Math.min(states.length-1,i+(event.key==='ArrowRight'?1:-1)));states[next].button.focus();browse(next);}});
      states.push(state);
    }
    layout();let loaded=0;$('#load-counter').textContent=`0 / ${states.length}`;
    await Promise.all(states.map(async(s,i)=>{
      const image=new Image();image.src=assetUrl(catalog.items[i],s.manifest.atlas).href;await image.decode();
      const {width,height,columns,frameCount}=s.manifest;
      if(image.naturalWidth!==width*columns||image.naturalHeight!==height*Math.ceil(frameCount/columns))throw new Error('Atlas dimensions do not match manifest: '+catalog.items[i].id);
      s.image=image;paint(s,0);s.button.classList.add('ready');$('#load-counter').textContent=`${++loaded} / ${states.length}`;
    }));
    ready=true;states.forEach(s=>s.button.disabled=false);rack.setAttribute('aria-busy','false');$('#load-state').hidden=true;$('#inspect').disabled=false;updateInfo(selected);layout();
    document.documentElement.dataset.ready='true';
  }catch(error){$('#load-text').textContent='Could not load previews';$('#load-counter').textContent='Check asset paths';rack.setAttribute('aria-busy','false');console.error(error.message);}
}
boot();
