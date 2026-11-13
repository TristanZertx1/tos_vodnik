import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const api = read('api/index.php');
const mailer = read('api/lib/mailer.php');
const newsletter = read('api/lib/newsletter.php');
const cms = read('api/lib/cms.php');
const config = read('api/config.example.php');
const ui = read('site-source/community-features.js');
const html = read('site-source/index.html');

test('SMTP uses the configured mailbox, authenticated transport and verified TLS', () => {
  assert.match(mailer, /stream_socket_client/);
  assert.match(mailer, /verify_peer' => true/);
  assert.match(mailer, /AUTH LOGIN/);
  assert.match(mailer, /smtpIsConfigured/);
  assert.match(config, /mail\.hosting\.reg\.ru/);
  assert.match(config, /'port' => 465/);
  assert.match(config, /'encryption' => 'ssl'/);
  assert.match(config, /'username' => 'info@tos-vodniki\.ru'/);
  assert.match(config, /'password' => ''/);
  assert.doesNotMatch(config, /newsletter_secret/);
});

test('Newsletter requires consent, double opt-in and expiring confirmation tokens', () => {
  assert.match(newsletter, /consent_at INT NOT NULL/);
  assert.match(newsletter, /Необходимо согласие на получение рассылки/);
  assert.match(newsletter, /random_bytes\(32\)/);
  assert.match(newsletter, /confirm_expires > \?/);
  assert.match(newsletter, /\$time \+ 172800/);
  assert.match(newsletter, /confirm_token_hash = NULL/);
  assert.match(newsletter, /newsletterConfirmationPrompt/);
  assert.match(newsletter, /method="post" action="\/api\/public\/newsletter\/confirm"/);
});

test('Unsubscribe links use opaque tokens and require an explicit confirmation action', () => {
  assert.match(newsletter, /hash\('sha256', \$token\)/);
  assert.match(newsletter, /cms_newsletter_unsubscribe_tokens/);
  assert.match(newsletter, /random_bytes\(32\)/);
  assert.match(newsletter, /newsletterUnsubscribePrompt/);
  assert.match(newsletter, /method="post" action="\/api\/public\/newsletter\/unsubscribe"/);
  assert.match(api, /newsletterUnsubscribePrompt/);
  assert.match(api, /assertSameOrigin\(\);\s*unsubscribeNewsletter/);
});

test('Subscription routes and public UI are connected without exposing subscriber data', () => {
  assert.match(api, /public', 'newsletter', 'subscribe'/);
  assert.match(api, /public', 'newsletter', 'confirm'/);
  assert.match(api, /newsletterConfirmationPrompt/);
  assert.match(api, /public', 'newsletter', 'unsubscribe'/);
  assert.match(ui, /\/podpiska/);
  assert.match(ui, /\/api\/public\/newsletter\/subscribe/);
  assert.match(ui, /consent\.required = true/);
  assert.match(ui, /Подписка подтверждена/);
  assert.match(html, /Подписка на новости/);
});

test('Newly published materials are sent to active subscribers only', () => {
  assert.match(cms, /if \(\$published && !\$wasPublished/);
  assert.match(cms, /notifyNewsletterSubscribers\(\(string\) \$kind, \$data\)/);
  assert.match(newsletter, /WHERE status = 'active'/);
  assert.match(newsletter, /Отписаться от рассылки/);
});
