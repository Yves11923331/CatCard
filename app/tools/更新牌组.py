#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 内置牌组 **更新**（把手机上改好的那副，同步回工程里的内置源）

与 `内置牌组.py` 分工（两条流程，别混）：
  · `内置牌组.py`  = 牌组的**增 / 删 / 下架**（新加一副、整副不要了）
  · 本脚本         = **已进包的那副换内容**：牌面图、出厂牌面样式、文案、色号
流程说明在 `decks/01-必读-内置牌组更新流程.md`。

用法
----
  python3 tools/更新牌组.py <key> <导出.zip|解开后的目录> [--检查] [--确认]

  <key>    内置牌组的 key（= decks/<key>/deck.json）
  <源>     App 里「牌库 → 导出」得到的那份 zip（也可传解开后的目录，要含 manifest.json）
  --检查   只比对：工程里是否已经和这份 zip 一致（构建前 / 接手时用），不写一个字
  --确认   真的写。**不带就是 dry-run**（只打印计划）

它同步五样（都以**卡名**对齐，不靠顺序）
---------------------------------------
  ① 牌面图  → decks/<key>/faces/ + www/assets/deckimg/<key>/（原字节，**绝不重编码**）
              卡的 image 写成外置相对路径；多张卡用同一张图时**只落一份**（按内容去重）
  ② 出厂样式 → deck.json 的 `cardStyle`（STYLE_KEYS 全量，来自 `data.js` 的常量，不手抄）
              老装机靠 `data.js: applyBuiltinCardStyle` 的 fxStamp 机制自动刷
  ③ 文案     → 卡片的 name/keyword/meaning/faceText/symbol/sym
  ④ 色号     → 卡片的 color（导出包里是 '#rrggbb'，内置源要的是 PALETTE 下标）
  ⑤ 牌组级纸边 → deck.json 的 `backEdge`（牌背纸边）/ `faceEdge`（牌面纸边）
              导出包的 `deck` 里有这两个字段就同步（缺省 = 开）。它们是**牌组级**设定，
              不是卡片的 faceEdge —— 同名不同层，别混（卡级那个在 STYLE_KEYS 里，跟着 ② 走）。
              老装机靠 `data.js: applyBuiltinDeckFlags` 的 edgeStamp 机制自动迁移。
              ★ 2026-11-17：用户导出包把两副都关了纸边（backEdge/faceEdge = false），
                这两个字段以前工具**根本不看**，于是"手机上关了、内置源还开着"。

不碰的：牌组名 / order / back / retiredNames / note / manual 等牌组级设定 ——
那些属于"牌组身份"，改动请走 `内置牌组.py` 那条流程或手改。
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # app/
DECKS = os.path.join(BASE, 'decks')
DATA_JS = os.path.join(BASE, 'www', 'js', 'data.js')
ASSET_PREFIX = 'assets/deckimg/'          # ★ 必须与 io.js 的 DECK_ASSET_PREFIX 一致
IMG_EXT = ('.jpg', '.jpeg', '.png', '.webp')
CONTENT_KEYS = ('name', 'keyword', 'meaning', 'faceText', 'symbol', 'sym')
# ★ 牌组级纸边：导出包 deck 里有就同步（缺省 = 开）。与卡级 faceEdge（STYLE_KEYS 里那个）同名不同层。
DECK_EDGE_KEYS = ('backEdge', 'faceEdge')

RED, GRN, YEL, DIM, RST = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'
WARN = []


def say(m=''):
    print(m)


def red(m):
    print(RED + m + RST)


def ok(m):
    print(GRN + m + RST)


def warn(m):
    print(YEL + m + RST)


def dim(m):
    print(DIM + m + RST)


def die(m):
    for w in WARN:
        warn('⚠ ' + w)
    red('✗ ' + m)
    sys.exit(1)


# ---------------------------------------------------------------- 从代码里取常量

