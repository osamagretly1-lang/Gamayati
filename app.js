const DB_NAME='GamayatiDB',DB_VERSION=6;
const APP_VERSION=11, DELETE_PASSWORD='Osama@Rania@122026';
let db,clients=[],products=[],inventory=[],invoices=[],inventoryTransactions=[],settings={monthEndDay:25};
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
  // Preserve legacy secretCode values from older builds, but never auto-generate a secret number.
  for(const c of clients){
    const patch={};
    if(c.secretNumber==null && c.secretCode!=null && String(c.secretCode).trim()) patch.secretNumber=String(c.secretCode).trim();
    if(!c.createdAt){
      const firstInv=invoices.filter(i=>i.clientId===c.id&&i.issuedAt).sort((a,b)=>String(a.issuedAt).localeCompare(String(b.issuedAt)))[0];
      patch.createdAt=firstInv?.issuedAt||c.updatedAt||now();
    }
    if(Object.keys(patch).length){await put('clients',{...c,...patch});changed=true}
  }
  return changed;
}

async function refresh(){
  clients=await all('clients');products=await all('products');inventory=await all('inventory');invoices=await all('invoices');inventoryTransactions=await all('inventoryTransactions');
  inventoryTransactions.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||(Number(b.id||0)-Number(a.id||0)));
  const s=await read('settings','monthEndDay');settings.monthEndDay=Number(s?.value||25);
  try{await migrateData()}catch(e){console.warn('migration warning',e)}
  // Re-read after migration.
  if(products.some(p=>!p.code)||inventory.length<products.length||clients.some(c=>!c.createdAt)||clients.some(c=>c.secretNumber==null&&c.secretCode!=null)){products=await all('products');inventory=await all('inventory');clients=await all('clients')}
  inventoryTransactions=await all('inventoryTransactions');inventoryTransactions.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||(Number(b.id||0)-Number(a.id||0)));
  $('monthEndDay').value=settings.monthEndDay;
  $('reportMonth').value=$('reportMonth').value||localMonthKey();
  renderDashboard();renderClients();renderProducts();renderInventory();renderDispenseSearch();renderInvoices();renderArchive();ensureFirstLine();
}

function invoiceMonthKey(i){
  return reportInvoiceMonth(i)||'';
}

