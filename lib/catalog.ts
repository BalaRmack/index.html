/** Public mirrors are untrusted external services. Never accept a mirror URL from a client. */
export type CatalogTrack = { id:string; title:string; artist:string; storage_path:null; source:'youtube'; video_id:string; thumbnail:string|null; duration:number };
type Mirror = { id:string; kind:'piped'|'invidious'; origin:string };
export const MIRRORS: Mirror[] = [
  {id:'piped-kavin',kind:'piped',origin:'https://pipedapi.kavin.rocks'},
  {id:'piped-privacy',kind:'piped',origin:'https://piped-api.privacy.com.de'},
  {id:'piped-private',kind:'piped',origin:'https://api.piped.private.coffee'},
  {id:'inv-nadeko',kind:'invidious',origin:'https://inv.nadeko.net'},
  {id:'inv-nerdvpn',kind:'invidious',origin:'https://invidious.nerdvpn.de'},
  {id:'inv-tiekoetter',kind:'invidious',origin:'https://invidious.tiekoetter.com'},
];
const validId = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id:string) => validId.test(id);
const obj = (value:unknown):Record<string,any> => value && typeof value === 'object' ? value as Record<string,any> : {};
function text(value:unknown,max:number) { return typeof value === 'string' ? value.slice(0,max) : ''; }
export function normalizeTrack(input:unknown):CatalogTrack|null {
  const item = obj(input);
  if (item.type && !['stream','video'].includes(item.type)) return null;
  let id = typeof item.videoId === 'string' ? item.videoId : '';
  if (!isVideoId(id)) { try { id = new URL(item.url, 'https://youtube.com').searchParams.get('v') || ''; } catch { return null; } }
  if (!isVideoId(id) || item.liveNow || item.isShort || item.duration === -1) return null;
  const title = text(item.title,300); if(!title) return null;
  const duration = Number(item.duration ?? item.lengthSeconds ?? 0);
  if (duration > 1200) return null; // avoid long mixes and non-music videos
  // Stable thumbnail URL, rather than untrusted third-party HTML or stream URLs.
  return {id:`yt:${id}`,title,artist:text(item.uploaderName || item.author || item.uploader,200) || 'Unknown artist',storage_path:null,source:'youtube',video_id:id,thumbnail:`https://i.ytimg.com/vi/${id}/mqdefault.jpg`,duration:Number.isFinite(duration) && duration > 0 ? duration : 0};
}
export function normalizeList(value:unknown):CatalogTrack[] {
  const items = Array.isArray(value) ? value : obj(value).items;
  if(!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.map(normalizeTrack).filter((track):track is CatalogTrack => !!track && !seen.has(track.id) && !!seen.add(track.id)).slice(0,30);
}
/** Two waves of three mirrors, each bounded by a timeout. First usable response wins. */
export async function firstMirror<T>(path:(m:Mirror)=>string, parse:(payload:unknown,m:Mirror)=>T|null, exclude:string[] = [], prefer?:Mirror['kind']):Promise<{value:T;mirror:string}> {
  const choices = MIRRORS.filter(m=>!exclude.includes(m.id)).sort((a,b)=>prefer ? Number(b.kind===prefer)-Number(a.kind===prefer) : 0);
  for(let i=0;i<choices.length;i+=3) {
    const controllers = choices.slice(i,i+3).map(()=>new AbortController());
    try {
      const value = await Promise.any(choices.slice(i,i+3).map(async (m,j)=>{
        const timer = setTimeout(()=>controllers[j].abort(),4000);
        try {
          const response = await fetch(m.origin+path(m),{signal:controllers[j].signal,redirect:'error',headers:{accept:'application/json'},cache:'no-store'});
          if(!response.ok) throw new Error('Mirror unavailable');
          const length = Number(response.headers.get('content-length') || 0);
          if (length > 2_000_000) throw new Error('Response too large');
          const raw = await response.text(); if(raw.length > 2_000_000) throw new Error('Response too large');
          const parsed = parse(JSON.parse(raw),m); if(parsed === null) throw new Error('Empty or invalid response');
          return {value:parsed,mirror:m.id};
        } finally { clearTimeout(timer); }
      }));
      controllers.forEach(c=>c.abort()); return value;
    } catch { controllers.forEach(c=>c.abort()); }
  }
  throw new Error('Все зеркала каталога недоступны. Попробуйте позже.');
}
export async function searchCatalog(query:string) {
  return firstMirror(m => m.kind==='piped' ? `/search?q=${encodeURIComponent(query)}&filter=music_songs` : `/api/v1/search?q=${encodeURIComponent(query)}&type=video`, data => {const tracks=normalizeList(data);return tracks.length?tracks:null});
}
export async function trendingCatalog(region:'RU'|'US') {
  return firstMirror(m=>m.kind==='piped' ? `/trending?region=${region}` : `/api/v1/trending?type=music&region=${region}`,data=>{const tracks=normalizeList(data);return tracks.length?tracks:null},[], 'invidious');
}
export async function relatedCatalog(id:string) {
  if(!isVideoId(id)) throw new Error('Invalid video ID');
  return firstMirror(m=>m.kind==='piped' ? `/streams/${id}` : `/api/v1/videos/${id}`,data=>{const d=obj(data); const tracks=normalizeList(d.relatedStreams ?? d.recommendedVideos);return tracks.length?tracks:null});
}
function allowedStream(url:URL) {
  const hosts=['googlevideo.com','youtube.com','kavin.rocks','privacy.com.de','private.coffee','nadeko.net','nerdvpn.de','tiekoetter.com'];
  return url.protocol==='https:' && !url.username && !url.password && hosts.some(host=>url.hostname===host || url.hostname.endsWith(`.${host}`));
}
export async function resolveStream(id:string,exclude:string[]) {
  if(!isVideoId(id)) throw new Error('Invalid video ID');
  return firstMirror(m=>m.kind==='piped' ? `/streams/${id}` : `/api/v1/videos/${id}`,data=>{
    const d=obj(data); if(d.livestream || d.liveNow) return null;
    const candidates:unknown[] = Array.isArray(d.audioStreams) ? d.audioStreams : Array.isArray(d.adaptiveFormats) ? d.adaptiveFormats.filter((x:unknown)=>text(obj(x).type,100).startsWith('audio/')) : [];
    const streams=candidates.map(obj).filter(x=>typeof x.url==='string' && ((typeof x.mimeType==='string' && x.mimeType.startsWith('audio/')) || (typeof x.type==='string' && x.type.startsWith('audio/')) || x.audioTrackId || x.format || x.itag));
    // Prefer broadly supported AAC/M4A for Safari and mobile, then Opus/WebM.
    streams.sort((a,b)=> Number(/mp4|m4a/i.test(String(b.mimeType || b.type || b.format))) - Number(/mp4|m4a/i.test(String(a.mimeType || a.type || a.format))) || Number(b.bitrate||0)-Number(a.bitrate||0));
    for(const s of streams) { try { const url=new URL(s.url); if(allowedStream(url)) return {url:url.href}; } catch {} }
    return null;
  },exclude);
}
