import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isVideoId, relatedCatalog, searchCatalog, trendingCatalog, type CatalogTrack } from '@/lib/catalog';
import { cleanRecommendations, taste, type Signal } from '@/lib/recommendations';
export const dynamic = 'force-dynamic';
export async function GET(req:Request) {
  const params=new URL(req.url).searchParams; const mode=params.get('mode') || 'home';
  if(!['home','radio'].includes(mode)) return NextResponse.json({error:'Invalid mode'},{status:400});
  const seed=params.get('seed') || ''; const artist=(params.get('artist') || '').trim().slice(0,200); if(seed && !isVideoId(seed)) return NextResponse.json({error:'Invalid seed'},{status:400});
  const seen=(params.get('seen') || '').split(',').filter(isVideoId).slice(0,100);
  let signals:Signal[]=[]; let liked:Signal[]=[];
  const authorization=req.headers.get('authorization');
  if(authorization) {
    const token=authorization.match(/^Bearer (.+)$/)?.[1]; const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!token || !url || !key) return NextResponse.json({error:'Authentication unavailable'},{status:401});
    const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error}=await db.auth.getUser(token); if(error || !user) return NextResponse.json({error:'Unauthorized'},{status:401});
    const [history,likes]=await Promise.all([db.from('listening_history').select('track_id,video_id,title,artist,event_type,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(300),db.from('likes').select('created_at, tracks(id,title,artist,video_id)').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50)]);
    if(history.error || likes.error) return NextResponse.json({error:'Не удалось загрузить историю.'},{status:503});
    signals=(history.data || []) as Signal[];
    liked=(likes.data || []).flatMap(row=>{const t=Array.isArray(row.tracks)?row.tracks[0]:row.tracks;return t?.video_id?[{track_id:t.id,video_id:t.video_id,title:t.title,artist:t.artist,event_type:'like' as const,created_at:row.created_at}]:[]});
  }
  const profile=taste([...signals,...liked]); const blocked=profile.excluded;
  const getRelated=async(id:string)=>{try{return (await relatedCatalog(id)).value}catch{return [] as CatalogTrack[]}};
  if(mode==='radio') {
    const anchors=[seed,...profile.seeds].filter(isVideoId).slice(0,3);
    let results=(await Promise.all(anchors.map(getRelated))).flat();
    let fallback=false;
    if(!results.length && artist) {try { results=(await searchCatalog(`${artist} music`)).value; fallback=true; } catch {}}
    const tracks=cleanRecommendations(results,blocked,[...seen,...anchors]).slice(0,20);
    return NextResponse.json({tracks,fallback,emptyReason:tracks.length?null:'Не удалось найти похожие треки. Попробуйте другое радио.'},{headers:{'Cache-Control':'no-store'}});
  }
  const topLike=liked[0]?.video_id || signals.find(s=>s.event_type==='like'&&s.video_id)?.video_id;
  const [similar,daily,...trends]=await Promise.all([
    topLike ? getRelated(topLike).then(async tracks=>{if(tracks.length)return tracks;const a=liked[0]?.artist || signals.find(s=>s.event_type==='like'&&s.video_id===topLike)?.artist;try{return a?(await searchCatalog(`${a} music`)).value:[]}catch{return []}}) : Promise.resolve([]),
    profile.artists.length ? Promise.all(profile.artists.map(async a=>{try{return (await searchCatalog(`${a} music`)).value.slice(0,6)}catch{return [] as CatalogTrack[]}})).then(xs=>xs.flat()) : Promise.resolve([]),
    ...(['RU','US'] as const).map(async region=>{try{return {tracks:(await trendingCatalog(region)).value.slice(0,10),fallback:false}}catch{try{return {tracks:(await searchCatalog(region==='RU'?'популярная русская музыка':'popular music hits')).value.slice(0,10),fallback:true}}catch{return {tracks:[] as CatalogTrack[],fallback:true}}}}),
  ]);
  const recent=profile.recent.map(s=>({id:`yt:${s.video_id}`,video_id:s.video_id!,title:s.title,artist:s.artist,storage_path:null,source:'youtube' as const,thumbnail:`https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`,duration:0}));
  return NextResponse.json({similar:cleanRecommendations(similar,blocked,topLike?[topLike]:[]).slice(0,12),recent:cleanRecommendations(recent,blocked).slice(0,12),daily:cleanRecommendations(daily,blocked).slice(0,12),trending:cleanRecommendations(trends.flatMap(x=>x.tracks),blocked).slice(0,16),trendingFallback:trends.some(x=>x.fallback),personalized:!!signals.length},{headers:{'Cache-Control':'no-store'}});
}
