import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('retired installer is an inert 404 endpoint', async () => {
  const installer = await read('api/setup.php');
  assert.match(installer, /http_response_code\(404\)/);
  assert.match(installer, /\bexit\s*;/);
  assert.doesNotMatch(installer, /bootstrap\.php|installSchema\s*\(|INSERT INTO cms_users|setup_token/);
});

test('Apache explicitly denies direct access to the retired installer', async () => {
  const rules = await read('api/.htaccess');
  assert.match(rules, /RewriteRule \^setup\\\.php\$ - \[F,L\]/);
});

test('deployment ships the inert installer guard and preserves server data', async () => {
  const workflow = await read('.github/workflows/deploy-regru.yml');
  assert.match(workflow, /cp -R api deploy\/api/);
  assert.match(workflow, /rm -f deploy\/api\/config\.php deploy\/api\/config\.test\.php/);
  assert.doesNotMatch(workflow, /rm -f deploy\/api\/setup\.php/);
  assert.match(workflow, /dangerous-clean-slate: false/);
});

test('secret scanning runs on PRs, main pushes and scheduled scans', async () => {
  const workflow = await read('.github/workflows/secret-scan.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches: \[main, "fix\/\*\*", "security\/\*\*"\]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /gitleaks\/gitleaks-action@v3/);
  assert.match(workflow, /GITLEAKS_ENABLE_COMMENTS: "false"/);
  assert.match(workflow, /GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"/);
});
