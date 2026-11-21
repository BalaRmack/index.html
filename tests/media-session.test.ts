import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import HomePage from '../app/page';

test('Media Session controls the current YouTube queue and follows metadata and playback state',async()=>{
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.com/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const handlers:Record<string,()=>void>={};
  const media={metadata:null as {title:string;artist:string;artwork:{src:string}[]}|null,playbackState:'none',setActionHandler:(name:string,fn:(()=>void)|null)=>{if(fn)handlers[name]=fn;else delete handlers[name]}};
  Object.defineProperty(dom.window.navigator,'mediaSession',{value:media,configurable:true});
  Object.assign(globalThis,{MediaMetadata:class {constructor(data:object){Object.assign(this,data)}}});
  const tracks=[{id:'yt:abcdefghijk',video_id:'abcdefghijk',source:'youtube',title:'First',artist:'Artist One',storage_path:null},{id:'yt:zyxwvutsrqp',video_id:'zyxwvutsrqp',source:'youtube',title:'Second',artist:'Artist Two',storage_path:null},...Array.from({length:6},(_,i)=>({id:`yt:abcdefghij${i}`,video_id:`abcdefghij${i}`,source:'youtube',title:`Трек ${i+3}`,artist:'Исполнитель',storage_path:null}))];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify({similar:tracks,recent:[],daily:[],trending:[]}))) as typeof fetch;
  let options:YT.PlayerOptions;let currentId='';let playCount=0,pauseCount=0,constructorCount=0;
  const loaded:string[]=[];
  const fake={setVolume:()=>{},loadVideoById:(id:string)=>{currentId=id;loaded.push(id);options.events!.onStateChange!({target:fake as unknown as YT.Player,data:1});},pauseVideo:()=>{pauseCount++;options.events!.onStateChange!({target:fake as unknown as YT.Player,data:2});},playVideo:()=>{playCount++;options.events!.onStateChange!({target:fake as unknown as YT.Player,data:1});},seekTo:()=>{},getPlayerState:()=>2,getVideoData:()=>({video_id:currentId}),getCurrentTime:()=>0,getDuration:()=>0,destroy:()=>{}};
  (dom.window as unknown as {YT:unknown}).YT={PlayerState:{PLAYING:1,PAUSED:2,ENDED:0},Player:function(_host:HTMLElement,opts:YT.PlayerOptions){constructorCount++;options=opts;queueMicrotask(()=>opts.events!.onReady!({target:fake as unknown as YT.Player}));return fake}};
  const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async()=>{root.render(React.createElement(HomePage));});
    const cards=dom.window.document.querySelectorAll('.catalog-card-main');assert.equal(cards.length,8);assert.ok(dom.window.document.querySelector('[aria-label="Главная"]'));assert.ok(dom.window.document.querySelector('[aria-label="Поиск"]'));assert.ok(dom.window.document.body.textContent!.includes('Открыть медиатеку'));assert.equal(dom.window.document.querySelectorAll('.shelf-scroll .catalog-card').length,8);
    await act(async()=>{(cards[0] as HTMLElement).click();});
    assert.ok(dom.window.document.querySelector('.main > .youtube-background[aria-hidden="true"]'));assert.equal(dom.window.document.querySelector('.youtube-panel'),null);assert.ok(dom.window.document.querySelector('.player [aria-label="Перемотка"]'));assert.ok(dom.window.document.querySelector('.player [aria-label="Громкость"]'));assert.equal(dom.window.document.body.textContent!.includes('Найти в Deezer'),false);assert.equal(constructorCount,1);assert.deepEqual(loaded,['abcdefghijk']);assert.equal(media.metadata?.title,'First');assert.equal(media.metadata?.artist,'Artist One');assert.match(media.metadata!.artwork[0].src,/abcdefghijk/);assert.equal(media.playbackState,'playing');
    await act(async()=>handlers.pause());assert.equal(media.playbackState,'paused');
    await act(async()=>handlers.play());assert.equal(media.playbackState,'playing');assert.equal(playCount,1);
    await act(async()=>handlers.nexttrack());assert.deepEqual(loaded,['abcdefghijk','zyxwvutsrqp']);assert.equal(media.metadata?.title,'Second');
    await act(async()=>handlers.previoustrack());assert.deepEqual(loaded,['abcdefghijk','zyxwvutsrqp','abcdefghijk']);assert.equal(media.metadata?.title,'First');assert.ok(pauseCount>=1);assert.equal(constructorCount,1);
  } finally {await act(async()=>root.unmount());globalThis.fetch=originalFetch;dom.window.close();}
  assert.equal(Object.keys(handlers).length,0);assert.equal(media.metadata,null);
});
