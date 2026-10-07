import { env } from 'cloudflare:workers';
import { createEventRegistration } from '../../../../../../lib/event-registration.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!env.DB) return Response.json({ error:'Запись временно недоступна.' }, { status:503, headers:{'Cache-Control':'no-store'} });
  const { id } = await params;
  if (!/^[a-z0-9-]{12,40}$/i.test(id)) return Response.json({ error:'Мероприятие не найдено.' }, { status:404 });
  try { return await createEventRegistration(request,env.DB,id); }
  catch { return Response.json({ error:'Не удалось сохранить заявку. Попробуйте позже.' }, { status:503, headers:{'Cache-Control':'no-store'} }); }
}
