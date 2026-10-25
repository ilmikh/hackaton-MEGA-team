export class ApiError extends Error {
  constructor(message, status = 0, fields = {}) { super(message); this.status = status; this.fields = fields; }
}
const config = window.VELO_CONFIG || {};
export const demo = document.body.dataset.mode === "demo";
export function csrfToken() {
  const part = document.cookie.split(";").map(x => x.trim()).find(x => x.startsWith("csrftoken="));
  return part ? decodeURIComponent(part.slice(10)) : "";
}
export async function request(path, {method = "GET", body, signal} = {}) {
  const headers = {Accept: "application/json"};
  if (method !== "GET") headers["X-CSRFToken"] = csrfToken();
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  let response;
  try { response = await fetch((config.apiBase || "/api") + path, {method, body, signal, headers, credentials: "same-origin"}); }
  catch (e) { if (e.name === "AbortError") throw e; throw new ApiError("Нет связи с сервером. Проверьте подключение."); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const fields=data?.field_errors || {};
    if(Array.isArray(data?.detail))for(const error of data.detail){const key=error.loc?.at(-1);if(key)fields[key]=error.msg;}
    throw new ApiError(data?.message || (typeof data?.detail==="string" ? data.detail : null) || ({401:"Войдите в аккаунт.",403:"Недостаточно прав.",404:"Запись не найдена.",409:"Данные изменились или место уже занято.",422:"Проверьте поля формы."}[response.status] || "Не удалось выполнить запрос."), response.status, fields);
  }
  return data;
}
const array = value => Array.isArray(value) ? value : value?.results || [];
const seed = () => ({
  me:{id:"u1",display_name:"Алина Крылова",contact_type:"telegram",contact_value:"@alina_k",role:"resident"},
  users:[{id:"u2",display_name:"Иван Соколов",contact_type:"telegram",contact_value:"@ivan_s",room_number:"412",dormitory_name:"Гамма",lkp_synced_at:"2026-10-25T09:00:00Z"}],
  bikes:[
    {id:"b1",public_number:"В-001",owner_id:"u1",model:"Stels Navigator",color:"Сине-белый",special_marks:"Белые крылья",review_state:"approved",status_label:"Зарегистрирован",photo_url:null,parking_name:"Гамма — павильон",spot_code:"Г-01"},
    {id:"b2",public_number:"В-008",owner_id:"u1",model:"Forward",color:"Красный",special_marks:"",review_state:"approved",status_label:"Зарегистрирован",photo_url:null,parking_name:null,spot_code:null},
    {id:"b3",public_number:"В-014",owner_id:"u2",model:"Trek Marlin",color:"Чёрный",review_state:"approved",status_label:"Зарегистрирован",photo_url:null,parking_name:"Гамма — павильон",spot_code:"Г-02"}
  ]
});
let state;
try { state = JSON.parse(localStorage.getItem("velo-demo-v1")) || seed(); } catch { state = seed(); }
let role = "resident";
const save = () => { try { localStorage.setItem("velo-demo-v1",JSON.stringify(state)); } catch { throw new ApiError("Не хватает места для демоданных. Выберите фото меньшего размера."); } };
const clone = x => structuredClone(x);
function own(id) { const b = state.bikes.find(x => x.id === id); if (!b || (role !== "admin" && b.owner_id !== state.me.id)) throw new ApiError("Запись не найдена.",404); return b; }
const asData = file => new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(new ApiError("Не удалось прочитать фото.")); r.readAsDataURL(file); });
export const api = {
  setDemoRole(value) { if (demo) role = value === "admin" ? "admin" : "resident"; },
  async me() { return demo ? {...clone(state.me),role} : request("/me"); },
  async updateMe(values) {
    if (!demo) return request("/me",{method:"PATCH",body:values});
    Object.assign(state.me,{display_name:values.display_name,contact_type:values.contact_type,contact_value:values.contact_value}); save(); return this.me();
  },
  async bikes(admin = false) { return demo ? clone(state.bikes.filter(b => admin && role === "admin" || b.owner_id === state.me.id)) : array(await request(admin ? "/admin/bikes" : "/me/bikes")); },
  async bike(id,admin = false) {
    if (!demo) return request((admin ? "/admin/bikes/" : "/me/bikes/")+encodeURIComponent(id));
    const b = clone(own(id)); b.owner = b.owner_id === state.me.id ? clone(state.me) : clone(state.users.find(x => x.id === b.owner_id)); return b;
  },
  async updateBike(id,values,admin = false) {
    if (!demo) return request((admin?"/admin/bikes/":"/me/bikes/")+encodeURIComponent(id),{method:"PATCH",body:values});
    const b=own(id); Object.assign(b,{model:values.model,color:values.color,special_marks:values.special_marks}); save(); return clone(b);
  },
  async register(form) {
    if (!demo) return request("/me/bikes",{method:"POST",body:form});
    const id = crypto.randomUUID(), file = form.get("photo");
    const bike={id,public_number:"На проверке",owner_id:state.me.id,model:form.get("model"),color:form.get("color"),special_marks:form.get("special_marks"),review_state:"pending",status_label:"На рассмотрении",photo_url:file?.size ? await asData(file) : null,requested_spot_id:form.get("target_spot_id"),spot_code:null,parking_name:null};
    state.bikes.push(bike);
    try { save(); } catch(e) { state.bikes.pop(); throw e; } return clone(bike);
  },
  serverUrl(value) {
    if(typeof value!=="string"||!value)throw new ApiError("Сервер не вернул изображение QR.");
    const url=new URL(value,location.origin);
    if(url.origin!==location.origin || !/^https?:$/.test(url.protocol))throw new ApiError("Ожидался адрес файла с текущего сервера.");
    return url.href;
  },
  async scanPhoto(photo,admin=false) {
    if(demo)throw new ApiError("Распознавание QR выполняет бэк. Подключите API для проверки.");
    const body=new FormData();body.set("photo",photo);
    return request(admin?"/admin/qr/scan":"/qr/scan",{method:"POST",body});
  },
  async resolveQrUrl(url,admin=false) {
    if(demo)throw new ApiError("Обработку QR-ссылки выполняет бэк. Подключите API для проверки.");
    return request(admin?"/admin/qr/resolve":"/qr/resolve",{method:"POST",body:{url}});
  },
  async qr(id,admin=false) {
    if(demo)throw new ApiError("Изображение QR формирует бэк. Подключите API для просмотра.");
    return request((admin?"/admin/bikes/":"/me/bikes/")+encodeURIComponent(id)+"/qr");
  },
  async downloadQr(value) {
    const url=this.serverUrl(value);
    let response;try{response=await fetch(url,{credentials:"same-origin",headers:{Accept:"image/png"}});}catch{throw new ApiError("Не удалось скачать QR.");}
    if(!response.ok)throw new ApiError("Не удалось скачать QR.",response.status);
    const blob=await response.blob();
    if(blob.type.split(";")[0]!=="image/png")throw new ApiError("Сервер должен вернуть QR в PNG.");
    return blob;
  },
  async user(id) {
    if(!demo)return request("/admin/users/"+encodeURIComponent(id));
    if(role!=="admin")throw new ApiError("Недостаточно прав.",403);
    return clone(id===state.me.id ? {...state.me,room_number:"412",dormitory_name:"Гамма",lkp_synced_at:"2026-10-25T09:00:00Z"} : state.users.find(x=>x.id===id));
  },
  demoSpots() { return [{id:"s5",code:"Г-05",parking_name:"Гамма — павильон"},{id:"s6",code:"Г-06",parking_name:"Гамма — павильон"}]; }
};
