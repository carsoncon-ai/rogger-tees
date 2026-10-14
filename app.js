/* Rogger Studio app: customer design studio + Business HQ. All data goes through window.api (api.js). */

/* ================= helpers ================= */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const uid=()=>Math.random().toString(36).slice(2,9);
const pref={get(k,d){try{const v=localStorage.getItem('rtp_'+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem('rtp_'+k,JSON.stringify(v))}catch(e){}}};
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),3000)};
const oops=e=>{console.error(e);toast(e?.message||'Something went wrong')};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+(+n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const money0=n=>'$'+Math.round(+n||0).toLocaleString();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtDate=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const fmtDT=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const debounce=(fn,ms=600)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
function isLight(hex){const n=parseInt((hex||'#fff').slice(1),16);return ((n>>16)*299+((n>>8)&255)*587+(n&255)*114)/1000>150}
const CLOUD=api.mode==='cloud';

const ALL_SIZES=['YS','YM','YL','XS','S','M','L','XL','2XL','3XL','4XL','5XL','OS'];
const STATUSES=['Pending','Approved','Declined','Production','Ready','Completed'];
const SLABEL={Pending:'Needs review',Approved:'Approved',Declined:'Declined',Production:'In production',Ready:'Ready',Completed:'Completed'};
const NEXT={Approved:'Production',Production:'Ready',Ready:'Completed'};
const NEXT_LABEL={Approved:'Start production',Production:'Mark ready',Ready:'Mark completed'};
const PAYABLE=['Approved','Production','Ready','Completed'];
const DECLINE_REASONS=['Artwork resolution too low to print','Design uses copyrighted or trademarked material','Below minimum quantity','Design extends outside the print area','Colors/details not printable as submitted','Need-by date is too soon'];

/* ================= state ================= */
let shop=null, products=[], orders=[], isOwner=false, user=null;
const P=id=>products.find(p=>p.id===id);
const activeProducts=()=>products.filter(p=>p.active);
const oid=o=>'#'+o.number;
const balance=o=>o.paid?0:Math.max(0,Math.round((o.total-(o.amountPaid||0))*100)/100);
const orderLink=o=>`${api.siteUrl}?${CLOUD?`shop=${encodeURIComponent(shop.slug)}&`:''}order=${o.token}`;
const shopLink=()=>CLOUD?`${api.siteUrl}?shop=${encodeURIComponent(shop.slug)}`:api.siteUrl;

/* ================= pricing (display; the server recalculates in cloud mode) ================= */
function tierOff(q){let off=0;(shop.tiers||[]).slice().sort((a,b)=>a.min-b.min).forEach(t=>{if(q>=t.min)off=t.off});return off}
function quote(d,sizes={},due){
  const p=P(d.productId);
  if(!p)return {unit:0,total:0,qty:0,locs:0,sub:0,up:0,rush:0,tax:0,off:0,base:0,deposit:0,cost:0,extraEls:0};
  const locs=Math.max(1,['front','back'].filter(s=>d.layers.some(l=>l.side===s)).length);
  const extraEls=Math.max(0,d.layers.length-locs);
  const base=p.price+(locs-1)*p.extraLoc+extraEls*p.extraEl;
  const qty=Object.values(sizes).reduce((a,b)=>a+(+b||0),0);
  const off=tierOff(qty), unit=Math.round(base*(1-off/100)*100)/100;
  let sub=0,up=0;
  Object.entries(sizes).forEach(([s,n])=>{n=+n||0;sub+=unit*n;up+=(p.upcharge?.[s]||0)*n});
  const days=due?(new Date(due+'T00:00')-new Date(new Date().toDateString()))/864e5:99;
  const rush=days<7&&shop.rush?(sub+up)*shop.rush/100:0;
  const tax=(sub+up+rush)*(shop.tax||0)/100;
  const total=Math.round((sub+up+rush+tax)*100)/100;
  return {base,unit,off,qty,locs,extraEls,sub,up,rush,tax,total,deposit:depositOf(total),cost:qty*(p.cost||0)};
}
const depositOf=total=>shop.deposit>0&&shop.deposit<100?Math.round(total*shop.deposit)/100:0;

/* ================= mockups ================= */
function colorOf(d){const p=P(d.productId);return p?.colors.find(c=>c.id===d.colorId)||p?.colors[0]}
let side='front', sel=null, guide=true;
function mockHTML(d,sd,interactive){
  const p=P(d.productId);
  if(!p)return '<div class="nomock">Preview unavailable</div>';
  const c=colorOf(d)||{hex:'#ffffff'}, photo=c[sd], src=photo||p.images[sd]||p.images.front;
  if(!src)return '<div class="nomock">No image</div>';
  const tint=photo?'':`<div class="tint" style="--m:url('${src}');background:${c.hex}"></div>`;
  const pa=p.print[sd]||p.print.front, light=isLight(c.hex);
  const ls=d.layers.filter(l=>l.side===sd).map(l=>layerHTML(l,interactive)).join('');
  return `<img class="base" src="${src}" alt="">${tint}<div class="print ${interactive&&guide?'guide':''} ${light?'darkguide':''}" style="left:${pa[0]}%;top:${pa[1]}%;width:${pa[2]}%;height:${pa[3]}%" data-print>${ls}${interactive&&!ls?`<div class="empty-hint" style="color:${light?'#0007':'#fff8'}">Drop artwork here</div>`:''}</div>`;
}
function layerHTML(l,interactive){
  const st=`left:${l.x}%;top:${l.y}%;width:${l.type==='img'?l.w+'%':'auto'};transform:translate(-50%,-50%) rotate(${l.rot||0}deg)`;
  const inner=l.type==='img'?`<img src="${esc(l.src)}">`:`<div class="txt" style="font-family:'${esc(l.font)}',serif;font-size:${+l.size}cqw;color:${esc(l.color)};letter-spacing:${+l.ls||0}em;${l.stroke?`-webkit-text-stroke:${l.size/14}cqw ${esc(l.stroke)};paint-order:stroke fill`:''}">${esc(l.text)}</div>`;
  return `<div class="layer ${interactive&&sel===l.id?'sel':''}" data-id="${l.id}" style="${st}">${inner}${interactive?'<div class="h"></div><div class="r"></div>':''}</div>`;
}
const mockBox=(d,sd,cls='')=>`<div class="mock ${cls}">${mockHTML(d,sd)}</div>`;
const hasBack=p=>!!(p&&p.images.back);
const pair=d=>`<div class="pvpair">${mockBox(d,'front')}${hasBack(P(d.productId))?mockBox(d,'back'):''}</div>`;

/* ================= views & branding ================= */
function showView(v){
  ['landing','auth','client','admin'].forEach(x=>$('#'+x).classList.toggle('on',x===v));
  const studio=v==='client';
  $('#steps').style.visibility=studio?'visible':'hidden';
  $('#prodName').hidden=!studio;
  $('#modeToggle').hidden=!(isOwner&&(v==='client'||v==='admin'));
  $$('#modeToggle button').forEach(b=>b.classList.toggle('on',b.dataset.mode===(v==='admin'?'admin':'client')));
  $('#acctBtn').hidden=!(CLOUD&&user&&(v==='admin'||v==='auth'));
  $('#ownerLink').hidden=!(CLOUD&&v==='landing'&&!user);
  if(v!=='admin')closeDrawer();
  $('#boot').hidden=true;
}
function applyBrand(){
  const s=shop||{name:'Rogger Studio',logo:'assets/logo.png',accent:'#ffffff'};
  const r=document.documentElement.style;
  r.setProperty('--accent',s.accent);r.setProperty('--accent-ink',isLight(s.accent)?'#0b0b0d':'#ffffff');
  $('#brandLogo').src=s.logo||'';$('#brandLogo').hidden=!s.logo;
  $('#brandName').textContent=s.logo?'':s.name;
  document.title=s.name+(shop?' — Design Studio':'');
}

/* ================= STUDIO ================= */
const INK=['#ffffff','#111111','#c8102e','#1f3a93','#d4af37','#2e7d32','#6b1f2a','#7fb2e0','#f1b8c8','#5a2d82'];
const FONTS=[['Graduate','Varsity'],['Oswald','Block'],['Playfair Display','Serif'],['Noto Serif','Greek'],['Bebas Neue','Condensed'],['Permanent Marker','Marker']];
const GREEK='Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω'.split(' ');
const ORGS=['ΑΣΦ','ΧΦ','ΣΧ','ΦΔΘ','ΚΣ','ΣΑΕ','ΠΚΑ','ΘΧ','ΔΤΔ','ΣΝ','ΚΑ','ΦΚΨ','ΑΤΩ','ΒΘΠ','ΚΔ','ΑΧΩ','ΔΓ','ΧΩ','ΑΦ','ΚΚΓ'];
const QUICK=['FALL RUSH','BID DAY','PARENTS WEEKEND','FORMAL 2026','PHILANTHROPY','EST. 1909','BROTHERHOOD','SISTERHOOD'];

let design=null, hist=[], font='Graduate', lib=pref.get('lib',[]), editingOrder=null;
const draftKey=()=>'draft_'+(shop?.id||'x');
function freshDesign(){const p=activeProducts()[0]||products[0];return{productId:p?.id,colorId:p?.colors[0]?.id,layers:[]}}
function loadDraft(){design=pref.get(draftKey(),null);if(!design||!P(design.productId)?.active)design=freshDesign()}

function renderStudio(){
  const p=P(design.productId);
  if(!p||!hasBack(p))side='front';
  $('#stageMock').innerHTML=p?mockHTML(design,side,true):'<div class="nomock">This shop has no products yet.</div>';
  bindPrint();renderLayers();renderProps();renderPrice();
  $('#sideBtns').innerHTML=['front','back'].filter(s=>s==='front'||hasBack(p)).map(s=>`<button class="${s===side?'on':''}" data-side="${s}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('');
  $$('#sideBtns button').forEach(b=>b.onclick=()=>{side=b.dataset.side;sel=null;renderStudio()});
  const n=design.layers.length;
  $('#status').textContent=n?`${n} element${n>1?'s':''}`:'';
  $('#prodName').textContent=p?.name||'';
  pref.set(draftKey(),design);
}
function renderCatalog(){
  const list=activeProducts(), maxOff=Math.max(0,...(shop.tiers||[]).map(t=>t.off));
  $('#pcards').innerHTML=list.length?list.map(p=>`<button class="pcard ${p.id===design.productId?'on':''}" data-p="${p.id}">${mockBox({productId:p.id,colorId:p.id===design.productId?design.colorId:p.colors[0]?.id,layers:[]},'front')}<b>${esc(p.name)}</b><span>from ${money(p.price*(1-maxOff/100))}</span></button>`).join(''):'<p class="hint">No products available yet.</p>';
  $$('#pcards .pcard').forEach(b=>b.onclick=()=>{const np=P(b.dataset.p);commit();design.productId=np.id;if(!np.colors.find(c=>c.id===design.colorId))design.colorId=np.colors[0]?.id;renderCatalog();renderStudio()});
  const p=P(design.productId);
  $('#colors').innerHTML=(p?.colors||[]).map(c=>`<div class="sw ${c.id===design.colorId?'on':''}" style="background:${esc(c.hex)}" data-c="${esc(c.id)}" title="${esc(c.name)}"></div>`).join('');
  $('#colorName').textContent=colorOf(design)?.name||'';
  $$('#colors .sw').forEach(s=>s.onclick=()=>{design.colorId=s.dataset.c;renderCatalog();renderStudio()});
  $('#prodInfo').innerHTML=p?`Sizes ${p.sizes.join(', ')} · Minimum ${p.minQty} pcs<br>Turnaround: ${esc(shop.turnaround)}`:'';
}
function commit(){hist.push(JSON.stringify(design));if(hist.length>60)hist.shift()}

function bindPrint(){
  const pa=$('#stageMock [data-print]'); if(!pa)return;
  pa.addEventListener('dragover',e=>{e.preventDefault();pa.classList.add('over')});
  pa.addEventListener('dragleave',()=>pa.classList.remove('over'));
  pa.addEventListener('drop',e=>{
    e.preventDefault();pa.classList.remove('over');
    const r=pa.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(e.clientY-r.top)/r.height*100;
    const libId=e.dataTransfer.getData('text/lib');
    if(libId){const it=lib.find(i=>i.id===libId);if(it)addImage(it.src,x,y);return}
    [...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')).forEach(f=>readImg(f).then(src=>{addToLib(src,f.name);addImage(src,x,y)}));
  });
  pa.addEventListener('pointerdown',e=>{if(e.target===pa||e.target.classList.contains('empty-hint')){sel=null;renderStudio()}});
  pa.querySelectorAll('.layer').forEach(el=>el.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    const l=design.layers.find(x=>x.id===el.dataset.id);if(!l)return;
    if(sel!==l.id){sel=l.id;renderStudio();return startDrag(e,$(`#stageMock .layer[data-id="${l.id}"]`),l)}
    startDrag(e,el,l);
  }));
}
function startDrag(e,el,l){
  const r=$('#stageMock [data-print]').getBoundingClientRect();
  const mode=e.target.classList.contains('h')?'resize':e.target.classList.contains('r')?'rotate':'move';
  commit();
  const sx=e.clientX,sy=e.clientY,o={...l},er=el.getBoundingClientRect(),cx=er.left+er.width/2,cy=er.top+er.height/2,d0=Math.hypot(sx-cx,sy-cy)||1;
  const mv=ev=>{
    if(mode==='move'){l.x=clamp(o.x+(ev.clientX-sx)/r.width*100,-10,110);l.y=clamp(o.y+(ev.clientY-sy)/r.height*100,-10,110)}
    else if(mode==='resize'){const k=Math.hypot(ev.clientX-cx,ev.clientY-cy)/d0;if(l.type==='img')l.w=clamp(o.w*k,5,140);else l.size=clamp(o.size*k,2,60)}
    else{let a=Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI+90;if(Math.abs(a%45)<4||Math.abs(a%45)>41)a=Math.round(a/45)*45;l.rot=Math.round(a)}
    el.style.left=l.x+'%';el.style.top=l.y+'%';el.style.transform=`translate(-50%,-50%) rotate(${l.rot||0}deg)`;
    if(l.type==='img')el.style.width=l.w+'%';else el.firstChild.style.fontSize=l.size+'cqw';
  };
  const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);renderStudio()};
  addEventListener('pointermove',mv);addEventListener('pointerup',up);
}

