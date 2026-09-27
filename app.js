const DB_NAME='GamayatiDB', DB_VERSION=3;
let db, clients=[], products=[], inventory=[], invoices=[], settings={monthEndDay:25};

const $=id=>document.getElementById(id);
const now=()=>new Date().toISOString();
const monthKey=(d=new Date())=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0');return `${y}-${m}`};
const money=n=>Number(n||0).toFixed(2);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',2200)}
function openDB(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=e=>{
   const d=e.target.result;
   [
    ['clients',{keyPath:'id',autoIncrement:true}],
    ['products',{keyPath:'id',autoIncrement:true}],
    ['inventory',{keyPath:'productId'}],
    ['invoices',{keyPath:'id',autoIncrement:true}],
    ['invoiceItems',{keyPath:'id',autoIncrement:true}],
    ['inventoryTransactions',{keyPath:'id',autoIncrement:true}],
    ['auditLogs',{keyPath:'id',autoIncrement:true}],
    ['settings',{keyPath:'key'}]
   ].forEach(([n,o])=>{if(!d.objectStoreNames.contains(n))d.createObjectStore(n,o)});
  };
  r.onsuccess=()=>{db=r.result;db.onversionchange=()=>db.close();resolve()};
  r.onerror=()=>reject(r.error);
 });
}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function read(store,key){return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error||new Error('transaction failed'));tx.onabort=()=>rej(tx.error||new Error('transaction aborted'))})}
function req(store,method,arg,tx){
 return new Promise((res,rej)=>{
  const r=tx.objectStore(store)[method](arg);
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
 });
}
function activeClients(){return clients.filter(x=>!x.archived)}
function activeProducts(){return products.filter(x=>!x.archived)}
async function refresh(){
 clients=await all('clients');products=await all('products');inventory=await all('inventory');invoices=await all('invoices');
 const s=await read('settings','monthEndDay');settings.monthEndDay=Number(s?.value||25);
 $('monthEndDay').value=settings.monthEndDay;
 await ensureProductCodes();
 clients=await all('clients');products=await all('products');inventory=await all('inventory');
 renderDashboard();renderClients();renderProducts();renderClientSelect();renderInvoices();renderLines();
}
async function ensureProductCodes(){
 const missing=products.filter(p=>!p.code);
 if(!missing.length)return;
 const tx=db.transaction(['products'],'readwrite');
 const st=tx.objectStore('products');
 const sorted=products.slice().sort((a,b)=>a.id-b.id);
 for(const p of sorted)if(!p.code){p.code=`P-${String(p.id).padStart(4,'0')}`;p.updatedAt=now();st.put(p)}
 await txDone(tx);
}
function currentStatus(c){
 const m=monthKey();
 const done=invoices.some(i=>i.clientId===c.id&&i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed);
 if(done)return ['green','✓ تم الصرف'];
 return new Date().getDate()>settings.monthEndDay?['red','* متأخر']:['yellow','! لم يصرف'];
}
function renderDashboard(){
 $('statClients').textContent=activeClients().length;$('statProducts').textContent=activeProducts().length;
 const m=monthKey(),ids=new Set(invoices.filter(i=>i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed).map(i=>i.clientId));
 $('statDispensed').textContent=ids.size;$('statStock').textContent=money(inventory.reduce((s,x)=>s+Number(x.quantity||0),0));
 $('monthlyStatus').innerHTML=activeClients().map(c=>{const [cl,tx]=currentStatus(c);return `<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">بطاقة: ${esc(c.cardNumber)}</div><div class="muted">آخر صرف: ${c.lastDispensingAt?new Date(c.lastDispensingAt).toLocaleString('ar-EG'):'لا يوجد'}</div></div><span class="status ${cl}">${tx}</span></div>`}).join('')||'<div class="muted">لا يوجد عملاء.</div>';
}
function renderClients(){
 const q=($('clientSearch').value||'').trim().toLowerCase();
 const list=activeClients().filter(c=>[c.fullName,c.cardNumber,c.phone,c.secretNumber].join(' ').toLowerCase().includes(q));
 $('clientsList').innerHTML=list.map(c=>`<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">البطاقة: ${esc(c.cardNumber)} | السر: ${esc(c.secretNumber||'—')} | التموين: ${c.rationCount||0} | الخبز: ${c.flourCount||0}</div><div class="muted">${esc(c.phone||'')} ${esc(c.address||'')}</div><div class="muted">آخر صرف: ${c.lastDispensingAt?new Date(c.lastDispensingAt).toLocaleString('ar-EG'):'لا يوجد'}</div></div><button class="secondary" onclick="editClient(${c.id})">تعديل</button><button class="danger" onclick="archiveClient(${c.id})">أرشفة</button></div>`).join('')||'<div class="panel">لا يوجد عملاء.</div>';
}
function renderProducts(){
 const q=($('productSearch').value||'').trim().toLowerCase();
 const list=activeProducts().filter(p=>[p.name,p.code,p.unit].join(' ').toLowerCase().includes(q));
 $('productsList').innerHTML=list.map(p=>{const st=inventory.find(x=>x.productId===p.id),qty=Number(st?.quantity||0);return `<div class="item"><div class="info"><b>${esc(p.name)}</b><div class="muted">الكود: ${esc(p.code||'—')} | ${esc(p.unit||'وحدة')} | السعر: ${money(p.price)} جنيه | المخزون: <span class="${qty<=p.minimumStock?'low':''}">${money(qty)}</span></div></div><button class="secondary" onclick="addStock(${p.id})">+ مخزون</button><button class="secondary" onclick="editProduct(${p.id})">تعديل</button><button class="danger" onclick="archiveProduct(${p.id})">أرشفة</button></div>`}).join('')||'<div class="panel">لا توجد أصناف.</div>';
}
function renderClientSelect(){$('dispClient').innerHTML='<option value="">اختر العميل</option>'+activeClients().map(c=>`<option value="${c.id}">${esc(c.fullName)} — ${esc(c.cardNumber)}</option>`).join('')}
function renderLines(){if(!$('dispenseLines').querySelector('.line'))addLine()}
function addLine(){
 const box=$('dispenseLines'),row=document.createElement('div');row.className='line';
 const list=activeProducts();
 const options=list.map((p,i)=>`<option value="${p.id}"${i===0?' selected':''}>${esc(p.name)} (${money(p.price)}) — مخزون ${money(inventory.find(x=>x.productId===p.id)?.quantity||0)}</option>`).join('');
 row.innerHTML=`<select onchange="calcTotal()">${options||'<option value="">لا توجد أصناف</option>'}</select><input type="number" min="0.01" step="0.01" value="1" oninput="calcTotal()"><span class="lineTotal">0.00</span><button type="button" class="danger" onclick="this.parentElement.remove();calcTotal()">×</button>`;
 box.appendChild(row);calcTotal();
}
function calcTotal(){let t=0;document.querySelectorAll('#dispenseLines .line').forEach(r=>{const p=products.find(x=>x.id==r.querySelector('select').value),q=Number(r.querySelector('input').value||0),v=p?q*p.price:0;r.querySelector('.lineTotal').textContent=money(v);t+=v});$('dispTotal').textContent=money(t)}
$('dispClient').addEventListener('change',()=>{const c=clients.find(x=>x.id===Number($('dispClient').value));$('dispClientInfo').textContent=c?`بطاقة ${c.cardNumber} — أفراد التموين ${c.rationCount||0} — أفراد الخبز ${c.flourCount||0}`:''});

