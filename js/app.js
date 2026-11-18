'use strict';
// 修繕管理アプリ本体（要件定義書：報告 → 予定 → 修理 → 完了報告、ステータス色、ダッシュボード・一覧・カレンダー・管理画面）
// Supabase 接続（publishable キーは公開前提。データはログイン＋RLS で店舗ごとに保護）
const SUPABASE_URL = 'https://jobtomwqwlvbhypoefbu.supabase.co', SUPABASE_KEY = 'sb_publishable_7bqEbAM6pjclhgsWi5d42g_z5ghae7c';
const BUCKET = 'repair-photos', NOTE_TABLE = 'rooms';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ───────────── 小道具 ─────────────
const $ = id => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const lsGet = k => { try { return localStorage.getItem(k) } catch (e) { return null } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } };
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', 3500) }
async function busy(btn, fn) { if (btn) btn.disabled = true; try { return await fn() } catch (e) { toast(e.message || String(e)) } finally { if (btn) btn.disabled = false } }
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data };

// 日付は日本時間で数える。予定日の当日を0日目とする
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const dateOf = ts => ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : '';
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
const fmtD = d => d ? d.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1/$2/$3') : '—';
const fmtTs = ts => ts ? fmtD(dateOf(ts)) : '—';
const yen = n => n == null ? '—' : '¥' + Number(n).toLocaleString('ja-JP');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) };

// ───────────── ステータス色（4章） ─────────────
const COLORS = {
  red: { name: '赤', label: '修繕遅れ（予定日から7日以上）' },
  yellow: { name: '黄', label: '予定日未設定' },
  blue: { name: '青', label: '予定日から3〜6日' },
  gray: { name: 'グレー', label: '予定日前・予定日から0〜2日' },
  green: { name: '緑', label: '完了' },
};
const ORDER = ['red', 'yellow', 'blue', 'gray', 'green'];   // 一番対応が必要な色を優先
function colorOf(r) {
  if (r.completed_at) return 'green';
  if (!r.scheduled_date) return 'yellow';
  const d = dayDiff(todayStr(), r.scheduled_date);
  return d >= 7 ? 'red' : d >= 3 ? 'blue' : 'gray';
}
const worst = list => list.reduce((w, r) => { const c = colorOf(r); return w == null || ORDER.indexOf(c) < ORDER.indexOf(w) ? c : w }, null);
const chip = (c, text) => h('span', { class: 'chip c-' + c }, h('span', { class: 'dot' }), text || COLORS[c].name);
function statusText(r) {
  const c = colorOf(r);
  if (c === 'green') return '完了';
  if (c === 'yellow') return '予定日未設定';
  const d = dayDiff(todayStr(), r.scheduled_date);
  return d < 0 ? `予定日まで${-d}日` : `予定日から${d}日経過`;
}

const ROOM_SPOTS = ['部屋全体', 'エアコン', '浴室', 'トイレ', '洗面台', '洗濯機', 'キッチン', '冷蔵庫', '電子レンジ', 'ベッド', 'テレビ', '照明', '窓・カーテン', '玄関ドア・鍵', '床・壁・天井', 'その他'];

// ───────────── 状態 ─────────────
const S = {
  user: null, me: null, stores: [], storeId: null, repairs: [], profiles: [], members: [],
  view: 'model', sel: null,
  list: { store: '', color: 'open', assignee: '', dateField: 'reported', from: '', to: '', sort: 'priority' },
  cal: { mode: 'month', date: todayStr(), assignee: '', store: '' },
};
const isAdmin = () => S.me && S.me.role === 'admin';
const store = id => S.stores.find(s => s.id === (id || S.storeId));
const profileName = id => (S.profiles.find(p => p.id === id) || {}).display_name || '';
const locLabel = r => r.location_type === 'room' ? `${r.location}号室` : r.location;
const caseTitle = r => locLabel(r) + (r.spot && r.spot !== '部屋全体' ? `・${r.spot}` : '');
const storeMembers = sid => S.profiles.filter(p => p.active && S.members.some(m => m.store_id === sid && m.user_id === p.id));

// ───────────── 写真 ─────────────
const urlCache = new Map();
async function signedUrls(paths) {
  const now = Date.now(), need = [...new Set(paths.filter(p => p && !(urlCache.get(p)?.exp > now)))];
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    (data || []).forEach(d => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 3300e3 }) });
  }
  return p => urlCache.get(p)?.url || '';
}
function fillImages(root) {
  const imgs = [...root.querySelectorAll('img[data-path]')];
  if (imgs.length) signedUrls(imgs.map(i => i.dataset.path)).then(get => imgs.forEach(i => { const u = get(i.dataset.path); if (u) i.src = u }));
}
function resizeImage(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src);
      cv.toBlob(b => b ? res(b) : rej(new Error('画像を変換できませんでした')), 'image/jpeg', .82);
    };
    img.onerror = () => rej(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}
async function uploadPhoto(storeId, repairId, kind, file) {
  const blob = await resizeImage(file), path = `${storeId}/${repairId}/${kind}-${Date.now()}.jpg`;
  must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
  return path;
}
const photoImg = (path, c, cls) => path ? h('img', { class: cls || 'frame', 'data-path': path, alt: '修繕写真', style: `--c:var(--${c})`, loading: 'lazy' }) : null;

// LINE通知（店舗のLINEグループへ）。Edge Function 側で未設定なら何もしない
function notifyLine(repair_id, event) { sb.functions.invoke('line-notify', { body: { repair_id, event } }).catch(() => { }) }