def constants():
    """STYLE_KEYS / PALETTE 都从 `data.js` 现读 —— 手抄一份必然过期（项目的老规矩）。"""
    js = open(DATA_JS, encoding='utf-8').read()
    m = re.search(r'STYLE_KEYS\s*=\s*\[(.*?)\]', js, re.S)
    if not m:
        die('从 data.js 里找不到 STYLE_KEYS —— 它改名字了？')
    style_keys = re.findall(r"'([^']+)'", m.group(1))
    m = re.search(r'PALETTE\s*=\s*\[(.*?)\]', js)
    if not m:
        die('从 data.js 里找不到 PALETTE —— 它改名字了？')
    palette = re.findall(r"'(#[0-9a-fA-F]{3,8})'", m.group(1))
    if not style_keys or not palette:
        die('STYLE_KEYS / PALETTE 解析出来是空的（data.js 的写法变了？）')
    return style_keys, palette


# ---------------------------------------------------------------- 基础

def sha(b):
    return hashlib.sha256(b).hexdigest()


def human(n):
    for u in ('B', 'KB', 'MB'):
        if n < 1024 or u == 'MB':
            return ('%d B' % n) if u == 'B' else ('%.1f %s' % (n, u))
        n /= 1024.0


def deck_path(key):
    return os.path.join(DECKS, key, 'deck.json')


def faces_dir(key):
    return os.path.join(DECKS, key, 'faces')


def asset_dir(key):
    return os.path.join(BASE, 'www', 'assets', 'deckimg', key)


def back_refs(key):
    """`decks/<key>/back.svg` 里引用的进包资源（外置牌背图，如 assets/deckimg/overflow/_back.jpg）。

    ★ 2026-10-17 补的：保留集原来只认**卡面图**（zip 带的 / 随包的 / 卡引用着的），
      牌背图 `_back.jpg` 三条都不占 —— 于是下一次带图的 `--确认` 会把它当"不再用的旧图"
      连源图一起删掉，牌背当场成空。hero / overflow 都在这个雷区上。
      判据取 back.svg 自己写了什么（和卡面图一样，"谁引用它"才最根本），不写死文件名。
    """
    p = os.path.join(DECKS, key, 'back.svg')
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding='utf-8') as f:
            txt = f.read()
    except (OSError, UnicodeDecodeError):
        return []
    # 路径相对 www/ 解析（与 ui.js 里 background-image / <image href> 同一先例）
    return sorted(set(re.findall(r'assets/deckimg/[^"\'\s>]+', txt)))


def read_deck(key):
    p = deck_path(key)
    if not os.path.exists(p):
        die('没有这副内置牌组：decks/%s/deck.json' % key)
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def write_deck(key, deck):
    p = deck_path(key)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(deck, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, p)


# ---------------------------------------------------------------- 读导出包

class Export(object):
    """App 导出的那份 zip（或解开的目录）：按需取 manifest 与图片字节。"""

    def __init__(self, src):
        if not os.path.exists(src):
            die('源不存在：%s' % src)
        self.zip = None
        if os.path.isdir(src):
            self.base = src
            self._read_dir()
        elif src.lower().endswith('.zip'):
            self.zip = zipfile.ZipFile(src)
            self._read_zip()
        else:
            die('源要么是 .zip，要么是解开后的目录：%s' % src)

    def _read_zip(self):
        try:
            self.manifest = json.loads(self.zip.read('manifest.json').decode('utf-8'))
        except KeyError:
            die('这份 zip 里没有 manifest.json —— 不是猫卡导出的牌组包？')
        except Exception as e:
            die('manifest.json 读不了：%s' % e)

    def _read_dir(self):
        p = os.path.join(self.base, 'manifest.json')
        if not os.path.exists(p):
            die('目录里没有 manifest.json —— 请传 App 导出的那份 zip：%s' % self.base)
        with open(p, encoding='utf-8') as f:
            self.manifest = json.load(f)

    def image_bytes(self, path):
        if not path:
            return None
        if self.zip:
            try:
                return self.zip.read(path)
            except KeyError:
                die('manifest 说图在 %s，zip 里却没有' % path)
        p = os.path.join(self.base, path)
        if not os.path.exists(p):
            die('manifest 说图在 %s，目录里却没有' % path)
        with open(p, 'rb') as f:
            return f.read()


def load_export(src):
    e = Export(src)
    man = e.manifest
    if man.get('kind') != 'moka-deck-v1' or not isinstance(man.get('deck'), dict):
        die('这不是「单副牌组」的导出包（kind=%s）。多副的整库备份请逐副导出再更新。' % man.get('kind'))
    dk = man['deck']
    if not isinstance(dk.get('cards'), list) or not dk['cards']:
        die('导出包里没有卡')
    return e, dk