async function confirmDispense(){
 const clientId=Number($('dispClient').value);if(!clientId)return alert('اختر العميل أولًا');
 const c=clients.find(x=>x.id===clientId),m=monthKey();
 if(invoices.some(i=>i.clientId===clientId&&i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed))return alert('هذا العميل لديه صرف مؤكد بالفعل هذا الشهر.');
 const lines=[...document.querySelectorAll('#dispenseLines .line')].map(r=>({productId:Number(r.querySelector('select').value),quantity:Number(r.querySelector('input').value)})).filter(x=>x.productId&&x.quantity>0);
 if(!lines.length)return alert('أضف صنفًا واحدًا على الأقل');
 const seen=new Set();for(const l of lines){if(seen.has(l.productId))return alert('لا تكرر نفس الصنف.');seen.add(l.productId)}
 const prepared=[];for(const l of lines){const p=products.find(x=>x.id===l.productId),st=inventory.find(x=>x.productId===l.productId);if(!p||!st||Number(st.quantity)<l.quantity)return alert(`المخزون غير كافٍ للصنف: ${p?.name||''}`);prepared.push({productId:p.id,productNameSnapshot:p.name,quantity:l.quantity,unitPrice:Number(p.price||0),lineTotal:l.quantity*Number(p.price||0)})}
 const total=prepared.reduce((s,x)=>s+x.lineTotal,0);
 if(!confirm(`تأكيد الصرف النهائي؟\nالإجمالي: ${money(total)} جنيه\nلا يمكن حذف الفاتورة بعد التأكيد.`))return;
 const tx=db.transaction(['invoices','invoiceItems','inventory','inventoryTransactions','auditLogs','clients'],'readwrite');
 try{
  const invoiceStore=tx.objectStore('invoices');
  const invoice={clientId,clientNameSnapshot:c.fullName,cardNumberSnapshot:c.cardNumber,serviceMonth:m,issuedAt:now(),status:'CONFIRMED',reversed:false,total};
  const invoiceReq=invoiceStore.add(invoice);
  invoiceReq.onerror=()=>tx.abort();
  invoiceReq.onsuccess=()=>{
   const invoiceId=invoiceReq.result;
   for(const x of prepared){
    tx.objectStore('invoiceItems').add({invoiceId,...x});
    const st=inventory.find(y=>y.productId===x.productId);
    const before=Number(st.quantity),after=before-x.quantity;st.quantity=after;st.updatedAt=now();
    tx.objectStore('inventory').put(st);
    tx.objectStore('inventoryTransactions').add({productId:x.productId,type:'SALE',quantityChange:-x.quantity,quantityBefore:before,quantityAfter:after,referenceId:invoiceId,createdAt:now()});
   }
   c.lastDispensingAt=invoice.issuedAt;c.updatedAt=now();tx.objectStore('clients').put(c);
   tx.objectStore('auditLogs').add({action:'CREATE_DISPENSE',entityType:'invoice',entityId:invoiceId,createdAt:now()});
  };
  await txDone(tx);
  alert(`تم الحفظ بنجاح\nالفاتورة #${invoice.id||'تم إنشاؤها'}\nالإجمالي: ${money(total)} جنيه`);
  $('dispClient').value='';$('dispenseLines').innerHTML='';await refresh();
 }catch(e){console.error(e);alert('لم يتم حفظ العملية. لم يتم اعتماد الصرف بسبب فشل المعاملة.');}
}
function renderInvoices(){
 const q=($('invoiceSearch').value||'').toLowerCase();
 const list=invoices.slice().sort((a,b)=>b.id-a.id).filter(i=>String(i.id).includes(q)||String(i.cardNumberSnapshot||'').toLowerCase().includes(q)||String(i.clientNameSnapshot||'').toLowerCase().includes(q));
 $('invoicesList').innerHTML=list.map(i=>`<div class="item"><div class="info"><b>فاتورة #${i.id}</b><div>${esc(i.clientNameSnapshot)} — ${esc(i.cardNumberSnapshot)}</div><div class="muted">${i.serviceMonth} | ${new Date(i.issuedAt).toLocaleString('ar-EG')} | ${money(i.total)} جنيه</div></div><span class="status ${i.reversed?'red':'green'}">${i.reversed?'ملغاة بعكس حركة':'مؤكدة'}</span>${!i.reversed?`<button class="danger" onclick="reverseInvoice(${i.id})">عكس العملية</button>`:''}</div>`).join('')||'<div class="panel">لا توجد فواتير.</div>';
}
async function reverseInvoice(id){
 const inv=invoices.find(i=>i.id===id);if(!inv||inv.reversed)return;
 if(!confirm('سيتم عكس الفاتورة وإرجاع الكميات للمخزون مع الاحتفاظ بالفاتورة الأصلية. هل تريد المتابعة؟'))return;
 const items=(await all('invoiceItems')).filter(x=>x.invoiceId===id);
 const previousDate=await lastActiveDispensingDate(inv.clientId,id);
 const tx=db.transaction(['invoices','inventory','inventoryTransactions','auditLogs','clients'],'readwrite');
 try{
  inv.reversed=true;inv.reversedAt=now();tx.objectStore('invoices').put(inv);
  for(const x of items){
   const st=inventory.find(y=>y.productId===x.productId);if(!st)throw new Error('inventory item missing');
   const before=Number(st.quantity),after=before+Number(x.quantity);st.quantity=after;st.updatedAt=now();tx.objectStore('inventory').put(st);
   tx.objectStore('inventoryTransactions').add({productId:x.productId,type:'REVERSAL',quantityChange:x.quantity,quantityBefore:before,quantityAfter:after,referenceId:id,createdAt:now()});
  }
  const c=clients.find(x=>x.id===inv.clientId);if(c){c.lastDispensingAt=previousDate;c.updatedAt=now();tx.objectStore('clients').put(c)}
  tx.objectStore('auditLogs').add({action:'REVERSE_INVOICE',entityType:'invoice',entityId:id,createdAt:now()});
  await txDone(tx);await refresh();toast('تم عكس الفاتورة وإرجاع المخزون مع حفظ الأصل.');
 }catch(e){console.error(e);alert('فشل العكس ولم تُعتمد العملية.')}
}
async function lastActiveDispensingDate(clientId,excludedId){
 const arr=invoices.filter(i=>i.clientId===clientId&&i.id!==excludedId&&i.status==='CONFIRMED'&&!i.reversed).sort((a,b)=>new Date(b.issuedAt)-new Date(a.issuedAt));
 return arr[0]?.issuedAt||'';
}
function editClient(id){
 const c=clients.find(x=>x.id===id);$('clientId').value=c.id;$('clientName').value=c.fullName;$('cardNumber').value=c.cardNumber;$('secretNumber').value=c.secretNumber||'';$('rationCount').value=c.rationCount||0;$('flourCount').value=c.flourCount||0;$('phone').value=c.phone||'';$('address').value=c.address||'';$('notes').value=c.notes||'';$('clientDialogTitle').textContent='تعديل عميل';$('clientDialog').showModal()
}
async function archiveClient(id){if(!confirm('أرشفة العميل؟'))return;const c=clients.find(x=>x.id===id);c.archived=true;c.updatedAt=now();try{const tx=db.transaction('clients','readwrite');tx.objectStore('clients').put(c);await txDone(tx);await refresh()}catch(e){alert('تعذر أرشفة العميل.')}}
function editProduct(id){
 const p=products.find(x=>x.id===id);$('productId').value=p.id;$('productName').value=p.name;$('productCode').value=p.code||`P-${String(p.id).padStart(4,'0')}`;$('productUnit').value=p.unit||'وحدة';$('productPrice').value=p.price;$('minimumStock').value=p.minimumStock||0;$('initialStock').value=inventory.find(x=>x.productId===id)?.quantity||0;$('initialStock').disabled=true;$('productDialogTitle').textContent='تعديل صنف';$('productCode').readOnly=true;$('productDialog').showModal()
}
async function archiveProduct(id){if(!confirm('أرشفة الصنف؟'))return;const p=products.find(x=>x.id===id);p.archived=true;p.updatedAt=now();try{const tx=db.transaction('products','readwrite');tx.objectStore('products').put(p);await txDone(tx);await refresh()}catch(e){alert('تعذر أرشفة الصنف.')}}
function addStock(id){
 const p=products.find(x=>x.id===id);if(!p)return;
 $('stockProductId').value=id;$('stockProductName').textContent=`${p.name} — ${p.code}`;$('stockQuantity').value='';$('stockNote').value='';$('stockDialog').showModal()
}
$('cancelClientBtn').onclick=()=>$('clientDialog').close();
$('cancelProductBtn').onclick=()=>$('productDialog').close();
$('cancelStockBtn').onclick=()=>$('stockDialog').close();