/* image reading: downscale, optional white-background removal → data URL */
function readImg(f,{max=1400,removeBg=false}={}){
  return new Promise((res,rej)=>{
    if(f.size>15e6)return rej(new Error('That image is over 15 MB'));
    const fr=new FileReader();
    fr.onload=()=>{
      if(f.type==='image/svg+xml'&&!removeBg)return res(fr.result);
      const im=new Image();im.onerror=()=>rej(new Error('Could not read that image'));im.onload=()=>{
        const s=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);
        const x=c.getContext('2d');x.drawImage(im,0,0,c.width,c.height);
        if(removeBg)knockOutBg(x,c.width,c.height);
        res(c.toDataURL('image/webp',.88));
      };im.src=fr.result;
    };fr.readAsDataURL(f);
  });
}
function knockOutBg(ctx,w,h,thr=30){
  const id=ctx.getImageData(0,0,w,h),d=id.data,seen=new Uint8Array(w*h),st=[];
  const bg=[d[0],d[1],d[2]];
  const near=i=>Math.abs(d[i]-bg[0])<thr&&Math.abs(d[i+1]-bg[1])<thr&&Math.abs(d[i+2]-bg[2])<thr;
  for(let x=0;x<w;x++){st.push(x,(h-1)*w+x)}for(let y=0;y<h;y++){st.push(y*w,y*w+w-1)}
  while(st.length){const p=st.pop();if(seen[p])continue;seen[p]=1;const i=p*4;if(!near(i))continue;d[i+3]=0;const x=p%w,y=(p/w)|0;
    if(x>0)st.push(p-1);if(x<w-1)st.push(p+1);if(y>0)st.push(p-w);if(y<h-1)st.push(p+w)}
  ctx.putImageData(id,0,0);
}
function addToLib(src,name){lib.unshift({id:uid(),src,name});lib=lib.slice(0,12);pref.set('lib',lib);renderLib()}
function addImage(src,x=50,y=40){commit();const l={id:uid(),type:'img',src,x,y,w:70,rot:0,side};design.layers.push(l);sel=l.id;renderStudio()}
function addText(text,f=font,extra={}){if(!text.trim())return;commit();const light=isLight(colorOf(design)?.hex);const l={id:uid(),type:'text',text,font:f,size:text.length>10?9:16,color:light?'#111111':'#ffffff',x:50,y:30,rot:0,ls:.04,side,...extra};design.layers.push(l);sel=l.id;renderStudio()}
const addFiles=files=>[...files].filter(f=>f.type.startsWith('image/')).forEach((f,i)=>readImg(f).then(src=>{addToLib(src,f.name);if(i===0)addImage(src)}).catch(oops));

function renderLib(){
  $('#lib').innerHTML=lib.length?lib.map(i=>`<div class="tile checker" draggable="true" data-id="${i.id}" title="${esc(i.name)}"><img src="${i.src}"><button class="x" data-del="${i.id}">✕</button></div>`).join(''):'<p class="hint" style="grid-column:span 2">Uploads land here. Drag them onto the product or click to add.</p>';
  $$('#lib .tile').forEach(t=>{
    t.addEventListener('dragstart',e=>e.dataTransfer.setData('text/lib',t.dataset.id));
    t.addEventListener('click',e=>{if(e.target.dataset.del){lib=lib.filter(i=>i.id!==e.target.dataset.del);pref.set('lib',lib);renderLib();return}addImage(lib.find(i=>i.id===t.dataset.id).src)});
  });
}
const drop=$('#drop');
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,()=>drop.classList.remove('over')));
drop.addEventListener('drop',e=>{e.preventDefault();addFiles(e.dataTransfer.files)});
$('#file').addEventListener('change',e=>{addFiles(e.target.files);e.target.value=''});

$('#fontList').innerHTML=FONTS.map(([f,n])=>`<button data-f="${f}" style="font-family:'${f}'">${n}</button>`).join('');
$$('#fontList button').forEach(b=>b.onclick=()=>{font=b.dataset.f;$$('#fontList button').forEach(x=>x.classList.toggle('on',x===b));const l=cur();if(l&&l.type==='text'){commit();l.font=font;renderStudio()}});
$('#fontList button').classList.add('on');
$('#addText').onclick=()=>addText($('#textIn').value);
$('#textIn').onkeydown=e=>{if(e.key==='Enter')addText(e.target.value)};
$('#quickText').innerHTML=QUICK.map(q=>`<button class="chip plain">${q}</button>`).join('');
$$('#quickText .chip').forEach(c=>c.onclick=()=>addText(c.textContent));
$('#greekGrid').innerHTML=GREEK.map(g=>`<button>${g}</button>`).join('');
$$('#greekGrid button').forEach(b=>b.onclick=()=>{$('#greekIn').value+=b.textContent});
$('#greekClr').onclick=()=>$('#greekIn').value='';
$('#addGreek').onclick=()=>addText($('#greekIn').value,'Noto Serif',{size:24,ls:.08});
$('#orgs').innerHTML=ORGS.map(o=>`<button class="chip">${o}</button>`).join('');
$$('#orgs .chip').forEach(c=>c.onclick=()=>addText(c.textContent,'Noto Serif',{size:24,ls:.08}));
$$('#client .rail button[data-pane]').forEach(b=>b.onclick=()=>{$$('#client .rail button[data-pane]').forEach(x=>x.classList.toggle('on',x===b));$$('.pane').forEach(p=>p.classList.toggle('on',p.id==='pane-'+b.dataset.pane))});

const cur=()=>design.layers.find(l=>l.id===sel);
function renderLayers(){
  const ls=design.layers.filter(l=>l.side===side);
  $('#layerList').innerHTML=ls.length?ls.slice().reverse().map(l=>`<div class="li ${sel===l.id?'on':''}" data-id="${l.id}"><div class="th">${l.type==='img'?`<img src="${esc(l.src)}">`:esc(l.text.slice(0,3))}</div><span>${l.type==='img'?'Artwork':esc(l.text)}</span><button data-del="${l.id}" class="muted">✕</button></div>`).join(''):`<p class="hint">Nothing on the ${side} yet.</p>`;
  $$('#layerList .li').forEach(li=>li.onclick=e=>{if(e.target.dataset.del){commit();design.layers=design.layers.filter(l=>l.id!==e.target.dataset.del);sel=null}else sel=li.dataset.id;renderStudio()});
}
function renderProps(){
  const l=cur(),box=$('#propBox');
  if(!l){box.innerHTML='<p class="hint">Select an element to edit it. Drag to move, corner to resize, top dot to rotate.</p>';return}
  let h='';
  if(l.type==='text'){
    h+=`<h3 class="sec">Text</h3><div class="field"><input id="pText" value="${esc(l.text)}" maxlength="80"></div>
    <div class="field"><label>Color</label><div class="swatches">${INK.map(c=>`<div class="sw ${l.color===c?'on':''}" data-ink="${c}" style="background:${c};width:24px;height:24px"></div>`).join('')}</div></div>
    <div class="field"><label>Outline</label><div class="swatches"><div class="sw ${!l.stroke?'on':''}" data-st="" style="width:24px;height:24px;background:linear-gradient(135deg,transparent 45%,#e44 45% 55%,transparent 55%)"></div>${INK.slice(0,6).map(c=>`<div class="sw ${l.stroke===c?'on':''}" data-st="${c}" style="background:${c};width:24px;height:24px"></div>`).join('')}</div></div>
    <div class="field"><label>Size</label><input type="range" min="2" max="60" step=".5" value="${l.size}" id="pSize"></div>
    <div class="field"><label>Letter spacing</label><input type="range" min="-.05" max=".5" step=".01" value="${l.ls||0}" id="pLs"></div>`;
  }else h+=`<h3 class="sec">Artwork</h3><div class="field"><label>Width</label><input type="range" min="5" max="140" value="${l.w}" id="pW"></div>`;
  h+=`<div class="field"><label>Rotation · ${l.rot||0}°</label><input type="range" min="-180" max="180" value="${l.rot||0}" id="pRot"></div>
  <div class="row" style="flex-wrap:wrap"><button class="btn sm" id="pDup">Duplicate</button><button class="btn sm" id="pFront">Bring forward</button><button class="btn sm bad" id="pDel">Delete</button></div>`;
  box.innerHTML=h;
  const live=(id,fn)=>{const el=$(id);if(!el)return;el.onpointerdown=commit;el.oninput=e=>{fn(e.target.value);$('#stageMock').innerHTML=mockHTML(design,side,true);bindPrint();renderLayers()}};
  live('#pText',v=>l.text=v);$('#pText')?.addEventListener('focus',commit);
  live('#pSize',v=>l.size=+v);live('#pLs',v=>l.ls=+v);live('#pW',v=>l.w=+v);live('#pRot',v=>l.rot=+v);
  $$('[data-ink]').forEach(s=>s.onclick=()=>{commit();l.color=s.dataset.ink;renderStudio()});
  $$('[data-st]').forEach(s=>s.onclick=()=>{commit();l.stroke=s.dataset.st;renderStudio()});
  $('#pDel').onclick=()=>{commit();design.layers=design.layers.filter(x=>x.id!==l.id);sel=null;renderStudio()};
  $('#pDup').onclick=()=>{commit();const c={...l,id:uid(),x:l.x+4,y:l.y+4};design.layers.push(c);sel=c.id;renderStudio()};
  $('#pFront').onclick=()=>{commit();design.layers.splice(design.layers.indexOf(l),1);design.layers.push(l);renderStudio()};
}
function renderPrice(){
  const p=P(design.productId);if(!p)return;
  const q=quote(design,{M:p.minQty});
  $('#unitPrice').textContent=money(q.base);
  $('#priceNote').textContent=`${p.name} · ${q.locs} print location${q.locs===1?'':'s'}${q.extraEls?` · ${q.extraEls} extra element${q.extraEls>1?'s':''}`:''}`;
  const tiers=(shop.tiers||[]).slice().sort((a,b)=>a.min-b.min).filter(t=>t.off>0);
  $('#tierTable').innerHTML=tiers.length?`<tr><td class="muted">Quantity</td><td class="muted">Each</td></tr>`+tiers.map(t=>`<tr><td>${t.min}+ pcs</td><td>${money(q.base*(1-t.off/100))}</td></tr>`).join(''):'';
}

