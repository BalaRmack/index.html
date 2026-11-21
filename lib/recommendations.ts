import type { CatalogTrack } from './catalog';
export type Signal = {track_id:string;video_id:string|null;title:string;artist:string;event_type:'like'|'playlist_add'|'complete'|'skip';created_at:string};
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
export function cleanRecommendations(tracks:CatalogTrack[],excluded:Set<string>,seen:string[]=[]) {
  const ids=new Set(seen); return tracks.filter(t=>{if(excluded.has(t.video_id)||ids.has(t.video_id))return false;ids.add(t.video_id);return true});
}