$('addClientBtn').onclick=()=>{$('clientForm').reset();$('clientId').value='';$('clientDialogTitle').textContent='إضافة عميل';$('clientDialog').showModal()};
$('addProductBtn').onclick=()=>{$('productForm').reset();$('productId').value='';$('productCode').readOnly=true;$('productCode').value='سيتم التوليد تلقائيًا';$('initialStock').disabled=false;$('productDialogTitle').textContent='إضافة صنف';$('productDialog').showModal()};

$('clientForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const id=Number($('clientId').value),obj={fullName:$('clientName').value.trim(),cardNumber:$('cardNumber').value.trim(),secretNumber:$('secretNumber').value.trim(),rationCount:Number($('rationCount').value||0),flourCount:Number($('flourCount').value||0),phone:$('phone').value.trim(),address:$('address').value.trim(),notes:$('notes').value.trim(),archived:false,updatedAt:now()};
 if(!obj.fullName||!obj.cardNumber||!obj.secretNumber)return alert('الاسم ورقم البطاقة والرقم السري مطلوبون');
 if(clients.some(c=>!c.archived&&c.cardNumber===obj.cardNumber&&c.id!==id))return alert('رقم بطاقة التموين مستخدم بالفعل.');
 try{
  const tx=db.transaction('clients','readwrite');
  if(id){const old=clients.find(x=>x.id===id);tx.objectStore('clients').put({...old,...obj,id})}
  else{tx.objectStore('clients').add({...obj,createdAt:now(),lastDispensingAt:''})}
  await txDone(tx);$('clientDialog').close();await refresh()
 }catch(e){console.error(e);alert('حدث خطأ في حفظ العميل.')}
});
$('productForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const id=Number($('productId').value),obj={name:$('productName').value.trim(),unit:$('productUnit').value.trim()||'وحدة',price:Number($('productPrice').value||0),minimumStock:Number($('minimumStock').value||0),archived:false,updatedAt:now(),createdAt:now()};
 if(!obj.name||obj.price<0||obj.minimumStock<0)return alert('بيانات الصنف غير صحيحة');
 try{
  if(id){
   const old=products.find(x=>x.id===id),tx=db.transaction('products','readwrite');tx.objectStore('products').put({...old,...obj,id,code:old.code||`P-${String(id).padStart(4,'0')}`});await txDone(tx);
  }else{
   const tx=db.transaction(['products','inventory','inventoryTransactions','auditLogs'],'readwrite'),pstore=tx.objectStore('products');
   const reqAdd=pstore.add({...obj,code:'',createdAt:now()});
   reqAdd.onsuccess=()=>{const pid=reqAdd.result,code=`P-${String(pid).padStart(4,'0')}`;pstore.put({...obj,id:pid,code,createdAt:obj.createdAt});const qty=Number($('initialStock').value||0);tx.objectStore('inventory').add({productId:pid,quantity:qty,updatedAt:now()});if(qty>0)tx.objectStore('inventoryTransactions').add({productId:pid,type:'INITIAL_STOCK',quantityChange:qty,quantityBefore:0,quantityAfter:qty,createdAt:now()});tx.objectStore('auditLogs').add({action:'CREATE_PRODUCT',entityType:'product',entityId:pid,createdAt:now()})};
   reqAdd.onerror=()=>tx.abort();await txDone(tx);
  }
  $('productDialog').close();await refresh()
 }catch(e){console.error(e);alert('حدث خطأ في حفظ الصنف.')}
});
$('stockForm').addEventListener('submit',async e=>{
 e.preventDefault();const pid=Number($('stockProductId').value),qty=Number($('stockQuantity').value||0),note=$('stockNote').value.trim();if(!pid||qty<=0)return alert('أدخل كمية صحيحة.');
 const st=inventory.find(x=>x.productId===pid);if(!st)return alert('المخزون غير موجود.');
 const before=Number(st.quantity),after=before+qty,tx=db.transaction(['inventory','inventoryTransactions','auditLogs'],'readwrite');st.quantity=after;st.updatedAt=now();tx.objectStore('inventory').put(st);tx.objectStore('inventoryTransactions').add({productId:pid,type:'RESTOCK',quantityChange:qty,quantityBefore:before,quantityAfter:after,note,createdAt:now()});tx.objectStore('auditLogs').add({action:'RESTOCK',entityType:'product',entityId:pid,createdAt:now()});
 try{await txDone(tx);$('stockDialog').close();await refresh();toast('تمت إضافة المخزون بنجاح.')}catch(e){alert('فشل تسجيل إضافة المخزون.')}
});
$('addLineBtn').onclick=addLine;$('confirmDispenseBtn').onclick=confirmDispense;$('clientSearch').oninput=renderClients;$('productSearch').oninput=renderProducts;$('invoiceSearch').oninput=renderInvoices;
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(b.dataset.screen).classList.add('active')});
async function backup(){
 const data={version:3,exportedAt:now(),clients,products,inventory,invoices,invoiceItems:await all('invoiceItems'),inventoryTransactions:await all('inventoryTransactions'),auditLogs:await all('auditLogs'),settings:await all('settings')};
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`gamayati-backup-${monthKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function restoreData(file){
 if(!file)throw Error('لم يتم اختيار ملف');
 const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.clients)||!Array.isArray(data.products)||!Array.isArray(data.inventory)||!Array.isArray(data.invoices))throw Error('نسخة غير صالحة');
 if(!confirm('الاسترجاع سيستبدل البيانات الحالية. تأكد أن لديك نسخة احتياطية.'))return;
 const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'],tx=db.transaction(names,'readwrite');
 for(const n of names){const st=tx.objectStore(n);st.clear();for(const x of (data[n]||[]))st.put(x)}
 await txDone(tx);await refresh();toast('تم استرجاع النسخة الاحتياطية.')
}
$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=async e=>{try{await restoreData(e.target.files[0])}catch(err){alert('فشل الاسترجاع: '+err.message)}e.target.value=''};
$('saveSettingsBtn').onclick=async()=>{const v=Math.min(28,Math.max(1,Number($('monthEndDay').value||25)));const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({key:'monthEndDay',value:v});try{await txDone(tx);settings.monthEndDay=v;renderDashboard();toast('تم حفظ الإعدادات')}catch(e){alert('تعذر حفظ الإعدادات')}};
$('resetBtn').onclick=async()=>{if(!confirm('تحذير: سيتم حذف كل بيانات البرنامج من هذا الجهاز. هل أنت متأكد؟'))return;const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'],tx=db.transaction(names,'readwrite');names.forEach(n=>tx.objectStore(n).clear());try{await txDone(tx);await refresh();toast('تم حذف البيانات')}catch(e){alert('تعذر حذف البيانات')}};
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('installBtn').style.display='inline-block'});
$('installBtn').onclick=async()=>{if(!deferredInstallPrompt){alert('إذا لم يظهر التثبيت، افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية/تثبيت التطبيق.');return}deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installBtn').style.display='none'};
window.addEventListener('appinstalled',()=>{$('installBtn').style.display='none';toast('تم تثبيت جمعيتي.')});
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(e=>console.error('SW',e));
(async()=>{try{await openDB();await refresh()}catch(e){console.error(e);alert('تعذر تشغيل قاعدة بيانات جمعيتي على هذا المتصفح.')}})();
