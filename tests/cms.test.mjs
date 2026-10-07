import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleCMS, readPublic, validateRecord, validateLayout } from '../lib/cms.ts';
import { hashPassword } from '../lib/password.mjs';
import { ensureResearchMaterials } from '../lib/researched-content.ts';
import { renderPublic } from '../lib/public-render.ts';
import { createEventRegistration } from '../lib/event-registration.ts';
import { applyFooterSettings } from '../lib/footer-render.ts';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  const db = {
    exec(sql) { sqlite.exec(sql); },
    prepare(sql) {
      let values=[];
      return { bind(...args){values=args;return this}, async first(){return sqlite.prepare(sql).get(...values)||null}, async all(){return {results:sqlite.prepare(sql).all(...values)}}, async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}} };
    },
    async batch(statements) { sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e} },
  };
  return db;
}
const origin='https://example.test';
function request(path,method='GET',body,session={},extra={}) {
  const headers={...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(session.cookie?{cookie:session.cookie}:{}),...(session.csrf?{'x-csrf-token':session.csrf}:{}),...extra};
  return new Request(origin+'/api/admin/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(db,hash,username,password) {
  const response=await handleCMS(request('login','POST',{username,password}),db,hash);
  assert.equal(response.status,200,await response.clone().text());
  const data=await response.json();return {...data,cookie:response.headers.get('set-cookie').split(';')[0]};
}
test('Server authentication, moderation rights, drafts, edits and revocation',async()=>{
  const db=database(),hash=await hashPassword('test-password');
  assert.equal((await handleCMS(new Request(origin+'/api/admin/me'),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'wrong'}),db,hash)).status,401);
  const admin=await login(db,hash,'admin','test-password');
  assert.match(admin.cookie,/^__Host-vodniki-cms=/);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password'},admin,{'x-csrf-token':'wrong'}),db,hash)).status,403);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password'},admin,{origin:'https://attacker.test'}),db,hash)).status,403);
  assert.equal((await handleCMS(request('users','POST',{username:'mod',password:'moderator-password',role:'admin'},admin),db,hash)).status,201);
  const moderator=await login(db,hash,'mod','moderator-password');assert.equal(moderator.user.role,'moderator');
  assert.equal((await handleCMS(request('users','GET',undefined,moderator),db,hash)).status,403);
  assert.equal((await handleCMS(request('records','POST',{kind:'contacts',data:{}},moderator),db,hash)).status,403);
  const news={title:'Проверочный материал',slug:'test-news',date:'2026-10-05',category:'Объявления',description:'Материал для проверки, не публикуется на реальном сайте.'};
  let response=await handleCMS(request('records','POST',{kind:'news',data:news,published:false},moderator),db,hash);assert.equal(response.status,201);const {id}=await response.json();
  assert.equal((await readPublic(db)).news.length,0);
  response=await handleCMS(request('records/'+id,'PUT',{kind:'news',data:news,published:true,revision:1},moderator),db,hash);assert.equal(response.status,200);
  assert.equal((await readPublic(db)).news[0].slug,'test-news');
  assert.equal((await handleCMS(request('records/'+id,'PUT',{kind:'news',data:news,published:true,revision:1},moderator),db,hash)).status,409);
  assert.equal((await handleCMS(request('records','POST',{kind:'news',data:news},moderator),db,hash)).status,409);
  assert.equal((await handleCMS(request('me','GET',undefined,moderator),db,hash)).status,200);
  const users=await (await handleCMS(request('users','GET',undefined,admin),db,hash)).json();const mod=users.find(u=>u.username==='mod');
  assert.ok(users.every(u=>!('password'in u)));
  assert.equal((await handleCMS(request('users/'+mod.id,'PATCH',{enabled:false},admin),db,hash)).status,200);
  assert.equal((await handleCMS(request('me','GET',undefined,moderator),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'mod',password:'moderator-password'}),db,hash)).status,401);
  await handleCMS(request('users/'+mod.id,'PATCH',{enabled:true,password:'replacement-password'},admin),db,hash);
  const restored=await login(db,hash,'mod','replacement-password');
  assert.equal((await handleCMS(request('records/'+id,'DELETE',undefined,restored),db,hash)).status,200);
  assert.equal((await readPublic(db)).news.length,0);
  assert.equal((await handleCMS(request('users/admin','DELETE',undefined,admin),db,hash)).status,400);
  await handleCMS(request('users/'+mod.id,'DELETE',undefined,admin),db,hash);
  assert.equal((await handleCMS(request('me','GET',undefined,restored),db,hash)).status,401);
  assert.equal((await handleCMS(request('password','POST',{currentPassword:'test-password',password:'new-admin-password'},admin),db,hash)).status,200);
  assert.equal((await handleCMS(request('me','GET',undefined,admin),db,hash)).status,401);
  await login(db,hash,'admin','new-admin-password');
});
test('A changed server admin secret synchronizes once without undoing later password changes',async()=>{
  const db=database(),oldHash=await hashPassword('old-admin-password'),newHash=await hashPassword('configured-admin-password');
  await login(db,oldHash,'admin','old-admin-password');
  assert.equal((await handleCMS(new Request(origin+'/api/admin/me'),db,newHash)).status,401);
  const admin=await login(db,newHash,'admin','configured-admin-password');
  assert.equal((await handleCMS(request('password','POST',{currentPassword:'configured-admin-password',password:'user-chosen-password'},admin),db,newHash)).status,200);
  await login(db,newHash,'admin','user-chosen-password');
  assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'configured-admin-password'}),db,newHash)).status,401);
});
test('Admin login allows only the configured Render origin behind the API proxy',async()=>{
  const db=database(),hash=await hashPassword('test-password');
  const allowed='https://tos-vodnik.onrender.com';
  const proxied=new Request('https://worker.example.workers.dev/api/admin/login',{method:'POST',headers:{origin:allowed,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});
  const response=await handleCMS(proxied,db,hash,allowed);
  assert.equal(response.status,200,await response.clone().text());
  const blocked=new Request('https://worker.example.workers.dev/api/admin/login',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});
  assert.equal((await handleCMS(blocked,db,hash,allowed)).status,403);
});
test('Research import preserves editor changes, existing contacts and deletions',async()=>{
  const db=database();
  await db.prepare('INSERT INTO cms_records (id,kind,data,published,revision,updated_at,updated_by) VALUES (?,?,?,?,1,?,?)').bind('contacts','contacts',JSON.stringify({phone:'Confirmed by editor'}),1,1,'admin').run();
  await ensureResearchMaterials(db);
  let content=await readPublic(db);assert.equal(content.news.length,2);assert.equal(content.projects.length,1);assert.equal(content.contacts.phone,'Confirmed by editor');assert.equal(content.events.length,0);
  await db.prepare('DELETE FROM cms_records WHERE id=?').bind('sources-ostrov-2018').run();
  await db.prepare('UPDATE cms_records SET published=0 WHERE id=?').bind('sources-istochnik').run();
  await ensureResearchMaterials(db);
  content=await readPublic(db);assert.equal(content.news.length,1);assert.equal(content.projects.length,0);
});
test('Invalid materials and rate limits',async()=>{
  assert.throws(()=>validateRecord('documents',{title:'X',date:'2026-02-30',format:'PDF',size:'1 KB',url:'https://example.test/a.pdf'}));
  assert.throws(()=>validateRecord('projects',{title:'X',status:'X',description:'X',participation:'X',image:'javascript:alert(1)',imageAlt:'X',imagePermission:true}));
  assert.throws(()=>validateRecord('projects',{title:'X',status:'X',description:'X',participation:'X',image:'https://example.test/a.jpg',imageAlt:'X'}));
  const newsWithPhotos=validateRecord('news',{title:'Фотоновость',slug:'photo-news',date:'2026-10-05',category:'Объявления',description:'Коротко',imagePermission:true,images:[{src:'data:image/jpeg;base64,AA==',alt:'Участники встречи'}]});
  assert.equal(newsWithPhotos.images.length,1);
  assert.throws(()=>validateRecord('news',{title:'Фотоновость',slug:'photo-news',date:'2026-10-05',category:'Объявления',description:'Коротко',imagePermission:true,images:[{src:'data:text/html;base64,PHNjcmlwdD4=',alt:'X'}]}));
  assert.throws(()=>validateRecord('news',{title:'Фотоновость',slug:'photo-news',date:'2026-10-05',category:'Объявления',description:'Коротко',images:[{src:'data:image/jpeg;base64,AA==',alt:'Фото'}]}));
  const db=database(),hash=await hashPassword('test-password');
  for(let i=0;i<10;i++)assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'wrong'}),db,hash)).status,401);
  assert.equal((await handleCMS(request('login','POST',{username:'admin',password:'test-password'}),db,hash)).status,429);
});
test('Event registration limits cannot be bypassed by spoofing X-Forwarded-For',async()=>{
  const db=database(),eventId='nonexistent-event-for-rate-limit';
  for(let i=0;i<8;i++){
    const response=await createEventRegistration(new Request(origin+'/api/public/events/'+eventId+'/register',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.20','x-forwarded-for':'198.51.100.'+(i+1)},body:JSON.stringify({name:'Анна Смирнова',phone:'+7 900 111-22-'+String(i+10),seats:1})}),db,eventId);
    assert.equal(response.status,409);
  }
  const blocked=await createEventRegistration(new Request(origin+'/api/public/events/'+eventId+'/register',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.20','x-forwarded-for':'192.0.2.200'},body:JSON.stringify({name:'Анна Смирнова',phone:'+7 900 111-22-99',seats:1})}),db,eventId);
  assert.equal(blocked.status,429);
});
test('Site builder validates themes, per-page modules and custom text sections',()=>{
  const baseline={homeOrder:['hero','quick','overview','news','events','projects','join'],homeHidden:[],homeCustom:[],texts:{},footer:{phone:'+7 919 706-13-93',email:'vshivkova.anna@bk.ru',address:'Батумская улица, 20, г. Пермь'},theme:{primary:'#146e62',font:'Georgia',width:'wide',scale:'large',spacing:'relaxed',radius:'round',backgroundMode:'pattern'},modules:{'/o-tos/':{order:['about-heading','custom-abcdef12','about-nav','about-intro','about-directions','about-chairperson','about-clubs','about-participate','about-activity-2025','about-activity-2024','about-faq'],hidden:[]}},pageCustom:{'/o-tos/':[{id:'custom-abcdef12',title:'Новый раздел',body:'Текст раздела'}]}};
  const layout=validateLayout(baseline);
  assert.equal(layout.theme.font,'Georgia');
  assert.equal(layout.theme.primary,'#146e62');
  assert.equal(layout.modules['/o-tos/'].order[1],'custom-abcdef12');
  assert.equal(layout.pageCustom['/o-tos/'][0].title,'Новый раздел');
  assert.equal(layout.footer.email,'vshivkova.anna@bk.ru');
  assert.equal(layout.footer.address,'Батумская улица, 20, г. Пермь');
  assert.throws(()=>validateLayout({...baseline,footer:{...baseline.footer,email:'not-an-email'}}));
  assert.throws(()=>validateLayout({...baseline,theme:{...baseline.theme,primary:'url(javascript:alert(1))'}}));
  assert.throws(()=>validateLayout({...baseline,modules:{'/o-tos/':{order:['<script>'],hidden:[]}}}));
  assert.throws(()=>validateLayout({...baseline,pageCustom:{'/o-tos/':[{...baseline.pageCustom['/o-tos/'][0],body:'x'.repeat(2001)}]}}));
});
test('News renders every attached photo in cards and in the article',()=>{
  const data={news:[{title:'Фотоотчёт',slug:'photo-report',date:'2026-10-05',category:'Объявления',description:'Описание',images:[{src:'data:image/jpeg;base64,AA==',alt:'Первое фото'},{src:'data:image/jpeg;base64,AQ==',alt:'Второе фото'}]}],events:[],projects:[],documents:[],contacts:{},layout:{}};
  const card=renderPublic(data,'/novosti/').html;
  const article=renderPublic(data,'/novosti/photo-report').html;
  assert.equal((card.match(/class="publication-gallery"/g)||[]).length,1);
  assert.equal((card.match(/data:image\/jpeg;base64/g)||[]).length,2);
  assert.equal((article.match(/data:image\/jpeg;base64/g)||[]).length,2);
  assert.match(article,/alt="Первое фото"/);
});
test('Event registration respects capacity and the editor can track and cancel reservations',async()=>{
  const db=database(),hash=await hashPassword('test-password'),admin=await login(db,hash,'admin','test-password');
  const event={title:'Встреча соседей',date:'2026-12-01',time:'18:00',place:'Клуб ТОС',description:'Тестовая встреча',participation:'Вход свободный',capacity:3,registrationEnabled:true};
  const saved=await handleCMS(request('records','POST',{kind:'events',data:event,published:true},admin),db,hash);assert.equal(saved.status,201,await saved.clone().text());const {id}=await saved.json();
  const register=(name,phone,seats,ip)=>createEventRegistration(new Request(origin+'/api/public/events/'+id+'/register',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({name,phone,seats})}),db,id);
  const proxied=new Request(origin+'/api/public/events/'+id+'/register',{method:'POST',headers:{origin:'https://tos-vodnik.onrender.com','content-type':'application/json'},body:JSON.stringify({name:'Мария Петрова',phone:'+7 999 111-22-33',seats:1})});
  assert.equal((await createEventRegistration(proxied,db,id,'https://tos-vodnik.onrender.com')).status,201,'the Render origin must be accepted by the Cloudflare API proxy');
  const rejected=new Request(origin+'/api/public/events/'+id+'/register',{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json'},body:JSON.stringify({name:'Пётр Смирнов',phone:'+7 999 111-22-34',seats:1})});
  assert.equal((await createEventRegistration(rejected,db,id,'https://tos-vodnik.onrender.com')).status,400,'unapproved origins must be rejected');
  const first=await register('Анна Смирнова','+7 900 111-22-33',1,'192.0.2.1');assert.equal(first.status,201,await first.clone().text());
  const {registeredId}=await (async()=>{const list=await handleCMS(request('registrations?eventId='+id,'GET',undefined,admin),db,hash);assert.equal(list.status,200);const {registrations}=await list.json();return {registeredId:registrations[0].id}})();
  assert.equal((await register('Иван Петров','+7 900 444-55-66',2,'192.0.2.2')).status,409);
  const cancelled=await handleCMS(request('registrations/'+registeredId,'DELETE',{},admin),db,hash);assert.equal(cancelled.status,200);
  const second=await register('Иван Петров','+7 900 444-55-66',2,'192.0.2.2');assert.equal(second.status,201);
  const publicContent=await readPublic(db);assert.equal(publicContent.events[0].registeredCount,3);assert.equal(publicContent.events[0].availableSeats,0);
});
test('Published future events render an accessible registration form when signup is enabled',()=>{
  const event={id:'event-registration-test',title:'Встреча соседей',date:'2026-12-01',time:'18:00',place:'Клуб ТОС',description:'Встреча для жителей',participation:'Вход свободный',capacity:12,registrationEnabled:true,registeredCount:3};
  const rendered=renderPublic({news:[],events:[event],projects:[],documents:[],contacts:{},layout:{}},'/meropriyatiya/').html;
  assert.match(rendered,/data-event-registration/);
  assert.match(rendered,/Занято мест: 3 из 12\. Свободно: 9\./);
  assert.match(rendered,/name="phone" type="tel"/);
});
test('The requested contact email replaces the previous report address',()=>{
  const rendered=renderPublic({news:[],events:[],projects:[],documents:[],contacts:{email:'9977886@mail.ru'},layout:{}},'/kontakty/').html;
  assert.match(rendered,/mailto:vshivkova\.anna@bk\.ru/);
  assert.doesNotMatch(rendered,/mailto:9977886@mail\.ru/);
});
test('Site builder footer updates text and keeps phone and email links in sync',()=>{
  const markup='<footer><a data-footer-link="phone" href="tel:+70000000000"><span data-footer-field="phone">Old phone</span></a><a data-footer-link="email" href="mailto:old@example.test"><span data-footer-field="email">old@example.test</span></a><span data-footer-field="organization">Old &amp; name</span></footer>';
  const rendered=applyFooterSettings(markup,{footer:{phone:'+7 919 706-13-93',email:'vshivkova.anna@bk.ru',organization:'ТОС «Водники» & соседи'}});
  assert.match(rendered,/href="tel:\+79197061393"/);
  assert.match(rendered,/href="mailto:vshivkova\.anna@bk\.ru"/);
  assert.match(rendered,/>ТОС «Водники» &amp; соседи<\/span>/);
});

