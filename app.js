const CONTAINERS = {
  '20ft': { name:'20ft Dry', l:5898, w:2352, h:2393, maxWeight:28200 },
  '40ft': { name:'40ft Dry', l:12032, w:2352, h:2393, maxWeight:26700 },
  '40hc': { name:'40ft High Cube', l:12032, w:2352, h:2698, maxWeight:26500 },
  '45hc': { name:'45ft High Cube', l:13556, w:2352, h:2698, maxWeight:27600 }
};
const COLORS = ['#16734f','#ff8a4c','#5a87ff','#c28b38','#8c6ad8','#e15d71','#43a6a1'];
let products = [];
let result = null;
let shipment = null;
let activeContainer = 0;
let camera = { yaw:-0.63, pitch:0.42, zoom:1 };
let viewMode = 'iso';
let visibleStep = 0;
let playTimer = null;
let threeView = null;
let showDunnage = true;
let showAirbags = true;
const widthGapCache = new Map();
const $ = id => document.getElementById(id);

function init(){
  $('containerType').innerHTML = Object.entries(CONTAINERS).map(([k,c])=>`<option value="${k}">${c.name}</option>`).join('');
  bindEvents(); updateContainerSpec(); renderProducts(); resizeCanvas();
}
function bindEvents(){
  document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>switchTab(tab.dataset.tab));
  $('addProduct').onclick=addProduct;
  $('loadDemo').onclick=loadDemo;
  $('containerType').onchange=()=>{updateContainerSpec();markSimulationChanged()};
  $('optimization').onchange=markSimulationChanged;
  $('simulate').onclick=simulate;
  $('recalculateList').onclick=simulate;
  $('recalculateOptions').onclick=simulate;
  $('fileInput').onchange=e=>readFile(e.target.files[0]);
  $('downloadTemplate').onclick=downloadTemplate;
  $('exportPlan').onclick=exportPlan;
  $('toggleSequence').onclick=toggleSequence;
  $('viewIso').onclick=()=>setView('iso'); $('viewTop').onclick=()=>setView('top');
  $('toggleDunnage').onclick=()=>toggleSecuringVisibility('dunnage');
  $('toggleAirbags').onclick=()=>toggleSecuringVisibility('airbags');
  $('resetView').onclick=()=>{camera={yaw:-0.63,pitch:0.42,zoom:1};draw()};
  $('prevStep').onclick=()=>setStep(visibleStep-1);
  $('nextStep').onclick=()=>setStep(visibleStep+1);
  $('playSteps').onclick=togglePlayback;
  $('stepRange').oninput=e=>setStep(+e.target.value);
  const dz=$('dropzone'); ['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>readFile(e.dataTransfer.files[0]));
  let dragging=false,last={x:0,y:0}; const canvas=$('loadingCanvas');
  canvas.addEventListener('pointerdown',e=>{if(viewMode==='top')return;dragging=true;last={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;camera.yaw+=(e.clientX-last.x)*.008;camera.pitch=Math.max(.1,Math.min(1.1,camera.pitch+(e.clientY-last.y)*.006));last={x:e.clientX,y:e.clientY};draw()});
  canvas.addEventListener('pointerup',()=>dragging=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(2,camera.zoom*(e.deltaY>0?.9:1.1)));draw()},{passive:false});
  window.addEventListener('resize',()=>{resizeCanvas();syncSequenceHeight()});
}
function switchTab(name){document.querySelectorAll('.tab').forEach(x=>{x.classList.toggle('active',x.dataset.tab===name);x.setAttribute('aria-selected',x.dataset.tab===name)});$('manualPane').classList.toggle('active',name==='manual');$('uploadPane').classList.toggle('active',name==='upload')}
function addProduct(){
  const p={name:$('productName').value.trim(),group:$('productGroup').value.trim()||'기타',shape:$('productShape').value,qty:+$('productQty').value,l:+$('productLength').value,w:+$('productWidth').value,h:+$('productHeight').value,weight:+$('productWeight').value,rotate:$('allowRotation').checked,fragile:$('fragile').checked};
  if(!p.name||[p.qty,p.l,p.w,p.h,p.weight].some(v=>!v||v<=0)){alert('제품명, 수량, 규격, 중량을 올바르게 입력해 주세요.');return}
  p.id=Date.now()+Math.random(); p.color=COLORS[products.length%COLORS.length];products.push(p);renderProducts();
}
function loadDemo(){products=[
  {name:'산업용 펌프',group:'기계류',shape:'box',qty:4,l:1200,w:800,h:900,weight:420,rotate:true,fragile:false},
  {name:'제어반',group:'전기장비',shape:'box',qty:6,l:900,w:600,h:1100,weight:180,rotate:false,fragile:true},
  {name:'케이블 드럼',group:'부품',shape:'cylinder',qty:10,l:900,w:900,h:700,weight:310,rotate:false,fragile:false},
  {name:'필터 박스',group:'소모품',shape:'box',qty:16,l:600,w:500,h:450,weight:52,rotate:true,fragile:false}
].map((p,i)=>({...p,id:Date.now()+i,color:COLORS[i]}));renderProducts();simulate();document.querySelector('#planner').scrollIntoView({behavior:'smooth'})}
function renderProducts(){
  const total=products.reduce((s,p)=>s+p.qty,0);$('productCount').textContent=`(${products.length}개 품목 · ${total}박스)`;$('recalculateList').disabled=!products.length;$('recalculateOptions').disabled=!products.length;
  $('productList').innerHTML=products.length?products.map((p,i)=>`<div class="product-item"><span class="product-color" style="background:${p.color};border-radius:${p.shape==='cylinder'?'50%':'5px'}"></span><div><div class="product-title-row"><strong>${esc(p.name)}</strong><div class="qty-stepper" aria-label="${esc(p.name)} 수량"><span>수량</span><input type="number" min="1" step="1" value="${p.qty}" data-qty-input="${i}" aria-label="${esc(p.name)} 수량 직접 입력"><span class="qty-arrows"><button type="button" data-qty-up="${i}" aria-label="수량 증가">▲</button><button type="button" data-qty-down="${i}" aria-label="수량 감소" ${p.qty<=1?'disabled':''}>▼</button></span></div></div><small>${p.group} · ${p.shape==='cylinder'?'원통형':'박스형'} · ${p.l}×${p.w}×${p.h} mm · ${p.weight} kg</small><div class="product-options"><label><input type="checkbox" data-lay="${i}" ${p.rotate?'checked':''}> 눕힘 허용</label><label><input type="checkbox" data-fragile="${i}" ${p.fragile?'checked':''}> 상부 적재 금지</label></div></div><button class="delete-product" data-delete="${i}" aria-label="${esc(p.name)} 삭제">×</button></div>`).join(''):'<div class="list-empty">아직 등록된 제품이 없습니다.</div>';
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{products.splice(+b.dataset.delete,1);renderProducts()});
  document.querySelectorAll('[data-qty-up]').forEach(button=>button.onclick=()=>changeProductQty(+button.dataset.qtyUp,1));
  document.querySelectorAll('[data-qty-down]').forEach(button=>button.onclick=()=>changeProductQty(+button.dataset.qtyDown,-1));
  document.querySelectorAll('[data-qty-input]').forEach(input=>{input.onchange=()=>setProductQty(+input.dataset.qtyInput,input.value);input.onkeydown=e=>{if(e.key==='Enter'){input.blur();e.preventDefault()}}});
  document.querySelectorAll('[data-lay]').forEach(input=>input.onchange=()=>{products[+input.dataset.lay].rotate=input.checked;markSimulationChanged()});
  document.querySelectorAll('[data-fragile]').forEach(input=>input.onchange=()=>{products[+input.dataset.fragile].fragile=input.checked;markSimulationChanged()});
}
function changeProductQty(index,delta){if(!products[index])return;products[index].qty=Math.max(1,products[index].qty+delta);renderProducts();markSimulationChanged()}
function setProductQty(index,value){if(!products[index])return;const qty=Math.max(1,Math.floor(Number(value)||1));if(products[index].qty===qty){renderProducts();return}products[index].qty=qty;renderProducts();markSimulationChanged()}
function markSimulationChanged(){$('simulate').classList.add('needs-update');$('simulate').innerHTML='다시 계산 <b>→</b>';$('recalculateList').classList.add('needs-update');$('recalculateList').innerHTML='다시 계산 <b>→</b>';$('recalculateOptions').classList.add('needs-update');$('recalculateOptions').innerHTML='다시 계산 <b>→</b>'}
function updateContainerSpec(){const c=CONTAINERS[$('containerType').value]||CONTAINERS['20ft'];$('containerSpec').innerHTML=`<div><span>내부 길이</span><strong>${(c.l/1000).toFixed(2)} m</strong></div><div><span>내부 폭 / 높이</span><strong>${(c.w/1000).toFixed(2)} / ${(c.h/1000).toFixed(2)} m</strong></div><div><span>최대 적재</span><strong>${(c.maxWeight/1000).toFixed(1)} t</strong></div>`}

