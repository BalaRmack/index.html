create table if not exists public.recommendation_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('track','artist')),
  track_id text not null check (length(track_id) between 1 and 300),
  video_id text,
  title text not null default '',
  artist text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, kind, track_id)
);
alter table public.recommendation_blocks enable row level security;
create policy "Users read own recommendation blocks" on public.recommendation_blocks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own recommendation blocks" on public.recommendation_blocks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own recommendation blocks" on public.recommendation_blocks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own recommendation blocks" on public.recommendation_blocks for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.recommendation_blocks to authenticated;
