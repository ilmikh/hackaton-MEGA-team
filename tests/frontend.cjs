const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  const file=path.resolve(process.cwd(),"."+(pathname.startsWith("/q/")?"/frontend/index.html":pathname.startsWith("/static/")?"/frontend"+pathname:pathname));
  if(!file.startsWith(process.cwd()+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{"Content-Type":({".html":"text/html",".js":"text/javascript",".css":"text/css"}[path.extname(file)]||"application/octet-stream")});res.end(err?"Not found":data);});
 });await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
  const page=await browser.newPage(),base="http://127.0.0.1:"+server.address().port,exceptions=[];
  page.on("pageerror",e=>exceptions.push(e.message));
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxoAAAAASUVORK5CYII=","base64");
  const upload={name:"photo.png",mimeType:"image/png",buffer:png};
  let role="resident",scanCount=0,resolveCount=0,downloadCount=0;
  const b={id:"b1",public_number:"В-001",model:"Stels",color:"Синий",review_state:"approved",status_label:"Зарегистрирован",owner:{display_name:"Иван",contact_type:"telegram",contact_value:"@ivan_s",room_number:"412"}};
  await page.context().addCookies([{name:"csrftoken",value:"frontend-test",url:base}]);
  await page.route("**/api/**",async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   const json=(status,data)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
   if(p==="/api/me")return json(200,{id:"u1",role,display_name:"Алина",contact_type:"telegram",contact_value:"@alina_k"});
   if(p==="/api/me/bikes/b1")return json(200,b);
   if(p==="/api/me/bikes/b1/qr")return json(200,{image_url:"/api/qr-image.png",download_url:"/api/qr-image.png"});
   if(p==="/api/qr-image.png"){downloadCount++;return route.fulfill({status:200,contentType:"image/png",body:png});}
   if(p.endsWith("/qr/scan")){
    scanCount++;assert.equal(req.headers()["x-csrftoken"],"frontend-test");
    assert.match(req.headers()["content-type"],/^multipart\/form-data; boundary=/);
    assert.match(req.postDataBuffer().toString(),/name="photo"/);
    if(scanCount===1)return json(422,{detail:"QR не найден на фото"});
    assert.equal(p,role==="admin"?"/api/admin/qr/scan":"/api/qr/scan");
    return json(200,{kind:"bike",bike:role==="admin"?b:{public_number:"В-001",owner:{display_name:"Иван",contact_type:"telegram",contact_value:"@ivan_s"}}});
   }
   if(p.endsWith("/qr/resolve")){resolveCount++;assert.equal(JSON.parse(req.postData()).url,base+"/q/b/backend-token");return json(200,{kind:"parking",parking_id:"p1"});}
   return json(404,{detail:"Не найдено"});
  });
  await page.goto(base+"/frontend/index.html#/scan");
  await page.locator("#qr-photo").setInputFiles(upload);await page.getByText("QR не найден на фото",{exact:true}).waitFor();
  await page.locator("#qr-photo").setInputFiles(upload);await page.getByRole("dialog").getByText("Иван",{exact:true}).waitFor();
  assert.equal(await page.getByRole("dialog").getByText(/Комната/).count(),0);
  await page.keyboard.press("Escape");
  const count=scanCount;
  await page.locator("#qr-photo").setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("not an image")});
  await page.getByText("Выберите JPG, PNG или WebP до 10 МБ.",{exact:true}).waitFor();assert.equal(scanCount,count);
  await page.getByRole("button",{name:"Сфотографировать QR",exact:true}).click();
  await page.getByText("Сначала включите камеру и дождитесь изображения.",{exact:true}).waitFor();
  await page.goto(base+"/frontend/index.html#/bikes/b1");await page.getByRole("button",{name:"Мой QR",exact:true}).click();
  await page.locator("dialog img").waitFor();assert.equal(await page.locator("dialog svg").count(),0);
  const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"Скачать QR"}).click();assert.equal((await downloaded).suggestedFilename(),"bike-qr.png");assert.ok(downloadCount);
  await page.keyboard.press("Escape");
  role="admin";await page.goto(base+"/frontend/index.html#/scan");await page.reload();
  await page.locator("#qr-photo").setInputFiles(upload);await page.getByRole("dialog").getByText("Комната: 412",{exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.goto(base+"/q/b/backend-token");await page.getByRole("heading",{name:"Карта парковок",exact:true}).waitFor();
  assert.equal(resolveCount,1);
  const demo=base+"/frontend/demo/index.html";await page.goto(demo+"#/scan");
  await page.locator("#qr-photo").setInputFiles(upload);await page.getByText("Распознавание QR выполняет бэк. Подключите API для проверки.",{exact:true}).waitFor();
  await page.goto(demo+"#/bikes/b1");await page.getByRole("button",{name:"Мой QR",exact:true}).click();await page.getByText("Изображение QR формирует бэк. Подключите API для просмотра.",{exact:true}).waitFor();
  await page.goto(demo+"#/register");await page.getByLabel("Модель",{exact:true}).fill("Тест");
  await page.getByLabel("Цвет",{exact:true}).fill("Сине-белый");await page.locator("#bike-photo").setInputFiles(upload);
  await page.getByRole("button",{name:"Выбрать место на карте"}).click();await page.getByRole("button",{name:"Гамма — павильон · Г-06",exact:true}).click();
  await page.getByRole("button",{name:"Отправить на регистрацию"}).click();await page.getByRole("heading",{name:"На проверке · Тест",exact:true}).waitFor();
  await page.goto(demo+"#/scan");await page.getByRole("heading",{name:"Сканировать QR",exact:true}).waitFor();
  await page.evaluate(()=>{
   window.stopped=0;Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>window.stopped++}]})}});
   Object.defineProperty(HTMLMediaElement.prototype,"srcObject",{configurable:true,set(v){this.fakeStream=v;},get(){return this.fakeStream;}});HTMLMediaElement.prototype.play=async()=>{};
  });
  await page.getByRole("button",{name:"Включить камеру"}).click();await page.getByRole("link",{name:"Мой профиль",exact:true}).click();
  assert.ok(await page.evaluate(()=>window.stopped>0));assert.deepEqual(exceptions,[]);
  console.log("PASS: frontend uploads photo to backend; CSRF/multipart; 422 retry; role-specific results; PNG from server; backend resolves QR links; demo has no QR processing; registration and camera cleanup.");
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