function compactPlacementScore(s,d,placed,c,item,priority){
  const [l,w,h]=d,eps=2;
  let contact=0;
  if(s.x<eps)contact+=w*h;if(s.y<eps)contact+=l*h;if(s.z<eps)contact+=l*w;
  if(Math.abs(s.x+l-c.l)<eps)contact+=w*h;if(Math.abs(s.y+w-c.w)<eps)contact+=l*h;
  placed.forEach(p=>{
    const oy=Math.max(0,Math.min(s.y+w,p.y+p.w)-Math.max(s.y,p.y)),oz=Math.max(0,Math.min(s.z+h,p.z+p.h)-Math.max(s.z,p.z)),ox=Math.max(0,Math.min(s.x+l,p.x+p.l)-Math.max(s.x,p.x));
    if(oy&&oz&&(Math.abs(s.x-(p.x+p.l))<eps||Math.abs(s.x+l-p.x)<eps))contact+=oy*oz;
    if(ox&&oz&&(Math.abs(s.y-(p.y+p.w))<eps||Math.abs(s.y+w-p.y)<eps))contact+=ox*oz;
    if(ox&&oy&&Math.abs(s.z-(p.z+p.h))<eps)contact+=ox*oy;
  });
  const sideRemainder=Math.min(Math.max(0,s.w-w),Math.max(0,s.l-l)),rawWidthGap=Math.max(0,s.w-w);
  const total=placed.reduce((sum,p)=>sum+p.weight,0)+item.weight;
  const mx=(placed.reduce((sum,p)=>sum+(p.x+p.l/2)*p.weight,0)+(s.x+l/2)*item.weight)/Math.max(1,total);
  const my=(placed.reduce((sum,p)=>sum+(p.y+p.w/2)*p.weight,0)+(s.y+w/2)*item.weight)/Math.max(1,total);
  const balanceOffset=Math.abs(mx-c.l/2)+Math.abs(my-c.w/2);
  if(priority==='volume'){
    // Capacity mode uses the same transverse lookahead as safety mode, without its stacking restrictions.
    const widthGap=projectedWidthGap(rawWidthGap);
    return widthGap*1e15+rawWidthGap*1e12+s.z*1e7+(s.l*s.w*s.h-l*w*h)/1e3+(s.x+s.y)*100+sideRemainder*40-contact/8;
  }
  if(priority==='sequence'){
    // Safety priority: transverse fill -> supported base -> lower stacking -> weight balance -> compact contact.
    const widthGap=projectedWidthGap(rawWidthGap),supportGap=1-placementSupportRatio(s,d,placed);
    return widthGap*1e15+rawWidthGap*1e12+supportGap*1e11+s.z*1e7+balanceOffset*1e3+(s.x+s.y)*100+sideRemainder*40-contact/8;
  }
  const balancePenalty=priority==='weight'?balanceOffset*350:0;
  return s.z*1e12+(s.x+s.y)*200+sideRemainder*400+(s.l*s.w*s.h-l*w*h)/1e8-contact/8+balancePenalty;
}
function projectedWidthGap(remaining){if(remaining<=0)return 0;const widths=[...new Set(products.flatMap(p=>allowedRotations(p).map(d=>Math.round(d[1]))).filter(w=>w>0&&w<=remaining))].sort((a,b)=>a-b),key=`${Math.round(remaining)}:${widths.join('-')}`;if(widthGapCache.has(key))return widthGapCache.get(key);if(!widths.length)return remaining;const reachable=new Uint8Array(Math.floor(remaining)+1);reachable[0]=1;for(let used=0;used<=remaining;used++){if(!reachable[used])continue;for(const width of widths)if(used+width<=remaining)reachable[used+width]=1}for(let used=Math.floor(remaining);used>=0;used--)if(reachable[used]){const gap=remaining-used;widthGapCache.set(key,gap);return gap}return remaining}
function cargoStabilityRisk(item){const base=Math.max(1,Math.min(item.l,item.w)),slender=item.h/base;return(item.shape==='cylinder'?2:0)+(slender>1.15?1:0)+(item.h>=1200?1:0)}
function sortUnitsForPacking(units,priority){if(priority==='volume')units.sort((a,b)=>b.volume-a.volume||b.weight-a.weight);else if(priority==='weight')units.sort((a,b)=>b.weight-a.weight||b.volume-a.volume);else units.sort((a,b)=>b.volume-a.volume||(b.l*b.w-a.l*a.w)||b.weight-a.weight||(cargoStabilityRisk(b)-cargoStabilityRisk(a))||b.h-a.h)}
function placementSupportRatio(s,d,placed){if(s.z===0)return 1;const [l,w]=d,base=l*w,support=placed.reduce((sum,p)=>{if(Math.abs(p.z+p.h-s.z)>2)return sum;const ox=Math.max(0,Math.min(s.x+l,p.x+p.l)-Math.max(s.x,p.x)),oy=Math.max(0,Math.min(s.y+w,p.y+p.w)-Math.max(s.y,p.y));return sum+ox*oy},0);return Math.min(1,support/Math.max(1,base))}
function unsafeElevatedPlacement(item,d,s,placed){if(s.z===0)return false;const slender=d[2]/Math.max(1,Math.min(d[0],d[1])),support=placementSupportRatio(s,d,placed);return support<.8||item.shape==='cylinder'||slender>1.15}
function placementCollides(s,d,placed){const [l,w,h]=d;return placed.some(p=>s.x<p.x+p.l&&s.x+l>p.x&&s.y<p.y+p.w&&s.y+w>p.y&&s.z<p.z+p.h&&s.z+h>p.z)}

