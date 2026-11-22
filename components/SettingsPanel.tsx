'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Moon, RotateCcw, Trash2, X } from 'lucide-react';
import type { PlayerBindings } from '@/lib/types';
import type { Preferences } from '@/lib/preferences';
import { ACCENTS, GENRES, type Accent, type GlassLevel, type NowPlayingMode, type ParticlesMode, type PlayerStyle, type SidebarLayout } from '@/lib/preferences';
import type { Block } from '@/lib/blacklist';
import { SLEEP_MINUTES, sleepEndOfTrack, sleepMinutes, sleepOff, type SleepTimer } from '@/lib/sleep-timer';
import { formatRemaining } from '@/lib/format';
import type { Translate } from '@/lib/i18n';

const spring = { type: 'spring' as const, stiffness: 360, damping: 30 };

type Option<T extends string | number> = { value: T; label: string };

function Segmented<T extends string | number>({ t, value, options, onChange, label }: { t: Translate; value: T; options: Option<T>[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <motion.button
            key={String(option.value)}
            type="button"
            className={option.value === value ? 'on' : undefined}
            onClick={() => onChange(option.value)}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.2 }}
          >
            {option.value === value && <motion.span layoutId={`seg-${label}`} className="segmented-bg" transition={spring} />}
            <span>{option.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row setting-toggle">
      <span>
        <span className="setting-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? 'switch on' : 'switch'} onClick={() => onChange(!checked)}>
        <motion.span layout transition={spring} />
      </button>
    </label>
  );
}

