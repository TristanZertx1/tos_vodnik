import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const settings = read('site-source/settings.js');
const community = read('site-source/community-features.js');
const html = read('site-source/index.html');
const css = read('site-source/community-features.css');

test('Idea and newsletter tools remain available from the homepage gear settings panel', () => {
  for (const href of ['/ideya', '/podpiska']) {
    assert.ok(settings.includes('href=\\\"' + href + '\\\"'), 'settings panel should link to ' + href);
  }
  assert.doesNotMatch(settings, /href=\\\"\\/karta\\\"|href=\\\"\\/poisk\\\"/);
  assert.match(settings, /Разделы и возможности/);
});

test('Map and search are not listed in the gear panel; search is in the header actions', () => {
  assert.doesNotMatch(settings, /Карта района|Поиск по сайту/);
  assert.match(html, /class=\\\"header-search-link\\\" href=\\\"\\/poisk\\\"/);
  assert.match(html, /aria-label=\\\"Поиск по сайту\\\"/);
});

test('Community tools no longer add tabs to the primary navigation or footer', () => {
  assert.doesNotMatch(community, /function addNavigation/);
  assert.doesNotMatch(community, /addNavigation\\(\\)/);
  assert.doesNotMatch(html, /<a href=\\\"\\/podpiska\\\">Подписка на новости<\\/a>/);
});

test('Settings links and header search have keyboard-visible, reduced-motion-aware styling', () => {
  assert.match(css, /\\.settings-tools/);
  assert.match(css, /\\.header-search-link/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
