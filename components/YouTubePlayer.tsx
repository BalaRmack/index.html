'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

declare global { interface Window { onYouTubeIframeAPIReady?:()=>void } }

type Handle = { load:(videoId:string)=>void; cue:(videoId:string|null)=>void; stop:()=>void; play:()=>void; pause:()=>void; seek:(seconds:number)=>void; volume:(value:number)=>void };
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

// Both instances stay mounted. Cue prepares the second player, but does not buffer video.
type Slot = { player:YT.Player|null; cued:string|null; readyToPlay:boolean };
const YouTubePlayer=forwardRef<Handle,Props>(function YouTubePlayer({volume,onState,onProgress,onError},ref){
  const containers=useRef<(HTMLDivElement|null)[]>([null,null]);
  const slots=useRef<Slot[]>([{player:null,cued:null,readyToPlay:false},{player:null,cued:null,readyToPlay:false}]);
  const active=useRef(0);const selected=useRef<string|null>(null);const upcoming=useRef<string|null>(null);
  const initError=useRef<string|null>(null);
  const callbacks=useRef({onState,onProgress,onError,volume});callbacks.current={onState,onProgress,onError,volume};
  function cueNext(id:string|null) {
    upcoming.current=id;
    const slot=slots.current[1-active.current];
    if(slot.cued===id)return;
    slot.cued=id;slot.readyToPlay=false;
    if(slot.player && id)slot.player.cueVideoById(id);
  }
  useImperativeHandle(ref,()=>({
    load:id=>{
      const standby=1-active.current;const next=slots.current[standby];
      selected.current=id;
      if(next.player && next.cued===id && next.readyToPlay) {
        const previous=slots.current[active.current];active.current=standby;
        previous.player?.pauseVideo();previous.cued=null;previous.readyToPlay=false;
        upcoming.current=null;next.cued=null;next.readyToPlay=false;
        next.player.setVolume(callbacks.current.volume);next.player.playVideo();
      } else {
        const current=slots.current[active.current];
        if(current.player)current.player.loadVideoById(id);
        else if(initError.current)callbacks.current.onError(`${initError.current} Обновите страницу.`);
      }
    },
    cue:cueNext,
    stop:()=>{selected.current=null;upcoming.current=null;for(const slot of slots.current){slot.cued=null;slot.readyToPlay=false;slot.player?.pauseVideo();}},
    play:()=>slots.current[active.current].player?.playVideo(),
    pause:()=>slots.current[active.current].player?.pauseVideo(),
    seek:s=>slots.current[active.current].player?.seekTo(s,true),
    volume:v=>slots.current.forEach(slot=>slot.player?.setVolume(v)),
  }),[]);
  useEffect(()=>{
    let disposed=false;let interval:number|undefined;const instances:YT.Player[]=[];
    youtubeApi().then(YTApi=>{
      if(disposed)return;
      containers.current.forEach((container,index)=>{
        if(!container)return;
        const host=document.createElement('div');container.replaceChildren(host);
        const instance=new YTApi.Player(host,{width:'200',height:'200',playerVars:{playsinline:1,controls:1,origin:window.location.origin,autoplay:0},events:{
          onReady:e=>{if(disposed)return;const slot=slots.current[index];slot.player=e.target;e.target.getIframe?.()?.setAttribute('tabindex','-1');e.target.setVolume(callbacks.current.volume);if(index===active.current && selected.current)e.target.loadVideoById(selected.current);else if(index!==active.current && upcoming.current){slot.cued=upcoming.current;e.target.cueVideoById(upcoming.current);}},
          onStateChange:e=>{
            if(disposed)return;
            const slot=slots.current[index];const id=e.target.getVideoData()?.video_id;
            if(index!==active.current){if(e.data===5 && slot.cued && (!id||id===slot.cued))slot.readyToPlay=true;return;}
            if(!selected.current || (id && id!==selected.current))return;
            if(e.data===YTApi.PlayerState.PLAYING)callbacks.current.onState('playing');else if(e.data===YTApi.PlayerState.PAUSED)callbacks.current.onState('paused');else if(e.data===YTApi.PlayerState.ENDED)callbacks.current.onState('ended');
          },
          onError:e=>{if(disposed)return;if(index!==active.current){slots.current[index].cued=null;slots.current[index].readyToPlay=false;return;}if(selected.current)callbacks.current.onError(e.data===101||e.data===150?'Автор запретил встроенное воспроизведение. Выберите другой трек.':`YouTube не смог воспроизвести видео (ошибка ${e.data}).`);},
          onAutoplayBlocked:()=>{if(!disposed && index===active.current && selected.current)callbacks.current.onError('Браузер заблокировал автозапуск. Попробуйте нажать «Воспроизвести» в нижней панели или выбрать другой трек.');},
        }});instances.push(instance);
      });
      interval=window.setInterval(()=>{const player=slots.current[active.current].player;if(!disposed && selected.current && player?.getPlayerState?.()===YTApi.PlayerState.PLAYING)callbacks.current.onProgress(player.getCurrentTime(),player.getDuration());},250);
    }).catch(error=>{if(!disposed){initError.current=error.message;if(selected.current)callbacks.current.onError(error.message);}});
    return()=>{disposed=true;if(interval)window.clearInterval(interval);instances.forEach(player=>player.destroy());slots.current.forEach(slot=>{slot.player=null;slot.cued=null;slot.readyToPlay=false;});};
  },[]);
  return <div className="youtube-background" aria-hidden="true">{[0,1].map(index=><div key={index} ref={node=>{containers.current[index]=node}} className="youtube-frame" />)}</div>;
});
export default YouTubePlayer;
export type YouTubePlayerHandle = Handle;