$('#undo').onclick=()=>{const p=hist.pop();if(p){design=JSON.parse(p);sel=null;renderCatalog();renderStudio()}};
$('#guideBtn').onclick=()=>{guide=!guide;renderStudio()};
$('#centerBtn').onclick=()=>{const l=cur();if(l){commit();l.x=50;renderStudio()}};
$('#clearBtn').onclick=()=>{if(!design.layers.length)return;commit();design.layers=[];sel=null;editingOrder=null;renderStudio();toast('Cleared — undo to bring it back')};
addEventListener('keydown',e=>{
  if(!$('#client').classList.contains('on')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||$('.modal.on'))return;
  const l=cur();
  if((e.key==='Delete'||e.key==='Backspace')&&l){commit();design.layers=design.layers.filter(x=>x!==l);sel=null;renderStudio()}
  if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();$('#undo').click()}
  if(l&&e.key.startsWith('Arrow')){e.preventDefault();const s=e.shiftKey?2:.5;if(e.key==='ArrowLeft')l.x-=s;if(e.key==='ArrowRight')l.x+=s;if(e.key==='ArrowUp')l.y-=s;if(e.key==='ArrowDown')l.y+=s;renderStudio()}
});

/* ================= ordering ================= */
function setStep(n){$$('.step').forEach((s,i)=>{s.classList.toggle('done',i<n);s.classList.toggle('on',i===n);s.querySelector('i').textContent=i<n?'✓':i+1})}
const readSizes=()=>{const o={};$$('[data-size]').forEach(i=>{if(+i.value>0)o[i.dataset.size]=Math.floor(+i.value)});return o};
function breakdownHTML(q,p){
  return `<div class="l"><span>${q.qty} pcs × ${money(q.unit)}${q.off?` <span class="muted">(${q.off}% volume discount)</span>`:''}</span><span>${money(q.sub)}</span></div>
  ${q.up?`<div class="l"><span>Size upcharges</span><span>${money(q.up)}</span></div>`:''}
  ${q.rush?`<div class="l"><span>Rush fee (${shop.rush}%)</span><span>${money(q.rush)}</span></div>`:''}
  ${q.tax?`<div class="l"><span>Tax (${shop.tax}%)</span><span>${money(q.tax)}</span></div>`:''}
  <div class="l t"><span>Estimated total</span><span>${money(q.total)}</span></div>
  ${q.deposit?`<div class="l muted"><span>Deposit due after approval (${shop.deposit}%)</span><span>${money(q.deposit)}</span></div>`:''}
  ${p&&q.qty<p.minQty?`<div class="l" style="color:var(--bad)"><span>Minimum order is ${p.minQty} pieces</span></div>`:''}`;
}
function updOrderModal(){const p=P(design.productId),q=quote(design,readSizes(),$('#oDate').value);$('#omBreak').innerHTML=breakdownHTML(q,p);$('#mSubmit').disabled=q.qty<p.minQty}
$('#nextBtn').onclick=()=>{
  if(!design.layers.length)return toast('Add a design first');
  const p=P(design.productId),prev=editingOrder;
  $('#sizeIn').innerHTML=p.sizes.map(s=>`<div><label>${s}${p.upcharge?.[s]?` +$${p.upcharge[s]}`:''}</label><input type="number" min="0" value="${prev?.sizes?.[s]??(s==='M'||s==='L'?Math.ceil(p.minQty/2):0)}" data-size="${s}"></div>`).join('');
  $$('[data-size]').forEach(i=>i.oninput=updOrderModal);
  const me=prev?.customer||pref.get('me',{});
  $('#oOrg').value=me.org||'';$('#oName').value=me.name||'';$('#oEmail').value=me.email||'';$('#oPhone').value=me.phone||'';
  if(prev){$('#oTitle').value=prev.title;$('#oDate').value=prev.due||''}
  $('#omSub').textContent=prev?`Resubmitting order ${oid(prev)} with your changes.`:`Tell ${shop.name} who it's for and how many. Every design is reviewed before anything prints — you'll pay after it's approved.`;
  setStep(2);updOrderModal();$('#orderModal').classList.add('on');
};
$('#oDate').oninput=updOrderModal;
$('#mCancel').onclick=()=>{setStep(1);$('#orderModal').classList.remove('on')};
$('#mSubmit').onclick=async()=>{
  const sizes=readSizes(),due=$('#oDate').value,q=quote(design,sizes,due),p=P(design.productId);
  const customer={org:$('#oOrg').value.trim(),name:$('#oName').value.trim(),email:$('#oEmail').value.trim(),phone:$('#oPhone').value.trim()};
  if(!customer.org||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email))return toast('Add your organization and a valid email');
  if(q.qty<p.minQty)return toast(`Minimum order is ${p.minQty} pieces`);
  const btn=$('#mSubmit');btn.disabled=true;btn.textContent='Submitting…';
  try{
    const d=JSON.parse(JSON.stringify(design));
    for(const l of d.layers)if(l.type==='img')l.src=await api.uploadImage(l.src,'art');
    const res=await api.submitOrder(shop,{productId:p.id,design:d,sizes,customer,title:$('#oTitle').value.trim()||'Untitled design',due,notes:$('#oNotes').value.trim(),
      revisionOf:editingOrder?.id||null,qty:q.qty,unit:q.unit,total:q.total,cost:q.cost,productName:p.name,colorName:colorOf(design)?.name});
    pref.set('me',customer);
    api.notify('submitted',{token:res.token});
    $('#orderModal').classList.remove('on');setStep(3);editingOrder=null;
    if(isOwner)await reloadOwner();
    showSubmitted(res,customer.email);
  }catch(e){oops(e)}finally{btn.disabled=false;btn.textContent='Submit for review'}
};
function showSubmitted(res,email){
  const link=`${api.siteUrl}?${CLOUD?`shop=${encodeURIComponent(shop.slug)}&`:''}order=${res.token}`;
  $('#statusCard').innerHTML=`<h2>Order #${res.number} submitted 🎉</h2>
    <p class="muted" style="margin:6px 0 16px">${esc(shop.name)} will review your design. ${CLOUD?`We emailed a receipt to <b style="color:var(--text)">${esc(email)}</b>. `:''}Estimated total: <b style="color:var(--text)">${money(res.total)}</b>.</p>
    <div class="field"><label>Your order link — use it to check status and pay once approved</label><div class="copybox"><input readonly value="${esc(link)}" id="lnk"><button class="btn sm" id="cpy">Copy</button></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="doneOk">Done</button></div>`;
  $('#cpy').onclick=()=>copy(link);$('#doneOk').onclick=()=>{$('#statusModal').classList.remove('on');setStep(1)};
  $('#statusModal').classList.add('on');
}
const copy=t=>navigator.clipboard?.writeText(t).then(()=>toast('Copied'),()=>toast(t));

/* order status page (customer) */
async function openStatus(token,justPaid){
  $('#statusCard').innerHTML='<p class="muted">Loading order…</p>';$('#statusModal').classList.add('on');
  try{
    let o=await api.orderByToken(token);
    if(!o){$('#statusCard').innerHTML='<h2>Order not found</h2><p class="muted">Check the link and try again.</p>';return}
    if(justPaid&&!o.paid&&!o.amountPaid){await new Promise(r=>setTimeout(r,2500));o=await api.orderByToken(token)}
    const bal=balance(o),canPay=CLOUD&&PAYABLE.includes(o.status)&&bal>0&&shop.stripeReady;
    const payAmt=(o.amountPaid||0)===0&&depositOf(o.total)?depositOf(o.total):bal;
    $('#statusCard').innerHTML=`
      <div class="row" style="justify-content:space-between"><h2>${esc(o.title)} <span class="muted">#${o.number}</span></h2><span class="badge ${o.status}">${SLABEL[o.status]}</span></div>
      <p class="muted" style="margin:4px 0 14px">${esc(o.productName)} · ${esc(o.colorName||'')} · ${o.qty} pcs · submitted ${fmtDate(o.at)}${o.due?` · needed by ${o.due}`:''}</p>
      ${justPaid?`<div class="notice good" style="margin-bottom:12px">Payment received — thank you! ${o.amountPaid?'':'It can take a minute to show here.'}</div>`:''}
      ${o.status==='Declined'?`<div class="notice" style="margin-bottom:12px"><b>Why it was declined:</b> ${esc(o.declineReason||'')}</div>`:''}
      ${o.status==='Pending'?`<div class="notice" style="margin-bottom:12px">${esc(shop.name)} is reviewing your design. You'll get an email when it's approved.</div>`:''}
      ${o.message?`<div class="box" style="padding:12px"><b>Message from ${esc(shop.name)}:</b> ${esc(o.message)}</div>`:''}
      ${pair(o.design)}
      <div class="breakdown" style="margin-top:14px">
        <div class="l"><span>Sizes</span><span>${Object.entries(o.sizes).map(([k,v])=>`${k} ${v}`).join(' · ')}</span></div>
        <div class="l t"><span>Order total</span><span>${money(o.total)}</span></div>
        <div class="l"><span>Paid</span><span>${money(o.paid?o.total:o.amountPaid)}</span></div>
        <div class="l"><span>Balance</span><span>${money(bal)}</span></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px;flex-wrap:wrap">
        ${o.status==='Declined'?`<button class="btn" id="stFix">Edit & resubmit</button>`:''}
        ${PAYABLE.includes(o.status)&&bal>0&&!canPay?`<span class="muted" style="font-size:12px">${esc(shop.name)} will send payment details.</span>`:''}
        ${canPay?`<button class="btn primary" id="stPay">${payAmt<bal?`Pay ${shop.deposit}% deposit · ${money(payAmt)}`:`Pay ${money(bal)}`}</button>`:''}
        <button class="btn" id="stClose">Close</button>
      </div>`;
    $('#stClose').onclick=()=>$('#statusModal').classList.remove('on');
    $('#stFix')&&($('#stFix').onclick=()=>{if(!P(o.design.productId))return toast('That product is no longer offered');design=JSON.parse(JSON.stringify(o.design));editingOrder=o;sel=null;side='front';$('#statusModal').classList.remove('on');$('#myModal').classList.remove('on');renderCatalog();renderStudio();toast('Make your changes, then continue to resubmit')});
    $('#stPay')&&($('#stPay').onclick=async e=>{e.target.disabled=true;e.target.textContent='Opening secure checkout…';try{location.href=await api.checkout(o.token)}catch(err){oops(err);e.target.disabled=false}});
  }catch(e){oops(e)}
}

