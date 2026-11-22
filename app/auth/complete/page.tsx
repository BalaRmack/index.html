'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AudioLines } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * Страница-приёмник после «Войти автоматически в 1 клик».
 * Забирает токены из фрагмента URL, сохраняет сессию и немедленно стирает их из адресной строки.
 */
export default function AuthCompletePage() {
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const query = new URLSearchParams(window.location.search);
      const rawNext = query.get('next') || '/';
      const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
      if (query.get('auth') === 'error') {
        if (!cancelled) setState('error');
        window.setTimeout(() => { if (!cancelled) router.replace(next); }, 4000);
        return;
      }
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      // Токены не должны оставаться в истории и в address bar.
      window.history.replaceState(null, '', '/auth/complete');
      if (!accessToken || !refreshToken || !supabase) {
        if (!cancelled) setState('error');
        window.setTimeout(() => { if (!cancelled) router.replace(next); }, 4000);
        return;
      }
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (cancelled) return;
      setState(error ? 'error' : 'done');
      // Фрагмент больше не нужен: убираем его и у адресной строки после возврата на главную.
      window.setTimeout(() => { if (cancelled) return; window.history.replaceState(null, '', next); router.replace(next); }, error ? 3500 : 700);
    }
    void run();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="auth-complete">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
        <span className="brand-icon"><AudioLines size={22} /></span>
        <h1>{state === 'error' ? 'Не удалось войти по ссылке' : state === 'done' ? 'Готово' : 'Входим…'}</h1>
        <p>
          {state === 'error'
            ? 'Ссылка устарела или уже использована. Вернитесь на главную и запросите новый код.'
            : 'Nocturne сохраняет сессию и подтягивает вашу библиотеку.'}
        </p>
        {state === 'working' && (
          <span className="auth-complete-bar" aria-hidden="true">
            <motion.i animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }} />
          </span>
        )}
        <button className="primary" onClick={() => router.replace('/')}>На главную</button>
      </motion.div>
    </main>
  );
}
