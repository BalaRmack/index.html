#!/usr/bin/env node
/**
 * Настройка Supabase Auth под вход шестизначным кодом в Nocturne.
 *
 * Делает ровно то, что описано в supabase/email-templates/README.md (раздел 2), через
 * Management API — одним PATCH-запросом, и обязательно перечитывает конфиг после записи,
 * чтобы показать фактическое состояние, а не «окей» от API.
 *
 * Запуск (нужен токен https://supabase.com/dashboard/account/tokens):
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node supabase/configure-auth.mjs            # только показать разницу
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node supabase/configure-auth.mjs --apply    # применить
 *   ... --apply --no-templates                                                # не трогать HTML писем
 *
 * Ничего не пишет в репозиторий и не печатает токен. Значение ключа anon/publishable не трогает.
 */
const API = 'https://api.supabase.com/v1';
const args = new Set(process.argv.slice(2));
const flagValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const ref = flagValue('ref', 'syxuodjjkehiqbnwhlme');
const siteUrl = flagValue('site-url', 'https://nocturne-music-player-chi.vercel.app');
const apply = args.has('--apply');
const withTemplates = !args.has('--no-templates');
const token = process.env.SUPABASE_ACCESS_TOKEN || (args.has('--token') ? flagValue('token', '') : '');

// Обязательные значения: без первой строки вход по коду не работает в принципе.
const settings = {
  mailer_otp_length: 6,
  mailer_otp_exp: 600,
  site_url: siteUrl,
  uri_allow_list: `${siteUrl}/auth/complete,http://localhost:3000/auth/complete`,
  rate_limit_email_sent: Number(flagValue('email-rate-limit', 8)),
  mailer_autoconfirm: false,
};
const templateFiles = {
  mailer_templates_magic_link_content: 'supabase/email-templates/magic-link.html',
  mailer_templates_confirmation_content: 'supabase/email-templates/confirm-signup.html',
};
const subjects = {
  mailer_subjects_magic_link: '{{ .Token }} — код входа в Nocturne',
  mailer_subjects_confirmation: 'Подтвердите почту в Nocturne',
};

const die = (message, code = 1) => { console.error(`\n${message}\n`); process.exit(code); };

