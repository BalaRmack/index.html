'use client';

import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, ChevronRight, Clock3, Disc3, Heart, Home, Library, ListMusic, LogIn, LogOut, MoreHorizontal, Music2, Pause, Play, Plus, Repeat2, Search, Shuffle, SkipBack, SkipForward, Sparkles, Upload, Volume2, VolumeX, X } from 'lucide-react';

type Track = { id:string; title:string; artist:string; storage_path:string|null; owner_id?:string|null };
type Playlist = { id:string; name:string };
const demo: Track = { id:'demo-outfoxing', title:'Outfoxing the Fox', artist:'Kevin MacLeod', storage_path:null };
const covers = [
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80',
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=500&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=500&q=80',
  'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=500&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=500&q=80',
];
const moods = [
  {title:'The evening edit',sub:'A softer soundtrack for slowing down.',tag:'MADE FOR YOU'},
  {title:'After hours',sub:'For the moments that are all yours.',tag:'YOUR MOOD'},
  {title:'Golden hour',sub:'A little warmth for wherever you are.',tag:'YOUR MOOD'},
  {title:'City lights',sub:'Find your rhythm after dark.',tag:'YOUR MOOD'},
  {title:'Deep focus',sub:'Less noise, more headspace.',tag:'YOUR MOOD'},
];
const format = (s:number) => `${Math.floor((s || 0)/60)}:${String(Math.floor((s || 0)%60)).padStart(2,'0')}`;

