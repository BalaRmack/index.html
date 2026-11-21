# Nocturne

A music player built with Next.js App Router, TypeScript, Tailwind CSS, Supabase and Web Audio. The included demo is “Outfoxing the Fox” by Kevin MacLeod (Creative Commons), sourced from [MDN webaudio-examples](https://github.com/mdn/webaudio-examples). Upload only audio you have permission to use.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and publishable key.
3. Apply `supabase/migrations/001_initial.sql` to a new Supabase project. Configure the Auth site URL and redirect allowlist for your deployed domain and local URL.
4. `npm run dev`.

Email magic links require an Auth email provider configured for your use case; the default Supabase SMTP has restrictions. Audio is private per user, with short-lived signed URLs and row-level security. Demo playback works without an account. Uploads are limited to 50 MB. No claim of zero network latency is made: playback streams and actual start time depends on the browser and connection.

The UI and audio engine run entirely in the browser, with no native API dependency. A future Tauri shell can host a static client after configuring Next static export; Supabase and Auth redirect/deep-link policies must be configured for the desktop origin. No Rust shell is included yet.

## Catalogue and recommendations

The `/api/catalog` routes query a fixed allowlist of Piped/Invidious mirrors in bounded concurrent waves; if a stream fails in the browser, another mirror is tried. Search results and direct stream URLs are supplied by independent third parties. They may be unavailable, blocked, expire, differ by region or violate particular services' terms; only play material you are authorized to access. Stream URLs are never saved to Supabase. Server requests do not proxy the audio, so a client's IP is visible to the selected stream host. Mirror availability and instant playback cannot be guaranteed. The bundled demo and private uploads remain available without the external catalogue.

Apply `supabase/migrations/002_listening_history.sql` after the initial migration. For signed-in users, likes, playlist additions, skips before 10 seconds of actual playback, and listens exceeding 70% are stored in RLS-protected `listening_history`. Seeking is not counted as listening. No listening history is recorded for guests. The recommendations endpoint validates the user's access token and reads only that user's data under RLS; it never uses a service-role key. Related items and the three most positively weighted artists drive a simple heuristic. Tracks skipped at least twice are excluded. Trending items come from third-party regional endpoints and are not guaranteed to be music. This is not Spotify's recommendation model. Delete history from the Supabase table if requested; there is currently no in-app deletion interface.

Run `npm test` for offline mirror-failover, normalization and taste-ranking tests. Because the catalogue and recommendations now use Next.js API routes, a future Tauri static client needs a deployed API backend and appropriate native-origin/CORS and auth redirect configuration; static export alone is not sufficient.