# ---------------------------------------------------------------- 算变更

def apply_rename(deck, renames):
    """`--改名 旧=新`：把**内置源**的卡名就地改成新名（对齐与落盘一步到位）。

    为什么要有它：卡一改名，"按卡名对齐"立刻变成"少一张 + 多一张"，工具会拦下来（这是对的）——
    但拦完得有条路走。`retiredNames` 管的是"下线"，管不了"同一个角色换了个名字"，
    所以改名必须**显式声明**（工具不猜），旧名再由 cmd_update 记进 retiredNames。"""
    if not renames:
        return 0
    n = 0
    for c in deck.get('cards', []):
        if c.get('name') in renames:
            c['name'] = renames[c['name']]
            n += 1
    return n


def align(deck, src_deck):
    """按**卡名**把两边对齐。多一张少一张都要人来看 —— 本工具不加卡、不删卡。"""
    mine = {c.get('name'): c for c in deck['cards']}
    theirs = {c.get('name'): c for c in src_deck['cards']}
    add = [n for n in theirs if n not in mine]
    gone = [n for n in mine if n not in theirs]
    if add or gone:
        WARN.append('两边卡名对不上 —— 导出包多出：%s ／ 内置源多出：%s\n'
                    '     · 只是**改名**：加参数 `--改名 旧名=新名`（可重复；旧名会自动记进 retiredNames，'
                    '老装机才不会新旧并存）\n'
                    '     · 真的**加卡 / 删卡**：走 00-必读 那套流程，本工具不动'
                    % ('、'.join(map(str, add)) or '无', '、'.join(map(str, gone)) or '无'))
    pairs = [(mine[n], theirs[n]) for n in mine if n in theirs]
    if not pairs:
        die('按卡名一张都对不上 —— 是不是传错了牌组？')
    return pairs


def plan_edges(deck, src_deck):
    """牌组级纸边（backEdge / faceEdge）：导出包的 deck 里有才同步。返回 [(字段, 现值, 目标值)]。

    ★ 缺省语义：内置源里没写这个字段 = true（开）—— 与 scenes/table.js、library.js 里
      `deck.backEdge !== false` 同一口径。所以"现值"要把 None 归一成 True，否则
      未写 → 写 false 会被当成"没有变化"，纸边永远关不掉。"""
    out = []
    for k in DECK_EDGE_KEYS:
        if k not in src_deck:
            continue                       # 老导出包没有这个字段 → 不动（别凭空写 true）
        want = src_deck.get(k)
        if not isinstance(want, bool):
            WARN.append('导出包的 deck.%s 不是 true/false（%r）—— 跳过不写' % (k, want))
            continue
        cur = deck.get(k)
        cur_n = True if cur is None else bool(cur)
        if k not in deck or cur_n != want:
            out.append((k, (None if k not in deck else cur), want))
    return out


