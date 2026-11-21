import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {POST} from '../app/api/recommendations/route';
import {guestLikes,guestSignals,saveGuestSignal,setGuestLike,waveHistory} from '../lib/guest-history';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original});
const panel=(id:string,artist:string,title:string)=>({playlistPanelVideoRenderer:{videoId:id,title:{simpleText:title},shortBylineText:{simpleText:artist},lengthText:{simpleText:'3:20'}}});
const mix={contents:[panel('abcdefghijk','Seed','Seed song'),panel('bcdefghijkl','Other','Already heard'),panel('cdefghijklm','Third','New song'),panel('defghijklmn','Fourth','Another song')]};
const signal=(id:string,event_type:string,artist:string,title:string)=>({video_id:id,track_id:`yt:${id}`,artist,title,event_type,created_at:new Date().toISOString()});
const request=(body:unknown)=>new Request('https://app.test/api/recommendations?mode=wave',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('wave chooses from guest history and excludes played IDs, recordings and queue',async()=>{
  globalThis.fetch=(async input=>{if(String(input).includes('youtubei'))return new Response(JSON.stringify(mix));throw Error('deezer unavailable');}) as typeof fetch;
  const response=await POST(request({seeds:[signal('abcdefghijk','like','Seed','Seed song')],played:[signal('bcdefghijkl','listen','Other','Already heard')],seen:['defghijklmn']}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.personalized,true);assert.deepEqual(data.providers,['youtube-radio']);assert.deepEqual(data.tracks.map((t:{video_id:string})=>t.video_id),['cdefghijklm']);
});
test('wave fails explicitly rather than pretending unrelated search is personalized',async()=>{
  globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;
  const response=await POST(request({seeds:[signal('abcdefghijk','listen','Seed','Seed song')]}));assert.equal(response.status,503);
});
test('cold start shuffles labelled editorial fallback when charts are down',async()=>{
  globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;
  const old=Math.random;Math.random=()=>0;
  try {const response=await POST(request({seeds:[],played:[],seen:[]}));const data=await response.json();assert.equal(response.status,200);assert.equal(data.editorialFallback,true);assert.equal(data.personalized,false);assert.notEqual(data.tracks[0].video_id,'djV11Xbc914');} finally {Math.random=old;}
});
test('guest likes, history and skips persist; unlike removes preference',()=>{
  const dom=new JSDOM('',{url:'https://example.com'});Object.assign(globalThis,{localStorage:dom.window.localStorage});
  const track={id:'yt:abcdefghijk',video_id:'abcdefghijk',title:'Song',artist:'Artist',storage_path:null};
  assert.equal(setGuestLike(track,true),true);assert.equal(guestLikes().length,1);assert.equal(saveGuestSignal(track,'listen'),true);assert.equal(saveGuestSignal(track,'skip'),true);
  assert.deepEqual(guestSignals().map(s=>s.event_type),['skip','listen','like']);assert.equal(waveHistory().seeds.length,1);assert.equal(waveHistory().played.length,2);
  setGuestLike(track,false);assert.equal(guestLikes().length,0);assert.ok(!guestSignals().some(s=>s.event_type==='like'));dom.window.close();
});
