# Письма Nocturne для Supabase Auth

Два готовых HTML-шаблона в тёмной стилистике Nocturne (фон `#0D110E`, акцент `#1ED760`,
логотип `nocturne.`, полностью по-русски, без упоминаний Supabase):

| Файл | Куда вставляется | Когда уходит |
| --- | --- | --- |
| `magic-link.html` | **Authentication → Emails → Magic Link** | Основной путь входа: `signInWithOtp` без `emailRedirectTo` присылает 6-значный код `{{ .Token }}` |
| `confirm-signup.html` | **Authentication → Emails → Confirm Signup** | Подтверждение адреса при классическом `signUp()` |

В обоих письмах:

* код выведен крупно моноширинным шрифтом в отдельной карточке с `user-select: all`
  (один клик — выделяется весь код, дальше Ctrl/Cmd+C);
* есть резервная кнопка **«Войти автоматически в 1 клик»** со ссылкой
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` — её принимает
  маршрут [`app/auth/confirm/route.ts`](../../app/auth/confirm/route.ts), который проверяет
  токен сервером и отдаёт сессию клиенту через `/#access_token=…` (фрагмент никуда не отправляется
  и сразу стирается страницей `/auth/complete`);
* в `confirm-signup.html` дополнительно оставлена ссылка `{{ .ConfirmationURL }}`.

## 1. Вставка шаблонов через Dashboard

1. Supabase Dashboard → выбрать проект **nocturne-music** (`syxuodjjkehiqbnwhlme`).
2. Слева: **Authentication → Emails** (в старых версиях — **Authentication → URL Configuration / Templates**).
3. Вкладка **Magic Link** → кнопка **Edit template**.
4. Открыть вкладку **Content** (HTML), удалить всё, что там было, вставить содержимое
   `magic-link.html` целиком (вместе с `<!doctype html>`), нажать **Save**.
5. Вкладка **Confirm Signup** → **Edit template → Content** → содержимое `confirm-signup.html` → **Save**.
6. Там же, в поле **Subject**, заменить темы на русские:
   * Magic Link: `{{ .Token }} — код входа в Nocturne`
     (код в теме — чтобы его было видно в списке писем и не всегда открывать письмо);
   * Confirm Signup: `Подтвердите почту в Nocturne`.

Шаблоны можно задать и CLI: `supabase templates import` (нужен Supabase CLI ≥ 2.x) —
структура та же: `supabase/templates/magiclink.html`.

## 2. Обязательные настройки Auth (без них код из 6 цифр не сойдётся)

**Authentication → Sign In / Up → Email (Providers → Email):**

| Параметр | Значение | Зачем |
| --- | --- | --- |
| Length of OTP (`mailer_otp_length`) | **6** | Сейчас в проекте стоит **8**: код из 8 цифр не влезет в шесть ячеек и `verifyOtp` его не примет. В UI шесть ячеек, поэтому значение должно быть 6 |
| OTP expiry (`mailer_otp_exp`) | **600** | Текст письма обещает 10 минут; сейчас стоит 3600 |
| Site URL (`site_url`) | `https://nocturne-music-player-chi.vercel.app` | Из него собирается `{{ .SiteURL }}` в кнопке письма |
| Redirect URLs (`uri_allow_list`) | добавить `https://nocturne-music-player-chi.vercel.app/auth/complete` и `http://localhost:3000/auth/complete` | Чтобы вход по ссылке из письма возвращал пользователя в приложение |

**Authentication → Rate limits:** параметр `rate_limit_email_sent` по умолчанию **2 письма в час** —
кнопка «Отправить код ещё раз» с таймером 60 секунд упрётся в него мгновенно. Поставьте **6–10**.

**Authentication → SMTP settings:** штатный отправитель Supabase годится для разработки, но режет
частоту и чаще попадает в спам. Для боевого проекта включите свой SMTP (отправитель вида
`nocturne@ваш-домен`) — шаблон от этого не меняется.

### Если нужных полей в Dashboard нет — готовый скрипт

```bash
npm run auth:check          # показать, что differs от нужного (ничего не пишет)
npm run auth:apply          # применить: длина кода 6, срок 600, site URL, редиректы, rate limit + письма
```

Нужен `SUPABASE_ACCESS_TOKEN` (https://supabase.com/dashboard/account/tokens). Скрипт —
`supabase/configure-auth.mjs`: он перечитывает конфиг после записи и печатает OK/FAIL по каждому
ключу, а при отказе Supabase принять HTML писем дописывает хотя бы критичные параметры. Запускать
на своей машине: у песочницы Arena нет доступа к api.supabase.com.

### Если нужных полей в Dashboard нет — Management API

```bash
# sbp_-токен: https://supabase.com/dashboard/account/tokens
curl -X PATCH "https://api.supabase.com/v1/projects/syxuodjjkehiqbnwhlme/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"mailer_otp_length":6,"mailer_otp_exp":600,"site_url":"https://nocturne-music-player-chi.vercel.app"}'

# HTML писем тем же API (body — строка с разметкой):
python3 - <<'PY'
import json, os, pathlib, urllib.request
ref = "syxuodjjkehiqbnwhlme"
token = os.environ["SUPABASE_ACCESS_TOKEN"]
body = {
    "mailer_templates_magic_link_content": pathlib.Path("supabase/email-templates/magic-link.html").read_text(),
    "mailer_templates_confirmation_content": pathlib.Path("supabase/email-templates/confirm-signup.html").read_text(),
    "mailer_subjects_magic_link": "{{ .Token }} — код входа в Nocturne",
    "mailer_subjects_confirmation": "Подтвердите почту в Nocturne",
}
request = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/config/auth",
    data=json.dumps(body).encode(), method="PATCH",
    headers={"Authorization": f"Bearer {token}", "content-type": "application/json"},
)
print(urllib.request.urlopen(request).read().decode()[:200] or "ok")
PY
```

Через API в этом репозитории обновить шаблоны не удалось (токена Management API в песочнице нет),
поэтому они сохранены здесь и ждут вставки в Dashboard.

## 3. Что ещё связано со входом в коде

* Форма входа: `components/EmailOtpForm.tsx` (шаг почты → шаг кода, вставка из буфера,
  таймер 60 секунд) и `components/OtpCodeInput.tsx` (6 ячеек, `onPaste` раскладывает код по
  ячейкам и сразу отправляет на проверку).
* Вставка принимает и 8 цифр — до тех пор, пока `mailer_otp_length` не переведён на 6, вход
  по «Вставить код из буфера» всё равно работает.
* Кнопка-ссылка из письма ведёт на `/auth/confirm`, который после проверки отдаёт сессию
  на `/auth/complete`.
