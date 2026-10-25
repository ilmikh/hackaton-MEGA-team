// Frontend only: camera preview, still image capture and file selection.
// No QR decoding, token parsing or QR generation.
export class Scanner {
  constructor(video,onImage,onError){this.video=video;this.onImage=onImage;this.onError=onError;this.stream=null;this.epoch=0;}
  stop(){this.epoch++;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;}
  async start(){
    this.stop();const epoch=this.epoch;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error("Камера доступна через HTTPS или localhost. Можно загрузить фото QR.");
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;await this.video.play();
    }catch(error){if(epoch===this.epoch){this.stop();this.onError(error.name==="NotAllowedError"?"Разрешите доступ к камере или загрузите фото.":error.message);}}
  }
  async capture(){
    const epoch=this.epoch;
    try{
      if(!this.stream || this.video.readyState<2 || !this.video.videoWidth)throw Error("Сначала включите камеру и дождитесь изображения.");
      const canvas=document.createElement("canvas"),scale=Math.min(1,2200/Math.max(this.video.videoWidth,this.video.videoHeight));
      canvas.width=Math.round(this.video.videoWidth*scale);canvas.height=Math.round(this.video.videoHeight*scale);
      canvas.getContext("2d").drawImage(this.video,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.9));
      if(epoch!==this.epoch)return;
      if(!blob)throw Error("Не удалось сделать снимок.");
      await this.onImage(new File([blob],"qr-photo.jpg",{type:"image/jpeg"}));
    }catch(error){if(epoch===this.epoch)this.onError(error.message);}
  }
  async photo(file){
    this.stop();
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024){this.onError("Выберите JPG, PNG или WebP до 10 МБ.");return;}
    await this.onImage(file);
  }
}
