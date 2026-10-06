import { hashPassword } from '../lib/password.mjs';
process.stdout.write('Ready for password on stdin (input is hidden).\n');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let input = '';
process.stdin.on('data', async chunk => {
  input += chunk.toString();
  if (!input.includes('\n') && !input.includes('\r')) return;
  process.stdin.pause();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  const password = input.trim(); input = '';
  const hash = await hashPassword(password);
  process.stdout.write(JSON.stringify({ hash }) + '\n');
  process.exit(0);
});