export default function HomePage() {
  const [user,setUser] = useState<User|null>(null);
  const [tracks,setTracks] = useState<Track[]>([demo]);
  const [playlists,setPlaylists] = useState<Playlist[]>([]);
  const [likes,setLikes] = useState<string[]>([]);
  const [playlistIds,setPlaylistIds] = useState<string[]>([]);
  const [view,setView] = useState('home');
  const [search,setSearch] = useState('');
  const [current,setCurrent] = useState<Track>(demo);
  const [playing,setPlaying] = useState(false);
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
  const currentRef = useRef(current);
  currentRef.current = current;

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
      if (t.data) setTracks(t.data as Track[]);
      if (p.data) setPlaylists(p.data as Playlist[]);
      if (l.data) setLikes(l.data.map(x => x.track_id));
      if (t.error || p.error || l.error) setNotice('Could not load your library. Please try again.');
    });
  },[user]);
  useEffect(() => {
    if (!supabase || !user || !view.startsWith('playlist:')) { setPlaylistIds([]); return; }
    supabase.from('playlist_tracks').select('track_id').eq('playlist_id',view.slice(9)).then(({data,error}) => { if (data) setPlaylistIds(data.map(x=>x.track_id)); if(error) setNotice(error.message); });
  },[view,user]);
  useEffect(() => { if(gain.current) gain.current.gain.value = volume/100; },[volume]);
  useEffect(() => () => { audio.current?.pause(); void ctx.current?.close(); },[]);

  function initAudio() {
    if (!audio.current) { audio.current = new Audio(); audio.current.preload = 'auto'; audio.current.crossOrigin = 'anonymous'; }
    if (!ctx.current) {
      ctx.current = new AudioContext();
      const source = ctx.current.createMediaElementSource(audio.current);
      gain.current = ctx.current.createGain(); gain.current.gain.value = volume/100;
      source.connect(gain.current).connect(ctx.current.destination);
    }
    return audio.current;
  }
  async function playTrack(track:Track) {
    try {
      const player = initAudio();
      if (currentRef.current.id === track.id && player.src) {
        if (player.paused) { await ctx.current?.resume(); await player.play(); setPlaying(true); }
        else { player.pause(); setPlaying(false); }
        return;
      }
      let url = '/audio/outfoxing.mp3';
      if (track.storage_path) {
        if (!supabase) throw new Error('Supabase is not configured.');
        const {data,error} = await supabase.storage.from('audio').createSignedUrl(track.storage_path,3600);
        if(error || !data) throw new Error(error?.message || 'Could not open this track.');
        url = data.signedUrl;
      }
      player.src = url; player.currentTime = 0; setCurrent(track); setElapsed(0); setDuration(0);
      await ctx.current?.resume(); await player.play(); setPlaying(true);
    } catch (e) { setPlaying(false); setNotice(e instanceof Error ? e.message : 'Playback failed.'); }
  }
  function togglePlay() { void playTrack(current); }
  function skip(direction:number) {
    const list = visible.length ? visible : tracks;
    let index = list.findIndex(t=>t.id===current.id);
    index = shuffle && list.length > 1 ? (index + 1 + Math.floor(Math.random()*(list.length-1))) % list.length : (index + direction + list.length) % list.length;
    if(list[index]?.id === current.id && audio.current) { audio.current.currentTime = 0; void audio.current.play().then(()=>setPlaying(true)).catch(()=>setNotice('Playback failed.')); }
    else if(list[index]) void playTrack(list[index]);
  }
  async function toggleLike(track:Track) {
    if (!user || !supabase) { setAuthOpen(true); return; }
    const exists = likes.includes(track.id);
    const {error} = exists ? await supabase.from('likes').delete().eq('user_id',user.id).eq('track_id',track.id) : await supabase.from('likes').insert({user_id:user.id,track_id:track.id});
    if(error) setNotice(error.message); else setLikes(exists ? likes.filter(id=>id!==track.id) : [...likes,track.id]);
  }
  async function createPlaylist() {
    if (!user || !supabase) { setAuthOpen(true); return; }
    const name = window.prompt('Name your playlist'); if (!name?.trim()) return;
    const {data,error} = await supabase.from('playlists').insert({name:name.trim(),owner_id:user.id}).select('id,name').single();
    if(error) setNotice(error.message); else { setPlaylists([data,...playlists]); setView(`playlist:${data.id}`); }
  }
  async function addToPlaylist(track:Track, id:string) {
    if(!supabase || !id) return;
    const {error} = await supabase.from('playlist_tracks').upsert({playlist_id:id,track_id:track.id});
    setNotice(error ? error.message : 'Added to your playlist.');
    if(view === `playlist:${id}` && !playlistIds.includes(track.id)) setPlaylistIds([...playlistIds,track.id]);
  }
  async function upload(file:File) {
    if(!user || !supabase) { setAuthOpen(true); return; }
    if(file.size > 50*1024*1024) { setNotice('Please choose a file under 50 MB.'); return; }
    setBusy(true);
    const id = crypto.randomUUID(); const path = `${user.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const {error:storageError} = await supabase.storage.from('audio').upload(path,file);
    if(storageError) { setNotice(storageError.message); setBusy(false); return; }
    const track = {id,owner_id:user.id,title:file.name.replace(/\.[^.]+$/,''),artist:'Your upload',storage_path:path};
    const {error} = await supabase.from('tracks').insert(track);
    if(error) { await supabase.storage.from('audio').remove([path]); setNotice(error.message); } else { setTracks([track,...tracks]); setNotice('Track added to your library.'); setView('library'); }
    setBusy(false);
  }
  async function signIn(e:React.FormEvent) {
    e.preventDefault(); if(!supabase) { setNotice('Supabase is not configured.'); return; }
    setBusy(true); const {error} = await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}}); setBusy(false);
    if(error) setNotice(error.message); else {setAuthOpen(false);setNotice('Check your inbox for your sign-in link.');}
  }
  const visible = tracks.filter(t => (view === 'liked' ? likes.includes(t.id) : view.startsWith('playlist:') ? playlistIds.includes(t.id) : true) && `${t.title} ${t.artist}`.toLowerCase().includes(search.toLowerCase()));
  const isHome = view === 'home' && !search;
  const title = view === 'liked' ? 'Liked songs' : view.startsWith('playlist:') ? playlists.find(p=>p.id===view.slice(9))?.name || 'Playlist' : view === 'library' ? 'Your library' : search ? 'Search results' : 'Recently played';
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
      <header className="topbar"><div className="history"><button aria-label="Back" onClick={()=>history.back()}><ArrowLeft size={18}/></button><button aria-label="Forward" onClick={()=>history.forward()}><ArrowRight size={18}/></button></div><div className="search-wrap"><Search size={17}/><input id="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="What do you want to listen to?"/><span>⌘ K</span></div><div className="top-actions"><button className="upload-button" onClick={()=>user?fileInput.current?.click():setAuthOpen(true)}><Upload size={16}/><span>{busy?'Uploading...':'Upload music'}</span></button><input ref={fileInput} type="file" accept="audio/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f) void upload(f);e.target.value=''}}/><button className="profile" onClick={()=>user?void supabase?.auth.signOut():setAuthOpen(true)}><span className="avatar">{user?.email?.[0].toUpperCase() || 'N'}</span><span>{user ? user.email?.split('@')[0] : 'Guest listener'}</span>{user?<LogOut size={15}/>:<ChevronDown size={15}/>}</button></div></header>
      <div className="content">
        {isHome && <><div className="greeting"><div><div className="eyebrow"><span className="green-dot"/> YOUR SOUND, YOUR SPACE</div><h1>Good to see you<span>.</span></h1><p>Find the soundtrack to your day.</p></div><span className="date-label">A LITTLE MORE ROOM FOR MUSIC <AudioLines size={16}/></span></div>
          <section className="hero"><div className="hero-content"><div className="hero-kicker"><Sparkles size={14}/> THE NOCTURNE EDIT <span>01 / 05</span></div><h2>Music for<br/><em>every moment.</em></h2><p>Escape the noise. Find your rhythm.<br/>Let the music take you somewhere else.</p><div className="hero-actions"><button className="primary" onClick={()=>void playTrack(demo)}><Play size={15} fill="currentColor"/> Play demo</button><button className="hero-link" onClick={()=>setView('library')}>Explore your library <ArrowRight size={16}/></button></div></div><div className="hero-caption"><span>CURATED FOR YOU</span><b>Find your<br/>kind of quiet.</b></div><div className="hero-index"><span className="selected"/> <span/> <span/> <span/></div></section>
          <section className="section"><div className="section-heading"><div><div className="eyebrow">A LITTLE SOMETHING FOR YOU</div><h2>Made for your moments <span>✳</span></h2><p>Explore the moods behind our demo track.</p></div><button onClick={()=>setView('library')}>Your library <ArrowRight size={15}/></button></div><div className="cards">{moods.map((m,i)=><button className="mood-card" key={m.title} onClick={()=>void playTrack(demo)}><div className="card-image" style={{backgroundImage:`linear-gradient(0deg, rgba(0,0,0,.25),transparent 55%), url('${covers[i]}')`}}><span className="card-tag">{m.tag}</span><span className="card-play"><Play size={17} fill="currentColor"/></span>{i===0 && <span className="cover-title">THE<br/>EVENING<br/><i>EDIT.</i></span>}</div><b>{m.title}</b><p>{m.sub}</p></button>)}</div></section></>}
        <section className="section tracks-section"><div className="section-heading"><div><div className="eyebrow">{isHome?'PICK UP WHERE YOU LEFT OFF':'YOUR MUSIC, ALL IN ONE PLACE'}</div><h2>{title} <span>✳</span></h2><p>{isHome?'Good music is always worth coming back to.':'Your personal collection, ready when you are.'}</p></div>{isHome && <button onClick={()=>setView('library')}>See all <ArrowRight size={15}/></button>}</div><div className="track-head"><span>#</span><span>TITLE</span><span>ALBUM</span><span>ADDED</span><span><Clock3 size={15}/></span><span/></div><div className="track-list">{visible.length ? visible.map((t,i)=><div className={`track-row ${current.id===t.id&&playing?'is-playing':''}`} key={t.id}><button className="track-number" onClick={()=>void playTrack(t)}>{current.id===t.id&&playing?<AudioLines size={16}/>:<><span>{String(i+1).padStart(2,'0')}</span><Play className="row-play" size={15} fill="currentColor"/></>}</button><button className="track-title" onClick={()=>void playTrack(t)}><span className="track-art" style={{backgroundImage:`url('${t.id===demo.id?covers[0]:covers[2]}')`}}/><span><b>{t.title}</b><small>{t.artist}</small></span></button><span className="track-album">{t.id===demo.id?'Demo collection':'Your uploads'}</span><span className="track-added">{t.id===demo.id?'Featured':'Recently'}</span><span className="track-time">{current.id===t.id&&duration?format(duration):'—'}</span><div className="track-controls"><button aria-label="Like track" onClick={()=>void toggleLike(t)} className={likes.includes(t.id)?'liked':''}><Heart size={16} fill={likes.includes(t.id)?'currentColor':'none'}/></button>{playlists.length>0 && <select aria-label="Add to playlist" value="" onChange={e=>void addToPlaylist(t,e.target.value)}><option value="">＋</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div></div>) : <div className="empty">No tracks here yet. {view==='liked'?'Like a song to save it here.':view.startsWith('playlist:')?'Add tracks using the + menu in your library.':'Try another search or upload your own music.'}</div>}</div></section>
        <footer>MADE FOR LISTENING <span>✳</span> STAY A WHILE</footer>
      </div>
    </main>
    <div className="player"><div className="now-playing"><div className="player-art" style={{backgroundImage:`url('${current.id===demo.id?covers[0]:covers[2]}')`}}/><div><b>{current.title}</b><small>{current.artist}</small></div><button className={likes.includes(current.id)?'liked':''} onClick={()=>void toggleLike(current)} aria-label="Like current track"><Heart size={17} fill={likes.includes(current.id)?'currentColor':'none'}/></button></div><div className="player-center"><div className="player-buttons"><button className={shuffle?'on':''} onClick={()=>setShuffle(!shuffle)} aria-label="Shuffle"><Shuffle size={16}/></button><button onClick={()=>skip(-1)} aria-label="Previous"><SkipBack size={18} fill="currentColor"/></button><button className="play-main" onClick={togglePlay} aria-label={playing?'Pause':'Play'}>{playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button><button onClick={()=>skip(1)} aria-label="Next"><SkipForward size={18} fill="currentColor"/></button><button className={repeat?'on':''} onClick={()=>setRepeat(!repeat)} aria-label="Repeat"><Repeat2 size={17}/></button></div><div className="progress"><span>{format(elapsed)}</span><input aria-label="Seek" type="range" min="0" max={duration||0} value={Math.min(elapsed,duration||0)} onChange={e=>{if(audio.current) audio.current.currentTime=Number(e.target.value);setElapsed(Number(e.target.value))}} style={{'--progress':`${duration?elapsed/duration*100:0}%`} as React.CSSProperties}/><span>{format(duration)}</span></div></div><div className="player-right"><button title="Library" onClick={()=>setView('library')}><ListMusic size={18}/></button><button onClick={()=>setVolume(volume?0:70)} aria-label="Mute">{volume?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{'--progress':`${volume}%`} as React.CSSProperties}/><span>{volume}%</span></div></div>
    {/* Audio element events are attached once the browser creates the media element. */}
    <AudioEvents audio={audio} playing={playing} onTime={setElapsed} onDuration={setDuration} onEnded={()=>{setPlaying(false);if(repeat && audio.current){audio.current.currentTime=0;void audio.current.play().then(()=>setPlaying(true)).catch(()=>setNotice('Playback failed.'));}else skip(1)}} onError={()=>{setPlaying(false);setNotice('Could not load audio.')}} />
    {notice && <div className="toast" role="status">{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {authOpen && <div className="modal-backdrop" onClick={()=>setAuthOpen(false)}><div className="modal" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setAuthOpen(false)}><X size={19}/></button><span className="brand-icon"><AudioLines size={22}/></span><h2>Your music, everywhere.</h2><p>Sign in to save your favorites, create playlists, and upload your own tracks.</p><form onSubmit={signIn}><label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/><button className="primary" disabled={busy}>{busy?'Sending...':'Send me a sign-in link'} <ArrowRight size={16}/></button></form><small>No password needed. We&apos;ll email you a magic link.</small></div></div>}
  </div>;
}

function AudioEvents({audio,playing,onTime,onDuration,onEnded,onError}:{audio:React.RefObject<HTMLAudioElement|null>;playing:boolean;onTime:(v:number)=>void;onDuration:(v:number)=>void;onEnded:()=>void;onError:()=>void}) {
  useEffect(()=>{const a=audio.current;if(!a)return;const time=()=>onTime(a.currentTime);const duration=()=>onDuration(Number.isFinite(a.duration)?a.duration:0);a.addEventListener('timeupdate',time);a.addEventListener('durationchange',duration);a.addEventListener('ended',onEnded);a.addEventListener('error',onError);return()=>{a.removeEventListener('timeupdate',time);a.removeEventListener('durationchange',duration);a.removeEventListener('ended',onEnded);a.removeEventListener('error',onError)}},[audio,playing,onTime,onDuration,onEnded,onError]);
  return null;
}
