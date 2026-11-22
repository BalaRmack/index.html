-- 007: обложки плейлистов (Block 7 — «пользовательские обложки»).
-- cover_url — путь в приватном бакете audio (covers/…) либо data: URL превью у гостя;
-- сам файл в БД не хранится. RLS уже настроена в 001 политикой "Manage own playlists" (для всех команд).
alter table public.playlists add column if not exists cover_url text;
alter table public.playlists add column if not exists updated_at timestamptz not null default now();

comment on column public.playlists.cover_url is 'Путь в бакете audio (covers/…) или data: URL превью';
