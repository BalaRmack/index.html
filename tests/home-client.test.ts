import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import HomePage from '../app/page';

test('home replaces a hung recommendation request with labelled fallback cards',async()=>{
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.com/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,SVGElement:dom.window.SVGElement,IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const fetchBefore=globalThis.fetch;
  globalThis.fetch=(async()=>new Promise<Response>(()=>{})) as typeof fetch;
  const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async()=>root.render(React.createElement(HomePage)));
    assert.match(dom.window.document.body.textContent! , /Загружаем подборки/);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5200));});
    assert.doesNotMatch(dom.window.document.body.textContent! , /Загружаем подборки/);
    assert.match(dom.window.document.body.textContent! , /Резервная редакционная подборка/);
    assert.ok(dom.window.document.querySelectorAll('.catalog-card').length>=4);
  } finally {await act(async()=>root.unmount());globalThis.fetch=fetchBefore;dom.window.close();}
});