/* my orders (customer) */
$('#myOrdersBtn').onclick=()=>{$('#myModal').classList.add('on');renderMy()};
async function renderMy(step){
  const c=$('#myCard'),me=pref.get('me',{});
  const head=`<div class="row" style="justify-content:space-between"><h2>My orders</h2><button class="btn sm" id="myClose">Close</button></div>`;
  const bindClose=()=>$('#myClose').onclick=()=>$('#myModal').classList.remove('on');
  // cloud: prove you own the email with a one-time code
  if(CLOUD&&!user?.email){
    if(step!=='code'){
      c.innerHTML=head+`<p class="muted" style="margin:4px 0 14px">Enter the email you ordered with. We'll send you a 6-digit sign-in code.</p>
        <div class="row field"><input id="myEmail" type="email" placeholder="you@school.edu" value="${esc(me.email||'')}"><button class="btn primary" id="myGo">Send code</button></div>`;
      bindClose();
      $('#myGo').onclick=async()=>{const em=$('#myEmail').value.trim();if(!em)return;try{await api.sendCode(em);pref.set('me',{...me,email:em});renderMy('code')}catch(e){oops(e)}};
      return;
    }
    c.innerHTML=head+`<p class="muted" style="margin:4px 0 14px">Enter the code we sent to <b style="color:var(--text)">${esc(me.email)}</b>.</p>
      <div class="row field"><input id="myCode" inputmode="numeric" maxlength="8" placeholder="123456" style="letter-spacing:.3em;font-size:18px"><button class="btn primary" id="myVerify">Verify</button></div><button class="btn sm" id="myBack">Use a different email</button>`;
    bindClose();$('#myBack').onclick=()=>renderMy();
    $('#myVerify').onclick=async()=>{try{await api.verifyCode(me.email,$('#myCode').value.trim());user=await api.user();renderMy()}catch(e){oops(e)}};
    return;
  }
  let em=CLOUD?user.email:(step==='list'?$('#myEmail')?.value.trim():me.email);
  c.innerHTML=head+(CLOUD?`<p class="muted" style="margin:4px 0 14px">Signed in as ${esc(em)} · <a href="#" id="myOut">sign out</a></p>`:
    `<p class="muted" style="margin:4px 0 14px">Enter the email you ordered with.</p><div class="row field"><input id="myEmail" type="email" value="${esc(em||'')}"><button class="btn primary" id="myGo">Look up</button></div>`)+`<div id="myList"><p class="muted">Loading…</p></div>`;
  bindClose();
  $('#myGo')&&($('#myGo').onclick=()=>renderMy('list'));
  $('#myOut')&&($('#myOut').onclick=async e=>{e.preventDefault();await api.signOut();user=null;renderMy()});
  if(!em){$('#myList').innerHTML='';return}
  try{
    const mine=await api.myOrders(shop,em);
    $('#myList').innerHTML=mine.length?mine.map(o=>`
      <div class="box" style="display:flex;gap:14px;align-items:flex-start;cursor:pointer" data-tok="${o.token}">
        <div class="thumb" style="width:72px;height:72px">${mockBox(o.design,'front')}</div>
        <div class="grow">
          <div class="row" style="justify-content:space-between"><b>${esc(o.title)} <span class="muted">#${o.number}</span></b><span class="badge ${o.status}">${SLABEL[o.status]}</span></div>
          <div class="muted" style="font-size:12px;margin:4px 0">${esc(o.productName)} · ${o.qty} pcs · ${money(o.total)} · ${fmtDate(o.at)}${balance(o)>0&&PAYABLE.includes(o.status)?` · <b style="color:var(--hi)">${money(balance(o))} due</b>`:''}</div>
          ${o.status==='Declined'?`<div class="notice"><b>Declined:</b> ${esc(o.declineReason||'')}</div>`:''}
        </div>
      </div>`).join(''):'<p class="muted">No orders found for that email at this shop.</p>';
    $$('#myList [data-tok]').forEach(b=>b.onclick=()=>{$('#myModal').classList.remove('on');openStatus(b.dataset.tok)});
  }catch(e){oops(e)}
}

/* ================= BUSINESS HQ ================= */
let apane='dash', ofilter='All', osearch='';
const saveShop=debounce(()=>api.saveShop(shop).catch(oops));
function renderAdmin(){
  if(!isOwner)return;
  const pend=orders.filter(o=>o.status==='Pending').length;
  $('#pendCount').hidden=!pend;$('#pendCount').textContent=pend;
  ({dash:renderDash,orders:renderOrders,products:renderProducts,pricing:renderPricing,customers:renderCustomers,settings:renderSettings})[apane]();
}
function goPane(n){apane=n;$$('#adminRail button').forEach(x=>x.classList.toggle('on',x.dataset.apane===n));$$('.apane').forEach(p=>p.classList.toggle('on',p.id==='ap-'+n));renderAdmin()}
$$('#adminRail button').forEach(b=>b.onclick=()=>goPane(b.dataset.apane));
const counted=o=>!['Pending','Declined'].includes(o.status);

function renderDash(){
  $('#dashTitle').textContent=shop.name;
  $('#seedBtn').hidden=CLOUD;
  $('#dashNotice').innerHTML=CLOUD&&!shop.stripeReady?`<div class="notice" style="margin-bottom:16px;display:flex;align-items:center;gap:12px"><span class="grow"><b>Connect Stripe to get paid online.</b> Customers can still order; you'll collect payment yourself until you connect.</span><button class="btn sm primary" id="dashConnect">Set up payments</button></div>`:
    !CLOUD?`<div class="notice" style="margin-bottom:16px">Demo mode — data is saved in this browser only. Connect Supabase (see SETUP.md) for real accounts, orders and payments.</div>`:'';
  $('#dashConnect')&&($('#dashConnect').onclick=()=>goPane('settings'));
  const lv=orders.filter(counted);
  const rev=lv.reduce((a,o)=>a+o.total,0),cost=lv.reduce((a,o)=>a+(o.cost||0),0);
  const open=orders.filter(o=>['Approved','Production','Ready'].includes(o.status));
  const collected=lv.reduce((a,o)=>a+(o.paid?o.total:o.amountPaid||0),0);
  $('#dashStats').innerHTML=[['Needs review',orders.filter(o=>o.status==='Pending').length],['In progress',open.length],['Approved revenue',money0(rev)],['Collected',money0(collected)],['Outstanding',money0(rev-collected)],['Est. profit',money0(rev-cost)]]
    .map(([k,v])=>`<div class="stat"><div class="muted">${k}</div><div class="n">${v}</div></div>`).join('');
  const rv=orders.filter(o=>o.status==='Pending');
  $('#reviewList').innerHTML=rv.length?rv.map(o=>`
    <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div class="thumb">${mockBox(o.design,'front')}</div>
      <div class="grow" style="cursor:pointer" data-open="${o.id}"><b>${esc(o.customer.org)}</b><div class="muted" style="font-size:12px">${oid(o)} · ${esc(o.title)} · ${o.qty} pcs · ${money0(o.total)}${o.due?` · due ${o.due}`:''}</div></div>
      <button class="btn sm ok" data-approve="${o.id}">Approve</button><button class="btn sm bad" data-decline="${o.id}">Decline</button>
    </div>`).join(''):'<p class="muted">You\'re all caught up. New orders appear here for approval.</p>';
  const by={};lv.forEach(o=>by[o.productName]=(by[o.productName]||0)+o.total);
  const mx=Math.max(1,...Object.values(by));
  $('#revBars').innerHTML=Object.keys(by).length?Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="b"><span style="width:130px">${esc(k)}</span><div class="tr"><i style="width:${v/mx*100}%"></i></div><b style="width:70px;text-align:right">${money0(v)}</b></div>`).join(''):'<p class="muted">No approved orders yet.</p>';
  const cnt=STATUSES.map(s=>[s,orders.filter(o=>o.status===s).length]),mc=Math.max(1,...cnt.map(c=>c[1]));
  $('#pipeBars').innerHTML=cnt.map(([s,n])=>`<div class="b"><span style="width:130px">${SLABEL[s]}</span><div class="tr"><i style="width:${n/mc*100}%"></i></div><b style="width:70px;text-align:right">${n}</b></div>`).join('');
  bindOrderActions($('#ap-dash'));
}
const payBadge=o=>!counted(o)?'—':o.paid||balance(o)===0?'<span class="badge paid">Paid</span>':o.amountPaid>0?`<span class="badge part">${money0(o.amountPaid)} paid</span>`:'<span class="badge unpaid">Unpaid</span>';
function filteredOrders(){
  const q=osearch.toLowerCase();
  return orders.filter(o=>(ofilter==='All'||o.status===ofilter||(ofilter==='Unpaid'&&counted(o)&&balance(o)>0))&&(!q||[oid(o),o.title,o.customer.org,o.customer.name,o.customer.email,o.productName].join(' ').toLowerCase().includes(q)));
}
function renderOrders(){
  $('#filterTabs').innerHTML=['All',...STATUSES,'Unpaid'].map(s=>{const n=s==='All'?orders.length:s==='Unpaid'?orders.filter(o=>counted(o)&&balance(o)>0).length:orders.filter(o=>o.status===s).length;return`<button class="${ofilter===s?'on':''}" data-f="${s}">${SLABEL[s]||s} (${n})</button>`}).join('');
  $$('#filterTabs button').forEach(b=>b.onclick=()=>{ofilter=b.dataset.f;renderOrders()});
  const list=filteredOrders();
  $('#orderTable').innerHTML=list.length?`<tr><th></th><th>Order</th><th>Customer</th><th>Product</th><th>Qty</th><th>Total</th><th>Due</th><th>Status</th><th>Payment</th><th></th></tr>`+list.map(o=>`
    <tr class="click" data-open="${o.id}">
      <td><div class="thumb">${mockBox(o.design,'front')}</div></td>
      <td><b>${oid(o)}</b><div class="muted" style="font-size:12px">${esc(o.title)}</div></td>
      <td>${esc(o.customer.org)}<div class="muted" style="font-size:12px">${esc(o.customer.name||o.customer.email)}</div></td>
      <td>${esc(o.productName)}<div class="muted" style="font-size:12px">${esc(o.colorName||'')}</div></td>
      <td>${o.qty}</td><td>${money0(o.total)}</td><td>${o.due||'—'}</td>
      <td><span class="badge ${o.status}">${SLABEL[o.status]}</span></td><td>${payBadge(o)}</td>
      <td style="white-space:nowrap">${o.status==='Pending'?`<button class="btn sm ok" data-approve="${o.id}">Approve</button> <button class="btn sm bad" data-decline="${o.id}">Decline</button>`:NEXT[o.status]?`<button class="btn sm" data-next="${o.id}">${NEXT_LABEL[o.status]}</button>`:''}</td>
    </tr>`).join(''):`<tr><td style="padding:40px;text-align:center" class="muted">No orders match. Share your customer link to start taking orders.</td></tr>`;
  bindOrderActions($('#orderTable'));
}
$('#orderSearch').oninput=e=>{osearch=e.target.value;renderOrders()};
function bindOrderActions(root){
  const O=id=>orders.find(x=>x.id===id);
  root.querySelectorAll('[data-approve]').forEach(b=>b.onclick=e=>{e.stopPropagation();decide(O(b.dataset.approve),'approve')});
  root.querySelectorAll('[data-decline]').forEach(b=>b.onclick=e=>{e.stopPropagation();decide(O(b.dataset.decline),'decline')});
  root.querySelectorAll('[data-next]').forEach(b=>b.onclick=e=>{e.stopPropagation();const o=O(b.dataset.next);setStatus(o,NEXT[o.status])});
  root.querySelectorAll('[data-open]').forEach(r=>r.onclick=()=>openOrder(r.dataset.open));
}
async function setStatus(o,s,note,extra=[]){
  const prev=JSON.stringify(o);
  o.status=s;o.history=[...o.history,{at:Date.now(),text:`${SLABEL[s]}${note?` — ${note}`:''}`}];
  try{await api.updateOrder(o,['status','history',...extra]);api.notify('updated',{order_id:o.id});toast(`${oid(o)} → ${SLABEL[s]}`)}
  catch(e){Object.assign(o,JSON.parse(prev));oops(e)}
  renderAdmin();if(drawerId===o.id)openOrder(o.id);
}
function decide(o,kind){
  const c=$('#decideCard');
  if(kind==='approve'){
    c.innerHTML=`<h2>Approve ${oid(o)}</h2><p class="muted" style="margin-bottom:14px">${esc(o.customer.org)} · ${o.qty} pcs · ${money(o.total)}${depositOf(o.total)?` · ${shop.deposit}% deposit = ${money(depositOf(o.total))}`:''}</p>
      ${pair(o.design)}
      ${CLOUD&&!shop.stripeReady?'<div class="notice" style="margin-top:12px">Stripe isn\'t connected, so the customer won\'t see a Pay button. Connect it in Settings to get paid online.</div>':''}
      <div class="field" style="margin-top:14px"><label>Message to customer (optional)</label><textarea id="dMsg" rows="3" placeholder="Looks great! Production starts as soon as your deposit is in."></textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="dCancel">Cancel</button><button class="btn ok" id="dGo">Approve order</button></div>`;
  }else{
    c.innerHTML=`<h2>Decline ${oid(o)}</h2><p class="muted" style="margin-bottom:14px">The customer sees this reason and can edit and resubmit.</p>
      <div class="chips" style="margin-bottom:12px">${DECLINE_REASONS.map(r=>`<button class="chip plain" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <div class="field"><label>Reason (required)</label><textarea id="dMsg" rows="3"></textarea></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="dCancel">Cancel</button><button class="btn bad" id="dGo">Decline order</button></div>`;
    c.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{$('#dMsg').value=b.dataset.r});
  }
  $('#decideModal').classList.add('on');
  $('#dCancel').onclick=()=>$('#decideModal').classList.remove('on');
  $('#dGo').onclick=async()=>{
    const msg=$('#dMsg').value.trim();
    if(kind==='decline'&&!msg)return toast('Add a reason so the customer knows what to fix');
    $('#decideModal').classList.remove('on');
    if(kind==='decline'){o.declineReason=msg;await setStatus(o,'Declined',msg,['declineReason'])}
    else{if(msg)o.message=msg;await setStatus(o,'Approved',msg,msg?['message']:[])}
  };
}

