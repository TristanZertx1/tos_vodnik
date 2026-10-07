import { hashPassword, verifyPassword, randomToken, sha256 } from './password.mjs';
import { cancelEventRegistration, ensureEventRegistrationTable, getEventRegistrations } from './event-registration.ts';
type DB = D1Database;
const cookieName = '__Host-vodniki-cms';
const kinds = ['news', 'events', 'projects', 'documents', 'contacts'];
const homeModules = ['hero', 'quick', 'overview', 'news', 'events', 'projects', 'join'];
const editablePages = ['/', '/o-tos/', '/novosti/', '/meropriyatiya/', '/proekty/', '/dokumenty/', '/kontakty/'];
const pageModules: Record<string, string[]> = {
  '/': homeModules,
  '/o-tos/': ['about-heading','about-nav','about-intro','about-directions','about-chairperson','about-clubs','about-participate','about-activity-2025','about-activity-2024','about-faq'],
  '/novosti/': ['news-heading','news-content'],
  '/meropriyatiya/': ['events-heading','events-content'],
  '/proekty/': ['projects-heading','projects-content'],
  '/dokumenty/': ['documents-heading','documents-content'],
  '/kontakty/': ['contacts-heading','contacts-content'],
};
const now = () => Math.floor(Date.now() / 1000);
function fail(message: string, code = 400): never { throw Object.assign(new Error(message), { code }); }
function json(data: unknown, status = 200, headers = {}) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } }); }
async function body(request: Request, maxSize = 50_000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('ĞÑƒĞ¶ĞµĞ½ Ñ„Ğ¾Ñ€Ğ¼Ğ°Ñ‚ JSON.', 415);
  const text = await request.text(); if (text.length > maxSize) fail('ĞœĞ°Ñ‚ĞµÑ€Ğ¸Ğ°Ğ» ÑĞ»Ğ¸ÑˆĞºĞ¾Ğ¼ Ğ±Ğ¾Ğ»ÑŒÑˆĞ¾Ğ¹. Ğ£Ğ¼ĞµĞ½ÑŒÑˆĞ¸Ñ‚Ğµ Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¸ Ğ¸Ğ»Ğ¸ Ñ‚ĞµĞºÑÑ‚.', 413);
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') fail('ĞĞµĞ²ĞµÑ€Ğ½Ñ‹Ğµ Ğ´Ğ°Ğ½Ğ½Ñ‹Ğµ.'); return value; } catch { fail('ĞĞµĞ²ĞµÑ€Ğ½Ñ‹Ğ¹ Ñ„Ğ¾Ñ€Ğ¼Ğ°Ñ‚ Ğ´Ğ°Ğ½Ğ½Ñ‹Ñ….'); }
}
const validUsername = (s: unknown) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{2,39}$/.test(s);
const validPassword = (s: unknown) => typeof s === 'string' && s.length >= 10 && s.length <= 128;
export function validateRecord(kind: string, source: any) {
  if (!kinds.includes(kind) || !source || typeof source !== 'object') fail('ĞĞµĞ²ĞµÑ€Ğ½Ñ‹Ğ¹ Ñ€Ğ°Ğ·Ğ´ĞµĞ».');
  const fields: Record<string, string[]> = {
    news: ['title','slug','date','category','description','body','source','image','imageAlt','images'],
    events: ['title','date','time','place','description','participation','source','capacity','registrationEnabled'],
    projects: ['title','status','description','results','participation','image','imageAlt','source'],
    documents: ['title','date','format','size','url'],
    contacts: ['phone','email','hours','source'],
  };
  const data: Record<string, any> = {};
  for (const field of fields[kind]) { const v = source[field] ?? ''; if (field === 'images' && kind === 'news') continue; if (field === 'capacity' && kind === 'events') continue; if (field === 'registrationEnabled' && kind === 'events') continue; if (typeof v !== 'string' || v.length > (['body','description'].includes(field) ? 20000 : 1000)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ñ‚ĞµĞºÑÑ‚Ğ¾Ğ²Ñ‹Ğµ Ğ¿Ğ¾Ğ»Ñ.'); data[field] = v.trim(); }
  if (kind === 'events') {
    const enabled = source.registrationEnabled === true;
    const capacity = source.capacity === '' || source.capacity === undefined || source.capacity === null ? 0 : Number(source.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 500) fail('Ğ›Ğ¸Ğ¼Ğ¸Ñ‚ Ğ¼ĞµÑÑ‚ Ğ´Ğ¾Ğ»Ğ¶ĞµĞ½ Ğ±Ñ‹Ñ‚ÑŒ Ñ†ĞµĞ»Ñ‹Ğ¼ Ñ‡Ğ¸ÑĞ»Ğ¾Ğ¼ Ğ¾Ñ‚ 1 Ğ´Ğ¾ 500.');
    if (enabled && capacity < 1) fail('Ğ£ĞºĞ°Ğ¶Ğ¸Ñ‚Ğµ Ğ²Ğ¼ĞµÑÑ‚Ğ¸Ğ¼Ğ¾ÑÑ‚ÑŒ, Ñ‡Ñ‚Ğ¾Ğ±Ñ‹ Ğ¾Ñ‚ĞºÑ€Ñ‹Ñ‚ÑŒ Ğ·Ğ°Ğ¿Ğ¸ÑÑŒ.');
    data.registrationEnabled = enabled;
    data.capacity = capacity;
  }
  if (kind === 'news') {
    const images = source.images ?? [];
    if (!Array.isArray(images) || images.length > 5) fail('Ğš Ğ½Ğ¾Ğ²Ğ¾ÑÑ‚Ğ¸ Ğ¼Ğ¾Ğ¶Ğ½Ğ¾ Ğ´Ğ¾Ğ±Ğ°Ğ²Ğ¸Ñ‚ÑŒ Ğ½Ğµ Ğ±Ğ¾Ğ»ĞµĞµ 5 Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¹.');
    let total = 0;
    data.images = images.map((image: any) => {
      if (!image || typeof image !== 'object' || typeof image.src !== 'string' || typeof image.alt !== 'string' || image.alt.trim().length > 180 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.src)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ñ„Ğ¾Ñ€Ğ¼Ğ°Ñ‚ Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¸ Ğ¸ Ğ¾Ğ¿Ğ¸ÑĞ°Ğ½Ğ¸Ğµ Ğº Ğ½ĞµĞ¹.');
      total += image.src.length;
      if (total > 850_000) fail('ĞĞ±Ñ‰Ğ¸Ğ¹ Ñ€Ğ°Ğ·Ğ¼ĞµÑ€ Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¹ Ğ¿Ñ€ĞµĞ²Ñ‹ÑˆĞ°ĞµÑ‚ Ğ´Ğ¾Ğ¿ÑƒÑÑ‚Ğ¸Ğ¼Ñ‹Ğ¹. Ğ£Ğ¼ĞµĞ½ÑŒÑˆĞ¸Ñ‚Ğµ Ğ¸Ğ·Ğ¾Ğ±Ñ€Ğ°Ğ¶ĞµĞ½Ğ¸Ñ.');
      return { src: image.src, alt: image.alt.trim() };
    });
    if (data.images.length && source.imagePermission !== true) fail('ĞŸĞ¾Ğ´Ñ‚Ğ²ĞµÑ€Ğ´Ğ¸Ñ‚Ğµ Ğ¿Ñ€Ğ°Ğ²Ğ¾ Ğ½Ğ° Ñ€Ğ°Ğ·Ğ¼ĞµÑ‰ĞµĞ½Ğ¸Ğµ Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¹.');
    if (data.images.length) data.imagePermission = true;
  }
  const required: Record<string, string[]> = { news:['title','slug','date','category','description'], events:['title','date','time','place','description','participation'], projects:['title','status','description','participation'], documents:['title','date','format','size','url'], contacts:[] };
  if (required[kind].some(k => !data[k])) fail('Ğ—Ğ°Ğ¿Ğ¾Ğ»Ğ½Ğ¸Ñ‚Ğµ Ğ¾Ğ±ÑĞ·Ğ°Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ğµ Ğ¿Ğ¾Ğ»Ñ.');
  if (data.date && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date)) fail('Ğ£ĞºĞ°Ğ¶Ğ¸Ñ‚Ğµ ÑÑƒÑ‰ĞµÑÑ‚Ğ²ÑƒÑÑ‰ÑƒÑ Ğ´Ğ°Ñ‚Ñƒ.');
  if (kind === 'news' && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug) || !['Ğ–Ğ¸Ğ·Ğ½ÑŒ Ğ¼Ğ¸ĞºÑ€Ğ¾Ñ€Ğ°Ğ¹Ğ¾Ğ½Ğ°','ĞœĞµÑ€Ğ¾Ğ¿Ñ€Ğ¸ÑÑ‚Ğ¸Ñ','Ğ˜Ğ½Ğ¸Ñ†Ğ¸Ğ°Ñ‚Ğ¸Ğ²Ñ‹','ĞĞ±ÑŠÑĞ²Ğ»ĞµĞ½Ğ¸Ñ'].includes(data.category))) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ°Ğ´Ñ€ĞµÑ Ğ¸ ĞºĞ°Ñ‚ĞµĞ³Ğ¾Ñ€Ğ¸Ñ Ğ½Ğ¾Ğ²Ğ¾ÑÑ‚Ğ¸.');
  if (data.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ²Ñ€ĞµĞ¼Ñ.');
  for (const key of ['source','image','url']) if (data[key]) { try { const u = new URL(data[key]); if (!['http:','https:'].includes(u.protocol)) fail('Ğ˜ÑĞ¿Ğ¾Ğ»ÑŒĞ·ÑƒĞ¹Ñ‚Ğµ HTTP Ğ¸Ğ»Ğ¸ HTTPS ÑÑÑ‹Ğ»ĞºĞ¸.'); } catch { fail('ĞĞµĞºĞ¾Ñ€Ñ€ĞµĞºÑ‚Ğ½Ğ°Ñ ÑÑÑ‹Ğ»ĞºĞ°.'); } }
  if (data.image && (!data.imageAlt || source.imagePermission !== true)) fail('Ğ”Ğ¾Ğ±Ğ°Ğ²ÑŒÑ‚Ğµ Ğ¾Ğ¿Ğ¸ÑĞ°Ğ½Ğ¸Ğµ Ñ„Ğ¾Ñ‚Ğ¾Ğ³Ñ€Ğ°Ñ„Ğ¸Ğ¸ Ğ¸ Ğ¿Ğ¾Ğ´Ñ‚Ğ²ĞµÑ€Ğ´Ğ¸Ñ‚Ğµ Ğ¿Ñ€Ğ°Ğ²Ğ¾ Ğ½Ğ° ĞµÑ‘ Ñ€Ğ°Ğ·Ğ¼ĞµÑ‰ĞµĞ½Ğ¸Ğµ.');
  if (data.image) data.imagePermission = true;
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ ÑĞ»ĞµĞºÑ‚Ñ€Ğ¾Ğ½Ğ½ÑƒÑ Ğ¿Ğ¾Ñ‡Ñ‚Ñƒ.');
  return data;
}
export async function readPublic(db: DB) {
  await ensureEventRegistrationTable(db);
  const result = await db.prepare('SELECT id,kind,data FROM cms_records WHERE published = 1 ORDER BY updated_at DESC').all<any>();
  const content: any = { news: [], events: [], projects: [], documents: [], contacts: {}, layout: {} };
  for (const row of result.results) { if (row.kind === 'contacts') content.contacts = JSON.parse(row.data); else if (row.kind === 'layout') content.layout = JSON.parse(row.data).settings || {}; else if (Array.isArray(content[row.kind])) content[row.kind].push(row.kind==='events'?{...JSON.parse(row.data),id:row.id}:JSON.parse(row.data)); }
  if(content.events.length){const counts=await db.prepare("SELECT event_id,SUM(seats) AS registered FROM cms_event_registrations WHERE status='confirmed' GROUP BY event_id").all<any>();const byId=new Map(counts.results.map((r:any)=>[r.event_id,Number(r.registered)||0]));content.events=content.events.map((event:any)=>({...event,registeredCount:byId.get(event.id)||0,availableSeats:Math.max(0,Number(event.capacity||0)-(byId.get(event.id)||0))}));}
  return content;
}
export async function ensureAnalyticsTable(db: DB) {
  await db.exec('CREATE TABLE IF NOT EXISTS cms_page_views (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))');
}
export function validateLayout(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ½Ğ°ÑÑ‚Ñ€Ğ¾Ğ¹ĞºĞ¸ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†.');
  const customSource = input.homeCustom ?? [];
  if (!Array.isArray(customSource) || customSource.length > 20) fail('Ğ¡Ğ»Ğ¸ÑˆĞºĞ¾Ğ¼ Ğ¼Ğ½Ğ¾Ğ³Ğ¾ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ÑŒÑĞºĞ¸Ñ… Ğ±Ğ»Ğ¾ĞºĞ¾Ğ².');
  const custom: { id: string; title: string; body: string }[] = [];
  const customIds = new Set<string>();
  for (const item of customSource) {
    if (!item || typeof item !== 'object' || !/^custom-[a-z0-9-]{6,40}$/.test(item.id) || customIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.body !== 'string' || item.body.length > 2000) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ÑŒÑĞºĞ¸Ğµ Ğ±Ğ»Ğ¾ĞºĞ¸.');
    customIds.add(item.id); custom.push({ id: item.id, title: item.title.trim(), body: item.body.trim() });
  }
  const order = input.homeOrder;
  const allowedModules = new Set([...homeModules, ...custom.map(item => item.id)]);
  if (!Array.isArray(order) || order.length > homeModules.length + 20 || new Set(order).size !== order.length || order.some((id: unknown) => !allowedModules.has(String(id)))) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ¿Ğ¾Ñ€ÑĞ´Ğ¾Ğº Ğ±Ğ»Ğ¾ĞºĞ¾Ğ² Ğ³Ğ»Ğ°Ğ²Ğ½Ğ¾Ğ¹ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹.');
  const hidden = input.homeHidden;
  if (!Array.isArray(hidden) || hidden.some((id: unknown) => !allowedModules.has(String(id)))) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ²Ğ¸Ğ´Ğ¸Ğ¼Ğ¾ÑÑ‚ÑŒ Ğ±Ğ»Ğ¾ĞºĞ¾Ğ².');
  if (!input.texts || typeof input.texts !== 'object' || Array.isArray(input.texts)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ñ‚ĞµĞºÑÑ‚Ñ‹ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†.');
  const themeSource = input.theme ?? {};
  if (!themeSource || typeof themeSource !== 'object' || Array.isArray(themeSource)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ¾Ñ„Ğ¾Ñ€Ğ¼Ğ»ĞµĞ½Ğ¸Ğµ ÑĞ°Ğ¹Ñ‚Ğ°.');
  const colorKeys = ['primary','accent','ink','muted','pageBackground','surface','border','tint'];
  const theme: Record<string, string> = {};
  for (const key of colorKeys) {
    const value = themeSource[key] ?? '';
    if (typeof value !== 'string' || (value && !/^#[0-9a-fA-F]{6}$/.test(value))) fail('Ğ¦Ğ²ĞµÑ‚ Ğ´Ğ¾Ğ»Ğ¶ĞµĞ½ Ğ±Ñ‹Ñ‚ÑŒ Ğ² Ñ„Ğ¾Ñ€Ğ¼Ğ°Ñ‚Ğµ #RRGGBB.');
    if (value) theme[key] = value.toLowerCase();
  }
  const fonts = ['Nunito','Arial','Georgia','Verdana','Comfortaa'];
  if (themeSource.font !== undefined && !fonts.includes(themeSource.font)) fail('Ğ’Ñ‹Ğ±ĞµÑ€Ğ¸Ñ‚Ğµ ÑˆÑ€Ğ¸Ñ„Ñ‚ Ğ¸Ğ· ÑĞ¿Ğ¸ÑĞºĞ°.');
  const choices: Record<string, string[]> = { width:['narrow','standard','wide'], scale:['compact','standard','large'], spacing:['compact','standard','relaxed'], backgroundMode:['plain','pattern'], radius:['soft','round','square'] };
  for (const [key, allowed] of Object.entries(choices)) if (themeSource[key] !== undefined && !allowed.includes(themeSource[key])) fail('ĞĞµĞ´Ğ¾Ğ¿ÑƒÑÑ‚Ğ¸Ğ¼Ğ¾Ğµ Ğ·Ğ½Ğ°Ñ‡ĞµĞ½Ğ¸Ğµ Ğ½Ğ°ÑÑ‚Ñ€Ğ¾Ğ¹ĞºĞ¸ Ğ¾Ñ„Ğ¾Ñ€Ğ¼Ğ»ĞµĞ½Ğ¸Ñ.');
  const modules: Record<string, string[]> = {};
  const pageCustom: Record<string, { id:string; title:string; body:string }[]> = {};
  for (const [page, allowed] of Object.entries(pageModules)) {
    const customSource = input.pageCustom?.[page] ?? [];
    if (!Array.isArray(customSource) || customSource.length > 10) fail('ĞĞ° Ğ¾Ğ´Ğ½Ğ¾Ğ¹ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ğµ Ğ¼Ğ¾Ğ¶Ğ½Ğ¾ ÑĞ¾Ğ·Ğ´Ğ°Ñ‚ÑŒ Ğ½Ğµ Ğ±Ğ¾Ğ»ĞµĞµ 10 Ğ´Ğ¾Ğ¿Ğ¾Ğ»Ğ½Ğ¸Ñ‚ĞµĞ»ÑŒĞ½Ñ‹Ñ… Ğ±Ğ»Ğ¾ĞºĞ¾Ğ².');
    const customItems: { id:string; title:string; body:string }[] = [];
    const customIds = new Set<string>();
    for (const item of customSource) {
      if (!item || typeof item !== 'object' || !/^custom-[a-z0-9-]{6,40}$/.test(item.id) || customIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.body !== 'string' || item.body.length > 2000) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ¿Ğ¾Ğ»ÑŒĞ·Ğ¾Ğ²Ğ°Ñ‚ĞµĞ»ÑŒÑĞºĞ¸Ğµ Ğ±Ğ»Ğ¾ĞºĞ¸ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹.');
      customIds.add(item.id); customItems.push({ id:item.id, title:item.title.trim(), body:item.body.trim() });
    }
    pageCustom[page] = customItems;
    const pageAllowed = [...allowed, ...customItems.map(item => item.id)];
    const state = input.modules?.[page] ?? { order: allowed, hidden: [] };
    if (!state || typeof state !== 'object' || !Array.isArray(state.order) || !Array.isArray(state.hidden) || state.order.length > 30 || new Set(state.order).size !== state.order.length || state.order.some((id: unknown) => !pageAllowed.includes(String(id))) || state.hidden.some((id: unknown) => !pageAllowed.includes(String(id)))) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ğ¿Ğ¾Ñ€ÑĞ´Ğ¾Ğº Ğ¸ Ğ²Ğ¸Ğ´Ğ¸Ğ¼Ğ¾ÑÑ‚ÑŒ Ğ±Ğ»Ğ¾ĞºĞ¾Ğ² ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹.');
    modules[page] = JSON.stringify({ order: state.order, hidden: [...new Set(state.hidden)] });
  }
  const texts: Record<string, { title: string; lead: string; blocks: Record<string, string> }> = {};
  for (const page of [...editablePages, '__shared']) {
    const value = input.texts[page] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ñ‚ĞµĞºÑÑ‚ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹.');
    const title = value.title ?? '', lead = value.lead ?? '';
    if (typeof title !== 'string' || title.length > 180 || typeof lead !== 'string' || lead.length > 500) fail('Ğ—Ğ°Ğ³Ğ¾Ğ»Ğ¾Ğ²Ğ¾Ğº ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹ â€” Ğ´Ğ¾ 180 Ğ·Ğ½Ğ°ĞºĞ¾Ğ², Ğ¾Ğ¿Ğ¸ÑĞ°Ğ½Ğ¸Ğµ â€” Ğ´Ğ¾ 500.');
    const sourceBlocks = value.blocks ?? {};
    if (!sourceBlocks || typeof sourceBlocks !== 'object' || Array.isArray(sourceBlocks) || Object.keys(sourceBlocks).length > 400) fail('ĞŸÑ€Ğ¾Ğ²ĞµÑ€ÑŒÑ‚Ğµ Ñ‚ĞµĞºÑÑ‚Ğ¾Ğ²Ñ‹Ğµ Ğ±Ğ»Ğ¾ĞºĞ¸ ÑÑ‚Ñ€Ğ°Ğ½Ğ¸Ñ†Ñ‹.');
    const blocks: Record<string, string> = {};
    for (const [key, text] of Object.entries(sourceBlocks)) {
      if (!/^t-[a-z0-9-]{3,100}$/.test(key) || typeof text !== 'string' || text.length > 4000) fail('Ğ¢ĞµĞ½t÷M5¶‰Ëkºwµç@ ‚   ‚  "4UÈ¶˜™Œ†   ‚   ‚   ƒ‚x Œ†   ‚‚ô Ci¼„-  A  ¼`A  A  A€D:€mGg€`dA  A  A  ¿ (E €Ğq˜­d  ‚   ‚  ¸,Àˆ ‚   ‚  4!Àv0{<Š  ø$ÀL ‚   ‚   ‚  "|Ğ¯ éÑo*A  A  A  h]€A  AÁ  ÜPdA  ğMA  A  A  ´âYÛ¯ğ¾pdE  A  A  A ƒğ
°@AÁN  ÜÔd,A  A  Ü`$A  A  ´âYø-d !à¿ 0 ‚   ‚   ‚   €Aø[¢ Az È˜ ‚   ‚   ‚Œò$  ‚  
„G€ èÑo%A  AÁ~ DE  A  A  A¡ ¡›ÓñîZdA  A  A  A ƒğ
°@@"t B‡mHZ  ‚   ƒBğ Œ‚   ‚   ‚ lqî‡ ` ƒ‚t Œ   ‚   ‚   ‚àa… â ;·ZÈÀA  A  Aøy  A  pS€i57 A ô A  A  Aì:­¸„tA  A  A  A ƒğ
°@A ,:‚õA•0Z£’œ¾z{{ßÛâ¯|ïEÎôßÊH-äî÷şwÎWñ3 ”Èô ‚  X
kx…ü×tã) CAjóUëì øˆq’e™P*\Ÿ}í§Ò=6÷ı«ûÓGKAåêÉH«%,»‘·ûRG'İ|g÷F}6ûİÉÇÂ*ô-ÜE  A%Gñ×	|A  pTÿw‘°ğS€i-wKÃ6']üÃÇ<._;«”hÎ_.-œŸ{ãGâ¯|¿zñzŒÎÜE  A
òÖ†åDy AÀøéˆ,(%À·A™@(
4%R+¥?xqÿÕïo_¨v„ĞĞ£[OïzºQ+Ôù-ü³hA h‘¼´‡¸   ƒ‚øç®ø¤Œ‹‚öhCz¾|dCAv€ĞøËÇ«İŸ<r=T¨6º•K&|øëÇÉİ.6;Œ ‚  !2ò7bÍpCÁ ¤B µûXÚˆ	()À·’Ù@P8*_=6óò÷J`,|çÜ)_8înex ‚  	„UvÔ#iÑ  A´Ë]µG ü:ƒöÍ˜˜¨F£ußÛr''İz¦R*Öìë­D¦T›}õ§Û0ÅŸw¦  ‚ P#|£¸é­ @!hƒsänĞ»Ì‚ä BxLÌ	x#‘<zkë¢5c4|Ùc¿rW+P¿•<v»Üçè   €@Èßrï3¨A  PPÿWp^©ä C:·¢& ¨ÉÿL{Îºk§÷¿É÷C{ÄÉÉ4è‚  	¨*Bı«¸-T†  "nğ7ßúÊê !`y“ô°L´*_=9÷òšNÈOv÷gt>ĞÿÎ.uî?—WûĞ¿#m^¾MŸÚõváË9%?è‚   €@ÈÜ*ï0hF"¸ ­TÉ_Vv„¸¨O€èø½èŒB±¥Ñ£«]V)ôgÆÛ;q>ØÿÆ×3èìKµuˆ†½ŞñµÿÉ®ä~D;Ø QL~ñXi×‡lºj ĞÒ`ıåAyÊÇ Y¼E  .ÁùT+’¾©mt ‚  „Xıòä°µ¨q·f¼VíSÈÎO¾ñ`§[â¦§Õojéi«e*­Ö“é^Ôÿ××Ók5Xw›i–‹%İzA'ŸxÛşÕH¡2û÷óâ¯~|ûÂúó‘y)ÌŒÌ ‚  x% RJÿ{ÄÈÈ ‚  
˜	û—¿OÏ¾ş}À,x!À¶4®Œ‹‚Q¾^œ›°Ú3Zìy«wöBE#iÖ/1‰×?gt?0›ö]0ßçx¬Å]ûQ†äóçº.¬_Ÿ<™¾œùáÕø.îGÈÀ  @%S\ ‚  " ™ûêÈ2  ‚ ÉÜ¼CAr £4ŞCÈŒ@hjSjï—Næõ>›]¶Ç®ÏÁy›÷[sx‰Æíü8Q½rdûÃûœiäİ÷‚÷‹‚W¨œ-\¿#J«m¤%"¤E  X!!"Fü-â  ‚Ü’¿ß21<
îœÿ­€¸BÀ\ 9vÏ­€båì},µ}_±y«çkpö?eü}ÓûS‡dÏ6yÛjXıôÑÿê!W¼i.Íê1ØA  ğ^ EK’¿İo 0"z ŠÔåmµ,	h-À·×ÙDğ
|.Ó¹ø¢Õ‹·¿«ğ–ÕÉuÛ\Ø=7µî­Ã¦±ô~®î-›ŞıÖ]ØA D)€ÊÜĞy A$Êİ% yü:ƒôİì¹d$‘îYgw)³bYy_Œœ)hôï^yfüÖÏú:å¯Î¾W+¼Tº|Îı¯ujáñÛË]ŠV)Ö^c7I²{ˆX ‚  ø#bSç®ıL‚  "gé·’¾Ô5ÜCAJ  ¶Ş6ˆŒ¢C¡fK©}V÷Ã’J³;î«o­·'»ro°nÁî©rió¿—dÏ³è²ò\ıõÓÊõ]‹—Ë˜½Kô­•¤.iâ  ‚ ÈIJ§C¼ËhR  ‚päïŸ\ Ñ¢ÚJ~ƒ×{Oô¯½O{›¹üéšãÄÿ‘àòßŞ%á¯oóÄ]}\©N~ğÖ×¾µ*¦ãã[ŞUI§«ŒŞŸŞõ·ş÷<Éw¯v<¹ğÓ½`è ‚H’¾Km	D ‚  „\ıûE}{“[¿åW“A`À b¥S»Ÿlÿç³;ï”_ÉXkv«"Óyãi ›´põõ³ò—¼Z¹vÓ©Záé‡ò—¿2z·ÅÌ-–‹p?"‘[B8  ‚ (JÔJàJìJûÊH-ä®5»T™F`ÿwIp¨N€Ü" ¬D®®Ä¯„¬¾æBßK¡[’½nJ2 L:‚t£DHõ,Èmß!,¹p¼¯GgMë>ŒÇÀ~äğÄëç[Ï½ğİÿé!¥ò‘H«&¬ĞØ±¿û»“l½ ìE’+Yì}-ÑÛ_£´B"- %t%}ç&¯–JşºLÈ€ ‚ à‘Ø•ó””^º¾#ñÖvPFÀK€i(š´°fl
§•­oÜñó®«[~—†oOïxeÿ„½ÿí¿×û‰'oK#5k?vë~ëïSim_ò4  ‚  
Äcç/¼A  üa­:òuÏ€¬	x/özÄE îÒi7fuîô¬îï¯ûÒè·z7?  ‚  # ˆÂı;ÉŞø\ ‚  #àûë0°D_€ ëŠü`ø˜
f7mo½ø“›*<Şpş†Ó{ÕA›Ûå´©qL ‚  ¨"Bü«°Ô‚  !6ò7Z:Ïh€â 9
täGAøpâßÜ$GœHé~*E#“¹ş+½õØ¹<A  *BüGsÒ ºe”  ¨&Bü«´ÖB  A¸©- ¶SÈÕµ=ø×GgOò'ÚºÛşhicwñB2  	¸(ÀX" úªÜR  €AøÈßñï0*O€ èãïäÍÎ6¨
Ü:8îçÒë4Ç¢Á"³kÛ“\Jwt6;Œ ‚  !2ò7bÍpB"P-U^ñUİ¾¡1Ì:€×} ?(~x¹õñÇ«õÎªò`§&Ê‘Le²÷¯‡Øúk³­ßë0_ôHõ/h{í)ÛŞ‹ÅnüŠ  "`!#a'’Fü˜ÑxÖ¤ø»æ¯è9D|"
ğ7Úêä#Ë]57€,:‚şCƒ_<Ù~súİ¾ùÉóò5Nªò`¥$+î±øšC£©µïÓ-¶?ñ1«ic4}8b>Z±µï‘Ÿlÿå“=KnŠæ$  €BNbNÂO ÿçvÁ"ñt	lAË]2@5ùêÒ„0md:€ïÔ˜.\ÿí÷çâåHÆä]¢NP’%æ[’ÜI.[ŸØûWç•¾×{İá›÷Y>IàÙœKÊH-æoeÁºøœéÿÙ]Éî}0¸fãÔ1ıì½@¥8];5qı=yÈ…¾ö~LdA Ô$â$ä$ï]Ñ¤€¥$*OÉpj=„h\ünßÏÉ$%r%t%}ç&óÕÈØß˜°@@$â$ä$îå[¨”•%…JyIUÌcÉ_5ö_WbWÂV]s!l×®’«äq?^#ë×¤mæ$èÔVÀ¥?7h‰bVG&™^»?¹úÃ÷Æ¿ãe½Õû´şZ]s#o²¸H¯\ffX"ÈË‘)…««ò=;ûÎ'Müå÷Å•ç&òUäU!%3©rx#0%#'35v¯ÙT*OÉR¬ªËÔc’¼Éì¼„­D®®Ä¯„¬¾æBßH¢ŞP¦MA9 	9‹:¹ÃŞÀ¤¾ãæeææî @ÜJÈJÔJàJìJûÊH-ä®5È¯CJbò BÄiq PT¡4>8wöò5öÅÉÅ7–ˆÓ(·¦Â‚tÜ ‚   ƒBÒ®±·çnĞ”ƒ‚ì LŠØ’¾ÙmŞ­À:¼§ÃŞsêù3pÃš¹Wìª%æ©Uô  ÿ íÇÊåÉ‡r¨ä”v’mThE D$â$å)eRP›”µ©Ó„µ‚‚¶ ¯®³T+’YÒA¹Xu¡ “€“˜P¥™DeJbRŞ¢FÜ!e	W‰UX)¹$¥›VÙ€â ;Y~·fîÎ&íZÚ©WL_U!…Kx_¿ãT”Eeƒë)¬JÇØ®@;K6ø=ÜE À$â&ç,Àµ *OÉ1¿F! Ğ‘`•{·\¸v’mô¸Š€IÀIÎ]…j P›–gzˆFÑù:	W‹Uø7Iëgß…¹@q –¿¢ğ>·=ÖĞ‘2/¯½#vŞ›WN]1„êÖP’gzˆF )R+Oæ†;X»v’ÎN{Ñ “˜“±0.AÃĞÑñ•Âg	Ñ¨¥$(ÎõŒDRA"UÖÉÛ¤šw5ëJ (%#1'bdX“„ G§¥.˜Âui*K	1¿F! Ğ‘H•bv±vé%œœ÷§Í :ƒÎ]ùû§¯~[_!¿7záQON}ªZ…:S	á™®¤÷OíZÔúÊ‡v^yVæG¦}íu=µ¦_
ùã¼ €@­2qòæMX«—Š·9YŞo;+tSÀ0nc5èò[sç®ÄÇ‚µ!wÑÌ^±•şµ‘¡İ>‚“ÓœGŞ[£å#’¿Ÿ2 l’¼n(<G°Òn.|òå¿³ n‡®UI%zG®í~|ò×}˜9üzÄ¥5m­ïIßÒİS^X½Yxõ»å¦ÏW÷­µççãa2…K÷RÛú[Öög©ÙhB"É äÿ±óåÕÕØø°ôF`OÀ0na–¸ò6úJüi´Z•Z‚¹"¶­Í‘%eã4’Œş?b±#5o’¾kí	T#0^ ­K¯¨ñüZ¸ôT#$Óñ»RäUIMœ=mô~Ğş=R^‘,NoimLšüŞ9w>~òGİˆ%»š=|Üdæn(şÚ§v,ddLô©—ŸÕ](›ÿËøàôFÀGÀ0nc™šU¿æNÿÌ#äipAnòµµ<üi!ü{ÅÄ{1ùê*@"à©úë(g!€š2SG’“L^9f4Á×ú£¤µüxÆukõm~^:;Ÿ6ù>æe4X¬¼ptÌw«ü*aÛZ®E¨E¡"’tıx§4ë½1<¨KÀ0nb–¹V£NgñUœ¾ LË^Rüi!ü{Æ
Tg%}\`g:ï4&Bÿ7ä§ÅÑ :‚-ZsÇÍoøñ‰VWëµX}ğÄÅmëÏÒïÖıÅéğñ¿Ë¶q[üÆRîÌÌhè(cÅè:ƒ,q®ã%ëS±>`ØÂ,yñ™VJı˜ªĞ‡‚IOBı4LÊ ì4’Œş>âÎğ…şA8p*Bı:”S¸^H¡m‡Ú»¥5üxÆuj…¬ößÿËR”G_:Îº0[Ù~j¹yØ¨Eíê/æ=³¹0,
DM#SÏ¢©ô‘Ø®È/Ø0naÔt…ıW|‡ª.Èäo—w]›´4’Œş> ¹#úªùP]”É_wşóÒ@q Ÿmìù}CT½ZŞ³i”­m[´Ú? µõ|t¶&[«®½Q‹<|t¾Y5ùÕŸîYJçÊNŒÉÖŞZİİ˜OW¶Ğ‚ #Â|€$¼Ti!üyDŸ„k#~¥à@¼!~¾g~…õ„kÏœFÖ¯f7ñUÍ~ (Düİ] :o]²×h&­m[´Ê;T¶­Úm’[Z¼ô­Ï,íOU,bh©ùÁºªê÷z[ß97zp±XÿW~GjÎÊÖêtXB`LÂ0èú
qÓåÏ™«€¬‹A ËëÎ#R›“-¥Eï!~SÑ\Ë]]¸šÌ[À0ncé÷ºBıë°MU>ğ7z ëvŞ‰×¶Û«õ¡vì÷vîòéukñå›Ké”bÜøŒºıP·«²âª–T¦Ù3ß2X:Ìä¶«ÌtGA{#[ÄDs—ñ ³›	şÊ‚ôh/Á|Áµ€X?[«®@J	=¿¦A²zWò´Ú„|!~¢g!z‚“ÓœGîËVı/úªı5S Œ„@ıÂ$„æZw!·cVç¯ESİHFQ^©ígŸ»ÈmÛ(¶­_:]±›^•õ%oÊ{Wg©©´øöéÍÕ/éÌó¹wvêĞõgô ´ Ál‚{º3qùi~•p£>;à,¼ğ'L›Åšçú5+ûéŸ52ø"ŒKÈÜsìb9TÒB3øòˆì¿æ¯ì9Iü #|A±­à:”ÏIô®ëØóWßàß—V×&¯½öZzİøñÉìé4¼ys_[M©È‰³×Ìt³O¨œeÙœOŞ¼×ç¤H  cÅPów¹òö—ó6ç9ñ ,ÿ
Òfñb²}Jıù¨Ì\	8!|+ÓÅ6‚“ÓœG|òj#óÔ"Y„E¡bñ¶A:—ˆ¨U¶((“‹Ío2>ëxàôúx¿]oß³§7O˜}+ïÓZ9“§İ×Xì¿ôD"M ‹O­ğç”d:‚u¯DLT!}UÚèB`û;ƒJdõĞLı×lÇª6æ¯ìÙÌ·ì;éSÿ+»Òw-4ú!ÙaçÇ¡bõñÑ°‰|Ãåhî^Ş»â:ºà  @%Sº»¯Tì¿ôD"Mò–8£‹’TÂ¶vÔƒB"{>Bıë¸mVfğ7ÏºÈØø@şşC\PDıWf%¯€éFç ÷ßcÚÙ2‰ëv¿š==^Şnß‹Kç“3×upëû¢Û©ÙhAPƒGIi»i`pıŸi8Œ" ½úªıP`¤ÈİKo5ŠŒ±úêÇî2¬’½®P7ÑÀi:m$i=°Ëü‚:^>?6aõÏÔ«Ï(¬Ÿ1ücjNlíiIóáÔd´"`/SÔŸ—	à¤ıøB´ ‚‚Øæ¯Ûù¡Duè¥úê§%`  ±øªğæPYÉ_İwœkÜwÒ×û5,Ìn^ÑQ<äåmûöSåœè¿«ók'Æ%ñ¥Fñw~nG–\„UÁå—'±2£‡Æø'k”µ€àğNB ‘ı÷M˜ˆ°!}ì¸ˆ@˜Èİ2ï%iĞ_@¹ıÔŞ÷øè8½r~lÔQá©-o³îPşôñÕùãYù^œşôñwttÒ{{iGu8,#` c%0Šï›‰oÄÎ-iâ, h&Büi´Z–nóU­ş¤Z˜#|˜äpÜ!~Ü’j¢ƒ‘ÖvÜ¶uáâ÷äœÖıáÒ±`ËçF	Í,¶T¬¼pÏÿÂ5ZŞİŸâ´ãŸ\¨A"Öµ×zìÁÚ©J«Æ9Œœ	Ô'BåäÊİå ´Ë\µ'ôÉ_ôö‹ "Bık¼Öùi½}÷ïUï_ËXUw§«F/¾zv±º}­çï3AQÇ¹ëû^;R¸Wgäµp“jö•n•p²0rL-x ‚‚¤æ¯§EÛà#Ã´¤­_òÕdJÜCANóUÏ|ú¾h£<‡ãæ‡{wjz2oó ?9=t|Üå”zp¡ùã{“ÜIÇ-lí‘ÏLL¸,‘Î­‰‹Ûnh_æ…=¯Ú„  ­‚Bÿ+º55‡p*Œäou•4!`*BşXÓq|Ë]}¾]ŸŒi—B 3_Njñİ5¯Õ‹.W(/¨,şzùá±1¹Wß~ì›^m-ZßN
,„w9"’N·÷8]\pı|ºaüJ;Í¢$ *BüˆÌÔ
Ü#lQp€@DÈÜˆo4ÈT]Ârş~¾ÿÿôq
5|âYŒ|Ò³«³ã©c‡-OÌ_ÓÇ'.äµÏ]X¤ùŞ^¼ ƒƒVçE&Ü¿éSÈßÙõÇ6¼ ‚‚”æ¯–ÙEÓ !|m(\•ú¨íf2Ø’¾Ùl_Œk~ô.áÊm?=ã¯Óã¡Ñ¦ºúÆgIn4øckšıiîB¼ ƒƒvÌŒXÏäòrcç?áFXÙ…µ™u„LÿÚ±<É_=ö¨h\ünß$pLÿvÏÑì:ƒôD?œ±XüşÁB*õá±±»4¼tl¾PYø“œŞ±úKœßæ 	8‹¦9“ìªõÅ)ÄéÿŸ÷¦$ (*Bü)¸(•6ò7j:Íxçù+¿ûõÜD!¼E¡2ñ·16œâY„\Ò»†G×·´fO}š=rtåñ×›Ó5ó×ËkJ&^İVßN 4"’íİóÚRE m#İº^]s²ü´éÿ·õ+g‘MÅ‹ò è"Bı;Ú(ø!à©ùë+/€" ¥úªä½PT¤É_O´ØäëQĞ–Pv! é¤òÖ—Ó©]::ıëKótööÔöN«3D\«ÑhƒuöE<•Ì'²I`ğ„¾æBİ[ÎZ.NÌßä‘ ¬{hGAóU~ ËP‘¾¢Ş_…€¹újïB+´¼¿!¾4öd‡»& 0h–5ög5,ÏT®zx·.®é÷/J0ñKu8, Ğ™€“J§97ÆZ»æ<½èïşYq=}æÍHÓåÁÚç,ĞF@À•ı×d³¨2–Käm)ÄZ h’¼kí WDTü×uì:€×tâ×)ùÉÍ.Ï½£8’7ŞŞ­T÷T‚‚ı›&y`òÅ€wÅ“3éLà«f¥.¿ã-¬ŒË]‚‚ål#l"Rğ7§È±´!}¶Ù©z„Dâzİh¸ôK"—=¹ÃÒg:=µ±½,¼ğ›Î š(&ÙVÇ¨Úç¡!è‡#³6'Ì/mâ 
h&Bşi´c–:ğ7vZÊ€@#âÄË\=—™jòÖÙGÜ8C«º5zWvæñÕÕßjûšWw¤î]Ÿ·íÀ\hQ ³ø~‡aÿIé—«.Å*§¥à0PA@ÕÿWB„(ğ@ıõ˜(PLÿWlLª*`æ¯nÌ·n8¥s¿MlîH',¾ç×±[Ì}^£ÂiĞ¾7èŒA>Ğ±yµóÆGÒˆ:—§­ğCˆOxŠ‚Œæ¯¹EÍ #A°”-xÊİxÇéì´B§Ç%¶Úl£¶Ù3v
îÎ$YiøBrH;©Y=”! ¹€‘Î-YSögÂˆ;ÈÙÿ÷ Æç‚ è)"ñ+!kT¾Ş’UwhE&«ğ•şl“•ÄĞFAâVBÖ©Y¹$®îĞL‘¾Nøÿ8Óÿ™†{Æ{Wf—·'¨T¹¥/*·©ÙhA ¶ã$ÓWİm1ZdóÿË²£$w6l ~ %#"JşGiÄZ®8æ¯9y@$ø.BÿúlÌŒ	Ì“¾r~ôöX"	ItF oÍlèY÷Â²ñõÙ®qÉ”( Ná«ÅİN¶˜ô\ÕZ(ÎMŸú©H¸¹«œ´! €…/ùªÑ~Phšãän›µµ4)½ÇÈİéï:)TDıWd'ÕÀ¶b*;8èíI=·ë¥ÆÍÊòU?L,hR"œì\õ¤’Î‡ Ë$®NŸş(}"à"BÜ# ”D®®Äoî±ºæBßKãdîø‚\’½^Ê2. ˜JÔJàJíÏ×*òWæİñ <!~=‚ôo[GfßLÍÈ Ú·3û›öõ=±º^]s#m@ºÏŠâ6üÅRG<²cN!]üÃZ;ÏxS9:{í±Zg_”! ˜‚®Ä¯„¬¾æBŞh¶ÈGABóUÃL d\‘À•Ø•ó””_Ë[”$a8+ÑnóÕnó§äâºj@0êÎ$ô­o””]›İ¥ ÜH´ö,ÔÊ.üµéFå½95uá…ø/\ ‚‚vº¾ó‘
ïˆ¤b˜fğ7udEA%‰_	]yÊ…IwR	`!~õÚ\¢÷Ú-¨E  ..IÜHµvGÿŸÎ}õØw“İ¾ª
Ü ‚  "fğ7ÏºÈØA  T!}Û„eÔq0àrE¸ ‚  
 ’ÈÄÅ¨Œy¿¥kAK­5ûÃnD§W«!ôA  Bà•ûyKƒ¾€`|B"hæ¯^9Ì·]ùD´ €¥ƒO'³IÜOIˆb,k·;{ñÓ‹’Ü®•gí»q¨hA ‚‘¼Şt”   ¹øøÔW ÑuqÓY ¨F"± ÊİËÇhO¥âê9>
yîğÁùÛó~YŸ{ÈTA  °!|lq¸†  x(Áê!~4Ú|¢4Ú-HE h
&Z—ÅS‰:%rüF¯îÚ–¤­ùıÛá"2üA  B ¤C´;‘¾ÓŞT   ø{B±Ô}$ĞĞ,<†  #àˆB.”èØ²k%"“ä–,jvò¶Q˜Ÿ=ñŸ«ò=‹–ŠOûÑ A ‚È‘½’Şz    C·ğ4Bûº§Ôÿ ‚  (,‘l‹'rˆOd•Êî£G‡oò5õú áûy…şè†   €AÈŞ
oûKäTA €ÀÈÜÃèèŸ˜é8Âè  
¨,c§¸v-¬ÓŠ¦;TÄÆãwgïKÓƒâ$şdóÍ_—Š’ÌŸ¢ü2   ­ø¯?° ‚  DPÿ×aÜ:ƒ×`öª‘H@!xƒGJ_3Ø¾¸E&Ö½kqc?ïg†ı—ûèUÊ†{Ÿ¢,  ‚ K‘¼“ÚeŠ<á	 É^v¡d@Ö'¢  # C»y»N/¨ØÈw&Û–,k­él§šœºøáë¡Ş¾ğ‡]Ôõ-œA  <aXtÉ^vö€HA  "Bÿ«¼ÔC«¼DTŠ x	)U¤‘kKvî©.)ŸìJå—WµÖÕP)LÍ_xp÷òïN]|¿>;WÔ²tE  @"Ääo‹5•¤ ‚  ((Bÿ)j¡h`B«¸1Ô†  4$‘oíMµ®«"Ğ¹.Ú¾¡º¾Ş•Jrfçë[£|tÿû¿ÈßÙU*ÏÖ9üA  @‘ÿ÷qS™ A€ÌËÜÌÖıÀ·»y@d ƒB‘é­nŠ–İêAá-¾É71À”«&-OüÓë¤şlãôÊ~U™¹S=!/ `x ‚ òÓäí>,A  ğDÿõÅ¹°Y]8|jnjŸpY€ğA‚F G?ÓxM=Ü±ªZßÅ1©í,ód«^ºğ«•	‡“ãRŸ;ş¯Dÿ?“g¿–½ı@`ívxv%W*¹3€ ‚  # …ûªÅ=R&XR< 	T‘¼V$è4q®Ì]R "à½ƒLµ÷Üi˜5ŠW³zC#Ôo¹ğ¯Ñ>,¼\š95uñÇ‹‘ÎŒÿÃûıÏ³#½>sóÛ“g½=uáÇëH¯Êjçùy‡‘b”ã÷Oá ĞNˆ0!}Ì]hE  CÁJóÕJŞ¦Äæº*>E 4ªÀLÀH·e”?Oµšv1¯I“ŞYá-ß0Ã0êãEXºZ˜-š;˜şbçÚºò˜¾øñÇè½;ûÎ§Ìş¨R›rbÄA  AA"ñU Ì A Ù,…ÿµö
ë,ÑCË2, #àƒmjXú@Ãìñ §‹Zİ
Ş½)İ½:ÑĞlÅıÎ…s3`İÛĞ?’ë| ‚  ",ƒsänºõˆÔ ‚  „DüWq-ü<hP€A €h	óWIİ~©¶·•ÈNeî©S~Ù“î©âëÃÄ’épb|ãäs|u¯ ¼y AAfñUåŞ 4A ‚°’½¨ï,Ğìï  ‚ 	óvô÷NİbÉhŒy¿¥9Ú¹4·f{«jC 7sêÛ¡Q8z7NÆa\L…ŸCM]z/Ä\ € $ã¬  @%R  „LÃ#Á´¨®*Ø­ ´!~VÚ$¢UÚhA  ¼Kf³ş'ZiLeª]¡uË¯nŠìÚ‘êŞ™îŞ–_rg»vy¢MŸtş'8<w‘œK[hS¸ ğ¸GA*óUªì XA €’¼ˆo$Ğˆmd! ­„h(b&Y3¾zX•ï¦Úë.<œKd—&rq_õ¢4+äiöâ4  ‚Ø’¾Ùm„ ‚  	Ì	iø•ıW`Ø:W`©A_ƒ‹£À,8òß¼æõãóÂ—E†İ«Õ¹’Ü©’s@,‘kêËö?)%ĞóU{½‹ŒµwÔûŠ‘üç¿kÿq1|AA[îSÑ¹‘”Ä¥0ÔßË_”ÖFüºÈph)â^Kz6°´Úìµûè¶ùÀø:€]ëÀ:ä
}pëÿj§_+–Êò¹62ıë«ãû,_™Õ§ÃJîDl²#ˆ­€‘m½ô‰.KîJ·-ŠèJ6²qœA L½KJîDöƒ@À.Bı‡ywZ˜z–‘Ü­)7g&Bşf€ èÀì˜:Şğ'·…­^«]ãÃ«”šü?jîF®®”
&X–gzíj\şw§d”ŸEñıå›ùßg»{¤@"6Ü§§w"‡œ‡ø.BÿúlÎ¸S¾FÜ§§w yDÁ°P!ıŞd£ÿ6eD>^½hUë’k”¶­šİìßËñfá€y3™[xê%{ÇÒµ?Ÿ£fW«bc3ÛLwÈŸsİ].—§Š“$<ĞÃ	‹%So¨¶ñ Tò¯.îSÑ¹“¼Ğ`äˆ‘½Úi”Š‚ÊÜ§§w ©íJlX’¾oÒk2–OCRVåNMZŞrÒìâÊO§¢ŒÅRìqœîİ“ë»8¹î‘×‚'ZTşMoÔWçkJìŸfØ¨XÍŠ»úW§e„’Î¸;%€ ‚‚~Ü§§w#è¥NÇ’¿
m¤"gîSÑ»Ã¾§i£ÑJóÕKß[`q}K¼A  	Šw»wfûç\íßò³ËM´­wç‘£'ï³Œ9®€l ‚  
$ĞÇäl@óLŠ  !jñÕ¯ìæÙ.IÇ›Bo5d·'š[TÏm´zŞäÕü¸EA‚{¹£¥ş÷Í½Ó·ğ¿lÙú­—gö'ZcE"³#¦Î1‚‘k­`]tE ‚ÙE¡Ï,&7ŒÚŞr10|ğPÿ÷Q˜¸ˆ€NÚŞsã`ñ¹Ï/'#Ñ<Êİ'µ8)øè•\"_‚9”Z/oi½ç/ªGç·z4ñüZ¸GÁ7"‘Hw®Ì®{£cêmußùÛï™}­wÖ—2Iî”Æ{º3eıIòg§ovÇÕ¼–É-‹ò #‹z–‘ÜÍ¼ ‰ø{µ%eö`ñ-'½;ÍúÀÚ#Ú£qà«ğ¬êíßĞ¾½{;øT¬êê«nvİàŞËÌk¢&	ÊM±nMfÊ×WM´nÿVçŒ}Ó¿úwoù»î™}½oş.¶­şÙ×TÍÉQ÷®×É%§§kÆ}(ï³EØÁ± 
ø³½KJîEø”±<É^v‰P[À¸–ôme¥B*.ç­ò|æÙ¹? '±jû«Ä6n^ÕÔMÅçÖİÔòùÇ.»”¬ş£«,»=º¨°y ,å}=-~ÉõÖ©­.™½İ›$ô·/ºÿÕjé]kâ¦z@Ì˜
è-â^Kz6²ìçÖBğ7†šÈğWÀ¸–ôoenEæÎ&LË]
( ,bhGá1úÓÛ§5İñ¯^÷Éé«ÌwÛíñÅÓâM{oŞñxñûãK£Áaş¥­“Ì…¡ A ‚	Ö”“äoK|›.ˆ$ALË]Mxƒ(qçİfîl
}pëÿj§_+–Êò¹62ıë«ãû,_rrÄAA ¨A  Ô!}×Ú	(A  ˆù½e§Pqhü@¹É2Ğº88~ùÚ—kƒƒW/Û|wô ´ ‚   ƒBñÔ!ÜCAz ‚‚Hæ¯I¹@,	è!À·ùF—ˆ	¹~Ö«Ã ×-mZ?B8  ‚‚ ”¤™øªØ†R  €@$ÈÜKo0ˆEÁV ¡\äg0|Õ˜fjjÀ©©¡ëK¨[´ ‚   ƒB0çn0{<Š   ƒBbÿçmb4ò 	¨%À·Yù@4 ‚   ‚  ¨%@D ‚   ‚  4*ØéÊñÓÇ³3E<œıéïÒÖ|2ÿò†}óŸ?û‹Y,»“µ¬üfYoIé'œõà2<êÎç=ø×å‰Ï.İ4#PC€Ø
¨-"‘*Á*ñ+!+Q++²Jş©¾nÛ×f³4µ¶]/„ ‚”å­'4<±[šXÀ„\#OÉ	Ôt¹T¹!ÿË{â/|}ë•ïx|ıå“«+gÇG‹Q’¤Án¦Q¾÷‘y*rH;I4ë,ÉÇ•	x'LÌYü¹`Ù€×GYû-mZ?B8 # ”ƒE'ûªÕ–†¦[ğ75ZÈ@PYBØÛÉ_f´%õ‡‘¿¢Ş`‹‚é :(øqÿ‡ìÜıùŸ³Jæfg¥JõKË#ÌÌ~ôÌšsá¡ñÒác¼#Ò>Ë+;¸w÷.¬ÛÒ½cGEWu8, €@:DÌÜqŠ³	tË]u= t!}uØª±ÖJı‡ugZÜh} <4XùáÓ4^>~x§1Zj^I:~iç†İ|zåØçò „n•`'±jû«Ä6n^ÕÔMÅçÖİÔòùÇ.»”®·ëN8 ! µùªõõ„©ø_än›µ´ A.ò´—õ\°şµ¶â ˜h}=:Syí·Óµ]¹vdÕegM5Ü(~ğçÛ{®ŒÉGNÅ “>yóİÛt®¾œÛÜù‹]dDNA`‘şßµ*¼ãóæ¬Ğÿ†<’½?A3bñÕ1B!¥ät¹V8~qó´Ÿ\ğåê{ÿí‹Ãª±0“O&“Ïnå &Á€ˆ¼D¢¢Å#ùûÜ  ‚  ø&BÿùdÌL ƒÂäşà²ƒ|ÓÑSæu]<~zHaØgˆâe"™ï¯”GäÍ,¸Ğ   €AÈÈßo3ÈA  T ¥ûÊl A €
hu~æaÿ´Ü/ûN<8_}á‡ã)>ÿŸkş”ÄŒ ‚  
ØÇË_zì ‚  !à…ùê‡*` ‚  ø/¡Ğ÷›Ó¾0T,»ò“—ª?xxõÕ²ªÇmú(B¡nJ%tjdõÁ¥IyÈ…¿¬zA ƒÈ‘¿‘ü,BŞ »º¾ó‘{Xô<‚#~#üYƒä4!#+±+ã),»‘´À !à†ƒ4ÒDNúeC„|}Ù<xäÃ‡˜À˜¸)pvu÷º|pqëß2âó‘y*îÌÀh"o€#äo¸5™ÖÔjà½D®®Ä¯„¬¾æBßKc@ò 
DTüïÔ²ñ„%h%r%t%}ç&òW‘AÁE<¡'}M¯úû1-ó«28õµì­ó‹,õéë}^ûGß•¿Ó'LÿnÏßG;µŞÕ$¥X¿¢¦Mâ¹^7ûø)#CûƒCÃa1§úÓÉXk—[ñ¶¸¤HDáÉƒÈSäl öM¨¬€„­D®íüÉXk—[ñ¸E  ¬Ë]*Ø°‘•¨•ÃŞBßH¢ß˜İÊ¶ –E£OŸ«êß}Ğšù¹OÚEêå«½wİŞ³vavÈ²u­.“JDß‰Å¹Ë¶$—õ§¤˜v“o=ß.Ôó¡ò-<vtùÍ‹iåıè‹‚åIç·‘b¥³Éä×H¢Ş’ÔÀ\# ¡ûªá¯Pr²®±µÔgH¢Ş‘ÔµhAARÈHü	j4‘x••ª¯\‚5É,éS~ˆğQCôë*ó…öL9jËÇµŞÔ÷ÖU{çkfuÓâQÓ¯©'(Ì>ÚĞ’“'¯Âú&¬_Í9ëH|º<Y-ZO*´®Œğ‘>­é¡ îºFüÎ·x’¿{íÔ  øªÀ&R‚|æ¯~yEÇĞPúzh£·ıÃs&˜aÅv›³Œÿl|MÖpğ¼alzSáË?›¶·ÆÇ‚{fm(–Û¾Æ§$}ÅƒZDØğZàågòå˜ü­˜øAA&ñU¤Ş¡kÅjÎ:®•XAÁnñÕnÓ‡Åá@ÎkÅjÎ˜.™pĞQCÜér©óÓ9bÅƒÈd
.qÏ¶%{»iù]lÉgïQãFÏU¿”aëÏÛq=Û—i©ü®ÒP*§WB	 J7ÿ„Q©Ô"Áâ™€“P“h“ªYûX’‰Ìèõ7ûªİR2 È’¼Ém‡è&Bÿë´dU=t M™´ıƒÙ;Ö¿ óÉÑİ^Ùñî‚^ww%{¦[\Únğltªxó*o#@PXZ DHş×~°XA 4É^5ö€(ˆ»èGÁ!D£&'J¥Õ=Õ^µ®çïÙ“*½ò»ÚU‡½úÁ7[©n-i8zvhsàZ§ÀXA üÉ^üöˆ@"Œ®*hänÔuô ‚PPö ûãEçY³gBË¯yÛÃ“Ñç»Ş1÷{ÛTmªq.¦Ù70÷	\A @!À‡‘¼Şt”   ¹øøR   ƒ‚¦(@Ş¿<9znöõ³N/øVduïi5¾çx¡ŸC÷,ÏÛzüÈíÒ=öÌ~ì ‚   ­ÂOğ5Ø`tA ‚H“¾	·œ4 ‚ `Pò ùå“*xë^[aõ~ï‡†Üø¾a|›iõıímî6}%ãÉÂ6È\3(lA  PLüWnA-…ÈA  ü!~ş’dA €À”:*_²úWb mÜÿbGÓ™Î~·Ø†dÓºêıšÛ¨ƒ·^¿8ëæ¦'JL\	8¢ #à•ûè—4ğ ‚  #ñRóö¤\!vÔŒA˜”:ƒ>~»ÆÌ]½»§¡+êüww'ÖnËÛÎxıNãïæ,  ‚@‘½CË2, 
(%@8
ø*BşùÈÌd ‚ 	¨u].T¬_ÌØP·g™´æl:{{jÒô×MˆÛåñz[¤42:ÕUÅ4  @%P !Wè¨ƒ…ûè«9 ‚  #‹¾ü,A  ˆ‰Şpj/æ5Ã×É±†ÙˆÏ®·eJ¿=úº¨dÒ’«š|Ù#Ç^¿3ûĞõ\ ‚  # ûªÁ/R   €@ØWÉŞD¿ÿúì"Ü ‚  4.¡Ô÷¶Ëw¥´èM~ö»€Ğ3‡Ã×®ÍJ7¬qo¡À,A$É^¥¶„`A  "BüGe¢Z$  ‚ƒXÓ7­ØıùÃ©0Š =ı{Âl’DÒZ¿(±¡kã›ÖìÏÒõæĞ†  DDşÏ^°PA tÉ^vö‚J .ÁøCÁa„¢'ÇK1Ó%šô¯^Ûcs×¶YôgMO–¤&íWáXœL†   ƒñÖ‰|CÁ äB"Hän—uš´ ‚PPê zå§ß·>fYáßCÿóg¾Zºy™œÙ²îC?€, ‚‚À•2ò7bÍpA  ”!|–ÚˆA  /âÑúîR}+áˆkäO€¼¹5ûµnhÉ¤6¢§^ØcîPËLŠ   €¹€}o’¾äj´ ‚   ĞÀÁü^=ø¸[„ô ‚8(u>8]´’íèTê»ºÌ¯ûı'b²El ‚  #à½û8ÏœHA  |!~~‚dA T:´üêæ´ö„_œ—`_ÿ;Sà¼ò$  ƒ‚ “ç¬|ØÌ†   ƒÂäçìäıx  B"
Bf*5â¹6„¡[m‹°]ŠÍ¸†   ƒ‚şõ²Fÿû¼ ÌˆB LŠ<’¿?2  €B‚C‹tĞªµB¦¦Q†ÍŸØ.ÅæAl ‚  #à½€}o’¿üï
0 ‚  	D@şÃ.°DBÀN#Hö9Õ-Ø|u,WjY’H¢ÚHA  hDşoGdA  ´	häl@óLŠ   ‚ƒ@Ğ­(A  AA ÈA  A  A  ¢ƒ@Ó÷ÜãoÿæÃ=mı}/eışÓ>—Xôt<‚  !2ò7bÍpA  ”!|–Ø‡©ÁøA œ:ƒ·=´.Í–} q1L£aõqÕJ•<-ÆÀjè‚  !h§îåK‘¾‘ıÎÁâ|`ˆ¡ùÇ]dÌ €AT:M¦ì=Zzp¢¦ÍÛ£×ÎkQŒHP^ ˆ©ùÓdØ ‚€‘¾ƒñ28 	D]ƒôø,¡Ğu­/`±ù‰r”£m‰i´]ŠÍ¸†   ƒ‚üç®üäÌŠ  #0%ä¯äo—uŸ´ ‚PPêºßï¢*Fl×Ù›âtÅ·µØŸ§ª²	(A  @BqíJùj÷!|¬ghE  A¡ƒÿüÛÌ ‚  	h$¡Ğµı¹ïëvf¿?˜İ¶.Å~!6§q Aüï`‰ÿ÷|E™ B"änvÙlÜA  $¡ĞwvnÊG?>Q,ØuòìÕòÎC?oõ»náXœL†   ƒñÖ‰@*ÀÀA €€ÈÜâ™ @!„¡qîˆ•­_?ÌÌ!U5ç¥rú«¶œ7gZãöçöĞ­\ Án ,@!:ğ7:zdE  ˆ­ùß½dä	D]ƒõDRÀïÃ×~½gi›I/ŸÎ–‚üéR±pé½Ü9ºüoUÄ,A €³¬KäoSÀ¼ ƒ‚„½øüR   ƒ‚.hC,°:ŸÏ—Í™õ†Æs“s§§	³ÉØ±šülæ|	_›İvsÓ¡×ƒK’–Gf+wıCñp­Ì†‚â K—f_æ¯™E #}A°- ÔË\Õ(Zò×—„˜	ø ¡Øôòu(lÛ¬ùÕ’éSÓ‰c-›:x¨Xª;jv/Å-·?AüèY\ ¨€¾|wß£×ºgÄ|pqëº®ÎºK$E§ ËË\¤WôA¡*ñ¶*>D"täoRXÉ¿P#~£´ã­UA´¡ãabVÅ†jd¤tüñ§OMo=7•Ÿ±ûóƒËTef
œÔÀà
è"36QùÁ¢`Í¡wÚ,èŒ¸ƒ…ùóİ ƒ-H¼!|½PdL<!~=€dXü!ÿ6eD¼Ô:ƒ»Öê±òÕætøøÌØK<8_>rÓïÙ¦å›ÇHœ*½Šçó{‚Uı×³şó¾wÿ‡Ş	ë'±JP‹Õ÷„Õëİ‚¥qç·‘bd?Â:bDEÁ>šFÿ¹…ìÖK’v’y’|‘C„¯Ï+±JP‹ÕâÕSÔTıµæâ&h’½kïE@ÖIŞIêIöJJõ‘Ú¥ªEèih<Ô®øÚí*y”:‚íêI-±üQ†•sç£¶Å‹\?ˆ X®~ğì™OlÀ¼u!İØ´é“Yá‡Ù|woÿ.œ½:8_)Û|Ã¸Ö#0¸Õ •J=S—ÕÒ1¼¨ÀévğÉhÂõŒ  •øªÔt4P$ä¤Ÿdœ'c !¸ôŠÍ,5J'PVäÔ³P•û[U™€,ËÜ,%uşV’NòORO²L1ÀdÊïP‚U õIVUå«Èß*ï?k´PîYÈİµ®V¼Ú¿&'Jûß÷î¹*g¢MßŸ,Ø—&µ5ßP¡oêø•ÿ[ëœ=vvyIª•J=P–Ô¥UUÒ*äç$ÑÑÙnŞUK½ÉŞ†;¼“Œ“¤“¾P©kªFªÚ–ª)8Ç‘½ÓÚjW¨¹ûªîIÆIÒIİ(µªFªÚ–ª)8Ç‘½ÓÚjWX–ƒ ÑVôõ-I/ëMW4,j¹{)ÿëÇâ›?yóëGâ×-çï†\6’ïíKÙö‰ÃŞo\“´Qr¥P–Ô¥ba–”JŒÌ°"bóUİÌ—Œ“¤R±~ªKhP³2K!~=€dZÀ-±ıÖfIÆIĞ(¹&ªKhP³2K!~=€dX\Pò[—·cLZ½Ö	ÛûS3ø?¬T<ş-[OŸÎ’m\‰…³M›L„êÜ804ªíbU­Ìv´Ÿ@~Ò©R3¯P2! !}4ŞÓú3Í¾„«_šèç¬è¤ˆ@DÉ_N5XçR»7×´™ıt• p]CĞ ë^[bâ×<ŒR,-˜ùé¯r>Y„ıñ¯³r¤jŸ=KíimÌ&çÕµéId•¯Í)­å¨Î¯I,dt*vì—:à"óUĞW8âU­Íöï%]$dB "BşiºÓ(fÉ¶¹¾Ü»ç¯ëd@4Pö [5mnwñ2ş®_Í¾ğÀğérQqó& É³5?z@fíêI;;*•œQx©ÿº…ÉÅ»ÿš oŒlìKÆ\° gÅ#FîöV2ü’¿ÿ›7<cÀÿ¹´\B¤BC"O‚OâÌ—Çò˜P• Æ{>“œR6h’¾kí‰|Wå¯¿mv$ğ$ú$ÿ}˜Òu *@ÊcNìĞˆAÄÔ>ƒŒ'¸êJ§kı"~p¢÷ç‹"…<š(\ú:R°püÓçY,ŒÉ³7|r¦ÒÇ9âñÚDÖ)—frÈ-gj‰¹µzƒÕŞšşÊöîŒ–Ã¿6^¦” §/TÅ˜ b
È’¾ÉmLcå®Ì´$ú$ü%ôöu0´ fİná  ´!|¶Ù¥FG“¼Š@}+Á'ñ$ V0´ eWğ  ´B.¥ì µÂµ¶%wİÛ!5^•HåÍ‹êT|6tøø”Ÿ ×îmÚ@—Æ]üáÓóARåsì³lÁŠï¹·Ÿß™»±dËşµK\«_˜FR~ß¹{ÊTt÷Ş½¯~ôËŸm.šM%•¨§”Å°P¹rwÿ‡âl¼7%¯üŒÜŸµ_µÕÿïeÚ_óU¹W8âU¯Í¢Œ—ø”(”Aô-~e"šM%•¨§”Å°Pó;Më>ç´ÕêzşİŸë²	ÿÿö2†¤¼©s*ÔÖ»öÃ~„‹‰¼¾e8šV¦”¯ªâ 6ëÏG¯ø×*·şÛHBÊrW¥¶îuû©ú™ñã’-ı÷ÏƒLÕğ£Ã6ğˆ?+ŒÊ#3¯’Õµİoş*2N{G¥Íß¾Ëù²®®VªØ/Îè“åHUw¦t­ËŞµ·ß´—O&Ê×^­ğ@/ |{hŸü¾Q(Åæ40\=øÉÇ›SVJ÷¹¼Õ¾#o%|<ß^„—Œ“¤ğbãd†”ª¦·eDÑñy	B‰@FßÂV%êeR›XB2ITGÀé?¬u|T\¬ı÷Ù„«$á$è\Éì"¥)©ÍíP7LBP¢QQcÓ´—O&ÊÔR¢©÷ç¡Õü¾qPşXÖ¿rë<’RyÎ¿	³—³'¤İ|qû†ìÜıùŸ³2'§®ÌOŒ•¤¾\¯ÊH-ä®6É‡Iê÷×J ğ‹µÌŒãæëÆ;YÖm«şa¥<È{ülnİ/h¦Ô¢¥ªKhYSlAAUø³ßfg««:~dÇôù¢¿í]\JD[É^6Z2N’NñN©š¥ªKjRª)ˆA+¬òµİò¬é};ùªÓIÆIÒIİ+T³Õ!UJmITt3Ì‚¹÷ç¡Õş>ĞâZW~ÆÎ¶¸Í¡å{åóçÊò…<›yí÷ÓT|7÷ìİûà^İyÈ…¾—ÇÂù'¤ƒv‘Ít¼å÷yêŸO¿.¹¯AÑ¹>—ÿºYu}zÕù–¸ôT?ÈŞc0¸Õ •J=PT	nZºw=n·Ò‹gÓ_ö¶*%ïæ¯D¹/I'y'©'Ù$bç0¸Õ •J=PU€•2¶x T¤·Ö{XîûI`x]ùè3³›ÂIÒIŞIêIöJ¸9w`ÊïP‚U õIVu?LtN Ü~÷»¼ECÔµ$ÉãxØWúíÛ”áöÛ|ïæÏZõ,ûºZwÿw¸ùŸ=õ‘Ú¥ªEë°/˜¸4#‘)\¹6|ôåÇ³Bbó‘xëüÂ}š™»ÑgV|l~Ïğ2—ÇÅI×Õ{Ş¾xÅH·’½lµä¤Ÿdœ$aSã*ğÊïP‚U ôk¥F©Ø’¿­o™Ö{Xîû¬/Q­É^öJòORO²LPp3¨–Í,5J'RDz•¨úêù—×™÷÷¯·¿èœS˜k)vìÅïÜw&P‡^ñI§zèÙ±GÄÎ8…Hˆ°ÀÅxóÃG">ıï–ï=uëß|kkÿ†"ó‘yûŞæ,ÿçº»6ˆ  @%ST~=19bz•f>×¬•ûªÕ}R-à#}Ã½¾!__K#|AàğHüö
7:Àèu.»Ò¿0óÚ–{»zQsïó«±8ûÉĞÜı×AÚ™„nÎ¾ıÃöıçç£ÆÆF	VŒÍüvM¹ÈxõñÏZ¨o·T·¶'«æ[Ø:Mm{Ş~lë‰}NüG}Z>X’¿_oÖ{Xîû_¯U‰óÉ^-¶‰ µùêöÿ×š_ôõj½˜BŠA¶4ÿÁãŸ›¶åã
¾Z%’ê{±©´ÌçâBIãT­üĞVbd¥÷Ã[A,şñëÖË&? ÍuR”JíÉ§ë}s÷ƒ¶‡ò3'`øWÇU­n°Z»5[}k¥Çÿ¨feùÏ}dÔ¨"Bÿû²]åk¿ãú±kõg!×Ş )¬!ÁmlË^~¶¬Ü~÷»¿F«Ôî Z#=:lıKßJÒó×Ğ•O!nŞß*’y;€ ‚‚ãÖ¯çıß×3$$åNºİQç“2&$}şŞ:O­êœ!Oÿx—§W­3:ƒ^³?ÛÚgğ\Á{Ü>M¶M®D¢QQbQÁ±Ê¢j?,PÊE0O[±0B ¶´?Ë^Ş·Ìé?¬w~Ş¬şE„‹Š_W(PÊE0Mèô_Œ(’½¾íM¼ùëw~­ä õŸGjZã¾G:{±k›4ÅÑ=«ûí*e¡¹øŠ;¸m÷·å¬ÏM5ô-Íú›Ó/\?¼~4²Î¿oRëºÚ»¹‰§"®¬å?ïj4›øğŞ›_÷›‡®rŠäîŸ\CÁRóÖRİéÂ¿ÎÓ{Æ¬®1È/äo—uŸ´#à±úè¹ÒaëÏG¯ù;®ºAÏ/³¹/wí#œ=Ò¿gbI*ïÂ„pÊ 0”ûá‘_}JM¾Önn^¼ €@F*—Ë„íÉ©r¦âÁˆeËóöİº[-¸3	¨8…şºï¯z:²[^¹ìé2ÿİåûÕ{Ş|ü_\‰ø(¼CÁ:ó×;Yù’¿ÎÓ{Ç¶­ÕØİR÷#}A´- ôÈŞ ö¤Ü~÷»¾êØAÌŠww$ïŞĞÿÏÎ÷ÜóbÅ©u.Ú×¹×$Ë€ô=× €ÊP0àÜÉ|E ƒ(•K—6]¾pøû„»fNM¾ıê0fÒî²0Z–™ğÖ¾?ğÕŞ„V .BÿGyıY}nòµµ<B¡~ò·~0p+QõC­Ó€ƒëMÿ+2¹ïnêçxûqÏ_{Ù5ŞĞ:³) òß˜J¦ĞF?}ë&òUä”v’mÒY“øTdd’#iönN$A¥•qçŸÖm\¹;]ğƒnirö¹×/Ø9æµknk4™¨ùËçÒî¿~@ız»fL8" ¼ƒE'úªı5R" ¸’¼¸ív.Bş¾è@„8![Ñ± PCÏ^}­.±cNË—;st=ĞóÉ3ŞM§çK_îûò5l¾æBßH¢Ş’ÒO;Î”h@B?xzéÑù(¹±x®Ê=ı§g=ıÏçö?Û¶ê-x<ó[ßÎşóŠÅ_Ø¼ßäÅëÎéá»ëŞİÂ5  ‘H•`•x••¨•À•Û'|C°±-¡Ÿ¬Hÿ¯ŠˆÌ	Ì“¾p|E„Êİ„èyĞˆCh .œ<!*‚»{hİëÛR“4g[<¾G_Kù1Öİ”¶<úÏÓ†ZÓaøßÒfLNæfUòĞ‚  !Vò7«:Í¸A €
bıÈÊŞ$ @˜ Ğ†ºv|é‘ì»rşó—f¼}bFÖjøËî–¿Û-†Ñ4Şe"šÏ§C·ÆÇn¼3û–}zB]s#l„DA  ğZAQbÒfSò×GĞY”†    ½øªı„¢@ Ã°‰­  \’ãÚôİ¿h2á¹l<·&Ğãë˜—Ç#M/Y³!d5b§’ëFF	Vëo(¿÷ÃkÏO	yÈ…½•GÖ9ı@&À`Aä$¨%lË%|lq¸†   ƒB`çn`m?T¯ƒ —y¥¼¹ ¬# ƒÃ¥É¹­W§··ÜûQ6¬;W·ÆâÇß‡x5on©¿6×!Ñ¾ôğâl¿>õ·š¬3É›UCH¢-©™by A¬$¨%­g!|¬ghET©	 <É^=÷Jı(:ƒ×}Z  
¸)rìéŒ×{h6äõîî·»jß¾æ½Ÿ5ë/¾x`¾ûïê5*åˆş#õuçòw]»!CWu°YWvdXA ±ln ‰ş×e) CA6óU·Ò¶\¡uŞ:èGA(€3Ø½¾çßz]ˆbÇì{ªÇäó¢®]œùáî£‡Ä®Wcí¼5ví‰åë{Ã ò   ‚ ‘¾á24  €Af›É_Cãİ}€Õ~ £äip  
Å—ô·T)··'ì¶¯®LŞ¨G}â±>ªø×]ËÛS“¼7=w_ï×Ş:vzÑë)ÑEZu¥ AüN¢K@‘üox,y A‚˜ånN :¸!À´(‚àºòì®ugÃ=çïÂM/‘¯Î.QyéÉ$É—äGH>9ÿÃYB–{?ˆ¢\¯¾õçÏSD&¯ÉéfSUwjôYğA  œIVJKÍï)oÉÜø#\ ‚  "à¹úé;*˜,9e1îET‚  8híI=õçg+UdæŞV]s#n:ºS­Û¯±+µöã^›nfLM¾ğÒb}ÇĞÌ'ÌÎ”İxpñß+Éî|4Œ›O&‰±›X ‚  
-!Q'+±+ã),»·äoâù@ 	h)@Ğ àXüuOFÄ¤:‚o‹„@"–“Â<³ç}l”¾æBß¸¹Ï«[¶ìé·ñéç›ç½~õÉ§jš?réñÇèŸ~í«şç<ÊE0uä†  	ø,À|	Ô)#+±+ã),»‘¶tS º¢Å£N'ò×„X ‚`‘À•Ø•ó””_Ë[vVJÿ¹é¨èhBi¸q”b9()³våÙ:šÓ¦§ˆl¼;+¯ëUñÔÜåÑûö­¾øĞàÍvªùîí—wÙ¶ØŸvİíÊ  ‚ P#|£°É­ ˆ²ƒ£K%}ßÈâØFn¤A äÜû`üPò¿“Ë*—¥]ıË·íıûçw]¿³ıÁ{¾ñÛï~ûÓkÏ^½zxÅå{O(×eì{²{_ ” ‚  #»Ôÿ%}úœ†   ‚Áñw FôÜq¿=dÄ" …ƒ4{´ubfµg;ÑSÇòf¥‘×‡³RÓµÜ÷>6ÙñWÛùì3Êœw9Ô/í_Z  ‚ˆÉŞÄ#¼E  CÁzó×yc¤eğâYëôR   A<`<ÿfİùÎnìÖ³vaïÃÆùâsMİtd4A €‘½ ÚI” ¥D ‚Tå¬”NØ:‚Ã.°DPTÀ3xêÛ·¨ÓpàºYÛ³ºó¾…y:WuÈ© \™ ìòÔˆ¸ ‚  x"Büzƒ¨ÄAë°MU¨©d àRAOywZI4ã±¿h·NIã“¦•ÊYµê]A  A`‘ø¸„´ ‚Œó¥bñÕ0Vz8qœ½d$! ¶ÂĞÿÏ±_ï]µ°Ï«ıY¡å“všÚåiÿÿÈZ´D xA ˜©ñø§ånœctE  A¡zñ·yB¼DâY®ş X³CJJãŞ†zûs¿ğqf:xY’ù+şô?Ù‘jkèª]”d8A  4!}4Ú(ÈE  •ú í¬¾£iÑ  ğS£¥,ÿë3H¿ÿ‹Ê´ìèêéIYMİÚ–ß{d‡tyåé%İ¿j¨o´ ‚   ƒñÖ‰~Ô 8CA>óU¿<jª`¢aà CÁb‚´öçÏººçk^úÕ
:c½î¡Ÿ\õwÊH-çîÕ¾·óK_éß»§*Ô”ôº„Exè’¿m¤ ‚  h*BÿiºwOæØ©ÿt ^@!‘hH®É¬ŞÙ·gx„¾æBŞd[û¤vKõ”d ‚  	¨)“!|ÔŞ¨A  Ìiú˜¬\¶1‚ñ A  A àA  A ¨:‚­5¡ ĞZèA  A  A  @"ş ˜¯jN6‰0A  A  A  Ô (A  °âÚÛ„8 ‚  # •Ô ‚   ‚   ‚  
(%À·bŒqZ  ‚   ‚   ‚  „]‚ ‚´:¬oDA  A  Ô 8A  A  âYÑŒ ,ĞR¨A  A  A  @"ü ­Ğ» ÑÌ­èŠ   ‚   ‚  " • Ô ‚   ‚‚à B)¼C”†   ‚‚TŠ   ‚   ‚   @· ÒÖ'xµR<  ‚   ‚   ‚  „]‚ ‚ ˜q®ÉFR$  ‚   ‚‚˜T†   ‚   ‚Ô CXÛq ô XA  A  A  ¿ (ÔO€jÌ6pA  A  A 4©  A  ¨-Àwn x ‚  " µÔ ‚   ‚   ‚    « Ò,o@ ‚   ‚   ‚   €AøZ   ƒr £[Ñ A  AA.¨A  A  AÄ:€W|ƒ) <© A  A  A À.Á¨_€éøÎy  A  A  UØA  A L:€×d£) AAN¨A  A  A  Ah€°CX¯8 ‚   ‚   ‚  "Ô‚  ! › Ñ˜mä ‚   ‚ h	R  ‚   ‚  #P[€êØDôAAn¨A  A  A  A ƒğ
°@4âYÓŒ lA  A  EXA  A  œq îŞˆœ ‚h	R  ‚   ‚   ‚  
(.áÀ·à(¤<A  (jb,  @%PA  A  pA€ A  ¨_€éøÎy  A  UØA  A  A L:€×d£)QN¨A  A  A  A ƒğ
°@h_€éÄîy A  A  ü`4A  A Ì:€×lÃ) PB€(A  A  A  @"ıÌ¯éå  A  A  Al AL:€×tã) A €`TA  A  Aä C:·¢¦XT‚   ‚   ‚   ‚à`„! » Ó˜m#ä ‚   ‚  #à ° ‚   ‚  #P¿ Óõ˜ò  ¯° ‚   ‚   ‚   €AúB²@¢A°“-  A  A  CÁDE  AÄ:€nß$A  CÁ^dA  A  A  ĞO€jÌ5Nr©  A  A  A À.ÁAä:‚lİA  A  ğUĞA  A  ĞW€kN6°@!dE  A  A  A ƒğ
³@ô:ƒvÍA  A  A  Ü`4A  Ğ_€kÌ6‘ğA  ğE€XA  A  A  ¨_€éúÍ‚}ØA  A  A  @"ü ­ ‹ Ñ ÚI”‚   ‚  !à  ‚   ‚   ƒBà B7oÄ#à¯° ‚   ‚   ‚   €AøX`È:Ú„°A  A  AÁDA  A ˜â»z@DA  CÁZDE  A  A  CAR  èÚ:¸ ‚   ‚   ‚   €AøZ   ƒ‚x C¹dÈH ‚   ‚ì
2  ‚   ‚  
h-À·äHøø À, ‚   ‚   ‚  "~ T‹‚ø CºlÉˆP«K‡ª–eM8rtåÌ‰ÿû3³”.¯G…*Ä`Z   ‚üWË]ıÑ˜12$E  T!}UÚèCAZ ¡¶Ş;
J¡Q™8tmç…ï¾ôåÕÃÿS‡õLú{ó“ö$?xyÿïVÇ^xûücç'ß}é—ËäÌ/W*ğ# ¬Àéuó‡C ~ùÕuyÈ…¾l,Ì h’¼kí W„ZCWbWÂV]s#mÂ¾_T†´ÊŞØDôA¡Y 	]‰_	]yÈ…¾luF÷ÔæY>:*ˆ¥B¥1óó{SöWednË1S‡×òeNLøi÷çŒÿû{¿“>t©=?dó´B`NBã÷8»/*ó‘y+qvøŠ P#|£»ëÿ?yô÷%ÄwØz~zÁåœDY,±ËqtD2X"&‰ã&êC5m*X²kRÔ’mêë–íŸp«m<8<9V*S)ÉvYDY6FQ"X¦H‰ˆF' bp›ä¸ 2›Û1Ó?Ó§úªj/»Lø;…€ç.il¶‚¡W€©ØVúéÒVÙèz2 DDşÌ_0’ø
)h¹‰_†­,İéQ‡1[0Ó0ÚS–®ÁÃ›“KÏÖ9Ezq~éá‡Ûwşhãó?N¿õóÇe*…A¼ŸQ4	´cÚ´ÌÎ.+×éQ…Ô'Ü ‚@ ÈİGo5‹l–‚¡WZ>¹UZ]Â< 
$HüN×t²Ùt
)h»×¡éQ…Õ'/»n £Á³¤å¸
U‰§û6¶©H§ràûï9lLşïô÷Go^oª7#SƒJı‡`aLZ Ü&BÿİÇÂ 
9G­`chS£â8ü€@ÈÜ*ï rHƒ€bÖ:­À·ÓØÇæX(S½éÿÊÿeQ+–,^™{ïçS¬¼^¹×~Bh ‘‚¥ã~Üü¼¿fÅÃäU|D!&¸Œ‰ùa°rZÄÃØP°@‘ø*.X áµ„,˜Ox@q/?!_K1Ó‚L¦9~oû”­Nüáráè§Ã;¤@A `"BüÇaZ   ‚qïË\à˜š0 øâÛ´P£zèç÷™¯N¾ırjd)Ìsé A ì“¼ö.hìxE  @!6ğ66Z8F"¸ CGtm˜XÖ1}ş¡Lª1~oë?Ì:›*•@‰ÍŒ`  ‚ ©ûÊì A X.Bş´İŸ/óÔqòez gÕY wjîªR+Ï=2ûòÏ‹7ím(A  A"€æo5Ÿ$"Ñ>DE‚8åì	|A € :‚B’=!ce3ß#xZ²ÔĞÌ÷×«<_:q³`2 !J$…Á>òõŸt ‚  
´Hıl—4à ‘
 ¡±Î.‘vµ^:F95m­/àº_›yıŸš·\®cwLœ ‚  &Bü´YM @ÁS ù·Ë]¹$ Ğ› Ñ»Ğ©2v~÷âÈ»tOöö¡mÖ¹,ßŞÿ†¥D/©ï’Æ{ô>õds/ÍnéÉÇÈııZjeyû¬ ‚ €
)Œ»tI…4Ÿ©Zw¯I74¬xlQ!KøÙ!ÌA ƒÈ
)Œ»vÅeÖ¯9×¤š3úO`ŸæouŸ4"‹ Ğ¢°­Ùh¤»só5~2ÿ÷ş;öô»w¡F¬ÛÑev¥Ö¯9×¥<«Ófq©x
[VÕÍÓV‡Ÿèí‹?øvïêÛ¿«rÊõ›³ªÖ}2_š{î?ˆ´øKi­?	á| €A,„	FÆ¡ÃR”lö¨Â£¨­Ö¡»Vä»w¡FÖ¡û#}¼ş- ÌR)‹	F]»Ò£
Z–»R†éWéÒTUş‹ì…üN÷ö%dğ,5~ £Â6uã×|·xákõ>Ş;ùÔ©V¤¹³ÒúŠ»Q…ÕÌõ«C¨KºlFÂÊgsê5tïëØ{¡çÃGzÿ_ßgÍê~®çuW=ğ—ÿáLõì2µm½”Ë62ËrÚÊàã÷.\/\ıyû¬ ‚
)‰ÕÌô¨Ó'}ªL£~NıGxwšÌ
Ò>¼å¯ëzJş›¼ƒÍƒ´qİ„,)OœY¼rÄ>ñãÏcrTß·—ÖZ MÕ•¾•ÖÒörI€Huwg†»uïêÿÃ“«ÿÖ×û«rë+–hf•H±:ÿÆ.—,^o¦Ø ‚ ¾áYH ¨+·­M ¨ë·—ÖZ MÕ•¾•ÖÒörI€#}€÷¤4@!) † ¢ÓŞ›AQÓk/¬µDŸ«+y*©¡ìä—*BÿëHl	ÄW€è4îìÑç·S¤?ş…rbëöÛEÿQrvâ×Øcj´'•4&“Nç‡zúïªŞ¯î´½“^¹®òİÉç›µÅ÷B4JËt
OÏŸû›Õ­ÿ×+z_m2õn¥ŸÖ½GriN: ¨èVƒ4B¦äéÇ¯¢ÜšPÜ•øÛ`$ fV=)'¼cUnİ—®W–{VıÅ­8äx†£¡R Ù“›«´>‡vjÒ¤ğ»JıÇe'[FòIGæ¢SÓ#C•]¹Œ¶ı×îª{VıÅ¬zÕÈ:‚Ô—s“$|ÜÌœÕ\Ÿ7ÑlÀ±2Ù›ğ^ZUí 3ë5^,ßm±8Ìhsóİºxu|°Pæ€†V¡ŸÖ½DÒ[®(CÀQAĞ© ö®³ÁK7W$*UãuÊëÏ]•û’¼,3D]@˜¨fV=+&Aš®{VıE`„5ÜÄYAĞ©mf‚j®M™ê´`‘¼b«Ñ¦B ÉG&¡ñQ*Ñ·Ö³øÖ+)¦!‚ï” éa=~õÔ3³Â¢İÃ¶vo½íSÁâ–«¹Gí¢>ğ)(‚íÙwÿŸÊ<şW&½ªƒ=*¤Ó÷Y®–g¤jkNgC‚´ÌÎ.Â:z®ôÒ+¨»„zìx† V3zµs^4jªåO¾„ôkÈ¨ ÈÜ¡'èÅ-f¡‘³pÖ+« 1†ŠÜ © V6µ,7Wr·ß@x5äVPänQ’3î'—JR%+X±6¢°X3Sğ@q İ½aÜ>çòÛ8Õìòi6uâ¥IsÂ£ƒá)7SCÇUÉ‡Ÿ¨Ä6õó?_Ø)û†{ô=ge²ôÎçôÌ'á•B¢Ü‡ÔE¢–&–Z7{*ÅjØ ) …#ø‰¥¸Ÿ’¾åï0lOÂ~&7ÕvªUV?-÷Ğ#£½G`Ì‘ÿZ›ş &ĞÈMlåXÏ8q Ş]ãnD^±2oïK‹Òf~êõÔ®|ëÍLÕÑî¯‡Ê>îö–ğ4	Zé¯Ÿ£O=“^²µßÓË³3²í¿Wn+è €Aô˜bØänÚÀöNü°IMà&BıÇoDYøÚLˆ“ ÓšÚ€£NÖ™¿lÌx5yùÕ§‰<(Ö¼)OŸ˜ºıiMc÷bßµŞËu7ğóªúà=8ƒwvOÿ‹OvíJYU^½.\¼ºpõU\L¨A6­sÿ(·ÁfÕÊ³ >„.Bı„.oHÿå¯)8Ç<˜jf&´r­$ZjİxƒKçmê8=#ø™ãÎN×ÑY™ˆ¯©˜\æ¹¾¦Ùön+Õ½Û¶‰JdóÇõ+g_±S+'}-Upı|×^ŞÅ¿ÏN¹ÆŠô	Zéí±ÿ}½÷)“ªk#rGŞ(Nß©©	”$S/–?Ÿš;vóç¯¬~ıÇÖ(»w¡FÉdVãCãr:û9qõÿ/K`ĞÒ+ª°¶´H‰ùÒlü·ÊŞ×›‘½®÷¾2™1PËyä#Ì^6ŠÇrú4\ş7
€Yø—¦¼Ë^}OÖR%+ í×©: ²œŞD¯Œéõm‰”ùß)ÈõÌ³9ôñÏúÂç6sÿß‹°W^h¬7“j@\´S£bÂ§ÿ‚^±rº8Ç.—fİşTª_©¢É‹WáZaaqó÷*—¾xãØŸ¾ûöß;ó“³§_:ıË¤vëFŒ+ÿÓvİW†]\º­Éğ—jÎÊ»±\}zÍöÀÎ\7¬ahö­ş6ŠÇjÍ!Õ‚•`‘ı7g%™'ø£F$ŠWó×À'îTÉG&¡ñQ*ÒYé[üiĞwò7%Ì3ÈÜc^ê%Ü  @%Qİ{ó”½ÿùÔ]³º4ÉG&¡ñQ(Û^M­¯Ö³øÖ+Ê´R”\qİÌİÉômìÜÿ”Æd.õ:Xı¦¤ü¯hß9}[â­›RÙ€ìâQÿó¥ÑßşÅ,ÏOÎ?â¾2iœšıÿËa|yç¾×.\»92_wılõJ\½}S”~pñù¹èªeˆ†µjåá£~©¼ôûÑşyóíÊnÜ¯Ö³øÖ)mÏ(Fà­ûz—’¼C
ã!~«…YPÈ¨~VKxÆªİ»Ï@®=,ö­ş7‹ZqÈ¸*BıÜ¦âDä®À»ÈÜ3TéPÈ¨~VHxfëó*·Ï–İ¹VÏë\¡»6[8ÒmŞ‘ÿlÌx7ó¥®áü±”Éçñî«šÚ0Tı³.´‡•´G 2³«ÿ
MYv~ZíÃÉaåºØ¶Î7úƒ_ŸùïËa.9rbz¹ŞÛùãËãİ8x~~~¾Ü·×4Qƒ[$HşN×|®¶[ñu&¢ûß‘½õ{Q$‘¾IÙï–ÖJü¬oUNòµ.ê´Z#hÒ¯_ÛÆ±3`İL§_ü›öN|»ák+•şİı[‡f^^Ş,{PBß¿ãB1úƒşÎ?ïüó¡*¤ãï{n²¹×N²ªşéëå¾<võcÿEÏÔ°şj{êmzã«øDßVÖå ÌR;’¼çoV*fJş¢NşÃH$ÄZ£%í+çÎ¿t“x—‘¼ƒí/ø	 „)À tª¾¿8í[·¨yû2«Rf~PXŸ°U).OMù¨¾ıoHÍòÁÏ×cu¹0G 8;ÔùËCı°/^¸PûšĞ{aJ§óLıÇ¥‹g÷LÛ»U{¥:vñË¦Œ~|ú¥¹^«-ì@Á&òöíop°.Bÿ,85ıUBJü7¯DB"Bÿ'e®|¬•ıõ
åTÿu¢>P BGb;ó;}7ŸÉ¹N¤P\?óùÛ«.WŠ
õòä“wG^ÿŒ¯/İğÕ
êHtlÙ×´r´»Æú|ıÇRí	Ë{8T+|ıç³3Q’Á/ùÁË‹î;4^/Ù-¼ ƒAxÊŞ÷øDrwñµáO#~¥¢! #|ºëŞJNbÿxŠû~Jşú¦£a˜:ƒnğ/Ì÷çu}nùßòéã£òÕ}^şkÿã¶Ç}R_SsİıŸ@Öğh“BÏß²i|L»zéDcÿaŸ”a]l²UùÓë“VTøRì®ovx}áá££ƒé…v>±ímızxÉ]|éõ	ş÷±v6Ü ‚@å¯AšÕ²«‘¼P¼®”$ ĞµøÙ4c;#|ÚWñ´4›´K€éwÊ×ØÿÁ£_‚Ö•W=NùQzid¸ _š™;÷÷Ê÷_:×îêyÅñ„Ä¥Ó~Œµ³[^8Ÿön€®§(ştçµÇêq.×£òïÿ¾|÷ë—7n{rág^„µmıı‘2üâëß…Õ«™š¸Ï¢~pö¶p©Cz€4A¢|çlûî¢:p™ÿ¯lk‹ål|fÔE ‚T‰ÿåu@­ûZ*³Á3ú¸® &“¿6íØ/‘~ŞÉuºÏC§ÏÒeıiøï×„şP-O/ßÚ½ZÙÍƒĞìä—&‘íêíßæqÛ‡×‹5Æ~Ug¶6­_:éóÊVÈyjß»oì?£Aå¾|{´«sC_ß”·nûödZ·Nö9(úrqãÏ©WuÀ†°#a±•@,…ÿ®H‘ÿ¯ŠˆÈ
DE£ı#Û½™ûZÔ‡‘½uqQºì A·~	ìO!Ğ3Ó½ãÛzÏµ»»(n.Ş8½6rzÿÊ›·–öò;œÊv¯¸õÍÉ_:E1ûœ([:{ÙdÍûV»?>õÛæKéêÊçıï/Úys:Å	6‡«ÿ:[·`÷‰Y|4¿3^ÓˆD0U¡¯úk,[ÎfNüøŞcóÔ%ÔBÀ.BıØM+!~~ü!~}AR.8 CGf/lÏ§wÁ;mÜ»ı2{ã‡Ç¾™HV_Ü¤×¿gÂmo)t‰q²•ìyóSŸğ)\¹ZKéOÈ9ıÒ…qÇãıúŒ?Ù³¯?ìÒñmµíû€=Ş£çvJìŞ•+çÂÍÜ~å`#ÒJüÇc‚]ûëÌ‘ÿôåD,p!}\’^Ø‘ıŒ3û€NNØ:€ÛXÔÃÙ4®uÖmY¥ùr_mlÖó÷„n[•ZÈLÉ¯_”ó2ñH¨µwû!?6cTäì×çFÓKÑ‘Ì¾22·¹Óõm¼ÕSÍº?†øÀõ÷y¥¼9ç­N€¯À¼Ç
|uH6T#~V4I^ñuÇ.o1~ßû%|ŞfÃ,vZÄÃ²gAş#|¶Û~–Jü­*Fü¬JeWÅ¨t/5i_5°æ¸§ıÛx¶jni™îm­.¬ -Óçø“¢–>Kâvå½rõ³|ø­”öíŸøA­ÿ–ı6vùMwfoóª+ƒÙ«D¾'€0Ş»ªÃ?*ÇAz4HhXünš-ÅË]íÏ%}¼xéµ…Å-	DXşğï¶hoç¬µ?ùëìcßXÅ¨t,akîë€é÷Û¸İ·õÈŸ!+ºú´6yrï>ŞDC 49—\3êe+‡×ÉòÈúyá‰ÇÇÒĞw…×¬kã5ìÿoÌ|eÓ üüö–‡·Ô¥¥{ÌïèéÍYÔıéQ…Ô'Ü"…ú…©Ò’¿Ø¤%|<|M|¥¨VãTÏ^Œ*­.à={¸\ÿ¿ß€¥ùëğ˜üõÀ1ö–¡WY=z<ª°º'ôAGq®ut×Û5Qv~‘…dŒ½i¥|ıŒ¶)­™8¬%Ñ·~õJU?y\ª­\úå/*^Œßµ/6—M=³a½¾³‘,lİ—L;şØñÛ­ŒwK)m‚€ïïV]°³1”µvëFŒ*õoÄZè°4³Ë]™ç¯ÙîñÖLÆİqF¯W°©ñ×¥<¨Ñİ3pPË^Ru«”ó%|İ·Ë]7qÉ´	^Æ¯ÃV”lö«CpTç;s…#Äz´[#–ßWÖÌ¿ÿÒTíló%‚Œ]ü
ç„5[;]|ÀS¿ç¬Èš×94åóëÏû=¹¹³6÷gsúÕ¯µ·<è5¶½$
+míY÷¯Ä…vëEŒw@#|C‹vñ×mË]7¡È¹‰_†­,İèÑèå3x€Ë^ƒ5©º©ùnNı¹K’¾n3G”)s»	^]»Ñ£ÑÈpŸ<Ğ,+Ìî{5Ò»ÈÌUW¯Æ²~kPÅ_)îßæeÿÅê:€/—Ë—ddï-ùş}a‰¿¡ZÉÿ4ëì¬5t²_·–P‚D’¿Gl_ã‘jÿ4êFÿ4+Hx°’¾4“D’¿ÚNş8°Ph‡ ÑÒß')Ø62ûûæE¾¢Ê~kPÅjÍXÿÌ¼¿:^˜vø§a=o«qq`¡\¨×O»)šíí¬*mósCn­¹¬è¦W.ÜX]¬+­æ¸!EE+ùÅhÜŸË]¹?ûi4¡˜#|˜^sò×¼§å¬ÜÆ “…O” ëJüë_»¬iëaî*«@×âÜw{‚İ›C)“ò²–ba?…@mYßİ`§-{y2%•g«[{6“÷!ì ”#Jò7–ØÚğ£Ë]9ûi4 Ååfò7ËºÑù»’¿vsòÖmAŠ( AG~¦G}/ëqš¦ü—;¿úëmo+ŒšC9“\3éeQ¥ëI>ÔcRd¬W²­cwu”½²ù‘Ö]İÍ$ĞüXô€Aî ¾Cò7øzÕº’¿6kòÖEB  "BÿãŒ_Ë^Ú?’¾6	Œâ;éZ•Ïçúu}Öm•û_\Ìt¹½\²	Ägó2äĞÏ¶h3¨²U+ÙUÒ–ÏÛ™,êvûõò§ İ=,<!Fò7ŠºÑ½;‘¾4÷ålŒ •ø—§B>‘¿6šFüÔ€ğh“ ĞoTÍòÁÏ4{íW`ÏòbörH`/“Z³ÖÎë‘ğĞ|7¨‚  
4&Bş6çÉVCäm,€Z  ø¥ñ?’¿Åo CáR ¡<”‹ö®Õë|}Ö»u\õö¨ÀWĞv›á~ĞK÷õø™azb¼R-ùªizŸ¦îH](ûY{ÿ(^vûnèı®"Bÿ±W`L•ı®ï#|hDxE  Èİ!6ì‰ı®Ú?ò´Çõ#Ø-ÁÓKø÷ÀÌ¯n×›¼<ûëÿÊîş™,İéR†~ÛR&MêÏo+—ò² ğïk¥ÕêÈ8hN.-†³¯[

õo'b­F 
(¡¨Vâ)v¼»w¡Fº¤Ü±û[@çån6 ğ(¡¨Vâ)v¼»w¡FûmL¼¸‘¿5:JüÔ€ğh“ ÑnW+–ßÙ¹é*]¹2hİÌ5PƒOŸ¾n€.„sêP éoO§Â¿35YJTê¿ª‰J¥rv~¬ªáÎîÚ¯ï8vü‚0 NµmÆ¯ÃV–nèoL€¸‘¿Õ:JÿTkp 
)v¼»vĞu~ò·xÊİjîÌâ»]øÄ¸4*’íëòÒ°P)úªeyµ]_«÷ßa
Åá•˜Ûb•vjuFÜÕõ›K§VvtÖğŠ  #Jò·y[ÊİjìA¨Ğ±ù[NFÿTkrl•AíÁ[²d´$RÂÉdş­;!ŸO§‡yxï"FoÛ	™*8éÖâ†İ<M¢™ohŠ  "ÑJ‚fÇ#}¨÷|Ãål·ô ‚ à‘¾Ô¯ån·õdqnÕ0ZP0ãawrx~Áİã“ápÆÃ¼|´Z;rá„}•ìù¼¾A ‚X‘¿6Ù¸ı­á @!òµÔ½ı¬[Hâ;«:Í¹Œ²œ~í}4–ã]ïD«fİÚµôúËçW,_·–6VñËÅŠÅrÚßvï…¡ìÕ(A  ˆûY°‹ålKÕš "`¥û[°oål
Œ¤qnÉO0Nì	Ytï=|³/Éğ~~\vuoìvøOæ÷¯œšmLO¿~á»½mıyo,¥.Ü ‚°ånÍÔ)ÊßA  #|iKÊÜLIä·+˜Á<pÉ÷õ;Õ”ú¯TØÏÏçƒÀï®§(ş|íÍ­Çû)ÿ'6üåßÇûÜêYN   €A,ªÍhò##}ã°­ ƒ¸
³=°ªÎkdZ:{óõR	}4K€j“uŠ¸! €îáûüXUO–soëÍns;—œ*)»ø  05%P~pñúÏDÍ¢tûÿÃSÇå‹G:áTÛïêlím(A (bı ¯‹Uìfª«y×‹Ò[ò7MºÈXA ‚h)[¯ßqQVó¯¤·änŸu39hâ;9zÏJ`!ce3ß!{¿¢
¨çV%·f„·oI:|èÊÖÓÒwŒ|ÓÁdq˜šıÏˆÖŞM–³Ò„µo·–P‚  #a©ãÕz€ª¢iŞvbô•ıÚ„°B"j	WÇ¨ô­U@×¼èÅï¬Íÿö¾hÿÿêŞ‰™Œq ß™¬h§BÕ‘O¬¡z¥ïŸ^:ÄîîbÃ%Ç“å‹Æ•LŸû·òäåüşaÆÙcã_ÍıÓªhéÛã5®îèu}F   €AŒ­Y¶ê”)¹¿i;ûëeg¨‚   ĞáW"ëÖ^«ƒØÚ»—‘½qÜÛ¯ˆ ëo/Kˆ­eö<óZÏü‡¯ø}"¡W©W+¥î-Å–>µ~ıÍƒVtl¿¾5ïÏßïÜ/œ»71P¨WoîP(¿93ÿ³fıãş÷ßuû«ÊMt¬}íãæz½˜$ÁlAdË]&CñÕJ„0A €àË_&KñÕJ„²è
´ú:¸Í °/«hæë«AÏö=öÅŸüvëFŒ*Mçê³vÍKYÏmŞ·¿·V÷T²_~åû´ìœûâÏóê?¬ÃêU,§J4yWãtOzõùwTrn­ÂâßŞätí×  ‚A@Ë^ÛÇ’¾6CáR|D!*òÕ&JüØH(ˆ· Ò’Ş$‡€µ”ÎçÔníÚ;§J4z÷¯ùµ›÷ò¹F<Ï¡–‹§sÒP:~áé]»Ò£–İ¹~íîşÅ¬Ò_™~m¹
PPa_@)s»	^]»ĞcĞ"ÕøjÙ…0\@ÁM¯aWã«J4{5q‚Ì™ü’Àá$'~`DA`[­,êÏd]ß¿Çà²;šÅ­ƒÖ,ïQå5¦  ‚ğRG‘¾òŞcT†  #PBŠë‘¾.€f™¤:‚lšB"bø{ãİÚ4òåÅÌê#?9c¦œÙ·ûê»uó½ÏÚg¤‚  !,‚Käl´‰š  ‚€‘¿‚‘Ğb A†£Hœ"Ñƒƒë„ÿjíı-ıüÍOgZÿ[yöœ8Úâì·ü‚   ‘ñ7):Í8A  &BıGj6“?Çôq îÉB  	ÄAcoW÷‹"x]ÛÛŸ­v>:{WÛİQ&õ¶¦<  ‚HRw)CÈß&üaìP` ‘6ñ7j:nÕx:ƒ7h½š, 	Ô/£ÑeüûÙœ9ñ§›7÷æ3—ë¾õ0ê´)=»r³(éë{Kqİ?\õDh‚ p`L
$Wcj|üNïì°pAt‘¾ïg]oÔƒìe¼DÁ.dˆÃCGççÔnøäËÛ<÷Ê´÷îşÉ^\İ¿MfÌ»w¡Fıó€ETâáùbTE A ˜R¦|şmŞA  üQ2—!}ø]4€vÔ$Ä|A R°è÷SLÎÙë7\?¯J4yV¡^„97œ ‚   ‘#ƒú”©VÔ)s»	^]»Ò¡
öêü¹< ‚   €B2	YF¯W°©ñ×¥<«R­ƒ€\ğ!À´$¨ ‚ä0pA  A  A  ˆ¼CtUÈ wvõ…˜ ‚   ‚   ‚  
˜$Á|A  Bá> £ìáá  A à"À8A  A  A Ø-Àwøö#ì1`| ‚   ‚   ‚  #~ TŠ  
8q îÉB   ‚   ‚¤0lA  A  !À vvõ€˜ €@ÜZ  ‚   ‚   ‚  Ä]‚xqïËÀHA  A  A Pš$  ‚  DO€ ééï
0A  @Ávä   ‚   ‚   ƒÂ$ B|ÃÔ/­ A  A  A à.ÁA ‚èqİ¾`d ‚   ‚¤0\A  A  ¸O€èø8xA €¸
°A  A  A  ˆ¿ *Œ¿ ÓÓŞ dŠ   ‚   ‚  	D]ø ‚   ‚Œ B8°PŠ   ‚¨Í A  A  A €èqÔ_Ò,  ‚   ‚   ‚  Ä]‚ ‚  
xqïËÀHA  A Pš$  ‚   ‚  DO€ ééï
0@Ávä   ‚   ‚   ‚ğ`„
øâÛ”A  A  A ‚¨0,A  B"¸ CGtmš  ‚hÍ A  A  A ì‰ä÷|)å  A  A  A `*À A  -À wôõŠ ‚   ‚P`| ‚   ‚   ƒ€£ ĞŒ."`«ğE  A  A  A ƒø
°@Ìâ Ù¾`¤ ‚   ‚  !6ä‚   ‚  !à)À·',A  L`œ ‚   ‚   ‚  !<ƒ £¢¶@d†   ‚   ‚   ‚@Ò  ‚ ¼:ôÅD$A  B"¨Í A  A  ˆ¯ ÑÓŞfd›ğE  A  A  A ƒø
°@¨K€è¸¸¨   ‚   ‚P` ‚   ‚Ğâ;øxÅA ƒ¨0<A  A  A  ˆ¿C@(æº"5 ‚   ‚   ‚  "Ñ.ÄE  @Á ¡ÏÚ*dŠ   ‚P`< ‚   ‚   ‚œ BxòğÑäŠ   ‚   ‚   ‚ğ`„"`Ÿ Ñåï0E  A  A¢ÜŒ   ‚   ƒ. ¡}1Q ˆ«ğA  A  A  A ƒøšº@¡ÏŞ:d   ‚   ‚  "ÑjÄA  A€¸:ƒ¯ŠˆÈ ‚  !ä‚   ‚   ‚  !~ ££½GQŸ#ğA  A  A  A ƒø
°@A¡" ¢a¢  ‚   ‚ì`\A  A  Ìâ Ù¾`¤!6ä‚   ‚   ‚   ‚ğa…Lq ßŒA  A  A X$À8 ‚  "`Ÿ Ñåï0E  A¢ÜŒ   ‚   ‚   ƒ. ¡}1F·ğA  A  A  A ƒø
°@@Á^ ¡ÏŞ:d   ‚  "ÑjÄA  A  A€¸:ƒ¯ŠˆÈ!ä‚   ‚   ‚   ‚ğb‡äqnş° A  A  @!nøE  A âº"5 ‚  "Ñ.ÄE  A  A  @Á ¡Ş)Ø ‚   ‚   ‚   €AüZ   ƒBP A7ÇD`A  AT
2  ‚   ‚  ˜%À·zxÅŒh·à ‚   ‚   ‚   €AüZ! €q 	 œ ‚   ‚   ‚`Ò,  ‚  "`¯ Òåï0E  h·à ‚   ‚   ‚   B_ü ÿşò”Qà   %P¬F;ÏW    %9¹	‚