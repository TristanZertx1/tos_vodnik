const enc = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha256(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))); }
export async function hashPassword(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${salt}$${hex(new Uint8Array(bits))}`;
}
export async function verifyPassword(password, saved) {
  if (!/^pbkdf2\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(saved)) return false;
  const actual = await hashPassword(password, saved.split('$')[2]);
  let difference = actual.length ^ saved.length;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ (saved.charCodeAt(i) || 0);
  return difference === 0;
}
