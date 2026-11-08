"""FastAPI application. Run from repository root: uvicorn backend.main:app."""
import os, re, io, json, time, secrets, hashlib, hmac, sqlite3, html
from pathlib import Path
from contextlib import contextmanager, asynccontextmanager
from datetime import date, datetime, timezone
from urllib.parse import urlsplit
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import HTMLResponse, Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, field_validator
from PIL import Image, ImageOps, UnidentifiedImageError
import qrcode

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get("VELO_DATA_DIR",str(ROOT/"data"))).resolve()
DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/"registry.sqlite3"
SCHEMA="""
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'resident',room TEXT NOT NULL DEFAULT '',departure_date TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS parkings(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',x REAL NOT NULL,y REAL NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS spots(id TEXT PRIMARY KEY,parking_id TEXT NOT NULL REFERENCES parkings(id),code TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(parking_id,code));
CREATE TABLE IF NOT EXISTS bikes(id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,owner_id TEXT REFERENCES users(id),model TEXT NOT NULL,color TEXT NOT NULL,marks TEXT NOT NULL DEFAULT '',photo TEXT NOT NULL,review TEXT NOT NULL DEFAULT 'pending',status TEXT NOT NULL DEFAULT 'registered',qr TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS placements(bike_id TEXT PRIMARY KEY REFERENCES bikes(id),spot_id TEXT UNIQUE NOT NULL REFERENCES spots(id));
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),bike_id TEXT NOT NULL REFERENCES bikes(id),kind TEXT NOT NULL,spot_id TEXT REFERENCES spots(id),source_spot TEXT,recipient TEXT REFERENCES users(id),comment TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'pending',decision TEXT NOT NULL DEFAULT '',decided_by TEXT REFERENCES users(id),created REAL NOT NULL,decided REAL,snapshot_json TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON requests(bike_id) WHERE state='pending';
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,details TEXT NOT NULL,created REAL NOT NULL);
"""
@contextmanager
def db(write=False):
    c=sqlite3.connect(DB,timeout=15)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    try:
        if write:c.execute("BEGIN IMMEDIATE")
        yield c
        c.commit()
    except: c.rollback(); raise
    finally:c.close()
def init_db():
    with db() as c:
        c.executescript(SCHEMA)
        c.execute("BEGIN IMMEDIATE")
        if "departure_date" not in {row["name"] for row in c.execute("PRAGMA table_info(users)")}:
            c.execute("ALTER TABLE users ADD COLUMN departure_date TEXT")
        if "snapshot_json" not in {row["name"] for row in c.execute("PRAGMA table_info(requests)")}:
            c.execute("ALTER TABLE requests ADD COLUMN snapshot_json TEXT")
def fail(code,message):raise HTTPException(code,message)
def uid():return secrets.token_urlsafe(18)
def event(c,user,action,entity,details=""):c.execute("INSERT INTO events(actor,action,entity,details,created) VALUES(?,?,?,?,?)",(user["id"],action,entity,details,time.time()))
def username(s):
    s=s.strip().lstrip("@").lower()
    if not re.fullmatch(r"[a-z0-9_]{3,32}",s):fail(422,"Логин: 3–32 латинские буквы, цифры или подчёркивания")
    return s
def password_hash(password):
    salt=secrets.token_bytes(16)
    return salt.hex()+":"+hashlib.scrypt(password.encode(),salt=salt,n=16384,r=8,p=1).hex()
def password_ok(password,stored):
    try:
        salt,value=stored.split(":")
        return hmac.compare_digest(value,hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex())
    except (ValueError,TypeError):return False
def session(request:Request):
    token=hashlib.sha256(request.cookies.get("velo_session","").encode()).hexdigest()
    with db() as c:
        row=c.execute("SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",(token,time.time())).fetchone()
    if not row:fail(401,"Войдите в аккаунт")
    user=dict(row)
    if request.method not in ("GET","HEAD") and not hmac.compare_digest(request.headers.get("X-CSRFToken",""),user["csrf"]):fail(403,"Обновите страницу: неверный CSRF-токен")
    return user
def admin(user=Depends(session)):
    if user["role"]!="admin":fail(403,"Доступно только администратору")
    return user
