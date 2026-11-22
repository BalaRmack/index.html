'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ClipboardPaste, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Translate } from '@/lib/i18n';
import OtpCodeInput from './OtpCodeInput';
import Presence from './Presence';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const spring = { type: 'spring' as const, stiffness: 350, damping: 30 };

/**
 * Вход и регистрация одним 6-значным кодом: шаг почты → шаг кода.
 * `signInWithOtp` вызывается без emailRedirectTo, поэтому письмо несёт {{ .Token }},
 * а не ссылку, и `verifyOtp` завершает вход.
 */
export default function EmailOtpForm({ t, reducedMotion = false, onSignedIn }: { t: Translate; reducedMotion?: boolean; onSignedIn: (email: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'verifying'>('idle');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState('');
  // Код из буфера может быть длиннее шести ячеек, пока в Supabase настроен восьмизначный OTP.
  const pastedCode = useRef('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const describe = useCallback((message: string) => {
    const text = String(message || '');
    if (/rate limit|too many|slow down/i.test(text)) return t('authRateLimited');
    if (/expired/i.test(text)) return t('authExpired');
    if (/token|does not match|invalid otp|not valid/i.test(text)) return t('authWrongCode');
    return text;
  }, [t]);

  const sendCode = useCallback(async (resend: boolean) => {
    if (!supabase) { setError(t('authSupabaseMissing')); return; }
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) { setError(t('authInvalidEmail')); return; }
    setStatus('sending'); setError(''); setInvalid(false);
    const { error: sendError } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (!alive.current) return;
    setStatus('idle');
    if (sendError) { setError(describe(sendError.message)); return; }
    setSentTo(address);
    setCode(''); pastedCode.current = '';
    setStep('code');
    setCooldown(RESEND_SECONDS);
    setFocusKey((value) => value + 1);
  }, [email, describe, t]);

  const verify = useCallback(async (token: string) => {
    if (!supabase) { setError(t('authSupabaseMissing')); return; }
    const value = String(token).replace(/\D+/g, '');
    if (value.length < CODE_LENGTH || status === 'verifying') return;
    setStatus('verifying'); setError(''); setInvalid(false);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: sentTo || email.trim().toLowerCase(), token: value, type: 'email' });
    if (!alive.current) return;
    setStatus('idle');
    if (verifyError) {
      setInvalid(true); setCode(''); pastedCode.current = ''; setFocusKey((value) => value + 1);
      setError(describe(verifyError.message));
      return;
    }
    setCode(''); setStep('email'); setEmail(sentTo || email);
    onSignedIn(sentTo || email.trim().toLowerCase());
  }, [sentTo, email, status, describe, onSignedIn, t]);

  const submitCode = useCallback((digits: string, raw: string) => {
    // Вставили восемь цифр — отправляем их целиком, шесть ячеек только показывают начало.
    const token = raw.length > digits.length ? raw : digits;
    pastedCode.current = raw.length > CODE_LENGTH ? token : '';
    void verify(token);
  }, [verify]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      const text = await navigator.clipboard.readText();
      const candidates = String(text).match(/\d{6,12}/g) ?? [];
      const digits = candidates.sort((a, b) => b.length - a.length)[0];
      if (!digits) { setError(t('clipboardEmpty')); return; }
      pastedCode.current = digits.length > CODE_LENGTH ? digits : '';
      setCode(digits.slice(0, CODE_LENGTH));
      setInvalid(false); setError('');
      void verify(digits);
    } catch {
      setError(t('clipboardDenied'));
    }
  }, [verify, t]);

  const busy = status !== 'idle';

  return (
    <div className="otp-form">
      <Presence reduced={reducedMotion} mode="wait" initial={false}>
        {step === 'email' ? (
          <motion.form
            key="email"
            className="otp-step"
            onSubmit={(event) => { event.preventDefault(); void sendCode(false); }}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
            transition={spring}
          >
            <label htmlFor="otp-email">{t('emailLabel')}</label>
            <div className="otp-field">
              <Mail size={16} aria-hidden="true" />
              <input
                id="otp-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setError(''); }}
                autoComplete="email"
                inputMode="email"
                required
              />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy && status === 'sending' ? t('sending') : t('getCode')} <ArrowRight size={16} />
            </button>
            <small>{t('authNoPassword')}</small>
          </motion.form>
        ) : (
          <motion.div
            key="code"
            className="otp-step"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 14 }}
            transition={spring}
          >
            <div className="otp-sent-to">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>{t('codeSent', { email: sentTo })}</span>
            </div>
            <span className="otp-code-label">{t('codeLabel')}</span>
            <OtpCodeInput
              length={CODE_LENGTH}
              value={code}
              onChange={(digits) => { pastedCode.current = ''; setCode(digits); setInvalid(false); }}
              onComplete={submitCode}
              disabled={busy}
              invalid={invalid}
              focusKey={focusKey}
              reducedMotion={reducedMotion}
              label={t('codeLabel')}
            />
            <button className="otp-paste" type="button" onClick={() => void pasteFromClipboard()} disabled={busy}>
              <ClipboardPaste size={15} /> {t('pasteFromClipboard')}
            </button>
            <button className="primary" type="button" disabled={busy || code.length < CODE_LENGTH} onClick={() => void verify(pastedCode.current || code)}>
              {status === 'verifying' ? t('verifying') : t('verify')} <ArrowRight size={16} />
            </button>
            <div className="otp-resend">
              <button type="button" disabled={busy || cooldown > 0} onClick={() => void sendCode(true)}>
                {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resendCode')}
              </button>
              <button type="button" className="otp-back" onClick={() => { setStep('email'); setCode(''); pastedCode.current = ''; setError(''); setCooldown(0); }}>
                <ArrowLeft size={14} /> {t('changeEmail')}
              </button>
            </div>
            {cooldown > 0 && (
              <motion.div className="otp-timer" aria-hidden="true">
                <motion.i
                  initial={false}
                  animate={{ scaleX: cooldown / RESEND_SECONDS }}
                  transition={{ duration: 1, ease: 'linear' }}
                  style={{ transformOrigin: 'left' }}
                />
              </motion.div>
            )}
          </motion.div>
        )}
      </Presence>
      <Presence reduced={reducedMotion}>
        {error && (
          <motion.p key={error} className="otp-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </Presence>
    </div>
  );
}
