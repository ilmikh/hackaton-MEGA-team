import {api,demo,ApiError} from "./api.js";
import {Scanner} from "./scanner.js";
const root=document.querySelector("#app"), dialog=document.querySelector("#modal");
const cfg=window.VELO_CONFIG || {};
const e=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let me=null,scanner=null,version=0,draft={},draftPhoto=null,selectedSpot=null,lastFocus=null,saveBusy=false,lookupBusy=false;
const isAdmin=()=>me?.role==="admin";
const bikeIcon='<svg viewBox="0 0 120 70" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="25" cy="46" r="18"/><circle cx="94" cy="46" r="18"/><path d="m25 46 22-32 20 32H25l15-23h42l12 23-17-37h-9M36 12h17"/></svg>';
const safeImage=url=>/^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(url||"") ? url : "";
const photo=b=>safeImage(b.photo_url)?'<img class="bike-photo" src="'+e(b.photo_url)+'" alt="'+e(b.model)+'">':'<div class="photo-placeholder">'+bikeIcon+'<span>Фото не добавлено</span></div>';
const badge=b=>'<span class="badge '+(b.review_state==="pending"?"pending":"")+'">'+e(b.review_state==="pending"?"На рассмотрении":b.status_label||"Зарегистрирован")+'</span>';
const link=(route,label,cls="")=>'<a class="'+cls+'" href="#'+route+'">'+label+'</a>';
function contact(owner) {
  const value=owner?.contact_value||"", type=owner?.contact_type;
  if(type==="telegram" && /^@?[A-Za-z0-9_]{5,32}$/.test(value))return '<a href="https://t.me/'+e(value.replace(/^@/,""))+'" target="_blank" rel="noopener noreferrer">Telegram · '+e(value)+'</a>';
  if(type==="phone" && /^\+?[0-9 ()-]{5,25}$/.test(value) && value.replace(/\D/g,"").length>=5)return '<a href="tel:'+e(value.replace(/[ ()-]/g,""))+'">'+e(value)+'</a>';
  return '<span>'+e(value||"Контакт не указан")+'</span>';
}
function notify(text){const el=document.querySelector("#toast");el.textContent=text;el.classList.add("visible");clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove("visible"),4500);}
function closeModal(){if(dialog.open)dialog.close();}
function modal(title,content){closeModal();lastFocus=document.activeElement;dialog.innerHTML='<header><h2>'+e(title)+'</h2><button type="button" class="icon-button" data-action="close" aria-label="Закрыть">×</button></header>'+content;dialog.showModal();}
dialog.addEventListener("close",()=>{dialog.innerHTML="";lastFocus?.focus?.();});
dialog.addEventListener("click",event=>{if(event.target===dialog)closeModal();});
const action=(name,label,classes="secondary",attrs="")=>'<button type="button" class="'+classes+'" data-action="'+name+'" '+attrs+'>'+label+'</button>';
function shell(){
 const current=location.hash.slice(1).split("?")[0]||"/profile";
 const items=isAdmin()?[["/profile","Мой профиль"],["/admin/map","Велосипеды"],["/scan","Сканировать QR"],["/admin/requests","Заявки"]]:[["/profile","Мой профиль"],["/bikes","Мои велосипеды"],["/scan","Сканировать QR"],["/map","Карта парковок"],["/requests","Мои заявки"]];
 root.innerHTML='<header class="top"><a href="#/profile" class="brand"><span aria-hidden="true">♧</span> Велореестр</a><div class="account">'+e(me.display_name)+' <span class="muted">'+(isAdmin()?"Администратор":"Жилец")+'</span></div></header>'+
 (demo?'<aside class="demo-banner">ДЕМО · Данные сохраняются только в этом браузере. <label>Роль <select id="demo-role"><option value="resident" '+(!isAdmin()?"selected":"")+'>Жилец</option><option value="admin" '+(isAdmin()?"selected":"")+'>Администратор</option></select></label></aside>':"")+
 '<div class="layout"><nav aria-label="Главная навигация">'+items.map(([path,label])=>link(path,e(label),current===path||path==="/bikes"&&current.startsWith("/bikes/")?"active":"")).join("")+'</nav><main id="main" tabindex="-1"><p class="loading" role="status">Загрузка…</p></main></div>';
}
function page(title,content,extra=""){return '<div class="page-heading"><h1>'+e(title)+'</h1>'+extra+'</div>'+content;}
function errors(form,err){const box=form.querySelector(".form-error");box.textContent=err.message;box.hidden=false;for(const [name,message]of Object.entries(err.fields||{})){const input=form.elements.namedItem(name);if(input){input.setAttribute("aria-invalid","true");input.setCustomValidity(Array.isArray(message)?message.join(" "):String(message));input.addEventListener("input",()=>{input.setCustomValidity("");input.removeAttribute("aria-invalid");},{once:true});}}box.focus();}
function formError(){return '<p class="form-error" tabindex="-1" role="alert" hidden></p>';}
function profile(){return page("Мой профиль",'<p class="muted">Личные данные и способ связи</p><form id="profile-form" class="panel profile">'+formError()+'<label>Имя<input name="display_name" required maxlength="120" value="'+e(me.display_name)+'" autocomplete="name"></label><label>Способ связи<select name="contact_type"><option value="telegram" '+(me.contact_type==="telegram"?"selected":"")+'>Telegram</option><option value="phone" '+(me.contact_type==="phone"?"selected":"")+'>Телефон</option></select></label><label>Контакт<input name="contact_value" required maxlength="80" value="'+e(me.contact_value)+'" placeholder="@username или номер телефона"></label><p class="hint">По QR велосипеда видны только имя и контакт.</p><button class="primary" type="submit">Сохранить изменения</button></form>');}
async function bikes(admin=false){
 const list=await api.bikes(admin);
 return page(admin?"Все велосипеды":"Мои велосипеды",list.length?'<div class="bike-grid">'+list.map(b=>link((admin?"/admin/bikes/":"/bikes/")+encodeURIComponent(b.id),photo(b)+'<div class="card-body"><h2>'+e(b.public_number)+' · '+e(b.model)+' <span aria-hidden="true">→</span></h2>'+badge(b)+'<p>'+e(b.spot_code ? b.spot_code+" · "+b.parking_name : b.review_state==="pending"?"Регистрация на рассмотрении":"Без места")+'</p></div>',"bike-card")).join("")+'</div>':'<div class="panel empty">'+bikeIcon+'<h2>Пока нет велосипедов</h2><p>Добавьте свой первый велосипед.</p></div>',admin?"":link("/register","Зарегистрировать велосипед","button primary"));
}
async function bikePage(id,admin=false){
 const b=await api.bike(id,admin);
 const owner=admin&&b.owner?'<section class="panel"><h2>Владелец</h2><p>'+e(b.owner.display_name)+'</p><p>'+contact(b.owner)+'</p>'+link("/admin/users/"+encodeURIComponent(b.owner_id),"Профиль владельца")+'</section>':"";
 return link(admin?"/admin/bikes":"/bikes","← Назад к велосипедам","back")+page(b.public_number+" · "+b.model,'<div class="detail-grid"><section class="panel">'+photo(b)+'</section><div><section class="panel"><h2>Информация о велосипеде</h2>'+badge(b)+'<dl><dt>Модель</dt><dd>'+e(b.model)+'</dd><dt>Цвет</dt><dd>'+e(b.color)+'</dd><dt>Особые приметы</dt><dd>'+e(b.special_marks||"Не указаны")+'</dd><dt>Парковка</dt><dd>'+e(b.parking_name||"Не закреплена")+'</dd><dt>Место</dt><dd>'+e(b.spot_code||"Нет")+'</dd></dl></section>'+owner+'<section class="panel stack"><h2>Действия</h2>'+action("show-qr","Мой QR","primary",'data-id="'+e(id)+'" data-admin="'+admin+'" '+(b.review_state!=="approved"?"disabled":""))+action("edit-bike","Изменить описание","secondary",'data-id="'+e(id)+'" data-admin="'+admin+'" '+(b.review_state==="pending"?"disabled":""))+action("request","Добавить заявку","secondary",'data-id="'+e(id)+'"')+'</section></div></div>');
}
function registration(){return page("Зарегистрировать велосипед",'<form id="register-form">'+formError()+'<section class="panel register-grid"><label class="upload">Фото велосипеда <span id="photo-preview">'+(draftPhoto?'<span>Выбрано: '+e(draftPhoto.name)+'</span>':bikeIcon)+'</span><input name="photo" id="bike-photo" type="file" accept="image/jpeg,image/png,image/webp" '+(!draftPhoto?"required":"")+'><small>JPG, PNG, WebP до 2 МБ</small></label><div class="stack"><label>Модель<input name="model" required maxlength="120" value="'+e(draft.model)+'" placeholder="Например, Stels Navigator"></label><label>Цвет<input name="color" required maxlength="80" value="'+e(draft.color)+'" placeholder="Например, сине-белый"></label><label>Особые приметы <small>(необязательно)</small><textarea name="special_marks" maxlength="500" rows="3">'+e(draft.special_marks)+'</textarea></label></div></section><section class="panel"><h2>Парковочное место</h2><p id="selected-place">'+(selectedSpot?e(selectedSpot.parking_name+" · "+selectedSpot.code):"Место ещё не выбрано")+'</p>'+action("pick-place",selectedSpot?"Изменить место на карте":"Выбрать место на карте")+'<p class="hint">На карте выбираются только свободные места. Регистрацию и место подтвердит администратор.</p></section><section class="panel"><p>Владелец: <strong>'+e(me.display_name)+'</strong> · '+contact(me)+'</p><div class="actions"><button type="submit" class="primary">Отправить на регистрацию</button>'+link("/bikes","Отмена","button secondary")+'</div></section></form>');}
function scannerPage(){return page("Сканировать QR",'<p class="muted">Велосипед или парковка</p><section class="panel scanner-panel"><div class="video-frame"><video id="camera" playsinline muted aria-label="Камера для снимка QR"></video><span>Наведите камеру на QR</span></div><p id="scan-error" class="form-error" role="alert" hidden></p><div class="actions">'+action("start-camera","Включить камеру","primary")+action("capture-qr","Сфотографировать QR")+action("stop-camera","Выключить камеру")+'<label class="button secondary">Загрузить фото QR<input class="visually-hidden" type="file" id="qr-photo" accept="image/png,image/jpeg,image/webp"></label></div><p class="hint">Снимок будет отправлен на сервер для распознавания. Камера работает через HTTPS или localhost.</p><form id="qr-link-form" class="qr-link"><label>Или вставьте ссылку QR<input name="url" type="url" required placeholder="https://ваш-сайт/q/b/…"></label><button class="secondary" type="submit">Проверить</button></form>'+(demo?'<p class="hint">Для распознавания и получения QR требуется подключённый бэк.</p>':"")+'</section>');}
async function ownerPage(id){const u=await api.user(id);if(!u)throw new ApiError("Пользователь не найден.",404);
 return page("Профиль владельца",'<div class="detail-grid"><section class="panel"><h2>'+e(u.display_name)+'</h2><p>'+contact(u)+'</p></section><section class="panel"><h2>Проживание · ЛКП</h2><dl><dt>Общежитие</dt><dd>'+e(u.dormitory_name||"Нет данных из ЛКП")+'</dd><dt>Комната</dt><dd>'+e(u.room_number||"Нет данных из ЛКП")+'</dd></dl><p class="hint">Импортируется из ЛКП. Только для администратора.</p><p>'+e(u.lkp_synced_at ? "Обновлено: "+new Date(u.lkp_synced_at).toLocaleString("ru-RU") : "ЛКП пока не подключён")+'</p></section></div>');
}
function handoff(route){
 const label=route.includes("requests")?"Заявки":"Карта парковок";
 return page(label,'<section class="panel empty"><h2>Раздел пока недоступен</h2><p>Вернитесь сюда позже.</p>'+link("/profile","Мой профиль","button secondary")+(demo?'<p class="hint">Демо: эту часть подключает второй фронтенд-разработчик. '+(route==="/admin/map"?link("/admin/bikes","Открыть демосписок велосипедов"):"")+'</p>':"")+'</section>');
}
function routeInfo(){try{return decodeURI(location.hash.slice(1)||"/profile").split("?")[0];}catch{return "/not-found";}}
async function render(){
 const ticket=++version;scanner?.stop();scanner=null;lookupBusy=false;closeModal();shell();
 const path=routeInfo();let html;
 try {
  if(path.startsWith("/admin/")&&!isAdmin())throw new ApiError("Недостаточно прав.",403);
  if(path==="/profile")html=profile();
  else if(path==="/bikes")html=await bikes();
  else if(path==="/register")html=registration();
  else if(path==="/scan")html=scannerPage();
  else if(/^\/bikes\/[^/]+$/.test(path))html=await bikePage(path.split("/")[2]);
  else if(path==="/admin/bikes")html=await bikes(true);
  else if(/^\/admin\/bikes\/[^/]+$/.test(path))html=await bikePage(path.split("/")[3],true);
  else if(/^\/admin\/users\/[^/]+$/.test(path))html=await ownerPage(path.split("/")[3]);
  else if(["/map","/requests","/admin/map","/admin/requests"].includes(path)) {
    const external=cfg.routes?.[path]; if(external){const url=new URL(external,location.origin);if(url.origin!==location.origin)throw new ApiError("Неверный адрес раздела.");location.assign(url.href);return;}
    html=handoff(path);
  } else html=page("Страница не найдена",link("/profile","Вернуться в профиль"));
 }catch(err){html=page("Не удалось открыть страницу",'<div class="panel"><p role="alert">'+e(err.message)+'</p>'+action("retry","Повторить")+'</div>');}
 if(ticket!==version)return;
 document.querySelector("#main").innerHTML=html;
 if(path==="/scan"){scanner=new Scanner(document.querySelector("#camera"),handleImage,scanError);}
 document.title=(document.querySelector("h1")?.textContent||"Велореестр")+" · Велореестр";
}
function scanError(message){const box=document.querySelector("#scan-error");if(box){box.textContent=message;box.hidden=false;}else notify(message);}
async function qrOperation(operation){
 if(lookupBusy||dialog.open)return;lookupBusy=true;const ticket=version;scanner?.stop();
 const box=document.querySelector("#scan-error");if(box)box.hidden=true;
 document.querySelectorAll('[data-action="capture-qr"], #qr-link-form button').forEach(b=>b.disabled=true);
 try {
  const result=await operation();
  if(ticket!==version)return;
  if(result.kind==="parking"){handoffTo(isAdmin()?"/admin/map":"/map",{parkingId:result.parking_id});return;}
  if(result.kind!=="bike" || !result.bike)throw Error("Сервер вернул неподдерживаемый результат QR.");
  const b=result.bike,owner=b.owner || {};
  let content='<p class="eyebrow">'+(isAdmin()?"Административный просмотр":"Связь с владельцем")+'</p>';
  if(isAdmin())content+='<div class="modal-grid">'+photo(b)+'<div><p><strong>'+e(b.model)+'</strong></p><p>'+e(b.status_label)+'</p><p>'+e(owner.display_name||"Владелец не установлен")+'</p><p>'+contact(owner)+'</p><p>Место: '+e(b.spot_code||"Без места")+'</p><p>Комната: '+e(owner.room_number||"Нет данных из ЛКП")+'</p></div></div>';
  else content+='<h3>'+e(owner.display_name||"Владелец не установлен")+'</h3><p>'+contact(owner)+'</p>';
  content+='<div class="actions">'+(isAdmin()?link("/admin/bikes/"+encodeURIComponent(b.id),"Открыть полную карточку","button primary"):"")+action("rescan","Сканировать ещё")+'</div>';
  modal("Велосипед "+b.public_number,content);
 }catch(err){if(ticket===version)scanError(err.message);}
 finally{if(ticket===version){lookupBusy=false;document.querySelectorAll('[data-action="capture-qr"], #qr-link-form button').forEach(b=>b.disabled=false);}}
}
async function handleImage(file){return qrOperation(()=>api.scanPhoto(file,isAdmin()));}
async function handleQr(url){return qrOperation(()=>api.resolveQrUrl(url,isAdmin()));}
function readDraft(){const form=document.querySelector("#register-form");if(form){const data=new FormData(form);draft={model:data.get("model"),color:data.get("color"),special_marks:data.get("special_marks")};}}
function handoffTo(path,context={}) {
 const event=new CustomEvent("velo:navigate",{cancelable:true,detail:{path,context}});
 window.dispatchEvent(event);if(event.defaultPrevented)return;
 sessionStorage.setItem("velo-navigation",JSON.stringify({path,context}));
 location.hash=path;
}
function applySpot(spot){
 if(!spot||typeof spot.id!=="string"||!spot.id||typeof spot.code!=="string"||typeof spot.parking_name!=="string")throw new Error("Некорректное место.");
 selectedSpot={id:spot.id,code:spot.code,parking_name:spot.parking_name};closeModal();location.hash="/register";render();
}
window.VeloRegistry={selectPlace:applySpot,navigate:handoffTo};
window.addEventListener("velo:place-selected",event=>{try{applySpot(event.detail);}catch(err){notify(err.message);}});
document.addEventListener("change",async event=>{
 if(event.target.id==="demo-role"){scanner?.stop();api.setDemoRole(event.target.value);me=await api.me();draft={};draftPhoto=null;selectedSpot=null;location.hash="/profile";render();}
 if(event.target.id==="bike-photo"){
  const f=event.target.files[0];
  if(f && (!/^image\/(png|jpeg|webp)$/.test(f.type)||f.size>2*1024*1024)){event.target.value="";notify("Выберите JPG, PNG или WebP до 2 МБ.");return;}
  if(f){draftPhoto=f;document.querySelector("#photo-preview").textContent="Выбрано: "+f.name;}
 }
 if(event.target.id==="qr-photo"){const f=event.target.files[0];if(f){closeModal();await scanner?.photo(f);}event.target.value="";}
});
document.addEventListener("click",async event=>{
 const btn=event.target.closest("[data-action]");if(!btn)return;
 try {
  const id=btn.dataset.id, admin=btn.dataset.admin==="true";
  switch(btn.dataset.action){
   case "close":closeModal();break;
   case "retry":render();break;
   case "start-camera":closeModal();document.querySelector("#scan-error").hidden=true;await scanner?.start();break;
   case "capture-qr":await scanner?.capture();break;
   case "stop-camera":scanner?.stop();break;
   case "rescan":closeModal();await scanner?.start();break;
   case "request":handoffTo(isAdmin()?"/admin/requests":"/requests",{bikeId:id,create:true});break;
   case "show-qr":{
    const data=await api.qr(id,admin);
    const imageUrl=api.serverUrl(data.image_url),downloadUrl=api.serverUrl(data.download_url||data.image_url);
    modal("QR велосипеда",'<div class="qr-image"><img src="'+e(imageUrl)+'" alt="QR велосипеда, полученный от сервера"></div>'+action("download-qr","Скачать QR","primary",'data-url="'+e(downloadUrl)+'"'));
    break;
   }
   case "download-qr":{const blob=await api.downloadQr(btn.dataset.url);const url=URL.createObjectURL(blob);try{const a=document.createElement("a");a.href=url;a.download="bike-qr.png";a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}break;}
   case "edit-bike":{
    const b=await api.bike(id,admin);
    modal("Изменить описание",'<form id="edit-bike-form" data-id="'+e(id)+'" data-admin="'+admin+'" class="stack">'+formError()+'<label>Модель<input name="model" required maxlength="120" value="'+e(b.model)+'"></label><label>Цвет<input name="color" required maxlength="80" value="'+e(b.color)+'"></label><label>Особые приметы (необязательно)<textarea name="special_marks" maxlength="500">'+e(b.special_marks)+'</textarea></label><button type="submit" class="primary">Сохранить</button></form>');break;
   }
   case "pick-place":{
    readDraft();const selectionVersion=version;
    const event=new CustomEvent("velo:pick-place",{cancelable:true,detail:{onlyFree:true,selected:selectedSpot,onSelect:spot=>{if(version===selectionVersion)applySpot(spot);}}});
    window.dispatchEvent(event);if(event.defaultPrevented)break;
    if(demo){modal("Демо: выбор свободного места",'<p class="hint">В приложении здесь открывается карта, которую подключит тиммейт.</p><div class="stack">'+api.demoSpots().map(s=>action("demo-place",e(s.parking_name+" · "+s.code),"secondary",'data-id="'+e(s.id)+'"')).join("")+'</div>');}
    else handoffTo("/map",{select:true,onlyFree:true,returnTo:"/register"});
    break;
   }
   case "demo-place":applySpot(api.demoSpots().find(x=>x.id===id));break;
  }
 }catch(err){notify(err.message);}
});
document.addEventListener("submit",async event=>{
 const form=event.target;if(!["profile-form","register-form","edit-bike-form","qr-link-form"].includes(form.id))return;
 event.preventDefault();if(form.id==="qr-link-form"){await handleQr(new FormData(form).get("url"));return;}
 if(saveBusy)return;
 const submit=form.querySelector('[type="submit"]');saveBusy=true;submit.disabled=true;
 try {
  const data=new FormData(form);const values=Object.fromEntries(data);
  for(const key of ["display_name","contact_value","model","color"])if(typeof values[key]==="string")values[key]=values[key].trim();
  if(form.id==="profile-form"){
   if(!values.display_name||!values.contact_value)throw new ApiError("Заполните имя и контакт.");
   if(values.contact_type==="telegram"&&!/^@?[A-Za-z0-9_]{5,32}$/.test(values.contact_value))throw new ApiError("Укажите Telegram username: 5–32 буквы, цифры или знак подчёркивания.");
   if(values.contact_type==="phone"&&(!/^\+?[0-9 ()-]{5,25}$/.test(values.contact_value)||values.contact_value.replace(/\D/g,"").length<5))throw new ApiError("Проверьте номер телефона.");
   me=await api.updateMe(values);notify("Профиль сохранён.");await render();
  }
  if(form.id==="register-form"){
   if(!values.model||!values.color)throw new ApiError("Укажите модель и цвет.");
   if(!draftPhoto)throw new ApiError("Добавьте фотографию велосипеда.");
   if(!selectedSpot)throw new ApiError("Выберите свободное место на карте.");
   data.set("photo",draftPhoto);data.set("model",values.model);data.set("color",values.color);data.set("target_spot_id",selectedSpot.id);
   const b=await api.register(data);draft={};draftPhoto=null;selectedSpot=null;notify(demo?"Демо: регистрация сохранена локально.":"Регистрация отправлена на рассмотрение.");location.hash="/bikes/"+encodeURIComponent(b.id);
  }
  if(form.id==="edit-bike-form"){
   if(!values.model||!values.color)throw new ApiError("Укажите модель и цвет.");
   await api.updateBike(form.dataset.id,{model:values.model,color:values.color,special_marks:values.special_marks},form.dataset.admin==="true");closeModal();notify("Описание сохранено.");await render();
  }
 }catch(err){errors(form,err);}finally{saveBusy=false;if(submit.isConnected)submit.disabled=false;}
});
window.addEventListener("hashchange",render);
document.addEventListener("visibilitychange",()=>{if(document.hidden)scanner?.stop();});
window.addEventListener("pagehide",()=>scanner?.stop());
async function start(){
 try {me=await api.me();if(/^\/q\/[bp]\//.test(location.pathname)){history.replaceState(null,"",location.pathname+location.search+"#/scan");await render();await handleQr(location.origin+location.pathname);}else await render();}
 catch(err){root.innerHTML='<main class="startup panel"><h1>Велореестр</h1><p role="alert">'+e(err.message)+'</p>'+(err.status===401?'<a href="'+e(cfg.loginUrl||"/accounts/login/")+'" class="button primary">Войти</a>':'<button onclick="location.reload()" class="primary">Повторить</button>')+'</main>';}
}
start();
