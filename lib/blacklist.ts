import { recordingKey, artistKey } from './recommendations';
export type Block = {kind:'track'|'artist';track_id:string;video_id:string|null;title:string;artist:string};
type TrackLike={id:string;video_id?:string|null;title:string;artist:string};
const KEY='nocturne.recommendation-blocks.v1';
export function blockForTrack(t:TrackLike):Block {return {kind:'track',track_id:t.id.replace(/^(yt|dz|js):([^:]+):.*/, '$1:$2'),video_id:t.video_id||null,title:t.title.slice(0,300),artist:t.artist.slice(0,200)};}
export function validBlocks(input:unknown):Block[] {
  if(!Array.isArray(input))return [];
  return input.flatMap((item:unknown)=>{if(!item||typeof item!=='object')return [];const v=item as Record<string,unknown>;
    if((v.kind!=='track'&&v.kind!=='artist')||typeof v.track_id!=='string'||!v.track_id||v.track_id.length>300||typeof v.title!=='string'||v.title.length>300||typeof v.artist!=='string'||v.artist.length>200||(v.video_id!==null&&(typeof v.video_id!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(v.video_id))))return [];
    return [{kind:v.kind,track_id:v.track_id,video_id:v.video_id as string|null,title:v.title,artist:v.artist}];});
}
export function mergeBlocks(...lists:Block[][]):Block[] {const map=new Map<string,Block>();for(const list of lists)for(const b of list)map.set(`${b.kind}:${b.track_id}`,b);return [...map.values()];}
export function readBlocks():Block[]{try{return validBlocks(JSON.parse(localStorage.getItem(KEY)||'[]'));}catch{return [];}}
export function writeBlocks(blocks:Block[]):boolean {try{localStorage.setItem(KEY,JSON.stringify(blocks));return true;}catch{return false;}}
export function isBlocked(t:TrackLike,blocks:Block[]):boolean {return blocks.some(b=>b.kind==='artist'?!!b.artist&&artistKey(b.artist)===artistKey(t.artist):b.track_id===t.id||(!!b.video_id&&b.video_id===t.video_id)||(!!b.artist&&!!b.title&&recordingKey(b.artist,b.title)===recordingKey(t.artist,t.title)));}
