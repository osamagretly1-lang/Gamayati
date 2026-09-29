const DB_NAME='GamayatiDB',DB_VERSION=5;
let db,clients=[],products=[],inventory=[],invoices=[],settings={monthEndDay:25};
let deferredInstallPrompt=null;
const $=id=>document.getElementById(id);
const now=()=>new Date().toISOString();
function localMonthKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function localDateTime(iso){const d=iso instanceof Date?iso:new Date(iso);return d.toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'})}
function monthLabel(key){const [y,m]=String(key).split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('ar-EG',{month:'long',year:'numeric'})}
function money(n){return Number(n||0).toFixed(2)}
function qtyText(n){const v=Number(n||0);return Number.isInteger(v)?String(v):v.toFixed(2)}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function toast(msg){const el=$('toast');el.textContent=msg;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',2300)}

function openDB(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=e=>{const d=e.target.result;
    const stores=[
      ['clients',{keyPath:'id',autoIncrement:true}],['products',{keyPath:'id',autoIncrement:true}],
      ['inventory',{keyPath:'productId'}],['invoices',{keyPath:'id',autoIncrement:true}],
      ['invoiceItems',{keyPath:'id',autoIncrement:true}],['inventoryTransactions',{keyPath:'id',autoIncrement:true}],
      ['auditLogs',{keyPath:'id',autoIncrement:true}],['settings',{keyPath:'key'}]
    ];
    for(const [name,opts] of stores) if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,opts);
  };
  r.onsuccess=()=>{db=r.result;db.onversionchange=()=>db.close();resolve()};
  r.onerror=()=>reject(r.error||new Error('تعذر فتح قاعدة البيانات'));
})}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function read(store,key){return new Promise((res,rej)=>{const r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,value){return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error||new Error('فشل الحفظ'));tx.objectStore(store).put(value)})}
function add(store,value){return new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');let id;tx.oncomplete=()=>res(id);tx.onerror=()=>rej(tx.error||new Error('فشل الإضافة'));const r=tx.objectStore(store).add(value);r.onsuccess=()=>id=r.result;r.onerror=()=>rej(r.error)})}
function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error||new Error('فشلت المعاملة'));tx.onabort=()=>rej(tx.error||new Error('أُلغيت المعاملة'))})}
function activeClients(){return clients.filter(c=>!c.archived)}
function activeProducts(){return products.filter(p=>!p.archived)}
function sortByName(list){return list.slice().sort((a,b)=>String(a.fullName||a.name||'').localeCompare(String(b.fullName||b.name||''),'ar',{sensitivity:'base'}))}

async function migrateData(){
  let changed=false;
  // Repair legacy products and inventories without touching historical invoice snapshots.
  const maxCode=products.reduce((m,p)=>Math.max(m,Number(String(p.code||'').replace(/\D/g,'')||0)),0);
  let next=maxCode+1;
  for(const p of products){
    const patch={};
    if(!p.code){patch.code=`G${String(next++).padStart(4,'0')}`}
    if(p.archived==null)patch.archived=false;
    if(p.minimumStock==null)patch.minimumStock=0;
    if(p.unit==null||!String(p.unit).trim())patch.unit='وحدة';
    if(Object.keys(patch).length){await put('products',{...p,...patch});changed=true}
  }
  const pids=new Set(inventory.map(i=>i.productId));
  for(const p of products){if(!pids.has(p.id)){await put('inventory',{productId:p.id,quantity:0,updatedAt:now()});changed=true}}
  // Ensure clients createdAt exists for month-history boundaries.
  for(const c of clients){if(!c.createdAt){await put('clients',{...c,createdAt:c.updatedAt||now()});changed=true}}
  return changed;
}

async function refresh(){
  clients=await all('clients');products=await all('products');inventory=await all('inventory');invoices=await all('invoices');
  const s=await read('settings','monthEndDay');settings.monthEndDay=Number(s?.value||25);
  try{await migrateData()}catch(e){console.warn('migration warning',e)}
  // Re-read after migration.
  if(products.some(p=>!p.code)||inventory.length<products.length||clients.some(c=>!c.createdAt)){products=await all('products');inventory=await all('inventory');clients=await all('clients')}
  $('monthEndDay').value=settings.monthEndDay;
  renderDashboard();renderClients();renderProducts();renderDispenseSearch();renderInvoices();renderArchive();ensureFirstLine();
}

