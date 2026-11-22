import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/** Типы verify, которые приходят из писем Nocturne. */
const ALLOWED_TYPES = new Set(['email', 'magiclink', 'recovery', 'invite', 'signup', 'email_change']);
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,200}$/;

/** Открытый редирект запрещён: только локальный путь этого же приложения. */
function safeNext(value: string | null) {
  const next = (value || '/').trim();
  return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}

/**
 * Резервная кнопка «Войти автоматически в 1 клик» в письме ведёт сюда.
 * Сессию забираем сервером, а клиенту отдаём токены во фрагменте URL —
 * он не уходит ни в один запрос и сразу стирается страницей /auth/complete.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const fail = (reason: string) => NextResponse.redirect(new URL(`/auth/complete?auth=error&reason=${encodeURIComponent(reason)}`, req.url), { status: 307, headers: { 'Cache-Control': 'no-store' } });

  const tokenHash = url.searchParams.get('token_hash') || '';
  const type = (url.searchParams.get('type') || 'email').toLowerCase();
  if (!TOKEN_HASH.test(tokenHash)) return fail('token');
  if (!ALLOWED_TYPES.has(type)) return fail('type');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return fail('config');

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' } });
  const { data, error } = await db.auth.verifyOtp({ token_hash: tokenHash, type: type as 'email' });
  if (error || !data.session) return fail('verify');

  const fragment = new URLSearchParams({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return NextResponse.redirect(new URL(`/auth/complete?next=${encodeURIComponent(next)}#${fragment.toString()}`, req.url), { status: 307, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