// ───────────── 読み込み ─────────────
async function fetchAll(make) {   // 1000件ずつ取り切る
  const out = [];
  for (let from = 0; ; from += 1000) { const rows = must(await make().range(from, from + 999)); out.push(...rows); if (rows.length < 1000) return out }
}
async function loadAll() {
  const [stores, repairs, profiles, members] = await Promise.all([
    fetchAll(() => sb.from('stores').select('*').order('sort').order('name')),
    fetchAll(() => sb.from('repairs').select('*').order('reported_at', { ascending: false })),
    fetchAll(() => sb.from('profiles').select('id,email,display_name,role,active').order('display_name')),
    fetchAll(() => sb.from('store_members').select('store_id,user_id')),
  ]);
  Object.assign(S, { stores, repairs, profiles, members });
}
async function reloadRepairs() { S.repairs = await fetchAll(() => sb.from('repairs').select('*').order('reported_at', { ascending: false })); renderAll() }

// ───────────── 認証 ─────────────
function showGate(which) { $('loginGate').hidden = which !== 'login'; $('pendingGate').hidden = which !== 'pending'; $('app').hidden = which !== 'app' }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginMsg').textContent = 'ログイン中…';
  const { error } = await sb.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPass').value });
  $('loginMsg').textContent = error ? 'ログインできませんでした。メールアドレスとパスワードを確認してください。' : '';
});
$('logoutBtn').onclick = $('pendingLogout').onclick = () => sb.auth.signOut();
async function onSession(s) {
  const u = s ? s.user : null;
  if ((u && u.id) === (S.user && S.user.id)) return;
  S.user = u;
  if (!u) { S.me = null; closeSel(); showGate('login'); return }
  $('loginPass').value = '';
  const { data: me } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
  S.me = me;
  if (!me || !me.active) { $('pendingEmail').textContent = u.email || ''; showGate('pending'); return }
  showGate('app');
  $('userName').textContent = `${me.display_name}（${isAdmin() ? '本社管理者' : '店舗スタッフ'}）`;
  document.querySelectorAll('[data-admin]').forEach(b => b.hidden = !isAdmin());
  try { await loadAll() } catch (e) { toast('読み込みに失敗しました：' + e.message); return }
  const last = lsGet('facilityStore');
  selectStore(S.stores.some(x => x.id === last) ? last : S.stores[0]?.id || null);
  setView(isAdmin() && !lsGet('facilityView') ? 'dashboard' : (lsGet('facilityView') || 'model'));
}
// コールバック内で Supabase を呼ぶとロックで止まることがあるため setTimeout で外に出す
sb.auth.onAuthStateChange((ev, s) => { if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(ev)) setTimeout(() => onSession(s)) });
$('reloadBtn').onclick = e => busy(e.target, async () => { await loadAll(); selectStore(S.storeId, true); toast('最新の情報に更新しました') });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me?.active) reloadRepairs().catch(() => { }) });

// ───────────── 画面切り替え ─────────────
$('tabs').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view) });
function setView(v) {
  if (!isAdmin() && ['dashboard', 'calendar', 'admin'].includes(v)) v = 'model';
  S.view = v; lsSet('facilityView', v);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  for (const p of ['model', 'dashboard', 'list', 'calendar', 'admin']) $(p + 'Page').hidden = p !== v;
  renderAll();
}
function renderAll() {
  if (!S.me) return;
  update3D();
  if (S.view === 'model') renderPanel();
  if (S.view === 'dashboard') renderDashboard();
  if (S.view === 'list') renderList();
  if (S.view === 'calendar') renderCalendar();
  if (S.view === 'admin') renderAdmin();
}

// ───────────── 店舗選択と3D ─────────────
$('storeSel').onchange = e => selectStore(e.target.value);
function selectStore(id, keepSel) {
  const sel = $('storeSel');
  put(sel, ...(S.stores.length ? S.stores.map(s => h('option', { value: s.id, text: s.name + (s.area ? `（${s.area}）` : '') })) : [h('option', { value: '', text: '表示できる店舗がありません' })]));
  const changed = id !== S.storeId;
  S.storeId = id; if (id) { sel.value = id; lsSet('facilityStore', id) }
  if (changed || !keepSel) closeSel();
  buildBuilding(store()?.building); highlight(S.sel);
  put($('floorSel'), h('option', { value: 'all', text: '全館' }), ...floorOptions().map(o => h('option', { value: o.value, text: o.label })));
  renderAll();
}
function update3D() {
  const map = { room: {}, common: {} }, by = {};
  S.repairs.filter(r => r.store_id === S.storeId && !(r.completed_at && dayDiff(todayStr(), dateOf(r.completed_at)) > 30))
    .forEach(r => (by[r.location_type + '|' + r.location] ||= []).push(r));
  for (const [k, list] of Object.entries(by)) { const [t, loc] = k.split('|'); map[t][loc] = worst(list) }
  setStatus(map);
}
$('legend').append(...ORDER.map(c => h('span', {}, h('span', { class: 'dot', style: `background:var(--${c})` }), COLORS[c].name)));
$('homeBtn').onclick = () => resetView();
$('explodeBtn').onclick = () => explode();
$('floorSel').onchange = () => applyFloor();
$('exitRoomBtn').onclick = () => exitRoomView();
function onPickLocation(type, loc) {   // building.js から呼ばれる
  S.sel = { type, loc }; highlight(S.sel); $('modelPage').classList.add('open'); renderPanel();
}
function closeSel() { if (typeof exitRoomView === 'function') exitRoomView(); S.sel = null; highlight(null); $('modelPage').classList.remove('open'); if (S.view === 'model' && S.me) renderPanel() }