function currentStatus(c){
  const m=localMonthKey();
  const invs=invoices.filter(i=>i.clientId===c.id&&i.serviceMonth===m);
  if(invs.some(i=>i.status==='CONFIRMED'&&!i.reversed)) return ['green','✓ تم الصرف'];
  if(new Date().getDate()>settings.monthEndDay) return ['red','* فات عليه الشهر'];
  return ['yellow','! لم يصرف'];
}
function renderDashboard(){
  const activeC=activeClients(),activeP=activeProducts(),m=localMonthKey();
  $('statClients').textContent=activeC.length;$('statProducts').textContent=activeP.length;
  $('statDispensed').textContent=new Set(invoices.filter(i=>i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed).map(i=>i.clientId)).size;
  $('statLowStock').textContent=activeP.filter(p=>Number(inventory.find(i=>i.productId===p.id)?.quantity||0)<=Number(p.minimumStock||0)).length;
  $('currentMonthLabel').textContent=monthLabel(m);
  const q=($('dashboardClientSearch')?.value||'').trim().toLowerCase();
  const list=activeC.filter(c=>[c.fullName,c.cardNumber].join(' ').toLowerCase().includes(q));
  $('monthlyStatus').innerHTML=list.map(c=>{const [cl,tx]=currentStatus(c);return `<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">بطاقة: ${esc(c.cardNumber)}</div></div><span class="status ${cl}">${tx}</span></div>`}).join('')||'<div class="muted">لا يوجد عملاء مطابقون.</div>';
}

function renderClients(){
  const q=($('clientSearch').value||'').trim().toLowerCase();
  const list=sortByName(activeClients()).filter(c=>[c.fullName,c.cardNumber,c.phone].join(' ').toLowerCase().includes(q));
  $('clientsList').innerHTML=list.map(c=>{
    const [cl,tx]=currentStatus(c);return `<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">البطاقة: ${esc(c.cardNumber)} | الرقم السري محفوظ | التموين: ${qtyText(c.rationCount)} | الخبز: ${qtyText(c.flourCount)}</div><div class="muted">${esc(c.phone||'')} ${esc(c.address||'')}</div>${c.notes?`<div class="note-box">${esc(c.notes)}</div>`:''}</div><span class="status ${cl}">${tx}</span><div class="client-actions"><button class="secondary" onclick="showClientDetails(${c.id})">سجل الأشهر</button><button class="secondary" onclick="editClient(${c.id})">تعديل</button><button class="danger" onclick="archiveClient(${c.id})">أرشفة</button></div></div>`
  }).join('')||'<div class="panel">لا يوجد عملاء مطابقون.</div>';
}

function renderProducts(){
  const q=($('productSearch').value||'').trim().toLowerCase();
  const list=activeProducts().filter(p=>String(p.name||'').toLowerCase().includes(q));
  $('productsList').innerHTML=list.map(p=>{const st=inventory.find(x=>x.productId===p.id),qty=Number(st?.quantity||0),low=qty<=Number(p.minimumStock||0);return `<div class="item"><div class="info"><b>${esc(p.name)}</b><div class="muted">الكود: ${esc(p.code)} | الوحدة: ${esc(p.unit||'وحدة')} | السعر: ${money(p.price)} جنيه</div><div>المخزون: <span class="stock-pill ${low?'stock-low':''}">${qtyText(qty)}</span> | الحد الأدنى: ${qtyText(p.minimumStock)}</div></div><div class="product-actions"><button class="primary" onclick="openReceipt(${p.id})">استلام مخزون</button><button class="secondary" onclick="editProduct(${p.id})">تعديل</button><button class="danger" onclick="archiveProduct(${p.id})">أرشفة</button></div></div>`}).join('')||'<div class="panel">لا توجد أصناف مطابقة.</div>';
}

