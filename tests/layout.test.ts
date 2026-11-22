import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

test('recommendation shelves have a single non-shrinking card width',()=>{
  const css=postcss.parse(readFileSync('app/globals.css','utf8'));
  const declarations:Record<string,string>={};
  css.walkRules('.shelf-scroll .catalog-card',rule=>{if(rule.parent?.type==='root')rule.walkDecls(d=>{declarations[d.prop]=d.value})});
  assert.equal(declarations.flex,'0 0 176px');
  const shelf:Record<string,string>={};
  css.walkRules('.shelf-scroll',rule=>{if(rule.parent?.type==='root')rule.walkDecls(d=>{shelf[d.prop]=d.value})});
  assert.equal(shelf.display,'flex');assert.equal(shelf['overflow-x'],'auto');
});


test('background iframe stays mounted at 2px and cannot be clicked',()=>{
  const css=postcss.parse(readFileSync('app/globals.css','utf8'));
  const declarations:Record<string,string>={};
  css.walkRules('.youtube-background',rule=>rule.walkDecls(d=>{declarations[d.prop]=d.value}));
  assert.equal(declarations.position,'fixed');assert.equal(declarations.bottom,'0');assert.equal(declarations.left,'0');assert.equal(declarations['z-index'],'-1');assert.equal(declarations.width,'2px');assert.equal(declarations.height,'2px');assert.equal(Number(declarations.opacity),0);assert.equal(declarations['pointer-events'],'none');
});

test('OTP-поле: ячейка ограничивает input, а не выпускает его за модальное окно', () => {
  const css = postcss.parse(readFileSync('app/globals.css', 'utf8'));
  const decl = (selector: string) => {
    const out: Record<string, string> = {};
    css.walkRules(selector, (rule) => { if (rule.parent?.type === 'root') rule.walkDecls((d) => { out[d.prop] = d.value; }); });
    return out;
  };
  const row = decl('.otp-row'), cell = decl('.otp-cell'), input = decl('.otp-cell input');
  // Ряд не переносится и тянется ровно на ширину контента модалки.
  assert.equal(row['flex-wrap'], 'nowrap');
  assert.equal(row.width, '100%');
  // Ячейка — позиционированный контейнер с обрезкой: input физически не может вылезти.
  assert.equal(cell.position, 'relative');
  assert.equal(cell.overflow, 'hidden');
  assert.equal(cell['min-width'], '0');
  assert.equal(cell.flex, '1 1 0');
  assert.ok(cell['max-width'], 'на широком окне ячейки не растягиваются в пол-экрана');
  // Нативный input растянут на ячейку и без собственной рамки/фона: фокус-ринг совпадает с рамкой ячейки.
  assert.equal(input.position, 'absolute');
  assert.equal(input.inset, '0');
  assert.equal(input.width, '100%');
  assert.equal(input.height, '100%');
  assert.equal(input.outline, 'none');
  assert.equal(input.background, 'transparent');
  assert.equal(decl('.otp-cell input:focus-visible').outline, 'none');
  assert.ok(decl('.otp-cell.is-invalid')['border-color'], 'ошибка показывается рамкой ячейки');
});

test('строка повтора кода и таймер разнесены по краям, стрелка не переносится', () => {
  const css = postcss.parse(readFileSync('app/globals.css', 'utf8'));
  const decl = (selector: string) => {
    const out: Record<string, string> = {};
    css.walkRules(selector, (rule) => { if (rule.parent?.type === 'root') rule.walkDecls((d) => { out[d.prop] = d.value; }); });
    return out;
  };
  const row = decl('.otp-resend'), back = decl('.otp-back'), timer = decl('.otp-timer'), fill = decl('.otp-timer i'), track = decl('.otp-timer-track');
  assert.equal(row.display, 'flex');
  assert.equal(row['justify-content'], 'space-between');
  assert.ok(row.gap, 'между кнопкой повтора и «Изменить почту» есть зазор');
  assert.equal(row.width, '100%');
  // «← Изменить почту» — один неразрывный inline-flex, стрелка не уезжает на строку.
  assert.equal(back['white-space'], 'nowrap');
  assert.equal(back.display, 'inline-flex');
  assert.ok(back.gap);
  // Таймер больше не «прижат влево отдельным блоком»: он в том же ряду, а не под кнопками.
  assert.equal(timer['margin-left'], undefined);
  assert.ok(track.background, 'трек таймера рисуется, заливка — вложенный элемент');
  assert.equal(fill['transform-origin'], 'left');
});
