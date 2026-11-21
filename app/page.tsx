'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { blockForTrack, isBlocked, mergeBlocks, readBlocks, validBlocks, writeBlocks, type Block } from '@/lib/blacklist';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import YouTubePlayer, { type YouTubePlayerHandle } from '@/components/YouTubePlayer';
import { fallbackShelves } from '@/lib/fallback-tracks';
import { advanceListening, shouldRecordSkip } from '@/lib/listening';
import { guestLikes, saveGuestSignal, setGuestLike, waveHistory } from '@/lib/guest-history';
import { ArrowLeft, ArrowRight, AudioLines, Ban, ChevronDown, Clock3, Heart, Home, Library, ListMusic, LogOut, Music2, Pause, Play, Plus, Radio, Repeat2, Search, Shuffle, SkipBack, SkipForward, Upload, Volume2, VolumeX, X } from 'lucide-react';

type Track = { id:string; title:string; artist:string; storage_path:string|null; owner_id?:string|null; source?:'local'|'youtube'|'deezer'|'jiosaavn'; video_id?:string|null; external_id?:string|null; thumbnail?:string|null; duration?:number };
type Playlist = { id:string; name:string };
type Shelves = {similar:Track[];recent:Track[];daily:Track[];trending:Track[];trendingFallback?:boolean;similarUnavailable?:boolean;editorialFallback?:boolean};
const spring = {type:'spring' as const,stiffness:350,damping:30};
const demo: Track = { id:'demo-outfoxing', title:'Outfoxing the Fox', artist:'Kevin MacLeod', storage_path:null };
const format = (s:number) => `${Math.floor((s || 0)/60)}:${String(Math.floor((s || 0)%60)).padStart(2,'0')}`;
const canonical = (id:string) => /^(yt|dz|js):[A-Za-z0-9_-]+:/.test(id) ? id.split(':').slice(0,2).join(':') : id;
const imageFor = (t:Track) => t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg` : t.thumbnail || '/images/hero.png';
const fromDb = (t:Track):Track => t.video_id ? {...t,id:`yt:${t.video_id}`,thumbnail:`https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg`} : t.external_id ? {...t,id:`${t.source==='deezer'?'dz':'js'}:${t.external_id}`} : t;
const displayArtist = (artist:string) => artist === 'Unknown artist' ? 'Неизвестный исполнитель' : artist === 'Your upload' ? 'Ваша загрузка' : artist;
const unique = (ts:Track[]) => {const seen=new Set<string>();return ts.filter(t=>!seen.has(t.id)&&!!seen.add(t.id))};

export default function HomePage() {
  const reducedMotion=useReducedMotion();
  const [user,setUser] = useState<User|null>(null);
  const [tracks,setTracks] = useState<Track[]>([demo]);
  const [playlists,setPlaylists] = useState<Playlist[]>([]);
  const [likes,setLikes] = useState<string[]>([]);
  const [playlistIds,setPlaylistIds] = useState<string[]>([]);
  const [view,setView] = useState('home');
  const [search,setSearch] = useState('');
  const [searchSource,setSearchSource] = useState<'youtube'|'deezer'|'jiosaavn'>('youtube');
  const [soundcloudUrl,setSoundcloudUrl] = useState<string|null>(null);
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
  const [waveLoading,setWaveLoading] = useState(false);
  const [blocks,setBlocks] = useState<Block[]>([]);
  const [blocksReady,setBlocksReady] = useState(false);
  const blocksRef=useRef<Block[]>([]);
  const [lastBlocked,setLastBlocked]=useState<Block|null>(null);
  const blockWrite=useRef<Promise<unknown>|null>(null);
  const [playlistOpen,setPlaylistOpen]=useState(false);
  const [playlistName,setPlaylistName]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const audio = useRef<HTMLAudioElement|null>(null);
  const yt = useRef<YouTubePlayerHandle|null>(null);
  const [youtubeActive,setYoutubeActive] = useState(false);
  const ctx = useRef<AudioContext|null>(null);
  const gain = useRef<GainNode|null>(null);
  const fileInput = useRef<HTMLInputElement|null>(null);
  const currentRef = useRef(current); currentRef.current = current;
  const volumeRef = useRef(volume); volumeRef.current = volume;
  const queue = useRef<Track[]>([demo]);
  const queueIndex = useRef(0);
  const playedIds = useRef<string[]>([]);
  const requestSeq = useRef(0);
  const radioRequest = useRef(false);
  const waveMode = useRef(false);
  const playback = useRef({seconds:0,last:0,completed:false,started:false});
  const listenRecorded = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({data}) => setUser(data.user));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    let cancelled=false;const local=readBlocks();blocksRef.current=local;setBlocks(local);setBlocksReady(!user);
    async function loadBlocks(){
      if(!user||!supabase)return;
      const rows:Block[]=[];
      for(let start=0;;start+=1000){const result=await supabase!.from('recommendation_blocks').select('kind,track_id,video_id,title,artist').eq('user_id',user!.id).order('kind').order('track_id').range(start,start+999);
        if(cancelled)return;if(result.error){setNotice('Не удалось загрузить чёрный список. Рекомендации скрыты.');return;}
        const batch=validBlocks(result.data);if(batch.length!==result.data.length){setNotice('Не удалось загрузить чёрный список. Рекомендации скрыты.');return;}rows.push(...batch);if(result.data.length<1000)break;}
      const merged=mergeBlocks(blocksRef.current,rows);blocksRef.current=merged;setBlocks(merged);setBlocksReady(true);
    }
    void loadBlocks();return()=>{cancelled=true;};
  },[user]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true);}else if(e.key==='Escape'){setSearchOpen(false);setPlaylistOpen(false);setAuthOpen(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(() => {
    if (!supabase || !user) { const saved=guestLikes();setTracks(unique([...saved,demo])); setPlaylists([]); setLikes(saved.map(t=>t.id)); return; }
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
    const path=searchSource==='youtube'?`/api/catalog/search?q=${encodeURIComponent(query)}`:`/api/catalog/alternative/search?source=${searchSource}&q=${encodeURIComponent(query)}`;
    const timer=setTimeout(()=>{void fetch(path,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setResults(d.tracks);setSearchStatus(d.tracks.length?'':'Ничего не найдено.');}).catch(e=>{if(e.name!=='AbortError'){setResults([]);setSearchStatus('Каталог временно недоступен.')}})},400);
    return ()=>{clearTimeout(timer);controller.abort()};
  },[search,searchSource]);
  useEffect(() => { setShelves({similar:[],recent:[],daily:[],trending:[]}); },[user?.id]);
  useEffect(() => {
    const controller=new AbortController();let disposed=false;
    setShelfStatus('Загружаем подборки…');
    const timer=setTimeout(()=>{if(!disposed){controller.abort();setShelves(fallbackShelves());setShelfStatus('');}},5000);
    async function load() {
      try {
        const session=await supabase?.auth.getSession();if(controller.signal.aborted)return;
        const token=session?.data.session?.access_token;
        const r=await fetch('/api/recommendations?mode=home',{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},body:JSON.stringify({blocks:blocksRef.current}),signal:controller.signal});
        const data=await r.json();if(!r.ok)throw new Error(data.error);
        if(disposed||controller.signal.aborted)return;
        if(![data.similar,data.recent,data.daily,data.trending].some(Array.isArray))throw new Error('Invalid shelves');
        const hasTracks=[data.similar,data.recent,data.daily,data.trending].some((x:unknown)=>Array.isArray(x)&&x.length);
        setShelves(hasTracks?{...data,similar:Array.isArray(data.similar)?data.similar:[],recent:Array.isArray(data.recent)?data.recent:[],daily:Array.isArray(data.daily)?data.daily:[],trending:Array.isArray(data.trending)?data.trending:[]}:fallbackShelves());setShelfStatus('');clearTimeout(timer);
      } catch {if(!disposed&&!controller.signal.aborted){clearTimeout(timer);setShelves(fallbackShelves());setShelfStatus('');}}
    }
    void load(); return ()=>{disposed=true;clearTimeout(timer);controller.abort();};
  },[user,refreshShelves]);
  useEffect(() => {if(youtubeActive)yt.current?.cue(!shuffle?queue.current[queueIndex.current+1]?.video_id||null:null);},[shuffle,youtubeActive]);
  useEffect(() => { if(gain.current) gain.current.gain.value = volume/100; if(audio.current?.dataset.remote) audio.current.volume=volume/100; yt.current?.volume(volume); },[volume]);
  useEffect(() => () => { ++requestSeq.current; audio.current?.pause(); void ctx.current?.close(); },[]);

  async function authHeaders() {const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;return token?{Authorization:`Bearer ${token}`} : undefined;}
  async function logSignal(track:Track,event_type:'like'|'playlist_add'|'complete'|'skip'|'listen',seconds=0) {
    if(!user || !supabase) {if(!saveGuestSignal(track,event_type))setNotice('Не удалось сохранить историю в браузере.');return;}
    const {error}=await supabase.from('listening_history').insert({user_id:user.id,track_id:track.id,video_id:track.video_id || null,title:track.title.slice(0,300),artist:track.artist.slice(0,200),event_type,listened_seconds:Math.max(0,Math.floor(seconds))});
    if(error) setNotice('Не удалось сохранить историю прослушивания.');
    else if(event_type!=='skip' && event_type!=='listen') setRefreshShelves(x=>x+1);
  }
  function recordSwitch() { const p=playback.current; if(shouldRecordSkip(p)) void logSignal(currentRef.current,'skip',p.seconds); }
  function recordListen() {if(!listenRecorded.current && playback.current.seconds>=5){listenRecorded.current=true;void logSignal(currentRef.current,'listen',playback.current.seconds);}}
  function onTime(time:number) {
    const p=playback.current; const player=audio.current; setElapsed(time);
    if(advanceListening(p,time,player?.duration || 0,!!player && !player.paused,!!player?.seeking)) void logSignal(currentRef.current,'complete',p.seconds);recordListen();
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
  async function playTrack(track:Track,list?:Track[],force=false) {
    let seq=requestSeq.current;
    try {
      if(track.video_id && currentRef.current.id===track.id && youtubeActive && !force && !soundcloudUrl) {if(playing)yt.current?.pause();else yt.current?.play();return;}
      const same=!soundcloudUrl && !track.video_id && currentRef.current.id===track.id && audio.current?.src;
      if(same && !force && !loading) {
        if(audio.current!.paused) {if(ctx.current && !track.video_id) await ctx.current.resume();await audio.current!.play();playback.current.started=true;setPlaying(true);} else {audio.current!.pause();setPlaying(false);} return;
      }
      if(playback.current.started && currentRef.current.id!==track.id) recordSwitch();
      seq=++requestSeq.current; if(!track.video_id)yt.current?.stop(); audio.current?.pause();setSoundcloudUrl(null);
      if(list) {waveMode.current=false;queue.current=list;queueIndex.current=Math.max(0,list.findIndex(x=>x.id===track.id));playedIds.current=[];}
      if(track.video_id && !playedIds.current.includes(track.video_id)) playedIds.current.push(track.video_id);
      playback.current={seconds:0,last:0,completed:false,started:false};listenRecorded.current=false;
      setCurrent(track); currentRef.current=track; setElapsed(0);setDuration(0);setPlaying(false);setLoading(true);
      if(track.video_id) { setYoutubeActive(true);yt.current?.load(track.video_id);yt.current?.cue(!shuffle?queue.current[queueIndex.current+1]?.video_id||null:null);return; }
      setYoutubeActive(false);
      const remote=Boolean(track.external_id);const player=initAudio(remote);player.pause();player.removeAttribute('src');player.load();
      {
        let url='/audio/outfoxing.mp3';
        if(track.external_id && (track.source==='deezer'||track.source==='jiosaavn')) {const response=await fetch(`/api/catalog/alternative/stream?source=${track.source}&id=${encodeURIComponent(track.external_id)}`);const data=await response.json();if(!response.ok)throw new Error(data.error || 'Аудио недоступно.');url=data.url;}
        if(track.storage_path) {if(!supabase) throw new Error('Supabase не настроен.');const {data,error}=await supabase.storage.from('audio').createSignedUrl(track.storage_path,3600);if(error||!data)throw new Error(error?.message || 'Не удалось открыть трек.');url=data.signedUrl;}
        if(seq!==requestSeq.current)return;player.src=url;if(!remote)await ctx.current?.resume();await player.play();if(seq!==requestSeq.current)return;playback.current.started=true;setPlaying(true);setLoading(false);
      }
    } catch(e) {if(seq===requestSeq.current){audio.current?.removeAttribute('src');setPlaying(false);setLoading(false);setNotice(e instanceof Error ? e.message : 'Ошибка воспроизведения.');}}
  }
  async function moreRadio(seed:Track) {
    if(!seed.video_id) {setNotice('Радио доступно для треков из каталога.');return [];}
    const headers=await authHeaders();
    const p=new URLSearchParams({mode:'radio',seed:seed.video_id,artist:seed.artist,seen:playedIds.current.slice(-100).join(',')});
    const r=await fetch(`/api/recommendations?${p}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({blocks:blocksRef.current})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Не удалось загрузить радио.');return (data.tracks as Track[]).filter(t=>!isBlocked(t,blocksRef.current));
  }
  async function moreWave() {
    const headers=await authHeaders();const body={...waveHistory(),blocks:blocksRef.current,seen:playedIds.current.slice(-100)};
    const response=await fetch('/api/recommendations?mode=wave',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить волну.');
    if(!Array.isArray(data.tracks))throw new Error('Некорректный ответ волны.');
    return {...data,tracks:data.tracks.filter((t:Track)=>!isBlocked(t,blocksRef.current))} as {tracks:Track[];editorialFallback?:boolean;emptyReason?:string};
  }
  async function startWave() {
    if(waveLoading)return;if(!blocksReady){setNotice('Чёрный список ещё не загружен.');return;}
    const seq=++requestSeq.current;setWaveLoading(true);setNotice('Подбираем музыку для волны…');
    try {const result=await moreWave();if(seq!==requestSeq.current)return;if(!result.tracks.length)throw new Error(result.emptyReason||'Новых треков для волны пока не найдено.');
      void playTrack(result.tracks[0],result.tracks,true);waveMode.current=true;
      setNotice(result.editorialFallback?'Популярные источники недоступны: включена перемешанная резервная подборка.':'Моя волна запущена.');
    } catch(e){if(seq===requestSeq.current)setNotice(e instanceof Error?e.message:'Не удалось запустить волну.');} finally {setWaveLoading(false);}
  }
  async function skip(direction:number,automatic=false) {
    if(!automatic) recordSwitch();
    const currentItem=queue.current[queueIndex.current];
    const list=queue.current.filter(t=>t===currentItem||!isBlocked(t,blocksRef.current));
    queue.current=list;queueIndex.current=Math.max(0,list.indexOf(currentItem));
    let next=shuffle && !waveMode.current && direction>0 && list.length>1 ? Math.floor(Math.random()*(list.length-1)) : queueIndex.current+direction;
    if(shuffle && !waveMode.current && direction>0 && list.length>1 && next>=queueIndex.current)next++;
    if(next<0) next=0;
    if(next===queueIndex.current && isBlocked(list[next],blocksRef.current))next=list.length;
    if(next<list.length) {queueIndex.current=next;playback.current.started=false;void playTrack(list[next],undefined,true);return;}
    if(currentRef.current.video_id) {
      if(!blocksReady){setNotice('Чёрный список ещё не загружен.');return;}
      if(radioRequest.current) return; radioRequest.current=true; const seq=requestSeq.current; audio.current?.pause();yt.current?.pause();playback.current.started=false;setPlaying(false);setLoading(true);
      try {const result=waveMode.current?await moreWave():{tracks:await moreRadio(currentRef.current)};const more=result.tracks;if(seq!==requestSeq.current)return;if(!more.length){setLoading(false);setPlaying(false);setNotice('Похожие треки не найдены. Попробуйте другое радио.');return;}queue.current=[...list,...more];queueIndex.current=list.length;playback.current.started=false;void playTrack(more[0],undefined,true);}
      catch(e){if(seq===requestSeq.current){setLoading(false);setPlaying(false);setNotice(e instanceof Error?e.message:'Радио недоступно.');}} finally {radioRequest.current=false;}
    } else {setPlaying(false);setNotice('Очередь закончилась.');}
  }
  const mediaActions = useRef({play:()=>{},pause:()=>{},nexttrack:()=>{},previoustrack:()=>{}});
  mediaActions.current={
    play:()=>{if(soundcloudUrl)return;if(currentRef.current.video_id && youtubeActive)yt.current?.play();else if(!playing)void playTrack(currentRef.current);},
    pause:()=>{if(soundcloudUrl)return;if(currentRef.current.video_id && youtubeActive)yt.current?.pause();else {audio.current?.pause();setPlaying(false);}},
    nexttrack:()=>{if(!soundcloudUrl)void skip(1);},
    previoustrack:()=>{if(!soundcloudUrl)void skip(-1);},
  };
  useEffect(()=>{
    if(!('mediaSession' in navigator))return;
    const session=navigator.mediaSession;
    const actions=['play','pause','nexttrack','previoustrack'] as const;
    for(const action of actions) {try {session.setActionHandler(action,()=>mediaActions.current[action]());} catch { /* Not every browser supports every action. */ }}
    return ()=>{for(const action of actions)try {session.setActionHandler(action,null);} catch {} session.metadata=null;try {session.playbackState='none';} catch {}};
  },[]);
  useEffect(()=>{
    if(!('mediaSession' in navigator))return;
    const session=navigator.mediaSession;
    if(soundcloudUrl){session.metadata=null;try {session.playbackState='none';} catch {} return;}
    if(typeof MediaMetadata!=='undefined')session.metadata=new MediaMetadata({title:current.title,artist:current.artist,artwork:[{src:imageFor(current)}]});
    try {session.playbackState=playing?'playing':'paused';} catch {}
  },[current,playing,soundcloudUrl]);
  async function startRadio(track:Track) {
    if(!track?.video_id){setNotice('Радио доступно для треков из каталога.');return;}
    // The seed starts immediately; its related tracks are fetched when the queue ends.
    if(isBlocked(track,blocksRef.current)){setNotice('Этот трек исключён из рекомендаций.');return;}void playTrack(track,[track],true);setNotice('Радио запущено: похожие треки добавятся автоматически.');
  }
  async function blockTrack(track:Track) {
    if(!blocksReady){setNotice('Чёрный список ещё не загружен.');return;}
    const entry=blockForTrack(track);if(isBlocked(track,blocksRef.current))return;
    const next=mergeBlocks(blocksRef.current,[entry]);blocksRef.current=next;setBlocks(next);
    const localSaved=writeBlocks(mergeBlocks(readBlocks(),[entry]));setLastBlocked(entry);
    setNotice(localSaved?'Трек исключён из рекомендаций.':'Трек исключён, но не сохранён в браузере.');
    if(currentRef.current.id===track.id && (playing||loading))void skip(1);
    if(user&&supabase){const write=Promise.resolve(supabase.from('recommendation_blocks').upsert({...entry,user_id:user.id},{onConflict:'user_id,kind,track_id'}));blockWrite.current=write;const {error}=await write;if(blockWrite.current===write)blockWrite.current=null;if(error)setNotice('Не удалось сохранить блокировку в аккаунте; она действует только в этом браузере.');}
  }
  async function undoBlock() {
    const entry=lastBlocked;if(!entry)return;
    if(blockWrite.current)await blockWrite.current;
    if(user&&supabase){const {error}=await supabase.from('recommendation_blocks').delete().eq('user_id',user.id).eq('kind',entry.kind).eq('track_id',entry.track_id);if(error){setNotice('Не удалось отменить блокировку в аккаунте.');return;}}
    const remaining=blocksRef.current.filter(x=>!(x.kind===entry.kind&&x.track_id===entry.track_id));blocksRef.current=remaining;setBlocks(remaining);writeBlocks(readBlocks().filter(x=>!(x.kind===entry.kind&&x.track_id===entry.track_id)));setLastBlocked(null);setNotice('Блокировка отменена.');setRefreshShelves(x=>x+1);
  }
  async function ensureSaved(track:Track) {
    if(!user || !supabase) throw new Error('Войдите, чтобы сохранить трек.');
    if(!track.video_id && !track.external_id) return track.id;
    const prefix=track.video_id?'yt':track.source==='deezer'?'dz':'js';
    const id=`${prefix}:${track.video_id || track.external_id}:${user.id}`;
    const {error}=await supabase.from('tracks').upsert({id,owner_id:user.id,title:track.title.slice(0,300),artist:track.artist.slice(0,200),storage_path:null,source:track.video_id?'youtube':track.source,video_id:track.video_id||null,external_id:track.external_id||null},{onConflict:'id'});
    if(error) throw error;
    setTracks(prev=>unique([track,...prev]));return id;
  }
  async function toggleLike(track:Track) {
    const exists=likes.includes(track.id);
    if (!user || !supabase) {if(!setGuestLike(track,!exists)){setNotice('Не удалось сохранить лайк в браузере.');return;}setLikes(prev=>exists?prev.filter(x=>x!==track.id):[...prev,track.id]);setTracks(prev=>exists?prev:unique([track,...prev]));return;}
    try {const id=await ensureSaved(track);const {error}=exists?await supabase.from('likes').delete().eq('user_id',user.id).eq('track_id',id):await supabase.from('likes').insert({user_id:user.id,track_id:id});if(error)throw error;setLikes(prev=>exists?prev.filter(x=>x!==track.id):[...prev,track.id]);if(!exists)void logSignal(track,'like');}
    catch(e){setNotice(e instanceof Error?e.message:'Не удалось сохранить лайк.');}
  }
  function createPlaylist() {if (!user || !supabase) {setAuthOpen(true);return;}setPlaylistName('');setPlaylistOpen(true);}
  async function savePlaylist(e:React.FormEvent) {
    e.preventDefault();if(!user||!supabase||!playlistName.trim())return;
    const {data,error}=await supabase.from('playlists').insert({name:playlistName.trim(),owner_id:user.id}).select('id,name').single();
    if(error)setNotice(error.message);else {setPlaylists(prev=>[data,...prev]);setPlaylistOpen(false);setView(`playlist:${data.id}`);}
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
    const track = {id,owner_id:user.id,title:file.name.replace(/\.[^.]+$/,''),artist:'Ваша загрузка',storage_path:path};
    const {error} = await supabase.from('tracks').insert(track);
    if(error) { await supabase.storage.from('audio').remove([path]); setNotice(error.message); } else { setTracks([track,...tracks]); setNotice('Трек добавлен в библиотеку.'); setView('library'); }
    setBusy(false);
  }
  async function signIn(e:React.FormEvent) {
    e.preventDefault(); if(!supabase) { setNotice('Supabase не настроен.'); return; }
    setBusy(true); const {error} = await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}}); setBusy(false);
    if(error) setNotice(error.message); else {setAuthOpen(false);setNotice('Проверьте почту: мы отправили ссылку для входа.');}
  }
  function openSoundcloud() {
    const input=window.prompt('Вставьте ссылку на публичный трек SoundCloud');if(!input)return;
    try {const u=new URL(input);if(u.protocol!=='https:'||!['soundcloud.com','www.soundcloud.com'].includes(u.hostname)||u.username||u.password||u.pathname.split('/').filter(Boolean).length<2)throw new Error();
      if(playback.current.started)recordSwitch();++requestSeq.current;yt.current?.stop();audio.current?.pause();setYoutubeActive(false);setPlaying(false);setLoading(false);setSoundcloudUrl(`https://soundcloud.com${u.pathname}`);
    } catch {setNotice('Нужна ссылка https://soundcloud.com/исполнитель/трек');}
  }
  const localVisible=tracks.filter(t => (view === 'liked' ? likes.includes(t.id) : view.startsWith('playlist:') ? playlistIds.includes(t.id) : true) && `${t.title} ${t.artist}`.toLowerCase().includes(search.toLowerCase()));
  const visible=search.trim().length>=2 ? unique([...localVisible,...results]) : localVisible;
  const isHome = view === 'home' && !search;
  const shelfItems=(items:Track[])=>blocksReady?items.filter(t=>!isBlocked(t,blocks)):[];
  const navView=search||view==='search'?'search':view==='home'?'home':view==='library'?'library':'';
  const title = search ? 'Результаты поиска' : view === 'liked' ? 'Любимые треки' : view.startsWith('playlist:') ? playlists.find(p=>p.id===view.slice(9))?.name || 'Плейлист' : view === 'library' ? 'Ваша библиотека' : 'Ваша музыка';
  return <MotionConfig reducedMotion="user" transition={spring}><div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={()=>{setView('home');setSearch('')}}><span className="brand-icon"><AudioLines size={20}/></span><span>nocturne<span className="brand-dot">.</span></span></button>
      <div className="side-label">Навигация</div>
      <nav className="nav">{([
        {id:'home',label:'Главная',Icon:Home,action:()=>{setView('home');setSearch('')}},
        {id:'search',label:'Поиск',Icon:Search,action:()=>{setView('search');document.getElementById('search')?.focus()}},
        {id:'library',label:'Медиатека',Icon:Library,action:()=>{setView('library');setSearch('')}},
      ] as const).map(({id,label,Icon,action})=><button key={id} aria-label={label} title={label} className={navView===id?'active':''} onClick={action}>{navView===id&&<motion.span layoutId="activeNavIndicator" className="nav-indicator" transition={spring}/>}<Icon size={19}/><span className="nav-text">{label}</span></button>)}</nav>
      <div className="side-label library-label">Медиатека <button title="Создать плейлист" aria-label="Создать плейлист" onClick={createPlaylist}><Plus size={17}/></button></div>
      <div className="library-links"><button onClick={()=>{setView('liked');setSearch('')}}><span className="side-cover liked-cover"><Heart size={17} fill="currentColor"/></span><span><b>Любимые треки</b><small>Треков: {likes.length}</small></span></button>{playlists.map(p=><button key={p.id} onClick={()=>{setView(`playlist:${p.id}`);setSearch('')}}><span className="side-cover playlist-cover"><Music2 size={17}/></span><span><b>{p.name}</b><small>Ваш плейлист</small></span></button>)}</div>
      <button className="create-playlist" onClick={createPlaylist}><span><Plus size={19}/></span> Создать плейлист</button>
      <div className="side-bottom"><span className="side-footer">Nocturne · музыка рядом</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="history"><button aria-label="Назад" onClick={()=>history.back()}><ArrowLeft size={18}/></button><button aria-label="Вперёд" onClick={()=>history.forward()}><ArrowRight size={18}/></button></div><div className="search-wrap"><Search size={17}/><input id="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Исполнитель или трек" aria-label="Поиск музыки"/></div><div className="top-actions"><button className="upload-button" onClick={()=>user?fileInput.current?.click():setAuthOpen(true)}><Upload size={16}/><span>{busy?'Загружаем…':'Загрузить музыку'}</span></button><input ref={fileInput} type="file" accept="audio/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f) void upload(f);e.target.value=''}}/><button className="profile" aria-label={user?'Выйти из аккаунта':'Войти'} onClick={()=>user?void supabase?.auth.signOut():setAuthOpen(true)}><span className="avatar">{user?.email?.[0].toUpperCase() || 'N'}</span><span>{user ? user.email?.split('@')[0] : 'Гость'}</span>{user?<LogOut size={15}/>:<ChevronDown size={15}/>}</button></div></header>
    <YouTubePlayer ref={yt} volume={volume} onProgress={(time,d)=>{setElapsed(time);setDuration(d);if(advanceListening(playback.current,time,d,true,false))void logSignal(currentRef.current,'complete',playback.current.seconds);recordListen();}} onState={state=>{if(state==='playing'){playback.current.started=true;setPlaying(true);setLoading(false);}else if(state==='paused'){setPlaying(false);setLoading(false);}else {setPlaying(false);if(repeat){playback.current={seconds:0,last:0,completed:false,started:true};listenRecorded.current=false;yt.current?.seek(0);yt.current?.play();}else void skip(1,true);}}} onError={message=>{setLoading(false);setPlaying(false);setNotice(message);}} />
      <AnimatePresence mode="wait" initial={false}><motion.div className="content" key={navView==='search'?'search':view} initial={reducedMotion?{opacity:0}:{opacity:0,y:12,filter:'blur(6px)'}} animate={{opacity:1,y:0,filter:'blur(0px)'}} exit={reducedMotion?{opacity:0}:{opacity:0,y:-6,filter:'blur(4px)'}} transition={spring}>
        {isHome && <><div className="greeting"><div><h1>Музыка для вас</h1><p>Подборки, радио и ваша медиатека</p></div></div>
          <section className="hero"><div className="hero-content"><div className="hero-kicker">Радио Nocturne</div><h2>Пусть музыка<br/>продолжится</h2><p>Начните с трека, а радио подберёт похожие</p><div className="hero-actions"><motion.button className="primary wave-button" whileTap={reducedMotion?undefined:{scale:.96}} onClick={()=>void startWave()} disabled={waveLoading}><Play size={15} fill="currentColor"/> Моя волна</motion.button><button className="hero-link" onClick={()=>setView('library')}>Открыть медиатеку <ArrowRight size={16}/></button></div></div></section>
          <div className="recommendations"><div className="recommendations-heading"><div><h2>Откройте что-то новое</h2></div><button onClick={()=>setRefreshShelves(x=>x+1)}>Обновить <ArrowRight size={15}/></button></div>{shelfStatus && <p className="catalog-status">{shelfStatus}</p>}
          {shelves.similarUnavailable && <p className="catalog-status">Источники похожей музыки временно недоступны.</p>}<Shelf title="Похоже на ваши лайки" subtitle="На основе понравившихся треков" items={shelfItems(shelves.similar)} onBlock={t=>void blockTrack(t)} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="Недавно слушали" subtitle="Треки, к которым хочется вернуться" items={shelfItems(shelves.recent)} onBlock={t=>void blockTrack(t)} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="Микс дня" subtitle="По вашим любимым исполнителям" items={shelfItems(shelves.daily)} onBlock={t=>void blockTrack(t)} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          <Shelf title="В тренде" subtitle={shelves.editorialFallback?"Резервная редакционная подборка — не персональные рекомендации":shelves.trendingFallback?"Популярные поисковые запросы — тренды зеркал недоступны":"Российские и мировые подборки зеркал"} items={shelfItems(shelves.trending)} onBlock={t=>void blockTrack(t)} onPlay={(t,list)=>void playTrack(t,list)} onRadio={t=>void startRadio(t)} />
          {!user && <p className="catalog-status">История и лайки сохраняются в этом браузере. Войдите, чтобы пользоваться библиотекой на других устройствах.</p>}</div></>}
        <section className="section tracks-section"><div className="section-heading"><div><h2>{title}</h2><p>{search?'Поиск по вашей библиотеке и публичным каталогам.':isHome?'Ваши сохранённые треки.':'Ваша личная коллекция.'}</p></div>{isHome && <button onClick={()=>setView('library')}>Показать все <ArrowRight size={15}/></button>}</div><div className="track-head"><span>#</span><span>Название</span><span>Источник</span><span>Добавлено</span><span><Clock3 size={15}/></span><span/></div>{search && <div className="source-tabs" aria-label="Источник поиска">{([['youtube','YouTube'],['deezer','Deezer · превью'],['jiosaavn','JioSaavn']] as const).map(([id,label])=><button key={id} className={searchSource===id?'selected':''} onClick={()=>setSearchSource(id)}>{label}</button>)}<a href={`https://soundcloud.com/search/sounds?q=${encodeURIComponent(search)}`} target="_blank" rel="noreferrer">SoundCloud ↗</a><button onClick={openSoundcloud}>Вставить ссылку SoundCloud</button></div>}<div className="track-list">{search && searchStatus && <div className="catalog-status">{searchStatus}</div>}{visible.length ? visible.map((t,i)=><div className={`track-row ${current.id===t.id&&playing?'is-playing':''}`} key={t.id}><button className="track-number" onClick={()=>void playTrack(t,visible)}>{current.id===t.id&&playing?<AudioLines size={16}/>:<><span>{String(i+1).padStart(2,'0')}</span><Play className="row-play" size={15} fill="currentColor"/></>}</button><button className="track-title" onClick={()=>void playTrack(t,visible)}><span className="track-art" style={{backgroundImage:`url('${imageFor(t)}')`}}/><span><b>{t.title}</b><small>{displayArtist(t.artist)}</small></span></button><span className="track-album">{t.video_id?'YouTube':t.source==='deezer'?'Deezer · 30 сек.':t.source==='jiosaavn'?'JioSaavn':t.id===demo.id?'Демо':'Ваши файлы'}</span><span className="track-added">{t.video_id||t.external_id?'Стриминг':t.id===demo.id?'Демо':'Недавно'}</span><span className="track-time">{current.id===t.id&&duration?format(duration):t.duration?format(t.duration):'—'}</span><div className="track-controls">{t.video_id && <button title="Запустить радио по треку" aria-label={`Радио: ${t.title}`} onClick={()=>void startRadio(t)}><Radio size={16}/></button>}<button aria-label="Нравится трек" onClick={()=>void toggleLike(t)} className={likes.includes(t.id)?'liked':''}><Heart size={16} fill={likes.includes(t.id)?'currentColor':'none'}/></button>{playlists.length>0 && <select aria-label="Добавить в плейлист" value="" onChange={e=>void addToPlaylist(t,e.target.value)}><option value="">＋</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div></div>) : <div className="empty">Здесь пока нет треков. {view==='liked'?'Отметьте понравившийся трек, чтобы сохранить его здесь.':view.startsWith('playlist:')?'Добавьте треки через меню + в медиатеке.':'Попробуйте другой запрос или загрузите свою музыку.'}</div>}</div></section>
        <footer>Nocturne</footer>
      </motion.div></AnimatePresence>
    </main>
    <div className="player"><div className="now-playing"><AnimatePresence mode="wait" initial={false}><motion.div key={current.id} className="now-meta" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reducedMotion?0:.18}}><div className="player-art" style={{backgroundImage:`url('${imageFor(current)}')`}}/><div className="now-text"><b>{current.title}</b><small>{displayArtist(current.artist)}</small></div></motion.div></AnimatePresence><span className="equalizer" aria-hidden="true">{[0,1,2,3].map(i=><motion.i key={i} animate={playing&&!reducedMotion?{scaleY:[.3,1,.45,.85,.3]}:{scaleY:.25}} transition={playing&&!reducedMotion?{duration:0.9+i*.13,repeat:Infinity,ease:'easeInOut',delay:i*.11}:spring}/>)}</span><motion.button whileTap={reducedMotion?undefined:{scale:.96}} className={likes.includes(current.id)?'liked':''} onClick={()=>void toggleLike(current)} aria-label="Нравится текущий трек"><Heart size={17} fill={likes.includes(current.id)?'currentColor':'none'}/></motion.button><motion.button whileTap={reducedMotion?undefined:{scale:.96}} title="Не рекомендовать" aria-label="Не рекомендовать текущий трек" onClick={()=>void blockTrack(current)}><Ban size={17}/></motion.button></div><div className="player-center"><div className="player-buttons"><button className={shuffle?'on':''} onClick={()=>setShuffle(!shuffle)} aria-label="Перемешать"><Shuffle size={16}/></button><button onClick={()=>void skip(-1)} aria-label="Предыдущий трек"><SkipBack size={18} fill="currentColor"/></button><button className="play-main" onClick={()=>void playTrack(current)} aria-label={playing?'Пауза':'Воспроизвести'}>{loading?<AudioLines size={19}/>:playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button onClick={()=>void skip(1)} aria-label="Следующий трек"><SkipForward size={18} fill="currentColor"/></button><button className={repeat?'on':''} onClick={()=>setRepeat(!repeat)} aria-label="Повтор"><Repeat2 size={17}/></button></div><div className="progress"><span>{format(elapsed)}</span><input aria-label="Перемотка" type="range" min="0" max={duration||0} value={Math.min(elapsed,duration||0)} onChange={e=>{if(current.video_id && youtubeActive)yt.current?.seek(Number(e.target.value));else if(audio.current) audio.current.currentTime=Number(e.target.value);playback.current.last=Number(e.target.value);setElapsed(Number(e.target.value))}} style={{'--progress':`${duration?elapsed/duration*100:0}%`} as React.CSSProperties}/><span>{format(duration)}</span></div></div><div className="player-right"><button title="Медиатека" aria-label="Медиатека" onClick={()=>setView('library')}><ListMusic size={18}/></button><button onClick={()=>setVolume(volume?0:70)} aria-label="Выключить звук">{volume?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><input aria-label="Громкость" type="range" min="0" max="100" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{'--progress':`${volume}%`} as React.CSSProperties}/><span>{volume}%</span></div></div>
    {soundcloudUrl && <aside className="soundcloud-panel"><div className="youtube-header"><span>SOUNDCLOUD · ВИДЖЕТ</span><button onClick={()=>setSoundcloudUrl(null)} aria-label="Закрыть SoundCloud">×</button></div><iframe title="SoundCloud player" width="100%" height="166" allow="autoplay" src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloudUrl)}&auto_play=false`} /><small>Управляйте воспроизведением в виджете SoundCloud.</small></aside>}
    {/* Local audio events. */}
    <AudioEvents audio={audio} playing={playing} trackId={current.id} onTime={onTime} onDuration={setDuration} onEnded={()=>{setPlaying(false);if(repeat && audio.current){playback.current={seconds:0,last:0,completed:false,started:true};listenRecorded.current=false;audio.current.currentTime=0;void audio.current.play().then(()=>setPlaying(true)).catch(()=>setNotice('Ошибка воспроизведения.'));}else void skip(1,true)}} onError={()=>{if(!currentRef.current.video_id){setPlaying(false);setNotice('Не удалось загрузить аудио.');}}} />
    <AnimatePresence>{notice && <motion.div key="toast" className="toast" role="status" initial={reducedMotion?{opacity:0}:{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reducedMotion?0:8}} transition={spring}>{notice}{lastBlocked && <button className="undo-block" onClick={()=>void undoBlock()}>Отменить</button>}<button aria-label="Закрыть уведомление" onClick={()=>{setNotice('');setLastBlocked(null)}}><X size={16}/></button></motion.div>}</AnimatePresence>
    <AnimatePresence>{authOpen && <motion.div key="auth" className="modal-backdrop" onClick={()=>setAuthOpen(false)} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.div role="dialog" aria-modal="true" aria-label="Вход" className="modal" onClick={e=>e.stopPropagation()} initial={reducedMotion?{opacity:0}:{opacity:0,y:12,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reducedMotion?0:8}} transition={spring}><button className="modal-close" aria-label="Закрыть" onClick={()=>setAuthOpen(false)}><X size={19}/></button><span className="brand-icon"><AudioLines size={22}/></span><h2>Ваша музыка всегда с вами</h2><p>Войдите, чтобы синхронизировать библиотеку, создавать плейлисты и загружать музыку.</p><form onSubmit={signIn}><label htmlFor="email">Электронная почта</label><input id="email" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/><button className="primary" disabled={busy}>{busy?'Отправляем…':'Получить ссылку для входа'} <ArrowRight size={16}/></button></form><small>Пароль не нужен — отправим ссылку для входа на почту.</small></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{playlistOpen && <motion.div key="playlist" className="modal-backdrop" onClick={()=>setPlaylistOpen(false)} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.div role="dialog" aria-modal="true" aria-label="Создать плейлист" className="modal" onClick={e=>e.stopPropagation()} initial={reducedMotion?{opacity:0}:{opacity:0,y:12,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reducedMotion?0:8}} transition={spring}><button className="modal-close" aria-label="Закрыть" onClick={()=>setPlaylistOpen(false)}><X size={19}/></button><h2>Новый плейлист</h2><form onSubmit={savePlaylist}><label htmlFor="playlist-name">Название</label><input autoFocus id="playlist-name" value={playlistName} onChange={e=>setPlaylistName(e.target.value)} required maxLength={100}/><button className="primary">Создать плейлист</button></form></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{searchOpen && <motion.div key="search" className="modal-backdrop" onClick={()=>setSearchOpen(false)} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.div role="dialog" aria-modal="true" aria-label="Поиск музыки" className="modal" onClick={e=>e.stopPropagation()} initial={reducedMotion?{opacity:0}:{opacity:0,y:12,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reducedMotion?0:8}} transition={spring}><button className="modal-close" aria-label="Закрыть" onClick={()=>setSearchOpen(false)}><X size={19}/></button><h2>Поиск музыки</h2><form onSubmit={e=>{e.preventDefault();setView('search');setSearchOpen(false)}}><label htmlFor="search-dialog">Исполнитель или трек</label><input autoFocus id="search-dialog" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Что хотите послушать?"/><button className="primary">Показать результаты</button></form></motion.div></motion.div>}</AnimatePresence>
  </div></MotionConfig>;
}

function AudioEvents({audio,playing,trackId,onTime,onDuration,onEnded,onError}:{audio:React.RefObject<HTMLAudioElement|null>;playing:boolean;trackId:string;onTime:(v:number)=>void;onDuration:(v:number)=>void;onEnded:()=>void;onError:()=>void}) {
  useEffect(()=>{const a=audio.current;if(!a)return;const time=()=>onTime(a.currentTime);const duration=()=>onDuration(Number.isFinite(a.duration)?a.duration:0);a.addEventListener('timeupdate',time);a.addEventListener('durationchange',duration);a.addEventListener('ended',onEnded);a.addEventListener('error',onError);return()=>{a.removeEventListener('timeupdate',time);a.removeEventListener('durationchange',duration);a.removeEventListener('ended',onEnded);a.removeEventListener('error',onError)}},[audio,playing,trackId,onTime,onDuration,onEnded,onError]);
  return null;
}

function Shelf({title,subtitle,items,onPlay,onRadio,onBlock}:{title:string;subtitle:string;items:Track[];onPlay:(track:Track,list:Track[])=>void;onRadio:(track:Track)=>void;onBlock:(track:Track)=>void}) {
  const reduced=useReducedMotion();const [visible,setVisible]=useState(items.length>0);
  useEffect(()=>{if(items.length)setVisible(true);},[items.length]);
  if(!visible&&!items.length) return null;
  const container={show:{transition:{staggerChildren:reduced?0:.04}}};
  const card={hidden:reduced?{opacity:0}:{opacity:0,y:12},show:(i:number)=>({opacity:1,y:0,transition:{...spring,delay:reduced?0:i*.04}})};
  return <section className="shelf"><div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div><motion.div className="shelf-scroll" variants={container} initial="hidden" animate="show"><AnimatePresence onExitComplete={()=>{if(!items.length)setVisible(false)}}>{items.map((t,i)=><motion.div layout key={t.id} className="catalog-card" variants={card} initial="hidden" animate="show" custom={i} exit={reduced?{opacity:0}:{opacity:0,scale:.88,flexBasis:0,marginRight:-16,transition:spring}}><motion.button className="catalog-card-main" whileHover={reduced?undefined:{y:-4}} whileTap={reduced?undefined:{scale:.96}} transition={spring} onClick={()=>onPlay(t,items)}><span className="catalog-art" style={{backgroundImage:`url('${imageFor(t)}')`}}><span className="catalog-play"><Play size={17} fill="currentColor"/></span></span><b>{t.title}</b><small>{displayArtist(t.artist)}</small></motion.button><motion.button whileTap={reduced?undefined:{scale:.96}} className="block-card" title="Не рекомендовать" aria-label={`Не рекомендовать: ${t.title}`} onClick={()=>onBlock(t)}><Ban size={16}/></motion.button><button className="radio-card" title="Запустить радио по треку" aria-label={`Радио: ${t.title}`} onClick={()=>onRadio(t)}><Radio size={15}/></button></motion.div>)}</AnimatePresence></motion.div></section>;
}