function currentStatus(c){
  const m=localMonthKey();
  const invs=invoices.filter(i=>String(i.clientId)===String(c.id)&&invoiceMonthKey(i)===m);
  if(invs.some(i=>i.status==='CONFIRMED'&&!i.reversed)) return ['green','✓ تم الصرف'];
  if(new Date().getDate()>settings.monthEndDay) return ['red','* فات عليه الشهر'];
  return ['yellow','! لم يصرف'];
}
function renderDashboard(){
  const activeC=activeClients(),activeP=activeProducts(),m=localMonthKey();
  $('statClients').textContent=activeC.length;$('statProducts').textContent=activeP.length;
  $('statDispensed').textContent=new Set(invoices.filter(i=>invoiceMonthKey(i)===m&&i.status==='CONFIRMED'&&!i.reversed).map(i=>i.clientId)).size;
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

function typeLabel(t){return t==='RECEIPT'?'استلام':t==='SALE'?'صرف':t==='REVERSAL'?'عكس صرف':t==='ADJUSTMENT'?'تعديل رصيد':t==='OPENING'?'رصيد افتتاحي':String(t||'حركة')}
function typeClass(t){return t==='RECEIPT'?'green':t==='SALE'?'red':t==='REVERSAL'?'yellow':'blue'}
function productName(id){return products.find(p=>p.id===Number(id))?.name||`صنف #${id}`}
function renderInventory(){
  const q=($('inventorySearch')?.value||'').trim().toLowerCase();
  const list=activeProducts().filter(p=>[p.name,p.code,p.unit].join(' ').toLowerCase().includes(q));
  $('inventoryCards').innerHTML=list.map(p=>{const st=inventory.find(x=>x.productId===p.id),qty=Number(st?.quantity||0),low=qty<=Number(p.minimumStock||0);return `<div class="card stock-card"><div class="row-title"><h3>${esc(p.name)}</h3><span class="code">${esc(p.code||'—')}</span></div><div class="stock-big ${low?'low':''}">${qtyText(qty)}</div><div class="muted">${esc(p.unit||'وحدة')} • حد أدنى ${qtyText(p.minimumStock)}</div><button class="primary full" onclick="openReceipt(${p.id})">＋ استلام مخزون</button></div>`}).join('')||'<div class="panel">لا توجد أصناف.</div>';
  renderInventoryLog();
}
function renderInventoryLog(){
  const q=($('movementSearch')?.value||'').trim().toLowerCase(), type=$('movementType')?.value||'', from=$('movementFrom')?.value||'', to=$('movementTo')?.value||'';
  const list=inventoryTransactions.filter(x=>{const text=`${productName(x.productId)} ${x.note||''} ${x.referenceId||''} ${typeLabel(x.type)}`.toLowerCase();if(q&&!text.includes(q))return false;if(type&&x.type!==type)return false;const d=x.createdAt?new Date(x.createdAt):null;if(from&&d&&d<new Date(from+'T00:00:00'))return false;if(to&&d&&d>new Date(to+'T23:59:59.999'))return false;return true});
  $('inventoryLog').innerHTML=list.map(x=>{const change=Number(x.quantityChange||0);return `<div class="movement item"><div class="info"><div class="row-title"><b>${esc(productName(x.productId))}</b><span class="status ${typeClass(x.type)}">${typeLabel(x.type)}</span></div><div class="muted">التاريخ: ${esc(localDateTime(x.createdAt))}${x.referenceId?` | مرجع: #${esc(x.referenceId)}`:''}</div><div class="muted">قبل: ${qtyText(x.quantityBefore)} → بعد: ${qtyText(x.quantityAfter)}</div>${x.note?`<div class="note-box"><b>الملاحظة:</b> ${esc(x.note)}</div>`:''}</div><b class="movement-qty ${typeClass(x.type)}">${change>0?'+':''}${qtyText(change)}</b></div>`}).join('')||'<div class="panel">لا توجد حركات مطابقة.</div>';
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
  $('invoicesList').innerHTML=list.map(i=>`<div class="item invoice-card" onclick="showInvoiceDetails(${i.id})"><div class="info"><b>فاتورة #${i.id}</b><div>${esc(i.clientNameSnapshot)} — ${esc(i.cardNumberSnapshot)}</div><div class="invoice-meta"><span class="muted">${monthLabel(invoiceMonthKey(i))}</span><span class="muted">${localDateTime(i.issuedAt)}</span><span class="muted">${money(i.total)} جنيه</span>${i.notes?'<span class="status yellow">بها ملاحظة</span>':''}</div>${i.notes?`<div class="note-box">${esc(i.notes)}</div>`:''}</div><div class="invoice-actions" onclick="event.stopPropagation()"><span class="status ${i.reversed?'red':'green'}">${i.reversed?'معكوسة':'مؤكدة'}</span>${!i.reversed?`<button class="danger" type="button" onclick="reverseInvoice(${i.id})">عكس العملية</button>`:''}<button class="secondary" type="button" onclick="showInvoiceDetails(${i.id})">فتح</button></div></div>`).join('')||'<div class="panel">لا توجد فواتير مطابقة.</div>';
}
function openHistoryInvoice(id){$('clientDetailsDialog').close();showInvoiceDetails(id)}

async function showInvoiceDetails(id){
  const inv=invoices.find(i=>i.id===id);if(!inv)return;const items=(await all('invoiceItems')).filter(x=>x.invoiceId===id);
  $('invoiceDetailsContent').innerHTML=`<div class="invoice-detail-head"><div><h3>تفاصيل الفاتورة #${inv.id}</h3><div><b>العميل:</b> ${esc(inv.clientNameSnapshot)}</div><div><b>رقم البطاقة:</b> ${esc(inv.cardNumberSnapshot)}</div><div><b>الشهر:</b> ${monthLabel(invoiceMonthKey(inv))}</div><div><b>التاريخ:</b> ${localDateTime(inv.issuedAt)}</div></div><span class="status ${inv.reversed?'red':'green'}">${inv.reversed?'معكوسة':'مؤكدة'}</span></div>
    ${inv.notes?`<div class="note-box"><b>ملاحظات الفاتورة:</b><br>${esc(inv.notes)}</div>`:''}
    <table class="invoice-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.productNameSnapshot)}</td><td>${qtyText(x.quantity)}</td><td>${money(x.unitPrice)}</td><td>${money(x.lineTotal)}</td></tr>`).join('')}</tbody></table>
    <div class="invoice-total">الإجمالي: ${money(inv.total)} جنيه</div>${inv.reversed?`<div class="warning">تم عكس هذه العملية بتاريخ ${localDateTime(inv.reversedAt)}. الفاتورة الأصلية محفوظة ولا تُحذف.</div>`:''}`;
  $('invoiceDialog').showModal();
}

function clientMonths(c,invs=[]){
  const invoiceMonths=invs.map(invoiceMonthKey).filter(Boolean).sort();
  let start=invoiceMonths[0]||normalizeMonthValue(firstValue(c,['createdAt','updatedAt','date']))||localMonthKey();
  const end=localMonthKey();
  if(start>end)start=end;
  const out=[];
  for(let key=start;key<=end;key=shiftMonth(key,1)) out.push(key);
  if(!out.length)out.push(end);
  return out;
}
async function showClientDetails(id){
  const c=clients.find(x=>String(x.id)===String(id));if(!c)return;
  const invs=invoices.filter(i=>String(i.clientId)===String(id));
  const months=clientMonths(c,invs);
  const rows=months.slice().reverse().map(m=>{
    const mi=invs.filter(i=>invoiceMonthKey(i)===m);
    const active=mi.find(i=>i.status==='CONFIRMED'&&!i.reversed);
    const reversedInv=!active?mi.find(i=>i.reversed):null;
    const fallbackInv=!active&&!reversedInv?mi.find(i=>i.status==='CONFIRMED')||mi[0]:null;
    const shownInv=active||reversedInv||fallbackInv;
    const label=active?'✓ تم الصرف':(reversedInv?'↩ تم عكس العملية':(fallbackInv?'✓ توجد فاتورة محفوظة':'— لم يصرف'));
    const cl=active?'green':(reversedInv?'gray':(fallbackInv?'blue':(m===localMonthKey()&&new Date().getDate()>settings.monthEndDay?'red':'yellow')));
    const dateInv=shownInv?reportInvoiceDate(shownInv):'';
    return `<div class="history-row"><div><b>${esc(monthLabel(m))}</b></div><div><span class="status ${cl}">${label}</span>${shownInv&&dateInv?` <span class="muted">${localDateTime(dateInv)}</span>`:''}</div><div>${shownInv?`<button class="secondary" onclick="openHistoryInvoice(${shownInv.id})">الفاتورة</button>`:''}</div></div>`
  }).join('');
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

function localDateTimeInputValue(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,16)}
function openReceipt(id){const p=products.find(x=>x.id===id);if(!p)return;$('receiptProductId').value=id;$('receiptProductName').textContent=`${p.name} — المخزون الحالي: ${qtyText(inventory.find(x=>x.productId===id)?.quantity||0)} ${p.unit||'وحدة'}`;$('receiptQty').value='';$('receiptDate').value=localDateTimeInputValue();$('receiptNotes').value='';$('receiptDialog').showModal()}

async function receiveStock(e){
  e.preventDefault();const pid=Number($('receiptProductId').value),qty=Number($('receiptQty').value),p=products.find(x=>x.id===pid),note=$('receiptNotes').value.trim();const selectedDate=$('receiptDate').value?new Date($('receiptDate').value):new Date();
  if(!p||!qty||qty<=0)return alert('أدخل كمية صحيحة.');
  if(Number.isNaN(selectedDate.getTime()))return alert('تاريخ الاستلام غير صحيح.');
  try{const tx=db.transaction(['inventory','inventoryTransactions','auditLogs'],'readwrite');const invStore=tx.objectStore('inventory'),moves=tx.objectStore('inventoryTransactions'),logs=tx.objectStore('auditLogs');const getReq=invStore.get(pid);getReq.onerror=()=>{try{tx.abort()}catch{}};getReq.onsuccess=()=>{const st=getReq.result||{productId:pid,quantity:0};const before=Number(st.quantity||0),after=before+qty,at=selectedDate.toISOString();st.quantity=after;st.updatedAt=now();invStore.put(st);moves.add({productId:pid,type:'RECEIPT',quantityChange:qty,quantityBefore:before,quantityAfter:after,note,createdAt:at,recordedAt:now()});logs.add({action:'RECEIVE_STOCK',entityType:'product',entityId:pid,createdAt:now(),note})};await txDone(tx);$('receiptDialog').close();await refresh();toast(`تم استلام ${qtyText(qty)} ${p.unit||'وحدة'} من ${p.name}.`)}catch(err){console.error(err);alert('فشل تسجيل الاستلام. لم يتغير رصيد المخزون.')}
}

function renderArchive(){
  const ac=clients.filter(c=>c.archived),ap=products.filter(p=>p.archived);
  $('archivedClientsList').innerHTML=ac.map(c=>`<div class="archive-entry"><b>${esc(c.fullName)}</b><div class="muted">البطاقة: ${esc(c.cardNumber)}</div><button class="secondary" onclick="restoreClient(${c.id})">إعادة للعملاء</button></div>`).join('')||'<div class="muted">لا يوجد عملاء مؤرشفون.</div>';
  $('archivedProductsList').innerHTML=ap.map(p=>`<div class="archive-entry"><b>${esc(p.name)}</b><div class="muted">الكود: ${esc(p.code)} | المخزون: ${qtyText(inventory.find(x=>x.productId===p.id)?.quantity||0)}</div><button class="secondary" onclick="restoreProduct(${p.id})">إعادة للأصناف</button></div>`).join('')||'<div class="muted">لا توجد أصناف مؤرشفة.</div>';
}

async function backup(){
  const data={app:'Gamayati',version:6,appVersion:APP_VERSION,dbVersion:DB_VERSION,exportedAt:now(),clients,products,inventory,invoices,invoiceItems:await all('invoiceItems'),inventoryTransactions:await all('inventoryTransactions'),auditLogs:await all('auditLogs'),settings:await all('settings')};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`gamayati-backup-${localMonthKey()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('تم إنشاء النسخة الاحتياطية وحفظها كملف JSON.')
}
async function restoreData(file){
  if(!file)return;
  const data=JSON.parse(await file.text());
  if(!data||data.app&&data.app!=='Gamayati'||!Array.isArray(data.clients)||!Array.isArray(data.products)||!Array.isArray(data.invoices)||!Array.isArray(data.inventory)||!Array.isArray(data.invoiceItems)||!Array.isArray(data.inventoryTransactions)||!Array.isArray(data.auditLogs)||!Array.isArray(data.settings))throw Error('ملف النسخة الاحتياطية غير صالح أو ناقص.');
  if(!confirm('تحذير: الاسترجاع سيستبدل كل البيانات الحالية بهذه النسخة. هل توجد لديك نسخة احتياطية من الوضع الحالي؟'))return;
  if(!confirm('تأكيد الاسترجاع: سيتم استبدال العملاء والأصناف والمخزون والفواتير والسجلات بالكامل. متابعة؟'))return;
  const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'];
  await new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('فشلت معاملة الاسترجاع'));tx.onabort=()=>reject(tx.error||new Error('أُلغيت معاملة الاسترجاع'));for(const n of names){const s=tx.objectStore(n);s.clear();for(const x of data[n])s.put(x)}});
  await refresh();toast('تم استرجاع النسخة الاحتياطية بنجاح.')
}

