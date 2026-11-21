import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parseYoutubeRadio,youtubeRadio,deezerRadio} from '../lib/radio-sources';
import {diverseRecommendations,recentlyPlayed,type Signal} from '../lib/recommendations';
import {GET} from '../app/api/recommendations/route';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original});
const panel=(id:string,artist:string,title='Song')=>({playlistPanelVideoRenderer:{videoId:id,title:{simpleText:title},shortBylineText:{runs:[{text:artist}]},lengthText:{simpleText:'3:30'}}});
const yt={contents:{playlist:{items:[panel('abcdefghijk','Artist A'),panel('bcdefghijkl','Artist B'),panel('cdefghijklm','Artist B'),panel('defghijklmn','Artist C')]}}};
test('extracts valid playlist videos, ignores unrelated videos and malformed entries',()=>{
  const items=parseYoutubeRadio({...yt,unrelated:{compactVideoRenderer:{videoId:'efghijklmno',title:'unrelated'}},bad:panel('bad','No')});
  assert.equal(items.length,4);assert.equal(items[0].duration,210);assert.equal(items[1].artist,'Artist B');
});
test('requests the radio mix for the selected video',async()=>{
  globalThis.fetch=(async (url:RequestInfo|URL,options?:RequestInit)=>{assert.equal(String(url),'https://www.youtube.com/youtubei/v1/next?prettyPrint=false');const body=JSON.parse(String(options?.body));assert.equal(body.playlistId,'RDabcdefghijk');return new Response(JSON.stringify(yt));}) as typeof fetch;
  assert.equal((await youtubeRadio('abcdefghijk')).length,4);
});
test('Deezer related artists are matched to actual YouTube tracks, not previews',async()=>{
  globalThis.fetch=(async (input:RequestInfo|URL)=>{const url=String(input);
    if(url.includes('/search/artist'))return new Response(JSON.stringify({data:[{id:12,name:'Artist A'}]}));
    if(url.includes('/artist/12/related'))return new Response(JSON.stringify({data:[{id:99,name:'Artist B'},{id:98,name:'Artist C'}]}));
    if(url.includes('/artist/99/top'))return new Response(JSON.stringify({data:[{title:'Song B'}]}));
    if(url.includes('/artist/98/top'))return new Response(JSON.stringify({data:[{title:'Song C'}]}));
    if(url.includes('/search?')) {const isB=url.includes('Song%20B');return new Response(JSON.stringify({items:[{type:'stream',url:`/watch?v=${isB?'bcdefghijkl':'defghijklmn'}`,title:isB?'Song B':'Song C',uploaderName:isB?'Artist B':'Artist C',duration:200}]}));}
    throw new Error(url);
  }) as typeof fetch;
  const results=await deezerRadio('Artist A - Topic');assert.deepEqual(results.map(t=>t.artist),['Artist B','Artist C']);assert.ok(results.every(t=>t.source==='youtube'));
});
test('last day of listening is excluded but likes and older listens are not; artists alternate',()=>{
  const now=Date.parse('2026-11-21T12:00:00Z');
  const signal=(id:string,event:Signal['event_type'],time:string):Signal=>({video_id:id,track_id:`yt:${id}`,title:'Song',artist:'Artist B',event_type:event,created_at:time});
  const recent=recentlyPlayed([signal('bcdefghijkl','listen','2026-11-21T11:00:00Z'),signal('cdefghijklm','like','2026-11-21T11:00:00Z'),signal('defghijklmn','listen','2026-11-20T11:00:00Z')],now);
  assert.deepEqual([...recent.ids],['bcdefghijkl']);
  const tracks=parseYoutubeRadio(yt);const picked=diverseRecommendations(tracks,new Set(recent.ids),['abcdefghijk'],new Set(),'Artist A');
  assert.deepEqual(picked.map(t=>t.artist),['Artist B','Artist C']);
});
test('radio route returns a diverse queue and reports unavailable sources rather than single-artist fallback',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify(yt))) as typeof fetch;
  const response=await GET(new Request('https://app.test/api/recommendations?mode=radio&seed=abcdefghijk&artist='));
  assert.equal(response.status,200);const json=await response.json();assert.deepEqual(json.providers,['youtube-radio']);assert.deepEqual(json.tracks.map((x:{artist:string})=>x.artist),['Artist B','Artist C','Artist B']);
  globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;
  const failed=await GET(new Request('https://app.test/api/recommendations?mode=radio&seed=abcdefghijk'));
  assert.equal(failed.status,503);
});
