import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../app/api/recommendations/route';
import {fallbackShelves} from '../lib/fallback-tracks';

test('home request returns labelled playable editorial cards if mirrors hang',async()=>{
  const original=globalThis.fetch;globalThis.fetch=(async()=>new Promise<Response>(()=>{})) as typeof fetch;
  try {
    const start=Date.now();const response=await GET(new Request('https://example.com/api/recommendations?mode=home'));
    const data=await response.json();assert.equal(response.status,200);assert.ok(Date.now()-start<5000);assert.equal(data.editorialFallback,true);assert.ok(data.trending.length>=4);assert.ok(data.trending.every((t:{video_id:string})=>/^[\w-]{11}$/.test(t.video_id)));
    assert.equal(data.trending[0].title,fallbackShelves().trending[0].title);
  } finally {globalThis.fetch=original;}
});
