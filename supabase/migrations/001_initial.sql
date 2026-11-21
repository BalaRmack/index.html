-- Personal music library. Run in the Supabase SQL editor or via Supabase CLI.
create table public.tracks (id text primary key, owner_id uuid references auth.users(id) on delete cascade, title text not null, artist text not null default 'Unknown artist', storage_path text, created_at timestamptz not null default now());
create table public.playlists (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, name text not null, created_at timestamptz not null default now());
create table public.playlist_tracks (playlist_id uuid not null references public.playlists(id) on delete cascade, track_id text not null references public.tracks(id) on delete cascade, added_at timestamptz not null default now(), primary key (playlist_id, track_id));
create table public.likes (user_id uuid not null references auth.users(id) on delete cascade, track_id text not null references public.tracks(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,track_id));
alter table public.tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.likes enable row level security;
create policy "Read demo and own tracks" on public.tracks for select using (owner_id is null or owner_id = auth.uid());
create policy "Manage own tracks" on public.tracks for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Manage own playlists" on public.playlists for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Manage playlist tracks" on public.playlist_tracks for all to authenticated using (exists (select 1 from public.playlists where id = playlist_id and owner_id = auth.uid())) with check (exists (select 1 from public.playlists where id = playlist_id and owner_id = auth.uid()) and exists (select 1 from public.tracks where id = track_id and (owner_id is null or owner_id = auth.uid())));
create policy "Manage own likes" on public.likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.tracks where id = track_id and (owner_id is null or owner_id = auth.uid())));
insert into public.tracks (id,title,artist) values ('demo-outfoxing','Outfoxing the Fox','Kevin MacLeod');
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('audio','audio',false,52428800, array['audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac']);
create policy "Users read own audio" on storage.objects for select to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users upload own audio" on storage.objects for insert to authenticated with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own audio" on storage.objects for delete to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