def plan(key, deck, exp, src_deck, style_keys, palette):
    pairs = align(deck, src_deck)
    edges = plan_edges(deck, src_deck)

    # ---- 图片：按内容去重（几卡共用一张图 → 只落一份文件）
    #   导出包里没图的卡**一律不动它** —— 这样"一张图给全副用"的牌组自洽：
    #   下次导出照样只有第一张卡带 imagePath，其余卡保持指向同一个路径，不会被清空。
    img_plan = []            # [(卡名, 目标文件名, 字节, sha)] —— 本次带进 zip 的图
    keep = []                # [(卡名, 外置路径)] —— 图随包走，**不在 zip 里**
    idx_of = {c.get('name'): i for i, c in enumerate(deck.get('cards', []))}
    keep_changed = []
    seen = {}
    for i, (mine, theirs) in enumerate(pairs):
        path = theirs.get('imagePath')
        if not path:
            continue                       # 这张卡在导出包里没图 → 内置源现状不动
                # 外置资源路径（assets/deckimg/…）：与 io.js 的 makeZipPut / hydrateZip 对称 ——
        # 原样保留路径，绝不去 zip 里找字节（那儿没有它）。
        if path.startswith(ASSET_PREFIX):
            keep.append((mine.get('name'), path))
            if mine.get('image') != path:
                keep_changed.append((mine.get('name'), mine.get('image'), path))
            continue
        b = exp.image_bytes(path)
        if b is None:
            continue
        h = sha(b)
        if h in seen:
            img_plan.append((mine.get('name'), seen[h], None, h))
            continue
        ext = os.path.splitext(path or '')[1].lower()
        if ext not in IMG_EXT:
            ext = '.jpg'
        # ★ 文件名按"这张卡在**内置源**里的序号"，**不是**对齐后的下标 ——
        #   一旦有卡改名 / 缺卡，对齐下标就错位，图会写到别人的文件名上（把别人的图覆盖掉）。
        name = '%0*d%s' % (max(2, len(str(len(deck['cards'])))), idx_of.get(mine.get('name'), i) + 1, ext)
        seen[h] = name
        img_plan.append((mine.get('name'), name, b, h))

    # ---- 样式：所有卡的 STYLE_KEYS 取出来，一致才写 deck 级 cardStyle
    styles = [tuple((k, theirs.get(k)) for k in style_keys) for _m, theirs in pairs]
    same_style = all(s == styles[0] for s in styles)
    # ★ 2026-10-17：导出包里值为 null 的样式字段（faceBg / nameColor / kwColor）在
    #   内置源里历来是**省略不写**的，两者运行时等价；进 plan 时统一剔掉，免得
    #   ① `--检查` 拿整字典比 → 明明一致却报红；② `--确认` 往 deck.json 里塞进一堆 null。
    card_style = ({k: v for k, v in styles[0] if v is not None} if same_style else None)
    if not same_style:
        # 列出到底哪几张不一样，交给人工
        base = styles[0]
        for (m, _t), st in zip(pairs, styles):
            d = [k for (k, v), (k2, v2) in zip(base, st) if v != v2]
            if d:
                WARN.append('卡「%s」的样式与第一张不同：%s' % (m.get('name'), '、'.join(d)))
        WARN.append('这套牌样式**不统一**，cardStyle 没法一次写定 —— 手工决定写哪版，或逐张写卡级字段')

    # ---- 文案 / 色号
    text_plan, color_plan = [], []
    for mine, theirs in pairs:
        for k in CONTENT_KEYS:
            if k == 'name':
                continue
            a, b = mine.get(k), theirs.get(k)
            if a in (None, '') and b in (None, ''):
                continue
            if a != b:
                text_plan.append((mine.get('name'), k, a, b))
        a, b = mine.get('color'), theirs.get('color')
        if isinstance(b, str) and b.startswith('#'):
            if b.lower() in [c.lower() for c in palette]:
                idx = [c.lower() for c in palette].index(b.lower())
            else:
                WARN.append('卡「%s」的色 %s 不在调色板里（内置源只能写下标 0~%d）' % (mine.get('name'), b, len(palette) - 1))
                continue
        elif isinstance(b, int):
            idx = b
        else:
            continue
        if a != idx:
            color_plan.append((mine.get('name'), a, idx))

    # ---- 牌背：本工具不同步自定义牌背图，只说一声
    #   ★ 2026-10-17：分两种说。牌背已经由 back.svg 接成外置图了（hero / overflow 都是），
    #     再叫人"去放图并改 back.svg"是废话，该说的是"换哪一份文件"。
    if src_deck.get('backImagePath'):
        refs = back_refs(key)
        wired = bool(refs) and all(os.path.exists(os.path.join(BASE, 'www', r)) for r in refs)
        if wired:
            WARN.append('这副牌在手机上用了**自定义牌背图**（%s）—— 牌背已由 decks/%s/back.svg 接成外置图（%s），'
                        '本工具不碰它；要换牌背就替换那份文件的字节'
                        % (src_deck['backImagePath'], key, '、'.join(os.path.basename(r) for r in refs)))
        else:
            WARN.append('这副牌在手机上用了**自定义牌背图**（%s）—— 本工具不同步牌背，'
                        '要换请按 00-必读 §12 把图放进 decks/%s/ 并改 back.svg' % (src_deck['backImagePath'], key))

    return {
        'pairs': pairs, 'images': img_plan, 'keep': keep, 'keep_changed': keep_changed,
        'card_style': card_style, 'text': text_plan, 'color': color_plan, 'same_style': same_style,
        'edges': edges,
    }


