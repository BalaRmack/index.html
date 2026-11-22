export type AlternativeSource = 'deezer'|'jiosaavn';
export type AlternativeTrack = {id:string;external_id:string;source:AlternativeSource;title:string;artist:string;storage_path:null;duration:number;thumbnail:string|null};
const mirrors=['https://saavn.dev','https://saavn.sumit.co','https://jio.shnwaz.dev'];
const asObj=(x:unknown):Record<string,any>=>x && typeof x==='object'?x as Record<string,any>:{};
const str=(x:unknown,max=300)=>typeof x==='string'?x.slice(0,max):'';
export function validExternalId(source:string,id:string) {return source==='deezer'?/^\d{1,20}$/.test(id):source==='jiosaavn'?/^[\w-]{1,32}$/.test(id):false;}
async function read(url:string) {
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
  if(!r.ok)throw new Error('Источник недоступен');const body=await r.text();if(body.length>2_000_000)throw new Error('Ответ слишком большой');const data=JSON.parse(body);if(data.error||data.success===false)throw new Error('Источник недоступен');return data;
}
async function saavn(path:string) {
  const attempts=mirrors.map(async base=>read(base+path));
  try{return await Promise.any(attempts);}catch{throw new Error('Зеркала JioSaavn недоступны');}
}
function safeImage(value:unknown) {
  try {const u=new URL(str(value,1000));if(u.protocol==='https:' && ['dzcdn.net','saavncdn.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return u.href;}catch{}return null;
}
export function normalizeAlternative(source:AlternativeSource,item:unknown):AlternativeTrack|null {
  const d=asObj(item),id=String(d.id||'');if(!validExternalId(source,id))return null;
  const title=str(d.title||d.name);if(!title)return null;
  const primary=asObj(d.artists).primary;
  const artist=source==='deezer'?str(asObj(d.artist).name,200):str((Array.isArray(primary)?primary.map((x:unknown)=>asObj(x).name).filter(Boolean).join(', '):'')||d.primaryArtists||d.singers,200);
  const image=source==='deezer'?asObj(d.album).cover_medium:(Array.isArray(d.image)?asObj(d.image.at(-1)).url:d.image);
  const rawDuration=Number(d.duration||0);
  return {id:`${source==='deezer'?'dz':'js'}:${id}`,external_id:id,source,title,artist:artist||'Unknown artist',storage_path:null,duration:source==='deezer'?30:Number.isFinite(rawDuration)?rawDuration:0,thumbnail:safeImage(image)};
}
export async function searchAlternative(source:AlternativeSource,query:string) {
  const data=source==='deezer'?await read(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20`):await saavn(`/api/search/songs?query=${encodeURIComponent(query)}&limit=20`);
  const list=source==='deezer'?data.data:data.data?.results;
  if(!Array.isArray(list))throw new Error('Неверный ответ источника');
  return list.map((x:unknown)=>normalizeAlternative(source,x)).filter(Boolean) as AlternativeTrack[];
}
function playableUrl(raw:unknown,allowed:string[]) {
  try {const u=new URL(str(raw,4000));if(u.protocol==='https:'&&!u.username&&!u.password&&allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return u.href;}catch{}return null;
}
export async function alternativeStream(source:AlternativeSource,id:string) {
  if(!validExternalId(source,id)) throw new Error('Invalid id');
  const data=source==='deezer'?await read(`https://api.deezer.com/track/${id}`):await saavn(`/api/songs/${id}`);
  if(source==='deezer') {const url=playableUrl(data.preview,['dzcdn.net']);if(!url)throw new Error('Превью недоступно');return url;}
  const song=Array.isArray(data.data)?data.data[0]:data.data;const options=asObj(song).downloadUrl;
  if(Array.isArray(options)) for(const opt of [...options].reverse()) {const url=playableUrl(asObj(opt).url,['saavncdn.com','jiosaavn.com']);if(url)return url;}
  throw new Error('Аудио недоступно на зеркалах JioSaavn');
}