def public_user(u):return {k:u[k] for k in ("id","username","name","phone","role","room")}
def login_response(user,request):
    token,csrf=uid()+uid(),uid()
    with db(True) as c:
        current=c.execute("SELECT password FROM users WHERE id=?",(user["id"],)).fetchone()
        if not current or not hmac.compare_digest(current["password"],user["password"]):fail(401,"Пароль изменён. Войдите снова")
        c.execute("DELETE FROM sessions WHERE expires<?",(time.time(),))
        c.execute("INSERT INTO sessions VALUES(?,?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),user["id"],csrf,time.time()+86400*14))
    response=JSONResponse({**public_user(user),"csrf":csrf})
    response.set_cookie("velo_session",token,max_age=86400*14,httponly=True,secure=request.url.scheme=="https",samesite="lax",path="/")
    return response
@asynccontextmanager
async def lifespan(app):init_db();yield
class BoundedBodyMiddleware:
    def __init__(self,app):self.app=app
    async def __call__(self,scope,receive,send):
        if scope["type"]!="http" or scope["method"] not in ("POST","PATCH","PUT"):
            return await self.app(scope,receive,send)
        request=Request(scope)
        upload=scope["method"]=="POST" and scope["path"] in ("/api/bikes","/api/qr/scan")
        if upload:
            try:session(request)
            except HTTPException as exc:
                return await JSONResponse({"detail":exc.detail},status_code=exc.status_code)(scope,receive,send)
        limit=12*1024*1024 if upload else 256*1024
        length=request.headers.get("content-length")
        if length is not None:
            try:
                if int(length)<0:raise ValueError
                too_large=int(length)>limit
            except ValueError:
                return await JSONResponse({"detail":"Некорректная длина запроса"},status_code=400)(scope,receive,send)
            if too_large:return await JSONResponse({"detail":"Тело запроса слишком большое"},status_code=413)(scope,receive,send)
        body=bytearray()
        while True:
            message=await receive()
            if message["type"]=="http.disconnect":return
            chunk=message.get("body",b"")
            if len(body)+len(chunk)>limit:
                return await JSONResponse({"detail":"Тело запроса слишком большое"},status_code=413)(scope,receive,send)
            body.extend(chunk)
            if not message.get("more_body",False):break
        payload=bytes(body)
        del body
        delivered=False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered=True
                return {"type":"http.request","body":payload,"more_body":False}
            return await receive()
        await self.app(scope,replay,send)
app=FastAPI(title="Велореестр",lifespan=lifespan)
app.add_middleware(BoundedBodyMiddleware)
@app.middleware("http")
async def headers(request,call_next):
    origin=request.headers.get("origin")
    if request.method not in ("GET","HEAD") and (request.headers.get("sec-fetch-site")=="cross-site" or origin and origin!=str(request.base_url).rstrip("/")):
        return Response("Cross-origin request denied",status_code=403)
    response=await call_next(request)
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["Cache-Control"]="no-store"
    response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    return response
app.mount("/static",StaticFiles(directory=ROOT/"frontend/static"),name="static")
def shell():
    text=(ROOT/"frontend/index.html").read_text(encoding="utf-8")
    text=re.sub(r'<script\b[^>]*>[\s\S]*?</script>',"",text)
    text=text.replace("static/veloregistry/","/static/veloregistry/")
    if "campus.css" not in text:text=text.replace("</head>",'<link rel="stylesheet" href="/static/veloregistry/campus.css"></head>')
    return text.replace("</body>",'<script src="/static/veloregistry/live.js" defer></script></body>')
@app.get("/",response_class=HTMLResponse)
def index():return shell()
@app.get("/q/{kind}/{token}",response_class=HTMLResponse)
def qr_entry(kind:str,token:str):return shell()
class Strict(BaseModel):model_config=ConfigDict(extra="forbid")
class Account(Strict):
    username:str=Field(min_length=3,max_length=33)
    password:str=Field(min_length=8,max_length=128)
    name:str=Field(min_length=1,max_length=160)
class Login(Strict):
    username:str=Field(max_length=33)
    password:str=Field(max_length=128)
class Profile(Strict):
    name:str=Field(min_length=1,max_length=160)
    phone:str=Field(default="",max_length=30)
class Password(Strict):
    current:str=Field(max_length=128)
    password:str=Field(min_length=8,max_length=128)
attempts={}
@app.post("/api/auth/register",status_code=201)
def register(data:Account,request:Request):
    name=data.name.strip()
    if not name:fail(422,"Укажите имя")
    try:
        with db(True) as c:
            row={"id":uid(),"username":username(data.username),"name":name,"phone":"","password":password_hash(data.password),"role":"resident","room":""}
            c.execute("INSERT INTO users(id,username,name,phone,password,role,room) VALUES(:id,:username,:name,:phone,:password,:role,:room)",row)
    except sqlite3.IntegrityError:fail(409,"Этот логин уже занят")
    return login_response(row,request)
@app.post("/api/auth/login")
def login(data:Login,request:Request):
    key=(request.client.host,username(data.username));now=time.time()
    attempts[key]=[t for t in attempts.get(key,[]) if t>now-900]
    if len(attempts[key])>=10:fail(429,"Слишком много попыток. Повторите через 15 минут")
    with db() as c:row=c.execute("SELECT * FROM users WHERE username=?",(key[1],)).fetchone()
    if not row or not password_ok(data.password,row["password"]):
        attempts[key].append(now);fail(401,"Неверный логин или пароль")
    attempts.pop(key,None)
    return login_response(dict(row),request)
@app.get("/api/me")
def me(user=Depends(session)):return {**public_user(user),"csrf":user["csrf"]}
@app.get("/api/me/reminders")
def reminders(user=Depends(session)):
    if not user["departure_date"]:return []
    with db() as c:
        count=c.execute("SELECT COUNT(*) FROM bikes WHERE owner_id=? AND status='registered' AND review IN ('pending','approved')",(user["id"],)).fetchone()[0]
    if not count:return []
    return [{"message":"Не забудьте забрать велосипед и оформить снятие с учёта к дате выезда: "+date.fromisoformat(user["departure_date"]).strftime("%d.%m.%Y")+".","departure_date":user["departure_date"],"bike_count":count}]
class Departure(Strict):
    departure_date:str|None=Field(max_length=10)
    @field_validator("departure_date")
    @classmethod
    def valid_date(cls,value):
        if value is not None:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",value):raise ValueError("Дата выезда должна быть в формате YYYY-MM-DD")
            date.fromisoformat(value)
        return value
@app.get("/api/admin/users")
def admin_users(user=Depends(admin)):
    with db() as c:
        return [dict(row) for row in c.execute("SELECT id,username,name,phone,room,role,departure_date FROM users ORDER BY name,username")]
@app.patch("/api/admin/users/{id}/departure")
def departure(id:str,data:Departure,user=Depends(admin)):
    with db(True) as c:
        if not c.execute("UPDATE users SET departure_date=? WHERE id=?",(data.departure_date,id)).rowcount:fail(404,"Жилец не найден")
        event(c,user,"departure-date",id,data.departure_date or "cleared")
    return {"ok":True}
@app.patch("/api/me")
def profile(data:Profile,user=Depends(session)):
    if not data.name.strip():fail(422,"Укажите имя")
    with db(True) as c:c.execute("UPDATE users SET name=?,phone=? WHERE id=?",(data.name.strip(),data.phone.strip(),user["id"]))
    return {"ok":True}
@app.post("/api/me/password")
def change_password(data:Password,user=Depends(session)):
    if not password_ok(data.current,user["password"]):fail(403,"Неверный текущий пароль")
    with db(True) as c:
        c.execute("UPDATE users SET password=? WHERE id=?",(password_hash(data.password),user["id"]))
        c.execute("DELETE FROM sessions WHERE user_id=?",(user["id"],))
    return {"ok":True}
@app.post("/api/auth/logout")
def logout(request:Request,user=Depends(session)):
    with db(True) as c:c.execute("DELETE FROM sessions WHERE token=?",(hashlib.sha256(request.cookies["velo_session"].encode()).hexdigest(),))
    response=Response(status_code=204);response.delete_cookie("velo_session");return response
def bike(c,id,user):
    row=c.execute("SELECT b.*,p.spot_id FROM bikes b LEFT JOIN placements p ON p.bike_id=b.id WHERE b.id=?",(id,)).fetchone()
    if not row or user["role"]!="admin" and row["owner_id"]!=user["id"]:fail(404,"Велосипед не найден")
    return dict(row)
def bike_json(c,b,user):
    result={k:b[k] for k in ("id","number","owner_id","model","color","marks","review","status")}
    result["photo_url"]="/api/bikes/"+b["id"]+"/photo"
    spot=c.execute("SELECT s.*,p.name parking_name FROM placements a JOIN spots s ON s.id=a.spot_id JOIN parkings p ON p.id=s.parking_id WHERE a.bike_id=?",(b["id"],)).fetchone()
    result["place"]=dict(spot) if spot else None
    owner=c.execute("SELECT * FROM users WHERE id=?",(b["owner_id"],)).fetchone()
    result["owner"]=public_user(owner) if owner else None
    return result
@app.get("/api/bikes")
def bikes(q:str="",user=Depends(session)):
    with db() as c:
        rows=c.execute("SELECT * FROM bikes WHERE (?='admin' OR owner_id=?) AND (model LIKE ? OR color LIKE ? OR number LIKE ?) ORDER BY rowid DESC",(user["role"],user["id"],*["%"+q[:120]+"%"]*3)).fetchall()
        return [bike_json(c,dict(b),user) for b in rows]
@app.get("/api/bikes/{id}")
def get_bike(id:str,user=Depends(session)):
    with db() as c:return bike_json(c,bike(c,id,user),user)
@app.get("/api/bikes/{id}/photo")
def get_photo(id:str,user=Depends(session)):
    with db() as c:b=bike(c,id,user)
    return FileResponse(DATA/"photos"/b["photo"],media_type="image/jpeg")
async def image_bytes(photo,limit):
    raw=await photo.read(limit+1)
    if len(raw)>limit:fail(413,"Фотография слишком большая")
    try:
        Image.MAX_IMAGE_PIXELS=20_000_000
        im=Image.open(io.BytesIO(raw))
        if im.format not in ("JPEG","PNG","WEBP") or im.width*im.height>20_000_000:fail(422,"Нужна фотография JPG, PNG или WebP")
        im.load();return ImageOps.exif_transpose(im).convert("RGB")
    except (UnidentifiedImageError,OSError,Image.DecompressionBombError):fail(422,"Некорректное изображение")
def free_spot(c,id):
    row=c.execute("SELECT s.id FROM spots s JOIN parkings p ON p.id=s.parking_id WHERE s.id=? AND s.active=1 AND p.active=1 AND NOT EXISTS(SELECT 1 FROM placements a WHERE a.spot_id=s.id)",(id,)).fetchone()
    if not row:fail(409,"Место уже занято или недоступно")
@app.post("/api/bikes",status_code=201)
async def create_bike(model:str=Form(max_length=120),color:str=Form(max_length=80),marks:str=Form(default="",max_length=500),spot_id:str=Form(),photo:UploadFile=File(),user=Depends(session)):
    if not model.strip() or not color.strip():fail(422,"Укажите модель и цвет")
    im=await image_bytes(photo,2*1024*1024);im.thumbnail((1800,1800))
    id=uid();filename=id+".jpg";(DATA/"photos").mkdir(exist_ok=True);im.save(DATA/"photos"/filename,"JPEG",quality=88)
    try:
        with db(True) as c:
            free_spot(c,spot_id)
            c.execute("INSERT INTO bikes VALUES(?,?,?,?,?,?,?,?,?,?)",(id,"В-"+secrets.token_hex(4).upper(),user["id"],model.strip(),color.strip(),marks,filename,"pending","registered",uid()+uid()))
            c.execute("INSERT INTO requests(id,user_id,bike_id,kind,spot_id,created) VALUES(?,?,?,?,?,?)",(uid(),user["id"],id,"register",spot_id,time.time()))
            event(c,user,"register",id)
    except: (DATA/"photos"/filename).unlink(missing_ok=True);raise
    return {"id":id}
class Description(Strict):
    model:str=Field(min_length=1,max_length=120)
    color:str=Field(min_length=1,max_length=80)
    marks:str=Field(default="",max_length=500)
@app.patch("/api/bikes/{id}")
def edit_bike(id:str,data:Description,user=Depends(session)):
    with db(True) as c:
        b=bike(c,id,user)
        if b["review"]=="pending":fail(409,"Регистрация ещё рассматривается")
        if user["role"]!="admin" and b["status"]!="registered":fail(409,"Редактирование неактивного велосипеда доступно администратору")
        c.execute("UPDATE bikes SET model=?,color=?,marks=? WHERE id=?",(data.model,data.color,data.marks,id));event(c,user,"edit",id)
    return {"ok":True}
@app.get("/api/parkings")
def parkings(user=Depends(session)):
    with db() as c:
        rows=c.execute("SELECT p.*,COUNT(s.id) total,COUNT(a.bike_id) occupied FROM parkings p LEFT JOIN spots s ON s.parking_id=p.id AND s.active=1 LEFT JOIN placements a ON a.spot_id=s.id WHERE p.active=1 GROUP BY p.id").fetchall()
        return [{**dict(r),"free":r["total"]-r["occupied"]} for r in rows]
@app.get("/api/parkings/{id}/spots")
def spots(id:str,user=Depends(session)):
    with db() as c:
        rows=c.execute("SELECT s.*,a.bike_id FROM spots s LEFT JOIN placements a ON a.spot_id=s.id WHERE s.parking_id=? AND s.active=1 ORDER BY s.code",(id,)).fetchall()
        output=[]
        for r in rows:
            if user["role"]!="admin" and r["bike_id"]:continue
            value=dict(r)
            if user["role"]=="admin" and r["bike_id"]:value["bike"]=bike_json(c,bike(c,r["bike_id"],user),user)
            output.append(value)
        return output
class Parking(Strict):
    name:str=Field(min_length=1,max_length=120)
    description:str=Field(default="",max_length=500)
    x:float=Field(ge=0,le=100)
    y:float=Field(ge=0,le=100)
    capacity:int=Field(ge=1,le=200)
@app.post("/api/admin/parkings",status_code=201)
def add_parking(data:Parking,user=Depends(admin)):
    id=uid()
    with db(True) as c:
        c.execute("INSERT INTO parkings(id,name,description,x,y) VALUES(?,?,?,?,?)",(id,data.name,data.description,data.x,data.y))
        for n in range(1,data.capacity+1):c.execute("INSERT INTO spots(id,parking_id,code) VALUES(?,?,?)",(uid(),id,f"{n:03}"))
        event(c,user,"create-parking",id)
    return {"id":id}
class RequestData(Strict):
    bike_id:str
    kind:str
    spot_id:str|None=None
    recipient:str|None=None
    comment:str=Field(default="",max_length=500)
@app.post("/api/requests",status_code=201)
def create_request(data:RequestData,user=Depends(session)):
    if data.kind not in ("place","move","release","donate","withdraw","transfer"):fail(422,"Неизвестный тип заявки")
    with db(True) as c:
        b=bike(c,data.bike_id,user)
        if b["owner_id"]!=user["id"] or b["review"]!="approved" or b["status"]!="registered":fail(409,"Заявка недоступна для этого велосипеда")
        if data.kind in ("place","move"):free_spot(c,data.spot_id)
        if data.kind=="place" and b["spot_id"] or data.kind in ("move","release") and not b["spot_id"]:fail(409,"Проверьте текущее закрепление")
        recipient=None
        if data.kind=="transfer":
            row=c.execute("SELECT id FROM users WHERE username=?",(username(data.recipient or ""),)).fetchone()
            if not row or row["id"]==user["id"]:fail(422,"Получатель не найден или совпадает с владельцем")
            recipient=row["id"]
        try:c.execute("INSERT INTO requests(id,user_id,bike_id,kind,spot_id,source_spot,recipient,comment,created) VALUES(?,?,?,?,?,?,?,?,?)",(uid(),user["id"],b["id"],data.kind,data.spot_id,b["spot_id"],recipient,data.comment,time.time()))
        except sqlite3.IntegrityError:fail(409,"Для велосипеда уже есть ожидающая заявка")
    return {"ok":True}
@app.get("/api/requests")
def requests(user=Depends(session)):
    with db() as c:
        return [dict(r) for r in c.execute("SELECT r.*,b.number,b.model,u.name,u.username,s.code,p.name parking_name FROM requests r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.user_id LEFT JOIN spots s ON s.id=r.spot_id LEFT JOIN parkings p ON p.id=s.parking_id WHERE (?='admin' OR r.user_id=?) ORDER BY r.created DESC",(user["role"],user["id"]))]
@app.post("/api/requests/{id}/cancel")
def cancel(id:str,user=Depends(session)):
    with db(True) as c:
        r=c.execute("SELECT * FROM requests WHERE id=? AND user_id=?",(id,user["id"])).fetchone()
        if not r:fail(404,"Заявка не найдена")
        if r["state"]!="pending":fail(409,"Заявка уже рассмотрена")
        c.execute("UPDATE requests SET state='cancelled',decided=? WHERE id=?",(time.time(),id))
        if r["kind"]=="register":c.execute("UPDATE bikes SET review='rejected' WHERE id=?",(r["bike_id"],))
        event(c,user,"cancel-request",id)
    return {"ok":True}
class Decision(Strict):
    state:str
    comment:str=Field(default="",max_length=500)
@app.post("/api/admin/requests/{id}/decision")
def decide(id:str,data:Decision,user=Depends(admin)):
    if data.state not in ("approved","rejected") or data.state=="rejected" and not data.comment.strip():fail(422,"Выберите решение; для отказа укажите причину")
    with db(True) as c:
        r=c.execute("SELECT * FROM requests WHERE id=?",(id,)).fetchone()
        if not r:fail(404,"Заявка не найдена")
        if r["state"]!="pending":fail(409,"Заявка уже рассмотрена")
        b=bike(c,r["bike_id"],user)
        if b["owner_id"]!=r["user_id"]:fail(409,"Владелец велосипеда изменился")
        if data.state=="approved":
            expected_review="pending" if r["kind"]=="register" else "approved"
            if b["review"]!=expected_review or b["status"]!="registered":fail(409,"Велосипед недоступен для одобрения заявки")
            if r["kind"] in ("register","place","move"):
                if b["spot_id"]!=r["source_spot"]:fail(409,"Закрепление уже изменилось")
                free_spot(c,r["spot_id"])
                c.execute("DELETE FROM placements WHERE bike_id=?",(b["id"],))
                c.execute("INSERT INTO placements VALUES(?,?)",(b["id"],r["spot_id"]))
                if r["kind"]=="register":c.execute("UPDATE bikes SET review='approved' WHERE id=?",(b["id"],))
            elif r["kind"]=="release":
                if b["spot_id"]!=r["source_spot"]:fail(409,"Закрепление уже изменилось")
                c.execute("DELETE FROM placements WHERE bike_id=?",(b["id"],))
            elif r["kind"] in ("donate","withdraw"):
                c.execute("DELETE FROM placements WHERE bike_id=?",(b["id"],))
                c.execute("UPDATE bikes SET status=?,owner_id=? WHERE id=?",("donated" if r["kind"]=="donate" else "withdrawn",None if r["kind"]=="donate" else b["owner_id"],b["id"]))
            elif r["kind"]=="transfer":c.execute("UPDATE bikes SET owner_id=? WHERE id=?",(r["recipient"],b["id"]))
        elif r["kind"]=="register":c.execute("UPDATE bikes SET review='rejected' WHERE id=?",(b["id"],))
        c.execute("UPDATE requests SET state=?,decision=?,decided_by=?,decided=? WHERE id=?",(data.state,data.comment,user["id"],time.time(),id));event(c,user,"decision",id,data.state)
        if data.state=="approved":
            snapshot=json.dumps(request_fields(request_document(c,id,user)),ensure_ascii=False)
            c.execute("UPDATE requests SET snapshot_json=? WHERE id=?",(snapshot,id))
    return {"ok":True}
class Status(Strict):status:str
class Placement(Strict):spot_id:str|None=None
class Owner(Strict):username:str=Field(max_length=33)
def reject_pending(c,id,user,reason):
    for row in c.execute("SELECT id FROM requests WHERE bike_id=? AND state='pending'",(id,)).fetchall():
        c.execute("UPDATE requests SET state='rejected',decision=?,decided_by=?,decided=? WHERE id=?",(reason,user["id"],time.time(),row["id"]))
        event(c,user,"decision",row["id"],"rejected")
@app.patch("/api/admin/bikes/{id}/owner")
def assign_owner(id:str,data:Owner,user=Depends(admin)):
    with db(True) as c:
        b=bike(c,id,user)
        if b["review"]!="approved" or b["status"] not in ("registered","donated"):fail(409,"Велосипед недоступен для передачи владельцу")
        recipient=c.execute("SELECT id FROM users WHERE username=?",(username(data.username),)).fetchone()
        if not recipient:fail(422,"Получатель не найден")
        if recipient["id"]==b["owner_id"] and b["status"]=="registered":return {"ok":True}
        reject_pending(c,id,user,"Заявка закрыта: администратор изменил владельца велосипеда")
        c.execute("UPDATE bikes SET owner_id=?,status='registered' WHERE id=?",(recipient["id"],id))
        event(c,user,"owner",id,json.dumps({"old_owner_id":b["owner_id"],"new_owner_id":recipient["id"]},ensure_ascii=False))
    return {"ok":True}
@app.post("/api/admin/bikes/{id}/placement")
def assign_place(id:str,data:Placement,user=Depends(admin)):
    with db(True) as c:
        b=bike(c,id,user)
        if b["review"]!="approved" or b["status"]!="registered":fail(409,"Велосипед недоступен для закрепления")
        if data.spot_id:
            if b["spot_id"]==data.spot_id:return {"ok":True}
            free_spot(c,data.spot_id)
        c.execute("DELETE FROM placements WHERE bike_id=?",(id,))
        if data.spot_id:c.execute("INSERT INTO placements VALUES(?,?)",(id,data.spot_id))
        event(c,user,"placement",id,data.spot_id or "released")
    return {"ok":True}
@app.patch("/api/admin/bikes/{id}/status")
def status(id:str,data:Status,user=Depends(admin)):
    if data.status not in ("registered","donated","withdrawn","scrapped"):fail(422,"Неизвестный статус")
    with db(True) as c:
        b=bike(c,id,user)
        if b["review"]!="approved":fail(409,"Сначала подтвердите регистрацию")
        if data.status=="registered" and not b["owner_id"]:fail(409,"Сначала назначьте владельца велосипеда")
        if data.status=="scrapped" and b["status"]=="scrapped":return {"ok":True}
        if data.status!="registered":
            c.execute("DELETE FROM placements WHERE bike_id=?",(id,))
            reject_pending(c,id,user,"Заявка закрыта: администратор изменил статус велосипеда")
        c.execute("UPDATE bikes SET status=?,owner_id=? WHERE id=?",(data.status,None if data.status=="donated" else b["owner_id"],id));event(c,user,"status",id,data.status)
        if data.status=="scrapped":
            recorded=c.execute("SELECT id,created FROM events WHERE id=last_insert_rowid()").fetchone()
            owner=c.execute("SELECT id,name,username FROM users WHERE id=?",(b["owner_id"],)).fetchone()
            snapshot={"status_event_id":recorded["id"],"created":recorded["created"],"actor":{key:user[key] for key in ("id","name","username")},"bike":{key:b[key] for key in ("number","model","color","marks")},"owner":dict(owner) if owner else None}
            event(c,user,"scrap-snapshot",id,json.dumps(snapshot,ensure_ascii=False))
    return {"ok":True}
@app.get("/api/admin/events")
def events(user=Depends(admin)):
    with db() as c:return [dict(r) for r in c.execute("SELECT * FROM events ORDER BY id DESC LIMIT 300")]
@app.get("/api/qr/{kind}/{id}.png")
def qr_image(kind:str,id:str,request:Request,user=Depends(session)):
    with db() as c:
        if kind=="bike":
            b=bike(c,id,user)
            if b["review"]!="approved":fail(409,"QR доступен после подтверждения")
            token=b["qr"];path="b"
        elif kind=="parking":
            if not c.execute("SELECT id FROM parkings WHERE id=?",(id,)).fetchone():fail(404,"Парковка не найдена")
            token=id;path="p"
        else:fail(404,"Не найдено")
    public=os.environ.get("VELO_PUBLIC_URL",str(request.base_url).rstrip("/")).rstrip("/")
    output=io.BytesIO();qrcode.make(public+"/q/"+path+"/"+token).save(output,format="PNG")
    return Response(output.getvalue(),media_type="image/png")
class Resolve(Strict):url:str=Field(max_length=2000)
def resolve(url,request,user):
    try:parsed=urlsplit(url)
    except ValueError:fail(422,"Некорректная ссылка QR")
    public=urlsplit(os.environ.get("VELO_PUBLIC_URL",str(request.base_url).rstrip("/")))
    if parsed.scheme!=public.scheme or parsed.netloc!=public.netloc or parsed.query or parsed.fragment:fail(422,"Это QR другого сайта")
    m=re.fullmatch(r"/q/([bp])/([A-Za-z0-9_-]{8,160})/?",parsed.path)
    if not m:fail(422,"Неизвестный формат QR")
    kind,token=m.groups()
    with db() as c:
        if kind=="p":
            if not c.execute("SELECT id FROM parkings WHERE id=?",(token,)).fetchone():fail(404,"Парковка не найдена")
            return {"kind":"parking","parking_id":token}
        row=c.execute("SELECT * FROM bikes WHERE qr=? AND review='approved'",(token,)).fetchone()
        if not row:fail(404,"Велосипед не найден")
        if user["role"]=="admin":return {"kind":"bike","bike":bike_json(c,bike(c,row["id"],user),user)}
        owner=c.execute("SELECT name,username,phone FROM users WHERE id=?",(row["owner_id"],)).fetchone()
        return {"kind":"bike","bike":{"number":row["number"],"owner":dict(owner) if owner else None}}
@app.post("/api/qr/resolve")
def resolve_url(data:Resolve,request:Request,user=Depends(session)):return resolve(data.url,request,user)
@app.post("/api/qr/scan")
async def scan(request:Request,photo:UploadFile=File(),user=Depends(session)):
    import zxingcpp
    im=await image_bytes(photo,10*1024*1024);im.thumbnail((2200,2200))
    result=zxingcpp.read_barcode(im,formats=zxingcpp.BarcodeFormat.QRCode)
    if not result:fail(422,"QR не найден. Сфотографируйте код крупнее")
    return resolve(result.text,request,user)
REQUEST_TITLES={"register":"регистрации велосипеда","place":"закреплении парковочного места","move":"смене парковочного места","release":"освобождении парковочного места","donate":"передаче велосипеда в дар","withdraw":"снятии велосипеда с учёта","transfer":"передаче велосипеда другому владельцу"}
REQUEST_TEXT={"register":"Прошу зарегистрировать мой велосипед и закрепить указанное парковочное место.","place":"Прошу закрепить за моим велосипедом указанное парковочное место.","move":"Прошу изменить закреплённое за моим велосипедом парковочное место.","release":"Прошу освободить закреплённое за моим велосипедом парковочное место.","donate":"Прошу оформить передачу моего велосипеда в дар.","withdraw":"Прошу снять мой велосипед с учёта.","transfer":"Прошу оформить передачу моего велосипеда указанному получателю."}
REQUEST_STATES={"pending":"Ожидает рассмотрения","approved":"Одобрена","rejected":"Отклонена","cancelled":"Отменена заявителем"}
BIKE_STATUSES={"registered":"На учёте","donated":"Передан в дар","withdrawn":"Снят с учёта","scrapped":"Списан на разбор"}
def document_time(value):
    return datetime.fromtimestamp(value,timezone.utc).strftime("%d.%m.%Y %H:%M:%S UTC") if value is not None else "Не зафиксировано"
def document_html(title,fields,paragraphs=()):
    escape=lambda value:html.escape(str(value),quote=True)
    return ("<!doctype html><html lang='ru'><head><meta charset='utf-8'><title>"+escape(title)+"</title></head><body><main><h1>"+escape(title)+"</h1><dl>"+
            "".join("<dt>"+escape(label)+"</dt><dd>"+escape(value if value not in (None,"") else "Не указано")+"</dd>" for label,value in fields)+"</dl>"+
            "".join("<p>"+escape(text)+"</p>" for text in paragraphs)+"<p>Подпись заявителя / владельца: __________________</p><p>Подпись представителя администрации: __________________</p><p>Дата подписания: __________________</p><p>Поля подписей не заполнены. Документ сформирован по данным реестра; электронные подписи не зарегистрированы.</p></main></body></html>")
def request_document(c,id,user):
    r=c.execute("SELECT r.*,b.number,b.model,b.color,b.marks,u.name,u.username,u.room,u.phone,v.name recipient_name,v.username recipient_username,a.name administrator,a.username administrator_username,s.code,p.name parking_name,ss.code source_code,sp.name source_parking FROM requests r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.user_id LEFT JOIN users v ON v.id=r.recipient LEFT JOIN users a ON a.id=r.decided_by LEFT JOIN spots s ON s.id=r.spot_id LEFT JOIN parkings p ON p.id=s.parking_id LEFT JOIN spots ss ON ss.id=r.source_spot LEFT JOIN parkings sp ON sp.id=ss.parking_id WHERE r.id=?",(id,)).fetchone()
    if not r or user["role"]!="admin" and r["user_id"]!=user["id"]:fail(404,"Заявка не найдена")
    return r
def request_fields(r):
    fields=[("Номер заявки",r["id"]),("Дата подачи",document_time(r["created"])),("Вид обращения",REQUEST_TITLES.get(r["kind"],"Неизвестный вид обращения")),("Заявитель",r["name"]),("Логин заявителя",r["username"]),("Комната",r["room"]),("Телефон",r["phone"]),("Учётный номер велосипеда",r["number"]),("Модель",r["model"]),("Цвет",r["color"]),("Особые приметы",r["marks"])]
    if r["source_spot"]:fields.append(("Исходное парковочное место",(r["source_parking"] or "")+" / "+(r["source_code"] or r["source_spot"])))
    if r["spot_id"]:fields.append(("Запрашиваемое парковочное место",(r["parking_name"] or "")+" / "+(r["code"] or r["spot_id"])))
    if r["recipient"]:fields.extend([("Получатель",r["recipient_name"]),("Логин получателя",r["recipient_username"])])
    fields.extend([("Комментарий заявителя",r["comment"]),("Состояние заявки",REQUEST_STATES.get(r["state"],"Неизвестное состояние")),("Решение администрации",r["decision"])])
    if r["decided"] is not None:fields.append(("Дата рассмотрения / отмены",document_time(r["decided"])))
    if r["decided_by"]:fields.extend([("Рассмотрел",r["administrator"]),("Логин администратора",r["administrator_username"])])
    return fields
@app.get("/api/requests/{id}/statement",response_class=HTMLResponse)
def statement(id:str,user=Depends(session)):
    with db() as c:
        r=request_document(c,id,user)
        return document_html("Заявление "+("об " if r["kind"]=="release" else "о ")+REQUEST_TITLES.get(r["kind"],"велосипеде"),request_fields(r),[REQUEST_TEXT.get(r["kind"],"Прошу рассмотреть обращение по указанному велосипеду.")])
@app.get("/api/requests/{id}/act",response_class=HTMLResponse)
def act(id:str,user=Depends(session)):
    with db() as c:
        r=request_document(c,id,user)
        if r["state"]!="approved":fail(409,"Акт доступен после одобрения")
        if r["snapshot_json"]:
            fields=json.loads(r["snapshot_json"])
            note="Сведения зафиксированы в момент одобрения заявки."
        else:
            fields=request_fields(r)
            note="Исторический снимок для этой заявки отсутствует. Сведения о заявителе и велосипеде приведены по текущим данным реестра."
        return document_html("Акт "+("об " if r["kind"]=="release" else "о ")+REQUEST_TITLES.get(r["kind"],"велосипеде"),fields,["Основание: одобренная заявка. "+note])
@app.get("/api/admin/bikes/{id}/act",response_class=HTMLResponse)
def scrap_act(id:str,user=Depends(admin)):
    with db() as c:
        b=bike(c,id,user)
        if b["status"]!="scrapped":fail(409,"Акт доступен для велосипеда, списанного на разбор")
        history=c.execute("SELECT e.*,u.name,u.username FROM events e LEFT JOIN users u ON u.id=e.actor WHERE e.entity=? AND e.action='status' ORDER BY e.id",(id,)).fetchall()
        stored=c.execute("SELECT details FROM events WHERE entity=? AND action='scrap-snapshot' ORDER BY id DESC LIMIT 1",(id,)).fetchone()
        snapshot=json.loads(stored["details"]) if stored else None
        if snapshot and (not history or snapshot["status_event_id"]!=history[-1]["id"]):snapshot=None
        if snapshot:
            b=snapshot["bike"];owner=snapshot["owner"]
        else:
            owner=c.execute("SELECT name,username FROM users WHERE id=?",(b["owner_id"],)).fetchone()
        fields=[("Учётный номер велосипеда",b["number"]),("Модель",b["model"]),("Цвет",b["color"]),("Особые приметы",b["marks"]),("Статус",BIKE_STATUSES["scrapped"])]
        if owner:fields.extend([("Владелец в реестре",owner["name"]),("Логин владельца",owner["username"])])
        for row in history:
            actor=snapshot["actor"] if snapshot and row["id"]==snapshot["status_event_id"] else {"id":row["actor"],"name":row["name"],"username":row["username"]}
            created=snapshot["created"] if snapshot and row["id"]==snapshot["status_event_id"] else row["created"]
            fields.append(("Изменение статуса: "+document_time(created),BIKE_STATUSES.get(row["details"],"Неизвестный статус")+"; выполнил: "+(actor["name"] or actor["id"])+(" (@"+actor["username"]+")" if actor["username"] else "")))
        notes=["Основание: статус «Списан на разбор» в реестре. История изменений приведена из журнала событий."]
        notes.append("Описание велосипеда, владелец, дата и исполнитель зафиксированы в момент списания." if snapshot else "Исторический снимок списания отсутствует. Описание велосипеда и владелец указаны по текущим данным реестра.")
        if not any(row["details"]=="scrapped" for row in history):notes.append("В журнале нет события списания: дата и исполнитель списания не зафиксированы.")
        return document_html("Акт списания велосипеда на разбор",fields,notes)
init_db()