function renderDispenseSearch(){
  const q=($('dispClientSearch').value||'').trim().toLowerCase();
  const results=$('dispClientResults');
  if(!$('dispClientId').value){
    if(q.length<1){results.innerHTML='<div class="muted">اكتب اسم العميل أو رقم البطاقة للبحث.</div>';return}
    const list=sortByName(activeClients()).filter(c=>[c.fullName,c.cardNumber].join(' ').toLowerCase().includes(q)).slice(0,30);
    results.innerHTML=list.map(c=>`<div class="search-result"><div><b>${esc(c.fullName)}</b><div class="muted">${esc(c.cardNumber)}</div></div><button class="primary" type="button" onclick="selectDispClient(${c.id})">اختيار</button></div>`).join('')||'<div class="muted">لا يوجد عميل مطابق.</div>';
  }else results.innerHTML='';
}
function selectDispClient(id){const c=clients.find(x=>x.id===Number(id)&&!x.archived);if(!c)return;$('dispClientId').value=c.id;$('dispClientSearch').value=c.fullName;$('dispClientResults').innerHTML='';$('selectedClientCard').className='selected-card';$('selectedClientCard').innerHTML=`<b>${esc(c.fullName)}</b><div class="muted">بطاقة: ${esc(c.cardNumber)} | التموين: ${qtyText(c.rationCount)} | الخبز: ${qtyText(c.flourCount)}</div>${c.notes?`<div class="note-box">${esc(c.notes)}</div>`:''}`}
function clearDispClient(){$('dispClientId').value='';$('dispClientSearch').value='';$('selectedClientCard').className='selected-card empty';$('selectedClientCard').textContent='لم يتم اختيار عميل.';renderDispenseSearch()}

function ensureFirstLine(){if(!$('dispenseLines').querySelector('.line'))addLine()}
function addLine(){
  const row=document.createElement('div');row.className='line';
  row.innerHTML=`<select onchange="calcTotal()"><option value="" selected>اختر الصنف</option>${activeProducts().map(p=>`<option value="${p.id}">${esc(p.name)} — ${money(p.price)} جنيه</option>`).join('')}</select><input type="number" min="0.01" step="0.01" value="1" oninput="calcTotal()"><span class="lineTotal">0.00</span><button type="button" class="danger" onclick="this.parentElement.remove();calcTotal()">×</button>`;
  $('dispenseLines').appendChild(row);calcTotal();
}
function calcTotal(){let t=0;document.querySelectorAll('#dispenseLines .line').forEach(r=>{const p=products.find(x=>x.id===Number(r.querySelector('select').value));const q=Number(r.querySelector('input').value||0);const v=p&&q>0?q*Number(p.price):0;r.querySelector('.lineTotal').textContent=money(v);t+=v});$('dispTotal').textContent=money(t)}

async function confirmDispense(){
  const clientId=Number($('dispClientId').value);if(!clientId)return alert('اختر العميل بالبحث أولًا.');
  const c=clients.find(x=>x.id===clientId);if(!c)return alert('العميل غير موجود.');
  const m=localMonthKey();
  if(invoices.some(i=>i.clientId===clientId&&i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed))return alert('هذا العميل لديه صرف مؤكد بالفعل هذا الشهر.');
  const lines=[...document.querySelectorAll('#dispenseLines .line')].map(r=>({productId:Number(r.querySelector('select').value),quantity:Number(r.querySelector('input').value)})).filter(x=>x.productId&&x.quantity>0);
  if(!lines.length)return alert('أضف صنفًا واحدًا على الأقل.');
  const seen=new Set();for(const l of lines){if(seen.has(l.productId))return alert('لا تكرر نفس الصنف في الفاتورة.');seen.add(l.productId)}
  const prepared=[];for(const l of lines){const p=products.find(x=>x.id===l.productId),st=inventory.find(x=>x.productId===l.productId);if(!p||!st)return alert('يوجد صنف غير صالح.');if(Number(st.quantity)<l.quantity)return alert(`المخزون غير كافٍ للصنف: ${p.name}`);prepared.push({productId:p.id,productNameSnapshot:p.name,quantity:l.quantity,unitPrice:Number(p.price),lineTotal:l.quantity*Number(p.price)})}
  const total=prepared.reduce((s,x)=>s+x.lineTotal,0);const notes=$('dispenseNotes').value.trim();
  if(!confirm(`تأكيد الصرف النهائي؟\nالعميل: ${c.fullName}\nالإجمالي: ${money(total)} جنيه\nلا يمكن حذف الفاتورة بعد التأكيد.`))return;
  try{
    const tx=db.transaction(['invoices','invoiceItems','inventory','inventoryTransactions','auditLogs'],'readwrite');
    const invoiceStore=tx.objectStore('invoices'),itemsStore=tx.objectStore('invoiceItems'),invStore=tx.objectStore('inventory'),movesStore=tx.objectStore('inventoryTransactions'),logStore=tx.objectStore('auditLogs');
    const invoiceReq=invoiceStore.add({clientId,clientNameSnapshot:c.fullName,cardNumberSnapshot:c.cardNumber,serviceMonth:m,issuedAt:now(),status:'CONFIRMED',reversed:false,total,notes});
    invoiceReq.onerror=()=>{try{tx.abort()}catch{}};
    invoiceReq.onsuccess=()=>{
      const invoiceId=invoiceReq.result;
      for(const x of prepared){
        const st=inventory.find(y=>y.productId===x.productId),before=Number(st.quantity),after=before-x.quantity;st.quantity=after;st.updatedAt=now();
        itemsStore.add({invoiceId,...x});invStore.put(st);movesStore.add({productId:x.productId,type:'SALE',quantityChange:-x.quantity,quantityBefore:before,quantityAfter:after,referenceId:invoiceId,note:notes,createdAt:now()});
      }
      logStore.add({action:'CREATE_DISPENSE',entityType:'invoice',entityId:invoiceId,createdAt:now()});
    };
    await txDone(tx);
    $('dispClientId').value='';$('dispClientSearch').value='';$('dispenseNotes').value='';$('selectedClientCard').className='selected-card empty';$('selectedClientCard').textContent='لم يتم اختيار عميل.';$('dispenseLines').innerHTML='';ensureFirstLine();
    await refresh();toast('تم حفظ الصرف والفاتورة وخصم المخزون بنجاح.');
  }catch(e){console.error(e);alert('حدث خطأ في حفظ الصرف. لم يتم اعتماد المعاملة.')}
}