/* order drawer */
let drawerId=null;
function openOrder(id){
  const o=orders.find(x=>x.id===id);if(!o)return;drawerId=id;
  $('#dHead').innerHTML=`<div class="grow"><b style="font-size:17px">${oid(o)} · ${esc(o.title)}</b><div class="muted" style="font-size:12px">Submitted ${fmtDT(o.at)}${o.revisionOf?` · revision of ${esc((orders.find(x=>x.id===o.revisionOf)&&oid(orders.find(x=>x.id===o.revisionOf)))||'an earlier order')}`:''}</div></div><span class="badge ${o.status}">${SLABEL[o.status]}</span><button class="btn sm" id="dClose">✕</button>`;
  const q=quote(o.design,o.sizes,o.due), bal=balance(o);
  $('#dBody').innerHTML=`
    ${pair(o.design)}
    ${o.status==='Declined'?`<div class="notice" style="margin-top:14px"><b>Declined:</b> ${esc(o.declineReason)}</div>`:''}
    <div class="grid2" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <div><h3 class="sec">Customer</h3><b>${esc(o.customer.org)}</b><div class="muted">${esc(o.customer.name)}<br><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a>${o.customer.phone?`<br>${esc(o.customer.phone)}`:''}</div></div>
      <div><h3 class="sec">Product</h3><b>${esc(o.productName)}</b><div class="muted">${esc(o.colorName||'')} · ${o.design.layers.length} design elements<br>${o.due?`Need by <b style="color:var(--text)">${o.due}</b>`:'No deadline given'}</div></div>
    </div>
    <h3 class="sec">Sizes</h3><div class="chips">${Object.entries(o.sizes).map(([k,v])=>`<span class="chip plain">${k} × ${v}</span>`).join('')}</div>
    ${o.notes?`<h3 class="sec">Customer notes</h3><p>${esc(o.notes)}</p>`:''}
    ${o.design.layers.some(l=>l.type==='img')?`<h3 class="sec">Artwork files</h3><div class="row" style="flex-wrap:wrap">${o.design.layers.filter(l=>l.type==='img').map((l,i)=>`<a class="btn sm" href="${esc(l.src)}" target="_blank" download>Artwork ${i+1} (${l.side})</a>`).join('')}</div>`:''}
    <h3 class="sec">Price</h3><div class="breakdown">
      <div class="l"><span>${o.qty} pcs × ${money(o.unit)}</span><span>${money(o.unit*o.qty)}</span></div>
      ${q.up?`<div class="l"><span>Size upcharges</span><span>${money(q.up)}</span></div>`:''}
      <div class="l t"><span>Order total</span><span>${money(o.total)}</span></div>
      <div class="l muted"><span>Est. blank cost</span><span>${money(o.cost||0)}</span></div><div class="l"><span>Est. profit</span><span>${money(o.total-(o.cost||0))}</span></div></div>
    <h3 class="sec">Payment</h3>
    <div class="breakdown"><div class="l"><span>Paid online</span><span>${money(o.amountPaid||0)}</span></div><div class="l t"><span>Balance</span><span>${money(bal)}</span></div></div>
    <label class="row" style="cursor:pointer;margin-top:10px"><span class="switch"><input type="checkbox" id="dPaid" ${o.paid?'checked':''}><span></span></span>Mark paid in full (cash, check, Venmo…)</label>
    <div class="field" style="margin-top:10px"><label>Customer's order page (status & payment)</label><div class="copybox"><input readonly value="${esc(orderLink(o))}"><button class="btn sm" id="dCopy">Copy</button></div></div>
    <h3 class="sec">Message to customer</h3><div class="row"><input id="dMessage" value="${esc(o.message||'')}" placeholder="Shown on their order page"><button class="btn sm" id="dSaveMsg">Save</button></div>
    <h3 class="sec">Internal note</h3><textarea id="dNote" rows="2" placeholder="Only your team sees this">${esc(o.note||'')}</textarea>
    <h3 class="sec">History</h3><div class="timeline">${o.history.slice().reverse().map(h=>`<div>${esc(h.text)}<small>${fmtDT(h.at)}</small></div>`).join('')}</div>`;
  $('#dFoot').innerHTML=`${o.status==='Pending'?`<button class="btn ok" data-approve="${o.id}">Approve</button><button class="btn bad" data-decline="${o.id}">Decline</button>`:''}
    ${NEXT[o.status]?`<button class="btn primary" data-next="${o.id}">${NEXT_LABEL[o.status]}</button>`:''}
    <select id="dStatus" style="width:auto">${STATUSES.map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${SLABEL[s]}</option>`).join('')}</select>
    <div class="grow"></div><button class="btn" id="dProof">Print proof</button><button class="btn" id="dEdit">Open in studio</button><button class="btn bad" id="dDel">Delete</button>`;
  bindOrderActions($('#dFoot'));
  $('#dClose').onclick=closeDrawer;
  $('#dCopy').onclick=()=>copy(orderLink(o));
  const upd=async(keys,msg)=>{try{await api.updateOrder(o,keys);if(msg)toast(msg)}catch(e){oops(e)}renderAdmin();openOrder(o.id)};
  $('#dPaid').onchange=e=>{o.paid=e.target.checked;o.history=[...o.history,{at:Date.now(),text:o.paid?'Marked paid in full':'Marked unpaid'}];upd(['paid','history'])};
  $('#dSaveMsg').onclick=()=>{o.message=$('#dMessage').value.trim();o.history=[...o.history,{at:Date.now(),text:'Message to customer updated'}];upd(['message','history'],'Message saved')};
  $('#dNote').onchange=e=>{o.note=e.target.value;api.updateOrder(o,['note']).catch(oops)};
  $('#dStatus').onchange=e=>{if(e.target.value==='Declined')return decide(o,'decline');setStatus(o,e.target.value)};
  $('#dProof').onclick=()=>printProof(o);
  $('#dEdit').onclick=()=>{if(!P(o.design.productId))return toast('That product was deleted');design=JSON.parse(JSON.stringify(o.design));sel=null;side='front';closeDrawer();switchMode('client');renderCatalog();renderStudio();toast(`Editing a copy of ${oid(o)}`)};
  $('#dDel').onclick=async()=>{if(!confirm(`Delete order ${oid(o)}? This can't be undone.`))return;try{await api.deleteOrder(o.id);orders=orders.filter(x=>x!==o);closeDrawer();renderAdmin()}catch(e){oops(e)}};
  $('#drawer').classList.add('on');$('#scrim').classList.add('on');
}
function closeDrawer(){drawerId=null;$('#drawer').classList.remove('on');$('#scrim').classList.remove('on')}
$('#scrim').onclick=closeDrawer;

