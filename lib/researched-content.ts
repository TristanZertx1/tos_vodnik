export const researchedRecords = [
  { id:'sources-ostrov-2018',kind:'news',data:{
    title:'Председатель ТОС участвовала в жюри детского квеста',slug:'ostrov-sokrovishch-2018',date:'2018-09-17',category:'Мероприятия',
    description:'Архивная публикация МЧС: Галина Быкова вошла в жюри квеста по пожарной безопасности в Кировском районе Перми.',
    body:'По сообщению Главного управления МЧС России по Пермскому краю от 17 сентября 2018 года, шестиклассники прошли квест на территории пожарно-спасательной части. Организаторами выступили ВДПО и дружина юных пожарных школы № 1. Председатель ТОС «Водники» Галина Быкова участвовала в работе жюри.\n\nЭто архивный материал. Дата относится к публикации первоисточника; мероприятие не является предстоящим.',
    source:'https://59.mchs.gov.ru/deyatelnost/press-centr/novosti/3151077',
  } },
  { id:'sources-project-2025',kind:'news',data:{
    title:'Проект ТОС вошёл в число поддержанных инициатив',slug:'istochnik-podderzhka-2025',date:'2025-11-24',category:'Инициативы',
    description:'«Новый компаньон» сообщил о поддержке проекта ТОС «Водники» по благоустройству территории источника у храма Святого князя Владимира.',
    body:'В публикации от 24 ноября 2025 года «Новый компаньон», ссылаясь на администрацию Перми, сообщил о результатах конкурса инициативных проектов для реализации в 2026 году. Среди поддержанных предложений назван проект ТОС «Водники» по благоустройству территории источника у храма Святого князя Владимира.\n\nСведения о поддержке проекта не подтверждают завершение работ. Актуальный ход реализации следует уточнять у ТОС.',
    source:'https://www.newsko.ru/news/nk-8989158.html',
  } },
  { id:'sources-istochnik',kind:'projects',data:{
    title:'Территория источника у храма Святого князя Владимира',status:'Поддержан по сообщению от 24.11.2025',
    description:'Инициатива ТОС «Водники» по благоустройству территории источника названа в муниципальном перечне проектов. Сообщение о поддержке опубликовано в ноябре 2025 года.',
    results:'Подтверждённые сведения о завершении работ пока не найдены.',participation:'Уточните актуальное состояние проекта и возможности участия в официальной группе ТОС.',
    source:'https://www.gorodperm.ru/actions/social-link/society/%20Inprojects/',
  } },
  { id:'contacts',kind:'contacts',data:{phone:'+7 919 706-13-93',email:'',hours:'',source:'https://rop59.ru/assets/files/spisok_tos.pdf'} },
];
// One-time import: editing, unpublishing and deleting remain under CMS control.
export async function ensureResearchMaterials(db:D1Database) {
  const id='public-sources-2026-10-05';
  if(await db.prepare('SELECT id FROM cms_imports WHERE id=?').bind(id).first())return;
  const statements=researchedRecords.map(r=>db.prepare('INSERT OR IGNORE INTO cms_records (id,kind,data,published,revision,updated_at,updated_by) SELECT ?,?,?,1,1,?,? WHERE NOT EXISTS (SELECT 1 FROM cms_imports WHERE id=?)').bind(r.id,r.kind,JSON.stringify(r.data),1791190800,'public-sources',id));
  statements.push(db.prepare('INSERT OR IGNORE INTO cms_imports (id,imported_at) VALUES (?,?)').bind(id,Math.floor(Date.now()/1000)));
  await db.batch(statements);
}
