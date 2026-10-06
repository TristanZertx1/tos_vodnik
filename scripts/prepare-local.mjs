import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/password.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = 'wrangler.local.jsonc';
const persist = '.wrangler/state';
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const env = {
  ...process.env,
  CI: 'true',
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: '.wrangler/logs',
  WRANGLER_REGISTRY_PATH: '.wrangler/dev-registry',
  MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
};

function runWrangler(args, label) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${label}${result.error ? `: ${result.error.message}` : ` (код ${result.status ?? 'unknown'})`}.`);
  }
}

function makeIdempotent(statement, file) {
  if (/^CREATE TABLE\b/i.test(statement)) {
    return statement.replace(/^CREATE TABLE\b/i, 'CREATE TABLE IF NOT EXISTS');
  }
  if (/^CREATE UNIQUE INDEX\b/i.test(statement)) {
    return statement.replace(/^CREATE UNIQUE INDEX\b/i, 'CREATE UNIQUE INDEX IF NOT EXISTS');
  }
  if (/^CREATE INDEX\b/i.test(statement)) {
    return statement.replace(/^CREATE INDEX\b/i, 'CREATE INDEX IF NOT EXISTS');
  }
  throw new Error(`Автоподготовка остановлена: неизвестная операция в ${file}.`);
}

async function prepareDatabase() {
  console.log('Подготавливаю локальную базу и применяю миграции…');
  const baseArgs = [
    'd1', 'execute', 'site-creator-d1', '--local', '--persist-to', persist,
    '--config', config, '--yes', '--command',
  ];
  const directory = path.join(root, 'drizzle');
  const files = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  if (files.length === 0) throw new Error('В папке drizzle не найдены миграции базы данных.');

  const bootstrap = [
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  ];
  for (const file of files) {
    const source = await readFile(path.join(directory, file), 'utf8');
    const statements = source
      .replace(/--> statement-breakpoint/g, '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => makeIdempotent(value, file));
    if (statements.length === 0) throw new Error(`Миграция ${file} пуста.`);

    bootstrap.push(...statements, `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${file}')`);
  }

  runWrangler([...baseArgs, bootstrap.join('; ')], 'Не удалось применить локальные миграции');

  // Keep Wrangler's migration ledger authoritative for future project updates.
  runWrangler([
    'd1', 'migrations', 'apply', 'site-creator-d1', '--local',
    '--persist-to', persist, '--config', config,
  ], 'Проверка миграций D1 не пройдена');
  console.log('Локальная база готова.');
}

async function ensureLocalAdmin() {
  const varsPath = path.join(root, '.dev.vars');
  let contents = '';
  try { contents = await readFile(varsPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const existing = contents.match(/^CMS_ADMIN_HASH=(.*)$/m)?.[1];
  if (existing !== undefined) {
    if (!/^pbkdf2\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(existing)) {
      throw new Error('CMS_ADMIN_HASH в .dev.vars имеет неверный формат. Исправьте или удалите только эту строку.');
    }
    await syncLocalAdmin(existing);
    console.log('Локальный администратор уже настроен (логин: admin).');
    return;
  }

  const password = randomBytes(24).toString('hex');
  const hash = await hashPassword(password);
  const next = `${contents}${contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''}CMS_ADMIN_HASH=${hash}\n`;
  await writeFile(varsPath, next, { encoding: 'ascii', mode: 0o600 });
  await syncLocalAdmin(hash);
  console.log('\nСоздан локальный аккаунт администратора:');
  console.log('Логин:    admin');
  console.log(`Пароль:   ${password}`);
  console.log('Сохраните пароль сейчас. В файле .dev.vars хранится только его PBKDF2-хеш.');
  console.log('Если пароль потерян, удалите строку CMS_ADMIN_HASH из .dev.vars и запустите сайт снова.\n');
}

async function syncLocalAdmin(hash) {
  const createdAt = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO cms_users (id, username, password, role, enabled, created_at) VALUES ('admin', 'admin', '${hash}', 'admin', 1, ${createdAt}) ON CONFLICT(username) DO UPDATE SET password=excluded.password, role='admin', enabled=1`;
  runWrangler([
    'd1', 'execute', 'site-creator-d1', '--local', '--persist-to', persist,
    '--config', config, '--yes', '--command', sql,
  ], 'Не удалось создать локальную учётную запись администратора');
}

try {
  await prepareDatabase();
  await ensureLocalAdmin();
} catch (error) {
  console.error(`\nПодготовка локального сайта не удалась: ${error.message}`);
  process.exitCode = 1;
}
