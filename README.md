# Nocturne

A music player built with Next.js App Router, TypeScript, Tailwind CSS, Supabase and Web Audio. The included demo is “Outfoxing the Fox” by Kevin MacLeod (Creative Commons), sourced from [MDN webaudio-examples](https://github.com/mdn/webaudio-examples). Upload only audio you have permission to use.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and publishable key.
3. Apply `supabase/migrations/001_initial.sql` to a new Supabase project. Configure the Auth site URL and redirect allowlist for your deployed domain and local URL.
4. `npm run dev`.

Email magic links require an Auth email provider configured for your use case; the default Supabase SMTP has restrictions. Audio is private per user, with short-lived signed URLs and row-level security. Demo playback works without an account. Uploads are limited to 50 MB. No claim of zero network latency is made: playback streams and actual start time depends on the browser and connection.

The UI and audio engine run entirely in the browser, with no native API dependency. A future Tauri shell can host a static client after configuring Next static export; Supabase and Auth redirect/deep-link policies must be configured for the desktop origin. No Rust shell is included yet.