async function reverseInvoice(id){
  const inv=invoices.find(i=>i.id===id);if(!inv||inv.reversed)return;
  if(!confirm(`سيتم عكس الفاتورة #${id} وإرجاع كمياتها للمخزون مع الاحتفاظ بالفاتورة الأصلية. متابعة؟`))return;
  try{
    const tx=db.transaction(['invoices','invoiceItems','inventory','inventoryTransactions','auditLogs'],'readwrite');
    const invoiceStore=tx.objectStore('invoices'),itemsStore=tx.objectStore('invoiceItems'),invStore=tx.objectStore('inventory'),movesStore=tx.objectStore('inventoryTransactions'),logStore=tx.objectStore('auditLogs');
    const itemsReq=itemsStore.getAll(),inventoryReq=invStore.getAll();let items=null,stockRows=null,ready=false;
    const applyReverse=()=>{if(ready||!items||!stockRows)return;ready=true;
      const invoiceItems=items.filter(x=>x.invoiceId===id);
      inv.reversed=true;inv.reversedAt=now();invoiceStore.put(inv);
      for(const x of invoiceItems){const st=stockRows.find(y=>y.productId===x.productId);if(!st){try{tx.abort()}catch{};return}const before=Number(st.quantity),after=before+Number(x.quantity);st.quantity=after;st.updatedAt=now();invStore.put(st);movesStore.add({productId:x.productId,type:'REVERSAL',quantityChange:x.quantity,quantityBefore:before,quantityAfter:after,referenceId:id,note:`عكس الفاتورة #${id}`,createdAt:now()})}
      logStore.add({action:'REVERSE_INVOICE',entityType:'invoice',entityId:id,createdAt:now()});
    };
    itemsReq.onsuccess=()=>{items=itemsReq.result;applyReverse()};inventoryReq.onsuccess=()=>{stockRows=inventoryReq.result;applyReverse()};
    await txDone(tx);await refresh();toast('تم عكس الفاتورة وإرجاع المخزون مع الاحتفاظ بالأصل.');
  }catch(e){console.error(e);alert('فشل عكس الفاتورة ولم يتم اعتماد العملية.')}
}

