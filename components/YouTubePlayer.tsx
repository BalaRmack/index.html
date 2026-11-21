'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

declare global { interface Window { onYouTubeIframeAPIReady?:()=>void } }

type Handle = { play:()=>void; pause:()=>void; seek:(seconds:number)=>void; volume:(value:number)=>void };
type Props = { videoId:string; volume:number; onState:(state:'playing'|'paused'|'ended')=>void; onProgress:(time:number,duration:number)=>void; onError:(message:string)=>void; onClose:()=>void; onFindAlternative:()=>void };
let apiPromise:Promise<typeof YT>|undefined;
function youtubeApi() {
  if(window.YT?.Player) return Promise.resolve(window.YT);
  if(apiPromise) return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const old=window.onYouTubeIframeAPIReady;
    const timer=window.setTimeout(()=>{apiPromise=undefined;reject(new Error('YouTube IFrame API не загрузился.'));},15000);
    window.onYouTubeIframeAPIReady=()=>{window.clearTimeout(timer);old?.();resolve(window.YT);};
    if(!document.querySelector('script[data-youtube-api]')) {
      const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.dataset.youtubeApi='true';
      script.onerror=()=>{window.clearTimeout(timer);script.remove();apiPromise=undefined;reject(new Error('Не удалось загрузить плеер YouTube.'));};document.head.appendChild(script);
    }
  });
  return apiPromise;
}

const YouTubePlayer=forwardRef<Handle,Props>(function YouTubePlayer({videoId,volume,onState,onProgress,onError,onClose,onFindAlternative},ref){
  const container=useRef<HTMLDivElement>(null); const player=useRef<YT.Player|null>(null);
  const callbacks=useRef({onState,onProgress,onError,volume});callbacks.current={onState,onProgress,onError,volume};
  const [failed,setFailed]=useState(false);
  useImperativeHandle(ref,()=>({play:()=>player.current?.playVideo(),pause:()=>player.current?.pauseVideo(),seek:s=>player.current?.seekTo(s,true),volume:v=>player.current?.setVolume(v)}),[]);
  useEffect(()=>{
    let disposed=false;let interval:number|undefined;let instance:YT.Player|undefined;
    youtubeApi().then(YTApi=>{
      if(disposed||!container.current)return;
      const host=document.createElement('div');container.current.replaceChildren(host);
      instance=new YTApi.Player(host,{width:'100%',height:'200',videoId,playerVars:{playsinline:1,controls:1,origin:window.location.origin,autoplay:0},events:{
        onReady:e=>{if(disposed)return;player.current=e.target;e.target.setVolume(callbacks.current.volume);const rect=container.current?.getBoundingClientRect();const visible=rect && Math.max(0,Math.min(rect.right,innerWidth)-Math.max(rect.left,0))*Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0)) > rect.width*rect.height/2;if(visible && !document.hidden)e.target.playVideo();else callbacks.current.onError('Откройте плеер YouTube и нажмите Play.');},
        onStateChange:e=>{if(disposed)return;if(e.data===YTApi.PlayerState.PLAYING)callbacks.current.onState('playing');else if(e.data===YTApi.PlayerState.PAUSED)callbacks.current.onState('paused');else if(e.data===YTApi.PlayerState.ENDED)callbacks.current.onState('ended');},
        onError:e=>{if(disposed)return;setFailed(true);callbacks.current.onError(e.data===101||e.data===150?'Автор запретил встроенное воспроизведение. Откройте видео на YouTube или выберите другой источник.':`YouTube не смог воспроизвести видео (ошибка ${e.data}).`);},
        onAutoplayBlocked:()=>{if(!disposed)callbacks.current.onError('Браузер заблокировал автозапуск. Нажмите Play в окне YouTube.');},
      }});
      interval=window.setInterval(()=>{if(!disposed && player.current?.getPlayerState?.()===YTApi.PlayerState.PLAYING)callbacks.current.onProgress(player.current.getCurrentTime(),player.current.getDuration());},250);
    }).catch(error=>{if(!disposed){setFailed(true);callbacks.current.onError(error.message);}});
    const visibility=()=>{if(document.hidden)player.current?.pauseVideo();};document.addEventListener('visibilitychange',visibility);
    return()=>{disposed=true;document.removeEventListener('visibilitychange',visibility);if(interval)window.clearInterval(interval);instance?.destroy();player.current=null;};
  },[videoId]);
  return <aside className="youtube-panel" aria-label="Плеер YouTube"><div className="youtube-header"><span>YOU<span className="yt-red">TUBE</span> · ВИДЕО</span><button onClick={onClose} aria-label="Закрыть YouTube и остановить воспроизведение">×</button></div><div ref={container} className="youtube-frame" />{failed&&<p>Видео недоступно для встроенного плеера.</p>}<button className="youtube-alternative" onClick={onFindAlternative}>Найти в Deezer</button><a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">Открыть на YouTube ↗</a></aside>;
});
export default YouTubePlayer;
export type YouTubePlayerHandle = Handle;