// ───────────── 右パネル（場所ごとの案件と報告） ─────────────
function caseCard(r) {
  const c = colorOf(r);
  return h('div', { class: 'card case', onclick: () => openCase(r.id) },
    r.photos_purged_at ? h('div', { class: 'frame noPhoto', style: `--c:var(--${c})` }, '写真削除済') : photoImg(r.completion_photo_path || r.report_photo_path, c),
    h('div', { class: 'caseBody' }, chip(c, statusText(r)), h('b', { text: caseTitle(r) }),
      r.note ? h('div', { text: r.note, style: 'white-space:pre-wrap' }) : null,
      h('div', { class: 'muted' }, `依頼日 ${fmtTs(r.reported_at)}　予定日 ${fmtD(r.scheduled_date)}`, h('br'),
        r.completed_at ? `完了日 ${fmtTs(r.completed_at)}　${yen(r.cost)}` : `担当 ${r.assignee_name || '未定'}`)));
}
function renderPanel() {
  const p = $('panel'), st = store();
  if (!st) { put(p, h('div', { class: 'card muted', text: '表示できる店舗がありません。本社管理者に閲覧許可を依頼してください。' })); return }
  const open = S.repairs.filter(r => r.store_id === st.id && !r.completed_at);
  if (!S.sel) {
    const counts = ORDER.slice(0, 4).map(c => [c, open.filter(r => colorOf(r) === c).length]);
    const areas = (B.commonAreas || []);
    put(p, 
      h('h3', { text: st.name }),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, ...counts.map(([c, n]) => h('div', { class: 'tile', style: `--c:var(--${c});padding:8px` }, h('div', { class: 'muted', text: COLORS[c].name }), h('div', { class: 'n', style: 'font-size:20px', text: n })))),
      h('div', { class: 'card muted', text: '3Dモデルの部屋・共用部（屋上・廊下・外壁・駐車場など）をタップすると、その場所の修繕を報告・確認できます。' }),
      areas.length ? h('div', {}, h('label', { text: '共用部から選ぶ' }), h('div', { class: 'areaBtns' }, ...areas.map(a => h('button', { class: 'btn small', text: a, onclick: () => onPickLocation('common', a) })))) : null,
      open.length ? h('div', {}, h('label', { text: `未完了の修繕（${open.length}件）` }), ...open.sort(byPriority).slice(0, 30).map(caseCard)) : null);
    fillImages(p); return;
  }
  const { type, loc } = S.sel, here = S.repairs.filter(r => r.store_id === st.id && r.location_type === type && r.location === loc).sort(byPriority);
  const w = worst(here.filter(r => !r.completed_at));
  put(p, 
    h('div', { class: 'panelHead' }, h('h3', { text: type === 'room' ? `${loc}号室` : loc }), h('button', { class: 'btn small', text: '閉じる', onclick: closeSel })),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, h('span', { class: 'muted', style: 'flex:0 1 auto' }, type === 'room' ? `${st.name}・タイプ${roomType(loc)}` : `${st.name}・共用部`), w ? h('span', { style: 'flex:0' }, chip(w)) : null,
      type === 'room' && hasInterior(loc) ? h('button', { class: 'btn small', style: 'flex:0', text: '室内3D', onclick: () => enterRoomView(loc) }) : null),
    reportForm(st.id, type, loc),
    here.length ? h('div', {}, h('label', { text: `この場所の修繕（${here.length}件）` }), ...here.map(caseCard)) : h('div', { class: 'muted', style: 'margin:10px 0', text: 'この場所の修繕記録はまだありません。' }),
    type === 'room' ? cleaningNote(st.id, loc) : null);
  fillImages(p);
}
const byPriority = (a, b) => ORDER.indexOf(colorOf(a)) - ORDER.indexOf(colorOf(b)) || (b.reported_at > a.reported_at ? 1 : -1);

function reportForm(storeId, type, loc) {
  const f = h('form', { class: 'card' },
    h('b', { text: '修繕が必要な箇所を報告' }),
    h('label', { text: '場所' }),
    type === 'room' ? h('select', { name: 'spot' }, ...ROOM_SPOTS.map(s => h('option', { value: s, text: s }))) : h('input', { name: 'spot', placeholder: '例：北側の手すり（任意）' }),
    h('label', { text: '内容' }), h('textarea', { name: 'note', placeholder: '例：エアコンから水漏れ' }),
    h('label', { text: '写真（必須）' }), h('input', { name: 'photo', type: 'file', accept: 'image/*', required: true }),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;margin-top:12px', text: '写真を登録して報告する' }),
    h('div', { class: 'muted', style: 'margin-top:6px', text: '写真を登録した日が修繕依頼日になります。店舗のLINEグループに通知されます。' }));
  f.onsubmit = e => {
    e.preventDefault();
    const file = f.photo.files[0]; if (!file) return;
    busy(f.querySelector('[type=submit]'), async () => {
      const id = crypto.randomUUID(), path = await uploadPhoto(storeId, id, 'before', file);
      must(await sb.from('repairs').insert({ id, store_id: storeId, location_type: type, location: loc, spot: f.spot.value.trim(), note: f.note.value.trim(), report_photo_path: path }));
      notifyLine(id, 'reported'); toast('報告しました'); await reloadRepairs();
    });
  };
  return f;
}