function printProof(o){
  $('#proof').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><div><h1 style="font-size:22px">${esc(shop.name)} — Design proof</h1><div>${oid(o)} · ${esc(o.title)} · ${new Date().toLocaleDateString()}</div></div>${shop.logo?`<img src="${esc(shop.logo)}" style="height:50px;background:#000;padding:4px;border-radius:6px">`:''}</div>
    ${pair(o.design)}
    <table style="width:100%;margin-top:16px;font-size:13px;border-collapse:collapse">
      <tr><td><b>Customer</b></td><td>${esc(o.customer.org)} — ${esc(o.customer.name)} (${esc(o.customer.email)})</td></tr>
      <tr><td><b>Product</b></td><td>${esc(o.productName)}, ${esc(o.colorName||'')}</td></tr>
      <tr><td><b>Sizes</b></td><td>${Object.entries(o.sizes).map(([k,v])=>`${k}: ${v}`).join(', ')} (${o.qty} total)</td></tr>
      <tr><td><b>Total</b></td><td>${money(o.total)}</td></tr><tr><td><b>Need by</b></td><td>${o.due||'—'}</td></tr></table>
    <p style="margin-top:30px">Approved by: ______________________ &nbsp; Date: __________</p>`;
  setTimeout(()=>window.print(),400);
}

/* products */
function renderProducts(){
  $('#prodGrid').innerHTML=products.map(p=>`
    <div class="pitem ${p.active?'':'off'}">
      <div class="pv">${mockBox({productId:p.id,colorId:p.colors[0]?.id,layers:[]},'front')}</div>
      <div class="body">
        <div class="row" style="justify-content:space-between"><b>${esc(p.name)}</b><label class="switch" title="Visible to customers"><input type="checkbox" data-act="${p.id}" ${p.active?'checked':''}><span></span></label></div>
        <div class="muted" style="font-size:12px;margin:4px 0 10px">${esc(p.category||'')} · ${money(p.price)} · ${p.colors.length} colors · ${p.sizes.length} sizes</div>
        <div class="row"><button class="btn sm" data-edit="${p.id}">Edit</button><button class="btn sm" data-dup="${p.id}">Duplicate</button><button class="btn sm bad" data-pdel="${p.id}">Delete</button></div>
      </div>
    </div>`).join('')||'<div class="blank">No products yet. Add your first one.</div>';
  $$('[data-act]').forEach(c=>c.onchange=async()=>{const p=P(c.dataset.act);p.active=c.checked;try{await api.saveProduct(p);toast(c.checked?'Now visible to customers':'Hidden from customers')}catch(e){p.active=!c.checked;oops(e)}renderProducts();renderCatalog()});
  $$('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit));
  $$('[data-dup]').forEach(b=>b.onclick=async()=>{const c=JSON.parse(JSON.stringify(P(b.dataset.dup)));c.id='new_'+uid();c.name+=' (copy)';c.position=products.length;try{products.push(await api.saveProduct(c));renderProducts()}catch(e){oops(e)}});
  $$('[data-pdel]').forEach(b=>b.onclick=async()=>{const p=P(b.dataset.pdel);if(!confirm(`Delete “${p.name}”? Past orders keep their details, but their previews will stop working. Hiding it instead keeps previews.`))return;try{await api.deleteProduct(p.id);products=products.filter(x=>x!==p);if(design.productId===p.id)design=freshDesign();renderProducts();renderCatalog();renderStudio()}catch(e){oops(e)}});
}
$('#newProduct').onclick=()=>editProduct(null);

let ep=null, epSide='front';
function editProduct(id){
  ep=id?JSON.parse(JSON.stringify(P(id))):{id:'new_'+uid(),name:'',category:'',active:true,position:products.length,price:15,extraLoc:4,extraEl:.75,cost:5,minQty:12,sizes:['S','M','L','XL','2XL'],upcharge:{'2XL':2},images:{front:'',back:''},print:{front:[30,25,40,45],back:[30,22,40,50]},colors:[{id:uid(),name:'White',hex:'#ffffff'}]};
  ep._new=!id;epSide='front';drawerId=null;renderEP();
  $('#drawer').classList.add('on');$('#scrim').classList.add('on');
}
function renderEP(){
  const p=ep;
  $('#dHead').innerHTML=`<div class="grow"><b style="font-size:17px">${p._new?'New product':esc(p.name)}</b><div class="muted" style="font-size:12px">Changes apply when you save</div></div><button class="btn sm" id="dClose">✕</button>`;
  $('#dBody').innerHTML=`
    <div class="row"><div class="field grow"><label>Product name</label><input id="eName" value="${esc(p.name)}" placeholder="Crewneck Sweatshirt"></div><div class="field" style="width:160px"><label>Category</label><input id="eCat" value="${esc(p.category)}" placeholder="Fleece"></div></div>
    <h3 class="sec">Blank images</h3>
    <p class="hint" style="margin:-4px 0 10px">Upload a white or light-colored blank so it can be recolored. Photos on a white background get their background removed automatically.</p>
    <div class="row" style="margin-bottom:6px;flex-wrap:wrap">
      ${['front','back'].map(s=>`<div class="grow box" style="margin:0;padding:12px;min-width:220px"><div class="row"><img class="mini" src="${esc(p.images[s]||'')}" style="${p.images[s]?'':'visibility:hidden'}"><div class="grow"><b>${s==='front'?'Front':'Back'}</b><div class="muted" style="font-size:12px">${p.images[s]?'Uploaded':s==='back'?'Optional':'Required'}</div></div><label class="btn sm upl">Upload<input type="file" accept="image/*" data-img="${s}"></label>${s==='back'&&p.images.back?'<button class="btn sm" id="eNoBack">✕</button>':''}</div></div>`).join('')}
    </div>
    <label class="row hint"><input type="checkbox" id="eRmBg" checked> Remove white background on upload</label>
    <h3 class="sec">Print area</h3>
    <div class="row" style="align-items:flex-start;gap:16px">
      <div style="width:220px;flex:none"><div class="tabs" style="margin-bottom:8px">${['front','back'].filter(s=>s==='front'||p.images.back).map(s=>`<button class="${epSide===s?'on':''}" data-eside="${s}">${s}</button>`).join('')}</div>
        <div class="mock checker" id="ePrev" style="width:220px;border-radius:10px"></div></div>
      <div class="grow">${['Left','Top','Width','Height'].map((k,i)=>`<div class="field"><label>${k} · <span id="pa${i}v">${p.print[epSide][i]}</span>%</label><input type="range" min="0" max="${i<2?90:100}" value="${p.print[epSide][i]}" data-pa="${i}"></div>`).join('')}</div>
    </div>
    <h3 class="sec">Colors</h3>
    <p class="hint" style="margin:-4px 0 10px">Pick a color to tint the blank, or upload a real photo of that color for the most realistic mockup.</p>
    <div id="eColors">${p.colors.map((c,i)=>`<div class="colrow">
      <input type="color" value="${esc(c.hex)}" data-chex="${i}"><input value="${esc(c.name)}" data-cname="${i}" placeholder="Color name">
      <label class="btn sm upl">${c.front?'✓ ':''}Front photo<input type="file" accept="image/*" data-cimg="${i}:front"></label>
      <label class="btn sm upl">${c.back?'✓ ':''}Back photo<input type="file" accept="image/*" data-cimg="${i}:back"></label>
      <button class="btn sm" data-cdel="${i}">✕</button></div>`).join('')}</div>
    <button class="btn sm" id="eAddColor">+ Add color</button>
    <h3 class="sec">Sizes</h3>
    <div class="chips" style="margin-bottom:10px">${ALL_SIZES.map(s=>`<button class="chip plain ${p.sizes.includes(s)?'on':''}" data-sz="${s}">${s}</button>`).join('')}</div>
    <div class="sizes">${p.sizes.map(s=>`<div><label>${s} +$</label><input type="number" min="0" step=".5" value="${p.upcharge[s]||0}" data-up="${s}"></div>`).join('')}</div>
    <p class="hint">Upcharge added per piece for that size.</p>
    <h3 class="sec">Pricing</h3>
    <div class="row">
      <div class="field grow"><label>Price (1 print location)</label><input type="number" step=".25" min="0" id="ePrice" value="${p.price}"></div>
      <div class="field grow"><label>Each extra location</label><input type="number" step=".25" min="0" id="eLoc" value="${p.extraLoc}"></div>
      <div class="field grow"><label>Each extra element</label><input type="number" step=".25" min="0" id="eEl" value="${p.extraEl}"></div>
    </div>
    <div class="row">
      <div class="field grow"><label>Your blank cost (private)</label><input type="number" step=".25" min="0" id="eCost" value="${p.cost}"></div>
      <div class="field grow"><label>Minimum order (pcs)</label><input type="number" min="1" id="eMin" value="${p.minQty}"></div>
      <div class="field grow"><label>Margin per piece</label><input disabled id="eMargin"></div>
    </div>
    <label class="row" style="cursor:pointer;margin-top:4px"><span class="switch"><input type="checkbox" id="eActive" ${p.active?'checked':''}><span></span></span>Visible to customers</label>`;
  $('#dFoot').innerHTML=`<div class="grow"></div><button class="btn" id="eCancel">Cancel</button><button class="btn primary" id="eSave">${p._new?'Add product':'Save changes'}</button>`;
  const drawPrev=()=>{products.push({...ep,id:'__ep'});$('#ePrev').innerHTML=ep.images.front?mockHTML({productId:'__ep',colorId:ep.colors[0]?.id,layers:[]},epSide,false).replace('class="print ','class="print guide '):'<div class="nomock">Upload a front image</div>';products=products.filter(x=>x.id!=='__ep')};
  drawPrev();
  const margin=()=>{const m=ep.price>0?(ep.price-ep.cost)/ep.price*100:0;$('#eMargin').value=`${money(ep.price-ep.cost)} (${m.toFixed(0)}%)`};margin();
  const bindNum=(id,k)=>$(id).oninput=e=>{ep[k]=+e.target.value;margin()};
  bindNum('#ePrice','price');bindNum('#eLoc','extraLoc');bindNum('#eEl','extraEl');bindNum('#eCost','cost');bindNum('#eMin','minQty');
  $('#eName').oninput=e=>ep.name=e.target.value;$('#eCat').oninput=e=>ep.category=e.target.value;$('#eActive').onchange=e=>ep.active=e.target.checked;
  $$('[data-img]').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;toast('Processing image…');try{ep.images[inp.dataset.img]=await readImg(f,{max:1000,removeBg:$('#eRmBg').checked});renderEP()}catch(e){oops(e)}});
  $('#eNoBack')&&($('#eNoBack').onclick=()=>{ep.images.back='';epSide='front';renderEP()});
  $$('[data-eside]').forEach(b=>b.onclick=()=>{epSide=b.dataset.eside;renderEP()});
  $$('[data-pa]').forEach(r=>r.oninput=()=>{ep.print[epSide][+r.dataset.pa]=+r.value;$('#pa'+r.dataset.pa+'v').textContent=r.value;drawPrev()});
  $$('[data-chex]').forEach(i=>i.oninput=()=>{ep.colors[+i.dataset.chex].hex=i.value;drawPrev()});
  $$('[data-cname]').forEach(i=>i.oninput=()=>ep.colors[+i.dataset.cname].name=i.value);
  $$('[data-cimg]').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;const[i,s]=inp.dataset.cimg.split(':');toast('Processing image…');try{ep.colors[+i][s]=await readImg(f,{max:1000,removeBg:$('#eRmBg').checked});renderEP()}catch(e){oops(e)}});
  $$('[data-cdel]').forEach(b=>b.onclick=()=>{if(ep.colors.length<2)return toast('Keep at least one color');ep.colors.splice(+b.dataset.cdel,1);renderEP()});
  $('#eAddColor').onclick=()=>{ep.colors.push({id:uid(),name:'New color',hex:'#888888'});renderEP()};
  $$('[data-sz]').forEach(b=>b.onclick=()=>{const s=b.dataset.sz;ep.sizes=ep.sizes.includes(s)?ep.sizes.filter(x=>x!==s):ALL_SIZES.filter(x=>x===s||ep.sizes.includes(x));renderEP()});
  $$('[data-up]').forEach(i=>i.oninput=()=>ep.upcharge[i.dataset.up]=+i.value);
  $('#dClose').onclick=$('#eCancel').onclick=closeDrawer;
  $('#eSave').onclick=async e=>{
    if(!ep.name.trim())return toast('Give the product a name');
    if(!ep.images.front)return toast('Upload a front image');
    if(!ep.sizes.length)return toast('Pick at least one size');
    e.target.disabled=true;e.target.textContent='Saving…';
    try{
      const p={...ep};delete p._new;
      p.images={front:await api.uploadImage(p.images.front,'shop'),back:p.images.back?await api.uploadImage(p.images.back,'shop'):''};
      p.colors=await Promise.all(p.colors.map(async c=>({...c,...(c.front?{front:await api.uploadImage(c.front,'shop')}:{}),...(c.back?{back:await api.uploadImage(c.back,'shop')}:{})})));
      Object.keys(p.upcharge).forEach(k=>{if(!p.sizes.includes(k))delete p.upcharge[k]});
      const saved=await api.saveProduct(p);
      const i=products.findIndex(x=>x.id===ep.id);if(i>=0)products[i]=saved;else products.push(saved);
      closeDrawer();renderProducts();renderCatalog();renderStudio();toast(ep._new?'Product added':'Product saved');
    }catch(err){oops(err);e.target.disabled=false;e.target.textContent='Save'}
  };
}

/* pricing */
const saveProductSoon={};
function renderPricing(){
  $('#priceTable').innerHTML=`<tr><th>Product</th><th>Price</th><th>Extra location</th><th>Extra element</th><th>Blank cost</th><th>Min qty</th><th>Margin</th></tr>`+products.map(p=>`<tr>
    <td><b>${esc(p.name)}</b>${p.active?'':' <span class="badge">Hidden</span>'}</td>
    ${['price','extraLoc','extraEl','cost','minQty'].map(k=>`<td><input type="number" step="${k==='minQty'?1:.25}" min="0" value="${p[k]}" data-pp="${p.id}:${k}" style="width:90px"></td>`).join('')}
    <td data-mg="${p.id}">${p.price?((p.price-p.cost)/p.price*100).toFixed(0):0}%</td></tr>`).join('');
  $$('[data-pp]').forEach(i=>i.oninput=()=>{const[id,k]=i.dataset.pp.split(':'),p=P(id);p[k]=+i.value;
    (saveProductSoon[id]||(saveProductSoon[id]=debounce(()=>api.saveProduct(P(id)).catch(oops))))();
    $(`[data-mg="${id}"]`).textContent=(p.price?((p.price-p.cost)/p.price*100).toFixed(0):0)+'%';renderPrice();renderCatalog()});
  $('#tierEdit').innerHTML=`<div class="row muted" style="font-size:12px;margin-bottom:6px"><span style="width:110px">From qty</span><span class="grow">Discount %</span></div>`+shop.tiers.map((t,i)=>`<div class="row" style="margin-bottom:6px"><input type="number" min="1" value="${t.min}" data-tmin="${i}" style="width:110px"><input type="number" min="0" max="90" value="${t.off}" data-toff="${i}"><button class="btn sm" data-tdel="${i}">✕</button></div>`).join('');
  $$('[data-tmin]').forEach(i=>i.oninput=()=>{shop.tiers[+i.dataset.tmin].min=+i.value;saveShop();renderPrice()});
  $$('[data-toff]').forEach(i=>i.oninput=()=>{shop.tiers[+i.dataset.toff].off=+i.value;saveShop();renderPrice();renderCatalog()});
  $$('[data-tdel]').forEach(b=>b.onclick=()=>{shop.tiers.splice(+b.dataset.tdel,1);saveShop();renderPricing();renderPrice()});
  [['#sDeposit','deposit'],['#sRush','rush'],['#sTax','tax']].forEach(([id,k])=>{$(id).value=shop[k];$(id).oninput=e=>{shop[k]=+e.target.value;saveShop()}});
}
$('#addTier').onclick=()=>{const last=shop.tiers[shop.tiers.length-1];shop.tiers.push({min:(last?.min||12)*2,off:(last?.off||0)+3});saveShop();renderPricing();renderPrice()};

/* customers */
function renderCustomers(){
  const m={};
  orders.forEach(o=>{const k=o.customer.email.toLowerCase();const c=m[k]||(m[k]={org:o.customer.org,name:o.customer.name,email:o.customer.email,phone:o.customer.phone,n:0,pcs:0,spend:0,last:0});c.n++;if(counted(o)){c.pcs+=o.qty;c.spend+=o.total}c.last=Math.max(c.last,o.at)});
  const list=Object.values(m).sort((a,b)=>b.spend-a.spend);
  $('#custTable').innerHTML=list.length?`<tr><th>Organization</th><th>Contact</th><th>Orders</th><th>Pieces</th><th>Lifetime spend</th><th>Last order</th><th></th></tr>`+list.map(c=>`<tr>
    <td><b>${esc(c.org)}</b></td><td>${esc(c.name)}<div class="muted" style="font-size:12px">${esc(c.email)}${c.phone?' · '+esc(c.phone):''}</div></td>
    <td>${c.n}</td><td>${c.pcs}</td><td>${money0(c.spend)}</td><td>${fmtDate(c.last)}</td>
    <td><button class="btn sm" data-cust="${esc(c.email)}">View orders</button></td></tr>`).join(''):`<tr><td style="padding:40px;text-align:center" class="muted">Customers show up here after their first order.</td></tr>`;
  $$('[data-cust]').forEach(b=>b.onclick=()=>{osearch=b.dataset.cust;$('#orderSearch').value=osearch;ofilter='All';goPane('orders')});
}

/* settings */
let payStatus=null;
async function renderPayBox(refresh){
  const b=$('#payBody');
  if(!CLOUD){b.innerHTML='<p class="muted">Available after connecting Supabase and Stripe (see SETUP.md). In demo mode, mark orders paid manually.</p>';return}
  if(refresh||!payStatus){b.innerHTML='<p class="muted">Checking Stripe…</p>';try{payStatus=await api.connect('status');shop.stripeReady=payStatus.ready}catch(e){b.innerHTML=`<p class="muted">Couldn't reach Stripe: ${esc(e.message)}</p>`;return}}
  const s=payStatus;
  b.innerHTML=s.ready?`<div class="notice good" style="margin-bottom:12px">Connected — customers can pay deposits and balances online. Payouts go to your bank through Stripe.</div><div class="row"><button class="btn sm" id="payDash">Open Stripe dashboard</button><button class="btn sm" id="payRef">Refresh</button></div>`:
    s.connected?`<div class="notice" style="margin-bottom:12px">Stripe needs a few more details before you can take payments.</div><div class="row"><button class="btn sm primary" id="payGo">Finish Stripe setup</button><button class="btn sm" id="payRef">Refresh</button></div>`:
    `<p class="muted" style="margin-bottom:12px">Connect a Stripe account to collect deposits and balances by card. Takes about 5 minutes — you'll need your business and bank details.</p><button class="btn primary" id="payGo">Connect Stripe</button>`;
  $('#payGo')&&($('#payGo').onclick=async e=>{e.target.disabled=true;e.target.textContent='Opening Stripe…';try{location.href=(await api.connect('onboard')).url}catch(err){oops(err);e.target.disabled=false}});
  $('#payDash')&&($('#payDash').onclick=async()=>{try{window.open((await api.connect('dashboard')).url,'_blank')}catch(e){oops(e)}});
  $('#payRef')&&($('#payRef').onclick=()=>renderPayBox(true));
}
function renderSettings(){
  $('#sName').value=shop.name;$('#sAccent').value=shop.accent;$('#sTurn').value=shop.turnaround;$('#sEmail').value=shop.email;$('#sPhone').value=shop.phone;
  $('#sLogoPrev').src=shop.logo||'';$('#sLogoPrev').style.visibility=shop.logo?'':'hidden';
  $('#slugField').hidden=!CLOUD;$('#slugPrefix').textContent=api.siteUrl+'?shop=';$('#sSlug').value=shop.slug;
  $('#pinBox').hidden=CLOUD;$('#sPin').value=shop.pin||'';
  $('#importWrap').hidden=$('#resetAll').hidden=CLOUD;
  renderPayBox();
}
[['#sName','name'],['#sTurn','turnaround'],['#sEmail','email'],['#sPhone','phone'],['#sPin','pin']].forEach(([id,k])=>$(id).oninput=e=>{shop[k]=e.target.value;saveShop();applyBrand()});
$('#sSlug').onchange=e=>{const v=e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');if(v.length<2)return toast('Shop link is too short');shop.slug=v;e.target.value=v;api.saveShop(shop).then(()=>toast('Shop link updated')).catch(oops)};
$('#sAccent').oninput=e=>{shop.accent=e.target.value;saveShop();applyBrand()};
$('#sLogo').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{shop.logo=await api.uploadImage(await readImg(f,{max:600}),'shop');await api.saveShop(shop);applyBrand();renderSettings()}catch(err){oops(err)}};
$('#sLogoReset').onclick=()=>{shop.logo='';saveShop();applyBrand();renderSettings()};
$('#exportAll').onclick=()=>{const data=CLOUD?{shop,products,orders}:api.exportAll();const b=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${shop.name.replace(/\W+/g,'-')}-backup.json`;a.click()};
$('#importAll').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d.products||!d.orders)throw 0;api.importAll(d);location.reload()}catch(_){toast('That file is not a valid backup')}};r.readAsText(f)};
$('#resetAll').onclick=()=>{if(!confirm('Reset the demo shop? This erases all orders, products and settings in this browser.'))return;api.reset();location.hash='';location.reload()};
$('#copyLink').onclick=()=>copy(shopLink());

$('#csvBtn').onclick=()=>{
  const rows=[['Order','Date','Status','Paid','Balance','Organization','Contact','Email','Phone','Title','Product','Color','Sizes','Qty','Total','Need by','Notes']];
  filteredOrders().forEach(o=>rows.push([oid(o),new Date(o.at).toISOString().slice(0,10),SLABEL[o.status],(o.paid?o.total:o.amountPaid||0).toFixed(2),balance(o).toFixed(2),o.customer.org,o.customer.name,o.customer.email,o.customer.phone,o.title,o.productName,o.colorName,Object.entries(o.sizes).map(([k,v])=>`${k}:${v}`).join(' '),o.qty,o.total.toFixed(2),o.due,o.notes]));
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='orders.csv';a.click();
};

/* demo orders (demo mode only) */
$('#seedBtn').onclick=async()=>{
  const T=(text,f,o)=>({id:uid(),type:'text',text,font:f,size:24,color:'#ffffff',x:50,y:30,rot:0,ls:.08,side:'front',...o});
  const tee=P('tee')?'tee':products[0]?.id, hood=P('hoodie')?'hoodie':tee, day=864e5, now=Date.now();
  let n=shop.nextOrder||1001;
  const demo=[
    {c:['Alpha Sigma Phi','Jake Morris','jake@asp-beta.org','(555) 201-3344'],t:'Fall Rush 2026',st:'Pending',p:tee,col:'navy',sz:{S:8,M:20,L:22,XL:10},due:12,L:[T('ΑΣΦ','Noto Serif',{size:30,y:35}),T('FALL RUSH','Graduate',{size:10,y:62,color:'#d4af37'}),T('ΑΣΦ','Noto Serif',{size:40,side:'back',y:20,color:'#d4af37',stroke:'#ffffff'})]},
    {c:['Chi Phi','Ryan Lee','ryan@chiphi-gamma.org',''],t:'Bid Day',st:'Pending',p:hood,col:'white',sz:{M:24,L:24,XL:12},due:20,L:[T('CHI PHI','Oswald',{size:18,color:'#c8102e',y:30}),T('BID DAY 2026','Graduate',{size:8,color:'#111111',y:60})]},
    {c:['Sigma Chi','Tyler Brooks','tyler@sigmachi-ep.org',''],t:'Parents Weekend',st:'Production',p:tee,col:'carolina',sz:{S:10,M:25,L:25,XL:15,'2XL':5},due:9,paid:true,L:[T('ΣΧ','Noto Serif',{size:34,color:'#1f3a93',y:30}),T('PARENTS WEEKEND','Bebas Neue',{size:10,color:'#ffffff',y:58})]},
    {c:['Kappa Delta','Emma Chen','emma@kd-alpha.org','(555) 330-1200'],t:'Formal 2026',st:'Approved',p:hood,col:'pink',sz:{S:24,M:20,L:12},due:25,half:true,L:[T('ΚΔ','Playfair Display',{size:40,color:'#1f3a93',y:45})]},
    {c:['Pi Kappa Alpha','Sam Ortiz','sam@pike-zeta.org',''],t:'Philanthropy Week',st:'Declined',p:tee,col:'black',sz:{M:6,L:4},due:4,decl:'Below minimum quantity',L:[T('ΠΚΑ','Noto Serif',{size:30,y:35})]},
    {c:['Delta Gamma','Ava Patel','ava@dg-omega.org',''],t:'Anchor Splash',st:'Completed',p:tee,col:'white',sz:{XS:10,S:30,M:30},due:-5,paid:true,L:[T('ΔΓ','Noto Serif',{size:30,color:'#1f3a93',y:30}),T('ANCHOR SPLASH','Graduate',{size:9,color:'#d4af37',y:58})]}
  ].map((d,i)=>{
    const pr=P(d.p),des={productId:d.p,colorId:(pr.colors.find(c=>c.id===d.col)||pr.colors[0]).id,layers:d.L};
    const due=new Date(now+d.due*day).toISOString().slice(0,10),q=quote(des,d.sz,due),at=now-(6-i)*day*1.5;
    return{id:uid(),number:n++,token:uid()+uid(),customer:{org:d.c[0],name:d.c[1],email:d.c[2],phone:d.c[3]},title:d.t,due,notes:'',sizes:d.sz,qty:q.qty,total:q.total,unit:q.unit,cost:q.cost,
      productId:d.p,productName:pr.name,colorName:colorOf(des).name,design:des,status:d.st,paid:!!d.paid,amountPaid:d.paid?q.total:d.half?depositOf(q.total):0,declineReason:d.decl,at,
      history:[{at,text:'Order submitted'},...(d.st!=='Pending'?[{at:at+day/3,text:SLABEL[d.st]+(d.decl?` — ${d.decl}`:'')}]:[])]};
  }).reverse();
  shop.nextOrder=n;await api.saveShop(shop);await api.addOrders(demo);orders=[...demo,...orders];renderAdmin();toast('Demo orders loaded');
};

/* ================= auth (cloud) ================= */
function renderAuth(mode='signin',msg=''){
  showView('auth');
  const c=$('#authCard');
  if(mode==='setup'){
    c.innerHTML=`<h2>Create your shop</h2><p class="muted" style="margin-bottom:18px">You can change all of this later.</p>
      <div class="field"><label>Business name</label><input id="aName" placeholder="Rogger Tees"></div>
      <div class="field"><label>Shop link</label><div class="row"><span class="muted" style="font-size:12px;white-space:nowrap">…?shop=</span><input id="aSlug" placeholder="rogger-tees"></div></div>
      <button class="btn primary" style="width:100%" id="aGo">Create shop</button>
      <p class="hint">We'll start you with a tee and a hoodie you can edit or replace.</p>`;
    const slugify=v=>v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    $('#aName').oninput=e=>{if(!$('#aSlug')._edited)$('#aSlug').value=slugify(e.target.value)};
    $('#aSlug').oninput=e=>{e.target._edited=true};
    $('#aGo').onclick=async e=>{const name=$('#aName').value.trim(),slug=slugify($('#aSlug').value);if(!name||slug.length<2)return toast('Add a name and link');
      e.target.disabled=true;try{await api.createShop({name,slug});await enterHQ()}catch(err){oops(/duplicate|unique/i.test(err.message)?new Error('That shop link is taken — try another'):err);e.target.disabled=false}};
    return;
  }
  if(mode==='newpass'){
    c.innerHTML=`<h2>Choose a new password</h2><div class="field" style="margin-top:14px"><input id="aPw" type="password" placeholder="New password (8+ characters)" autocomplete="new-password"></div><button class="btn primary" style="width:100%" id="aGo">Save password</button>`;
    $('#aGo').onclick=async()=>{try{await api.updatePassword($('#aPw').value);toast('Password updated');location.hash='#hq';enterHQ()}catch(e){oops(e)}};
    return;
  }
  const up=mode==='signup';
  c.innerHTML=`<h2>${up?'Create your account':'Sign in to Business HQ'}</h2>
    <p class="muted" style="margin-bottom:18px">${up?'Start your own design studio in a few minutes.':'Manage orders, products and payments.'}</p>
    ${msg?`<div class="notice good" style="margin-bottom:14px">${msg}</div>`:''}
    <div class="field"><label>Email</label><input id="aEmail" type="email" autocomplete="email"></div>
    <div class="field"><label>Password</label><input id="aPw" type="password" autocomplete="${up?'new-password':'current-password'}" placeholder="${up?'8+ characters':''}"></div>
    <button class="btn primary" style="width:100%" id="aGo">${up?'Create account':'Sign in'}</button>
    <div class="row" style="justify-content:space-between;margin-top:14px;font-size:13px">
      <a href="#" id="aSwap">${up?'Have an account? Sign in':'New here? Create a shop'}</a>${up?'':'<a href="#" id="aForgot">Forgot password?</a>'}</div>`;
  $('#aSwap').onclick=e=>{e.preventDefault();renderAuth(up?'signin':'signup')};
  $('#aForgot')&&($('#aForgot').onclick=async e=>{e.preventDefault();const em=$('#aEmail').value.trim();if(!em)return toast('Enter your email first');try{await api.resetPassword(em);renderAuth('signin','Check your email for a reset link.')}catch(err){oops(err)}});
  const go=async()=>{const em=$('#aEmail').value.trim(),pw=$('#aPw').value;if(!em||!pw)return toast('Enter your email and password');
    try{if(up){if(pw.length<8)return toast('Use at least 8 characters');const live=await api.signUp(em,pw);if(!live)return renderAuth('signin','Check your email to confirm your account, then sign in.')}else await api.signIn(em,pw);await enterHQ()}catch(e){oops(e)}};
  $('#aGo').onclick=go;$('#aPw').onkeydown=e=>{if(e.key==='Enter')go()};
}
$('#acctBtn').onclick=async()=>{await api.signOut();user=null;isOwner=false;location.href=api.siteUrl};

