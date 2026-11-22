import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack, normalizeList, firstMirror, resolveStream } from '../lib/catalog';
import { taste, cleanRecommendations, type Signal } from '../lib/recommendations';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});
const video={type:'stream',url:'/watch?v=abcdefghijk',title:'Песня',uploaderName:'Исполнитель',duration:180};
test('normalizes, deduplicates, excludes malformed and long results',()=>{
  assert.equal(normalizeTrack(video)?.id,'yt:abcdefghijk');
  assert.equal(normalizeTrack({...video,videoId:'abcdefghijkTOOLONG',url:'invalid'}) ,null);
  assert.equal(normalizeTrack({...video,duration:2000}),null);
  assert.equal(normalizeList({items:[video,video,{type:'playlist',title:'x'}]}).length,1);
});
test('falls through unavailable mirrors to a healthy one',async()=>{
  const requested:string[]=[];
  globalThis.fetch=(async (input:RequestInfo|URL)=>{const url=String(input);requested.push(url);return url.startsWith('https://inv.nadeko.net')?new Response(JSON.stringify([video]),{status:200}):new Response('{}',{status:503});}) as typeof fetch;
  const result=await firstMirror(()=>'/test', data=>Array.isArray(data)?data:null);
  assert.equal(result.mirror,'inv-nadeko');assert.ok(requested.length>=4);
});
test('stream resolution accepts audio and skips unhealthy mirrors',async()=>{
  globalThis.fetch=(async (input:RequestInfo|URL)=>String(input).includes('piped-api.privacy.com.de')?new Response(JSON.stringify({audioStreams:[{url:'https://test.googlevideo.com/a',mimeType:'audio/mp4',format:'M4A',bitrate:128000}]}),{status:200}):new Response('{}',{status:503})) as typeof fetch;
  const resolved=await resolveStream('abcdefghijk',[]);assert.equal(resolved.mirror,'piped-privacy');assert.equal(resolved.value.url,'https://test.googlevideo.com/a');
  await assert.rejects(()=>resolveStream('bad',[]));
});
test('taste uses positive signals, ranks artists, and removes repeated skips',()=>{
  const signal=(id:string,event_type:Signal['event_type'],artist='Artist'):Signal=>({track_id:`yt:${id}`,video_id:id,title:'Song',artist,event_type,created_at:'2026-01-01'});
  const profile=taste([signal('abcdefghijk','skip'),signal('abcdefghijk','skip'),signal('abcdefghijk','like','First'),signal('zyxwvutsrqp','complete','Second')]);
  assert.equal(profile.excluded.has('abcdefghijk'),true);assert.equal(profile.artists[0],'First');
  const tracks=[normalizeTrack(video)!,normalizeTrack({...video,url:'/watch?v=zyxwvutsrqp'})!];
  assert.deepEqual(cleanRecommendations(tracks,profile.excluded).map(t=>t.video_id),['zyxwvutsrqp']);
});

test('listening signals use played time, not seeks; completion only once',async()=>{
  const {advanceListening,shouldRecordSkip}=await import('../lib/listening');
  const state={seconds:0,last:0,completed:false,started:true};
  for(let t=1;t<=9;t++) assert.equal(advanceListening(state,t,100,true,false),false);
  assert.equal(shouldRecordSkip(state),true);
  advanceListening(state,90,100,true,true);assert.equal(state.seconds,9);
  for(let i=1;i<=62;i++) advanceListening(state,90+i,100,true,false);
  assert.equal(state.seconds,71);assert.equal(state.completed,true);assert.equal(shouldRecordSkip(state),false);
  assert.equal(advanceListening(state,153,100,true,false),false);
});
