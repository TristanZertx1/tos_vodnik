import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync('site-source/index.html', 'utf8');
const css = readFileSync('site-source/internal-pages-balanced.css', 'utf8');

test('balanced internal-page stylesheet is loaded after the shared site styles', () => {
  const design = html.indexOf('/design.css');
  const homepage = html.indexOf('/homepage-visual-polish.css');
  const internal = html.indexOf('/internal-pages-balanced.css?v=1');
  assert.ok(design >= 0 && homepage > design && internal > homepage);
});

test('internal-page styles are scoped to public pages with a page heading', () => {
  assert.match(css, /body:has\(#main > \.page-top\)/);
  assert.doesNotMatch(css, /#workspace|#login-view|\.admin-shell/);
});

test('internal pages retain responsive and reduced-motion support', () => {
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
});

test('page polish covers common content, cards, forms, navigation and event details', () => {
  for (const selector of ['.page-top', '.content', '.cards', '.card', '.about-contents', '.crumbs', '.event-overview', '.event-details', '.map-card', 'textarea', 'table']) {
    assert.ok(css.includes(selector), `Missing style coverage for ${selector}`);
  }
});