function renderInvoices(){
  const q=($('invoiceSearch').value||'').trim().toLowerCase();
  const list=invoices.slice().sort((a,b)=>b.id-a.id).filter(i=>[i.id,i.clientNameSnapshot,i.cardNumberSnapshot,i.serviceMonth].join(' ').toLowerCase().includes(q));
  $('invoicesList').innerHTML=list.map(i=>`<div class="item invoice-card" onclick="showInvoiceDetails(${i.id})"><div class="info"><b>فاتورة #${i.id}</b><div>${esc(i.clientNameSnapshot)} — ${esc(i.cardNumberSnapshot)}</div><div class="invoice-meta"><span class="muted">${monthLabel(i.serviceMonth)}</span><span class="muted">${localDateTime(i.issuedAt)}</span><span class="muted">${money(i.total)} جنيه</span>${i.notes?'<span class="status yellow">بها ملاحظة</span>':''}</div>${i.notes?`<div class="note-box">${esc(i.notes)}</div>`:''}</div><div class="invoice-actions" onclick="event.stopPropagation()"><span class="status ${i.reversed?'red':'green'}">${i.reversed?'معكوسة':'مؤكدة'}</span>${!i.reversed?`<button class="danger" type="button" onclick="reverseInvoice(${i.id})">عكس العملية</button>`:''}<button class="secondary" type="button" onclick="showInvoiceDetails(${i.id})">فتح</button></div></div>`).join('')||'<div class="panel">لا توجد فواتير مطابقة.</div>';
}
function openHistoryInvoice(id){$('clientDetailsDialog').close();showInvoiceDetails(id)}

