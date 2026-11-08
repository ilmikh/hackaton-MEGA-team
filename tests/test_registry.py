import os,tempfile,unittest,io,json
from unittest.mock import patch, AsyncMock
from pathlib import Path
os.environ["VELO_DATA_DIR"]=tempfile.mkdtemp(prefix="velo-import-test-")
from fastapi.testclient import TestClient
from PIL import Image
from backend import main as m

class RegistryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  m.DATA=Path(self.tmp.name);m.DB=m.DATA/"test.sqlite3";m.init_db()
  self.a=self.account("alice","Алина")
  self.b=self.account("bobbb","Иван")
  self.ad=self.account("admin","Совет")
  with m.db(True) as c:c.execute("UPDATE users SET role='admin' WHERE username='admin'")
  p=self.ad.post("/api/admin/parkings",json={"name":"Павильон","capacity":2,"x":50,"y":50}).json()
  self.parking=p["id"];self.spots=self.ad.get("/api/parkings/"+self.parking+"/spots").json()
  out=io.BytesIO();Image.new("RGB",(60,60),"blue").save(out,"PNG");self.photo=out.getvalue()
 def tearDown(self):
  for client in (self.a,self.b,self.ad):client.close()
  self.tmp.cleanup()
 def account(self,login,name):
  c=TestClient(m.app)
  r=c.post("/api/auth/register",json={"username":login,"name":name,"password":"test-only-password-123"})
  self.assertEqual(r.status_code,200,r.text)
  c.headers["X-CSRFToken"]=r.json()["csrf"]
  return c
 def register(self,client,spot=None):
  r=client.post("/api/bikes",data={"model":"Stels","color":"Сине-белый","spot_id":spot or self.spots[0]["id"]},files={"photo":("bike.png",self.photo,"image/png")})
  self.assertEqual(r.status_code,201,r.text)
  return r.json()["id"]
 def request_for(self,bike):
  return next(r for r in self.ad.get("/api/requests").json() if r["bike_id"]==bike and r["state"]=="pending")
 def approve(self,bike):
  return self.ad.post("/api/admin/requests/"+self.request_for(bike)["id"]+"/decision",json={"state":"approved","comment":""})
 def test_real_registration_photo_and_privacy(self):
  id=self.register(self.a)
  self.assertEqual(self.b.get("/api/bikes/"+id).status_code,404)
  self.assertEqual(self.b.get("/api/bikes/"+id+"/photo").status_code,404)
  self.assertEqual(self.b.get("/api/bikes").json(),[])
  self.assertEqual(self.a.get("/api/qr/bike/"+id+".png").status_code,409)
  self.assertEqual(self.approve(id).status_code,200)
  self.assertEqual(self.a.get("/api/bikes/"+id).json()["place"]["id"],self.spots[0]["id"])
  self.assertEqual(len(self.b.get("/api/parkings/"+self.parking+"/spots").json()),1)
  self.assertEqual(self.a.get("/api/bikes/"+id+"/photo").headers["content-type"],"image/jpeg")
 def test_conflicting_approval_is_atomic(self):
  one=self.register(self.a);two=self.register(self.b)
  first_request=self.request_for(one)["id"]
  self.assertEqual(self.approve(one).status_code,200)
  self.assertEqual(self.approve(two).status_code,409)
  self.assertIsNone(self.b.get("/api/bikes/"+two).json()["place"])
  self.assertEqual(self.b.get("/api/bikes/"+two).json()["review"],"pending")
  self.assertEqual(self.ad.post('/api/admin/requests/'+first_request+'/decision',json={'state':'approved'}).status_code,409)
 def test_csrf_permissions_and_password(self):
  self.assertEqual(self.a.post("/api/admin/parkings",json={"name":"X","capacity":1,"x":0,"y":0}).status_code,403)
  self.assertEqual(self.a.patch("/api/me",json={"name":"X","role":"admin"}).status_code,422)
  self.assertEqual(self.a.patch("/api/me",json={"name":"X"},headers={"X-CSRFToken":"bad"}).status_code,403)
  self.assertEqual(self.a.post("/api/requests",json={}).status_code,422)
  self.assertEqual(self.a.post("/api/me/password",json={"current":"wrong","password":"new-password-123"}).status_code,403)
  self.assertEqual(self.a.post("/api/me/password",json={"current":"test-only-password-123","password":"new-password-123"}).status_code,200)
  self.assertEqual(self.a.get("/api/me").status_code,401)
  self.assertEqual(self.a.post("/api/auth/login",json={"username":"alice","password":"new-password-123"}).status_code,200)
 def test_server_qr_roundtrip_and_limited_response(self):
  id=self.register(self.a);self.approve(id)
  qr=self.a.get("/api/qr/bike/"+id+".png")
  self.assertEqual(qr.status_code,200)
  scan=self.b.post("/api/qr/scan",files={"photo":("qr.png",qr.content,"image/png")})
  self.assertEqual(scan.status_code,200,scan.text)
  value=scan.json()["bike"]
  self.assertEqual(set(value),{"number","owner"})
  self.assertNotIn("id",value["owner"]);self.assertNotIn("room",value["owner"])
  full=self.ad.post("/api/qr/scan",files={"photo":("qr.png",qr.content,"image/png")})
  self.assertEqual(full.json()["bike"]["id"],id)
  self.assertEqual(self.a.post("/api/qr/resolve",json={"url":"https://example.org/q/b/abcdefghi"}).status_code,422)
  self.assertEqual(self.a.post("/api/qr/scan",files={"photo":("bad.png",b"no image","image/png")}).status_code,422)
 def test_move_release_cancel_and_audit(self):
  id=self.register(self.a);self.approve(id)
  r=self.a.post("/api/requests",json={"bike_id":id,"kind":"move","spot_id":self.spots[1]["id"]})
  self.assertEqual(r.status_code,201,r.text);self.assertEqual(self.approve(id).status_code,200)
  self.assertEqual(self.a.get("/api/bikes/"+id).json()["place"]["id"],self.spots[1]["id"])
  self.a.post("/api/requests",json={"bike_id":id,"kind":"release"})
  req=self.request_for(id)
  self.assertEqual(self.b.post("/api/requests/"+req["id"]+"/cancel").status_code,404)
  self.assertEqual(self.a.post("/api/requests/"+req["id"]+"/cancel").status_code,200)
  self.assertEqual(self.ad.post("/api/admin/requests/"+req["id"]+"/decision",json={"state":"approved"}).status_code,409)
  self.assertTrue(self.ad.get("/api/admin/events").json())
 def test_parallel_approvals_and_admin_placement(self):
  from concurrent.futures import ThreadPoolExecutor
  a=self.register(self.a);b=self.register(self.b)
  requests=[self.request_for(a)["id"],self.request_for(b)["id"]]
  with ThreadPoolExecutor(max_workers=2) as pool:
   responses=list(pool.map(lambda id:self.ad.post('/api/admin/requests/'+id+'/decision',json={'state':'approved'}).status_code,requests))
  self.assertEqual(sorted(responses),[200,409])
  winner=a if responses[0]==200 else b
  self.assertEqual(self.ad.post('/api/admin/bikes/'+winner+'/placement',json={'spot_id':self.spots[1]['id']}).status_code,200)
  self.assertEqual(self.ad.get('/api/bikes/'+winner).json()['place']['id'],self.spots[1]['id'])
 def test_transfer_donation_and_act(self):
  id=self.register(self.a);self.approve(id)
  self.assertEqual(self.a.post("/api/requests",json={"bike_id":id,"kind":"transfer","recipient":"bobbb"}).status_code,201)
  self.assertEqual(self.approve(id).status_code,200)
  self.assertEqual(self.a.get("/api/bikes/"+id).status_code,404)
  self.assertEqual(self.b.get("/api/bikes/"+id).status_code,200)
  self.b.post("/api/requests",json={"bike_id":id,"kind":"donate"})
  req=self.request_for(id);self.approve(id)
  self.assertEqual(self.b.get("/api/requests/"+req["id"]+"/act").status_code,200)
  self.assertEqual(self.a.get("/api/requests/"+req["id"]+"/act").status_code,404)
  self.assertEqual(self.ad.get("/api/bikes/"+id).json()["status"],"donated")
 def test_statements_all_kinds_permissions_and_escaping(self):
  self.a.patch('/api/me',json={'name':'<script>alert(1)</script>'})
  id=self.register(self.a)
  register_request=self.request_for(id)['id']
  with TestClient(m.app) as anonymous:
   self.assertEqual(anonymous.get('/api/requests/'+register_request+'/statement').status_code,401)
  self.assertEqual(self.b.get('/api/requests/'+register_request+'/statement').status_code,404)
  self.assertEqual(self.ad.get('/api/requests/'+register_request+'/statement').status_code,200)
  self.assertEqual(self.a.get('/api/requests/'+register_request+'/act').status_code,409)
  text=self.a.get('/api/requests/'+register_request+'/statement').text
  self.assertIn('Заявление о регистрации велосипеда',text)
  self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;',text)
  self.assertNotIn('<script>',text)
  self.assertEqual(self.approve(id).status_code,200)
  actions=[('release',{},'об освобождении'),('place',{'spot_id':self.spots[0]['id']},'о закреплении'),('move',{'spot_id':self.spots[1]['id']},'о смене'),('transfer',{'recipient':'bobbb'},'о передаче')]
  for kind,extra,title in actions:
   with self.subTest(kind=kind):
    response=self.a.post('/api/requests',json={'bike_id':id,'kind':kind,'comment':'<b>Комментарий</b>',**extra})
    self.assertEqual(response.status_code,201,response.text)
    rid=self.request_for(id)['id']
    document=self.a.get('/api/requests/'+rid+'/statement')
    self.assertEqual(document.status_code,200)
    self.assertIn('Заявление '+title,document.text)
    self.assertIn('&lt;b&gt;Комментарий&lt;/b&gt;',document.text)
    self.assertEqual(self.approve(id).status_code,200)
  for client,bike_id,kind,title in [(self.b,id,'donate','передаче велосипеда в дар'),(self.a,None,'withdraw','снятии велосипеда с учёта')]:
   if bike_id is None:
    bike_id=self.register(self.a);self.approve(bike_id)
   self.assertEqual(client.post('/api/requests',json={'bike_id':bike_id,'kind':kind}).status_code,201)
   rid=self.request_for(bike_id)['id']
   self.assertIn(title,client.get('/api/requests/'+rid+'/statement').text)
   self.assertEqual(self.approve(bike_id).status_code,200)
   act=client.get('/api/requests/'+rid+'/act')
   self.assertEqual(act.status_code,200)
   self.assertIn('Учётный номер велосипеда',act.text)
   self.assertIn('Поля подписей не заполнены',act.text)
   self.assertNotIn('<dt>kind</dt>',act.text)
 def test_approved_act_snapshot_and_legacy_fallback(self):
  id=self.register(self.a);rid=self.request_for(id)['id'];self.approve(id)
  url='/api/requests/'+rid+'/act';before=self.a.get(url).text
  self.assertIn('зафиксированы в момент одобрения',before)
  self.a.patch('/api/bikes/'+id,json={'model':'Новая модель','color':'Белый','marks':''})
  self.a.patch('/api/me',json={'name':'Новое имя'})
  self.assertEqual(self.a.get(url).text,before)
  with m.db(True) as c:c.execute('UPDATE requests SET snapshot_json=NULL WHERE id=?',(rid,))
  legacy=self.a.get(url).text
  self.assertIn('Исторический снимок для этой заявки отсутствует',legacy)
  self.assertIn('Новая модель',legacy)
 def test_departure_reminders_permissions_validation_and_privacy(self):
  me=self.a.get('/api/me').json();url='/api/admin/users/'+me['id']+'/departure'
  self.assertEqual(self.a.get('/api/admin/users').status_code,403)
  self.assertEqual(self.a.patch(url,json={'departure_date':'2028-02-29'}).status_code,403)
  self.assertEqual(self.ad.patch(url,json={'departure_date':'2028-02-29'},headers={'X-CSRFToken':'bad'}).status_code,403)
  for value in ('2027-02-29','2028-2-29','2028-02-29T00:00:00','',42):
   self.assertEqual(self.ad.patch(url,json={'departure_date':value}).status_code,422,str(value))
  self.assertEqual(self.ad.patch(url,json={}).status_code,422)
  self.assertEqual(self.ad.patch(url,json={'departure_date':None,'role':'admin'}).status_code,422)
  self.assertEqual(self.ad.patch('/api/admin/users/missing/departure',json={'departure_date':None}).status_code,404)
  self.assertEqual(self.ad.patch(url,json={'departure_date':'2028-02-29'}).status_code,200)
  users=self.ad.get('/api/admin/users').json()
  self.assertEqual(set(users[0]),{'id','username','name','phone','room','role','departure_date'})
  self.assertEqual(self.a.get('/api/me/reminders').json(),[])
  id=self.register(self.a)
  reminder=self.a.get('/api/me/reminders').json()[0]
  self.assertEqual(reminder['departure_date'],'2028-02-29');self.assertEqual(reminder['bike_count'],1)
  self.assertIn('забрать велосипед',reminder['message'])
  self.assertEqual(self.b.get('/api/me/reminders').json(),[])
  self.approve(id)
  self.assertNotIn('departure_date',self.a.get('/api/me').json())
  with m.db() as c:token=c.execute('SELECT qr FROM bikes WHERE id=?',(id,)).fetchone()['qr']
  qr=self.b.post('/api/qr/resolve',json={'url':'http://testserver/q/b/'+token}).text
  self.assertNotIn('departure_date',qr);self.assertNotIn('2028-02-29',qr)
  self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'withdrawn'})
  self.assertEqual(self.a.get('/api/me/reminders').json(),[])
  self.assertEqual(self.ad.patch(url,json={'departure_date':None}).status_code,200)
  self.assertIsNone(next(u for u in self.ad.get('/api/admin/users').json() if u['id']==me['id'])['departure_date'])
 def test_legacy_database_migration_is_idempotent(self):
  with m.db(True) as c:
   before=[tuple(r) for r in c.execute('SELECT id,password,role FROM users ORDER BY id')]
   c.execute('ALTER TABLE users DROP COLUMN departure_date')
   c.execute('ALTER TABLE requests DROP COLUMN snapshot_json')
  m.init_db();m.init_db()
  with m.db() as c:
   self.assertEqual([tuple(r) for r in c.execute('SELECT id,password,role FROM users ORDER BY id')],before)
   self.assertTrue(all(r['departure_date'] is None for r in c.execute('SELECT departure_date FROM users')))
   self.assertIn('snapshot_json',{r['name'] for r in c.execute('PRAGMA table_info(requests)')})
  self.assertEqual(self.account('after_migration','Жилец').get('/api/me').status_code,200)
 def test_scrap_act_and_invalidated_pending_request(self):
  id=self.register(self.a);self.approve(id)
  url='/api/admin/bikes/'+id+'/act'
  self.assertEqual(self.a.get(url).status_code,403)
  self.assertEqual(self.ad.get(url).status_code,409)
  self.a.post('/api/requests',json={'bike_id':id,'kind':'move','spot_id':self.spots[1]['id']})
  rid=self.request_for(id)['id']
  self.assertEqual(self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'scrapped'}).status_code,200)
  self.assertEqual(self.ad.post('/api/admin/requests/'+rid+'/decision',json={'state':'approved'}).status_code,409)
  self.assertIsNone(self.ad.get('/api/bikes/'+id).json()['place'])
  rejected=next(r for r in self.ad.get('/api/requests').json() if r['id']==rid)
  self.assertEqual(rejected['state'],'rejected');self.assertIsNotNone(rejected['decided_by'])
  before=self.ad.get(url).text
  self.assertIn('зафиксированы в момент списания',before)
  with m.db() as c:
   snapshot=json.loads(c.execute("SELECT details FROM events WHERE entity=? AND action='scrap-snapshot'",(id,)).fetchone()['details'])
  self.assertEqual(snapshot['bike']['model'],'Stels')
  self.assertEqual(snapshot['actor']['username'],'admin')
  self.assertEqual(snapshot['owner']['username'],'alice')
  change={'model':'<img src=x onerror=alert(1)>','color':'Белый','marks':''}
  self.assertEqual(self.a.patch('/api/bikes/'+id,json=change).status_code,409)
  self.assertEqual(self.ad.patch('/api/bikes/'+id,json=change).status_code,200)
  self.ad.patch('/api/me',json={'name':'Новое имя администратора'})
  self.a.patch('/api/me',json={'name':'Новое имя владельца'})
  act=self.ad.get(url)
  self.assertEqual(act.status_code,200)
  self.assertEqual(act.text,before)
  self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'scrapped'})
  self.assertEqual(self.ad.get(url).text,before)
  self.assertIn('Акт списания велосипеда на разбор',act.text)
  self.assertIn('Совет (@admin)',act.text);self.assertIn('UTC',act.text)
  self.assertNotIn('<img',act.text)
  with m.db(True) as c:c.execute("DELETE FROM events WHERE entity=? AND action='scrap-snapshot'",(id,))
  legacy=self.ad.get(url).text
  self.assertIn('Исторический снимок списания отсутствует',legacy)
  self.assertIn('&lt;img',legacy);self.assertNotIn('<img',legacy)
  with m.db(True) as c:c.execute("DELETE FROM events WHERE entity=? AND action='status'",(id,))
  self.assertIn('дата и исполнитель списания не зафиксированы',self.ad.get(url).text)
 def test_fund_owner_reassignment_and_closed_requests(self):
  id=self.register(self.a);self.approve(id)
  self.a.post('/api/requests',json={'bike_id':id,'kind':'release'});rid=self.request_for(id)['id']
  url='/api/admin/bikes/'+id+'/owner'
  self.assertEqual(self.a.patch(url,json={'username':'bobbb'}).status_code,403)
  self.assertEqual(self.ad.patch(url,json={'username':'missing'}).status_code,422)
  self.assertEqual(self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'donated'}).status_code,200)
  self.assertEqual(self.a.get('/api/bikes/'+id).status_code,404)
  self.assertIsNone(self.ad.get('/api/bikes/'+id).json()['owner'])
  with m.db() as c:token=c.execute('SELECT qr FROM bikes WHERE id=?',(id,)).fetchone()['qr']
  self.assertIsNone(self.b.post('/api/qr/resolve',json={'url':'http://testserver/q/b/'+token}).json()['bike']['owner'])
  self.assertEqual(self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'registered'}).status_code,409)
  self.assertEqual(self.ad.patch(url,json={'username':'bobbb'}).status_code,200)
  self.assertEqual(self.b.get('/api/bikes/'+id).json()['status'],'registered')
  self.assertEqual(next(r for r in self.ad.get('/api/requests').json() if r['id']==rid)['state'],'rejected')
  event=next(e for e in self.ad.get('/api/admin/events').json() if e['action']=='owner')
  self.assertEqual(json.loads(event['details'])['new_owner_id'],self.b.get('/api/me').json()['id'])
  self.ad.patch('/api/admin/bikes/'+id+'/status',json={'status':'scrapped'})
  self.assertEqual(self.ad.patch(url,json={'username':'alice'}).status_code,409)
 def test_old_password_login_cannot_create_session_after_change(self):
  with m.db() as c:old=dict(c.execute("SELECT * FROM users WHERE username='alice'").fetchone())
  self.assertEqual(self.a.post('/api/me/password',json={'current':'test-only-password-123','password':'new-password-123'}).status_code,200)
  request=m.Request({'type':'http','scheme':'http','headers':[]})
  with self.assertRaises(m.HTTPException) as error:m.login_response(old,request)
  self.assertEqual(error.exception.status_code,401)
  with m.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?',(old['id'],)).fetchone()[0],0)
 def test_body_limits_early_upload_auth_and_malformed_qr(self):
  from starlette.datastructures import UploadFile
  for url in ('/api/bikes','/api/qr/scan'):
   with self.subTest(url=url),patch.object(UploadFile,'write',new_callable=AsyncMock) as write:
    with TestClient(m.app) as anonymous:
     self.assertEqual(anonymous.post(url,files={'photo':('big.png',b'x'*(12*1024*1024),'image/png')}).status_code,401)
    self.assertEqual(self.a.post(url,content=b'x'*(12*1024*1024+1),headers={'content-type':'multipart/form-data; boundary=a'}).status_code,413)
    self.assertEqual(self.a.post(url,content=(chunk for chunk in (b'x'*(6*1024*1024),b'x'*(6*1024*1024+1))),headers={'content-type':'multipart/form-data; boundary=a'}).status_code,413)
    write.assert_not_called()
  self.assertEqual(self.a.post('/api/auth/login',content=b'x'*(256*1024+1),headers={'content-type':'application/json'}).status_code,413)
  self.assertEqual(self.a.post('/api/qr/resolve',json={'url':'http://[broken]/q/b/abcdefgh'}).status_code,422)
if __name__=="__main__":unittest.main()