/** Панель настроек: всё, что выбирается в онбординге, плюс чёрный список, профиль и шпаргалка. */
export default function SettingsPanel({ player, prefs, setPref, blocks, onUnblock, onResetHistory, displayName, onDisplayName, signedIn, onRestartOnboarding, onClose, sleep, sleepLeft, onSleep, muted, onMute }: {
  player: PlayerBindings;
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  blocks: Block[];
  onUnblock: (block: Block) => void;
  onResetHistory: () => void;
  displayName: string;
  onDisplayName: (value: string) => void;
  signedIn: boolean;
  onRestartOnboarding: () => void;
  onClose: () => void;
  sleep: SleepTimer;
  sleepLeft: number | null;
  onSleep: (timer: SleepTimer) => void;
  muted: boolean;
  onMute: () => void;
}) {
  const t = player.t;
  const [section, setSection] = useState<'playback' | 'appearance' | 'reco' | 'profile'>('appearance');
  const [name, setName] = useState(displayName);

  return (
    <motion.aside
      className="now-playing-panel settings-panel glass"
      role="dialog"
      aria-modal="true"
      aria-label={t('settingsTitle')}
      initial={player.reduced ? { opacity: 0 } : { opacity: 0, x: 26 }}
      animate={{ opacity: 1, x: 0 }}
      exit={player.reduced ? { opacity: 0 } : { opacity: 0, x: 22 }}
      transition={player.reduced ? { duration: 0 } : spring}
    >
      <header className="panel-head">
        <div>
          <span className="panel-kicker">Nocturne</span>
          <h2>{t('settingsTitle')}</h2>
        </div>
        <button className="panel-close" aria-label={t('closePanel')} onClick={onClose}><X size={17} /></button>
      </header>

      <div className="settings-tabs" role="tablist">
        {([['appearance', t('settingsAppearance')], ['playback', t('settingsPlayback')], ['reco', t('settingsRecommendations')], ['profile', t('settingsProfile')]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : undefined} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      <div className="settings-body">
        {section === 'appearance' && (
          <>
            <Segmented t={t} label={t('languageLabel')} value={prefs.language} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} onChange={(value) => setPref('language', value)} />
            <div className="setting-row">
              <span className="setting-label">{t('themeLabel')}</span>
              <div className="accent-row">
                {(Object.keys(ACCENTS) as Accent[]).map((id) => (
                  <motion.button
                    key={id}
                    type="button"
                    className={prefs.accent === id ? 'accent-dot on' : 'accent-dot'}
                    style={{ background: ACCENTS[id].green }}
                    title={prefs.language === 'en' ? ACCENTS[id].labelEn : ACCENTS[id].label}
                    aria-label={prefs.language === 'en' ? ACCENTS[id].labelEn : ACCENTS[id].label}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setPref('accent', id)}
                  />
                ))}
              </div>
            </div>
            <Segmented t={t} label={t('glassLabel')} value={prefs.glass} options={[{ value: 'off', label: t('glassOff') }, { value: 'soft', label: t('glassSoft') }, { value: 'full', label: t('glassFull') }]} onChange={(value) => setPref('glass', value as GlassLevel)} />
            <Segmented t={t} label={t('particlesLabel')} value={prefs.particles} options={[{ value: 'full', label: t('particlesFull') }, { value: 'eco', label: t('particlesEco') }, { value: 'off', label: t('particlesOff') }]} onChange={(value) => setPref('particles', value as ParticlesMode)} />
            <Segmented t={t} label={t('sidebarLabel')} value={prefs.sidebar} options={[{ value: 'classic', label: t('sidebarClassic') }, { value: 'compact', label: t('sidebarCompact') }]} onChange={(value) => setPref('sidebar', value as SidebarLayout)} />
            <Segmented t={t} label={t('nowPlayingLabel')} value={prefs.nowPlaying} options={[{ value: 'auto', label: t('nowPlayingAuto') }, { value: 'manual', label: t('nowPlayingManual') }, { value: 'left', label: t('nowPlayingLeft') }]} onChange={(value) => setPref('nowPlaying', value as NowPlayingMode)} />
            <Segmented t={t} label={t('playerLabel')} value={prefs.playerStyle} options={[{ value: 'attached', label: t('playerAttached') }, { value: 'floating', label: t('playerFloating') }]} onChange={(value) => setPref('playerStyle', value as PlayerStyle)} />
            <div className="setting-row setting-stack">
              <span className="setting-label">{t('genresLabelPick')}</span>
              <div className="chip-row wrap">
                {GENRES.map((genre) => (
                  <button key={genre.id} type="button" className={prefs.genres.includes(genre.id) ? 'chip on' : 'chip'} onClick={() => setPref('genres', prefs.genres.includes(genre.id) ? prefs.genres.filter((id) => id !== genre.id) : [...prefs.genres, genre.id])}>
                    {player.prefs.language === 'en' ? genre.en : genre.ru}
                  </button>
                ))}
              </div>
            </div>
            <button className="ghost wide" onClick={onRestartOnboarding}><RotateCcw size={14} /> {t('resetOnboarding')}</button>
            <p className="settings-note">{t('installHint')}</p>
            <p className="settings-note">{t('syncNote')}</p>
          </>
        )}

        {section === 'playback' && (
          <>
            <Toggle label={t('autoplayWaveLabel')} hint={t('autoplayWaveHint')} checked={prefs.autoplayWave} onChange={(value) => setPref('autoplayWave', value)} />
            <div className="setting-row setting-stack">
              <span className="setting-label">{t('sleepTimer')} {sleep.kind !== 'off' && <small>{sleep.kind === 'track' ? t('sleepEndOfTrack') : formatRemaining(sleepLeft ?? 0)}</small>}</span>
              <div className="chip-row">
                {SLEEP_MINUTES.map((minutes) => (
                  <button key={minutes} type="button" className={sleep.kind === 'minutes' && Math.round((sleep.endsAt - Date.now()) / 60000) === minutes ? 'chip on' : 'chip'} onClick={() => onSleep(sleepMinutes(minutes))}>{t('minutes', { value: minutes })}</button>
                ))}
                <button type="button" className={sleep.kind === 'track' ? 'chip on' : 'chip'} onClick={() => onSleep(sleepEndOfTrack())}>{t('sleepEndOfTrack')}</button>
                <button type="button" className={sleep.kind === 'off' ? 'chip on' : 'chip'} onClick={() => onSleep(sleepOff())}>{t('sleepOff')}</button>
              </div>
              <small>{t('sleepFading')}</small>
            </div>
            <Toggle label={t('normalizeLabel')} hint={t('normalizeHint')} checked={prefs.normalizeVolume} onChange={(value) => setPref('normalizeVolume', value)} />
            <Segmented
              t={t}
              label={t('crossfadeLabel')}
              value={prefs.crossfade}
              options={[{ value: 0, label: t('crossfadeOff') }, { value: 3, label: t('seconds', { value: 3 }) }, { value: 6, label: t('seconds', { value: 6 }) }, { value: 12, label: t('seconds', { value: 12 }) }]}
              onChange={(value) => setPref('crossfade', Number(value))}
            />
            <p className="settings-note">{t('normalizeHint')}</p>
          </>
        )}

        {section === 'reco' && (
          <>
            <div className="setting-row setting-stack">
              <span className="setting-label">{t('blockedTracks')} <small>{t('blockedCount', { count: blocks.length })}</small></span>
              {blocks.length === 0 ? <p className="panel-muted">{t('blockedEmpty')}</p> : (
                <ul className="blocked-list">
                  {blocks.map((block) => (
                    <li key={`${block.kind}:${block.track_id}`}>
                      <span><b>{block.title || block.artist}</b><small>{block.kind === 'artist' ? t('artistPage') : t('colTitle')}{block.artist ? ` · ${block.artist}` : ''}</small></span>
                      <button onClick={() => onUnblock(block)}>{t('unblock')}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {prefs.genres.length > 0 && (
              <div className="setting-row setting-stack">
                <span className="setting-label">{t('genresLabelPick')}</span>
                <div className="chip-row">{prefs.genres.map((id) => <i key={id}>{GENRES.find((genre) => genre.id === id)?.[player.prefs.language === 'en' ? 'en' : 'ru'] ?? id}</i>)}</div>
              </div>
            )}
            {prefs.artists.length > 0 && (
              <div className="setting-row setting-stack">
                <span className="setting-label">{t('artistsLabelPick')}</span>
                <div className="chip-row">{prefs.artists.map((artist) => <button key={artist} onClick={() => player.onOpenArtist(artist)}>{artist}</button>)}</div>
              </div>
            )}
            <div className="setting-row setting-stack">
              <span className="setting-label">{t('resetHistory')}</span>
              <small>{t('resetHistoryHint')}</small>
              <button className="ghost danger wide" onClick={onResetHistory}><Trash2 size={14} /> {t('resetHistory')}</button>
            </div>
          </>
        )}

        {section === 'profile' && (
          <>
            <form
              className="setting-form"
              onSubmit={(event) => { event.preventDefault(); onDisplayName(name.trim().slice(0, 60)); }}
            >
              <label htmlFor="display-name">{t('displayName')}</label>
              <div className="otp-field">
                <input id="display-name" value={name} maxLength={60} placeholder={t('displayNamePlaceholder')} onChange={(event) => setName(event.target.value)} />
              </div>
              <button className="primary" type="submit" disabled={!signedIn}>{t('saveProfile')}</button>
              {!signedIn && <small>{t('noticeSignInFirst')}</small>}
            </form>
            <div className="setting-row setting-stack">
              <span className="setting-label">{t('hotkeys')}</span>
              <ul className="hotkey-list">
                <li><kbd>Space</kbd><span>{t('hotkeyPlay')}</span></li>
                <li><kbd>Shift + ←/→</kbd><span>{t('hotkeyNext')}</span></li>
                <li><kbd>M</kbd><span>{t('hotkeyMute')}</span></li>
                <li><kbd>L</kbd><span>{t('hotkeyLike')}</span></li>
                <li><kbd>Ctrl/⌘ + K</kbd><span>{t('hotkeySearch')}</span></li>
                <li><kbd>Esc</kbd><span>{t('hotkeyClose')}</span></li>
              </ul>
            </div>
          </>
        )}
      </div>
    </motion.aside>
  );
}
