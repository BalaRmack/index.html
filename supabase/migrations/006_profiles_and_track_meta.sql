-- Nocturne: профиль с настройками, метаданные треков и удаление тестового демо-трека.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  preferences jsonb not null default '{}'::jsonb,
  onboarding_completed boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "Users write own profile" on public.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.profiles to authenticated;
create index if not exists profiles_onboarding_idx on public.profiles(onboarding_completed);

-- Реальная длительность, альбом и обложка: таблица треков больше не должна показывать «—» и технические метки.
alter table public.tracks add column if not exists duration numeric check (duration is null or duration between 0 and 36000);
alter table public.tracks add column if not exists album text;
alter table public.tracks add column if not exists artwork text;

-- Тестовый трек Kevin MacLeod больше не часть библиотеки: в «Вашей музыке» только реальные сохранения пользователя.
delete from public.playlist_tracks where track_id = 'demo-outfoxing';
delete from public.likes where track_id = 'demo-outfoxing';
delete from public.listening_history where track_id = 'demo-outfoxing';
delete from public.tracks where id = 'demo-outfoxing';
