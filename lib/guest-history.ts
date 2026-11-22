import type { Signal } from './recommendations';

export type GuestTrack = {id:string; title:string; artist:string; storage_path:string|null; video_id?:string|null; source?:'local'|'youtube'|'deezer'|'jiosaavn'; external_id?:string|null; thumbnail?:string|null; duration?:number|null};
const KEY='nocturne.guest.v1';
type Store={signals:Signal[];likes:GuestTrack[]};
const empty=():Store=>({signals:[],likes:[]});
function read():Store {
  try {const value=JSON.parse(localStorage.getItem(KEY)||'null');return {signals:Array.isArray(value?.signals)?value.signals.filter((s:Signal)=>s&&typeof s==='object'&&typeof s.title==='string'&&typeof s.artist==='string'&&typeof s.created_at==='string'):[],likes:Array.isArray(value?.likes)?value.likes.filter((t:GuestTrack)=>t&&typeof t==='object'&&typeof t.id==='string'&&typeof t.title==='string'&&typeof t.artist==='string'):[]};} catch {return empty();}
}
function write(data:Store) {try {localStorage.setItem(KEY,JSON.stringify(data));return true;} catch {return false;}}
export function guestLikes(){return read().likes;}
export function guestSignals(){return read().signals;}
export function saveGuestSignal(track:GuestTrack,event_type:Signal['event_type']) {
  const data=read();data.signals.unshift({track_id:track.id,video_id:track.video_id||null,title:track.title.slice(0,300),artist:track.artist.slice(0,200),event_type,created_at:new Date().toISOString()});data.signals=data.signals.slice(0,500);return write(data);
}
export function setGuestLike(track:GuestTrack,liked:boolean) {
  const data=read();data.likes=data.likes.filter(t=>t.id!==track.id);data.signals=data.signals.filter(s=>!(s.track_id===track.id&&s.event_type==='like'));
  if(liked){data.likes.unshift(track);data.signals.unshift({track_id:track.id,video_id:track.video_id||null,title:track.title.slice(0,300),artist:track.artist.slice(0,200),event_type:'like',created_at:new Date().toISOString()});}
  data.likes=data.likes.slice(0,500);data.signals=data.signals.slice(0,500);return write(data);
}
/** Up to 10 positive seeds plus today's listens/skips, without putting history in URLs. */
export function waveHistory() {
  const data=read();const signals=data.signals;const seen=new Set<string>();const seeds:Signal[]=[];
  for(const s of signals) if(['listen','complete','like'].includes(s.event_type)&&(s.video_id||s.artist)&&!seen.has(s.video_id||s.artist)){seen.add(s.video_id||s.artist);seeds.push(s);if(seeds.length===10)break;}
  for(const track of data.likes) {const key=track.video_id||track.artist;if(seeds.length>=10)break;if(key&&!seen.has(key)){seen.add(key);seeds.push({track_id:track.id,video_id:track.video_id||null,title:track.title,artist:track.artist,event_type:'like',created_at:new Date().toISOString()});}}
  const cutoff=Date.now()-24*60*60*1000;const played=signals.filter(s=>['listen','complete','skip'].includes(s.event_type)&&Date.parse(s.created_at)>=cutoff).slice(0,300);
  return {seeds,played,skips:signals.filter(s=>s.event_type==='skip').slice(0,100)};
}
