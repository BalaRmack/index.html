import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isVideoId, searchCatalog, trendingCatalog, type CatalogTrack } from '@/lib/catalog';
import { fallbackShelves, fallbackTracks } from '@/lib/fallback-tracks';
import { youtubeRadio, deezerRadio } from '@/lib/radio-sources';
import { cleanRecommendations, diverseRecommendations, recentlyPlayed, taste, type Signal } from '@/lib/recommendations';
export const dynamic = 'force-dynamic';
export async function GET(req:Request) {
  // Home must never wait for the slowest of many sequential mirrors or auth.
  if((new URL(req.url).searchParams.get('mode')||'home')!=='home') return handle(req);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([handle(req),new Promise<NextResponse>(resolve=>{timer=setTimeout(()=>resolve(NextResponse.json(fallbackShelves(),{headers:{'Cache-Control':'no-store'}})),3800)})]);
  } catch {return NextResponse.json(fallbackShelves(),{headers:{'Cache-Control':'no-store'}});}
  finally {if(timer)clearTimeout(timer);}
}
export async function POST(req:Request) {
  if(new URL(req.url).searchParams.get('mode')!=='wave')return NextResponse.json({error:'Invalid mode'},{status:400});
  try {
    const raw=await req.text();if(raw.length>350_000)return NextResponse.json({error:'История слишком большая.'},{status:413});
    const body=JSON.parse(raw);const valid=(items:unknown,limit:number):Signal[]=>Array.isArray(items)?items.slice(0,limit).flatMap((s:unknown)=>{
      if(!s||typeof s!=='object')return [];const v=s as Record<string,unknown>;
      if((v.video_id!==null&&(typeof v.video_id!=='string'||!isVideoId(v.video_id)))||typeof v.artist!=='string'||!v.artist.trim()||typeof v.title!=='string'||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at))||!['listen','complete','skip','like'].includes(String(v.event_type)))return [];
      return [{track_id:typeof v.video_id==='string'?`yt:${v.video_id}`:'guest',video_id:v.video_id as string|null,title:v.title.slice(0,300),artist:v.artist.slice(0,200),event_type:v.event_type as Signal['event_type'],created_at:v.created_at}];
    }):[];
    return await handle(req,{seeds:valid(body.seeds,10).filter(s=>s.event_type!=='skip'),played:valid(body.played,300).filter(s=>s.event_type!=='like'),skips:valid(body.skips,100).filter(s=>s.event_type==='skip'),seen:Array.isArray(body.seen)?body.seen.filter((x:unknown)=>typeof x==='string'&&isVideoId(x)).slice(-100):[]});
  } catch {return NextResponse.json({error:'Некорректный запрос волны.'},{status:400});}
}
const shuffled=<T,>(items:T[])=>{const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
async function handle(req:Request,guest?:{seeds:Signal[];played:Signal[];skips:Signal[];seen:string[]}) {
  const params=new URL(req.url).searchParams;const mode=params.get('mode')||'home';
  if(!['home','radio','wave'].includes(mode) || (mode==='wave'&&!guest))return NextResponse.json({error:'Invalid mode'},{status:400});
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
  const profile=taste([...signals,...liked,...(guest?.seeds||[]),...(guest?.skips||[])]),recent=recentlyPlayed([...daySignals,...(guest?.played||[])]),blocked=new Set([...profile.excluded,...recent.ids]);
  async function sources(id:string,name:string) {
    const [youtube,deezer]=await Promise.allSettled([id?youtubeRadio(id):Promise.reject(new Error('Нет видео')),name?deezerRadio(name):Promise.reject(new Error('Нет исполнителя'))]);
    const yt=youtube.status==='fulfilled'?youtube.value:[], dz=deezer.status==='fulfilled'?deezer.value:[];
    // Interleave providers rather than allowing one to monopolize the queue.
    const combined:CatalogTrack[]=[];for(let i=0;i<Math.max(yt.length,dz.length);i++){if(yt[i])combined.push(yt[i]);if(dz[i])combined.push(dz[i]);}
    return {tracks:combined,providers:[...(yt.length?['youtube-radio']:[]),...(dz.length?['deezer-related']:[])]};
  }
  if(mode==='wave' && guest) {
    const candidates=[...guest.seeds,...liked,...signals].filter(s=>s.artist&&['listen','complete','like'].includes(s.event_type));
    const distinct=candidates.filter((s,i)=>candidates.findIndex(x=>s.video_id?x.video_id===s.video_id:x.artist===s.artist)===i).slice(0,10);
    if(distinct.length) {
      const selected=distinct[Math.floor(Math.random()*distinct.length)];
      const result=await sources(selected.video_id||'',selected.artist);
      if(!result.providers.length)return NextResponse.json({error:'Источники похожих исполнителей временно недоступны. Попробуйте ещё раз.'},{status:503,headers:{'Cache-Control':'no-store'}});
      const tracks=diverseRecommendations(shuffled(result.tracks),blocked,[...guest.seen,...(selected.video_id?[selected.video_id]:[])],recent.recordings,'',20);
      return NextResponse.json({tracks,providers:result.providers,personalized:true,emptyReason:tracks.length?null:'Новых похожих треков пока не найдено.'},{headers:{'Cache-Control':'no-store'}});
    }
    // Cold start uses current regional charts, never labels the emergency selection as live.
    const popular=await Promise.race([Promise.all((['RU','US'] as const).map(async region=>{try{return (await trendingCatalog(region)).value}catch{return [] as CatalogTrack[]}})),new Promise<CatalogTrack[][]>(resolve=>setTimeout(()=>resolve([[],[]]),5000))]);
    const live=popular.flat();const tracks=diverseRecommendations(shuffled(live.length?live:fallbackTracks),blocked,guest.seen,recent.recordings,'',20);
    return NextResponse.json({tracks,providers:live.length?['trending']:['editorial-fallback'],personalized:false,editorialFallback:!live.length,emptyReason:tracks.length?null:'Новых популярных треков пока не найдено.'},{headers:{'Cache-Control':'no-store'}});
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
  if(!related.tracks.length&&!daily.length&&!trends.some(x=>x.tracks.length))return NextResponse.json(fallbackShelves(),{headers:{'Cache-Control':'no-store'}});
  const recentTracks=profile.recent.map(s=>({id:`yt:${s.video_id}`,video_id:s.video_id!,title:s.title,artist:s.artist,storage_path:null,source:'youtube' as const,thumbnail:`https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`,duration:0}));
  return NextResponse.json({similar:diverseRecommendations(related.tracks,blocked,top?.video_id?[top.video_id]:[],recent.recordings,'',12),recent:cleanRecommendations(recentTracks,profile.excluded).slice(0,12),daily:diverseRecommendations(daily,blocked,[],recent.recordings,'',12),trending:diverseRecommendations(trends.flatMap(x=>x.tracks),blocked,[],recent.recordings,'',16),trendingFallback:trends.some(x=>x.fallback),editorialFallback:false,similarUnavailable:!!top&&!related.providers.length,personalized:!!signals.length},{headers:{'Cache-Control':'no-store'}});
}
