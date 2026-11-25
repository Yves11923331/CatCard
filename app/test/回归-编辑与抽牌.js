/* 用法：node app/test/回归-编辑与抽牌.js（需要 jsdom，同项目无头走查） */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function jsdom() {
  for (const name of ['jsdom', '/tmp/jt/node_modules/jsdom', '/root/dsh-dom/node_modules/jsdom']) {
    try { return require(name); }
    catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new Error('找不到 jsdom；请用 NODE_PATH 指向已安装 jsdom 的 node_modules');
}
const { JSDOM } = jsdom();
const www = process.env.WWW || path.join(__dirname, '..', 'www');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const draftKey = 'catcard.editor.draft.v1';

function fixture() {
  const dom = new JSDOM(fs.readFileSync(path.join(www, 'index.html'), 'utf8'), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', e => errors.push(e.error || e.message));
  ['idb', 'builtin-decks', 'random', 'data', 'ui', 'scenes/table', 'scenes/library', 'scenes/editor'].forEach(file => {
    w.eval(fs.readFileSync(path.join(www, 'js', file + '.js'), 'utf8'));
  });
  const { data: D, ui: UI, editor: E, table: T, library: L } = w.MoKa;
  const card = (id, name, extra) => D.withCardStyle({ id, name, keyword: '', meaning: '', ...extra });
  const a = { id: 'deck-a', name: '甲组', cards: [
    card('a1', '库内原名', { image: 'preview.jpg', imageHi: 'hi.jpg' }), card('a2', '甲二'), card('a3', '甲三')
  ] };
  const b = { id: 'deck-b', name: '乙组', cards: [card('a1', '乙一'), card('b2', '乙二')] };
  D.replaceDecks([a, b]);
  D.setAllOnTable(true);
  D.setActiveDeckId(a.id);
  w.localStorage.setItem(T._pullTutKey, '1');
  L.init(); E.init(); T.init();
  const choices = [];
  const dialogs = [];
  UI.confirmDialog = opts => {
    dialogs.push(opts.title);
    assert.ok(choices.length, '意外出现确认框：' + opts.title);
    return Promise.resolve(choices.shift());
  };
  return { dom, w, D, T, E, a, b, card, choices, dialogs, errors };
}

async function editor({ w, D, E, a, choices, dialogs }) {
  const q = sel => w.document.querySelector(sel);
  const click = sel => q(sel).click();
  const stored = () => JSON.parse(w.localStorage.getItem(draftKey));
  const put = (name, image = 'preview.jpg') => w.localStorage.setItem(draftKey, JSON.stringify({
    deckId: a.id, cardId: 'a1', draft: { ...D.findDeck(a.id).cards[0], name, image, imageHi: null }
  }));
  function typeName(value, blur = true) {
    const input = q('#ed-name');
    input.focus();
    input.value = value;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    if (blur) input.blur();
  }

  put('被拒绝的草稿');
  choices.push(false);
  await E.open(a.id, 'a1');
  assert.equal(dialogs.at(-1), '恢复上次未保存的编辑？');
  assert.equal(stored(), null);
  assert.equal(q('#ed-name').value, '库内原名');
  assert.equal(E._dirty(), false);
  typeName('新草稿', false);
  await wait(560);
  assert.equal(stored().draft.name, '新草稿', '拒绝恢复后，同一编辑页仍应自动保存新输入');
  q('#ed-name').blur();

  choices.push(true);
  await E.open(a.id, 'a1');
  assert.equal(q('#ed-name').value, '新草稿');
  assert.equal(E._dirty(), true);
  assert.equal(E._draft().imageHi, 'hi.jpg', '仅恢复文字不应丢掉原有高清图');
  choices.push(false);
  await E.back();
  assert.equal(dialogs.at(-1), '有未保存的修改');
  assert.ok(q('#lib-editor').classList.contains('is-active'));
  typeName('库内原名');
  assert.equal(E._dirty(), false, 'dirty 应与库内内容比较，而不是与恢复内容比较');
  click('#ed-undo');
  assert.equal(E._dirty(), true);
  click('#ed-redo');
  assert.equal(E._dirty(), false);
  await E.back();
  await wait(560);
  assert.equal(stored(), null, '干净退出后，不能留下旧草稿或让迟到的写盘复活它');

  put('库内原名');
  choices.push(true);
  await E.open(a.id, 'a1');
  assert.equal(E._dirty(), false, '恢复与原卡相同的旧草稿不产生未保存警告');
  await E.back();
  assert.equal(stored(), null);

  put('尚未存库', 'different.jpg');
  choices.push(true);
  await E.open(a.id, 'a1');
  assert.equal(E._draft().imageHi, null, '换过预览图的草稿不能错配原图的高清版本');
  typeName('放弃此次改动', false);
  choices.push(true);
  await E.back();
  await wait(560);
  assert.equal(stored(), null, '主动不保存仍取消挂起的写盘');

  await E.open(a.id);
  typeName('新建草稿');
  await wait(560);
  assert.equal(stored().cardId, null);
  choices.push(true);
  await E.open(a.id);
  assert.equal(E._dirty(), true, '新卡恢复应与空白新卡的基线比较');
  typeName('存成新卡');
  click('#ed-save');
  await wait(560);
  assert.equal(stored(), null, '完成保存仍取消挂起的写盘');
  assert.ok(D.findDeck(a.id).cards.some(c => c.name === '存成新卡'));

  // 批量样式作为单个跨卡历史命令；当前卡内容和样式不属于该命令。
  D.updateCard(a.id, 'a1', { nameVy: 31, faceBg: '#ffffff' });
  D.updateCard(a.id, 'a2', { nameVy: 22, faceBg: '#eeeeee' });
  await D.flushPersist();
  await E.open(a.id, 'a1');
  const face = q('#ed-card .tcard-face');
  const image = q('#ed-card .fc-img img');
  const styleCell = q('#ed-bgstyle .ed-bgcell');
  typeName('<新卡名>', false);
  assert.equal(q('#ed-card .fc-name').textContent, '<新卡名>');
  assert.equal(q('#ed-card .tcard-face'), face, '输入不替换牌面');
  assert.equal(q('#ed-card .fc-img img'), image, '输入不重建图片图层');
  await wait(150);
  assert.equal(q('#ed-bgstyle .ed-bgcell'), styleCell, '预览刷新保留样式按钮');
  q('#ed-name').blur();
  click('#ed-grab');
  await wait(300);
  assert.equal(E._dock().level, 'full');
  click('#ed-img-adjust');
  assert.equal(E._dock().level, 'half', '铺满时调图会回到画布');
  assert.equal(E._imgMode(), true);
  click('#ed-img-done');
  await wait(300);
  const initialCards = D.findDeck(a.id).cards.map(c => ({ id: c.id, name: c.name, keyword: c.keyword,
    meaning: c.meaning, image: c.image, nameVy: c.nameVy, faceBg: c.faceBg }));
  typeName('未保存的当前名字');
  const edited = E._draft();
  edited.nameVy = 31;
  edited.faceBg = '#ffffff';
  choices.push(true);
  q('#ed-theme-all').click();
  await wait(20);
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a2').nameVy, 31);
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a2').faceBg, '#ffffff');
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a1').name, '库内原名', '批量应用不提交当前卡未保存内容');
  click('#ed-undo');
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a2').nameVy, initialCards.find(c => c.id === 'a2').nameVy);
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a2').faceBg, initialCards.find(c => c.id === 'a2').faceBg);
  click('#ed-redo');
  assert.equal(D.findDeck(a.id).cards.find(c => c.id === 'a2').nameVy, 31, '跨卡重做恢复样式');
  assert.equal(E._draft().name, '未保存的当前名字', '跨卡撤销重做不覆盖当前编辑草稿');
  await wait(560);
  assert.ok(stored(), '当前卡未保存草稿仍保留');
  choices.push(true);
  await E.back();
  await wait(560);
  assert.equal(stored(), null);

  // 目标卡在编辑期间被删除时，不能清草稿或误报已保存。
  const recreated = D.addCard(a.id, { name: '恢复测试卡', keyword: '', meaning: '' });
  await D.flushPersist();
  await E.open(a.id, recreated.id);
  typeName('卡片被删除后的改动', false);
  D.deleteCard(a.id, recreated.id);
  click('#ed-save');
  await wait(20);
  await wait(560);
  assert.ok(stored(), '目标不存在时保留草稿');
  assert.ok(q('#lib-editor').classList.contains('is-active'), '保存失败仍留在编辑器');
  assert.ok(!dialogs.includes('这张卡还是空白'), '已有卡不能被误判成空白新卡');
}

async function table({ w, D, T, a, b, card, choices, dialogs }) {
  const q = sel => w.document.querySelector(sel);
  const clickPile = id => q(`.pile-item[data-id="${id}"]`).click();
  const deckState = id => T.snapshot_().piles.find(p => p.deckId === id);
  const drawIds = id => Array.from(deckState(id).drawnIds);
  const traySlots = () => Array.from(q('#tray-grid').children, el => el.dataset.id || null);
  T.openTable();
  T.trayOpen_();
  q('#tray-grid .tray-card[data-id="a1"]').click();
  const afterDraw = traySlots();
  const firstCard = q('#desk-canvas .tcard');
  T.trayClose();
  clickPile(b.id);
  assert.equal(T.snapshot_().tableCards, 1, '切到另一堆不能自动抽牌');
  clickPile(b.id);
  const bDrawn = drawIds(b.id);
  assert.equal(bDrawn.length, 1);
  D.setOnTable(a.id, false);
  assert.equal(deckState(a.id), undefined);
  D.setAllOnTable(false);
  assert.equal(T.snapshot_().tableCards, 2, '撤下最后一副牌组也不能清桌');
  D.setOnTable(a.id, true);
  T.openTable();
  assert.deepEqual(drawIds(a.id), ['a1']);
  assert.equal(q('#desk-canvas .tcard'), firstCard, '桌上牌的 DOM 及位置应保持');
  assert.equal(q('#tray-btn-count').textContent, '2');
  D.setOnTable(b.id, true);
  assert.deepEqual(drawIds(b.id), bDrawn, '另一堆也恢复各自的抽牌记录，卡 ID 重名时不串堆');
  D.setOnTable(b.id, false);
  T.trayOpen_();
  assert.deepEqual(traySlots(), afterDraw, '重新上桌保留原来的洗牌及空槽位置');
  T.trayClose();
  clickPile(a.id);
  assert.equal(drawIds(a.id).length, 2);
  assert.notEqual(drawIds(a.id)[1], 'a1', '随机抽不能重复抽到已抽走的卡');

  // 撤下时用同样张数替换卡，缺失 ID 必须清掉、未删除的已抽卡必须保留。
  const retained = drawIds(a.id)[1];
  D.setOnTable(a.id, false);
  const decks = D.exportDecks();
  const cards = decks.find(d => d.id === a.id).cards;
  cards[cards.findIndex(c => c.id === 'a1')] = card('replacement', '新甲一');
  D.replaceDecks(decks);
  D.setOnTable(a.id, true);
  assert.deepEqual(drawIds(a.id), [retained]);
  assert.equal(T.snapshot_().tableCards, 3, '编辑牌库不收回已发出的实体牌');

  choices.push(false);
  T.resetSession(true);
  await Promise.resolve();
  assert.equal(dialogs.at(-1), '重新开始？');
  assert.equal(T.snapshot_().tableCards, 3, '取消重来保留桌面和进度');
  choices.push(true);
  T.resetSession(true);
  await Promise.resolve();
  assert.equal(T.snapshot_().tableCards, 0);
  assert.deepEqual(drawIds(a.id), []);
  D.setOnTable(b.id, true);
  assert.deepEqual(drawIds(b.id), [], '重来要清除暂时撤下的牌堆进度');
}

(async function main() {
  for (const check of [editor, table]) {
    const f = fixture();
    try {
      await check(f);
      assert.deepEqual(f.errors, [], '无头页面不应报未捕获异常');
      assert.deepEqual(f.choices, [], '确认选择应已全部被消费');
    } finally { f.dom.window.close(); }
  }
  console.log('编辑器草稿与主占卜桌回归通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
