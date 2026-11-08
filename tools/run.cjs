// Local launcher for the real FastAPI service. No application logic in Node.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
if(!fs.existsSync(python)){console.error('Сначала создайте .venv и установите requirements.txt. Инструкция в README.');process.exit(1);}
const port=String(process.env.PORT||8010);
if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535){console.error('Неверный PORT');process.exit(1);}
const child=spawn(python,['-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',port],{cwd:root,stdio:'inherit',windowsHide:true,env:process.env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>process.exit(code||0));
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