async function request(path, init = {}) {
  const soft = init.soft; delete init.soft;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  } catch (error) {
    die(`Нет доступа к api.supabase.com (${error?.cause?.code || error?.message}).\n`
      + 'Скрипт нужно запускать на своей машине, где есть интернет: песочница Arena ходит только в GitHub/npm/PyPI.', 3);
  }
  const text = await response.text();
  if (!response.ok && soft) return { ok: false, status: response.status, text };
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? 'Токен недействителен или не имеет доступа к проекту. Свежий read/write-токен: https://supabase.com/dashboard/account/tokens'
      : response.status === 404 ? `Проект ${ref} не найден для этого токена (verify: ${API.replace('/v1', '')}/projects).` : '';
    die(`Supabase ответил ${response.status} на ${init.method || 'GET'} ${path}\n${text.slice(0, 600)}${hint ? `\n\n${hint}` : ''}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Supabase на некоторых планах не принимает часть ключей одним запросом (например, HTML писем).
 * Поэтому сначала пробуем всё разом, а при 400 дописываем по частям — критичное
 * (длина кода, срок, редиректы) не должно теряться из-за шаблонов.
 */
async function patchAuth(body, { label }) {
  const result = await request(`/projects/${ref}/config/auth`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), soft: true });
  if (result.ok === false) {
    console.error(`\n${label}: Supabase отклонил пакет (${result.status}): ${result.text.slice(0, 240)}`);
    return false;
  }
  return true;
}

const format = (value) => (typeof value === 'string' && value.length > 64 ? `${value.slice(0, 61)}…` : String(value));

if (!token) {
  die('Нужен токен Management API: SUPABASE_ACCESS_TOKEN=sbp_xxx node supabase/configure-auth.mjs\n'
    + 'Получить: https://supabase.com/dashboard/account/tokens (права read/write, зона того же аккаунта).', 2);
}

const fs = await import('node:fs');
const current = await request(`/projects/${ref}/config/auth`);
const wanted = { ...settings, ...(withTemplates ? subjects : {}) };
if (withTemplates) {
  for (const [key, file] of Object.entries(templateFiles)) {
    if (!fs.existsSync(file)) die(`Не найден файл шаблона: ${file}. Запусти из корня репозитория или добавь --no-templates.`);
  }
}

const changes = Object.entries(wanted).filter(([key, value]) => String(current[key]) !== String(value));
console.log(`\nПроект: ${ref}\nSite URL: ${siteUrl}\nРежим: ${apply ? 'ПРИМЕНЕНИЕ' : 'только просмотр (добавь --apply)'}\n`);
console.log('параметр'.padEnd(38) + 'сейчас'.padEnd(30) + 'стало');
for (const [key, value] of Object.entries(wanted)) {
  const from = current[key];
  const mark = String(from) === String(value) ? '  ' : '* ';
  console.log(`${mark}${key}`.padEnd(38) + format(from).padEnd(30) + format(value));
}
if (withTemplates) {
  for (const [key, file] of Object.entries(templateFiles)) {
    const body = await import('node:fs/promises').then((m) => m.readFile(file, 'utf8'));
    const same = String(current[key] || '') === body;
    console.log(`${same ? '  ' : '* '}${key}`.padEnd(38) + (same ? 'уже совпадает с файлом' : `<- ${file} (${body.length} символов)`).padEnd(30));
  }
}

if (!changes.length && !withTemplates) console.log('\nВсе параметры уже в нужном состоянии.');
if (!apply) {
  console.log('\nНичего не менял. Чтобы применить: SUPABASE_ACCESS_TOKEN=… node supabase/configure-auth.mjs --apply\n');
  process.exit(0);
}

let appliedEverything = true;
{
  const patch = { ...settings };
  if (!(await patchAuth(patch, { label: 'параметры Auth' }))) {
    // Откатываемся на самый важный набор: без него шестизначный код не примут вовсе.
    const minimum = { mailer_otp_length: settings.mailer_otp_length, mailer_otp_exp: settings.mailer_otp_exp, site_url: settings.site_url };
    if (!(await patchAuth(minimum, { label: 'минимальный набор' }))) die('Supabase не принял даже минимальный набор — обнови токен или правь в Dashboard.');
    appliedEverything = false;
  }
}
if (withTemplates) {
  const mfs = await import('node:fs/promises');
  const bodies = {};
  for (const [key, file] of Object.entries(templateFiles)) bodies[key] = await mfs.readFile(file, 'utf8');
  const bundle = { ...subjects, ...bodies };
  if (!(await patchAuth(bundle, { label: 'темы и HTML писем' }))) {
    console.error('  → темы и шаблоны можно вставить руками: Dashboard → Authentication → Emails (файлы лежат в supabase/email-templates/).');
    appliedEverything = false;
  }
}

const after = await request(`/projects/${ref}/config/auth`);
const bad = Object.entries(wanted).filter(([key, value]) => String(after[key]) !== String(value));
console.log('');
for (const key of Object.keys(wanted)) {
  console.log(`${String(after[key]) === String(wanted[key]) ? 'OK  ' : 'FAIL'} ${key} = ${format(after[key])}`);
}
if (withTemplates) {
  for (const [key, file] of Object.entries(templateFiles)) {
    const body = await import('node:fs/promises').then((m) => m.readFile(file, 'utf8'));
    console.log(`${String(after[key] || '') === body ? 'OK  ' : 'FAIL'} ${key} ${String(after[key] || '') === body ? `(${body.length} символов)` : `— Supabase сохранил другую длину (${String(after[key] || '').length}); проверь в Dashboard → Authentication → Emails`}`);
  }
}
if (bad.length || !appliedEverything) console.log('Часть ключей Supabase отдала другим значением или не приняла — смотри строки FAIL выше.');
if (bad.length) die(`Не применилось: ${bad.map(([k]) => k).join(', ')} — доделай руками в Dashboard → Authentication → Sign In / Up → Email.`);
console.log(`\nГотово. Проверка вживую: открой ${siteUrl}, «Войти», пришли себе код — в письме должно быть ровно 6 цифр,\nи кнопка в письме должна вести на ${siteUrl}/auth/confirm.\n`);