function simulate(){
  if(!products.length){alert('먼저 제품을 하나 이상 추가해 주세요.');return}
  const c=CONTAINERS[$('containerType').value], priority=$('optimization').value;
  let units=products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1,volume:p.l*p.w*p.h})));
  sortUnitsForPacking(units,priority);
  const placed=[], rejected=[];let totalWeight=0;
  const spaces=[{x:0,y:0,z:0,l:c.l,w:c.w,h:c.h}];
  for(const item of units){
    if(totalWeight+item.weight>c.maxWeight){rejected.push({...item,reason:'중량 초과'});continue}
    const rotations=allowedRotations(item);let best=null;
    for(let si=0;si<spaces.length;si++)for(const d of rotations){const s=spaces[si];if(d[0]<=s.l&&d[1]<=s.w&&d[2]<=s.h&&!placementCollides(s,d,placed)&&(priority==='volume'||!unsafeElevatedPlacement(item,d,s,placed))){const score=compactPlacementScore(s,d,placed,c,item,priority);if(!best||score<best.score)best={si,d,score}}}
    if(!best){rejected.push({...item,reason:'공간 부족'});continue}
    const s=spaces.splice(best.si,1)[0],[l,w,h]=best.d;placed.push({...item,x:s.x,y:s.y,z:s.z,l,w,h,order:placed.length+1});totalWeight+=item.weight;
    // guillotine subdivision: right, back, above. Small unusable spaces are pruned.
    const next=[{x:s.x+l,y:s.y,z:s.z,l:s.l-l,w:s.w,h:s.h},{x:s.x,y:s.y+w,z:s.z,l:s.l,w:s.w-w,h:s.h},{x:s.x,y:s.y,z:s.z+h,l:l,w:w,h:s.h-h}];
    next.filter((q,i)=>q.l>0&&q.w>0&&q.h>0&&(!item.fragile||i!==2)&&(priority==='volume'||item.shape!=='cylinder'||i!==2)).forEach(q=>spaces.push(q));spaces.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y);
  }
  const productVolume=placed.reduce((s,p)=>s+p.l*p.w*p.h,0), containerVolume=c.l*c.w*c.h;
  shiftCargoInside(placed,c);placed.sort((a,b)=>b.x-a.x||a.z-b.z||a.y-b.y).forEach((p,i)=>p.order=i+1);
  result={container:c,placed,rejected,totalWeight,volumeRate:productVolume/containerVolume*100,weightRate:totalWeight/c.maxWeight*100};
  const loads=[result];let remaining=rejected;
  while(remaining.length&&loads.length<50){const next=packAdditional(c,remaining,priority);if(!next.placed.length)break;loads.push(next);remaining=next.rejected}
  loads.forEach((load,i)=>load.containerNumber=i+1);
  loads.forEach(load=>load.securing=buildSecuringPlan(load));
  shipment={containers:loads,unallocated:remaining,totalUnits:units.length,containerKey:$('containerType').value,priority};
  result=loads[0];activeContainer=0;
  visibleStep=placed.length;stopPlayback();
  $('simulate').classList.remove('needs-update');$('simulate').innerHTML='시뮬레이션 실행 <b>→</b>';$('recalculateList').classList.remove('needs-update');$('recalculateList').innerHTML='시뮬레이션 실행 <b>→</b>';$('recalculateOptions').classList.remove('needs-update');$('recalculateOptions').innerHTML='시뮬레이션 실행 <b>→</b>';updateResults();resizeCanvas();draw();
}
function packAdditional(c,units,priority){
  units=[...units];sortUnitsForPacking(units,priority);
  const placed=[],rejected=[];let totalWeight=0;const spaces=[{x:0,y:0,z:0,l:c.l,w:c.w,h:c.h}];
  for(const item of units){if(totalWeight+item.weight>c.maxWeight){rejected.push(item);continue}let best=null;for(let si=0;si<spaces.length;si++)for(const d of allowedRotations(item)){const s=spaces[si];if(d[0]<=s.l&&d[1]<=s.w&&d[2]<=s.h&&!placementCollides(s,d,placed)&&(priority==='volume'||!unsafeElevatedPlacement(item,d,s,placed))){const score=compactPlacementScore(s,d,placed,c,item,priority);if(!best||score<best.score)best={si,d,score}}}if(!best){rejected.push(item);continue}const s=spaces.splice(best.si,1)[0],[l,w,h]=best.d;placed.push({...item,x:s.x,y:s.y,z:s.z,l,w,h});totalWeight+=item.weight;[{x:s.x+l,y:s.y,z:s.z,l:s.l-l,w:s.w,h:s.h},{x:s.x,y:s.y+w,z:s.z,l:s.l,w:s.w-w,h:s.h},{x:s.x,y:s.y,z:s.z+h,l:l,w:w,h:s.h-h}].filter((q,i)=>q.l>0&&q.w>0&&q.h>0&&(!item.fragile||i!==2)&&(priority==='volume'||item.shape!=='cylinder'||i!==2)).forEach(q=>spaces.push(q));spaces.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y)}
  shiftCargoInside(placed,c);placed.sort((a,b)=>b.x-a.x||a.z-b.z||a.y-b.y).forEach((p,i)=>p.order=i+1);const volume=placed.reduce((s,p)=>s+p.l*p.w*p.h,0);return{container:c,placed,rejected,totalWeight,volumeRate:volume/(c.l*c.w*c.h)*100,weightRate:totalWeight/c.maxWeight*100};
}
function shiftCargoInside(placed,c){if(!placed.length)return;placed.forEach(p=>p.x=c.l-(p.x+p.l))}
function buildSecuringPlan(load){
  const dunnage=[],airbags=[],floorItems=load.placed.filter(p=>p.z===0),c=load.container;
  const doorGap=floorItems.length?Math.min(...floorItems.map(p=>p.x)):0;
  if(floorItems.length){
    const overlap=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0)>40;
    const exposed=(p,axis,side)=>!floorItems.some(q=>q!==p&&(axis==='x'?overlap(p.y,p.y+p.w,q.y,q.y+q.w):overlap(p.x,p.x+p.l,q.x,q.x+q.l))&&(axis==='x'?(side==='min'?q.x+q.l<=p.x:q.x>=p.x+p.l):(side==='min'?q.y+q.w<=p.y:q.y>=p.y+p.w)));
    const addEdge=(axis,side,location)=>{
      const gap=p=>axis==='x'?(side==='min'?p.x:c.l-p.x-p.l):(side==='min'?p.y:c.w-p.y-p.w);
      floorItems.filter(p=>exposed(p,axis,side)&&gap(p)>=60).sort((a,b)=>gap(a)-gap(b)).slice(0,3).forEach(p=>{
        const g=gap(p);
        if(axis==='x'){const l=Math.min(180,Math.max(65,g-12)),w=Math.min(240,p.w*.42),x=side==='min'?p.x-l-6:p.x+p.l+6;dunnage.push({type:'dunnage',axis,side,x:Math.max(0,Math.min(c.l-l,x)),y:p.y+(p.w-w)/2,z:0,l,w,h:125,product:p.name,location})}
        else{const w=Math.min(180,Math.max(65,g-12)),l=Math.min(240,p.l*.42),y=side==='min'?p.y-w-6:p.y+p.w+6;dunnage.push({type:'dunnage',axis,side,x:p.x+(p.l-l)/2,y:Math.max(0,Math.min(c.w-w,y)),z:0,l,w,h:125,product:p.name,location})}
      });
    };
    addEdge('x','min','문쪽 최외곽 하단');
  }
  {
    const candidates=[];
    load.placed.forEach(p=>{const left=p.y,right=c.w-(p.y+p.w),back=c.l-(p.x+p.l),length=Math.min(700,p.l*.6),width=Math.min(700,p.w*.6),x=p.x+(p.l-length)/2,y=p.y+(p.w-width)/2,height=Math.min(1200,p.h*.72),z=p.z+Math.max(20,p.h*.14),level=p.z>0?`${Math.round(p.z/1000*10)/10}m 높이`:'';if(left>=120&&left<=600)candidates.push({type:'airbag',zone:'left',x,y:0,z,l:length,w:left,h:height,location:`좌측 벽 간극 ${level}`.trim(),product:p.name});if(right>=120&&right<=600)candidates.push({type:'airbag',zone:'right',x,y:p.y+p.w,z,l:length,w:right,h:height,location:`우측 벽 간극 ${level}`.trim(),product:p.name});if(back>=120&&back<=600)candidates.push({type:'airbag',zone:'back',x:p.x+p.l,y,z,l:back,w:width,h:height,location:`안쪽 벽 간극 ${level}`.trim(),product:p.name})});
    const sorted=[...load.placed].sort((a,b)=>a.x-b.x);sorted.forEach((p,i)=>{let nearest=null;for(let j=i+1;j<sorted.length;j++){const q=sorted[j],gap=q.x-(p.x+p.l),overlap=Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y),vertical=Math.min(p.z+p.h,q.z+q.h)-Math.max(p.z,q.z);if(gap>0&&overlap>150&&vertical>150&&(!nearest||gap<nearest.gap))nearest={q,gap,overlap,vertical}}if(nearest&&nearest.gap>=120&&nearest.gap<=600){const baseZ=Math.max(p.z,nearest.q.z),z=baseZ+Math.max(20,nearest.vertical*.14);candidates.push({type:'airbag',zone:'cargo',x:p.x+p.l,y:Math.max(p.y,nearest.q.y),z,l:nearest.gap,w:nearest.overlap,h:Math.min(1200,nearest.vertical*.72),location:`화물 사이 간극${baseZ>0?` · ${(baseZ/1000).toFixed(1)}m 높이`:''}`,product:`${p.name} / ${nearest.q.name}`})}});
    const byY=[...load.placed].sort((a,b)=>a.y-b.y);byY.forEach((p,i)=>{let nearest=null;for(let j=i+1;j<byY.length;j++){const q=byY[j],gap=q.y-(p.y+p.w),overlap=Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x),vertical=Math.min(p.z+p.h,q.z+q.h)-Math.max(p.z,q.z);if(gap>0&&overlap>180&&vertical>150&&(!nearest||gap<nearest.gap))nearest={q,gap,overlap,vertical}}if(nearest&&nearest.gap>=120&&nearest.gap<=600){const baseZ=Math.max(p.z,nearest.q.z),z=baseZ+Math.max(20,nearest.vertical*.12);candidates.push({type:'airbag',zone:'center',x:Math.max(p.x,nearest.q.x),y:p.y+p.w,z,l:nearest.overlap,w:nearest.gap,h:Math.min(1400,nearest.vertical*.76),location:`화물 열 사이 중앙 간극${baseZ>0?` · ${(baseZ/1000).toFixed(1)}m 높이`:''}`,product:`${p.name} / ${nearest.q.name}`})}});
    const free=q=>!load.placed.some(p=>q.x<p.x+p.l&&q.x+q.l>p.x&&q.y<p.y+p.w&&q.y+q.w>p.y&&q.z<p.z+p.h&&q.z+q.h>p.z);
    const overlapRatio=(a0,a1,b0,b1)=>Math.max(0,Math.min(a1,b1)-Math.max(a0,b0))/Math.max(1,Math.min(a1-a0,b1-b0));
    const grounded=candidates.map(q=>({...q,h:q.z+q.h,z:0,location:`${q.location.replace(/\s*·?\s*\d+(?:\.\d+)?m 높이/g,'')} · 바닥 설치`}));
    grounded.filter(free).sort((a,b)=>(b.l*b.w*b.h-a.l*a.w*a.h)).forEach(q=>{const duplicate=airbags.some(a=>overlapRatio(a.x,a.x+a.l,q.x,q.x+q.l)>.55&&overlapRatio(a.y,a.y+a.w,q.y,q.y+q.w)>.55&&overlapRatio(a.z,a.z+a.h,q.z,q.z+q.h)>.35);if(!duplicate)airbags.push(q)});
    const zoneName={left:'좌측 벽 간극',right:'우측 벽 간극',back:'안쪽 벽 간극',door:'문쪽 간극',center:'화물 열 사이 중앙 간극'};
    let combined=true;
    while(combined){combined=false;outer:for(let i=0;i<airbags.length;i++)for(let j=i+1;j<airbags.length;j++){const a=airbags[i],b=airbags[j];if(!a.zone||a.zone==='cargo'||a.zone!==b.zone)continue;const horizontal=overlapRatio(a.x,a.x+a.l,b.x,b.x+b.l)>.55&&overlapRatio(a.y,a.y+a.w,b.y,b.y+b.w)>.55,verticalGap=Math.max(0,Math.max(a.z,b.z)-Math.min(a.z+a.h,b.z+b.h));if(!horizontal||verticalGap>350)continue;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),z=Math.min(a.z,b.z),l=Math.min(a.x+a.l,b.x+b.l)-x,w=Math.min(a.y+a.w,b.y+b.w)-y,h=Math.max(a.z+a.h,b.z+b.h)-z,merged={type:'airbag',zone:a.zone,x,y,z,l,w,h,location:`${zoneName[a.zone]} · 대형 수직 통합`,product:`${a.product} / ${b.product}`,combined:(a.combined||1)+(b.combined||1)};if(l>100&&w>100&&h<=c.h-z&&free(merged)){airbags.splice(j,1);airbags.splice(i,1,merged);combined=true;break outer}}}
    airbags.sort((a,b)=>(b.combined||1)-(a.combined||1)||b.z-a.z);if(airbags.length>14)airbags.splice(14);
  }
  return{dunnage,airbags};
}
function uniqueRotations(p){const a=[[p.l,p.w,p.h],[p.w,p.l,p.h],[p.l,p.h,p.w],[p.h,p.l,p.w],[p.w,p.h,p.l],[p.h,p.w,p.l]];return a.filter((x,i)=>a.findIndex(y=>y.join()==x.join())===i)}
function allowedRotations(p){return p.rotate?uniqueRotations(p):uniqueRotations({l:p.l,w:p.w,h:p.h}).filter(d=>d[2]===p.h)}
function testContainer(c,priority){
  let units=products.flatMap(p=>Array.from({length:p.qty},()=>({...p,volume:p.l*p.w*p.h})));
  sortUnitsForPacking(units,priority);
  const spaces=[{x:0,y:0,z:0,l:c.l,w:c.w,h:c.h}],placed=[];let loaded=0,weight=0;
  for(const item of units){
    if(weight+item.weight>c.maxWeight)continue;let best=null;
    for(let si=0;si<spaces.length;si++)for(const d of allowedRotations(item)){const s=spaces[si];if(d[0]<=s.l&&d[1]<=s.w&&d[2]<=s.h&&!placementCollides(s,d,placed)&&(priority==='volume'||!unsafeElevatedPlacement(item,d,s,placed))){const score=compactPlacementScore(s,d,placed,c,item,priority);if(!best||score<best.score)best={si,d,score}}}
    if(!best)continue;const s=spaces.splice(best.si,1)[0],[l,w,h]=best.d;loaded++;weight+=item.weight;placed.push({...item,x:s.x,y:s.y,z:s.z,l,w,h});
    [{x:s.x+l,y:s.y,z:s.z,l:s.l-l,w:s.w,h:s.h},{x:s.x,y:s.y+w,z:s.z,l:s.l,w:s.w-w,h:s.h},{x:s.x,y:s.y,z:s.z+h,l:l,w:w,h:s.h-h}].filter((q,i)=>q.l>0&&q.w>0&&q.h>0&&(!item.fragile||i!==2)&&(priority==='volume'||item.shape!=='cylinder'||i!==2)).forEach(q=>spaces.push(q));spaces.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y);
  }return{loaded,total:units.length};
}
function recommendContainer(currentKey,priority){
  const entries=Object.entries(CONTAINERS),start=entries.findIndex(([key])=>key===currentKey);
  for(let i=start+1;i<entries.length;i++){const [key,container]=entries[i],trial=testContainer(container,priority);if(trial.loaded===trial.total)return{key,container,trial,type:'upgrade'}}
  const [key,container]=entries[entries.length-1],trial=testContainer(container,priority);return{key,container,trial,type:'split',containers:Math.max(2,Math.ceil(trial.total/Math.max(1,trial.loaded)))};
}
function updateResults(){
  const r=result,total=shipment?shipment.totalUnits:products.reduce((s,p)=>s+p.qty,0);$('emptyState').style.display='none';$('canvasHint').style.display='block';document.querySelector('.axis-legend').style.display='flex';renderContainerTabs();
  $('volumeRate').textContent=`${r.volumeRate.toFixed(1)}%`;$('weightRate').textContent=`${r.weightRate.toFixed(1)}%`;$('volumeBar').style.width=`${Math.min(100,r.volumeRate)}%`;$('weightBar').style.width=`${Math.min(100,r.weightRate)}%`;
  $('loadedCount').textContent=`${r.placed.length}개`;$('loadedDetail').textContent=`컨테이너 ${r.containerNumber||1} · 전체 ${total}개`;$('totalWeight').textContent=`${r.totalWeight.toLocaleString()} kg`;$('weightDetail').textContent=`허용 ${(r.container.maxWeight/1000).toFixed(1)} t`;
  const groups=[];r.placed.forEach(p=>{let g=groups.find(x=>x.name===p.name&&x.z===p.z&&x.x===p.x);if(g)g.count++;else groups.push({...p,count:1})});
  $('sequenceEmpty').style.display='none';$('sequenceList').innerHTML=groups.map((p,i)=>`<li><span class="num">${String(i+1).padStart(2,'0')}</span><span class="dot" style="background:${p.color};border-radius:${p.shape==='cylinder'?'50%':'2px'}"></span><div><strong>${esc(p.name)} × ${p.count} · ${p.shape==='cylinder'?'원통형':'박스형'}</strong><br><small>문에서 ${(p.x/1000).toFixed(2)}m 안쪽 · 바닥에서 ${(p.z/1000).toFixed(2)}m 높이</small></div><small>${p.l}×${p.w}×${p.h}</small></li>`).join('');$('exportPlan').disabled=false;
  $('playback').style.display='flex';$('stepRange').max=r.placed.length;$('totalSteps').textContent=r.placed.length;setStep(r.placed.length);renderRecommendation();renderSecuringRecommendation();requestAnimationFrame(syncSequenceHeight);
}
function toggleSequence(){const plan=document.querySelector('.loading-plan'),expanded=plan.classList.toggle('expanded');$('toggleSequence').textContent=expanded?'접기':'전체 보기';if(!expanded)requestAnimationFrame(syncSequenceHeight)}
function syncSequenceHeight(){const plan=document.querySelector('.loading-plan'),list=$('sequenceList'),panel=document.querySelector('.control-panel');if(!plan||!list||!panel||plan.classList.contains('expanded'))return;const available=Math.max(220,Math.round(panel.getBoundingClientRect().bottom-list.getBoundingClientRect().top-24));list.style.setProperty('--sequence-max-height',`${available}px`)}
function renderContainerTabs(){const el=$('containerTabs');if(!shipment){el.style.display='none';return}const total=shipment.containers.length;el.style.display='flex';el.innerHTML=`<button class="nav-arrow" id="prevContainer" ${activeContainer===0?'disabled':''} aria-label="이전 컨테이너">‹</button><span class="page-label">${activeContainer+1} / ${total}</span><button class="nav-arrow" id="nextContainerArrow" ${activeContainer===total-1?'disabled':''} aria-label="다음 컨테이너">›</button>`;$('prevContainer').onclick=()=>selectContainer(activeContainer-1);$('nextContainerArrow').onclick=()=>selectContainer(activeContainer+1)}
function selectContainer(index){if(!shipment||!shipment.containers[index])return;activeContainer=index;result=shipment.containers[index];visibleStep=result.placed.length;stopPlayback();updateResults();resizeCanvas();draw()}
function renderRecommendation(){
  const el=$('recommendation');if(!shipment||shipment.containers.length===1&&!shipment.unallocated.length){el.hidden=true;el.innerHTML='';return}el.hidden=false;const c=result.container,count=shipment.containers.length,left=shipment.unallocated.length;
  el.innerHTML=`<div><strong>${c.name} ${count}대로 분할 적재합니다.</strong><p>3D 화면 위의 좌우 화살표와 번호를 이용해 각 컨테이너의 배치와 적재 순서를 확인하세요.${left?` 규격상 적재할 수 없는 화물 ${left}개는 별도 검토가 필요합니다.`:''}</p></div>`;
}
function renderSecuringRecommendation(){const el=$('securingRecommendation'),plan=result.securing;if(!plan||(!plan.dunnage.length&&!plan.airbags.length)){el.hidden=true;el.innerHTML='';return}el.hidden=false;const items=[...plan.dunnage.slice(0,6).map((d,i)=>`<div><strong>문쪽 고정 부목 ${i+1} · ${d.location}</strong>${esc(d.product)} 하단 · X ${(d.x/1000).toFixed(2)}m · Y ${(d.y/1000).toFixed(2)}m</div>`),...plan.airbags.slice(0,8).map((a,i)=>`<div><strong>에어백 ${i+1} · ${a.location}</strong>X ${(a.x/1000).toFixed(2)}m · Y ${(a.y/1000).toFixed(2)}m · Z ${(a.z/1000).toFixed(2)}m</div>`)];el.innerHTML=`<h3>컨테이너 ${result.containerNumber} 화물 고정재 추천</h3><p>문쪽 마지막 화물 하단 부목 ${plan.dunnage.length}개 · 벽면 및 화물 사이 에어백 ${plan.airbags.length}개${plan.dunnage.length>6||plan.airbags.length>8?' · 대표 위치만 표시':''}. 화물은 안쪽 벽부터 배치하고 문쪽 여유 공간은 마지막 화물 하단 부목으로 고정합니다. 좌·우 벽면 또는 화물 열 사이에 남는 간극은 에어백으로 고정합니다. 실제 설치 전 바닥 못 고정 허용 여부와 제조사 지침을 확인하세요.</p><div class="securing-items">${items.join('')}</div>`}
function setStep(step){if(!result)return;visibleStep=Math.max(0,Math.min(result.placed.length,step));$('currentStep').textContent=visibleStep;$('stepRange').value=visibleStep;$('prevStep').disabled=visibleStep===0;$('nextStep').disabled=visibleStep===result.placed.length;draw()}
function togglePlayback(){if(playTimer){stopPlayback();return}if(visibleStep>=result.placed.length)setStep(0);$('playSteps').textContent='Ⅱ';playTimer=setInterval(()=>{if(visibleStep>=result.placed.length){stopPlayback();return}setStep(visibleStep+1)},650)}
function stopPlayback(){if(playTimer)clearInterval(playTimer);playTimer=null;if($('playSteps'))$('playSteps').textContent='▶'}