def report(key, deck, pl, verbose=True):
    """把计划打印成人能核对的样子；返回"到底有没有变化"。"""
    say('牌组：%s（%s）· 卡 %d 张' % (deck.get('name'), key, len(deck['cards'])))
    files = {}
    for cname, tname, b, h in pl['images']:
        files.setdefault(tname, (cname, b, h))
    say('  ① 牌面图：%d 张卡 → 更新 %d 个文件%s' % (
        len(pl['pairs']), len(files),
        ('，另有 %d 张沿用随包的外置图（图不在 zip 里，路径原样保留）' % len(pl['keep'])) if pl['keep'] else ''))
    for cname, old, new in pl['keep_changed']:
        say('      ⚠ %s 的 image 原本是 %s → 改成 %s' % (cname, repr(old)[:40], new))
    changed_img = 0
    for tname, (cname, b, h) in sorted(files.items()):
        p = os.path.join(asset_dir(key), tname)
        state = '新' if not os.path.exists(p) else ('不变' if sha(open(p, 'rb').read()) == h else '换')
        if state != '不变':
            changed_img += 1
        if verbose or state != '不变':
            say('      %s  %s  %s%s' % (tname, state, human(len(b)), DIM + '（' + cname + ('…等' if len(files) < len(pl['images']) else '') + '）' + RST))
    share = len(pl['images']) - len(files)
    if share:
        dim('      （%d 张卡共用同一张图，按内容去重 → 只落 %d 份文件）' % (len(pl['images']), len(files)))

    say('  ② 出厂样式 cardStyle：%s' % ('%d 个字段' % len(pl['card_style']) if pl['card_style'] else '⚠ 不统一，跳过'))
    style_diff = {}
    if pl['card_style']:
        old = deck.get('cardStyle') or {}
        diff = style_diff = {k: (old.get(k), v) for k, v in pl['card_style'].items() if old.get(k) != v}
        if diff:
            for k, (a, b) in sorted(diff.items()):
                say('      %s: %s → %s' % (k, repr(a), repr(b)))
        else:
            dim('      与内置源一致')

    say('  ③ 文案：%d 处%s' % (len(pl['text']), '' if pl['text'] else '（一致）'))
    for cname, k, a, b in pl['text']:
        say('      %s · %s: %s → %s' % (cname, k, repr(a)[:40], repr(b)[:40]))
    say('  ④ 色号：%d 张%s' % (len(pl['color']), '' if pl['color'] else '（一致）'))
    for cname, a, b in pl['color'][:6]:
        say('      %s: %s → %s' % (cname, a, b))
    if len(pl['color']) > 6:
        dim('      …还有 %d 张' % (len(pl['color']) - 6))
    # ★ 牌组级纸边（2026-11-17）：导出包 deck 里有 backEdge / faceEdge 就同步
    ed = pl.get('edges') or []
    say('  ⑤ 牌组级纸边：%s' % (('%d 处' % len(ed)) if ed else '（一致）'))
    for k, a, b in ed:
        say('      %s: %s → %s' % (k, '未写（默认开）' if a is None else repr(a), repr(b)))
    # ★ 判"要不要写"看的是**差**，不是"有没有值" —— 样式与内置源一致时不该算 dirty（否则每次干跑都说"有变化"）
    return bool(changed_img or style_diff or pl['text'] or pl['color'] or pl['keep_changed'] or ed)


# ---------------------------------------------------------------- 写入

