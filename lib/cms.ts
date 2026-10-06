import { hashPassword, verifyPassword, randomToken, sha256 } from './password.mjs';
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
async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('Нужен формат JSON.', 415);
  const text = await request.text(); if (text.length > 50000) fail('Слишком большой материал.', 413);
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') fail('Неверные данные.'); return value; } catch { fail('Неверный формат данных.'); }
}
const validUsername = (s: unknown) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{2,39}$/.test(s);
const validPassword = (s: unknown) => typeof s === 'string' && s.length >= 10 && s.length <= 128;
export function validateRecord(kind: string, source: any) {
  if (!kinds.includes(kind) || !source || typeof source !== 'object') fail('Неверный раздел.');
  const fields: Record<string, string[]> = {
    news: ['title','slug','date','category','description','body','source','image','imageAlt'],
    events: ['title','date','time','place','description','participation','source'],
    projects: ['title','status','description','results','participation','image','imageAlt','source'],
    documents: ['title','date','format','size','url'],
    contacts: ['phone','email','hours','source'],
  };
  const data: Record<string, any> = {};
  for (const field of fields[kind]) { const v = source[field] ?? ''; if (typeof v !== 'string' || v.length > (['body','description'].includes(field) ? 20000 : 1000)) fail('Проверьте текстовые поля.'); data[field] = v.trim(); }
  const required: Record<string, string[]> = { news:['title','slug','date','category','description'], events:['title','date','time','place','description','participation'], projects:['title','status','description','participation'], documents:['title','date','format','size','url'], contacts:[] };
  if (required[kind].some(k => !data[k])) fail('Заполните обязательные поля.');
  if (data.date && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date)) fail('Укажите существующую дату.');
  if (kind === 'news' && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug) || !['Жизнь микрорайона','Мероприятия','Инициативы','Объявления'].includes(data.category))) fail('Проверьте адрес и категорию новости.');
  if (data.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) fail('Проверьте время.');
  for (const key of ['source','image','url']) if (data[key]) { try { const u = new URL(data[key]); if (!['http:','https:'].includes(u.protocol)) fail('Используйте HTTP или HTTPS ссылки.'); } catch { fail('Некорректная ссылка.'); } }
  if (data.image && (!data.imageAlt || source.imagePermission !== true)) fail('Добавьте описание фотографии и подтвердите право на её размещение.');
  if (data.image) data.imagePermission = true;
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail('Проверьте электронную почту.');
  return data;
}
export async function readPublic(db: DB) {
  const result = await db.prepare('SELECT kind, data FROM cms_records WHERE published = 1 ORDER BY updated_at DESC').all<any>();
  const content: any = { news: [], events: [], projects: [], documents: [], contacts: {}, layout: {} };
  for (const row of result.results) { if (row.kind === 'contacts') content.contacts = JSON.parse(row.data); else if (row.kind === 'layout') content.layout = JSON.parse(row.data).settings || {}; else if (Array.isArray(content[row.kind])) content[row.kind].push(JSON.parse(row.data)); }
  return content;
}
export async function ensureAnalyticsTable(db: DB) {
  await db.exec('CREATE TABLE IF NOT EXISTS cms_page_views (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))');
}
export function validateLayout(input: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Проверьте настройки страниц.');
  const customSource = input.homeCustom ?? [];
  if (!Array.isArray(customSource) || customSource.length > 20) fail('Слишком много пользовательских блоков.');
  const custom: { id: string; title: string; body: string }[] = [];
  const customIds = new Set<string>();
  for (const item of customSource) {
    if (!item || typeof item !== 'object' || !/^custom-[a-z0-9-]{6,40}$/.test(item.id) || customIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.body !== 'string' || item.body.length > 2000) fail('Проверьте пользовательские блоки.');
    customIds.add(item.id); custom.push({ id: item.id, title: item.title.trim(), body: item.body.trim() });
  }
  const order = input.homeOrder;
  const allowedModules = new Set([...homeModules, ...custom.map(item => item.id)]);
  if (!Array.isArray(order) || order.length > homeModules.length + 20 || new Set(order).size !== order.length || order.some((id: unknown) => !allowedModules.has(String(id)))) fail('Проверьте порядок блоков главной страницы.');
  const hidden = input.homeHidden;
  if (!Array.isArray(hidden) || hidden.some((id: unknown) => !allowedModules.has(String(id)))) fail('Проверьте видимость блоков.');
  if (!input.texts || typeof input.texts !== 'object' || Array.isArray(input.texts)) fail('Проверьте тексты страниц.');
  const themeSource = input.theme ?? {};
  if (!themeSource || typeof themeSource !== 'object' || Array.isArray(themeSource)) fail('Проверьте оформление сайта.');
  const colorKeys = ['primary','accent','ink','muted','pageBackground','surface','border','tint'];
  const theme: Record<string, string> = {};
  for (const key of colorKeys) {
    const value = themeSource[key] ?? '';
    if (typeof value !== 'string' || (value && !/^#[0-9a-fA-F]{6}$/.test(value))) fail('Цвет должен быть в формате #RRGGBB.');
    if (value) theme[key] = value.toLowerCase();
  }
  const fonts = ['Nunito','Arial','Georgia','Verdana','Comfortaa'];
  if (themeSource.font !== undefined && !fonts.includes(themeSource.font)) fail('Выберите шрифт из списка.');
  const choices: Record<string, string[]> = { width:['narrow','standard','wide'], scale:['compact','standard','large'], spacing:['compact','standard','relaxed'], backgroundMode:['plain','pattern'], radius:['soft','round','square'] };
  for (const [key, allowed] of Object.entries(choices)) if (themeSource[key] !== undefined && !allowed.includes(themeSource[key])) fail('Недопустимое значение настройки оформления.');
  const modules: Record<string, string[]> = {};
  const pageCustom: Record<string, { id:string; title:string; body:string }[]> = {};
  for (const [page, allowed] of Object.entries(pageModules)) {
    const customSource = input.pageCustom?.[page] ?? [];
    if (!Array.isArray(customSource) || customSource.length > 10) fail('На одной странице можно создать не более 10 дополнительных блоков.');
    const customItems: { id:string; title:string; body:string }[] = [];
    const customIds = new Set<string>();
    for (const item of customSource) {
      if (!item || typeof item !== 'object' || !/^custom-[a-z0-9-]{6,40}$/.test(item.id) || customIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.body !== 'string' || item.body.length > 2000) fail('Проверьте пользовательские блоки страницы.');
      customIds.add(item.id); customItems.push({ id:item.id, title:item.title.trim(), body:item.body.trim() });
    }
    pageCustom[page] = customItems;
    const pageAllowed = [...allowed, ...customItems.map(item => item.id)];
    const state = input.modules?.[page] ?? { order: allowed, hidden: [] };
    if (!state || typeof state !== 'object' || !Array.isArray(state.order) || !Array.isArray(state.hidden) || state.order.length > 30 || new Set(state.order).size !== state.order.length || state.order.some((id: unknown) => !pageAllowed.includes(String(id))) || state.hidden.some((id: unknown) => !pageAllowed.includes(String(id)))) fail('Проверьте порядок и видимость блоков страницы.');
    modules[page] = JSON.stringify({ order: state.order, hidden: [...new Set(state.hidden)] });
  }
  const texts: Record<string, { title: string; lead: string; blocks: Record<string, string> }> = {};
  for (const page of [...editablePages, '__shared']) {
    const value = input.texts[page] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Проверьте текст страницы.');
    const title = value.title ?? '', lead = value.lead ?? '';
    if (typeof title !== 'string' || title.length > 180 || typeof lead !== 'string' || lead.length > 500) fail('Заголовок страницы — до 180 знаков, описание — до 500.');
    const sourceBlocks = value.blocks ?? {};
    if (!sourceBlocks || typeof sourceBlocks !== 'object' || Array.isArray(sourceBlocks) || Object.keys(sourceBlocks).length > 400) fail('Проверьте текстовые блоки страницы.');
    const blocks: Record<string, string> = {};
    for (const [key, text] of Object.entries(sourceBlocks)) {
      if (!/^t-[a-z0-9-]{3,100}$/.test(key) || typeof text !== 'string' || text.length > 4000) fail('Текстовый блок слишком длинный или имеет неверный формат.');
      blocks[key] = text;
    }
    texts[page] = { title: title.trim(), lead: lead.trim(), blocks };
  }
  if (JSON.stringify(texts).length > 45000) fail('Слишком много текста для одного сохранения. Сохраните изменения частями.');
  const normalizedModules = Object.fromEntries(Object.entries(modules).map(([page, value]) => [page, JSON.parse(value)]));
  return { homeOrder: order, homeHidden: [...new Set(hidden)], homeCustom: custom, pageCustom, texts, theme: { ...theme, font: themeSource.font || 'Nunito', width: themeSource.width || 'standard', scale: themeSource.scale || 'standard', spacing: themeSource.spacing || 'standard', backgroundMode: themeSource.backgroundMode || 'plain', radius: themeSource.radius || 'soft' }, modules: normalizedModules };
}
export async function handleCMS(request: Request, db: DB, adminHash?: string) {
  try {
    // CMS sessions use the panel's own username/password and do not depend on
    // the hosting platform's visitor-authentication headers.
    const visitor = 'admin-panel';
    const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, '').replace(/\/$/, '');
    const write = !['GET','HEAD'].includes(request.method);
    if (write && request.headers.get('origin') !== new URL(request.url).origin) fail('Запрос с другого сайта запрещён.', 403);
    if (adminHash) await db.prepare('INSERT OR IGNORE INTO cms_users (id, username, password, role, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').bind('admin', 'admin', adminHash, 'admin', now()).run();
    if (path === 'login' && request.method === 'POST') {
      const input = await body(request);
      const key = await sha256(visitor + ':' + (request.headers.get('cf-connecting-ip') || ''));
      const attempt = await db.prepare('SELECT count, reset_at FROM cms_attempts WHERE key = ?').bind(key).first<any>();
      if (attempt && attempt.reset_at > now() && attempt.count >= 10) fail('Слишком много попыток входа. Повторите через 15 минут.', 429);
      await db.prepare('INSERT INTO cms_attempts (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END, reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END').bind(key, now()+900, now(), now(), now()+900).run();
      const user = validUsername(input.username) ? await db.prepare('SELECT * FROM cms_users WHERE username = ?').bind(input.username).first<any>() : null;
      const dummy = adminHash || 'pbkdf2$100000$' + '0'.repeat(64) + '$' + '0'.repeat(64);
      const verified = await verifyPassword(typeof input.password === 'string' && input.password.length <= 128 ? input.password : '', user?.password || dummy);
      if (!user || !user.enabled || !verified) fail('Неверный логин или пароль.', 401);
      const token = randomToken(); const csrf = randomToken();
      await db.batch([db.prepare('DELETE FROM cms_sessions WHERE expires <= ?').bind(now()), db.prepare('INSERT INTO cms_sessions (token,user_id,visitor,csrf,expires) VALUES (?,?,?,?,?)').bind(await sha256(token), user.id, visitor, csrf, now()+28800), db.prepare('DELETE FROM cms_attempts WHERE key = ?').bind(key)]);
      return json({ user: { username:user.username, role:user.role }, csrf }, 200, { 'Set-Cookie': `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800` });
    }
    const cookie = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) fail('Войдите в панель администратора.', 401);
    const session = await db.prepare('SELECT s.token,s.csrf,u.id,u.username,u.role FROM cms_sessions s JOIN cms_users u ON s.user_id=u.id WHERE s.token=? AND s.visitor=? AND s.expires>? AND u.enabled=1').bind(await sha256(cookie), visitor, now()).first<any>();
    if (!session) fail('Сессия завершена. Войдите снова.', 401);
    if (write && request.headers.get('x-csrf-token') !== session.csrf) fail('Обновите страницу панели и повторите действие.', 403);
    const admin = () => { if (session.role !== 'admin') fail('Это действие доступно только администратору.', 403); };
    if (path === 'me' && request.method === 'GET') return json({ user:{ username:session.username, role:session.role }, csrf:session.csrf });
    if (path === 'logout' && request.method === 'POST') { await db.prepare('DELETE FROM cms_sessions WHERE token=?').bind(session.token).run(); return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`}); }
    if (path === 'password' && request.method === 'POST') {
      const input = await body(request); const user = await db.prepare('SELECT password FROM cms_users WHERE id=?').bind(session.id).first<any>();
      if (!validPassword(input.password) || !await verifyPassword(input.currentPassword || '', user.password)) fail('Проверьте текущий пароль. Новый пароль — от 10 символов.');
      await db.batch([db.prepare('UPDATE cms_users SET password=? WHERE id=?').bind(await hashPassword(input.password), session.id), db.prepare('DELETE FROM cms_sessions WHERE user_id=?').bind(session.id)]); return json({ok:true});
    }
    if (path === 'analytics' && request.method === 'GET') {
      await ensureAnalyticsTable(db);
      const daily = await db.prepare("SELECT day, SUM(views) AS views FROM cms_page_views WHERE day >= date('now','-29 days') GROUP BY day ORDER BY day").all<any>();
      const pages = await db.prepare("SELECT path, SUM(views) AS views FROM cms_page_views WHERE day >= date('now','-29 days') GROUP BY path ORDER BY views DESC LIMIT 20").all<any>();
      const totals = await db.prepare("SELECT COALESCE(SUM(CASE WHEN day >= date('now','-29 days') THEN views ELSE 0 END),0) AS month, COALESCE(SUM(CASE WHEN day >= date('now','-6 days') THEN views ELSE 0 END),0) AS week FROM cms_page_views").first<any>();
      return json({ daily: daily.results, pages: pages.results, month: totals?.month || 0, week: totals?.week || 0 });
    }
    if (path === 'layout' && request.method === 'GET') {
      const row = await db.prepare("SELECT data, revision FROM cms_records WHERE id='site-layout' AND kind='layout'").first<any>();
      return json({ revision: row?.revision || 0, settings: row ? JSON.parse(row.data).settings : { homeOrder: homeModules, homeHidden: [], homeCustom: [], texts: {}, theme: {}, modules: {} } });
    }
    if (path === 'layout' && request.method === 'PUT') {
      const input = await body(request), settings = validateLayout(input.settings);
      const row = await db.prepare("SELECT revision FROM cms_records WHERE id='site-layout' AND kind='layout'").first<any>();
      if (!row) {
        if (input.revision && input.revision !== 0) fail('Настройки уже изменились. Обновите страницу.',409);
        await db.prepare("INSERT INTO cms_records (id,kind,data,published,revision,updated_at,updated_by) VALUES ('site-layout','layout',?,1,1,?,?)").bind(JSON.stringify({ settings }),now(),session.id).run();
        return json({ ok:true, revision:1 });
      }
      const result = await db.prepare("UPDATE cms_records SET data=?,revision=revision+1,updated_at=?,updated_by=? WHERE id='site-layout' AND kind='layout' AND revision=?").bind(JSON.stringify({ settings }),now(),session.id,input.revision).run();
      if (!result.meta.changes) fail('Настройки изменились у другого редактора. Обновите их перед сохранением.',409);
      return json({ ok:true, revision:input.revision+1 });
    }
    if (path === 'users' && request.method === 'GET') { admin(); return json((await db.prepare('SELECT id,username,role,enabled,created_at FROM cms_users ORDER BY created_at').all()).results); }
    if (path === 'users' && request.method === 'POST') {
      admin(); const input = await body(request); if (!validUsername(input.username) || !validPassword(input.password)) fail('Логин: 3–40 латинских букв, цифр, дефисов или подчёркиваний. Пароль: 10–128 символов.');
      if (await db.prepare('SELECT id FROM cms_users WHERE username=?').bind(input.username).first()) fail('Такой логин уже существует.',409);
      await db.prepare('INSERT INTO cms_users (id,username,password,role,enabled,created_at) VALUES (?,?,?,?,1,?)').bind(crypto.randomUUID(),input.username,await hashPassword(input.password),'moderator',now()).run(); return json({ok:true},201);
    }
    if (path.startsWith('users/') && request.method === 'PATCH') {
      admin(); const id = path.slice(6); const input = await body(request);
      const user = await db.prepare('SELECT role FROM cms_users WHERE id=?').bind(id).first<any>(); if (!user) fail('Пользователь не найден.',404); if (user.role === 'admin') fail('Управление этим аккаунтом доступно через смену собственного пароля.');
      const statements = [];
      if (typeof input.enabled === 'boolean') statements.push(db.prepare('UPDATE cms_users SET enabled=? WHERE id=?').bind(input.enabled?1:0,id));
      if (input.password !== undefined) { if (!validPassword(input.password)) fail('Пароль должен содержать 10–128 символов.'); statements.push(db.prepare('UPDATE cms_users SET password=? WHERE id=?').bind(await hashPassword(input.password),id)); }
      if (!statements.length) fail('Нет изменений.'); statements.push(db.prepare('DELETE FROM cms_sessions WHERE user_id=?').bind(id)); await db.batch(statements); return json({ok:true});
    }
    if (path.startsWith('users/') && request.method === 'DELETE') {
      admin(); const id=path.slice(6); const user=await db.prepare('SELECT role FROM cms_users WHERE id=?').bind(id).first<any>(); if (!user) fail('Пользователь не найден.',404); if(user.role==='admin') fail('Удаление администратора запрещено.');
      await db.batch([db.prepare('DELETE FROM cms_sessions WHERE user_id=?').bind(id),db.prepare('DELETE FROM cms_users WHERE id=?').bind(id)]); return json({ok:true});
    }
    if (path === 'records' && request.method === 'GET') return json((await db.prepare('SELECT * FROM cms_records ORDER BY updated_at DESC').all<any>()).results.map(r=>({...r,data:JSON.parse(r.data)})));
    if ((path==='records'&&request.method==='POST') || (path.startsWith('records/')&&request.method==='PUT')) {
      const input=await body(request); const kind=input.kind; if(kind==='contacts')admin(); const data=validateRecord(kind,input.data);
      const id=request.method==='POST'? (kind==='contacts'?'contacts':crypto.randomUUID()):path.slice(8);
      if (kind==='news') { const duplicate=await db.prepare("SELECT id FROM cms_records WHERE kind='news' AND json_extract(data,'$.slug')=? AND id<>?").bind(data.slug,id).first(); if(duplicate)fail('Адрес новости уже занят.',409); }
      if (request.method==='POST') {
        if(await db.prepare('SELECT id FROM cms_records WHERE id=?').bind(id).first())fail('Материал уже существует.',409);
        await db.prepare('INSERT INTO cms_records (id,kind,data,published,revision,updated_at,updated_by) VALUES (?,?,?,?,1,?,?)').bind(id,kind,JSON.stringify(data),input.published===true?1:0,now(),session.id).run();
      } else {
        const existing=await db.prepare('SELECT kind FROM cms_records WHERE id=?').bind(id).first<any>(); if(!existing)fail('Материал не найден.',404); if(existing.kind!==kind)fail('Нельзя менять раздел материала.'); if(existing.kind==='contacts')admin();
        const result=await db.prepare('UPDATE cms_records SET data=?,published=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?').bind(JSON.stringify(data),input.published===true?1:0,now(),session.id,id,input.revision).run(); if(!result.meta.changes)fail('Материал изменён другим редактором. Обновите список перед сохранением.',409);
      }
      return json({ok:true,id},request.method==='POST'?201:200);
    }
    if(path.startsWith('records/')&&request.method==='DELETE') { const id=path.slice(8); const r=await db.prepare('SELECT kind FROM cms_records WHERE id=?').bind(id).first<any>();if(!r)fail('Материал не найден.',404);if(r.kind==='contacts')admin();await db.prepare('DELETE FROM cms_records WHERE id=?').bind(id).run();return json({ok:true}); }
    fail('Действие не найдено.',404);
  } catch(error:any) { return json({error:error.code?error.message:'Не удалось выполнить действие. Повторите позже.'}, error.code||500); }
}
