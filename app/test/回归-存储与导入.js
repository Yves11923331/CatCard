#!/usr/bin/env node
'use strict';

// 用法：node app/test/回归-存储与导入.js（零 npm 依赖）
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextDecoder } = require('node:util');

const MAIN = 'moka.decks.v1';
const BAK = MAIN + '.bak';
const FALLBACK = 'moka.img.ls.';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xuoAAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const tick = () => new Promise(resolve => setImmediate(resolve));

function makeStorage() {
  const disk = new Map([[MAIN, '[]']]);
  return {
    rejectWrite: () => false,
    get length() { return disk.size; },
    key(i) { return [...disk.keys()][i] ?? null; },
    getItem(key) { return disk.get(key) ?? null; },
    setItem(key, value) {
      if (this.rejectWrite(key)) {
        throw Object.assign(new Error('模拟配额失败: ' + key), { name: 'QuotaExceededError' });
      }
      disk.set(key, String(value));
    },
    removeItem(key) { disk.delete(key); }
  };
}

// 请求成功不改变持久数据。允许暂停在 request.onsuccess 之后，决定事务提交或回滚。
// 只模拟源文件使用的 IDB 子集；每次 open 都建新连接，但共享已提交的数据。
function makeIdb() {
  const disk = new Map();
  const pending = [];
  const fake = {
    disk,
    pending,
    verdict: 'complete', // null = 暂停写事务
    release(verdict) {
      fake.verdict = verdict;
      pending.splice(0).forEach(finish => setImmediate(() => finish(verdict)));
    },
    open() {
      const request = {};
      setImmediate(() => {
        request.result = { transaction, close() {} };
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  };
  function transaction(_name, mode) {
    const changes = [];
    let outstanding = 0;
    function finish(verdict) {
      if (verdict === 'complete') changes.forEach(apply => apply());
      else tx.error = Object.assign(new Error('模拟事务回滚'), { name: 'AbortError' });
      tx['on' + verdict]?.({ target: tx });
    }
    function write(change) {
      assert.equal(mode, 'readwrite');
      const request = {};
      changes.push(change);
      outstanding++;
      setImmediate(() => {
        request.onsuccess?.({ target: request });
        if (--outstanding !== 0) return;
        if (fake.verdict === null) pending.push(finish);
        else setImmediate(() => finish(fake.verdict));
      });
      return request;
    }
    const tx = {
      objectStore() {
        return {
          put(value, key) { return write(() => disk.set(key, value)); },
          delete(key) { return write(() => disk.delete(key)); },
          get(key) {
            const request = {};
            setImmediate(() => {
              request.result = disk.get(key);
              request.onsuccess?.({ target: request });
            });
            return request;
          },
          openCursor() {
            const request = {};
            const entries = [...disk];
            let i = 0;
            function next() {
              setImmediate(() => {
                const entry = entries[i++];
                request.result = entry ? { key: entry[0], value: entry[1], continue: next } : null;
                request.onsuccess?.({ target: request });
              });
            }
            next();
            return request;
          }
        };
      }
    };
    return tx;
  }
  return fake;
}

const sources = ['idb.js', 'random.js', 'data.js', 'io.js'].map(name => {
  const filename = path.join(__dirname, '..', 'www', 'js', name);
  return new vm.Script(fs.readFileSync(filename, 'utf8'), { filename });
});

async function boot(storage, idb, payload) {
  const toasts = [];
  const confirms = [];
  const toastSnapshots = [];
  const w = vm.createContext({
    localStorage: storage,
    indexedDB: idb,
    // 忽略故意触发的配额错误日志；测试自身的断言会输出完整栈。
    console: { ...console, error() {} },
    crypto: webcrypto,
    TextDecoder,
    atob: value => Buffer.from(value, 'base64').toString('latin1'),
    setTimeout, clearTimeout,
    // 原生选择器立刻 done，只需模拟一次轮询，不等待真实的 500 ms。
    setInterval: setImmediate,
    clearInterval: clearImmediate,
    LotFile: {
      pickImport: () => true,
      getImportStatus: () => 'done',
      getImportBinaryBase64: () => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    },
    MoKa: { ui: {
      toast(message) {
        toasts.push(String(message));
        toastSnapshots.push({ meta: storage.getItem(MAIN), images: new Map(idb?.disk) });
      },
      confirmDialog(options) { confirms.push(options); return Promise.resolve(true); }
    } }
  });
  w.window = w;
  sources.forEach(script => script.runInContext(w));
  const { data, images, io } = w.MoKa;
  await data.ready();
  await data.flushPersist();
  return { data, images, io, toasts, confirms, toastSnapshots };
}

const deck = (name, image = PNG) => ({ name, cards: [{ name: '测试卡', image }] });
const readMeta = storage => JSON.parse(storage.getItem(MAIN));
const successToast = /^(已导入|已追加|已加入)/;

function assertStoredImage(storage, idb, deckId, image, backend, cardIndex = 0) {
  const row = readMeta(storage).find(d => d.id === deckId);
  assert.ok(row, '主元数据应含已提交的牌组');
  const marker = row.cards[cardIndex].image;
  assert.match(marker, backend === 'idb' ? /^idb:.+/ : /^ls:.+/);
  const actual = backend === 'idb' ? idb.disk.get(marker.slice(4)) : storage.getItem(FALLBACK + marker.slice(3));
  assert.equal(actual, image, '主元数据引用应指向已提交的原图');
  return marker;
}

async function waitFor(predicate, reason) {
  // 每轮可执行所有队列中的微任务；上限防止回归造成无限等待。
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(reason);
}

async function testTransactions() {
  for (const operation of ['set', 'remove']) {
    for (const verdict of ['abort', 'complete']) {
      const idb = makeIdb();
      if (operation === 'remove') idb.disk.set('test', PNG);
      const { images } = await boot(makeStorage(), idb);
      idb.verdict = null;
      let settled = false;
      const result = Promise.resolve(images[operation]('test', PNG)).then(value => { settled = true; return value; });
      await waitFor(() => idb.pending.length === 1, '写事务未到达 request success');
      await tick();
      assert.equal(settled, false, `${operation}: request success 时不能提前返回`);
      assert.equal(idb.disk.has('test'), operation === 'remove', '事务结束前不能更改已提交数据');
      idb.release(verdict);
      assert.equal(await result, verdict === 'complete', `${operation}: ${verdict} 的返回值`);
      assert.equal(idb.disk.has('test'), (operation === 'set') === (verdict === 'complete'));
    }
  }
}

async function testReimport(backend) {
  const storage = makeStorage();
  const idb = backend === 'idb' ? makeIdb() : undefined;
  const { data } = await boot(storage, idb);
  const input = deck('重导回归');
  const first = data.importDeck(input);
  assert.equal((await data.flushPersist()).ok, true);
  const oldMarker = assertStoredImage(storage, idb, first.id, PNG, backend);

  assert.equal(data.deleteDeck(first.id), true);
  assert.equal((await data.flushPersist()).ok, true);
  assert.equal(readMeta(storage).length, 0);
  const remaining = backend === 'idb' ? idb.disk.get(oldMarker.slice(4)) : storage.getItem(FALLBACK + oldMarker.slice(3));
  assert.equal(remaining ?? null, null, '成功删除后应清除孤儿图片');

  const same = data.importDeck(input); // 同一会话重导完全相同的 data URL
  const saved = await data.flushPersist();
  assert.equal(saved.ok, true);
  assert.equal(saved.unresolvedImgs, 0);
  assertStoredImage(storage, idb, same.id, PNG, backend);
  storage.removeItem(BAK); // 不能靠备份补图掩盖悬空引用
  const reopened = await boot(storage, idb);
  assert.equal(reopened.data.findDeck(same.id).cards[0].image, PNG, '新会话应从图片库加载原图');
}

async function testFailedMetaGc(backend) {
  const storage = makeStorage();
  const idb = backend === 'idb' ? makeIdb() : undefined;
  const { data } = await boot(storage, idb);
  const kept = data.importDeck(deck('写失败前的牌组'));
  assert.equal((await data.flushPersist()).ok, true);
  const before = storage.getItem(MAIN);
  const marker = assertStoredImage(storage, idb, kept.id, PNG, backend);

  let rejected = 0;
  storage.rejectWrite = key => key === MAIN && ++rejected > 0;
  assert.equal(data.deleteDeck(kept.id), true);
  const failed = await data.flushPersist();
  assert.ok(rejected > 0, '测试应命中主元数据写入');
  assert.equal(failed.ok, false);
  assert.equal(failed.metaOk, false);
  assert.equal(storage.getItem(MAIN), before, '落盘失败时主记录仍为旧快照');
  assert.equal(assertStoredImage(storage, idb, kept.id, PNG, backend), marker, 'GC 不得删除旧主记录仍引用的图片');

  storage.removeItem(BAK);
  const reopened = await boot(storage, idb);
  assert.equal(reopened.data.findDeck(kept.id).cards[0].image, PNG);
}

async function testImport(route, outcome) {
  const storage = makeStorage();
  const idb = makeIdb();
  const incoming = [deck('导入一'), deck('导入二', GIF)];
  if (route === 'append') incoming[0].backImage = GIF; // 追加卡牌和套用牌背是两次保存
  const payload = route === 'multi'
    ? { app: 'moka', kind: 'moka-decks-v1', decks: incoming }
    : { app: 'moka', kind: 'moka-deck-v1', deck: incoming[0] };
  const { data, io, toasts, confirms, toastSnapshots } = await boot(storage, idb, payload);
  let target;
  if (route === 'append') {
    target = data.createDeck('待追加');
    data.addCard(target.id, { name: '原牌' });
    await data.flushPersist();
  }
  const before = storage.getItem(MAIN);
  storage.rejectWrite = key => outcome === 'meta' ? key === MAIN : outcome === 'image' && key.startsWith(FALLBACK);
  idb.verdict = null;

  io.importTo(target?.id);
  await waitFor(() => idb.pending.length > 0, '导入没有走到图片事务');
  await tick();
  assert.equal(storage.getItem(MAIN), before, '图片事务未结束时不应提交新主记录');
  assert.deepEqual(toasts, [], '事务未结束时不得提前提示导入结果');
  assert.equal(confirms.length, route === 'new' ? 0 : 1);
  idb.release(outcome === 'image' ? 'abort' : 'complete');
  await waitFor(() => toasts.length > 0, '落盘结束后未提示导入结果');
  const saved = await data.flushPersist();

  if (outcome !== 'success') {
    assert.ok(!toasts.some(message => successToast.test(message)), `失败不可提示成功：${toasts.join(' / ')}`);
    assert.ok(toasts.some(message => /失败|未.*保存|没.*存|可能回退/.test(message)), '应提示未完全保存');
    if (outcome === 'meta') {
      assert.equal(saved.metaOk, false);
      assert.equal(storage.getItem(MAIN), before);
    } else {
      assert.ok(!saved.ok || saved.unresolvedImgs > 0, '图存不下必须反映在落盘结果中');
    }
    return;
  }

  assert.equal(saved.ok, true);
  assert.equal(saved.unresolvedImgs, 0);
  assert.equal(toasts.filter(message => successToast.test(message)).length, 1);
  const toastIndex = toasts.findIndex(message => successToast.test(message));
  const atSuccess = toastSnapshots[toastIndex];
  assert.equal(atSuccess.meta, storage.getItem(MAIN), '提示成功时所有导入变更必须已经落盘');
  assert.deepEqual(atSuccess.images, idb.disk, '提示成功时图库也必须已提交');
  const rows = readMeta(storage);
  assert.equal(rows.length, route === 'multi' ? 2 : 1);
  assertStoredImage(storage, idb, rows[0].id, PNG, 'idb', route === 'append' ? 1 : 0);
  if (route === 'append') {
    assert.equal(rows[0].id, target.id);
    assert.equal(rows[0].cards[0].name, '原牌');
    assert.match(rows[0].backImage, /^idb:.+/);
    assert.equal(idb.disk.get(rows[0].backImage.slice(4)), GIF);
  } else if (route === 'multi') {
    assertStoredImage(storage, idb, rows[1].id, GIF, 'idb');
  }
}

const cases = [
  ['IDB 请求成功不等于事务提交（写入及删除）', testTransactions],
  ...['idb', 'ls'].flatMap(backend => [
    [`${backend}：删除后同会话重导相同图片并重开`, () => testReimport(backend)],
    [`${backend}：主元数据写失败，GC 保留旧引用`, () => testFailedMetaGc(backend)]
  ]),
  ...[['new', '单组新建'], ['append', '单组追加'], ['multi', '多组导入']].flatMap(([route, title]) =>
    [['success', '成功'], ['meta', '主元数据写失败'], ['image', '图片写失败']].map(([outcome, label]) =>
      [`${title}：等待落盘，${label}`, () => testImport(route, outcome)]))
];

(async function main() {
  let failed = 0;
  for (const [name, run] of cases) {
    let timer;
    try {
      await Promise.race([run(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('用例等待超时')), 5000);
      })]);
      console.log('通过：' + name);
    } catch (error) {
      failed++;
      console.error('失败：' + name + '\n' + (error.stack || error));
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`通过 ${cases.length - failed}/${cases.length}`);
  if (failed) process.exitCode = 1;
})();
