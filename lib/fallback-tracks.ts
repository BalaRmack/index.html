/** Editorial fallback, not a personalised chart. Video availability varies by region. */
export const fallbackTracks = [
  ['djV11Xbc914','Take On Me','a-ha',244],
  ['FTQbiNvZqaY','Africa','Toto',272],
  ['xtxjm7ciwmc','Группа крови','Группа КИНО',285],
  ['Ao81ziiXHhs','Sweater Weather','The Neighbourhood',241],
  ['lSDfCdycdvk','Zombie','The Cranberries',308],
  ['qeMFqkcPYcg','Sweet Dreams (Are Made of This)','Eurythmics',215],
  ['ihOxsYme6pk','Полковнику никто не пишет','Би-2',293],
  ['hpSrLjc5SMs','Wonderwall','Oasis',259],
].map(([id,title,artist,duration])=>({id:`yt:${id}`,video_id:String(id),title:String(title),artist:String(artist),duration:Number(duration),source:'youtube' as const,storage_path:null,thumbnail:`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}));
export function fallbackShelves() {return {similar:[],recent:[],daily:[],trending:fallbackTracks,trendingFallback:true,editorialFallback:true};}
