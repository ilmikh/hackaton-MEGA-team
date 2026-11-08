/* Connected frontend: data and permission checks come from FastAPI. */
(() => {
'use strict';
let me=null,csrf='',stream=null,busy=false,generation=0,selected=null,draft=null,requestDraft=null,pendingQr=location.pathname.startsWith('/q/')?location.origin+location.pathname:null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const admin=()=>me?.role==='admin';
const kinds={register:'Регистрация и место',place:'Закрепление',move:'Перемещение',release:'Освобождение',donate:'Передача в общий фонд',withdraw:'Выбытие',transfer:'Передача владельцу'};
const states={pending:'На рассмотрении',approved:'Одобрена',rejected:'Отклонена',cancelled:'Отменена'};
const statuses={registered:'Зарегистрирован',donated:'Общий фонд',withdrawn:'Выбыл из реестра',scrapped:'Передан на разбор'};
const api=async(path,options={})=>{
 const headers={Accept:'application/json',...options.headers};
 if(options.body && !(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
 if(options.method && options.method!=='GET')headers['X-CSRFToken']=csrf;
 let response;try{response=await fetch('/api'+path,{...options,headers,credentials:'same-origin'});}catch{throw Error('Нет связи с сервером');}
 const value=response.status===204?null:await response.json().catch(()=>null);
 if(!response.ok){if(response.status===401){me=null;csrf='';}throw Error(typeof value?.detail==='string'?value.detail:Array.isArray(value?.detail)?value.detail.map(v=>v.msg).join('; '):'Ошибка сервера');}
 return value;
};
function stop(){stream?.getTracks().forEach(t=>t.stop());stream=null;}
const link=(hash,label,cls='')=>'<a class="'+cls+'" href="#'+hash+'">'+label+'</a>';
const button=(action,label,data='',cls='secondary')=>'<button type="button" class="'+cls+'" data-action="'+action+'" '+data+'>'+label+'</button>';
const field=(label,name,value='',type='text',required=true)=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+' maxlength="'+(type==='password'?128:160)+'"></label>';
const form=(name,body,submit)=>'<form data-live-form="'+name+'" class="stack">'+body+'<p class="form-error" role="alert" hidden></p><button class="primary" type="submit">'+submit+'</button></form>';
function shell(title,content){
 const links=me?link('profile','Мой профиль')+link('bikes',admin()?'Реестр велосипедов':'Мои велосипеды')+link('parkings','Карта парковок')+link('requests',admin()?'Заявки':'Мои заявки')+link('scan','Сканировать QR')+(admin()?link('users','Жильцы')+link('events','Журнал изменений'):''):'';
 document.body.classList.toggle('auth-page',!me);
 document.body.innerHTML='<header class="top"><a class="brand" href="#profile">Велореестр</a><div class="account">'+esc(me?.name||'Студенческий кампус')+(me?button('logout','Выйти'):'')+'</div></header><div class="layout">'+(me?'<nav>'+links+'</nav>':'')+'<main><div class="page-heading"><h1>'+esc(title)+'</h1></div>'+content+'</main></div><dialog id="live-dialog"></dialog><div id="toast" role="status"></div>';
 let section=location.hash.slice(1).split('/')[0]||'profile';if(['bike','new-bike'].includes(section))section='bikes';if(section==='new-request')section='requests';if(section==='choose')section='parkings';
 for(const item of document.querySelectorAll('nav a'))if(item.hash==='#'+section){item.classList.add('active');item.setAttribute('aria-current','page');}
}
function toast(text){const t=document.getElementById('toast');t.textContent=text;t.classList.add('visible');setTimeout(()=>t.classList.remove('visible'),4500);}
function modal(title,body){const d=document.getElementById('live-dialog');d.innerHTML='<header><h2>'+esc(title)+'</h2><button type="button" class="icon-button" data-action="close" aria-label="Закрыть">×</button></header>'+body;d.showModal();}
function auth(register=false){shell(register?'Создать аккаунт':'Вход в велореестр','<section class="panel profile">'+form(register?'register':'login',(register?field('Фамилия и имя','name'):'')+field('Telegram username — логин','username')+field('Пароль','password','','password')+(!register?'<p>Нет аккаунта? '+link('register','Зарегистрироваться')+'</p>':'<p>Уже есть аккаунт? '+link('login','Войти')+'</p>'),register?'Зарегистрироваться':'Войти')+'</section>');}
function bikeCard(b){return link('bike/'+b.id,'<img class="bike-photo" src="'+esc(b.photo_url)+'" alt="Фото велосипеда"><div class="card-body"><h2>'+esc(b.number+' · '+b.model)+' →</h2><span class="badge '+(b.review==='pending'?'pending':'')+'">'+esc(b.review==='approved'?statuses[b.status]:states[b.review])+'</span><p>'+esc(b.color)+'</p><p>'+esc(b.place?b.place.parking_name+' · '+b.place.code:'Без места')+'</p>'+(admin()?'<p>'+esc(b.owner?.name||'Общий фонд')+'</p>':'')+'</div>','bike-card');}
async function render(){
 const turn=++generation;stop();let route;try{route=decodeURIComponent(location.hash.slice(1)||'profile');}catch{location.hash='profile';return;}const [page,id]=route.split('/');
 try{
 if(!me){auth(page==='register');return;}
 if(page==='login'||page==='register'){location.hash='profile';return;}
 if(page==='profile'){
 const reminders=await api('/me/reminders');if(turn!==generation)return;
 shell('Мой профиль',reminders.map(r=>'<section class="panel reminder" role="status">'+esc(r.message)+'</section>').join('')+'<section class="panel profile">'+form('profile',field('Имя','name',me.name)+field('Телефон','phone',me.phone,'tel',false)+'<p>Логин: @'+esc(me.username)+'</p>','Сохранить')+'</section><details class="panel"><summary>Сменить пароль</summary>'+form('password',field('Текущий пароль','current','','password')+field('Новый пароль (от 8 символов)','password','','password'),'Сменить пароль')+'</details>');
 }
 else if(page==='bikes'){
  const items=await api('/bikes');if(turn!==generation)return;
  shell(admin()?'Реестр велосипедов':'Мои велосипеды',link('new-bike','Зарегистрировать велосипед','button primary')+'<label class="search-label">Поиск по модели, цвету и месту<input id="bike-search" type="search" placeholder="Модель, цвет, место, владелец"></label><div class="bike-grid" id="bike-list">'+items.map(bikeCard).join('')+'</div><p id="bike-empty" '+(items.length?'hidden':'')+'>Велосипедов пока нет.</p>');
  if(admin())document.querySelector('#bike-list').innerHTML='<div class="live-table-wrap"><table class="live-table"><thead><tr><th>Велосипед</th><th>Владелец и связь</th><th>Место</th><th>Статус</th></tr></thead><tbody>'+items.map(b=>'<tr class="live-bike-row"><td><img class="thumb" src="'+esc(b.photo_url)+'" alt="">'+link('bike/'+b.id,esc(b.number+' · '+b.model))+'<br>'+esc(b.color)+'</td><td>'+esc(b.owner?.name||'Общий фонд')+'<br>'+esc(b.owner?'@'+b.owner.username+' '+b.owner.phone:'')+'</td><td>'+esc(b.place?b.place.parking_name+' · '+b.place.code:'Без места')+'</td><td>'+esc(b.review==='approved'?statuses[b.status]:states[b.review])+'</td></tr>').join('')+'</tbody></table></div>';
  document.querySelector('#bike-search').addEventListener('input',e=>{let count=0;for(const card of document.querySelectorAll('.bike-card,.live-bike-row')){card.hidden=!card.textContent.toLowerCase().includes(e.target.value.toLowerCase());if(!card.hidden)count++;}document.querySelector('#bike-empty').hidden=!!count;});
 }
 else if(page==='bike'){
  const b=await api('/bikes/'+id);if(turn!==generation)return;
  shell(b.number+' · '+b.model,link('bikes','← К велосипедам')+'<div class="detail-grid"><section class="panel"><img class="bike-photo" src="'+esc(b.photo_url)+'" alt="Велосипед"></section><section class="panel"><dl><dt>Модель</dt><dd>'+esc(b.model)+'</dd><dt>Цвет</dt><dd>'+esc(b.color)+'</dd><dt>Особые приметы</dt><dd>'+esc(b.marks||'Не указаны')+'</dd><dt>Статус</dt><dd>'+esc(b.review==='approved'?statuses[b.status]:states[b.review])+'</dd><dt>Место</dt><dd>'+esc(b.place?b.place.parking_name+' · '+b.place.code:'Без места')+'</dd>'+(admin()?'<dt>Владелец</dt><dd>'+esc(b.owner?.name||'Общий фонд')+' · @'+esc(b.owner?.username||'')+'</dd>':'')+'</dl><div class="actions">'+(b.review==='approved'?button('qr','Мой QR','data-id="'+b.id+'"')+button('edit','Изменить описание','data-id="'+b.id+'"'):'')+(b.owner_id===me.id?link('new-request/'+b.id,'Добавить заявку','button secondary'):'')+'</div></section></div>'+(admin()&&b.status==='scrapped'?'<p><a target="_blank" rel="noopener" href="/api/admin/bikes/'+b.id+'/act">Акт списания для печати</a></p>':'')+(admin()&&b.review==='approved'?'<section class="panel">'+form('status', '<input type="hidden" name="id" value="'+b.id+'"><label>Учётный статус<select name="status">'+Object.entries(statuses).map(([v,l])=>'<option value="'+v+'" '+(v===b.status?'selected':'')+'>'+l+'</option>').join('')+'</select></label>','Изменить статус')+'</section>':''));
 if(admin()&&b.review==='approved'&&['registered','donated'].includes(b.status))document.querySelector('main').insertAdjacentHTML('beforeend','<section class="panel"><h2>Назначить владельца</h2>'+form('owner','<input type="hidden" name="id" value="'+b.id+'">'+field('Telegram username получателя','username')+'<p class="hint">Новый владелец получит доступ к велосипеду. Прежний владелец потеряет доступ; изменение сохраняется в журнале.</p>','Передать владельцу')+'</section>');
 }
 else if(page==='new-bike'){
  shell('Зарегистрировать велосипед',form('bike','<section class="panel register-grid"><label>Фото велосипеда<input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required></label><div class="stack">'+field('Модель','model',draft?.get('model')||'')+field('Цвет','color',draft?.get('color')||'')+'<label>Особые приметы (необязательно)<textarea name="marks" maxlength="500">'+esc(draft?.get('marks')||'')+'</textarea></label></div></section><section class="panel"><h2>Парковочное место</h2><p>'+(selected?esc(selected.label):'Не выбрано')+'</p><input type="hidden" name="spot_id" value="'+esc(selected?.id||'')+'">'+button('choose','Выбрать место на карте')+'<p class="hint">Администратор подтвердит регистрацию и место. До решения место не бронируется.</p></section>','Отправить на регистрацию'));
 }
 else if(page==='parkings'||page==='choose'){await map(page==='choose',turn,id);}
 else if(page==='requests'){
  const items=await api('/requests');if(turn!==generation)return;
  shell(admin()?'Заявки':'Мои заявки',link('new-request','Добавить заявку','button primary')+'<label class="search-label">Состояние<select id="request-filter"><option value="all">Все</option>'+Object.entries(states).map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select></label><div id="requests-list">'+items.map(r=>'<section class="panel" data-state="'+esc(r.state)+'"><h2>'+esc(kinds[r.kind]+' · '+r.number)+'</h2><p>'+esc(r.model+(admin()?' · '+r.name:''))+'</p><p>'+esc(r.parking_name||'')+' '+esc(r.code||'')+'</p><span class="badge '+(r.state==='pending'?'pending':'')+'">'+esc(states[r.state])+'</span><details><summary>Подробнее</summary><p>'+esc(r.comment||'Без комментария')+'</p><p>'+esc(r.decision)+'</p><p>'+new Date(r.created*1000).toLocaleString('ru-RU')+'</p></details>'+(r.state==='pending'?(admin()?'<div class="actions">'+button('decision','Одобрить','data-id="'+r.id+'" data-state="approved"','primary')+button('decision','Отклонить','data-id="'+r.id+'" data-state="rejected"')+'</div>':button('cancel','Отменить заявку','data-id="'+r.id+'"')):'')+'<p><a target="_blank" rel="noopener" href="/api/requests/'+r.id+'/statement">Заявление для печати</a></p>'+(r.state==='approved'?'<a href="/api/requests/'+r.id+'/act" target="_blank" rel="noopener">Открыть акт для печати</a>':'')+'</section>').join('')+'<p id="request-empty" '+(items.length?'hidden':'')+'>Заявок нет.</p></div>');
  document.querySelector('#request-filter').onchange=e=>{let count=0;for(const el of document.querySelectorAll('[data-state]')){if(el.tagName!=='SECTION')continue;el.hidden=e.target.value!=='all'&&e.target.value!==el.dataset.state;if(!el.hidden)count++;}document.querySelector('#request-empty').hidden=!!count;};
 }
 else if(page==='new-request'){
  const bikes=(await api('/bikes')).filter(b=>b.owner_id===me.id&&b.review==='approved'&&b.status==='registered');if(turn!==generation)return;
  shell('Добавить заявку',bikes.length?'<section class="panel">'+form('request','<label>Тип<select name="kind">'+Object.entries(kinds).filter(([k])=>k!=='register').map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select></label><label>Мой велосипед<select name="bike_id">'+bikes.map(b=>'<option value="'+b.id+'" '+(b.id===id?'selected':'')+'>'+esc(b.number+' · '+b.model)+'</option>').join('')+'</select></label><p>Для закрепления/перемещения выберите место:</p><p>'+esc(selected?.label||'Не выбрано')+'</p><input type="hidden" name="spot_id" value="'+esc(selected?.id||'')+'">'+button('choose','Выбрать место')+field('Логин получателя (только при передаче)','recipient','','text',false)+'<label>Комментарий<textarea name="comment" maxlength="500"></textarea></label>','Отправить заявку')+'</section>':'<section class="panel">Нужен подтверждённый собственный велосипед. '+link('new-bike','Зарегистрировать')+'</section>');
 }
 else if(page==='scan'){
  shell('Сканировать QR','<section class="panel scanner-panel"><video id="live-camera" playsinline muted></video><div class="actions">'+button('camera','Включить камеру')+button('capture','Сфотографировать QR')+'</div>'+form('scan','<label>Или загрузите фото QR<input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required></label>','Распознать')+'</section>');
 }
 else if(page==='users'&&admin()){
 const users=await api('/admin/users');if(turn!==generation)return;
 shell('Жильцы',users.map(u=>'<section class="panel"><h2>'+esc(u.name)+'</h2><p>@'+esc(u.username)+' · '+esc(u.phone||'Телефон не указан')+'</p><p>Комната: '+esc(u.room||'Нет данных')+'</p>'+form('departure','<input type="hidden" name="id" value="'+u.id+'"><label>Дата выезда<input type="date" name="departure_date" value="'+esc(u.departure_date||'')+'"></label><p class="hint">При наличии велосипеда в кабинете жильца появится напоминание. Очистите дату, чтобы убрать напоминание.</p>','Сохранить дату')+'</section>').join(''));
 }
 else if(page==='events'&&admin()){
  const rows=await api('/admin/events');if(turn!==generation)return;
  shell('Журнал изменений','<section class="panel">'+rows.map(r=>'<p>'+esc(new Date(r.created*1000).toLocaleString('ru-RU')+' · '+r.action+' · '+r.entity+' · '+r.details)+'</p>').join('')+'</section>');
 }
 else{location.hash='profile';}
 const bf=document.querySelector('[data-live-form="bike"]');
 if(bf&&draft?.get('photo')?.size){bf.elements.photo.required=false;const note=document.createElement('p');note.className='hint';note.textContent='Фото выбрано: '+draft.get('photo').name;bf.elements.photo.after(note);}
 const rf=document.querySelector('[data-live-form="request"]');
 if(rf&&requestDraft)for(const [key,value] of Object.entries(requestDraft)){if(key!=='spot_id'&&rf.elements.namedItem(key))rf.elements.namedItem(key).value=value;}
 if(rf)prepareRequest(rf);
 }catch(error){if(turn!==generation)return;if(!me){auth();const box=document.querySelector('.form-error');box.hidden=false;box.textContent=error.message;}else shell('Не удалось открыть раздел','<section class="panel"><p role="alert">'+esc(error.message)+'</p>'+link('profile','В профиль')+'</section>');}
}
function prepareRequest(f){
 const update=()=>{const kind=f.elements.kind.value,needsPlace=['place','move'].includes(kind);const recipient=f.elements.recipient;recipient.required=kind==='transfer';recipient.closest('label').hidden=kind!=='transfer';f.querySelector('[data-action="choose"]').hidden=!needsPlace;f.querySelectorAll(':scope > p:not(.form-error)').forEach(p=>p.hidden=!needsPlace);};
 f.elements.kind.addEventListener('change',update);update();
}
let returnRoute='new-bike';
async function map(choosing,turn,parkingId){
 const rows=await api('/parkings');if(turn!==generation)return;
 shell(choosing?'Выберите свободное место':'Карта парковок','<p class="hint">Расположение по предоставленной схеме. Заполненность — из реестра.</p><div class="parking-layout"><section class="parking-map live-map">'+rows.map(p=>'<button class="parking-marker '+(p.free?'available':'full')+'" style="" data-parking="'+p.id+'" aria-label="'+esc(p.name)+'">'+esc(p.name)+'<br>'+(admin()?esc(p.free+' свободно · '+p.occupied+' занято'):p.free?'Есть места':'Мест нет')+'</button>').join('')+'</section><section class="panel" id="parking-info">Выберите парковку</section></div>'+(admin()?'<details class="panel"><summary>Добавить парковку</summary>'+form('parking',field('Название','name')+field('Описание','description','','text',false)+field('Положение X, 0–100','x','50','number')+field('Положение Y, 0–100','y','50','number')+field('Количество мест','capacity','10','number'),'Добавить')+'</details>':''));
 // Coordinates come from the validated parking records.
 for(const p of rows){const el=document.querySelector('[data-parking="'+p.id+'"]');el.style.left=p.x+'%';el.style.top=p.y+'%';}
 for(const el of document.querySelectorAll('[data-parking]'))el.onclick=async()=>{
  try{const spots=await api('/parkings/'+el.dataset.parking+'/spots');if(turn!==generation)return;
  const parking=rows.find(p=>p.id===el.dataset.parking);
  document.querySelector('#parking-info').innerHTML='<h2>'+esc(parking.name)+'</h2><p>'+esc(parking.description)+'</p>'+(admin()?button('parking-qr','QR парковки','data-id="'+parking.id+'"'):'')+'<div class="spot-list">'+spots.map(s=>'<div class="spot-row"><span>'+esc(s.code)+' · '+(s.bike_id?'Занято':'Свободно')+(s.bike?'<br>'+link('bike/'+s.bike.id,esc(s.bike.model+' · '+(s.bike.owner?.name||'Общий фонд'))):'')+'</span>'+(!s.bike_id?button(admin()?'assign':'select-spot',admin()?'Назначить':choosing?'Выбрать':'Занять','data-id="'+s.id+'" data-label="'+esc(parking.name+' · '+s.code)+'"','primary'):'')+'</div>').join('')+'</div>'+(!spots.length?'<p>Свободных мест нет.</p>':'');if(admin())document.querySelector('#parking-info .spot-list').innerHTML=[['Занятые места',spots.filter(s=>s.bike_id)],['Свободные места',spots.filter(s=>!s.bike_id)]].map(([label,rows])=>'<h3>'+label+' · '+rows.length+'</h3><div class="live-table-wrap"><table class="live-table"><thead><tr><th>Место</th><th>Велосипед / владелец</th><th>Действие</th></tr></thead><tbody>'+rows.map(s=>'<tr><td>'+esc(s.code)+'</td><td>'+(s.bike?esc(s.bike.number+' · '+s.bike.model)+'<br>'+esc(s.bike.owner?.name||'Общий фонд'):'—')+'</td><td>'+(s.bike?link('bike/'+s.bike.id,'Карточка'):button('assign','Назначить','data-id="'+s.id+'"'))+'</td></tr>').join('')+'</tbody></table></div>').join('');
 }catch(error){toast(error.message);}
 };
 if(parkingId)document.querySelector('[data-parking="'+parkingId+'"]')?.click();
}
async function resolvePendingQr(){if(pendingQr){const url=pendingQr;pendingQr=null;try{await showScan(await api('/qr/resolve',{method:'POST',body:{url}}));}catch(error){toast(error.message);}}}
async function showScan(data){
 stop();
 if(data.kind==='parking'){location.hash='parkings/'+data.parking_id;return;}
 const b=data.bike,o=b.owner;
 modal('Велосипед '+b.number,'<p>'+esc(o?.name||'Владелец не установлен')+'</p><p>'+esc(o?'@'+o.username+' '+(o.phone||''):'Обратитесь к администрации')+'</p>'+(admin()?'<p>'+esc(b.model)+'</p>'+link('bike/'+b.id,'Полная карточка','button primary'):'')+button('close','Сканировать ещё'));
}
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-action]');if(!el||busy)return;
 try{
 const id=el.dataset.id;
 switch(el.dataset.action){
 case 'close':document.querySelector('#live-dialog').close();break;
 case 'logout':await api('/auth/logout',{method:'POST'});me=null;csrf='';draft=null;requestDraft=null;selected=null;location.hash='login';render();break;
 case 'choose':{
  const f=document.querySelector('[data-live-form="bike"]');if(f)draft=new FormData(f);const rf=document.querySelector('[data-live-form="request"]');if(rf)requestDraft=Object.fromEntries(new FormData(rf));returnRoute=location.hash.slice(1);location.hash='choose';break;
 }
 case 'select-spot':selected={id,label:el.dataset.label};location.hash=location.hash==='#choose'?returnRoute:'new-request';break;
 case 'qr':case 'parking-qr':modal('QR','<img class="server-qr" src="/api/qr/'+(el.dataset.action==='qr'?'bike':'parking')+'/'+id+'.png" alt="QR"><a class="button primary" download="qr.png" href="/api/qr/'+(el.dataset.action==='qr'?'bike':'parking')+'/'+id+'.png">Скачать PNG</a>');break;
 case 'assign':{const all=(await api('/bikes')).filter(b=>b.review==='approved'&&b.status==='registered');modal('Назначить место',all.length?form('placement','<input type="hidden" name="spot_id" value="'+id+'"><label>Велосипед<select name="bike_id">'+all.map(b=>'<option value="'+b.id+'">'+esc(b.number+' · '+b.model)+'</option>').join('')+'</select></label>','Назначить'):'<p>Нет подтверждённых велосипедов.</p>');break;}
 case 'cancel':await api('/requests/'+id+'/cancel',{method:'POST'});render();break;
 case 'decision':modal('Решение по заявке',form('decision','<input type="hidden" name="id" value="'+id+'"><input type="hidden" name="state" value="'+el.dataset.state+'"><label>Комментарий '+(el.dataset.state==='rejected'?'(обязательно)':'')+'<textarea name="comment" maxlength="500" '+(el.dataset.state==='rejected'?'required':'')+'></textarea></label>','Подтвердить'));break;
 case 'edit':{const b=await api('/bikes/'+id);modal('Изменить описание',form('edit','<input type="hidden" name="id" value="'+id+'">'+field('Модель','model',b.model)+field('Цвет','color',b.color)+'<label>Приметы<textarea name="marks" maxlength="500">'+esc(b.marks)+'</textarea></label>','Сохранить'));break;}
 case 'camera':stop();stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});if(location.hash!=='#scan'){stop();break;}document.querySelector('#live-camera').srcObject=stream;await document.querySelector('#live-camera').play();break;
 case 'capture':{const v=document.querySelector('#live-camera');if(!v.videoWidth)throw Error('Сначала включите камеру');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const f=new FormData();f.set('photo',blob,'camera.jpg');await showScan(await api('/qr/scan',{method:'POST',body:f}));break;}
 }
 }catch(error){toast(error.message);}
});
document.addEventListener('submit',async e=>{
 const f=e.target;if(!f.matches('[data-live-form]'))return;e.preventDefault();if(busy)return;
 const data=new FormData(f),values=Object.fromEntries(data),kind=f.dataset.liveForm,submit=f.querySelector('[type=submit]'),box=f.querySelector('.form-error');
 busy=true;submit.disabled=true;box.hidden=true;
 try{
 if(kind==='login'||kind==='register'){me=await api('/auth/'+kind,{method:'POST',body:values});csrf=me.csrf;f.reset();location.hash='profile';await render();await resolvePendingQr();}
 if(kind==='profile'){await api('/me',{method:'PATCH',body:values});me={...me,...values};toast('Профиль сохранён');}
 if(kind==='password'){await api('/me/password',{method:'POST',body:values});me=null;csrf='';f.reset();location.hash='login';await render();}
 if(kind==='bike'){if(draft?.get('photo')?.size && !data.get('photo')?.size)data.set('photo',draft.get('photo'));const b=await api('/bikes',{method:'POST',body:data});draft=null;selected=null;location.hash='bike/'+b.id;}
 if(kind==='request'){values.spot_id=['place','move'].includes(values.kind)?values.spot_id||null:null;values.recipient=values.kind==='transfer'?values.recipient||null:null;if(['place','move'].includes(values.kind)&&!values.spot_id)throw Error('Выберите свободное место');await api('/requests',{method:'POST',body:values});selected=null;requestDraft=null;location.hash='requests';}
 if(kind==='decision'){const id=values.id;delete values.id;await api('/admin/requests/'+id+'/decision',{method:'POST',body:values});document.querySelector('#live-dialog').close();await render();}
 if(kind==='edit'){const id=values.id;delete values.id;await api('/bikes/'+id,{method:'PATCH',body:values});document.querySelector('#live-dialog').close();await render();}
 if(kind==='owner'){const id=values.id;await api('/admin/bikes/'+id+'/owner',{method:'PATCH',body:{username:values.username}});await render();}
 if(kind==='status'){const id=values.id;delete values.id;await api('/admin/bikes/'+id+'/status',{method:'PATCH',body:values});await render();}
 if(kind==='scan')await showScan(await api('/qr/scan',{method:'POST',body:data}));
 if(kind==='departure'){const id=values.id;await api('/admin/users/'+id+'/departure',{method:'PATCH',body:{departure_date:values.departure_date||null}});toast('Дата сохранена');}
 if(kind==='placement'){await api('/admin/bikes/'+values.bike_id+'/placement',{method:'POST',body:{spot_id:values.spot_id}});document.querySelector('#live-dialog').close();await render();}
 if(kind==='parking'){for(const key of ['capacity','x','y'])values[key]=Number(values[key]);await api('/admin/parkings',{method:'POST',body:values});await render();}
 }catch(error){box.textContent=error.message;box.hidden=false;}
 finally{busy=false;if(submit.isConnected)submit.disabled=false;}
});
window.addEventListener('hashchange',render);window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
(async()=>{try{me=await api('/me');csrf=me.csrf;}catch{me=null;}await render();if(me)await resolvePendingQr();})();
})();