function resizeCanvas(){const c=$('loadingCanvas'),rect=$('canvasWrap').getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);c.width=Math.max(1,rect.width*dpr);c.height=Math.max(1,rect.height*dpr);if(threeView&&rect.width&&rect.height){threeView.renderer.setSize(rect.width,rect.height,false);threeView.camera.aspect=rect.width/rect.height;threeView.camera.updateProjectionMatrix()}draw()}
function draw(){if(!result)return;if(typeof THREE!=='undefined'){drawThree();return}const canvas=$('loadingCanvas'),ctx=canvas.getContext('2d'),dpr=Math.min(2,window.devicePixelRatio||1),W=canvas.width/dpr,H=canvas.height/dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);if(viewMode==='top')drawTop(ctx,W,H);else drawIso(ctx,W,H)}
function initThree(){
  if(threeView||typeof THREE==='undefined')return;const mount=$('threeMount');mount.style.display='block';const rect=$('canvasWrap').getBoundingClientRect(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.setSize(rect.width,rect.height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;mount.appendChild(renderer.domElement);$('loadingCanvas').style.display='none';
  const scene=new THREE.Scene(),camera3=new THREE.PerspectiveCamera(34,rect.width/rect.height,1,100000),group=new THREE.Group();scene.add(group);scene.add(new THREE.HemisphereLight(0xffffff,0x789085,2.1));const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(-6000,8000,5000);scene.add(light);threeView={renderer,scene,camera:camera3,group};
  let dragging=false,lastX=0,lastY=0;const el=renderer.domElement;el.addEventListener('pointerdown',e=>{if(viewMode==='top')return;dragging=true;lastX=e.clientX;lastY=e.clientY;el.setPointerCapture(e.pointerId)});el.addEventListener('pointermove',e=>{if(!dragging)return;camera.yaw+=(e.clientX-lastX)*.008;camera.pitch=Math.max(.12,Math.min(1.35,camera.pitch-(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY;drawThree()});el.addEventListener('pointerup',()=>dragging=false);el.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(2,camera.zoom*(e.deltaY>0?.9:1.1)));drawThree()},{passive:false});
}
function disposeThreeGroup(){if(!threeView)return;while(threeView.group.children.length){const o=threeView.group.children.pop();o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();o.children?.forEach(c=>{c.geometry?.dispose();c.material?.dispose()})}}
function drawThree(){
  initThree();if(!threeView)return;const {renderer,scene,camera:cam,group}=threeView,c=result.container;disposeThreeGroup();
  const visible=result.placed.slice(0,visibleStep),toColor=hex=>new THREE.Color(hex),edgeMat=new THREE.LineBasicMaterial({color:0x315e4c,transparent:true,opacity:.65});
  visible.forEach(p=>{let geometry;if(p.shape==='cylinder'){geometry=new THREE.CylinderGeometry(.5,.5,1,28);geometry.scale(p.l,p.h,p.w)}else geometry=new THREE.BoxGeometry(p.l,p.h,p.w);const material=new THREE.MeshStandardMaterial({color:toColor(p.color),roughness:.72,metalness:.03,transparent:true,opacity:.94,side:THREE.FrontSide}),mesh=new THREE.Mesh(geometry,material);mesh.position.set(p.x+p.l/2,p.z+p.h/2,p.y+p.w/2);group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0x263b32,transparent:true,opacity:.42}));edges.position.copy(mesh.position);group.add(edges)});
  if(visibleStep===result.placed.length&&result.securing){
    const woodMaterial=new THREE.MeshStandardMaterial({color:0xa56a32,roughness:.88}),nailMaterial=new THREE.MeshStandardMaterial({color:0x383d42,metalness:.65,roughness:.38});
    if(showDunnage)result.securing.dunnage.forEach(d=>{
      const dx=d.l,dz=d.w,h=d.h,isX=d.axis==='x',highAtMax=d.side==='min',positions=isX
        ?[0,0,0, dx,0,0, dx,0,dz, 0,0,dz, highAtMax?dx:0,h,0, highAtMax?dx:0,h,dz]
        :[0,0,0, dx,0,0, dx,0,dz, 0,0,dz, 0,h,highAtMax?dz:0, dx,h,highAtMax?dz:0],
        indices=highAtMax
          ?(isX?[0,2,1,0,3,2,1,2,5,1,5,4,0,4,5,0,5,3,0,1,4,3,5,2]:[0,2,1,0,3,2,3,5,2,3,4,5,0,1,5,0,5,4,0,4,3,1,2,5])
          :(isX?[0,2,1,0,3,2,0,4,5,0,5,3,1,2,5,1,5,4,0,1,4,3,5,2]:[0,2,1,0,3,2,0,1,5,0,5,4,3,4,5,3,5,2,0,4,3,1,2,5]);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,woodMaterial);mesh.position.set(d.x,4,d.y);group.add(mesh);
      const nailGeometry=new THREE.CylinderGeometry(12,12,8,14);
      [0.3,0.7].forEach(t=>{const nail=new THREE.Mesh(nailGeometry,nailMaterial);nail.position.set(d.x+(isX?(highAtMax?.2:.8)*dx:t*dx),10,d.y+(isX?t*dz:(highAtMax?.2:.8)*dz));group.add(nail)});
    });
    if(showAirbags)result.securing.airbags.forEach(a=>{
      const material=new THREE.MeshStandardMaterial({color:0x70bde9,transparent:true,opacity:.74,roughness:.58}),geometry=new THREE.SphereGeometry(.5,28,18),mesh=new THREE.Mesh(geometry,material);
      mesh.scale.set(a.l*.94,a.h,a.w*.94);mesh.position.set(a.x+a.l/2,a.z+a.h/2,a.y+a.w/2);group.add(mesh);
      const seam=new THREE.Mesh(new THREE.TorusGeometry(.5,0.018,8,36),new THREE.MeshStandardMaterial({color:0xd7effb,transparent:true,opacity:.8,roughness:.65}));seam.scale.set(a.l*.96,a.w*.96,1);seam.rotation.x=Math.PI/2;seam.position.set(a.x+a.l/2,a.z+a.h/2,a.y+a.w/2);group.add(seam);
      const valve=new THREE.Mesh(new THREE.CylinderGeometry(17,21,28,12),new THREE.MeshStandardMaterial({color:0x276e96,roughness:.48}));valve.position.set(a.x+a.l/2,a.z+a.h+8,a.y+a.w/2);group.add(valve);
    })
  }
  const frameGeo=new THREE.BoxGeometry(c.l,c.h,c.w),frame=new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo),edgeMat);frame.position.set(c.l/2,c.h/2,c.w/2);group.add(frame);
  const floorGeo=new THREE.PlaneGeometry(c.l,c.w),floor=new THREE.Mesh(floorGeo,new THREE.MeshStandardMaterial({color:0xdfe9e2,transparent:true,opacity:.22,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.position.set(c.l/2,0,c.w/2);group.add(floor);
  const target=new THREE.Vector3(c.l/2,c.h*.42,c.w/2),distance=Math.max(c.l,c.w*2.5,c.h*2.5)*1.25/camera.zoom;
  if(viewMode==='top'){cam.position.set(c.l/2,distance*1.1,c.w/2+.01);cam.up.set(0,0,-1)}else{const horizontal=distance*Math.cos(camera.pitch);cam.position.set(target.x+Math.cos(camera.yaw)*horizontal,target.y+Math.sin(camera.pitch)*distance,target.z+Math.sin(camera.yaw)*horizontal);cam.up.set(0,1,0)}cam.lookAt(target);cam.near=Math.max(1,distance/1000);cam.far=distance*10;cam.updateProjectionMatrix();renderer.render(scene,cam);
}
function drawIso(ctx,W,H){
  const c=result.container,cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
  const raw=(x,y,z)=>{x-=c.l/2;y-=c.w/2;z-=c.h/2;const rx=x*cy-y*sy,ry=x*sy+y*cy;return[rx,ry*sp-z*cp,ry*cp+z*sp]};
  const corners=[[0,0,0],[c.l,0,0],[0,c.w,0],[c.l,c.w,0],[0,0,c.h],[c.l,0,c.h],[0,c.w,c.h],[c.l,c.w,c.h]],rawCorners=corners.map(v=>raw(...v));
  const xs=rawCorners.map(p=>p[0]),ys=rawCorners.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),pad=58;
  const scale=Math.min((W-pad*2)/(maxX-minX),(H-pad*2)/(maxY-minY))*camera.zoom,centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const P=(x,y,z)=>{const p=raw(x,y,z);return[W/2+(p[0]-centerX)*scale,H/2+(p[1]-centerY)*scale,p[2]]};
  const visible=result.placed.slice(0,visibleStep),polygons=[];
  const addBox=o=>{const pts=[[o.x,o.y,o.z],[o.x+o.l,o.y,o.z],[o.x,o.y+o.w,o.z],[o.x+o.l,o.y+o.w,o.z],[o.x,o.y,o.z+o.h],[o.x+o.l,o.y,o.z+o.h],[o.x,o.y+o.w,o.z+o.h],[o.x+o.l,o.y+o.w,o.z+o.h]].map(v=>P(...v));const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]],tones=[-18,20,-7,5,-12,1];faces.forEach((f,i)=>polygons.push({pts:f.map(n=>pts[n]),depth:f.reduce((s,n)=>s+pts[n][2],0)/4,fill:shade(o.color,tones[i]),stroke:'rgba(19,37,29,.34)'}))};
  const addCylinder=o=>{const n=20,cx=o.x+o.l/2,midY=o.y+o.w/2,rx=o.l/2,ry=o.w/2,b=[],t=[];for(let i=0;i<n;i++){const a=Math.PI*2*i/n;b.push(P(cx+Math.cos(a)*rx,midY+Math.sin(a)*ry,o.z));t.push(P(cx+Math.cos(a)*rx,midY+Math.sin(a)*ry,o.z+o.h))}for(let i=0;i<n;i++){const j=(i+1)%n,pts=[b[i],b[j],t[j],t[i]];polygons.push({pts,depth:pts.reduce((s,p)=>s+p[2],0)/4,fill:shade(o.color,i%2?-3:3),stroke:'rgba(19,37,29,.24)'})}polygons.push({pts:b,depth:b.reduce((s,p)=>s+p[2],0)/n,fill:shade(o.color,-14),stroke:'rgba(19,37,29,.3)'});polygons.push({pts:t,depth:t.reduce((s,p)=>s+p[2],0)/n,fill:shade(o.color,20),stroke:'rgba(19,37,29,.35)'})};
  visible.forEach(p=>p.shape==='cylinder'?addCylinder(p):addBox(p));
  polygons.sort((a,b)=>a.depth-b.depth).forEach(poly=>{ctx.beginPath();poly.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=poly.fill;ctx.globalAlpha=.94;ctx.fill();ctx.strokeStyle=poly.stroke;ctx.lineWidth=.7;ctx.stroke()});ctx.globalAlpha=1;
  const framePts=corners.map(v=>P(...v)),edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];ctx.strokeStyle='rgba(15,107,72,.72)';ctx.lineWidth=1.4;ctx.setLineDash([5,4]);edges.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(framePts[a][0],framePts[a][1]);ctx.lineTo(framePts[b][0],framePts[b][1]);ctx.stroke()});ctx.setLineDash([]);
  if(visible.length){const p=visible[visible.length-1],[x,y]=P(p.x+p.l/2,p.y+p.w/2,p.z+p.h);ctx.fillStyle='#13251d';ctx.beginPath();ctx.arc(x,y-15,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c9ff5a';ctx.font='700 10px DM Sans';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.order),x,y-15);ctx.textAlign='start';ctx.textBaseline='alphabetic'}
}
function drawTop(ctx,W,H){const c=result.container,pad=52,scale=Math.min((W-pad*2)/c.l,(H-pad*2)/c.w)*camera.zoom,ox=(W-c.l*scale)/2,oy=(H-c.w*scale)/2;ctx.fillStyle='#f7faf6';ctx.strokeStyle='rgba(15,107,72,.7)';ctx.lineWidth=2;ctx.fillRect(ox,oy,c.l*scale,c.w*scale);ctx.strokeRect(ox,oy,c.l*scale,c.w*scale);result.placed.slice(0,visibleStep).sort((a,b)=>a.z-b.z).forEach(p=>{ctx.fillStyle=p.color+'d9';ctx.strokeStyle='rgba(19,37,29,.35)';ctx.beginPath();if(p.shape==='cylinder')ctx.ellipse(ox+(p.x+p.l/2)*scale,oy+(p.y+p.w/2)*scale,p.l*scale/2,p.w*scale/2,0,0,Math.PI*2);else ctx.rect(ox+p.x*scale,oy+p.y*scale,p.l*scale,p.w*scale);ctx.fill();ctx.stroke();if(p.l*scale>28&&p.w*scale>18){ctx.fillStyle='white';ctx.font='700 10px DM Sans';ctx.fillText(p.order,ox+p.x*scale+5,oy+p.y*scale+13)}})}
function shade(hex,amt){const n=parseInt(hex.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+amt)),g=Math.max(0,Math.min(255,((n>>8)&255)+amt)),b=Math.max(0,Math.min(255,(n&255)+amt));return`rgb(${r},${g},${b})`}
function setView(mode){viewMode=mode;$('viewIso').classList.toggle('active',mode==='iso');$('viewTop').classList.toggle('active',mode==='top');$('canvasHint').textContent=mode==='iso'?'드래그하여 회전 · 휠로 확대/축소':'휠로 확대/축소';draw()}
function toggleSecuringVisibility(type){const isDunnage=type==='dunnage';if(isDunnage)showDunnage=!showDunnage;else showAirbags=!showAirbags;const button=$(isDunnage?'toggleDunnage':'toggleAirbags'),active=isDunnage?showDunnage:showAirbags;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.querySelector('b').textContent=active?'ON':'OFF';draw()}

