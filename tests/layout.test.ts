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
