export type Signal = {track_id:string;video_id:string|null;title:string;artist:string;event_type:'like'|'playlist_add'|'complete'|'skip'|'listen';created_at:string};
export function taste(signals:Signal[]) {
  const skips=new Map<string,number>(); const artists=new Map<string,number>(); const seeds:string[]=[]; const recent:Signal[]=[];
  for(const s of signals) {
    if(s.event_type==='skip' && s.video_id) skips.set(s.video_id,(skips.get(s.video_id)||0)+1);
    if(['like','playlist_add','complete'].includes(s.event_type)) {
      if(s.video_id && !seeds.includes(s.video_id)) seeds.push(s.video_id);
      if(s.artist && s.artist !== 'Unknown artist') artists.set(s.artist,(artists.get(s.artist)||0)+(s.event_type==='like'?3:s.event_type==='playlist_add'?2:1));
    }
    if(s.event_type==='complete' && s.video_id && !recent.some(x=>x.video_id===s.video_id)) recent.push(s);
  }
  return {excluded:new Set([...skips].filter(([,n])=>n>=2).map(([id])=>id)),seeds,artists:[...artists].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name])=>name),recent};
}
/** Принимают любые треки с id/артистом: YouTube-каталог, deezer-превью и редакционный резерв идут одной волной. */
export function cleanRecommendations<T extends {id:string;video_id?:string|null;title:string;artist:string}>(tracks:T[],excluded:Set<string>,seen:string[]=[]) {
  const ids=new Set(seen); return tracks.filter(t=>{const key=t.video_id||t.id;if(excluded.has(key)||ids.has(key))return false;ids.add(key);return true});
}

/** Signals such as likes are preferences, not evidence that a track was played. */
export function recentlyPlayed(signals:Signal[],now=Date.now()) {
  const cutoff=now-24*60*60*1000;const ids=new Set<string>();const recordings=new Set<string>();
  for(const s of signals) if(['listen','complete','skip'].includes(s.event_type) && Date.parse(s.created_at)>=cutoff) {
    if(s.video_id)ids.add(s.video_id);
    if(s.title&&s.artist)recordings.add(recordingKey(s.artist,s.title));
  }
  return {ids,recordings};
}
export const artistKey=(s:string)=>s.toLocaleLowerCase().normalize('NFKC').replace(/\s*[-–—]\s*topic$/i,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const recordingKey=(artist:string,title:string)=>`${artistKey(artist)}|${artistKey(title)}`;
/** Keep source order where possible; never place the same artist consecutively. */
export function diverseRecommendations<T extends {id:string;video_id?:string|null;title:string;artist:string}>(tracks:T[],blocked:Set<string>,seen:string[],recentRecordings:Set<string>,previousArtist='',limit=20) {
  const pool=cleanRecommendations(tracks,blocked,seen).filter(t=>!recentRecordings.has(recordingKey(t.artist,t.title)));
  const out:T[]=[];let last=artistKey(previousArtist);
  while(pool.length && out.length<limit) {
    const index=pool.findIndex(t=>artistKey(t.artist)!==last);
    if(index<0)break;
    const [track]=pool.splice(index,1);out.push(track);last=artistKey(track.artist);
  }
  return out;
}