// 既存の「重点清掃箇所」メモ（残すかは未決事項）
function cleaningNote(storeId, roomId) {
  const ta = h('textarea', { placeholder: '例：浴室の水垢、ベッド下のホコリ' }), state = h('div', { class: 'muted' });
  sb.from(NOTE_TABLE).select('focus').eq('store_id', storeId).eq('room_id', roomId).maybeSingle().then(({ data }) => { if (data) ta.value = data.focus || '' });
  let t; ta.oninput = () => { clearTimeout(t); state.textContent = '未保存の変更あり'; t = setTimeout(async () => { const { error } = await sb.from(NOTE_TABLE).upsert({ store_id: storeId, room_id: roomId, focus: ta.value }); state.textContent = error ? '保存に失敗しました：' + error.message : '保存しました' }, 600) };
  return h('details', { class: 'card' }, h('summary', { text: '重点清掃箇所（清掃メモ）' }), ta, state);
}

// ───────────── 案件の詳細（予定の設定・完了報告） ─────────────
function openCase(id) {
  const r = S.repairs.find(x => x.id === id); if (!r) return;
  const c = colorOf(r), st = store(r.store_id), body = $('dlgBody');
  const fig = (path, cap) => h('figure', {}, r.photos_purged_at ? h('div', { class: 'noPhoto', text: '保管期間（1年）を過ぎたため削除済み' }) : path ? photoImg(path, c, ' ') : h('div', { class: 'noPhoto', text: '完了写真はまだありません' }), h('figcaption', { text: cap }));
  const rows = [['店舗', st?.name || r.store_id], ['場所', caseTitle(r)], ['内容', r.note || '—'], ['修繕依頼日', fmtTs(r.reported_at) + (profileName(r.reported_by) ? `（${profileName(r.reported_by)}）` : '')],
    ['対応予定日', fmtD(r.scheduled_date)], ['担当者', r.assignee_name || '未定'], ['対応完了日', r.completed_at ? fmtTs(r.completed_at) + (profileName(r.completed_by) ? `（${profileName(r.completed_by)}）` : '') : '—'], ['費用', yen(r.cost)]];
  put(body, 
    h('div', { class: 'panelHead' }, h('h2', { text: caseTitle(r), style: 'margin:0' }), h('button', { class: 'btn small', text: '閉じる', onclick: () => $('dlg').close() })),
    h('div', { style: 'margin:8px 0 12px' }, chip(c, statusText(r))),
    h('div', { class: 'photos' }, fig(r.report_photo_path, '報告時の写真'), fig(r.completion_photo_path, '完了時の写真')),
    h('dl', { class: 'info' }, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v, style: 'white-space:pre-wrap' })])),
    !r.completed_at && isAdmin() ? scheduleForm(r) : null,
    !r.completed_at ? completeForm(r) : null,
    isAdmin() ? adminCaseActions(r) : null);
  fillImages(body);
  if (!$('dlg').open) $('dlg').showModal();
}
async function saveRepair(id, patch) { must(await sb.from('repairs').update(patch).eq('id', id)); await reloadRepairs(); if ($('dlg').open) openCase(id) }
function scheduleForm(r) {
  const members = storeMembers(r.store_id);
  const f = h('form', { class: 'card' }, h('b', { text: '対応予定（本社）' }),
    h('div', { class: 'row' },
      h('div', {}, h('label', { text: '対応予定日' }), h('input', { name: 'date', type: 'date', value: r.scheduled_date || '', required: true })),
      h('div', {}, h('label', { text: '担当者（店舗スタッフ）' }), h('select', { name: 'who' }, h('option', { value: '', text: '未定' }),
        ...members.map(p => h('option', { value: p.id, text: p.display_name, selected: p.id === r.assignee_id }))))),
    members.length ? null : h('div', { class: 'muted', style: 'margin-top:6px', text: 'この店舗に閲覧許可のあるスタッフがいません（管理画面で設定）。' }),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'submit', text: '予定を保存' }),
      r.scheduled_date ? h('button', { class: 'btn', type: 'button', text: '予定を外す', onclick: e => busy(e.target, () => saveRepair(r.id, { scheduled_date: null, assignee_id: null, assignee_name: '' })) }) : null));
  f.onsubmit = e => { e.preventDefault(); busy(f.querySelector('[type=submit]'), () => saveRepair(r.id, { scheduled_date: f.date.value, assignee_id: f.who.value || null, ...(f.who.value ? {} : { assignee_name: '' }) })) };
  return f;
}
function completeForm(r) {
  const f = h('form', { class: 'card' }, h('b', { text: '完了報告' }),
    h('div', { class: 'row' },
      h('div', {}, h('label', { text: '修理後の写真（必須）' }), h('input', { name: 'photo', type: 'file', accept: 'image/*', required: true })),
      h('div', {}, h('label', { text: '費用（円）' }), h('input', { name: 'cost', type: 'number', min: '0', step: '1', inputmode: 'numeric', required: true, placeholder: '0' }))),
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;margin-top:12px', text: '完了を報告する' }),
    h('div', { class: 'muted', style: 'margin-top:6px', text: '完了写真を登録した日が対応完了日になります。店舗のスタッフなら誰でも報告できます。' }));
  f.onsubmit = e => {
    e.preventDefault(); const file = f.photo.files[0]; if (!file) return;
    busy(f.querySelector('[type=submit]'), async () => {
      const path = await uploadPhoto(r.store_id, r.id, 'after', file);
      await saveRepair(r.id, { completion_photo_path: path, cost: Math.max(0, Math.round(+f.cost.value || 0)) });
      notifyLine(r.id, 'completed'); toast('完了を報告しました');
    });
  };
  return f;
}
function adminCaseActions(r) {
  return h('div', { class: 'row', style: 'margin-top:4px' },
    r.completed_at ? h('button', { class: 'btn', text: '完了を取り消す', onclick: e => { if (confirm('完了報告を取り消しますか？')) busy(e.target, () => saveRepair(r.id, { completion_photo_path: null, cost: null })) } }) : null,
    h('button', { class: 'btn danger', text: 'この案件を削除', onclick: e => { if (confirm('この修繕案件と写真を削除します。元に戻せません。よろしいですか？')) busy(e.target, async () => {
      const paths = [r.report_photo_path, r.completion_photo_path].filter(Boolean);
      must(await sb.from('repairs').delete().eq('id', r.id)); if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      $('dlg').close(); toast('削除しました'); await reloadRepairs();
    }) } }));
}

