'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

declare global { interface Window { onYouTubeIframeAPIReady?:()=>void } }

type Handle = { load:(videoId:string)=>void; stop:()=>void; play:()=>void; pause:()=>void; seek:(seconds:number)=>void; volume:(value:number)=>void };
type Props = { volume:number; onState:(state:'playing'|'paused'|'ended')=>void; onProgress:(time:number,duration:number)=>void; onError:(message:string)=>void };
let apiPromise:Promise<typeof YT>|undefined;
function youtubeApi() {
  if(window.YT?.Player) return Promise.resolve(window.YT);
  if(apiPromise) return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const old=window.onYouTubeIframeAPIReady;
    const timer=window.setTimeout(()=>{apiPromise=undefined;document.querySelector('script[data-youtube-api]')?.remove();reject(new Error('YouTube IFrame API не загрузился.'));},15000);
    window.onYouTubeIframeAPIReady=()=>{window.clearTimeout(timer);old?.();resolve(window.YT);};
    if(!document.querySelector('script[data-youtube-api]')) {
      const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.dataset.youtubeApi='true';
      script.onerror=()=>{window.clearTimeout(timer);script.remove();apiPromise=undefined;reject(new Error('Не удалось загрузить плеер YouTube.'));};document.head.appendChild(script);
    }
  });
  return apiPromise;
}

// The component remains mounted even when another source is playing. Until onReady,
// only the latest requested video is retained; stop() also cancels that pending request.
const YouTubePlayer=forwardRef<Handle,Props>(function YouTubePlayer({volume,onState,onProgress,onError},ref){
  const container=useRef<HTMLDivElement>(null);
  const player=useRef<YT.Player|null>(null);
  const selected=useRef<string|null>(null);
  const initError=useRef<string|null>(null);
  const callbacks=useRef({onState,onProgress,onError,volume});callbacks.current={onState,onProgress,onError,volume};
  useImperativeHandle(ref,()=>({
    load:id=>{selected.current=id;if(player.current)player.current.loadVideoById(id);else if(initError.current)callbacks.current.onError(`${initError.current} Обновите страницу.`);},
    stop:()=>{selected.current=null;player.current?.pauseVideo();},
    play:()=>player.current?.playVideo(),pause:()=>player.current?.pauseVideo(),seek:s=>player.current?.seekTo(s,true),volume:v=>player.current?.setVolume(v),
  }),[]);
  useEffect(()=>{
    let disposed=false;let interval:number|undefined;let instance:YT.Player|undefined;
    youtubeApi().then(YTApi=>{
      if(disposed||!container.current)return;
      const host=document.createElement('div');container.current.replaceChildren(host);
      instance=new YTApi.Player(host,{width:'200',height:'200',playerVars:{playsinline:1,controls:1,origin:window.location.origin,autoplay:0},events:{
        onReady:e=>{if(disposed)return;player.current=e.target;e.target.getIframe?.()?.setAttribute('tabindex','-1');e.target.setVolume(callbacks.current.volume);if(selected.current)e.target.loadVideoById(selected.current);},
        onStateChange:e=>{if(disposed||!selected.current)return;const id=e.target.getVideoData()?.video_id;if(id && id!==selected.current)return;if(e.data===YTApi.PlayerState.PLAYING)callbacks.current.onState('playing');else if(e.data===YTApi.PlayerState.PAUSED)callbacks.current.onState('paused');else if(e.data===YTApi.PlayerState.ENDED)callbacks.current.onState('ended');},
        onError:e=>{if(disposed||!selected.current)return;callbacks.current.onError(e.data===101||e.data===150?'Автор запретил встроенное воспроизведение. Откройте видео на YouTube или выберите другой источник.':`YouTube не смог воспроизвести видео (ошибка ${e.data}).`);},
        onAutoplayBlocked:()=>{if(!disposed && selected.current)callbacks.current.onError('Браузер заблокировал автозапуск. Попробуйте нажать «Воспроизвести» в нижней панели или выбрать другой трек.');},
      }});
      interval=window.setInterval(()=>{if(!disposed && selected.current && player.current?.getPlayerState?.()===YTApi.PlayerState.PLAYING)callbacks.current.onProgress(player.current.getCurrentTime(),player.current.getDuration());},250);
    }).catch(error=>{if(!disposed){initError.current=error.message;if(selected.current)callbacks.current.onError(error.message);}});
    return()=>{disposed=true;if(interval)window.clearInterval(interval);instance?.destroy();player.current=null;};
  },[]);
  return <div className="youtube-background" aria-hidden="true"><div ref={container} className="youtube-frame" /></div>;
});
export default YouTubePlayer;
export type YouTubePlayerHandle = Handle;