def cmd_update(key, src, confirm, renames=None):
    style_keys, palette = constants()
    deck = read_deck(key)
    exp, src_deck = load_export(src)
    renamed = apply_rename(deck, renames)
    pl = plan(key, deck, exp, src_deck, style_keys, palette)
    if renamed:
        say('改名 %d 张：%s' % (renamed, '、'.join('%s → %s' % (o, n) for o, n in (renames or {}).items())))
    dirty = report(key, deck, pl)

    if not dirty:
        ok('✓ 工程里的这副牌已经和导出包一致，不用改')
        for w in WARN:
            warn('⚠ ' + w)
        return
    if not confirm:
        warn('这是 dry-run（没动任何文件）。确认无误加 --确认。')
        for w in WARN:
            warn('⚠ ' + w)
        return

    f_dir, a_dir = faces_dir(key), asset_dir(key)
    os.makedirs(f_dir, exist_ok=True)
    os.makedirs(a_dir, exist_ok=True)

    # 保留集 = ①本次带进 zip 的图 ＋ ②**随包的外置图**（keep）＋ ③**deck 里还被任何卡引用的**。
    # ③ 是最根本的判据：只要还有卡指着它，就不许删。
    #    ★ 2026-10-12 真踩过：这里一开始只有 ①，于是"只换了 4 张图"的那次更新，
    #      把另外 13 张还在用的图**连着源图一起删了**（deck 里 13 张卡当场白牌）——
    #      幸好原始导出包还在，逐字节恢复。**这条保留集不许再瘦身。**
    keep = set(n for _c, n, _b, _h in pl['images'])
    keep |= {os.path.basename(str(path)) for _c, path in pl['keep']}
    keep |= {os.path.basename(str(c.get('image') or '')) for c in deck.get('cards', [])}
    # ④ 牌背：back.svg 引用着的进包资源也属于"还用着"（2026-10-17 补，见 back_refs 的说明）。
    keep |= {os.path.basename(p) for p in back_refs(key)}
    for d in (f_dir, a_dir):
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if os.path.isfile(p) and f not in keep:
                os.remove(p)
                say('  清掉不再用的旧图 %s' % os.path.relpath(p, BASE))

    written = 0
    for cname, tname, b, h in pl['images']:
        if b is None:
            continue
        for d in (f_dir, a_dir):
            p = os.path.join(d, tname)
            if os.path.exists(p) and sha(open(p, 'rb').read()) == h:
                continue
            with open(p, 'wb') as f:
                f.write(b)                    # ★ 原字节，不重编码
            written += 1
        card = next(c for c in deck['cards'] if c.get('name') == cname)
        card['image'] = ASSET_PREFIX + key + '/' + tname

    for cname, path in pl['keep']:                  # 随包的外置图：只把路径指过去（幂等）
        next(c for c in deck['cards'] if c.get('name') == cname)['image'] = path
    if renames:
        ret = deck.get('retiredNames')
        if not isinstance(ret, list):
            ret = []
        for old in renames:
            if old not in ret:
                ret.append(old)
        deck['retiredNames'] = ret
        say('  旧卡名记进 retiredNames（老装机才会把它们下线，不会新旧并存）：%s' % '、'.join(renames))
    if pl['card_style']:
        deck['cardStyle'] = pl['card_style']
    for k, _a, b in pl['edges']:                 # ★ 牌组级纸边（2026-11-17）：导出包有就写
        deck[k] = b
    for cname, k, _a, b in pl['text']:
        next(c for c in deck['cards'] if c.get('name') == cname)[k] = b
    for cname, _a, b in pl['color']:
        next(c for c in deck['cards'] if c.get('name') == cname)['color'] = b

    write_deck(key, deck)
    reg = os.path.join(BASE, 'www', 'js', 'builtin-decks.js')
    reg_size = os.path.getsize(reg) if os.path.exists(reg) else 0
    ok('✓ 已更新 %s：写了 %d 个字节日志，deck.json %s' % (
        key, written, human(os.path.getsize(deck_path(key)))))
    say('  ★ 下一步：python3 tools/内置牌组.py 校验 && 生成，然后跑走查（见 01-必读）')
    say('  ★ 注册表现在 %s%s（超过 3 MB 就是在内嵌）'
        % (human(reg_size), ' ⚠' if reg_size > 3 * 1024 * 1024 else ''))
    for w in WARN:
        warn('⚠ ' + w)


