export class Scanner {
  constructor(video,onResult,onError) { this.video=video; this.onResult=onResult; this.onError=onError; this.active=false; this.stream=null; this.frame=0; this.epoch=0; this.canvas=document.createElement("canvas"); }
  stop() { this.active=false; this.epoch++; cancelAnimationFrame(this.frame); this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null; this.video.srcObject=null; }
  async start() {
    this.stop(); const epoch=this.epoch;
    try {
      if(!navigator.mediaDevices?.getUserMedia) throw new Error("Камера доступна через HTTPS или localhost. Можно загрузить фото QR.");
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream; this.video.srcObject=stream; await this.video.play();
      if(epoch!==this.epoch)return;
      this.active=true; this.tick();
    } catch(e) { if(epoch===this.epoch){this.stop();this.onError(e.name==="NotAllowedError"?"Доступ к камере запрещён. Разрешите его в браузере или загрузите фото.":e.message || "Не удалось включить камеру.");} }
  }
  decode(source,width,height,max=1600) {
    if(!window.jsQR)throw new Error("Не загружен модуль чтения QR.");
    const scale=Math.min(1,max/Math.max(width,height));
    this.canvas.width=Math.max(1,Math.round(width*scale));this.canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=this.canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(source,0,0,this.canvas.width,this.canvas.height);
    const pixels=ctx.getImageData(0,0,this.canvas.width,this.canvas.height);
    return window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:"attemptBoth"})?.data;
  }
  tick() {
    if(!this.active)return;
    try { if(this.video.readyState>=2 && this.video.videoWidth) {
      const code=this.decode(this.video,this.video.videoWidth,this.video.videoHeight,960);
      if(code){this.stop();this.onResult(code);return;}
    }} catch(e){this.stop();this.onError(e.message);return;}
    this.frame=requestAnimationFrame(()=>this.tick());
  }
  async photo(file) {
    this.stop(); const epoch=this.epoch;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024){this.onError("Выберите JPG, PNG или WebP до 10 МБ.");return;}
    const url=URL.createObjectURL(file);
    try { const img=new Image();img.src=url;await img.decode(); if(epoch!==this.epoch)return;
      if(img.width*img.height>50000000)throw new Error("Слишком большое изображение.");
      const code=this.decode(img,img.width,img.height,2200);
      if(!code)throw new Error("QR не распознан. Выберите более чёткое фото целиком с кодом.");
      this.onResult(code);
    } catch(e){if(epoch===this.epoch)this.onError(e.message || "Не удалось прочитать изображение.");}
    finally{URL.revokeObjectURL(url);}
  }
}
export function parseQr(text,publicOrigin=location.origin) {
  const url=new URL(text,publicOrigin);
  if(url.origin!==new URL(publicOrigin).origin)throw new Error("QR относится к другому сайту.");
  const match=url.pathname.match(/^\/q\/([bp])\/([A-Za-z0-9_-]{8,160})\/?$/);
  if(!match || url.search || url.hash)throw new Error("Это не QR велосипеда или парковки.");
  return {kind:match[1],token:match[2]};
}
