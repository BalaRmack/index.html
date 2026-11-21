'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { advanceListening, shouldRecordSkip } from '@/lib/listening';
import { ArrowLeft, ArrowRight, AudioLines, ChevronDown, Clock3, Heart, Home, Library, ListMusic, LogOut, Music2, Pause, Play, Plus, Radio, Repeat2, Search, Shuffle, SkipBack, SkipForward, Sparkles, Upload, Volume2, VolumeX, X } from 'lucide-react';

type Track = { id:string; title:string; artist:string; storage_path:string|null; owner_id?:string|null; source?:'local'|'youtube'; video_id?:string|null; thumbnail?:string|null; duration?:number };
type Playlist = { id:string; name:string };
type Shelves = {similar:Track[];recent:Track[];daily:Track[];trending:Track[];trendingFallback?:boolean};
const demo: Track = { id:'demo-outfoxing', title:'Outfoxing the Fox', artist:'Kevin MacLeod', storage_path:null };
const covers = [
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=500&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=500&q=80',
  'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=500&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=500&q=80',
];
const format = (s:number) => `${Math.floor((s || 0)/60)}:${String(Math.floor((s || 0)%60)).padStart(2,'0')}`;
const canonical = (id:string) => /^yt:[A-Za-z0-9_-]{11}:/.test(id) ? id.slice(0,14) : id;
const imageFor = (t:Track) => t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg` : t.id===demo.id ? covers[0] : covers[2];
const fromDb = (t:Track):Track => t.video_id ? {...t,id:`yt:${t.video_id}`,thumbnail:`https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg`} : t;
const unique = (ts:Track[]) => {const seen=new Set<string>();return ts.filter(t=>!seen.has(t.id)&&!!seen.add(t.id))};

export default function HomePage() {
  const [user,setUser] = useState<User|null>(null);
  const [tracks,setTracks] = useState<Track[]>([demo]);
  const [playlists,setPlaylists] = useState<Playlist[]>([]);
  const [likes,setLikes] = useState<string[]>([]);
  const [playlistIds,setPlaylistIds] = useState<string[]>([]);
  const [view,setView] = useState('home');
  const [search,setSearch] = useState('');
  const [results,setResults] = useState<Track[]>([]);
  const [searchStatus,setSearchStatus] = useState('');
  const [shelves,setShelves] = useState<Shelves>({similar:[],recent:[],daily:[],trending:[]});
  const [shelfStatus,setShelfStatus] = useState('Загружаем подборки…');
  const [refreshShelves,setRefreshShelves] = useState(0);
  const [current,setCurrent] = useState<Track>(demo);
  const [playing,setPlaying] = useState(false);
  const [loading,setLoading] = useState(false);
  const [elapsed,setElapsed] = useState(0);
  const [duration,setDuration] = useState(0);
  const [volume,setVolume] = useState(70);
  const [shuffle,setShuffle] = useState(false);
  const [repeat,setRepeat] = useState(false);
  const [authOpen,setAuthOpen] = useState(false);
  const [email,setEmail] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement|null>(null);
  const ctx = useRef<AudioContext|null>(null);
  const gain = useRef<GainNode|null>(null);
  const fileInput = useRef<HTMLInputElement|null>(null);
  const currentRef = useRef(current); currentRef.current = current;
  const volumeRef = useRef(volume); volumeRef.current = volume;
  const queue = useRef<Track[]>([demo]);
  const queueIndex = useRef(0);
  const playedIds = useRef<string[]>([]);
  const requestSeq = useRef(0);
  const excludedMirrors = useRef<string[]>([]);
  const retrying = useRef<number|null>(null);
  const radioRequest = useRef(false);
  const playback = useRef({seconds:0,last:0,completed:false,started:false});

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({data}) => setUser(data.user));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  },[]);
  useEffect(() => {
    if (!supabase || !user) { setTracks([demo]); setPlaylists([]); setLikes([]); return; }
    const db = supabase;
    Promise.all([db.from('tracks').select('*').order('created_at',{ascending:false}), db.from('playlists').select('id,name').order('created_at',{ascending:false}), db.from('likes').select('track_id')]).then(([t,p,l]) => {
      if (t.data) setTracks((t.data as Track[]).map(fromDb));
      if (p.data) setPlaylists(p.data as Playlist[]);
      if (l.data) setLikes(l.data.map(x => canonical(x.track_id)));
      if (t.error || p.error || l.error) setNotice('Не удалось загрузить библиотеку.');
    });
  },[user]);
  useEffect(() => {
    if (!supabase || !user || !view.startsWith('playlist:')) { setPlaylistIds([]); return; }
    supabase.from('playlist_tracks').select('track_id').eq('playlist_id',view.slice(9)).then(({data,error}) => { if (data) setPlaylistIds(data.map(x=>canonical(x.track_id))); if(error) setNotice(error.message); });
  },[view,user]);
  useEffect(() => {
    const query=search.trim(); if(query.length<2) {setResults([]);setSearchStatus(query?'Введите минимум 2 символа.':'');return;}
    const controller=new AbortController(); setSearchStatus('Ищем в каталоге…');
    const timer=setTimeout(()=>{void fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setResults(d.tracks);setSearchStatus(d.tracks.length?'':'Ничего не найдено.');}).catch(e=>{if(e.name!=='AbortError'){setResults([]);setSearchStatus('Каталог временно недоступен.')}})},400);
    return ()=>{clearTimeout(timer);controller.abort()};
  },[search]);
  useEffect(() => { setShelves({similar:[],recent:[],daily:[],trending:[]}); },[user?.id]);
  useEffect(() => {
    const controller=new AbortController();
    async function load() {
      setShelfStatus('Загружаем подборки…');
      const session=await supabase?.auth.getSession(); const token=session?.data.session?.access_token;
      try {const r=await fetch('/api/recommendations?mode=home',{headers:token?{Authorization:`Bearer ${token}`}:{},signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);setShelves(data);setShelfStatus(data.similar.length||data.recent.length||data.daily.length||data.trending.length?'':'Зеркала временно недоступны.');}
      catch(e){if((e as Error).name!=='AbortError')setShelfStatus('Не удалось загрузить подборки.');}
    }
    void load(); return ()=>controller.abort();
  },[user,refreshShelves]);
  useEffect(() => { if(gain.current) gain.current.gain.value = volume/100; if(audio.current && currentRef.current.video_id) audio.current.volume=volume/100; },[volume]);
  useEffect(() => () => { ++requestSeq.current; audio.current?.pause(); void ctx.current?.close(); },[]);

  async function authHeaders() {const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;return token?{Authorization:`Bearer ${token}`} : undefined;}
  async function logSignal(track:Track,event_type:'like'|'playlist_add'|'complete'|'skip',seconds=0) {
    if(!user || !supabase) return;
    const {error}=await supabase.from('listening_history').insert({user_id:user.id,track_id:track.id,video_id:track.video_id || null,title:track.title.slice(0,300),artist:track.artist.slice(0,200),event_type,listened_seconds:Math.max(0,Math.floor(seconds))});
    if(error) setNotice('Не удалось сохранить историю прослушивания.');
    else if(event_type!=='skip') setRefreshShelves(x=>x+1);
  }
  function recordSwitch() { const p=playback.current; if(shouldRecordSkip(p)) void logSignal(currentRef.current,'skip',p.seconds); }
  function onTime(time:number) {
    const p=playback.current; const player=audio.current; setElapsed(time);
    if(advanceListening(p,time,player?.duration || 0,!!player && !player.paused,!!player?.seeking)) void logSignal(currentRef.current,'complete',p.seconds);
  }
  function initAudio(remote:boolean) {
    const existing=audio.current;
    // A cross-origin media source routed through Web Audio is silent without CORS.
    // Remote media therefore uses native HTMLAudio; local audio keeps the Web Audio gain path.
    if(existing && Boolean(existing.dataset.remote)===remote) return existing;
    if(existing) {existing.pause();existing.removeAttribute('src');existing.load();}
    const player=new Audio(); player.preload='auto';
    if(remote) {player.dataset.remote='1';player.volume=volumeRef.current/100;}
    else {
      if(!ctx.current) ctx.current=new AudioContext();
      const source=ctx.current.createMediaElementSource(player); gain.current=ctx.current.createGain(); gain.current.gain.value=volumeRef.current/100;
      source.connect(gain.current).connect(ctx.current.destination);
    }
    audio.current=player; return player;
  }
  async function resolveAndPlay(track:Track,seq:number) {
    if(retrying.current===seq) return;
    retrying.current=seq;
    try {
      let lastError='Не удалось запустить трек.';
      while(seq===requestSeq.current && excludedMirrors.current.length<6) {
        const response=await fetch(`/api/catalog/stream?id=${track.video_id}&exclude=${encodeURIComponent(excludedMirrors.current.join(','))}`);
        const data=await response.json(); if(!response.ok) throw new Error(data.error || lastError);
        if(seq!==requestSeq.current) return;
        excludedMirrors.current.push(data.mirror);
        const player=audio.current!; player.src=data.url;
        try {await player.play(); if(seq!==requestSeq.current) return; playback.current.started=true;setPlaying(true);setLoading(false);return;}
        catch(e) {if((e as Error).name==='NotAllowedError') throw new Error('Браузер заблокировал воспроизведение. Нажмите Play ещё раз.');lastError='Поток недоступен, пробуем другое зеркало…';}
      }
      throw new Error(lastError);
    } finally { if(retrying.current===seq) retrying.current=null; }
  }
  async function playTrack(track:Track,list?:Track[],force=false) {
    let seq=requestSeq.current;
    try {
      const same=currentRef.current.id===track.id && audio.current?.src;
      if(same && !force && !loading) {
        if(audio.current!.paused) {if(ctx.current && !track.video_id) await ctx.current.resume();await audio.current!.play();playback.current.started=true;setPlaying(true);} else {audio.current!.pause();setPlaying(false);} return;
      }
      if(playback.current.started && currentRef.current.id!==track.id) recordSwitch();
      seq=++requestSeq.current; retrying.current=null;
      if(list) {queue.current=list;queueIndex.current=Math.max(0,list.findIndex(x=>x.id===track.id));playedIds.current=[];}
      if(track.video_id && !playedIds.current.includes(track.video_id)) playedIds.current.push(track.video_id);
      excludedMirrors.current=[]; playback.current={seconds:0,last:0,completed:false,started:false};
      setCurrent(track); currentRef.current=track; setElapsed(0);setDuration(0);setPlaying(false);setLoading(true);
      const player=initAudio(Boolean(track.video_id));player.pause();player.removeAttribute('src');player.load();
      if(track.video_id) await resolveAndPlay(track,seq);
      else {
        let url='/audio/outfoxing.mp3';
        if(track.storage_path) {if(!supabase) throw new Error('Supabase не настроен.');const {data,error}=await supabase.storage.from('audio').createSignedUrl(track.storage_path,3600);if(error||!data)throw new Error(error?.message || 'Не удалось открыть трек.');url=data.signedUrl;}
        if(seq!==requestSeq.current)return;player.src=url;await ctx.current?.resume();await player.play();if(seq!==requestSeq.current)return;playback.current.started=true;setPlaying(true);setLoading(false);
      }
    } catch(e) {if(seq===requestSeq.current){audio.current?.removeAttribute('src');setPlaying(false);setLoading(false);setNotice(e instanceof Error ? e.message : 'Ошибка воспроизведения.');}}
  }
  async function retryStream() {
    if(!currentRef.current.video_id || retrying.current!==null || !playback.current.started) return;
    setLoading(true);setPlaying(false);
    try {await resolveAndPlay(currentRef.current,requestSeq.current);} catch(e) {audio.current?.removeAttribute('src');setLoading(false);setNotice(e instanceof Error?e.message:'Нет доступных потоков.');}
  }
  async function moreRadio(seed:Track) {
    if(!seed.video_id) {setNotice('Радио доступно для треков из каталога.');return [];}
    const headers=await authHeaders();
    const p=new URLSearchParams({mode:'radio',seed:seed.video_id,artist:seed.artist,seen:playedIds.current.slice(-100).join(',')});
    const r=await fetch(`/api/recommendations?${p}`,{headers});const data=await r.json();if(!r.ok)throw new Error(data.error||'Не удалось загрузить радио.');if(data.fallback)setNotice('Похожие треки недоступны: используем поиск по исполнителю.');return data.tracks as Track[];
  }
  async function skip(direction:number,automatic=false) {
    if(!automatic) recordSwitch();
    const list=queue.current;
    let next=shuffle && direction>0 && list.length>1 ? Math.floor(Math.random()*(list.length-1)) : queueIndex.current+direction;
    if(shuffle && direction>0 && list.length>1 && next>=queueIndex.current)next++;
    if(next<0) next=0;
    if(next<list.length) {queueIndex.current=next;playback.current.started=false;void playTrack(list[next],undefined,true);return;}
    if(currentRef.current.video_id) {
      if(radioRequest.current) return; radioRequest.current=true; const seq=requestSeq.current; audio.current?.pause();playback.current.started=false;setPlaying(false);setLoading(true);
      try {const more=await moreRadio(currentRef.current);if(seq!==requestSeq.current)return;if(!more.length){setLoading(false);setPlaying(false);setNotice('Похожие треки не найдены. Попробуйте другое радио.');return;}queue.current=[...list,...more];queueIndex.current=list.length;playback.current.started=false;void playTrack(more[0],undefined,true);}
      catch(e){if(seq===requestSeq.current){setLoading(false);setPlaying(false);setNotice(e instanceof Error?e.message:'Радио недоступно.');}} finally {radioRequest.current=false;}
    } else {setPlaying(false);setNotice('Очередь закончилась.');}
  }
  async function startRadio(track:Track) {
    if(!track?.video_id){setNotice('Радио доступно для треков из каталога.');return;}
    // The seed starts immediately; its related tracks are fetched when the queue ends.
    void playTrack(track,[track],true);setNotice('Радио запущено: похожие треки добавятся автоматически.');
  }
  async function ensureSaved(track:Track) {
    if(!user || !supabase) throw new Error('Войдите, чтобы сохранить трек.');
    if(!track.video_id) return track.id;
    const id=`yt:${track.video_id}:${user.id}`;
    const {error}=await supabase.from('tracks').upsert({id,owner_id:user.id,title:track.title.slice(0,300),artist:track.artist.slice(0,200),storage_path:null,source:'youtube',video_id:track.video_id},{onConflict:'id'});
    if(error) throw error;
    setTracks(prev=>unique([track,...prev]));return id;
  }
  async function toggleLike(track:Track) {
    if (!user || !supabase) { setAuthOpen(true); return; }
    const exists=likes.includes(track.id);
    try {const id=await ensureSaved(track);const {error}=exists?await supabase.from('likes').delete().eq('user_id',user.id).eq('track_id',id):await supabase.from('likes').insert({user_id:user.id,track_id:id});if(error)throw error;setLikes(prev=>exists?prev.filter(x=>x!==track.id):[...prev,track.id]);if(!exists)void logSignal(track,'like');}
    catch(e){setNotice(e instanceof Error?e.message:'Не удалось сохранить лайк.');}
  }
  async function createPlaylist() {
    if (!user || !supabase) { setAuthOpen(true); return; }
    const name = window.prompt('Название плейлиста'); if (!name?.trim()) return;
    const {data,error} = await supabase.from('playlists').insert({name:name.trim(),owner_id:user.id}).select('id,name').single();
    if(error) setNotice(error.message); else { setPlaylists([data,...playlists]); setView(`playlist:${data.id}`); }
  }
  async function addToPlaylist(track:Track, id:string) {
    if(!supabase || !id) return;
    try {const saved=await ensureSaved(track);const {error}=await supabase.from('playlist_tracks').upsert({playlist_id:id,track_id:saved});if(error)throw error;setNotice('Добавлено в плейлист.');void logSignal(track,'playlist_add');if(view===`playlist:${id}`&&!playlistIds.includes(track.id))setPlaylistIds([...playlistIds,track.id]);}
    catch(e){setNotice(e instanceof Error?e.message:'Не удалось добавить трек.');}
  }
  async function upload(file:File) {
    if(!user || !supabase) { setAuthOpen(true); return; }
    if(file.size > 50*1024*1024) { setNotice('Выберите файл меньше 50 МБ.'); return; }
    setBusy(true);
    const id = crypto.randomUUID(); const path = `${user.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const {error:storageError} = await supabase.storage.from('audio').upload(path,file);
    if(storageError) { setNotice(storageError.message); setBusy(false); return; }
    const track = {id,owner_id:user.id,title:file.name.replace(/\.[^.]+$/,''),artist:'Your upload',storage_path:path};
    const {error} = await supabase.from('tracks').insert(track);
    if(error) { await supabase.storage.from('audio').remove([path]); setNotice(error.message); } else { setTracks([track,...tracks]); setNotice('Трек добавлен в библиотеку.'); setView('library'); }
    setBusy(false);
  }
  async function signIn(e:React.FormEvent) {
    e.preventDefault(); if(!supabase) { setNotice('Supabase не настроен.'); return; }
    setBusy(true); const {error} = await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}}); setBusy(false);
    if(error) setNotice(error.message); else {setAuthOpen(false);setNotice('Проверьте почту: мы отправили ссылку для входа.');}
  }
  const localVisible=tracks.filter(t => (view === 'liked' ? likes.includes(t.id) : view.startsWith('playlist:') ? playlistIds.includes(t.id) : true) && `${t.title} ${t.artist}`.toLowerCase().includes(search.toLowerCase()));
  const visible=search.trim().length>=2 ? unique([...localVisible,...results]) : localVisible;
  const isHome = view === 'home' && !search;
  const title = search ? 'Результаты поиска' : view === 'liked' ? 'Любимые треки' : view.startsWith('playlist:') ? playlists.find(p=>p.id===view.slice(9))?.name || 'Плейлист' : view === 'library' ? 'Ваша библиотека' : 'Ваша музыка';
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={()=>{setView('home');setSearch('')}}><span className="brand-icon"><AudioLines size={20}/></span><span>nocturne<span className="brand-dot">.</span></span></button>
      <div className="side-label">MENU</div>
      <nav className="nav"><button className={view==='home'?'active':''} onClick={()=>{setView('home');setSearch('')}}><Home size={19}/> Home</button><button onClick={()=>{setView('library');document.getElementById('search')?.focus()}}><Search size={19}/> Search</button><button className={view==='library'?'active':''} onClick={()=>{setView('library');setSearch('')}}><Library size={19}/> Your library</button></nav>
      <div className="side-label library-label">YOUR LIBRARY <button title="Create playlist" onClick={createPlaylist}><Plus size={17}/></button></div>
      <div className="library-links"><button onClick={()=>{setView('liked');setSearch('')}}><span className="side-cover liked-cover"><Heart size={17} fill="currentColor"/></span><span><b>Liked songs</b><small>Playlist · {likes.length} songs</small></span></button>{playlists.map(p=><button key={p.id} onClick={()=>{setView(`playlist:${p.id}`);setSearch('')}}><span className="side-cover playlist-cover"><Music2 size={17}/></span><span><b>{p.name}</b><small>Playlist · You</small></span></button>)}</div>
      <button className="create-playlist" onClick={createPlaylist}><span><Plus size={19}/></span> Create playlist</button>
      <div className="side-bottom"><div className="mini-note"><Sparkles size={16}/><span>GOOD MUSIC, GOOD MOOD</span></div><p>Made for the moments<br/>in between.</p><span className="side-footer">© 2026 NOCTURNE</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="history"><button aria-label="Back" onClick={()=>history.back()}><ArrowLeft size={18}/></button><button aria-label="Forward" onClick={()=>history.forward()}><ArrowRight size={18}/></button></div><div className="search-wrap"><Search size={17}/><input id="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Исполнитель или название трека"/><span>⌘ K</span></div><div className="top-actions"><button className="upload-button" onClick={()=>user?fileInput.current?.click():setAuthOpen(true)}><Upload size={16}/><span>{busy?'Uploading...':'Upload music'}</span></button><input ref={fileInput} type="file" accept="audio/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f) void upload(f);e.target.value=''}}/><button className="profile" onClick={()=>user?void supabase?.auth.signOut():setAuthOpen(true)}><span className="avatar">{user?.email?.[0].toUpperCase() || 'N'}</span><span>{user ? user.email?.split('@')[0] : 'Guest listener'}</span>{user?<LogOut size={15}/>:<ChevronDown size={15}/>}</button></div></header>
      <div className="content">
        {isHome && <><div className="greeting"><div><div className="eyebrow"><span className="green-dot"/> YOUR SOUND, YOUR SPACE</div><h1>Good to see you<span>.</span></h1><p>Find the soundtrack to your day.</p></div><span className="date-label">A LITTLE MORE ROOM FOR MUSIC <AudioLines size={16}/></span></div>
          <section className="hero"><div className="hero-content"><div className="hero-kicker"><Sparkles size={14}/> THE NOCTURNE EDIT <span>01 / 05</span></div><h2>Музыка для<br/><em>ваших моментов.</em></h2><p>Откройте музыку для каждого момента.<br/>Ваше радио становится лучше вместе с вами.</p><div className="hero-actions"><button className="primary" onClick={()=>void startRadio(shelves.similar[0] || shelves.recent[0] || shelves.daily[0] || shelves.trending[0])} disabled={![...shelves.similar,...shelves.recent,...shelves.daily,...shelves.trending].length}><Play size={15} fill="currentColor"/> Моя волна</button><button className="hero-link" onClick={()=>setView('library')}>Explore your library <ArrowRight size={16}/></button></div></div><div className="hero-caption"><span>CURATED FOR YOU</span><b>Find your<br/>kind of quiet.</b></div><div className="hero-index"><span className="selected"/> <span/> <span/> <span/></div></section>
          <div className="recommendations"><div className="recommendations-heading"><div><div className="eyebrow">МУЗЫКА ДЛЯ ВАС</div><h2>Откройте что-то новое <span>✳</span></h2></div><button onClick={()=>setRefreshShelves(x=>x+1)}>Обновить <ArrowRight size={15}/></button></div>{shelfStatus && <p className="catalog-status">{shelfStatus}</p>}
          <Shelf title="Похоже на ваши лайки" subtitle="На основе понравившихся треков" items={shelves.similar} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="Недавно слушали" subtitle="Треки, к которым хочется вернуться" items={shelves.recent} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="Микс дня" subtitle="По вашим любимым исполнителям" items={shelves.daily} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="В тренде" subtitle={shelves.trendingFallback?"Популярные поисковые запросы — тренды зеркал недоступны":"Российские и мировые подборки зеркал"} items={shelves.trending} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          {!user && <p className="catalog-status">Войдите, чтобы сохранять историю и получать персональные подборки.</p>}</div></>}
        <section className="section tracks-section"><div className="section-heading"><div><div className="eyebrow">{isHome?'PICK UP WHERE YOU LEFT OFF':'YOUR MUSIC, ALL IN ONE PLACE'}</div><h2>{title} <span>✳</span></h2><p>{search?'Поиск по вашей библиотеке и публичным каталогам.':isHome?'Ваши сохранённые треки.':'Ваша личная коллекция.'}</p></div>{isHome && <button onClick={()=>setView('library')}>See all <ArrowRight size={15}/></button>}</div><div className="track-head"><span>#</span><span>TITLE</span><span>ALBUM</span><span>ADDED</span><span><Clock3 size={15}/></span><span/></div><div className="track-list">{search && searchStatus && <div className="catalog-status">{searchStatus}</div>}{visible.length ? visible.map((t,i)=><div className={`track-row ${current.id===t.id&&playing?'is-playing':''}`} key={t.id}><button className="track-number" onClick={()=>void playTrack(t,visible)}>{current.id===t.id&&playing?<AudioLines size={16}/>:<><span>{String(i+1).padStart(2,'0')}</span><Play className="row-play" size={15} fill="currentColor"/></>}</button><button className="track-title" onClick={()=>void playTrack(t,visible)}><span className="track-art" style={{backgroundImage:`url('${imageFor(t)}')`}}/><span><b>{t.title}</b><small>{t.artist}</small></span></button><span className="track-album">{t.video_id?'Каталог':t.id===demo.id?'Демо':'Ваши файлы'}</span><span className="track-added">{t.video_id?'Стриминг':t.id===demo.id?'Демо':'Недавно'}</span><span className="track-time">{current.id===t.id&&duration?format(duration):t.duration?format(t.duration):'—'}</span><div className="track-controls">{t.video_id && <button title="Запустить радио по треку" aria-label={`Радио: ${t.title}`} onClick={()=>void startRadio(t)}><Radio size={16}/></button>}<button aria-label="Like track" onClick={()=>void toggleLike(t)} className={likes.includes(t.id)?'liked':''}><Heart size={16} fill={likes.includes(t.id)?'currentColor':'none'}/></button>{playlists.length>0 && <select aria-label="Add to playlist" value="" onChange={e=>void addToPlaylist(t,e.target.value)}><option value="">＋</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div></div>) : <div className="empty">No tracks here yet. {view==='liked'?'Like a song to save it here.':view.startsWith('playlist:')?'Add tracks using the + menu in your library.':'Try another search or upload your own music.'}</div>}</div></section>
        <footer>MADE FOR LISTENING <span>✳</span> STAY A WHILE</footer>
      </div>
    </main>
    <div className="player"><div className="now-playing"><div className="player-art" style={{backgroundImage:`url('${imageFor(current)}')`}}/><div><b>{current.title}</b><small>{current.artist}</small></div><button className={likes.includes(current.id)?'liked':''} onClick={()=>void toggleLike(current)} aria-label="Like current track"><Heart size={17} fill={likes.includes(current.id)?'currentColor':'none'}/></button></div><div className="player-center"><div className="player-buttons"><button className={shuffle?'on':''} onClick={()=>setShuffle(!shuffle)} aria-label="Shuffle"><Shuffle size={16}/></button><button onClick={()=>void skip(-1)} aria-label="Previous"><SkipBack size={18} fill="currentColor"/></button><button className="play-main" onClick={()=>void playTrack(current)} aria-label={playing?'Pause':'Play'}>{loading?<AudioLines size={19}/>:playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button onClick={()=>void skip(1)} aria-label="Next"><SkipForward size={18} fill="currentColor"/></button><button className={repeat?'on':''} onClick={()=>setRepeat(!repeat)} aria-label="Repeat"><Repeat2 size={17}/></button></div><div className="progress"><span>{format(elapsed)}</span><input aria-label="Seek" type="range" min="0" max={duration||0} value={Math.min(elapsed,duration||0)} onChange={e=>{if(audio.current) audio.current.currentTime=Number(e.target.value);playback.current.last=Number(e.target.value);setElapsed(Number(e.target.value))}} style={{'--progress':`${duration?elapsed/duration*100:0}%`} as React.CSSProperties}/><span>{format(duration)}</span></div></div><div className="player-right"><button title="Library" onClick={()=>setView('library')}><ListMusic size={18}/></button><button onClick={()=>setVolume(volume?0:70)} aria-label="Mute">{volume?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{'--progress':`${volume}%`} as React.CSSProperties}/><span>{volume}%</span></div></div>
    {/* Audio element events are attached once the browser creates the media element. */}
    <AudioEvents audio={audio} playing={playing} trackId={current.id} onTime={onTime} onDuration={setDuration} onEnded={()=>{setPlaying(false);if(repeat && audio.current){playback.current={seconds:0,last:0,completed:false,started:true};audio.current.currentTime=0;void audio.current.play().then(()=>setPlaying(true)).catch(()=>setNotice('Ошибка воспроизведения.'));}else void skip(1,true)}} onError={()=>{if(currentRef.current.video_id) void retryStream();else {setPlaying(false);setNotice('Не удалось загрузить аудио.');}}} />
    {notice && <div className="toast" role="status">{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {authOpen && <div className="modal-backdrop" onClick={()=>setAuthOpen(false)}><div className="modal" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setAuthOpen(false)}><X size={19}/></button><span className="brand-icon"><AudioLines size={22}/></span><h2>Your music, everywhere.</h2><p>Sign in to save your favorites, create playlists, and upload your own tracks.</p><form onSubmit={signIn}><label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/><button className="primary" disabled={busy}>{busy?'Sending...':'Send me a sign-in link'} <ArrowRight size={16}/></button></form><small>No password needed. We&apos;ll email you a magic link.</small></div></div>}
  </div>;
}

function AudioEvents({audio,playing,trackId,onTime,onDuration,onEnded,onError}:{audio:React.RefObject<HTMLAudioElement|null>;playing:boolean;trackId:string;onTime:(v:number)=>void;onDuration:(v:number)=>void;onEnded:()=>void;onError:()=>void}) {
  useEffect(()=>{const a=audio.current;if(!a)return;const time=()=>onTime(a.currentTime);const duration=()=>onDuration(Number.isFinite(a.duration)?a.duration:0);a.addEventListener('timeupdate',time);a.addEventListener('durationchange',duration);a.addEventListener('ended',onEnded);a.addEventListener('error',onError);return()=>{a.removeEventListener('timeupdate',time);a.removeEventListener('durationchange',duration);a.removeEventListener('ended',onEnded);a.removeEventListener('error',onError)}},[audio,playing,trackId,onTime,onDuration,onEnded,onError]);
  return null;
}

function Shelf({title,subtitle,items,onPlay,onRadio}:{title:string;subtitle:string;items:Track[];onPlay:(track:Track,list:Track[])=>void;onRadio:(track:Track)=>void}) {
  if(!items.length) return null;
  return <section className="shelf"><div className="section-heading"><div><h2>{title} <span>✳</span></h2><p>{subtitle}</p></div></div><div className="shelf-scroll">{items.map(t=><div className="catalog-card" key={t.id}><button className="catalog-card-main" onClick={()=>onPlay(t,items)}><span className="catalog-art" style={{backgroundImage:`url('${imageFor(t)}')`}}><span className="catalog-play"><Play size={17} fill="currentColor"/></span></span><b>{t.title}</b><small>{t.artist}</small></button><button className="radio-card" title="Запустить радио по треку" aria-label={`Радио: ${t.title}`} onClick={()=>onRadio(t)}><Radio size={15}/></button></div>)}</div></section>;
}