async function showInvoiceDetails(id){
  const inv=invoices.find(i=>i.id===id);if(!inv)return;const items=(await all('invoiceItems')).filter(x=>x.invoiceId===id);
  $('invoiceDetailsContent').innerHTML=`<div class="invoice-detail-head"><div><h3>تفاصيل الفاتورة #${inv.id}</h3><div><b>العميل:</b> ${esc(inv.clientNameSnapshot)}</div><div><b>رقم البطاقة:</b> ${esc(inv.cardNumberSnapshot)}</div><div><b>الشهر:</b> ${monthLabel(inv.serviceMonth)}</div><div><b>التاريخ:</b> ${localDateTime(inv.issuedAt)}</div></div><span class="status ${inv.reversed?'red':'green'}">${inv.reversed?'معكوسة':'مؤكدة'}</span></div>
    ${inv.notes?`<div class="note-box"><b>ملاحظات الفاتورة:</b><br>${esc(inv.notes)}</div>`:''}
    <table class="invoice-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.productNameSnapshot)}</td><td>${qtyText(x.quantity)}</td><td>${money(x.unitPrice)}</td><td>${money(x.lineTotal)}</td></tr>`).join('')}</tbody></table>
    <div class="invoice-total">الإجمالي: ${money(inv.total)} جنيه</div>${inv.reversed?`<div class="warning">تم عكس هذه العملية بتاريخ ${localDateTime(inv.reversedAt)}. الفاتورة الأصلية محفوظة ولا تُحذف.</div>`:''}`;
  $('invoiceDialog').showModal();
}

function clientMonths(c){
  const start=new Date(c.createdAt||c.updatedAt||now());let key=localMonthKey(start),end=localMonthKey();const out=[];
  while(key<=end){out.push(key);const [y,m]=key.split('-').map(Number);const d=new Date(y,m,1);d.setMonth(d.getMonth()+1);key=localMonthKey(d)}
  if(!out.length)out.push(end);return out;
}
async function showClientDetails(id){
  const c=clients.find(x=>x.id===id);if(!c)return;const months=clientMonths(c);
  const invs=invoices.filter(i=>i.clientId===id);
  const rows=months.slice().reverse().map(m=>{const mi=invs.filter(i=>i.serviceMonth===m);const active=mi.find(i=>i.status==='CONFIRMED'&&!i.reversed),reversed=mi.some(i=>i.reversed);const label=active?'✓ تم الصرف':(reversed?'↩ تم عكس العملية':'— لم يصرف');const cl=active?'green':(reversed?'gray':(m===localMonthKey()&&new Date().getDate()>settings.monthEndDay?'red':'yellow'));return `<div class="history-row"><div><b>${esc(monthLabel(m))}</b></div><div><span class="status ${cl}">${label}</span>${active?` <span class="muted">${localDateTime(active.issuedAt)}</span>`:''}</div><div>${active?`<button class="secondary" onclick="openHistoryInvoice(${active.id})">الفاتورة</button>`:''}</div></div>`}).join('');
  const invCount=invs.filter(i=>i.status==='CONFIRMED'&&!i.reversed).length;
  $('clientDetailsContent').innerHTML=`<h3>سجل العميل: ${esc(c.fullName)}</h3><div class="selected-card"><b>رقم البطاقة:</b> ${esc(c.cardNumber)}<br><b>عدد أفراد التموين:</b> ${qtyText(c.rationCount)} — <b>الخبز:</b> ${qtyText(c.flourCount)}<br><b>الهاتف:</b> ${esc(c.phone||'—')}<br><b>العنوان:</b> ${esc(c.address||'—')}</div>${c.notes?`<div class="note-box"><b>ملاحظات العميل:</b><br>${esc(c.notes)}</div>`:''}<div class="muted">إجمالي عمليات الصرف المؤكدة المحفوظة: ${invCount}</div><div class="history"><h4>سجل كل الشهور</h4>${rows}</div>`;
  $('clientDetailsDialog').showModal();
}

function editClient(id){
  const c=clients.find(x=>x.id===id);if(!c)return;$('clientId').value=c.id;$('clientName').value=c.fullName;$('cardNumber').value=c.cardNumber;$('secretNumber').value=c.secretNumber||'';$('rationCount').value=c.rationCount??0;$('flourCount').value=c.flourCount??0;$('phone').value=c.phone||'';$('address').value=c.address||'';$('clientNotes').value=c.notes||'';$('clientDialogTitle').textContent='تعديل عميل';$('clientDialog').showModal();
}
async function archiveClient(id){if(!confirm('أرشفة هذا العميل؟ البيانات لن تُحذف.'))return;const c=clients.find(x=>x.id===id);if(!c)return;c.archived=true;c.updatedAt=now();await put('clients',c);await refresh();toast('تمت أرشفة العميل.')}
async function restoreClient(id){const c=clients.find(x=>x.id===id);if(!c)return;c.archived=false;c.updatedAt=now();await put('clients',c);await refresh();toast('تمت إعادة العميل من الأرشيف.')}

function editProduct(id){const p=products.find(x=>x.id===id);if(!p)return;$('productId').value=p.id;$('productDialogTitle').textContent='تعديل صنف';$('productName').value=p.name;$('productCode').value=p.code;$('productUnit').value=p.unit||'وحدة';$('productPrice').value=p.price;$('minimumStock').value=p.minimumStock??0;$('openingStock').value=inventory.find(x=>x.productId===id)?.quantity||0;$('openingStock').disabled=true;$('productEditHint').hidden=false;$('openingStockWrap').querySelector('input').classList.add('hidden');$('openingStockWrap').classList.add('hidden');$('productDialog').showModal()}
function prepareNewProductDialog(){$('productForm').reset();$('productId').value='';$('productDialogTitle').textContent='إضافة صنف';$('productCode').value='سيتولد تلقائيًا';$('openingStock').value=0;$('openingStock').disabled=false;$('openingStockWrap').classList.remove('hidden');$('productEditHint').hidden=true;$('productDialog').showModal()}
async function archiveProduct(id){if(!confirm('أرشفة هذا الصنف؟ المخزون وسجل الحركات سيظل محفوظًا.'))return;const p=products.find(x=>x.id===id);if(!p)return;p.archived=true;p.updatedAt=now();await put('products',p);await refresh();toast('تمت أرشفة الصنف.')}
async function restoreProduct(id){const p=products.find(x=>x.id===id);if(!p)return;p.archived=false;p.updatedAt=now();await put('products',p);await refresh();toast('تمت إعادة الصنف من الأرشيف.')}

function openReceipt(id){const p=products.find(x=>x.id===id);if(!p)return;$('receiptProductId').value=id;$('receiptProductName').textContent=`${p.name} — المخزون الحالي: ${qtyText(inventory.find(x=>x.productId===id)?.quantity||0)} ${p.unit||'وحدة'}`;$('receiptQty').value='';$('receiptNotes').value='';$('receiptDialog').showModal()}

async function receiveStock(e){
  e.preventDefault();const pid=Number($('receiptProductId').value),qty=Number($('receiptQty').value),p=products.find(x=>x.id===pid);if(!p||!qty||qty<=0)return alert('أدخل كمية صحيحة.');
  try{const tx=db.transaction(['inventory','inventoryTransactions','auditLogs'],'readwrite');const invStore=tx.objectStore('inventory'),moves=tx.objectStore('inventoryTransactions'),logs=tx.objectStore('auditLogs');const getReq=invStore.get(pid);getReq.onsuccess=()=>{const st=getReq.result||{productId:pid,quantity:0};const before=Number(st.quantity||0),after=before+qty;st.quantity=after;st.updatedAt=now();invStore.put(st);moves.add({productId:pid,type:'RECEIPT',quantityChange:qty,quantityBefore:before,quantityAfter:after,note:$('receiptNotes').value.trim(),createdAt:now()});logs.add({action:'RECEIVE_STOCK',entityType:'product',entityId:pid,createdAt:now()})};await txDone(tx);$('receiptDialog').close();await refresh();toast(`تم استلام ${qtyText(qty)} ${p.unit||'وحدة'} من ${p.name}.`)}catch(err){console.error(err);alert('فشل تسجيل الاستلام.')}
}

function renderArchive(){
  const ac=clients.filter(c=>c.archived),ap=products.filter(p=>p.archived);
  $('archivedClientsList').innerHTML=ac.map(c=>`<div class="archive-entry"><b>${esc(c.fullName)}</b><div class="muted">البطاقة: ${esc(c.cardNumber)}</div><button class="secondary" onclick="restoreClient(${c.id})">إعادة للعملاء</button></div>`).join('')||'<div class="muted">لا يوجد عملاء مؤرشفون.</div>';
  $('archivedProductsList').innerHTML=ap.map(p=>`<div class="archive-entry"><b>${esc(p.name)}</b><div class="muted">الكود: ${esc(p.code)} | المخزون: ${qtyText(inventory.find(x=>x.productId===p.id)?.quantity||0)}</div><button class="secondary" onclick="restoreProduct(${p.id})">إعادة للأصناف</button></div>`).join('')||'<div class="muted">لا توجد أصناف مؤرشفة.</div>';
}

async function backup(){
  const data={version:5,exportedAt:now(),app:'Gamayati',clients,products,inventory,invoices,invoiceItems:await all('invoiceItems'),inventoryTransactions:await all('inventoryTransactions'),auditLogs:await all('auditLogs'),settings:await all('settings')};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`gamayati-backup-${localMonthKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('تم إنشاء النسخة الاحتياطية.')
}
async function restoreData(file){
  if(!file) return;const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.clients)||!Array.isArray(data.products)||!Array.isArray(data.invoices))throw Error('ملف النسخة الاحتياطية غير صالح.');
  if(!confirm('الاسترجاع سيستبدل البيانات الحالية. هل لديك نسخة احتياطية من الوضع الحالي؟'))return;
  const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'];
  await new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('أُلغيت المعاملة'));for(const n of names){const s=tx.objectStore(n);s.clear();for(const x of(data[n]||[]))s.put(x)}});
  await refresh();toast('تم استرجاع النسخة الاحتياطية بنجاح.')
}

