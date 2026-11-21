import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isVideoId, searchCatalog, trendingCatalog, type CatalogTrack } from '@/lib/catalog';
import { youtubeRadio, deezerRadio } from '@/lib/radio-sources';
import { cleanRecommendations, diverseRecommendations, recentlyPlayed, taste, type Signal } from '@/lib/recommendations';
export const dynamic = 'force-dynamic';
export async function GET(req:Request) {
  const params=new URL(req.url).searchParams;const mode=params.get('mode')||'home';
  if(!['home','radio'].includes(mode))return NextResponse.json({error:'Invalid mode'},{status:400});
  const seed=params.get('seed')||'';const artist=(params.get('artist')||'').trim().slice(0,200);
  if(seed&&!isVideoId(seed))return NextResponse.json({error:'Invalid seed'},{status:400});
  const seen=(params.get('seen')||'').split(',').filter(isVideoId).slice(0,100);
  let signals:Signal[]=[],liked:Signal[]=[],daySignals:Signal[]=[];
  const authorization=req.headers.get('authorization');
  if(authorization) {
    const token=authorization.match(/^Bearer (.+)$/)?.[1];const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!token||!url||!key)return NextResponse.json({error:'Authentication unavailable'},{status:401});
    const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error}=await db.auth.getUser(token);if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401});
    const since=new Date(Date.now()-24*60*60*1000).toISOString();
    const [history,likes,played]=await Promise.all([
      db.from('listening_history').select('track_id,video_id,title,artist,event_type,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(300),
      db.from('likes').select('created_at, tracks(id,title,artist,video_id)').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50),
      db.from('listening_history').select('track_id,video_id,title,artist,event_type,created_at').eq('user_id',user.id).gte('created_at',since).in('event_type',['listen','complete','skip']).order('created_at',{ascending:false}).limit(1000),
    ]);
    if(history.error||likes.error||played.error)return NextResponse.json({error:'Не удалось загрузить историю.'},{status:503});
    signals=(history.data||[]) as Signal[];daySignals=(played.data||[]) as Signal[];
    liked=(likes.data||[]).flatMap(row=>{const t=Array.isArray(row.tracks)?row.tracks[0]:row.tracks;return t?.video_id?[{track_id:t.id,video_id:t.video_id,title:t.title,artist:t.artist,event_type:'like' as const,created_at:row.created_at}]:[]});
  }
  const profile=taste([...signals,...liked]),recent=recentlyPlayed(daySignals),blocked=new Set([...profile.excluded,...recent.ids]);
  async function sources(id:string,name:string) {
    const [youtube,deezer]=await Promise.allSettled([id?youtubeRadio(id):Promise.reject(new Error('Нет видео')),name?deezerRadio(name):Promise.reject(new Error('Нет исполнителя'))]);
    const yt=youtube.status==='fulfilled'?youtube.value:[], dz=deezer.status==='fulfilled'?deezer.value:[];
    // Interleave providers rather than allowing one to monopolize the queue.
    const combined:CatalogTrack[]=[];for(let i=0;i<Math.max(yt.length,dz.length);i++){if(yt[i])combined.push(yt[i]);if(dz[i])combined.push(dz[i]);}
    return {tracks:combined,providers:[...(yt.length?['youtube-radio']:[]),...(dz.length?['deezer-related']:[])]};
  }
  if(mode==='radio') {
    if(!seed)return NextResponse.json({error:'Нужен трек для радио.'},{status:400});
    const result=await sources(seed,artist);if(!result.providers.length)return NextResponse.json({error:'Источники похожих треков временно недоступны. Попробуйте позже.'},{status:503,headers:{'Cache-Control':'no-store'}});
    const tracks=diverseRecommendations(result.tracks,blocked,[...seen,seed],recent.recordings,artist,20);
    return NextResponse.json({tracks,providers:result.providers,emptyReason:tracks.length?null:'Новых похожих треков пока не найдено.'},{headers:{'Cache-Control':'no-store'}});
  }
  const top=liked[0]||signals.find(s=>s.event_type==='like'&&s.video_id);
  const [related,daily,...trends]=await Promise.all([
    top?.video_id?sources(top.video_id,top.artist):Promise.resolve({tracks:[] as CatalogTrack[],providers:[] as string[]}),
    profile.artists.length?Promise.all(profile.artists.map(async a=>{try{return (await searchCatalog(`${a} music`)).value.slice(0,6)}catch{return [] as CatalogTrack[]}})).then(xs=>xs.flat()):Promise.resolve([]),
    ...(['RU','US'] as const).map(async region=>{try{return {tracks:(await trendingCatalog(region)).value.slice(0,10),fallback:false}}catch{try{return {tracks:(await searchCatalog(region==='RU'?'популярная русская музыка':'popular music hits')).value.slice(0,10),fallback:true}}catch{return {tracks:[] as CatalogTrack[],fallback:true}}}}),
  ]);
  const recentTracks=profile.recent.map(s=>({id:`yt:${s.video_id}`,video_id:s.video_id!,title:s.title,artist:s.artist,storage_path:null,source:'youtube' as const,thumbnail:`https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`,duration:0}));
  return NextResponse.json({similar:diverseRecommendations(related.tracks,blocked,top?.video_id?[top.video_id]:[],recent.recordings,'',12),recent:cleanRecommendations(recentTracks,profile.excluded).slice(0,12),daily:diverseRecommendations(daily,blocked,[],recent.recordings,'',12),trending:diverseRecommendations(trends.flatMap(x=>x.tracks),blocked,[],recent.recordings,'',16),trendingFallback:trends.some(x=>x.fallback),similarUnavailable:!!top&&!related.providers.length,personalized:!!signals.length},{headers:{'Cache-Control':'no-store'}});
}
