import { isVideoId, searchCatalog, type CatalogTrack } from './catalog';

const obj=(v:unknown):Record<string,any>=>v && typeof v==='object'?v as Record<string,any>:{};
const text=(v:unknown):string=>typeof v==='string'?v:typeof obj(v).simpleText==='string'?obj(v).simpleText:Array.isArray(obj(v).runs)?obj(v).runs.map((x:unknown)=>obj(x).text||'').join(''):'';
const key=(s:string)=>s.toLocaleLowerCase().normalize('NFKC').replace(/\s*[-–—]\s*topic$/i,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function seconds(value:string) {const parts=value.split(':').map(Number);return parts.length<=3&&parts.every(Number.isFinite)?parts.reduce((a,b)=>a*60+b,0):0;}

/** Parse only radio playlist entries, not arbitrary videos from the page chrome. */
export function parseYoutubeRadio(payload:unknown):CatalogTrack[] {
  const found:CatalogTrack[]=[], ids=new Set<string>();let nodes=0;
  function walk(v:unknown,depth:number) {
    if(!v||typeof v!=='object'||depth>35||nodes++>40000||found.length>=80)return;
    if(Array.isArray(v)){for(const child of v)walk(child,depth+1);return;}
    const d=obj(v), panel=obj(d.playlistPanelVideoRenderer || d.playlistVideoRenderer);
    if(Object.keys(panel).length) {
      const id=String(panel.videoId||''),title=text(panel.title).slice(0,300),artist=text(panel.shortBylineText||panel.longBylineText).slice(0,200),length=text(panel.lengthText),duration=seconds(length);
      if(isVideoId(id)&&title&&artist&&!ids.has(id)&&!panel.isLive&&(!length||duration>0)&&duration<=1200){ids.add(id);found.push({id:`yt:${id}`,title,artist,video_id:id,source:'youtube',storage_path:null,thumbnail:`https://i.ytimg.com/vi/${id}/mqdefault.jpg`,duration});}
    }
    for(const child of Object.values(d))walk(child,depth+1);
  }
  walk(payload,0);return found;
}
async function readJson(url:string,options:RequestInit={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error(`Источник ответил ${response.status}`);
  if(Number(response.headers.get('content-length')||0)>2_000_000)throw new Error('Большой ответ источника');
  const raw=await response.text();if(raw.length>2_000_000)throw new Error('Большой ответ источника');
  const body=JSON.parse(raw);if(body.error)throw new Error('Ошибка источника');return body;
}
/** Unofficial, undocumented endpoint: availability and schema may change. */
export async function youtubeRadio(videoId:string) {
  if(!isVideoId(videoId))throw new Error('Invalid video id');
  const data=await readJson('https://www.youtube.com/youtubei/v1/next?prettyPrint=false',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({context:{client:{clientName:'WEB',clientVersion:'2.20241126.01.00',hl:'en',gl:'US'}},videoId,playlistId:`RD${videoId}`})});
  const tracks=parseYoutubeRadio(data);if(!tracks.length)throw new Error('YouTube не вернул радиомикс');return tracks;
}

/** Deezer supplies related-artist metadata; match each title to an actual YouTube result.
 * Never treat Deezer previews as full songs or blindly accept a wrong search match. */
export async function deezerRadio(artist:string) {
  const query=artist.replace(/\s*[-–—]\s*topic$/i,'').trim().slice(0,200);if(!query)throw new Error('Нет исполнителя');
  const search=await readJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=8`);
  const artists=Array.isArray(search.data)?search.data:[];
  const target=artists.map(obj).find((a:Record<string,any>)=>key(String(a.name||''))===key(query) && /^\d+$/.test(String(a.id||'')));
  if(!target)throw new Error('Исполнитель Deezer не найден');
  const related=await readJson(`https://api.deezer.com/artist/${target.id}/related?limit=6`);
  const similar=(Array.isArray(related.data)?related.data:[]).map(obj).filter((a:Record<string,any>)=>/^\d+$/.test(String(a.id||''))&&typeof a.name==='string').slice(0,6);
  if(!similar.length)throw new Error('Похожие исполнители Deezer недоступны');
  const songs=await Promise.all(similar.map(async (a:Record<string,any>)=>{
    try {const top=await readJson(`https://api.deezer.com/artist/${a.id}/top?limit=2`);const song=Array.isArray(top.data)?obj(top.data[0]):{};return typeof song.title==='string'?{title:song.title.slice(0,300),artist:a.name.slice(0,200)}:null;}catch{return null;}
  }));
  const matches=await Promise.all(songs.map(async song=>{
    if(!song)return null;try {
      const candidates=(await searchCatalog(`${song.artist} ${song.title}`)).value;
      const ak=key(song.artist),tk=key(song.title);
      return candidates.find(t=>{const artistKey=key(t.artist),titleKey=key(t.title);return (artistKey.includes(ak)||titleKey.includes(ak)) && (titleKey.includes(tk)||tk.includes(titleKey));}) || null;
    }catch{return null;}
  }));
  const result=matches.filter((x):x is CatalogTrack=>!!x);if(!result.length)throw new Error('Не найдены соответствующие треки YouTube');return result;
}
