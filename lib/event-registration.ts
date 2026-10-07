type DB = D1Database;

export async function ensureEventRegistrationTable(db: DB) {
  await db.exec(`CREATE TABLE IF NOT EXISTS cms_event_registrations (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at INTEGER NOT NULL,
    UNIQUE(event_id, phone)
  )`);
  await db.exec('CREATE INDEX IF NOT EXISTS cms_event_registrations_event_idx ON cms_event_registrations(event_id, status)');
}

export async function createEventRegistration(request: Request, db: DB, eventId: string, allowedOrigin?: string | string[]) {
  const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  const origin = new URL(request.url).origin;
  const requestOrigin = request.headers.get('origin');
  const allowedOrigins = Array.isArray(allowedOrigin) ? allowedOrigin : [allowedOrigin];
  if ((requestOrigin !== origin && !allowedOrigins.includes(requestOrigin || '')) || !request.headers.get('content-type')?.startsWith('application/json')) return fail('Неверный запрос.', 400);
  if (Number(request.headers.get('content-length') || 0) > 4000) return fail('Проверьте размер формы.', 413);
  let input: any;
  try { const text = await request.text(); if (text.length > 4000) return fail('Проверьте размер формы.', 413); input = JSON.parse(text); } catch { return fail('Заполните форму и повторите отправку.'); }
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  let digits = typeof input.phone === 'string' ? input.phone.replace(/\D/g, '') : '';
  if (digits.length === 10) digits = '7' + digits;
  else if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  const phone = '+' + digits;
  const seats = Number(input.seats);
  if (!/^[\p{L}][\p{L} .'-]{1,98}$/u.test(name) || digits.length < 10 || digits.length > 15 || !Number.isInteger(seats) || seats < 1 || seats > 5) return fail('Проверьте имя, телефон и количество мест.');
  await ensureEventRegistrationTable(db);
  const key = `event-register:${eventId}:${await (async()=>{const data=new TextEncoder().encode(request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')||'unknown');const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')})()}`;
  const attempts = await db.prepare('SELECT count, reset_at FROM cms_attempts WHERE key=?').bind(key).first<any>();
  if (attempts && attempts.reset_at > Date.now()/1000 && attempts.count >= 8) return fail('Слишком много заявок с этого подключения. Попробуйте позже.', 429);
  const now = Math.floor(Date.now()/1000);
  await db.prepare('INSERT INTO cms_attempts (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END').bind(key,now+3600,now,now,now+3600).run();
  try {
    const previous = await db.prepare('SELECT status FROM cms_event_registrations WHERE event_id=? AND phone=?').bind(eventId,phone).first<any>();
    if (previous?.status === 'confirmed') return fail('На этот номер телефона уже оформлена запись.', 409);
    const result = await db.prepare(`INSERT INTO cms_event_registrations (id,event_id,name,phone,seats,status,created_at)
      SELECT ?, ?, ?, ?, ?, 'confirmed', ?
      WHERE EXISTS (
        SELECT 1 FROM cms_records e WHERE e.id=? AND e.kind='events' AND e.published=1
          AND json_extract(e.data,'$.registrationEnabled')=1 AND json_extract(e.data,'$.date')>=?
          AND COALESCE((SELECT SUM(seats) FROM cms_event_registrations r WHERE r.event_id=e.id AND r.status='confirmed'),0)+? <= CAST(json_extract(e.data,'$.capacity') AS INTEGER)
      ) ON CONFLICT(event_id,phone) DO UPDATE SET name=excluded.name,seats=excluded.seats,status='confirmed',created_at=excluded.created_at WHERE cms_event_registrations.status='cancelled'`).bind(crypto.randomUUID(),eventId,name,phone,seats,now,eventId,new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg'}).format(new Date()),seats).run();
    if (!result.meta.changes) return fail('Запись закрыта или свободных мест уже не осталось.', 409);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return fail('На этот номер телефона уже оформлена запись.', 409);
    throw error;
  }
  const row = await db.prepare("SELECT COALESCE(SUM(seats),0) AS registered FROM cms_event_registrations WHERE event_id=? AND status='confirmed'").bind(eventId).first<any>();
  const event = await db.prepare("SELECT CAST(json_extract(data,'$.capacity') AS INTEGER) AS capacity FROM cms_records WHERE id=? AND kind='events'").bind(eventId).first<any>();
  return Response.json({ ok:true, registered:Number(row?.registered||0), available:Math.max(0,Number(event?.capacity||0)-Number(row?.registered||0)) }, { status:201, headers:{'Cache-Control':'no-store'} });
}

export async function getEventRegistrations(db: DB, eventId: string) {
  await ensureEventRegistrationTable(db);
  const event = await db.prepare("SELECT id,data FROM cms_records WHERE id=? AND kind='events'").bind(eventId).first<any>();
  if (!event) return null;
  const registrations = await db.prepare('SELECT id,name,phone,seats,status,created_at FROM cms_event_registrations WHERE event_id=? ORDER BY created_at DESC').bind(eventId).all<any>();
  return { eventId, title:JSON.parse(event.data).title, capacity:Number(JSON.parse(event.data).capacity||0), registrations:registrations.results };
}

export async function cancelEventRegistration(db: DB, registrationId: string) {
  await ensureEventRegistrationTable(db);
  const result = await db.prepare("UPDATE cms_event_registrations SET status='cancelled' WHERE id=? AND status='confirmed'").bind(registrationId).run();
  return Number(result.meta.changes)>0;
}
