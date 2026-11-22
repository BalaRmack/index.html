# Nocturne

A music player built with Next.js App Router, TypeScript, Tailwind CSS, Supabase and Web Audio.

The library ships no demo rows: an empty account shows an empty library, and every table row is a real track with its real album, duration and add date. `public/audio/outfoxing.mp3` (“Outfoxing the Fox” by Kevin MacLeod, Creative Commons, sourced from [MDN webaudio-examples](https://github.com/mdn/webaudio-examples)) is kept only as a legacy local sample for existing rows and is never presented as catalogue content. Upload only audio you have permission to use.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and publishable key.
3. Apply all migrations in `supabase/migrations` in order to a new Supabase project. Configure the Auth site URL and redirect allowlist for your deployed domain and local URL.
4. `npm run dev`.

Supabase Auth settings are applied by a script rather than guessed at runtime — `npm run auth:check` shows the diff, `npm run auth:apply` writes it (needs `SUPABASE_ACCESS_TOKEN`, run on your machine):

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx npm run auth:check
SUPABASE_ACCESS_TOKEN=sbp_xxx npm run auth:apply
```

Sign-in uses a six-digit email code (Supabase OTP), not a magic link: `app/auth/confirm` validates it and `app/auth/complete` finishes the session. Supabase Auth must be configured for it — `mailer_otp_length = 6`, OTP expiry, email templates and the redirect allowlist are documented in [`supabase/email-templates/README.md`](supabase/email-templates/README.md). The default Supabase SMTP has sending restrictions, so configure an email provider for your use case. Without `mailer_otp_length = 6` the code in the email is 8 digits and the six-cell input will not accept it. Audio is private per user, with short-lived signed URLs and row-level security. Demo playback works without an account. Uploads are limited to 50 MB. No claim of zero network latency is made: playback streams and actual start time depends on the browser and connection.

The UI and audio engine run entirely in the browser, with no native API dependency. A future Tauri shell can host a static client after configuring Next static export; Supabase and Auth redirect/deep-link policies must be configured for the desktop origin. No Rust shell is included yet.

## Interface

The interface is fully bilingual (Russian default, English in Settings ⇄ Onboarding); the language is stored in `localStorage` and mirrored to `public.profiles.preferences`. Onboarding is a five-step constructor (taste, accent, layout, player, playback) that can be skipped at any step, applies live through the preview, and writes the same preferences the Settings panel edits — the two never diverge, and «Пройти заново» restarts the wizard.

The hero carries a live waveform (Web Audio analyser for local files, an idle wave otherwise) plus a mood selector. Playback opens the “Now playing” side panel, which shifts the content column instead of covering it, with artist info, suggestions and actions; the queue panel reorders and removes rows; the fullscreen player shows LRCLIB lyrics (via `/api/lyrics`) synced to playback and the waveform. Player hotkeys are matched by `lib/hotkeys.ts` and listed in Settings → Profile; a sleep timer fades the last seconds out (`lib/fade.ts`), and «До конца трека» stops playback at the end of the current track. Playlists can be renamed, given a custom cover and deleted. Everything honours `prefers-reduced-motion`, and PWA install is supported via `app/manifest.ts`.

Recommendations never hang: shelves load behind a hard 4-second client deadline, are topped up from fresh mixes so a shelf is never an empty shelf, and anything that came from a fallback is labelled as a fallback rather than as a personal pick. Blocking a track (“Не рекомендовать”) applies on the client immediately — the card disappears before the server list finishes loading — is undoable from the notice, and is managed in Settings → Blacklist.

## Catalogue and recommendations

YouTube search and trending use fixed third-party Piped/Invidious mirrors. Radio and similar tracks try the undocumented YouTube radio-mix endpoint and Deezer related-artist metadata, mapping Deezer songs to YouTube search results; neither source is guaranteed to work or remain stable. Playback uses the official YouTube IFrame Player API in the browser, not those mirrors' audio URLs. The app keeps two hidden 2×2 iframes using the youtube-nocookie.com embed host: one plays and the other cues the next known queue item. On a ready cue it swaps players; otherwise it loads normally. YouTube documents that cueing does not download video and neither buffering nor gapless/zero-millisecond transitions are guaranteed. Shuffle, radio fetches and unavailable videos may cause a normal delay. This hidden playback conflicts with YouTube policies and may be blocked; 2×2 is below YouTube’s required 200×200 minimum and may prevent playback. The app does not itself pause when the tab loses visibility, but browser or provider restrictions can still interrupt playback. Playback can fail due to embedding restrictions, region, a blocked script, or browser autoplay policy; retry using the bottom Play button or choose another track. The bottom controls synchronize with the iframe. Media Session supplies metadata and play, pause, next, and previous handlers where supported; it cannot prevent a browser or provider from suspending background playback, and behavior varies by browser (including Firefox).

Search also offers Deezer (explicitly marked 30-second previews only) and experimental unofficial JioSaavn mirrors. These third parties can fail, block requests, differ by region, or change their responses, and rights or availability are not guaranteed. SoundCloud search opens the service's own site; a public track URL can be pasted into the SoundCloud widget. SoundCloud controls are in the widget, separate from the bottom player. Official SoundCloud API search/stream integration requires an approved application and credentials; no third-party client ID is used. Stream URLs are not saved to Supabase; client IPs are visible to content providers. Apply `003_alternative_sources.sql` for saving alternative-track likes and playlists.

Apply `supabase/migrations/002_listening_history.sql` after the initial migration. For signed-in users, likes, playlist additions, skips before 10 seconds of actual playback, listens of at least five seconds, and listens exceeding 70% are stored in RLS-protected `listening_history`. Seeking is not counted as listening. Guests keep likes, listens, completions and skips in localStorage on this browser; clearing site data removes them, and they are not automatically merged into an account. The recommendations endpoint validates the user's access token and reads only that user's data under RLS; it never uses a service-role key. Related items and the three most positively weighted artists drive a simple heuristic. Tracks skipped at least twice are excluded. Trending items come from third-party regional endpoints and are not guaranteed to be music; if unavailable, the interface labels the results as popular search queries. Tracks played in the last 24 hours are excluded from new wave recommendations for guests and signed-in users, and adjacent tracks are chosen from different artists where possible. If neither provider works, radio reports an error instead of pretending that an artist search is a similar-track mix. Apply `004_listen_events.sql` before enabling the new listen event. This is not Spotify's recommendation model. Delete history from the Supabase table if requested; there is currently no in-app deletion interface.

Run `npm test` for offline mirror-failover, normalization and taste-ranking tests. Because the catalogue and recommendations now use Next.js API routes, a future Tauri static client needs a deployed API backend and appropriate native-origin/CORS and auth redirect configuration; static export alone is not sufficient.

## Glass effects

Translucent CSS surfaces use backdrop blur and static edge highlights, with an SVG edge displacement map and separate RGB offsets as progressive enhancement where supported. Browsers that do not support SVG backdrop filters use the gradient-only treatment. Effects and frame rate depend on browser, device and compositor; reduced-motion preferences are respected.

Home recommendations use a 3.8-second server deadline and 5-second client deadline. If upstream sources fail or time out, an explicitly labelled, non-personal editorial selection is shown; availability of the linked videos can vary by region. It is not a live chart and is not filtered against listening history.

Guest and account users can start My Wave using up to ten recent listened or liked seeds. The browser sends history in a POST body, not a URL; the server tries a random seed against YouTube Mix and Deezer related artists. The queue requests another batch at its end, but it can stop when providers fail or no unseen tracks remain. With no history, live regional charts are shuffled; if unavailable, a labelled shuffled editorial fallback is used. Changing the embed host and hiding frames is not a reliable defence against extensions; the IFrame API loader remains at the officially documented www.youtube.com address. These hidden 2×2 embeds conflict with YouTube player requirements and policies, and browser/provider background playback remains unreliable.

## Recommendation blocks and motion

Apply `supabase/migrations/005_recommendation_blocks.sql` before deploying the blacklist. Each account's block list is RLS-protected. The “Не рекомендовать” control also saves a browser-local copy and immediately removes the track from recommendation shelves and future queue entries; the current track is skipped if playing. A toast offers undo. Local blocks remain in that browser even after signing out; clearing site data removes the local copy. Guest blocks are not automatically uploaded when signing in, but remain effective in that browser. Account blocks are loaded from Supabase, and failures are reported rather than silently showing unfiltered recommendations. Requests carry guest exclusions in a POST body, including for radio, home fallbacks and the wave. Track identity and normalized title/artist are matched; the backend also supports artist blocks, though the interface currently blocks tracks only. Manually selected library tracks are not deleted.

The interface uses Framer Motion springs and respects reduced-motion settings. The Command/Control-K search and playlist creation dialogs open in the app. Recommendation and playback tests use mocked sources; external providers and actual background YouTube playback remain subject to availability and the limitations above.