async function resetAll(){
  if(!confirm('تحذير شديد: سيتم حذف كل العملاء والأصناف والفواتير والحركات من هذا الجهاز. متابعة؟'))return;
  if(prompt('للتأكيد الثاني، اكتب كلمة: حذف الكل')!=='حذف الكل')return alert('تم إلغاء الحذف.');
  if(prompt('للتأكيد النهائي، أدخل كلمة المرور')!=='Osama@Rania@122026')return alert('كلمة المرور غير صحيحة، لم تُحذف أي بيانات.');
  if(!confirm('تأكيد نهائي جدًا: حذف كل البيانات الآن؟'))return;
  const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'];
  await new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);for(const n of names)tx.objectStore(n).clear()});
  settings={monthEndDay:25};await refresh();toast('تم حذف كل البيانات نهائيًا.')
}

async function saveClient(e){
  e.preventDefault();const id=Number($('clientId').value),obj={fullName:$('clientName').value.trim(),cardNumber:$('cardNumber').value.trim(),secretNumber:$('secretNumber').value.trim(),rationCount:Number($('rationCount').value||0),flourCount:Number($('flourCount').value||0),phone:$('phone').value.trim(),address:$('address').value.trim(),notes:$('clientNotes').value.trim(),archived:false,updatedAt:now()};
  if(!obj.fullName||!obj.cardNumber||!obj.secretNumber)return alert('اسم العميل ورقم البطاقة والرقم السري حقول مطلوبة.');
  const duplicate=clients.find(c=>c.id!==id&&!c.archived&&c.cardNumber===obj.cardNumber);if(duplicate)return alert('رقم بطاقة التموين موجود بالفعل لعميل آخر.');
  try{if(id){const old=clients.find(x=>x.id===id);await put('clients',{...old,...obj,id,archived:old.archived})}else{obj.createdAt=now();await add('clients',obj)}$('clientDialog').close();await refresh();toast('تم حفظ بيانات العميل.') }catch(err){console.error(err);alert('حدث خطأ في حفظ العميل.')}
}

