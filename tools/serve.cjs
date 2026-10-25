// Development file server only. No API, database, sessions or request processing.
const http=require("node:http");
const fs=require("node:fs/promises");
const path=require("node:path");
const root=path.resolve(__dirname,"../frontend");
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid PORT");
const legacy={profile:"profile",bikes:"bikes",bike:"bike","bike-forward":"bike-forward",register:"register","edit-bike":"edit-bike",scan:"scan",map:"map",requests:"requests","admin-profile":"admin-profile","admin-bike":"admin-bike","admin-edit-bike":"admin-edit-bike","admin-owner":"admin-owner","admin-scan":"admin-scan","admin-map":"admin-map","admin-requests":"admin-requests"};
const server=http.createServer(async(req,res)=>{
  res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Cache-Control","no-store");
  if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{Allow:"GET, HEAD"});res.end("Static site only");return;}
  try{
    let pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    if(pathname.startsWith("/frontend/"))pathname=pathname.slice(9);
    if(pathname==="/demo/index.html"){res.writeHead(302,{Location:"/"});res.end();return;}
    const old=pathname.match(/^\/([a-z-]+)\.html$/);
    if(old&&legacy[old[1]]){res.writeHead(302,{Location:"/#page-"+legacy[old[1]]});res.end();return;}
    const file=path.resolve(root,"."+ (pathname==="/" ? "/index.html":pathname));
    const relative=path.relative(root,file);
    if(relative.startsWith("..")||path.isAbsolute(relative)){res.writeHead(403);res.end("Forbidden");return;}
    const content=await fs.readFile(file);
    const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"}[path.extname(file)]||"application/octet-stream";
    res.writeHead(200,{"Content-Type":mime});res.end(req.method==="HEAD"?undefined:content);
  }catch{res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Страница не найдена");}
});
server.on("error",error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,"127.0.0.1",()=>console.log("Велореестр: http://127.0.0.1:"+port));