def cmd_check(key, src, renames=None):
    """只比对：工程里是否已经和这份 zip 一致。（构建前 / 接手时用）"""
    style_keys, palette = constants()
    deck = read_deck(key)
    exp, src_deck = load_export(src)
    apply_rename(deck, renames)          # 只改内存里的副本，不落盘
    pl = plan(key, deck, exp, src_deck, style_keys, palette)
    f_dir, a_dir = faces_dir(key), asset_dir(key)
    bad = 0

    seen = {}
    for cname, tname, b, h in pl['images']:
        for d in (f_dir, a_dir):
            p = os.path.join(d, tname)
            if not os.path.exists(p):
                red('✗ 缺文件 %s' % os.path.relpath(p, BASE))
                bad += 1
            elif sha(open(p, 'rb').read()) != h:
                red('✗ 与导出包不一致 %s' % os.path.relpath(p, BASE))
                bad += 1
        card = next(c for c in deck['cards'] if c.get('name') == cname)
        want = ASSET_PREFIX + key + '/' + tname
        if card.get('image') != want:
            red('✗ 卡「%s」的 image 不是 %s（现在是 %s）' % (cname, want, repr(card.get('image'))[:50]))
            bad += 1
    # deck 里每张卡引用的**外置图**，磁盘上必须真的在 —— 这条是 2026-10-12 那次"清理旧图
    # 把 13 张还在用的图连源图一起删了"的教训：删错了要**当场红**，别等手机上白牌才发现。
    miss = []
    for card in deck.get('cards', []):
        img = str(card.get('image') or '')
        if img.startswith(ASSET_PREFIX) and not os.path.exists(os.path.join(BASE, 'www', img)):
            miss.append('%s → %s' % (card.get('name'), img))
    if miss:
        red('✗ deck 里还有 %d 张卡指着的图不在磁盘上：%s' % (len(miss), '；'.join(miss[:4])))
        bad += 1
    # ★ 2026-10-17：牌背图同理。它是 back.svg 引用的、但不是任何一张卡的图 ——
    #   图上一次被"清理旧图"删掉时，这条能在 --检查 就当场红，而不是等用户看见空牌背。
    for rel in back_refs(key):
        if not os.path.exists(os.path.join(BASE, 'www', rel)):
            red('✗ 牌背引用的图不在磁盘上：www/%s' % rel)
            bad += 1
    # ★ 2026-10-21：deck.json 的 cardStyle 会显式写 faceBg/nameColor/kwColor: null，
    #   plan 侧已剔除 null —— 这里也要剔，否则 --检查 永远误报（构建 271 加卡时踩到）。
    if pl['card_style'] and {k: v for k, v in (deck.get('cardStyle') or {}).items() if v is not None} != pl['card_style']:
        red('✗ deck.json 的 cardStyle 与导出包不一致')
        bad += 1
    for cname, k, _a, b in pl['text']:
        red('✗ 卡「%s」的 %s 没跟上（应改成 %s）' % (cname, k, repr(b)[:40]))
        bad += 1
    for cname, _a, b in pl['color']:
        red('✗ 卡「%s」的 color 没跟上（应改成 %s）' % (cname, b))
        bad += 1
    # ★ 牌组级纸边（2026-11-17）：导出包关了纸边、内置源还开着 → 当场红
    for k, a, b in pl['edges']:
        red('✗ deck.json 的 %s 没跟上（现在是 %s，应改成 %s）'
            % (k, '未写（默认开）' if a is None else repr(a), repr(b)))
        bad += 1

    if bad:
        die('检查没过：%d 处不一致' % bad)
    ok('✓ 检查过了：%s 与导出包一致（图 %d 张卡 / 样式 / 文案 / 色号 / 牌组级纸边）' % (key, len(pl['images'])))
    for w in WARN:
        warn('⚠ ' + w)


def main(argv):
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('key', nargs='?')
    ap.add_argument('src', nargs='?')
    ap.add_argument('--检查', dest='check', action='store_true')
    ap.add_argument('--确认', dest='confirm', action='store_true')
    ap.add_argument('--改名', dest='renames', action='append', default=[], metavar='旧名=新名',
                    help='卡改名：--改名 旧名=新名（可重复；旧名会自动记进 retiredNames）')
    ap.add_argument('-h', '--help', action='store_true')
    a = ap.parse_args(argv[1:])
    if a.help or not a.key or not a.src:
        say(__doc__)
        return 0
    renames = {}
    for r in a.renames:
        if '=' not in r:
            die('--改名 要写成 旧名=新名：%s' % r)
        old, new = r.split('=', 1)
        renames[old.strip()] = new.strip()
    if a.check:
        cmd_check(a.key, a.src, renames)
    else:
        cmd_update(a.key, a.src, a.confirm, renames)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