// ───────────── ダッシュボード（本社） ─────────────
function renderDashboard() {
  const pg = $('dashboardPage'), today = todayStr();
  const isRecentDone = r => r.completed_at && dayDiff(today, dateOf(r.completed_at)) <= 30;
  const rows = S.stores.map(s => {
    const list = S.repairs.filter(r => r.store_id === s.id && (!r.completed_at || isRecentDone(r)));
    const n = Object.fromEntries(ORDER.map(c => [c, list.filter(r => colorOf(r) === c).length]));
    return { s, n };
  }).sort((a, b) => b.n.red - a.n.red || b.n.yellow - a.n.yellow || b.n.blue - a.n.blue || a.s.sort - b.s.sort);
  const total = Object.fromEntries(ORDER.map(c => [c, rows.reduce((t, x) => t + x.n[c], 0)]));
  const late = rows.filter(x => x.n.red).length;
  put(pg, 
    h('h2', { text: 'ダッシュボード' }),
    h('div', { class: 'tiles' }, ...ORDER.map(c => h('div', { class: 'tile', style: `--c:var(--${c})` }, h('div', { class: 'muted', text: c === 'green' ? '完了（30日以内）' : COLORS[c].label }), h('div', { class: 'n', text: total[c] }))),
      h('div', { class: 'tile', style: '--c:var(--red)' }, h('div', { class: 'muted', text: '修繕遅れのある店舗' }), h('div', { class: 'n', text: `${late} / ${S.stores.length}` }))),
    h('div', { class: 'tableWrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: '店舗' }), h('th', { text: 'エリア' }), ...ORDER.map(c => h('th', { class: 'num' }, chip(c, c === 'green' ? '緑(30日)' : COLORS[c].name))), h('th', {}))),
      h('tbody', {}, ...rows.map(({ s, n }) => h('tr', { class: 'click', onclick: () => { selectStore(s.id); setView('model') } },
        h('td', {}, h('b', { text: s.name })), h('td', { class: 'muted', text: s.area }),
        ...ORDER.map(c => h('td', { class: 'num' }, h('span', { class: 'cnt ' + (n[c] ? 'on' : 'off'), style: `--c:var(--${c})`, text: n[c] }))),
        h('td', {}, h('button', { class: 'btn small', text: '一覧', onclick: e => { e.stopPropagation(); Object.assign(S.list, { store: s.id, color: 'open' }); setView('list') } }))))))),
    S.stores.length ? null : h('div', { class: 'card muted', style: 'margin-top:10px', text: '店舗が登録されていません。管理画面から追加してください。' }));
}

