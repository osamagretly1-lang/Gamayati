const DB_NAME='GamayatiDB',DB_VERSION=2;
let db,clients=[],products=[],inventory=[],invoices=[],settings={monthEndDay:25};
const $=id=>document.getElementById(id);
const now=()=>new Date().toISOString();
const monthKey=(d=new Date())=>d.toISOString().slice(0,7);
const money=n=>Number(n||0).toFixed(2);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',2200)}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const d=e.target.result;[
['clients',{keyPath:'id',autoIncrement:true}],['products',{keyPath:'id',autoIncrement:true}],
['inventory',{keyPath:'productId'}],['invoices',{keyPath:'id',autoIncrement:true}],
['invoiceItems',{keyPath:'id',autoIncrement:true}],['inventoryTransactions',{keyPath:'id',autoIncrement:true}],
['auditLogs',{keyPath:'id',autoIncrement:true}],['settings',{keyPath:'key'}]
].forEach(([n,o])=>{if(!d.objectStoreNames.contains(n))d.createObjectStore(n,o)})};
r.onsuccess=()=>{db=r.result;resolve()};r.onerror=()=>reject(r.error)})}
function all(store){return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function req(store,method,arg,tx){return new Promise((res,rej)=>{const r=tx.objectStore(store)[method](arg);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function read(store,key){return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function activeClients(){return clients.filter(x=>!x.archived)}
function activeProducts(){return products.filter(x=>!x.archived)}
async function refresh(){clients=await all('clients');products=await all('products');inventory=await all('inventory');invoices=await all('invoices');const s=await read('settings','monthEndDay');settings.monthEndDay=Number(s?.value||25);$('monthEndDay').value=settings.monthEndDay;renderDashboard();renderClients();renderProducts();renderClientSelect();renderInvoices();renderLines()}
function currentStatus(c){
 const m=monthKey(), done=invoices.some(i=>i.clientId===c.id&&i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed);
 if(done)return ['green','✓ تم الصرف'];
 const day=new Date().getDate(); return day>settings.monthEndDay?['red','* متأخر']:['yellow','! لم يصرف'];
}
function renderDashboard(){
 $('statClients').textContent=activeClients().length;$('statProducts').textContent=activeProducts().length;
 const m=monthKey(),ids=new Set(invoices.filter(i=>i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed).map(i=>i.clientId));
 $('statDispensed').textContent=ids.size;$('statStock').textContent=money(inventory.reduce((s,x)=>s+Number(x.quantity||0),0));
 $('monthlyStatus').innerHTML=activeClients().map(c=>{const [cl,tx]=currentStatus(c);return `<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">بطاقة: ${esc(c.cardNumber)}</div></div><span class="status ${cl}">${tx}</span></div>`}).join('')||'<div class="muted">لا يوجد عملاء.</div>';
}
function renderClients(){const q=($('clientSearch').value||'').trim().toLowerCase();const list=activeClients().filter(c=>[c.fullName,c.cardNumber,c.phone].join(' ').toLowerCase().includes(q));$('clientsList').innerHTML=list.map(c=>`<div class="item"><div class="info"><b>${esc(c.fullName)}</b><div class="muted">البطاقة: ${esc(c.cardNumber)} | التموين: ${c.rationCount} | الخبز: ${c.flourCount}</div><div class="muted">${esc(c.phone||'')} ${esc(c.address||'')}</div></div><button class="secondary" onclick="editClient(${c.id})">تعديل</button><button class="danger" onclick="archiveClient(${c.id})">أرشفة</button></div>`).join('')||'<div class="panel">لا يوجد عملاء.</div>'}
function renderProducts(){const q=($('productSearch').value||'').trim().toLowerCase();const list=activeProducts().filter(p=>p.name.toLowerCase().includes(q));$('productsList').innerHTML=list.map(p=>{const st=inventory.find(x=>x.productId===p.id),qty=st?.quantity||0;return `<div class="item"><div class="info"><b>${esc(p.name)}</b><div class="muted">${esc(p.unit)} | السعر: ${money(p.price)} جنيه | المخزون: <span class="${qty<=p.minimumStock?'low':''}">${money(qty)}</span></div></div><button class="secondary" onclick="editProduct(${p.id})">تعديل</button><button class="danger" onclick="archiveProduct(${p.id})">أرشفة</button></div>`}).join('')||'<div class="panel">لا توجد أصناف.</div>'}
function renderClientSelect(){$('dispClient').innerHTML='<option value="">اختر العميل</option>'+activeClients().map(c=>`<option value="${c.id}">${esc(c.fullName)} — ${esc(c.cardNumber)}</option>`).join('')}
function renderLines(){if(!$('dispenseLines').querySelector('.line'))addLine()}
function addLine(){const box=$('dispenseLines'),row=document.createElement('div');row.className='line';row.innerHTML=`<select onchange="calcTotal()"><option value="">اختر الصنف</option>${activeProducts().map(p=>`<option value="${p.id}">${esc(p.name)} (${money(p.price)})</option>`).join('')}</select><input type="number" min="0.01" step="0.01" value="1" oninput="calcTotal()"><span class="lineTotal">0.00</span><button type="button" class="danger" onclick="this.parentElement.remove();calcTotal()">×</button>`;box.appendChild(row);calcTotal()}
function calcTotal(){let t=0;document.querySelectorAll('#dispenseLines .line').forEach(r=>{const p=products.find(x=>x.id==r.querySelector('select').value),q=Number(r.querySelector('input').value||0),v=p?q*p.price:0;r.querySelector('.lineTotal').textContent=money(v);t+=v});$('dispTotal').textContent=money(t)}
$('dispClient').addEventListener('change',()=>{const c=clients.find(x=>x.id==Number($('dispClient').value));$('dispClientInfo').textContent=c?`بطاقة ${c.cardNumber} — أفراد التموين ${c.rationCount} — أفراد الخبز ${c.flourCount}`:''});
async function confirmDispense(){
 const clientId=Number($('dispClient').value);if(!clientId)return alert('اختر العميل أولًا');const c=clients.find(x=>x.id===clientId),m=monthKey();
 if(invoices.some(i=>i.clientId===clientId&&i.serviceMonth===m&&i.status==='CONFIRMED'&&!i.reversed))return alert('هذا العميل لديه صرف مؤكد بالفعل هذا الشهر.');
 const lines=[...document.querySelectorAll('#dispenseLines .line')].map(r=>({productId:Number(r.querySelector('select').value),quantity:Number(r.querySelector('input').value)})).filter(x=>x.productId&&x.quantity>0);
 if(!lines.length)return alert('أضف صنفًا واحدًا على الأقل');const seen=new Set();for(const l of lines){if(seen.has(l.productId))return alert('لا تكرر نفس الصنف.');seen.add(l.productId)}
 const prepared=[];for(const l of lines){const p=products.find(x=>x.id===l.productId),st=inventory.find(x=>x.productId===l.productId);if(!p||!st||Number(st.quantity)<l.quantity)return alert(`المخزون غير كافٍ للصنف: ${p?.name||''}`);prepared.push({productId:p.id,productNameSnapshot:p.name,quantity:l.quantity,unitPrice:p.price,lineTotal:l.quantity*p.price})}
 const total=prepared.reduce((s,x)=>s+x.lineTotal,0);if(!confirm(`تأكيد الصرف النهائي؟\nالإجمالي: ${money(total)} جنيه\nلا يمكن حذف الفاتورة بعد التأكيد.`))return;
 const tx=db.transaction(['invoices','invoiceItems','inventory','inventoryTransactions','auditLogs'],'readwrite');
 try{
  const invoiceId=await req('invoices','add',{clientId,clientNameSnapshot:c.fullName,cardNumberSnapshot:c.cardNumber,serviceMonth:m,issuedAt:now(),status:'CONFIRMED',reversed:false,total},tx);
  for(const x of prepared){await req('invoiceItems','add',{invoiceId,...x});const st=inventory.find(y=>y.productId===x.productId),before=Number(st.quantity),after=before-x.quantity;st.quantity=after;st.updatedAt=now();await req('inventory','put',st,tx);await req('inventoryTransactions','add',{productId:x.productId,type:'SALE',quantityChange:-x.quantity,quantityBefore:before,quantityAfter:after,referenceId:invoiceId,createdAt:now()},tx)}
  await req('auditLogs','add',{action:'CREATE_DISPENSE',entityType:'invoice',entityId:invoiceId,createdAt:now()},tx);
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('abort'))});
  alert(`تم الحفظ بنجاح\nالفاتورة #${invoiceId}\nالإجمالي: ${money(total)} جنيه`);$('dispClient').value='';$('dispenseLines').innerHTML='';await refresh()
 }catch(e){console.error(e);alert('لم يتم حفظ العملية. لم يتم خصم أي مخزون بسبب فشل المعاملة.')}
}
function renderInvoices(){const q=($('invoiceSearch').value||'').toLowerCase();$('invoicesList').innerHTML=invoices.slice().sort((a,b)=>b.id-a.id).filter(i=>String(i.id).includes(q)||i.clientNameSnapshot.toLowerCase().includes(q)).map(i=>`<div class="item"><div class="info"><b>فاتورة #${i.id}</b><div>${esc(i.clientNameSnapshot)} — ${esc(i.cardNumberSnapshot)}</div><div class="muted">${i.serviceMonth} | ${new Date(i.issuedAt).toLocaleString('ar-EG')} | ${money(i.total)} جنيه</div></div><span class="status ${i.reversed?'red':'green'}">${i.reversed?'ملغاة بعكس حركة':'مؤكدة'}</span>${!i.reversed?`<button class="danger" onclick="reverseInvoice(${i.id})">عكس العملية</button>`:''}</div>`).join('')||'<div class="panel">لا توجد فواتير.</div>'}
async function reverseInvoice(id){
 const inv=invoices.find(i=>i.id===id);if(!inv||inv.reversed)return;if(!confirm('سيتم عكس الفاتورة وإرجاع الكميات للمخزون مع الاحتفاظ بالفاتورة الأصلية. هل تريد المتابعة؟'))return;
 const items=(await all('invoiceItems')).filter(x=>x.invoiceId===id);
 const tx=db.transaction(['invoices','inventory','inventoryTransactions','auditLogs'],'readwrite');
 try{inv.reversed=true;inv.reversedAt=now();await req('invoices','put',inv,tx);
  for(const x of items){const st=inventory.find(y=>y.productId===x.productId);const before=Number(st.quantity),after=before+Number(x.quantity);st.quantity=after;st.updatedAt=now();await req('inventory','put',st,tx);await req('inventoryTransactions','add',{productId:x.productId,type:'REVERSAL',quantityChange:x.quantity,quantityBefore:before,quantityAfter:after,referenceId:id,createdAt:now()},tx)}
  await req('auditLogs','add',{action:'REVERSE_INVOICE',entityType:'invoice',entityId:id,createdAt:now()},tx);
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('abort'))});await refresh();toast('تم عكس الفاتورة وإرجاع المخزون مع حفظ الأصل.')
 }catch(e){alert('فشل العكس ولم تُعتمد العملية.')}
}
function editClient(id){const c=clients.find(x=>x.id===id);$('clientId').value=c.id;$('clientName').value=c.fullName;$('cardNumber').value=c.cardNumber;$('rationCount').value=c.rationCount;$('flourCount').value=c.flourCount;$('phone').value=c.phone||'';$('address').value=c.address||'';$('notes').value=c.notes||'';$('clientDialogTitle').textContent='تعديل عميل';$('clientDialog').showModal()}
async function archiveClient(id){if(confirm('أرشفة العميل؟')){const c=clients.find(x=>x.id===id);c.archived=true;c.updatedAt=now();await put('clients',c);await refresh()}}
function editProduct(id){const p=products.find(x=>x.id===id);$('productId').value=p.id;$('productName').value=p.name;$('productCode').value=p.code||'';$('productUnit').value=p.unit;$('productPrice').value=p.price;$('minimumStock').value=p.minimumStock;$('initialStock').value=inventory.find(x=>x.productId===id)?.quantity||0;$('productDialog').showModal()}
async function archiveProduct(id){if(confirm('أرشفة الصنف؟')){const p=products.find(x=>x.id===id);p.archived=true;p.updatedAt=now();await put('products',p);await refresh()}}
$('addClientBtn').onclick=()=>{$('clientForm').reset();$('clientId').value='';$('clientDialogTitle').textContent='إضافة عميل';$('clientDialog').showModal()};
$('addProductBtn').onclick=()=>{$('productForm').reset();$('productId').value='';$('initialStock').value=0;$('productDialog').showModal()};
$('clientForm').addEventListener('submit',async e=>{e.preventDefault();const id=Number($('clientId').value),obj={fullName:$('clientName').value.trim(),cardNumber:$('cardNumber').value.trim(),rationCount:Number($('rationCount').value||0),flourCount:Number($('flourCount').value||0),phone:$('phone').value.trim(),address:$('address').value.trim(),notes:$('notes').value.trim(),archived:false,updatedAt:now()};if(!obj.fullName||!obj.cardNumber)return alert('الاسم ورقم البطاقة مطلوبان');try{if(id){const old=clients.find(x=>x.id===id);await put('clients',{...old,...obj,id})}else{obj.createdAt=now();await add('clients',obj)}$('clientDialog').close();await refresh()}catch(e){alert('حدث خطأ في حفظ العميل.') }});
$('productForm').addEventListener('submit',async e=>{e.preventDefault();const id=Number($('productId').value),obj={name:$('productName').value.trim(),code:$('productCode').value.trim(),unit:$('productUnit').value.trim()||'وحدة',price:Number($('productPrice').value||0),minimumStock:Number($('minimumStock').value||0),archived:false,updatedAt:now()};if(!obj.name||obj.price<0)return alert('بيانات الصنف غير صحيحة');try{if(id){const old=products.find(x=>x.id===id);await put('products',{...old,...obj,id});const st=inventory.find(x=>x.productId===id);st.quantity=Number($('initialStock').value||0);st.updatedAt=now();await put('inventory',st)}else{obj.createdAt=now();const pid=await add('products',obj);await put('inventory',{productId:pid,quantity:Number($('initialStock').value||0),updatedAt:now()})}$('productDialog').close();await refresh()}catch(e){alert('حدث خطأ في حفظ الصنف.') }});
$('addLineBtn').onclick=addLine;$('confirmDispenseBtn').onclick=confirmDispense;$('clientSearch').oninput=renderClients;$('productSearch').oninput=renderProducts;$('invoiceSearch').oninput=renderInvoices;
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(b.dataset.screen).classList.add('active')});
async function backup(){const data={version:2,exportedAt:now(),clients,products,inventory,invoices,invoiceItems:await all('invoiceItems'),inventoryTransactions:await all('inventoryTransactions'),auditLogs:await all('auditLogs'),settings:await all('settings')};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`gamayati-backup-${monthKey()}.json`;a.click()}
async function restoreData(file){const data=JSON.parse(await file.text());if(!data||data.version<1)throw Error('نسخة غير صالحة');if(!confirm('الاسترجاع سيستبدل البيانات الحالية. تأكد أن لديك نسخة احتياطية.'))return;const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'];const tx=db.transaction(names,'readwrite');for(const n of names){const st=tx.objectStore(n);st.clear();for(const x of (data[n]||[]))st.put(x)}await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||Error('abort'))});await refresh();toast('تم استرجاع النسخة الاحتياطية.')}
$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=async e=>{try{await restoreData(e.target.files[0])}catch(err){alert('فشل الاسترجاع: '+err.message)}e.target.value=''};
$('saveSettingsBtn').onclick=async()=>{const v=Math.min(28,Math.max(1,Number($('monthEndDay').value||25)));await put('settings',{key:'monthEndDay',value:v});settings.monthEndDay=v;renderDashboard();toast('تم حفظ الإعدادات')};
$('resetBtn').onclick=async()=>{if(!confirm('تحذير: سيتم حذف كل بيانات البرنامج من هذا الجهاز. هل أنت متأكد؟'))return;const names=['clients','products','inventory','invoices','invoiceItems','inventoryTransactions','auditLogs','settings'];const tx=db.transaction(names,'readwrite');names.forEach(n=>tx.objectStore(n).clear());await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});await refresh();toast('تم حذف البيانات')};
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(console.error);
(async()=>{await openDB();await refresh()})();
