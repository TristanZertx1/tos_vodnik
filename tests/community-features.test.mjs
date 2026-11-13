import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const api = read('api/index.php');
const community = read('api/lib/community.php');
const features = read('site-source/community-features.js');
const admin = read('public/admin.js');
const adminPage = read('site-source/admin.html');

test('Resident ideas are same-origin protected, validated and rate limited', () => {
  assert.match(api, /assertSameOrigin\(\);\s*send\(submitCommunityIdea/);
  assert.match(community, /bumpAttempt\(/);
  assert.match(community, /FILTER_VALIDATE_EMAIL/);
  assert.match(community, /consent_at/);
  assert.match(community, /mb_strlen\(\$description\) < 20/);
});

test('Only administrators can read and moderate resident ideas', () => {
  assert.match(api, /requireAdmin\(\$session\);\s*send\(listCommunityIdeas/);
  assert.match(api, /if \(count\(\$parts\) === 2 && \$parts\[0\] === 'ideas' && \$method === 'PATCH'\) \{\s*requireAdmin\(\$session\);[\s\S]*?send\(updateCommunityIdea/);
  assert.match(api, /if \(count\(\$parts\) === 2 && \$parts\[0\] === 'ideas' && \$method === 'DELETE'\) \{\s*requireAdmin\(\$session\);[\s\S]*?send\(deleteCommunityIdea/);
  assert.match(adminPage, /data-tab="ideas" data-admin/);
  assert.match(admin, /async function loadIdeas\(\)/);
});

test('Public map, search and idea form are loaded without exposing private submissions', () => {
  assert.match(features, /\/karta/);
  assert.match(features, /\/poisk/);
  assert.match(features, /\/ideya/);
  assert.match(features, /\/api\/public\/content/);
  assert.match(features, /\/api\/public\/ideas/);
  assert.match(api, /if \(\$action === 'ideas' && \$method === 'GET'\) \{\s*requireAdmin\(\$session\);\s*send\(listCommunityIdeas\(\)\);/);
});