async function saveProduct(e){
  e.preventDefault();const id=Number($('productId').value),name=$('productName').value.trim(),unit=$('productUnit').value.trim()||'وحدة',price=Number($('productPrice').value),minimumStock=Number($('minimumStock').value||0);if(!name||!Number.isFinite(price)||price<0)return alert('اسم الصنف والسعر مطلوبان والسعر يجب أن يكون صحيحًا.');
  try{
    if(id){const old=products.find(x=>x.id===id);await put('products',{...old,name,unit,price,minimumStock,updatedAt:now(),archived:old.archived})}
    else{const existingCodes=products.map(p=>Number(String(p.code||'').replace(/\D/g,'')||0));const code=`G${String(Math.max(0,...existingCodes)+1).padStart(4,'0')}`;const obj={name,code,unit,price,minimumStock,archived:false,createdAt:now(),updatedAt:now()};const pid=await add('products',obj);const opening=Number($('openingStock').value||0);await put('inventory',{productId:pid,quantity:Math.max(0,opening),updatedAt:now()});if(opening>0){await add('inventoryTransactions',{productId:pid,type:'RECEIPT',quantityChange:opening,quantityBefore:0,quantityAfter:opening,note:'كمية افتتاحية',createdAt:now()})}}
    $('productDialog').close();await refresh();toast('تم حفظ الصنف.')
  }catch(err){console.error(err);alert('حدث خطأ في حفظ الصنف.')}
}

function go(screen){document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.screen===screen));document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===screen));window.scrollTo({top:0,behavior:'smooth'})}

$('addClientBtn').onclick=()=>{$('clientForm').reset();$('clientId').value='';$('clientDialogTitle').textContent='إضافة عميل';$('clientDialog').showModal()};
$('addProductBtn').onclick=prepareNewProductDialog;
$('clientForm').addEventListener('submit',saveClient);
$('productForm').addEventListener('submit',saveProduct);
$('receiptForm').addEventListener('submit',receiveStock);
$('closeClientDetails').onclick=()=>$('clientDetailsDialog').close();$('closeInvoiceDetails').onclick=()=>$('invoiceDialog').close();
$('clearDispClient').onclick=clearDispClient;$('dispClientSearch').oninput=()=>{if($('dispClientId').value)clearDispClient();else renderDispenseSearch()};
$('addLineBtn').onclick=addLine;$('confirmDispenseBtn').onclick=confirmDispense;
$('clientSearch').oninput=renderClients;$('productSearch').oninput=renderProducts;$('invoiceSearch').oninput=renderInvoices;$('dashboardClientSearch').oninput=renderDashboard;
$('backupBtn').onclick=backup;$('backupSettingsBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=async e=>{try{await restoreData(e.target.files[0])}catch(err){alert('فشل الاسترجاع: '+err.message)}e.target.value=''};
$('saveSettingsBtn').onclick=async()=>{const v=Math.min(28,Math.max(1,Number($('monthEndDay').value||25)));await put('settings',{key:'monthEndDay',value:v});settings.monthEndDay=v;renderDashboard();toast('تم حفظ الإعدادات.')};$('resetBtn').onclick=resetAll;
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.screen));

function setupInstall(){
  const show=()=>{['installBtn','installSettingsBtn'].forEach(id=>{const el=$(id);if(el)el.hidden=!deferredInstallPrompt})};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;show()});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;show();toast('تم تثبيت جمعيتي على الهاتف.')});
  async function install(){if(!deferredInstallPrompt){return alert('زر التثبيت يظهر عندما يكون المتصفح مستوفيًا لشروط التثبيت. استخدم قائمة المتصفح > إضافة إلى الشاشة الرئيسية عند الحاجة.')}deferredInstallPrompt.prompt();const {outcome}=await deferredInstallPrompt.userChoice;if(outcome!=='accepted')return;deferredInstallPrompt=null;show()}
  $('installBtn').onclick=install;$('installSettingsBtn').onclick=install;show();
}

if('serviceWorker' in navigator && location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).catch(console.error)}
setupInstall();
(async()=>{try{await openDB();await refresh()}catch(e){console.error(e);alert('تعذر تشغيل البرنامج. جرّب إعادة تحميل الصفحة.') }})();
