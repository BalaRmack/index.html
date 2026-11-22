-- Record a short, actually played listen so recommendations can exclude the last day.
alter table public.listening_history drop constraint listening_history_event_type_check;
alter table public.listening_history add constraint listening_history_event_type_check check (event_type in ('like','playlist_add','listen','complete','skip'));