async function readFile(file){if(!file)return;try{let rows;if(file.name.toLowerCase().endsWith('.csv'))rows=parseCSV(await file.text());else{if(typeof XLSX==='undefined')throw new Error('Excel 파서를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV를 사용해 주세요.');const wb=XLSX.read(await file.arrayBuffer()),sheet=wb.Sheets[wb.SheetNames[0]];rows=XLSX.utils.sheet_to_json(sheet,{defval:''})}const mapped=rows.map((r,i)=>mapRow(r,i)).filter(Boolean);if(!mapped.length)throw new Error('인식 가능한 제품 데이터가 없습니다. 열 이름을 확인해 주세요.');products=mapped;renderProducts();switchTab('manual');alert(`${mapped.length}개 품목을 불러왔습니다.`)}catch(e){alert(e.message)}}
function mapRow(r,i){const get=(...keys)=>{const key=Object.keys(r).find(k=>keys.some(x=>k.toLowerCase().replace(/\s/g,'')===x));return key?r[key]:''};const shape=String(get('형상','제품형상','shape')).toLowerCase(),lay=String(get('눕힘허용','눕혀서적재가능','회전허용','rotation')).toLowerCase();const p={name:get('제품명','name','product'),group:get('제품군','group','category')||'기타',shape:shape==='원통형'||shape==='cylinder'?'cylinder':'box',l:+get('길이','길이(mm)','length','length(mm)'),w:+get('너비','폭','너비(mm)','width','width(mm)'),h:+get('높이','높이(mm)','height','height(mm)'),weight:+get('중량','중량(kg)','weight','weight(kg)'),qty:+get('수량','qty','quantity')||1,rotate:lay!=='no',fragile:String(get('상부적재금지','fragile')).toLowerCase()==='yes',id:Date.now()+i,color:COLORS[i%COLORS.length]};return p.name&&p.l&&p.w&&p.h&&p.weight?p:null}
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),heads=splitCSV(lines.shift());return lines.map(line=>{const vals=splitCSV(line),o={};heads.forEach((h,i)=>o[h.trim()]=vals[i]?.trim()||'');return o})}
function splitCSV(line){let out=[],cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'&&line[i+1]==='"'){cur+='"';i++}else if(ch==='"')q=!q;else if(ch===','&&!q){out.push(cur);cur=''}else cur+=ch}out.push(cur);return out}
function downloadTemplate(){download('loadspace-template.csv','\uFEFF제품명,제품군,형상,길이(mm),너비(mm),높이(mm),중량(kg),수량,눕힘허용,상부적재금지\n산업용 펌프,기계류,박스형,1200,800,900,420,4,yes,no\n케이블 드럼,부품,원통형,900,900,700,310,6,no,no')}
function exportPlan(){
  if(!result)return;
  if(typeof XLSX==='undefined'){alert('Excel 내보내기 모듈을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');return}
  const loads=shipment?shipment.containers:[result],plan=[],summary=[],securing=[];
  loads.forEach((load,i)=>{
    summary.push({'컨테이너 번호':i+1,'컨테이너 규격':load.container.name,'적재 수량':load.placed.length,'총 중량(kg)':load.totalWeight,'공간 활용률(%)':Number(load.volumeRate.toFixed(1)),'중량 활용률(%)':Number(load.weightRate.toFixed(1))});
    load.placed.forEach(p=>plan.push({'컨테이너 번호':i+1,'컨테이너 규격':load.container.name,'적재 순서':p.order,'제품명':p.name,'제품군':p.group,'제품 번호':p.unit,'제품 형상':p.shape==='cylinder'?'원통형':'박스형','문에서 안쪽 X(mm)':p.x,'좌측에서 우측 Y(mm)':p.y,'바닥에서 위 Z(mm)':p.z,'배치 길이(mm)':p.l,'배치 너비(mm)':p.w,'배치 높이(mm)':p.h,'개당 중량(kg)':p.weight}));
    const fixed=[...(load.securing?.dunnage||[]),...(load.securing?.airbags||[])];fixed.forEach((f,n)=>securing.push({'컨테이너 번호':i+1,'번호':n+1,'고정재':f.type==='dunnage'?'부목':'에어백','추천 위치':f.location||'화물 간극','관련 제품':f.product||'','X(mm)':Math.round(f.x),'Y(mm)':Math.round(f.y),'Z(mm)':Math.round(f.z),'길이(mm)':Math.round(f.l),'너비(mm)':Math.round(f.w),'높이(mm)':Math.round(f.h)}));
  });
  const productRows=products.map(p=>({'제품명':p.name,'제품군':p.group,'제품 형상':p.shape==='cylinder'?'원통형':'박스형','수량':p.qty,'길이(mm)':p.l,'너비(mm)':p.w,'높이(mm)':p.h,'개당 중량(kg)':p.weight,'눕힘 허용':p.rotate?'예':'아니오','상부 적재 금지':p.fragile?'예':'아니오'}));
  const wb=XLSX.utils.book_new();
  [['요약',summary],['적재계획',plan],['제품목록',productRows],['고정재',securing]].forEach(([name,rows])=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'내용':'해당 항목 없음'}]);ws['!cols']=Object.keys(rows[0]||{'내용':''}).map(k=>({wch:Math.max(12,Math.min(28,k.length*2+4))}));XLSX.utils.book_append_sheet(wb,ws,name)});
  XLSX.writeFile(wb,'loadspace-loading-plan.xlsx');
}
function csvCell(v){v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
init();
