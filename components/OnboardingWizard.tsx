'use client';

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, LayoutGrid, Music2, Palette, Sparkles, Volume2, X } from 'lucide-react';
import { ACCENTS, GENRES, ONBOARDING_ARTISTS, type Accent, type GlassLevel, type Language, type NowPlayingMode, type ParticlesMode, type PlayerStyle, type Preferences, type SidebarLayout } from '@/lib/preferences';
import type { Translate } from '@/lib/i18n';
import Presence from './Presence';

const spring = { type: 'spring' as const, stiffness: 320, damping: 30 };

type Props = {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  t: Translate;
  reduced: boolean;
  onDone: () => void;
  onSkip: () => void;
};

/** Мини-макет экрана: раскладка меняется вживую, пока пользователь выбирает. */
function LayoutPreview({ prefs, direction }: { prefs: Preferences; direction: number }) {
  const reduced = Boolean(useReducedMotion());
  const accent = ACCENTS[prefs.accent] ?? ACCENTS.nocturne;
  const compact = prefs.sidebar === 'compact';
  const panelLeft = prefs.nowPlaying === 'left';
  return (
    <motion.div layout transition={spring} className="preview-screen" style={{ ['--preview-accent' as string]: accent.green } as React.CSSProperties}>
      <motion.aside layout className="preview-sidebar" animate={{ width: compact ? 42 : 92 }} transition={spring}>
        <span className="preview-dot" />
        {!compact && [0, 1, 2].map((row) => <span key={row} className="preview-line" />)}
      </motion.aside>
      <motion.div layout className="preview-content">
        <div className="preview-cards">
          {[0, 1, 2, 3].map((card) => <motion.span key={card} layout className="preview-card" animate={{ opacity: [0.6, 1, 0.6][card % 3] }} transition={{ duration: 3 + card, repeat: 2, ease: 'easeInOut' }} />)}
        </div>
        <Presence reduced={reduced} initial={false}>
          {!panelLeft && (
            <motion.aside key="panel" className="preview-panel" initial={{ opacity: 0, x: direction >= 0 ? 18 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={spring}>
              <span className="preview-art" />
              <span className="preview-line short" />
            </motion.aside>
          )}
        </Presence>
      </motion.div>
      <motion.div layout className={`preview-player${prefs.playerStyle === 'floating' ? ' is-floating' : ''}`} transition={spring} />
    </motion.div>
  );
}

function Option({ active, label, hint, onClick, reduced, children }: { active: boolean; label: string; hint?: string; onClick: () => void; reduced: boolean; children?: React.ReactNode }) {
  return (
    <motion.button type="button" className={active ? 'pick on' : 'pick'} onClick={onClick} whileHover={reduced ? undefined : { y: -2 }} whileTap={reduced ? undefined : { scale: 0.98 }} transition={spring} aria-pressed={active}>
      {children}
      <span className="pick-body">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      {active && <motion.span className="pick-check" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}><Check size={14} /></motion.span>}
    </motion.button>
  );
}

/**
 * Мастер первоначальной настройки. Настройки применяются сразу (живое превью всего
 * интерфейса), а на каждом шаге есть «Пропустить», «Назад» и счётчик шагов.
 */
export default function OnboardingWizard({ prefs, setPref, t, reduced, onDone, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [customArtist, setCustomArtist] = useState('');
  const steps = useMemo(() => ['language', 'appearance', 'layout', 'sound', 'taste'] as const, []);
  const total = steps.length;
  const go = (next: number) => { setDirection(next > step ? 1 : -1); setStep(Math.max(0, Math.min(total - 1, next))); };

  const toggleGenre = (id: string) => {
    const next = prefs.genres.includes(id) ? prefs.genres.filter((item) => item !== id) : [...prefs.genres, id].slice(0, GENRES.length);
    setPref('genres', next);
  };
  const toggleArtist = (name: string) => {
    const next = prefs.artists.includes(name) ? prefs.artists.filter((item) => item !== name) : [...prefs.artists, name].slice(0, 6);
    setPref('artists', next);
  };

  const titles: Record<typeof steps[number], [string, string]> = {
    language: [t('onboardingLanguage'), t('onboardingLanguageText')],
    appearance: [t('onboardingAppearance'), t('onboardingAppearanceText')],
    layout: [t('onboardingLayout'), t('onboardingLayoutText')],
    sound: [t('onboardingSound'), t('onboardingSoundText')],
    taste: [t('onboardingTaste'), t('onboardingTasteText')],
  };
  const icons = [Palette, Sparkles, LayoutGrid, Volume2, Music2];
  const Icon = icons[step] ?? Sparkles;

  return (
    <motion.div className="wizard-backdrop" initial={reduced ? { opacity: 0 } : { opacity: 0, backdropFilter: 'blur(0px)' }} animate={{ opacity: 1, backdropFilter: 'blur(26px)' }} transition={{ duration: reduced ? 0 : 0.3 }}>
      <motion.div
        className="wizard-shell glass"
        role="dialog"
        aria-modal="true"
        aria-label={t('onboardingWelcome')}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
      >
        <header className="wizard-head">
          <div className="wizard-progress">
            {Array.from({ length: total }, (_, index) => (
              <motion.span key={index} className={index <= step ? 'on' : undefined} layout transition={spring} />
            ))}
            <span className="wizard-step-label">{t('onboardingStepOf', { current: step + 1, total })}</span>
          </div>
          <button className="wizard-skip" onClick={onSkip}>{t('onboardingSkip')} <X size={14} /></button>
        </header>

        {/* Смена шага не ждёт завершения анимации предыдущего: контент обязан появиться даже
            на «замороженном» фоне (фоновая вкладка, слабый телефон, тестовый рантайм). */}
        <motion.div
            key={steps[step]}
            className="wizard-body"
            custom={direction}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 34 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, opacity: { duration: reduced ? 0 : 0.18 } }}
          >
            <div className="wizard-title">
              <span className="wizard-icon"><Icon size={18} /></span>
              <div>
                <h2>{titles[steps[step]][0]}</h2>
                <p>{titles[steps[step]][1]}</p>
              </div>
            </div>

            {step === 0 && (
              <div className="pick-grid">
                <Option reduced={reduced} active={prefs.language === 'ru'} label="Русский" hint="Основная раскладка и подписи" onClick={() => setPref('language', 'ru' as Language)} />
                <Option reduced={reduced} active={prefs.language === 'en'} label="English" hint="Same layout, English labels" onClick={() => setPref('language', 'en' as Language)} />
              </div>
            )}

            {step === 1 && (
              <>
                <div className="accent-strip">
                  {(Object.keys(ACCENTS) as Accent[]).map((id) => (
                    <motion.button
                      key={id}
                      type="button"
                      className={prefs.accent === id ? 'accent-swatch on' : 'accent-swatch'}
                      style={{ background: `linear-gradient(140deg, ${ACCENTS[id].green}, ${ACCENTS[id].deep})` }}
                      onClick={() => setPref('accent', id)}
                      whileHover={reduced ? undefined : { y: -4, scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      aria-label={prefs.language === 'en' ? ACCENTS[id].labelEn : ACCENTS[id].label}
                    >
                      <span>{prefs.language === 'en' ? ACCENTS[id].labelEn : ACCENTS[id].label}</span>
                    </motion.button>
                  ))}
                </div>
                <div className="pick-grid three">
                  <Option reduced={reduced} active={prefs.glass === 'off'} label={t('glassOff')} onClick={() => setPref('glass', 'off' as GlassLevel)} />
                  <Option reduced={reduced} active={prefs.glass === 'soft'} label={t('glassSoft')} onClick={() => setPref('glass', 'soft' as GlassLevel)} />
                  <Option reduced={reduced} active={prefs.glass === 'full'} label={t('glassFull')} onClick={() => setPref('glass', 'full' as GlassLevel)} />
                </div>
                <div className="pick-grid three">
                  <Option reduced={reduced} active={prefs.particles === 'full'} label={t('particlesFull')} onClick={() => setPref('particles', 'full' as ParticlesMode)} />
                  <Option reduced={reduced} active={prefs.particles === 'eco'} label={t('particlesEco')} onClick={() => setPref('particles', 'eco' as ParticlesMode)} />
                  <Option reduced={reduced} active={prefs.particles === 'off'} label={t('particlesOff')} onClick={() => setPref('particles', 'off' as ParticlesMode)} />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <LayoutPreview prefs={prefs} direction={direction} />
                <p className="wizard-note">{t('previewLabel')}</p>
                <div className="pick-grid">
                  <Option reduced={reduced} active={prefs.sidebar === 'classic'} label={t('sidebarClassic')} onClick={() => setPref('sidebar', 'classic' as SidebarLayout)} />
                  <Option reduced={reduced} active={prefs.sidebar === 'compact'} label={t('sidebarCompact')} onClick={() => setPref('sidebar', 'compact' as SidebarLayout)} />
                </div>
                <div className="pick-grid three">
                  <Option reduced={reduced} active={prefs.nowPlaying === 'auto'} label={t('nowPlayingAuto')} onClick={() => setPref('nowPlaying', 'auto' as NowPlayingMode)} />
                  <Option reduced={reduced} active={prefs.nowPlaying === 'manual'} label={t('nowPlayingManual')} onClick={() => setPref('nowPlaying', 'manual' as NowPlayingMode)} />
                  <Option reduced={reduced} active={prefs.nowPlaying === 'left'} label={t('nowPlayingLeft')} onClick={() => setPref('nowPlaying', 'left' as NowPlayingMode)} />
                </div>
                <div className="pick-grid">
                  <Option reduced={reduced} active={prefs.playerStyle === 'attached'} label={t('playerAttached')} onClick={() => setPref('playerStyle', 'attached' as PlayerStyle)} />
                  <Option reduced={reduced} active={prefs.playerStyle === 'floating'} label={t('playerFloating')} onClick={() => setPref('playerStyle', 'floating' as PlayerStyle)} />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="pick-grid">
                  <Option reduced={reduced} active={prefs.autoplayWave} label={t('autoplayWaveLabel')} hint={t('autoplayWaveHint')} onClick={() => setPref('autoplayWave', !prefs.autoplayWave)} />
                  <Option reduced={reduced} active={prefs.normalizeVolume} label={t('normalizeLabel')} hint={t('normalizeHint')} onClick={() => setPref('normalizeVolume', !prefs.normalizeVolume)} />
                </div>
                <span className="setting-label">{t('crossfadeLabel')}</span>
                <div className="chip-row">
                  {[0, 3, 6, 12].map((value) => (
                    <motion.button key={value} type="button" className={prefs.crossfade === value ? 'chip on' : 'chip'} whileTap={{ scale: 0.95 }} onClick={() => setPref('crossfade', value)}>
                      {value === 0 ? t('crossfadeOff') : t('seconds', { value })}
                    </motion.button>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <span className="setting-label">{t('genresLabelPick')}</span>
                <div className="chip-row wrap">
                  {GENRES.map((genre) => (
                    <motion.button key={genre.id} type="button" className={prefs.genres.includes(genre.id) ? 'chip on' : 'chip'} whileTap={{ scale: 0.95 }} onClick={() => toggleGenre(genre.id)}>
                      {prefs.language === 'en' ? genre.en : genre.ru}
                    </motion.button>
                  ))}
                </div>
                <span className="setting-label">{t('artistsLabelPick')} <small>{prefs.artists.length}/6</small></span>
                <div className="chip-row wrap">
                  {[...new Set([...ONBOARDING_ARTISTS, ...prefs.artists])].map((artist) => (
                    <motion.button key={artist} type="button" className={prefs.artists.includes(artist) ? 'chip on' : 'chip'} whileTap={{ scale: 0.95 }} onClick={() => toggleArtist(artist)}>
                      {artist}
                    </motion.button>
                  ))}
                </div>
                <form
                  className="artist-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = customArtist.trim().slice(0, 40);
                    if (value && !prefs.artists.includes(value)) setPref('artists', [...prefs.artists, value].slice(0, 6));
                    setCustomArtist('');
                  }}
                >
                  <input value={customArtist} onChange={(event) => setCustomArtist(event.target.value)} placeholder={t('searchArtist')} aria-label={t('searchArtist')} />
                  <button type="submit" className="ghost">{t('addToPlaylist')} +</button>
                </form>
                <p className="wizard-note">{t('onboardingTasteHint')}</p>
              </>
            )}
          </motion.div>

        <footer className="wizard-foot">
          <button className="ghost" onClick={() => go(step - 1)} disabled={step === 0}>
            <ArrowLeft size={15} /> {t('onboardingBack')}
          </button>
          <motion.button
            className="primary"
            whileTap={reduced ? undefined : { scale: 0.95 }}
            onClick={() => (step === total - 1 ? onDone() : go(step + 1))}
          >
            {step === total - 1 ? t('onboardingDone') : t('onboardingNext')} <ArrowRight size={15} />
          </motion.button>
        </footer>
        {step === total - 1 && (
          <motion.p className="wizard-finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{t('onboardingFinishText')}</motion.p>
        )}
      </motion.div>
    </motion.div>
  );
}
