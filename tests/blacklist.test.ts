import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {blockForTrack,isBlocked,mergeBlocks,readBlocks,writeBlocks} from '../lib/blacklist';
import {POST} from '../app/api/recommendations/route';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original});
const panel=(id:string,artist:string,title:string)=>({playlistPanelVideoRenderer:{videoId:id,title:{simpleText:title},shortBylineText:{simpleText:artist},lengthText:{simpleText:'3:20'}}});
const mix={contents:[panel('abcdefghijk','Seed','Seed song'),panel('bcdefghijkl','Blocked Artist','Blocked song'),panel('cdefghijklm','Third','New song'),panel('defghijklmn','Fourth','Another song')]};
const track={id:'yt:bcdefghijkl',video_id:'bcdefghijkl',title:'Blocked song',artist:'Blocked Artist'};
const request=(mode:string,body:unknown)=>new Request(`https://app.test/api/recommendations?mode=${mode}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('blocks persist locally, match alternate recording IDs, and merge without duplicates',()=>{
 const dom=new JSDOM('',{url:'https://example.com'});Object.assign(globalThis,{localStorage:dom.window.localStorage});
 const block=blockForTrack(track);assert.ok(writeBlocks([block]));assert.deepEqual(readBlocks(),[block]);assert.equal(mergeBlocks([block],[block]).length,1);
 assert.ok(isBlocked({...track,id:'yt:otherVideo1',video_id:'otherVideo1'},[block]));
 assert.ok(isBlocked({...track,title:'Different'},[{...block,kind:'artist'}]));dom.window.close();
});
test('wave filters blocked track and artist before returning recommendations',async()=>{
 globalThis.fetch=(async input=>{if(String(input).includes('youtubei'))return new Response(JSON.stringify(mix));throw Error('unavailable')}) as typeof fetch;
 const seed={track_id:'yt:abcdefghijk',video_id:'abcdefghijk',title:'Seed song',artist:'Seed',event_type:'like',created_at:new Date().toISOString()};
 const response=await POST(request('wave',{seeds:[seed],blocks:[blockForTrack(track),{...blockForTrack(track),kind:'artist',track_id:'artist:fourth',artist:'Fourth'}]}));
 const body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.tracks.map((t:{video_id:string})=>t.video_id),['cdefghijklm']);
});
test('home timeout/fallback excludes blocks and invalid blocks are not silently ignored',async()=>{
 globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;
 const entry=blockForTrack({id:'yt:djV11Xbc914',video_id:'djV11Xbc914',title:'Take On Me',artist:'a-ha'});
 const res=await POST(request('home',{blocks:[entry]}));const body=await res.json();assert.equal(body.editorialFallback,true);assert.ok(!body.trending.some((t:{video_id:string})=>t.video_id===entry.video_id));
 const invalid=await POST(request('wave',{blocks:[{kind:'track'}]}));assert.equal(invalid.status,400);
});
test('radio filters guest blocks before returning its queue',async()=>{
 globalThis.fetch=(async input=>{if(String(input).includes('youtubei'))return new Response(JSON.stringify(mix));throw Error('unavailable')}) as typeof fetch;
 const req=new Request('https://app.test/api/recommendations?mode=radio&seed=abcdefghijk&artist=Seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({blocks:[blockForTrack(track)]})});
 const response=await POST(req);const data=await response.json();assert.equal(response.status,200);assert.ok(data.tracks.every((t:{video_id:string})=>t.video_id!==track.video_id));
});
