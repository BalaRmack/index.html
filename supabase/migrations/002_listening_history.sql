-- Remote entries are user-owned metadata only: no third-party stream URL is persisted.
alter table public.tracks add column source text not null default 'local' check (source in ('local','youtube'));
alter table public.tracks add column video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');
create unique index tracks_owner_video_idx on public.tracks(owner_id,video_id) where video_id is not null;
create table public.listening_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null check (char_length(track_id) <= 150),
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) <= 300),
  artist text not null check (char_length(artist) <= 200),
  event_type text not null check (event_type in ('like','playlist_add','complete','skip')),
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  created_at timestamptz not null default now()
);
create index listening_history_user_created_idx on public.listening_history(user_id,created_at desc);
alter table public.listening_history enable row level security;
create policy "Users read own listening history" on public.listening_history for select to authenticated using (user_id = auth.uid());
create policy "Users insert own listening history" on public.listening_history for insert to authenticated with check (user_id = auth.uid());
create policy "Users delete own listening history" on public.listening_history for delete to authenticated using (user_id = auth.uid());
