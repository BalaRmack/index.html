import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act,createRef} from 'react';
import {createRoot} from 'react-dom/client';
import YouTubePlayer, {type YouTubePlayerHandle} from '../components/YouTubePlayer';

test('two persistent iframes cue and swap safely, cancel queued playback and ignore standby events',async()=>{
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.com/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  type Fake={id:string;events:YT.Events;iframe:HTMLIFrameElement;setVolume:(v:number)=>void;loadVideoById:(id:string)=>void;cueVideoById:(id:string)=>void;pauseVideo:()=>void;playVideo:()=>void;seekTo:()=>void;getPlayerState:()=>number;getVideoData:()=>{video_id:string};getIframe:()=>HTMLIFrameElement;getCurrentTime:()=>number;getDuration:()=>number;destroy:()=>void};
  const players:Fake[]=[];const ops:string[]=[];const states:string[]=[];
  (dom.window as unknown as {YT:unknown}).YT={PlayerState:{PLAYING:1,PAUSED:2,ENDED:0},Player:function(host:HTMLElement,opts:YT.PlayerOptions){
    assert.equal(opts.host,'https://www.youtube-nocookie.com');assert.equal(opts.width,'2');assert.equal(opts.height,'2');
    const index=players.length;const iframe=dom.window.document.createElement('iframe');host.replaceWith(iframe);
    const p:Fake={id:'',events:opts.events!,iframe,setVolume:()=>{},loadVideoById:id=>{p.id=id;ops.push(`load${index}:${id}`)},cueVideoById:id=>{p.id=id;ops.push(`cue${index}:${id}`)},pauseVideo:()=>ops.push(`pause${index}`),playVideo:()=>ops.push(`play${index}`),seekTo:()=>{},getPlayerState:()=>2,getVideoData:()=>({video_id:p.id}),getIframe:()=>iframe,getCurrentTime:()=>0,getDuration:()=>0,destroy:()=>{ops.push(`destroy${index}`);iframe.remove()}};
    players.push(p);return p;
  }};
  const ref=createRef<YouTubePlayerHandle>();const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async()=>root.render(React.createElement(YouTubePlayer,{volume:70,onState:s=>states.push(s),onProgress:()=>{},onError:()=>{},ref})));
    assert.equal(players.length,2);assert.equal(dom.window.document.querySelectorAll('.youtube-background iframe').length,2);
    await act(async()=>{ref.current!.load('firstVideo1');ref.current!.load('secondVid22');ref.current!.cue('thirdVideo3');});
    await act(async()=>{for(const p of players)p.events.onReady!({target:p as unknown as YT.Player});});
    assert.deepEqual(ops.slice(0,2),['load0:secondVid22','cue1:thirdVideo3']);assert.equal(players[0].iframe.tabIndex,-1);
    await act(async()=>{players[1].events.onStateChange!({target:players[1] as unknown as YT.Player,data:5});players[1].events.onStateChange!({target:players[1] as unknown as YT.Player,data:1});});assert.deepEqual(states,[]);
    await act(async()=>{ref.current!.load('thirdVideo3');ref.current!.cue('fourthVid44');});
    assert.deepEqual(ops.slice(2),['pause0','play1','cue0:fourthVid44']);
    await act(async()=>{ref.current!.load('randomVid11');});assert.ok(ops.includes('load1:randomVid11'));
    await act(async()=>{Object.defineProperty(dom.window.document,'hidden',{value:true,configurable:true});dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));});
    const before=ops.length;await act(async()=>{ref.current!.stop();players[1].events.onStateChange!({target:players[1] as unknown as YT.Player,data:1});});assert.deepEqual(ops.slice(before),['pause0','pause1']);assert.deepEqual(states,[]);
  } finally {await act(async()=>root.unmount());dom.window.close();}
  assert.ok(ops.includes('destroy0'));assert.ok(ops.includes('destroy1'));
});
