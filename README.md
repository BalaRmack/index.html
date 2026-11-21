# Nocturne

A music player built with Next.js App Router, TypeScript, Tailwind CSS, Supabase and Web Audio. The included demo is “Outfoxing the Fox” by Kevin MacLeod (Creative Commons), sourced from [MDN webaudio-examples](https://github.com/mdn/webaudio-examples). Upload only audio you have permission to use.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and publishable key.
3. Apply all migrations in `supabase/migrations` in order to a new Supabase project. Configure the Auth site URL and redirect allowlist for your deployed domain and local URL.
4. `npm run dev`.

Email magic links require an Auth email provider configured for your use case; the default Supabase SMTP has restrictions. Audio is private per user, with short-lived signed URLs and row-level security. Demo playback works without an account. Uploads are limited to 50 MB. No claim of zero network latency is made: playback streams and actual start time depends on the browser and connection.

The UI and audio engine run entirely in the browser, with no native API dependency. A future Tauri shell can host a static client after configuring Next static export; Supabase and Auth redirect/deep-link policies must be configured for the desktop origin. No Rust shell is included yet.

## Catalogue and recommendations

YouTube search and trending use fixed third-party Piped/Invidious mirrors. Radio and similar tracks try the undocumented YouTube radio-mix endpoint and Deezer related-artist metadata, mapping Deezer songs to YouTube search results; neither source is guaranteed to work or remain stable. Playback uses the official YouTube IFrame Player API in the browser, not those mirrors' audio URLs. The app preloads a single iframe, shows it during YouTube playback, and switches videos with `loadVideoById`. The player is kept visible and at least 200×200 while playing; YouTube policies prohibit hidden/background playback. The app does not itself pause when the tab loses visibility, but browser or provider restrictions can still interrupt playback. Playback can fail due to embedding restrictions, region, a blocked script, or browser autoplay policy; use the iframe's Play button or open the video on YouTube. The bottom controls synchronize with the iframe. Media Session supplies metadata and play, pause, next, and previous handlers where supported; it cannot prevent a browser or provider from suspending background playback, and behavior varies by browser (including Firefox). The “Найти в Deezer” button searches for alternatives rather than silently substituting a different recording.

Search also offers Deezer (explicitly marked 30-second previews only) and experimental unofficial JioSaavn mirrors. These third parties can fail, block requests, differ by region, or change their responses, and rights or availability are not guaranteed. SoundCloud search opens the service's own site; a public track URL can be pasted into the SoundCloud widget. SoundCloud controls are in the widget, separate from the bottom player. Official SoundCloud API search/stream integration requires an approved application and credentials; no third-party client ID is used. Stream URLs are not saved to Supabase; client IPs are visible to content providers. Apply `003_alternative_sources.sql` for saving alternative-track likes and playlists.

Apply `supabase/migrations/002_listening_history.sql` after the initial migration. For signed-in users, likes, playlist additions, skips before 10 seconds of actual playback, listens of at least five seconds, and listens exceeding 70% are stored in RLS-protected `listening_history`. Seeking is not counted as listening. No listening history is recorded for guests. The recommendations endpoint validates the user's access token and reads only that user's data under RLS; it never uses a service-role key. Related items and the three most positively weighted artists drive a simple heuristic. Tracks skipped at least twice are excluded. Trending items come from third-party regional endpoints and are not guaranteed to be music; if unavailable, the interface labels the results as popular search queries. Tracks played in the last 24 hours are excluded from new recommendations for signed-in users, and adjacent tracks are chosen from different artists where possible. If neither provider works, radio reports an error instead of pretending that an artist search is a similar-track mix. Apply `004_listen_events.sql` before enabling the new listen event. This is not Spotify's recommendation model. Delete history from the Supabase table if requested; there is currently no in-app deletion interface.

Run `npm test` for offline mirror-failover, normalization and taste-ranking tests. Because the catalogue and recommendations now use Next.js API routes, a future Tauri static client needs a deployed API backend and appropriate native-origin/CORS and auth redirect configuration; static export alone is not sufficient.

## Glass effects

Translucent CSS surfaces use backdrop blur and static edge highlights, with SVG displacement as progressive enhancement where supported. Browsers that do not support SVG backdrop filters use the gradient-only treatment. Effects and frame rate depend on browser, device and compositor; reduced-motion preferences are respected.
