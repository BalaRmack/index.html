alter table public.tracks drop constraint tracks_source_check;
alter table public.tracks add constraint tracks_source_check check (source in ('local','youtube','deezer','jiosaavn'));
alter table public.tracks add column external_id text check (external_id is null or external_id ~ '^[A-Za-z0-9_-]{1,32}$');
create unique index tracks_owner_external_idx on public.tracks(owner_id,source,external_id) where external_id is not null;
