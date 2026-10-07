import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/password.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.stdin;
if (!input.isTTY || typeof input.setRawMode !== 'function') {
  throw new Error('Запустите эту команду в интерактивном терминале, чтобы пароль не отображался.');
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    let value = '';
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = buffer => {
      for (const byte of buffer) {
        if (byte === 3) return finish(new Error('Отменено.'));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (byte >= 32 && byte <= 126 && value.length < 128) {
          value += String.fromCharCode(byte);
          process.stdout.write('*');
        }
      }
    };
    input.on('data', onData);
  });
}

const password = await readHidden('Новый пароль admin (10–128 символов; ввод скрыт): ');
if (password.length < 10) throw new Error('Пароль должен содержать не менее 10 символов. Секрет не изменён.');
const confirmation = await readHidden('Повторите пароль: ');
if (password !== confirmation) throw new Error('Пароли не совпадают. Секрет не изменён.');

const hash = await hashPassword(password);
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const config = path.join(root, 'wrangler.admin-api.jsonc');
const child = spawn(process.execPath, [wrangler, 'secret', 'put', 'CMS_ADMIN_HASH', '--config', config], {
  cwd: root,
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: path.join(root, '.wrangler', 'logs'),
    WRANGLER_REGISTRY_PATH: path.join(root, '.wrangler', 'dev-registry'),
    MINIFLARE_REGISTRY_PATH: path.join(root, '.wrangler', 'registry'),
  },
  stdio: ['pipe', 'inherit', 'inherit'],
  windowsHide: true,
});
child.stdin.end(`${hash}\n`);
const [code, signal] = await new Promise(resolve => child.once('close', (code, signal) => resolve([code, signal])));
if (signal) throw new Error(`Wrangler завершился по сигналу ${signal}.`);
if (code !== 0) throw new Error(`Не удалось записать секрет Cloudflare (код ${code}).`);
console.log('Хеш пароля установлен в Cloudflare. Сам пароль не сохранялся в файлах проекта.');
