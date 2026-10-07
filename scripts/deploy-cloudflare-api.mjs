import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'wrangler.admin-api.jsonc');
const configText = await readFile(configPath, 'utf8');
const config = JSON.parse(configText);
const binding = config.d1_databases?.find(item => item.binding === 'DB');
if (!binding || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(binding.database_id) || /^0+$/.test(binding.database_id.replaceAll('-', ''))) {
  throw new Error('Сначала создайте Cloudflare D1 и укажите выданный database_id в wrangler.admin-api.jsonc.');
}
if (!config.vars?.CMS_ALLOWED_ORIGIN || config.vars.CMS_ALLOWED_ORIGIN !== 'https://tos-vodnik.onrender.com') {
  throw new Error('CMS_ALLOWED_ORIGIN должен точно совпадать с публичным адресом витрины Render.');
}

const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const result = spawnSync(process.execPath, [wrangler, 'deploy', '--config', configPath], {
  cwd: root,
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: path.join(root, '.wrangler', 'logs'),
    WRANGLER_REGISTRY_PATH: path.join(root, '.wrangler', 'dev-registry'),
    MINIFLARE_REGISTRY_PATH: path.join(root, '.wrangler', 'registry'),
  },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