/* ================= boot & routing ================= */
async function reloadOwner(){const d=await api.ownerData();if(d?.shop){orders=d.orders;products=d.products;shop.nextOrder=d.shop.nextOrder}}
function startStudio(){applyBrand();loadDraft();renderLib();renderCatalog();renderStudio();showView('client')}
function switchMode(m){
  if(m==='admin'){
    if(!CLOUD&&shop.pin&&sessionStorage.getItem('rtp_unlocked')!==shop.pin){const v=prompt('Enter HQ passcode');if(v!==shop.pin){if(v!==null)toast('Wrong passcode');return}sessionStorage.setItem('rtp_unlocked',v)}
    history.replaceState(null,'',(CLOUD?'?':location.pathname+location.search)+'#hq');showView('admin');renderAdmin();
  }else{
    history.replaceState(null,'',CLOUD?`?shop=${encodeURIComponent(shop.slug)}`:location.pathname+location.search.replace(/order=[^&]*&?/,''));
    renderCatalog();renderStudio();showView('client');
  }
}
$$('#modeToggle button').forEach(b=>b.onclick=()=>switchMode(b.dataset.mode));
$$('.modal').forEach(m=>m.addEventListener('pointerdown',e=>{if(e.target===m)m.classList.remove('on')}));
addEventListener('keydown',e=>{if(e.key==='Escape'){$$('.modal').forEach(m=>m.classList.remove('on'));closeDrawer()}});