// ───────────── 修繕一覧 ─────────────
function renderList() {
  const pg = $('listPage'), F = S.list;
  const sel = (key, opts) => { const s = h('select', { onchange: e => { F[key] = e.target.value; renderList() } }, ...opts.map(([v, t]) => h('option', { value: v, text: t }))); s.value = F[key]; return s };
  const inp = (key, type) => h('input', { type, value: F[key], onchange: e => { F[key] = e.target.value; renderList() } });
  const people = S.profiles.filter(p => S.repairs.some(r => r.assignee_id === p.id));
  const dateOfField = r => F.dateField === 'reported' ? dateOf(r.reported_at) : F.dateField === 'scheduled' ? (r.scheduled_date || '') : dateOf(r.completed_at);
  let list = S.repairs.filter(r => (!F.store || r.store_id === F.store)
    && (F.color === '' || (F.color === 'open' ? !r.completed_at : colorOf(r) === F.color))
    && (!F.assignee || (F.assignee === '-' ? !r.assignee_id : r.assignee_id === F.assignee))
    && (!F.from || (dateOfField(r) && dateOfField(r) >= F.from)) && (!F.to || (dateOfField(r) && dateOfField(r) <= F.to)));
  const sorters = {
    priority: byPriority,
    reportedDesc: (a, b) => (b.reported_at > a.reported_at ? 1 : -1),
    reportedAsc: (a, b) => (a.reported_at > b.reported_at ? 1 : -1),
    scheduled: (a, b) => (a.scheduled_date || '9999') > (b.scheduled_date || '9999') ? 1 : -1,
    store: (a, b) => (store(a.store_id)?.sort ?? 0) - (store(b.store_id)?.sort ?? 0) || byPriority(a, b),
    cost: (a, b) => (b.cost ?? -1) - (a.cost ?? -1),
  };
  list.sort(sorters[F.sort] || byPriority);
  const totalCost = list.reduce((t, r) => t + (r.cost || 0), 0);
  put(pg, 
    h('h2', { text: '修繕一覧' }),
    h('div', { class: 'filters' },
      h('div', {}, h('label', { text: '店舗' }), sel('store', [['', 'すべての店舗'], ...S.stores.map(s => [s.id, s.name])])),
      h('div', {}, h('label', { text: '色' }), sel('color', [['open', '未完了すべて'], ['', 'すべて'], ...ORDER.map(c => [c, `${COLORS[c].name}：${COLORS[c].label}`])])),
      h('div', {}, h('label', { text: '担当者' }), sel('assignee', [['', 'すべて'], ['-', '未定'], ...people.map(p => [p.id, p.display_name])])),
      h('div', {}, h('label', { text: '期間の基準' }), sel('dateField', [['reported', '修繕依頼日'], ['scheduled', '対応予定日'], ['completed', '対応完了日']])),
      h('div', {}, h('label', { text: 'から' }), inp('from', 'date')), h('div', {}, h('label', { text: 'まで' }), inp('to', 'date')),
      h('div', {}, h('label', { text: '並び順' }), sel('sort', [['priority', '対応が必要な順'], ['reportedDesc', '依頼日が新しい順'], ['reportedAsc', '依頼日が古い順'], ['scheduled', '予定日が近い順'], ['store', '店舗順'], ['cost', '費用が高い順']]))),
    h('div', { class: 'muted', style: 'margin-bottom:8px', text: `${list.length}件${totalCost ? `　費用合計 ${yen(totalCost)}` : ''}` }),
    h('div', { class: 'tableWrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['状態', '店舗', '場所', '内容', '依頼日', '予定日', '担当者', '完了日', '費用'].map((t, i) => h('th', { class: i === 8 ? 'num' : '', text: t })))),
      h('tbody', {}, ...list.slice(0, 500).map(r => h('tr', { class: 'click', onclick: () => openCase(r.id) },
        h('td', {}, chip(colorOf(r), statusText(r))), h('td', { text: store(r.store_id)?.name || r.store_id }), h('td', { text: caseTitle(r) }),
        h('td', { text: r.note.length > 30 ? r.note.slice(0, 30) + '…' : r.note }), h('td', { text: fmtTs(r.reported_at) }), h('td', { text: fmtD(r.scheduled_date) }),
        h('td', { text: r.assignee_name || '—' }), h('td', { text: fmtTs(r.completed_at) }), h('td', { class: 'num', text: yen(r.cost) })))))),
    list.length > 500 ? h('div', { class: 'muted', style: 'margin-top:8px', text: '先頭500件を表示しています。絞り込んでください。' }) : null);
}

// ───────────── カレンダー（本社） ─────────────
function renderCalendar() {
  const pg = $('calendarPage'), C = S.cal, today = todayStr();
  const d0 = C.date, y = +d0.slice(0, 4), m = +d0.slice(5, 7);
  const startOfWeek = d => addDays(d, -new Date(d + 'T00:00:00Z').getUTCDay());
  let start, days;
  if (C.mode === 'month') { const first = `${y}-${String(m).padStart(2, '0')}-01`; start = startOfWeek(first); days = 42 } else { start = startOfWeek(d0); days = 7 }
  const end = addDays(start, days - 1);
  const evs = S.repairs.filter(r => r.scheduled_date && r.scheduled_date >= start && r.scheduled_date <= end
    && (!C.assignee || (C.assignee === '-' ? !r.assignee_id : r.assignee_id === C.assignee)) && (!C.store || r.store_id === C.store));
  const unscheduled = S.repairs.filter(r => !r.completed_at && !r.scheduled_date && (!C.store || r.store_id === C.store)).length;
  const move = n => { C.date = C.mode === 'month' ? `${m + n > 12 ? y + 1 : m + n < 1 ? y - 1 : y}-${String((m + n + 11) % 12 + 1).padStart(2, '0')}-01` : addDays(C.date, 7 * n); renderCalendar() };
  const people = S.profiles.filter(p => p.active);
  const title = C.mode === 'month' ? `${y}年${m}月` : `${fmtD(start)} 〜 ${fmtD(end)}`;
  const assigneeSel = h('select', { style: 'width:auto', onchange: e => { C.assignee = e.target.value; renderCalendar() } }, h('option', { value: '', text: '担当者：すべて' }), h('option', { value: '-', text: '担当者：未定' }), ...people.map(p => h('option', { value: p.id, text: p.display_name })));
  assigneeSel.value = C.assignee;
  const storeSel = h('select', { style: 'width:auto', onchange: e => { C.store = e.target.value; renderCalendar() } }, h('option', { value: '', text: 'すべての店舗' }), ...S.stores.map(s => h('option', { value: s.id, text: s.name })));
  storeSel.value = C.store;
  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i), other = C.mode === 'month' && +d.slice(5, 7) !== m;
    const list = evs.filter(r => r.scheduled_date === d).sort(byPriority);
    cells.push(h('div', { class: 'day' + (other ? ' other' : '') + (d === today ? ' today' : '') },
      h('span', { class: 'dnum', text: C.mode === 'week' ? `${+d.slice(5, 7)}/${+d.slice(8)}` : +d.slice(8) }),
      ...list.map(r => h('button', { class: 'ev', style: `--c:var(--${colorOf(r)})`, title: `${store(r.store_id)?.name}・${caseTitle(r)}・${r.assignee_name || '担当未定'}`, onclick: () => openCase(r.id),
        text: `${C.store ? '' : (store(r.store_id)?.name || '') + ' '}${caseTitle(r)}${C.mode === 'week' ? `（${r.assignee_name || '担当未定'}）` : ''}` }))));
  }
  put(pg, 
    h('h2', { text: 'カレンダー（対応予定日）' }),
    h('div', { class: 'calHead' },
      h('button', { class: 'btn small', text: '‹', onclick: () => move(-1) }), h('b', { text: title }), h('button', { class: 'btn small', text: '›', onclick: () => move(1) }),
      h('button', { class: 'btn small', text: '今日', onclick: () => { C.date = today; renderCalendar() } }),
      h('button', { class: 'btn small' + (C.mode === 'month' ? ' primary' : ''), text: '月', onclick: () => { C.mode = 'month'; renderCalendar() } }),
      h('button', { class: 'btn small' + (C.mode === 'week' ? ' primary' : ''), text: '週', onclick: () => { C.mode = 'week'; renderCalendar() } }),
      storeSel, assigneeSel),
    unscheduled ? h('div', { class: 'card', style: 'border-color:var(--yellow)' }, `予定日が未設定の修繕が ${unscheduled}件あります。`,
      h('button', { class: 'btn small', style: 'margin-left:8px', text: '一覧で見る', onclick: () => { Object.assign(S.list, { store: C.store, color: 'yellow' }); setView('list') } })) : null,
    h('div', { class: 'cal' + (C.mode === 'week' ? ' week' : '') }, ...['日', '月', '火', '水', '木', '金', '土'].map(t => h('div', { class: 'dow', text: t })), ...cells));
}

