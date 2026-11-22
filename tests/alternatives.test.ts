import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAlternative,validExternalId,alternativeStream,searchAlternative} from '../lib/alternatives';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original});
test('normalizes Deezer previews and validates identifiers',()=>{
  const track=normalizeAlternative('deezer',{id:123,title:'Song',artist:{name:'Artist'},album:{cover_medium:'https://cdn-images.dzcdn.net/cover.jpg'}})!;
  assert.equal(track.id,'dz:123');assert.equal(track.duration,30);assert.equal(track.artist,'Artist');assert.equal(validExternalId('deezer','../bad'),false);
});
test('Deezer stream lookup trusts only Deezer CDN',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify({preview:'https://cdnt-preview.dzcdn.net/test.mp3'}))) as typeof fetch;
  assert.equal(await alternativeStream('deezer','123'),'https://cdnt-preview.dzcdn.net/test.mp3');
  globalThis.fetch=(async()=>new Response(JSON.stringify({preview:'https://evil.test/test.mp3'}))) as typeof fetch;
  await assert.rejects(()=>alternativeStream('deezer','123'));
});
test('Saavn uses valid mirrors and normalizes a result',async()=>{
  globalThis.fetch=(async()=>new Response(JSON.stringify({success:true,data:{results:[{id:'abcdef12',name:'Song',artists:{primary:[{name:'Artist'}]},duration:125}]}}))) as typeof fetch;
  const tracks=await searchAlternative('jiosaavn','song');assert.equal(tracks[0].id,'js:abcdef12');assert.equal(tracks[0].artist,'Artist');
});