async function enterHQ(){
  user=await api.user();
  if(!user)return renderAuth(location.hash==='#hq-signup'?'signup':'signin');
  const d=await api.ownerData();
  if(!d.shop)return renderAuth('setup');
  shop=d.shop;products=d.products;orders=d.orders;isOwner=true;
  applyBrand();loadDraft();renderLib();renderCatalog();renderStudio();
  if(location.hash==='#hq-payments'){apane='settings';payStatus=null}
  history.replaceState(null,'','?#hq');
  showView('admin');goPane(apane);
  api.onOrders((type,o,oldId)=>{
    if(type==='INSERT'&&o&&!orders.some(x=>x.id===o.id)){orders.unshift(o);toast(`New order #${o.number} from ${o.customer.org}`)}
    else if(type==='UPDATE'&&o){const i=orders.findIndex(x=>x.id===o.id);if(i>=0)orders[i]=o}
    else if(type==='DELETE')orders=orders.filter(x=>x.id!==oldId);
    renderAdmin();if(drawerId&&type!=='DELETE'&&o?.id===drawerId)openOrder(drawerId);
  });
}

async function boot(){
  const qs=new URLSearchParams(location.search), slug=qs.get('shop'), token=qs.get('order'), paid=qs.get('paid')==='1';
  try{
    if(!CLOUD){
      const d=await api.ownerData();shop=d.shop;products=d.products;orders=d.orders;isOwner=true;
      startStudio();if(location.hash==='#hq')switchMode('admin');if(token)openStatus(token);return;
    }
    api.onAuth((ev)=>{if(ev==='PASSWORD_RECOVERY')renderAuth('newpass')});
    user=await api.user();
    if(api.recovery&&user)return renderAuth('newpass');
    if(location.hash.startsWith('#hq')||qs.has('hq'))return enterHQ();
    if(slug){
      const sf=await api.storefront(slug);
      if(!sf){applyBrand();showView('landing');return toast("That shop doesn't exist")}
      shop=sf.shop;products=sf.products;
      if(user){const d=await api.ownerData().catch(()=>null);if(d?.shop?.id===shop.id){isOwner=true;products=d.products;orders=d.orders}}
      startStudio();if(token)openStatus(token,paid);return;
    }
    applyBrand();showView('landing');
  }catch(e){oops(e);$('#boot').textContent='Could not load. Check your connection and refresh.'}
}
addEventListener('hashchange',()=>{if(CLOUD&&location.hash.startsWith('#hq')&&!$('#admin').classList.contains('on'))enterHQ()});
boot();