function shiftMonth(key,delta){const [y,m]=String(key).split('-').map(Number);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function monthRange(start,count){return Array.from({length:count},(_,i)=>shiftMonth(start,i))}
function normalizeMonthValue(value){
  if(value===null||value===undefined||value==='')return '';
  if(typeof value==='number'){
    const s=String(value);
    if(/^\d{6}$/.test(s))return s.slice(0,4)+'-'+s.slice(4,6);
    if(/^\d{4}$/.test(s))return '';
  }
  if(value instanceof Date)return Number.isNaN(value.getTime())?'':localMonthKey(value);
  let s=String(value).trim();
  s=s.replace(/^['"]|['"]$/g,'');
  let m=s.match(/^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?$/);
  if(m)return `${m[1]}-${String(Number(m[2])).padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if(m)return `${m[3]}-${String(Number(m[2])).padStart(2,'0')}`;
  const d=new Date(s);
  return Number.isNaN(d.getTime())?'':localMonthKey(d);
}
function firstValue(obj,names){for(const n of names){const v=obj?.[n];if(v!==undefined&&v!==null&&String(v)!=='')return v}return ''}
function reportDateValue(value){
  if(value instanceof Date)return Number.isNaN(value.getTime())?null:value;
  if(typeof value==='number'){const d=new Date(value);return Number.isNaN(d.getTime())?null:d}
  if(value===null||value===undefined||value==='')return null;
  const s=String(value).trim();
  if(/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}$/.test(s)){const p=s.split(/[-\/.]/).map(Number);const d=new Date(p[2],p[1]-1,p[0]);return Number.isNaN(d.getTime())?null:d}
  const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function reportDateText(value){const d=reportDateValue(value);return d?localDateTime(d):''}
function reportInvoiceDate(i){return firstValue(i,['issuedAt','date','createdAt','timestamp','recordedAt','datetime','created_at'])}
function reportInvoiceMonth(i){return normalizeMonthValue(firstValue(i,['serviceMonth','month','period','service_month']))||normalizeMonthValue(reportInvoiceDate(i))}
function reportMoveDate(x){return firstValue(x,['createdAt','recordedAt','date','timestamp','datetime','created_at'])}
function reportMoveMonth(x){return normalizeMonthValue(firstValue(x,['month','period']))||normalizeMonthValue(reportMoveDate(x))}
function reportAuditDate(a){return firstValue(a,['createdAt','recordedAt','date','timestamp','datetime','created_at'])}
function reportAuditMonth(a){return normalizeMonthValue(firstValue(a,['month','period']))||normalizeMonthValue(reportAuditDate(a))}
function reportInvoiceStatus(i){if(i?.reversed)return'معكوسة';const s=String(firstValue(i,['status','state'])||'').toUpperCase();if(['CONFIRMED','COMPLETED','PAID','DONE','مؤكدة','تم الصرف','CONFIRM'].includes(s))return'مؤكدة';return s||'غير محددة'}
function reportIsConfirmed(i){const s=String(firstValue(i,['status','state'])||'').toUpperCase();return ['CONFIRMED','COMPLETED','PAID','DONE','مؤكدة','تم الصرف','CONFIRM'].includes(s)}
function reportClientId(c){return firstValue(c,['id','clientId'])}
function reportProductId(p){return firstValue(p,['id','productId'])}
function reportClientName(rc,id){const c=rc.find(x=>String(reportClientId(x))===String(id));return c?.fullName||c?.name||`عميل #${id}`}
function reportProductName(rp,id){const p=rp.find(x=>String(reportProductId(x))===String(id));return p?.name||p?.productName||`صنف #${id}`}
function reportQty(x){return Number(firstValue(x,['quantityChange','qtyChange','quantity','qty','amount'])||0)}
function reportAuditLabel(a){const key=String(a?.action||a?.type||'');const map={CREATE_DISPENSE:'إنشاء صرف/فاتورة',REVERSE_INVOICE:'عكس فاتورة',RECEIVE_STOCK:'استلام مخزون',CREATE_CLIENT:'إضافة عميل',UPDATE_CLIENT:'تعديل عميل',ARCHIVE_CLIENT:'أرشفة عميل',RESTORE_CLIENT:'إعادة عميل',CREATE_PRODUCT:'إضافة صنف',UPDATE_PRODUCT:'تعديل صنف',ARCHIVE_PRODUCT:'أرشفة صنف',RESTORE_PRODUCT:'إعادة صنف'};return map[key]||key||'نشاط'}
function xlsxSafe(value){if(value===null||value===undefined)return'';if(typeof value==='number')return Number.isFinite(value)?value:String(value);if(value instanceof Date)return reportDateText(value);return String(value)}

function utf8(s){return new TextEncoder().encode(String(s??''))}
function u16(n){return new Uint8Array([n&255,(n>>>8)&255])}
function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
function concatBytes(parts){let len=0;for(const p of parts)len+=p.length;const out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++){c^=bytes[i];for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xEDB88320:0)}return (c^0xFFFFFFFF)>>>0}
function zipStore(entries){const local=[],central=[];let offset=0;for(const e of entries){const name=utf8(e.name),data=e.data instanceof Uint8Array?e.data:utf8(e.data),crc=crc32(data);const lh=concatBytes([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);local.push(lh);const ch=concatBytes([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);central.push(ch);offset+=lh.length}const localBytes=concatBytes(local),centralBytes=concatBytes(central),end=concatBytes([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(centralBytes.length),u32(localBytes.length),u16(0)]);return concatBytes([localBytes,centralBytes,end])}
function xmlEsc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function colLetter(n){let s='';while(n){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s}
function sheetXml(rows,widths=[],sharedIndex=new Map()){
  const lastCol=colLetter(Math.max(1,rows.reduce((m,r)=>Math.max(m,r?.length||0),1)));
  const lastRow=Math.max(1,rows.length);
  let xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><cols>`;
  for(let i=0;i<widths.length;i++)xml+=`<col min="${i+1}" max="${i+1}" width="${Math.min(42,Math.max(9,widths[i]||14))}" customWidth="1"/>`;
  xml+=`</cols><sheetData>`;
  for(let r=0;r<rows.length;r++){
    const row=rows[r]||[];xml+=`<row r="${r+1}">`;
    for(let c=0;c<row.length;c++){
      const ref=colLetter(c+1)+(r+1),v=row[c];if(v===null||v===undefined||v==='')continue;
      const isNum=typeof v==='number'&&Number.isFinite(v);
      if(isNum)xml+=`<c r="${ref}" s="${Number.isInteger(v)?0:2}"><v>${v}</v></c>`;
      else {const idx=sharedIndex.get(String(v));if(idx===undefined)continue;xml+=`<c r="${ref}"${r===0?' s="1"':''} t="s"><v>${idx}</v></c>`;}
    }
    xml+=`</row>`;
  }
  xml+=`</sheetData><autoFilter ref="A1:${lastCol}${lastRow}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  return xml;
}
function buildXlsx(sheetDefs){
  const strings=[],sharedIndex=new Map();
  const addString=v=>{const s=String(v??'');if(!sharedIndex.has(s)){sharedIndex.set(s,strings.length);strings.push(s)}return sharedIndex.get(s)};
  for(const sheet of sheetDefs)for(const row of (sheet.rows||[]))for(const v of (row||[]))if(v!==null&&v!==undefined&&v!==''&&!(typeof v==='number'&&Number.isFinite(v)))addString(v);
  const sharedXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s=>`<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  const overrides=sheetDefs.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const rels=sheetDefs.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
  const sheets=sheetDefs.map((s,i)=>`<sheet name="${xmlEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const files=[
    ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>`],
    ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>تقرير جمعيتي</dc:title><dc:creator>جمعيتي</dc:creator><cp:lastModifiedBy>جمعيتي</cp:lastModifiedBy></cp:coreProperties>`],
    ['docProps/app.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>جمعيتي</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop></Properties>`],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="false"/><bookViews><workbookView showSheetTabs="1"/></bookViews><calcPr calcMode="auto"/><sheets>${sheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheetDefs.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheetDefs.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ['xl/sharedStrings.xml',sharedXml]
  ];
  for(let i=0;i<sheetDefs.length;i++)files.push([`xl/worksheets/sheet${i+1}.xml`,sheetXml(sheetDefs[i].rows,sheetDefs[i].widths,sharedIndex)]);
  return new Uint8Array(zipStore(files.map(([name,data])=>({name,data}))));
}

async function exportReport(){
  try{
    const start=$('reportMonth').value||localMonthKey(),count=Number($('reportSpan').value||1);
    if(!/^\d{4}-\d{2}$/.test(start))return alert('اختر شهر التقرير.');
    const months=monthRange(start,count),monthSet=new Set(months),from=months[0],to=months[months.length-1];

    // Read the database directly at export time. Never depend on the screen cache.
    const [rc,rp,ri,rin,rit,rm,ra,rs]=await Promise.all([
      all('clients'),all('products'),all('inventory'),all('invoices'),all('invoiceItems'),all('inventoryTransactions'),all('auditLogs'),all('settings')
    ]);
    const clientName=id=>reportClientName(rc,id),productNameReport=id=>reportProductName(rp,id);
    const reportMonthEnd=Number(rs.find(x=>x.key==='monthEndDay')?.value||25);
    const invoiceMonth=i=>reportInvoiceMonth(i), invoiceDate=i=>reportInvoiceDate(i);

    const invoiceInRange=rin.filter(i=>monthSet.has(invoiceMonth(i))).slice().sort((a,b)=>(reportDateValue(invoiceDate(a))?.getTime()||0)-(reportDateValue(invoiceDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));
    const moves=rm.filter(x=>monthSet.has(reportMoveMonth(x))).slice().sort((a,b)=>(reportDateValue(reportMoveDate(a))?.getTime()||0)-(reportDateValue(reportMoveDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));
    const audits=ra.filter(a=>monthSet.has(reportAuditMonth(a))).slice().sort((a,b)=>(reportDateValue(reportAuditDate(a))?.getTime()||0)-(reportDateValue(reportAuditDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));
    const detailItems=rit.filter(x=>invoiceInRange.some(i=>String(i.id)===String(x.invoiceId)));

    const rawInvoiceRows=rin.slice().sort((a,b)=>(reportDateValue(invoiceDate(a))?.getTime()||0)-(reportDateValue(invoiceDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));
    const rawMoveRows=rm.slice().sort((a,b)=>(reportDateValue(reportMoveDate(a))?.getTime()||0)-(reportDateValue(reportMoveDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));
    const rawAuditRows=ra.slice().sort((a,b)=>(reportDateValue(reportAuditDate(a))?.getTime()||0)-(reportDateValue(reportAuditDate(b))?.getTime()||0)||Number(a.id||0)-Number(b.id||0));

    const clientsForMonth=m=>rc.filter(c=>{const created=normalizeMonthValue(firstValue(c,['createdAt','updatedAt','date']));return !created||created<=m});
    const statusForClient=(c,m)=>{
      const cinv=rin.filter(i=>String(i.clientId)===String(c.id)&&invoiceMonth(i)===m);
      if(cinv.some(i=>reportIsConfirmed(i)&&!i.reversed))return'تم الصرف';
      const current=localMonthKey(),deadlinePassed=m<current||(m===current&&new Date().getDate()>reportMonthEnd);
      return deadlinePassed?'فات عليه الشهر':'لم يصرف';
    };

    const summaryRows=[['البند','القيمة']];
    summaryRows.push(['الفترة المطلوبة',monthLabel(from)+(count===3?' إلى '+monthLabel(to):'')]);
    summaryRows.push(['العملاء في قاعدة البيانات',rc.length]);
    summaryRows.push(['الأصناف في قاعدة البيانات',rp.length]);
    summaryRows.push(['الفواتير الموجودة على الجهاز',rin.length]);
    summaryRows.push(['فواتير داخل الفترة المطلوبة',invoiceInRange.length]);
    summaryRows.push(['حركات المخزون الموجودة على الجهاز',rm.length]);
    summaryRows.push(['حركات المخزون داخل الفترة المطلوبة',moves.length]);
    summaryRows.push(['سجل النشاط الموجود على الجهاز',ra.length]);
    summaryRows.push(['سجل النشاط داخل الفترة المطلوبة',audits.length]);
    summaryRows.push(['ملاحظة','ورقة "كل البيانات على الجهاز" تحتوي على السجلات الفعلية الموجودة في قاعدة جمعيتي، حتى لو كانت بتاريخ خارج الفترة.']);
    if(!rin.length&&!rm.length&&!ra.length)summaryRows.push(['تنبيه','قاعدة البيانات لا تحتوي حاليًا على فواتير أو حركات مخزون أو سجل نشاط.']);

    const clientRows=[['العميل','رقم البطاقة','الشهر','الحالة','تاريخ الصرف في الشهر']];
    for(const m of months)for(const c of clientsForMonth(m)){
      const hit=rin.filter(i=>String(i.clientId)===String(c.id)&&invoiceMonth(i)===m&&reportIsConfirmed(i)&&!i.reversed).sort((a,b)=>(reportDateValue(invoiceDate(b))?.getTime()||0)-(reportDateValue(invoiceDate(a))?.getTime()||0))[0];
      clientRows.push([c.fullName||c.name||'',c.cardNumber||'',monthLabel(m),statusForClient(c,m),hit?reportDateText(invoiceDate(hit)):'']);
    }

    const invoiceRows=[['رقم الفاتورة','التاريخ والوقت','الشهر','العميل','رقم البطاقة','الحالة','الصنف','الكمية','سعر الوحدة','إجمالي السطر','إجمالي الفاتورة','الملاحظات']];
    for(const inv of invoiceInRange){
      const its=detailItems.filter(x=>String(x.invoiceId)===String(inv.id));
      if(!its.length)invoiceRows.push([inv.id||'',reportDateText(invoiceDate(inv)),monthLabel(invoiceMonth(inv)),inv.clientNameSnapshot||clientName(inv.clientId),inv.cardNumberSnapshot||rc.find(c=>String(c.id)===String(inv.clientId))?.cardNumber||'',reportInvoiceStatus(inv),'','','','',Number(inv.total||0),inv.notes||inv.note||'']);
      else for(const x of its)invoiceRows.push([inv.id||'',reportDateText(invoiceDate(inv)),monthLabel(invoiceMonth(inv)),inv.clientNameSnapshot||clientName(inv.clientId),inv.cardNumberSnapshot||rc.find(c=>String(c.id)===String(inv.clientId))?.cardNumber||'',reportInvoiceStatus(inv),x.productNameSnapshot||productNameReport(firstValue(x,['productId','productID'])),Number(firstValue(x,['quantity','qty'])||0),Number(x.unitPrice||0),Number(x.lineTotal||0),Number(inv.total||0),inv.notes||inv.note||'']);
    }

    const allInvoiceRows=[['رقم الفاتورة','التاريخ والوقت','الشهر','العميل','البطاقة','الحالة','الإجمالي','الملاحظات']];
    for(const inv of rawInvoiceRows)allInvoiceRows.push([inv.id||'',reportDateText(invoiceDate(inv)),invoiceMonth(inv)?monthLabel(invoiceMonth(inv)):'',inv.clientNameSnapshot||clientName(inv.clientId),inv.cardNumberSnapshot||rc.find(c=>String(c.id)===String(inv.clientId))?.cardNumber||'',reportInvoiceStatus(inv),Number(inv.total||0),inv.notes||inv.note||'']);

    const moveRows=[['التاريخ والوقت','نوع الحركة','الصنف','الكمية +/-','قبل','بعد','مرجع الفاتورة','الملاحظة']];
    for(const x of moves)moveRows.push([reportDateText(reportMoveDate(x)),typeLabel(x.type),productNameReport(firstValue(x,['productId','productID'])),reportQty(x),Number(firstValue(x,['quantityBefore','before'])||0),Number(firstValue(x,['quantityAfter','after'])||0),x.referenceId?`#${x.referenceId}`:'',x.note||x.notes||'']);

    const allMoveRows=[['التاريخ والوقت','الشهر','نوع الحركة','الصنف','الكمية +/-','قبل','بعد','المرجع','الملاحظة']];
    for(const x of rawMoveRows)allMoveRows.push([reportDateText(reportMoveDate(x)),reportMoveMonth(x)?monthLabel(reportMoveMonth(x)):'',typeLabel(x.type),productNameReport(firstValue(x,['productId','productID'])),reportQty(x),Number(firstValue(x,['quantityBefore','before'])||0),Number(firstValue(x,['quantityAfter','after'])||0),x.referenceId?`#${x.referenceId}`:'',x.note||x.notes||'']);

    const auditRows=[['التاريخ والوقت','العملية','النوع','المعرف','التفصيل / الملاحظة']];
    for(const a of audits)auditRows.push([reportDateText(reportAuditDate(a)),reportAuditLabel(a),a.entityType||a.entity||'',a.entityId??a.id??'',a.note||a.notes||'']);

    const rawRows=[['المصدر','التاريخ والوقت','الشهر','النوع','المرجع/المعرف','العميل/الوصف','الصنف','الكمية','القيمة','الملاحظة']];
    for(const inv of rawInvoiceRows)rawRows.push(['فاتورة',reportDateText(invoiceDate(inv)),invoiceMonth(inv),reportInvoiceStatus(inv),`#${inv.id||''}`,inv.clientNameSnapshot||clientName(inv.clientId), '', '',Number(inv.total||0),inv.notes||inv.note||'']);
    for(const x of rawMoveRows)rawRows.push(['حركة مخزون',reportDateText(reportMoveDate(x)),reportMoveMonth(x),typeLabel(x.type),x.referenceId?`#${x.referenceId}`:(x.id??''),'',productNameReport(firstValue(x,['productId','productID'])),reportQty(x),'',x.note||x.notes||'']);
    for(const a of rawAuditRows)rawRows.push(['سجل نشاط',reportDateText(reportAuditDate(a)),reportAuditMonth(a),reportAuditLabel(a),a.entityId??a.id??'',a.entityType||a.entity||'','','','',a.note||a.notes||'']);

    const defs=[
      {name:'ملخص التقرير',rows:summaryRows,widths:[34,90]},
      {name:'حالة العملاء',rows:clientRows,widths:[30,18,18,20,24]},
      {name:'الفواتير',rows:invoiceRows,widths:[13,22,18,30,18,14,26,12,15,17,18,32]},
      {name:'كل الفواتير',rows:allInvoiceRows,widths:[13,22,18,30,18,16,18,32]},
      {name:'حركات المخزون',rows:moveRows,widths:[22,18,26,15,12,12,16,35]},
      {name:'كل حركات المخزون',rows:allMoveRows,widths:[22,18,18,26,15,12,12,16,35]},
      {name:'سجل النشاط',rows:auditRows,widths:[22,28,18,14,35]},
      {name:'كل البيانات على الجهاز',rows:rawRows,widths:[18,22,18,20,18,30,26,14,15,35]}
    ];
    const bytes=buildXlsx(defs),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`جمعيتي_تقرير_${from}${count===3?'-'+to:''}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    const totalRows=invoiceInRange.length+moves.length+audits.length;
    toast(`تم إنشاء التقرير: ${totalRows} عملية في الفترة + جميع البيانات الموجودة على الجهاز.`);
  }catch(err){console.error(err);alert('تعذر إنشاء تقرير Excel: '+(err?.message||'خطأ غير معروف'))}
}
async function resetAll(){
  if(!confirm('تحذير شديد: سيتم حذف كل العملاء والأصناف والفواتير والحركات من هذا الجهاز. متابعة؟'))return;
  if(prompt('للتأكيد الثاني، اكتب كلمة: حذف الكل')!=='حذف الكل')return alert('تم إلغاء الحذف.');
  if(prompt('للتأكيد النهائي، أدخل كلمة المرور')!==DELETE_PASSWORD)return alert('كلمة المرور غير صحيحة، لم تُحذف أي بيانات.');
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
$('clientSearch').oninput=renderClients;$('productSearch').oninput=renderProducts;$('invoiceSearch').oninput=renderInvoices;$('dashboardClientSearch').oninput=renderDashboard;$('inventorySearch').oninput=renderInventory;$('movementSearch').oninput=renderInventoryLog;$('movementType').onchange=renderInventoryLog;$('movementFrom').onchange=renderInventoryLog;$('movementTo').onchange=renderInventoryLog;$('reportExportBtn').onclick=exportReport;
$('backupBtn').onclick=backup;$('backupSettingsBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=async e=>{try{await restoreData(e.target.files[0])}catch(err){alert('فشل الاسترجاع: '+err.message)}e.target.value=''};
$('saveSettingsBtn').onclick=async()=>{const v=Math.min(28,Math.max(1,Number($('monthEndDay').value||25)));await put('settings',{key:'monthEndDay',value:v});settings.monthEndDay=v;renderDashboard();toast('تم حفظ الإعدادات.')};$('resetBtn').onclick=resetAll;$('inventoryReceiveBtn').onclick=()=>{const first=activeProducts()[0];if(first)openReceipt(first.id);else alert('أضف صنفًا أولًا من شاشة الأصناف.')};
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>go(b.dataset.screen));

function setupInstall(){
  const show=()=>{['installBtn','installSettingsBtn'].forEach(id=>{const el=$(id);if(el)el.hidden=!deferredInstallPrompt})};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;show()});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;show();toast('تم تثبيت جمعيتي على الهاتف.')});
  async function install(){if(!deferredInstallPrompt){return alert('زر التثبيت يظهر عندما يكون المتصفح مستوفيًا لشروط التثبيت. استخدم قائمة المتصفح > إضافة إلى الشاشة الرئيسية عند الحاجة.')}deferredInstallPrompt.prompt();const {outcome}=await deferredInstallPrompt.userChoice;if(outcome!=='accepted')return;deferredInstallPrompt=null;show()}
  $('installBtn').onclick=install;$('installSettingsBtn').onclick=install;show();
}

if('serviceWorker' in navigator && location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).catch(console.error)}
$('reportMonth').value=localMonthKey();
setupInstall();
(async()=>{try{await openDB();await refresh()}catch(e){console.error(e);alert('تعذر تشغيل البرنامج. جرّب إعادة تحميل الصفحة.') }})();