// ───────────── 管理画面（本社） ─────────────
function renderAdmin() {
  const pg = $('adminPage');
  const roleSel = p => { const s = h('select', { disabled: p.id === S.me.id, onchange: e => updateProfile(p.id, { role: e.target.value }) }, h('option', { value: 'staff', text: '店舗スタッフ' }), h('option', { value: 'admin', text: '本社管理者' })); s.value = p.role; return s };
  const users = [...S.profiles].sort((a, b) => (a.active === b.active ? 0 : a.active ? 1 : -1) || a.display_name.localeCompare(b.display_name, 'ja'));
  put(pg, 
    h('h2', { text: '管理' }),
    h('h3', { text: `スタッフ（${S.profiles.filter(p => p.active).length}人が有効）` }),
    h('div', { class: 'card muted' }, '新しいスタッフは、ログイン用アカウントを作成するとここに「無効」で表示されます。役割と閲覧できる店舗を設定して有効にしてください。',
      h('br'), 'LINEログイン導入までは、Supabase 管理画面の Authentication → Users → Add user でアカウントを作成します。'),
    h('div', { class: 'tableWrap', style: 'margin-bottom:24px' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['名前', 'メール', '役割', '有効', '閲覧できる店舗'].map(t => h('th', { text: t })))),
      h('tbody', {}, ...users.map(p => {
        const mine = S.members.filter(m => m.user_id === p.id).map(m => store(m.store_id)?.name).filter(Boolean);
        return h('tr', {},
          h('td', {}, h('input', { value: p.display_name, style: 'min-width:120px', onchange: e => updateProfile(p.id, { display_name: e.target.value.trim() }) })),
          h('td', { class: 'muted', text: p.email }),
          h('td', {}, roleSel(p)),
          h('td', {}, h('input', { type: 'checkbox', checked: p.active, disabled: p.id === S.me.id, onchange: e => updateProfile(p.id, { active: e.target.checked }) })),
          h('td', {}, p.role === 'admin' ? h('span', { class: 'muted', text: '全店舗' }) :
            h('button', { class: 'btn small', text: mine.length ? (mine.length > 2 ? `${mine.slice(0, 2).join('、')} ほか${mine.length - 2}店舗` : mine.join('、')) : '未設定', onclick: () => editAccess(p) })));
      })))),
    h('h3', { text: `店舗（${S.stores.length}店舗）` }),
    h('div', { class: 'tableWrap', style: 'margin-bottom:12px' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['ID', '店舗名', 'エリア', '並び順', 'LINEグループID', '建物'].map(t => h('th', { text: t })))),
      h('tbody', {}, ...S.stores.map(s => h('tr', {},
        h('td', { class: 'muted', text: s.id }),
        h('td', {}, h('input', { value: s.name, style: 'min-width:140px', onchange: e => updateStore(s.id, { name: e.target.value.trim() }) })),
        h('td', {}, h('input', { value: s.area, style: 'min-width:90px', onchange: e => updateStore(s.id, { area: e.target.value.trim() }) })),
        h('td', {}, h('input', { type: 'number', value: s.sort, style: 'width:70px', onchange: e => updateStore(s.id, { sort: +e.target.value || 0 }) })),
        h('td', {}, h('input', { value: s.line_group_id || '', placeholder: '未設定', style: 'min-width:140px', onchange: e => updateStore(s.id, { line_group_id: e.target.value.trim() || null }) })),
        h('td', {}, h('button', { class: 'btn small', text: buildingSummary(s.building), onclick: () => editBuilding(s) }))))))),
    addStoreForm());
}
function buildingSummary(b) { const x = { ...DEFAULT_BUILDING, ...(b || {}) }; return `${x.floors}階建て×${x.roomsPerFloor}室` }
async function updateProfile(id, patch) {
  await busy(null, async () => { must(await sb.from('profiles').update(patch).eq('id', id)); Object.assign(S.profiles.find(p => p.id === id), patch); toast('保存しました') });
  renderAdmin();
}
async function updateStore(id, patch) {
  await busy(null, async () => { must(await sb.from('stores').update(patch).eq('id', id)); Object.assign(store(id), patch); toast('保存しました') });
  selectStore(S.storeId, true);
}
function addStoreForm() {
  const f = h('form', { class: 'card' }, h('b', { text: '店舗を追加' }),
    h('div', { class: 'row' },
      h('div', {}, h('label', { text: 'ID（半角英数字とハイフン）' }), h('input', { name: 'sid', required: true, pattern: '[a-z0-9\\-]+', placeholder: '例：naha-01' })),
      h('div', {}, h('label', { text: '店舗名' }), h('input', { name: 'sname', required: true })),
      h('div', {}, h('label', { text: 'エリア' }), h('input', { name: 'sarea' }))),
    h('button', { class: 'btn primary', type: 'submit', style: 'margin-top:12px', text: '追加' }),
    h('div', { class: 'muted', style: 'margin-top:6px', text: '建物の形は、追加後に「建物」ボタンから設定します。' }));
  f.onsubmit = e => {
    e.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      const row = must(await sb.from('stores').insert({ id: f.sid.value.trim(), name: f.sname.value.trim(), area: f.sarea.value.trim(), sort: S.stores.length + 1, building: DEFAULT_BUILDING }).select().single());
      S.stores.push(row); toast('店舗を追加しました'); selectStore(S.storeId || row.id, true);
    });
  };
  return f;
}
function editAccess(p) {
  const have = new Set(S.members.filter(m => m.user_id === p.id).map(m => m.store_id));
  const boxes = S.stores.map(s => h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--text);font-size:14px' }, h('input', { type: 'checkbox', value: s.id, checked: have.has(s.id) }), s.name, h('span', { class: 'muted', text: s.area })));
  put($('dlgBody'), h('h2', { text: `${p.display_name} が見られる店舗` }),
    h('div', { class: 'muted', text: '自店舗に加え、許可した店舗も見られるようになります。' }), ...boxes,
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', text: 'キャンセル', onclick: () => $('dlg').close() }),
      h('button', { class: 'btn primary', text: '保存', onclick: e => busy(e.target, async () => {
        const want = new Set(boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value));
        const add = [...want].filter(x => !have.has(x)).map(store_id => ({ store_id, user_id: p.id })), del = [...have].filter(x => !want.has(x));
        if (add.length) must(await sb.from('store_members').insert(add));
        if (del.length) must(await sb.from('store_members').delete().eq('user_id', p.id).in('store_id', del));
        S.members = S.members.filter(m => m.user_id !== p.id).concat([...want].map(store_id => ({ store_id, user_id: p.id })));
        $('dlg').close(); toast('保存しました'); renderAdmin();
      }) })));
  $('dlg').showModal();
}
function editBuilding(s) {
  const b = { ...DEFAULT_BUILDING, ...(s.building || {}) };
  const f = h('form', {},
    h('h2', { text: `${s.name} の建物` }),
    h('div', { class: 'row' },
      h('div', {}, h('label', { text: '客室のある最下階' }), h('input', { name: 'firstFloor', type: 'number', min: '1', max: '20', value: b.firstFloor })),
      h('div', {}, h('label', { text: '客室のある階数' }), h('input', { name: 'floors', type: 'number', min: '1', max: '20', value: b.floors })),
      h('div', {}, h('label', { text: '各階の部屋数' }), h('input', { name: 'roomsPerFloor', type: 'number', min: '1', max: '30', value: b.roomsPerFloor }))),
    h('label', { text: 'タイプBの部屋（各階の部屋番号の下2桁。カンマ区切り。それ以外はタイプA）' }), h('input', { name: 'typeB', value: (b.roomTypes?.B || []).join(',') }),
    h('label', { text: '共用部（カンマ区切り）' }), h('input', { name: 'commonAreas', value: (b.commonAreas || []).join(',') }),
    h('label', { style: 'display:flex;gap:8px;align-items:center' }, h('input', { name: 'interiors', type: 'checkbox', checked: !!b.interiors }), '室内3D（タイプA・Bの内装モデル）を表示する'),
    h('div', { class: 'muted', style: 'margin-top:8px', text: '屋上・駐車場・外壁・廊下・エントランスは3Dモデル上でもタップできます。それ以外の共用部は一覧のボタンから選びます。' }),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: () => $('dlg').close() }), h('button', { class: 'btn primary', type: 'submit', text: '保存' })));
  f.onsubmit = e => {
    e.preventDefault();
    const nums = v => v.split(/[,、\s]+/).map(Number).filter(n => n > 0);
    const building = { ...b, firstFloor: +f.firstFloor.value || 2, floors: +f.floors.value || 1, roomsPerFloor: +f.roomsPerFloor.value || 1,
      roomTypes: { B: nums(f.typeB.value) }, defaultType: 'A', interiors: f.interiors.checked,
      commonAreas: f.commonAreas.value.split(/[,、]+/).map(x => x.trim()).filter(Boolean) };
    busy(f.querySelector('[type=submit]'), async () => { await updateStore(s.id, { building }); $('dlg').close(); renderAdmin() });
  };
  put($('dlgBody'), f); $('dlg').showModal();
}

// ───────────── 起動 ─────────────
$('dlg').addEventListener('close', () => put($('dlgBody')));
buildBuilding(null);
loop();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
