#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 内置牌组工具（校验 / 生成 / 新增 / 清单）

一句话：**内置牌组的内容只写在 `app/decks/*.json` 里**，
        跑一条命令生成 `app/www/js/builtin-decks.js`（注册表），data.js 只读注册表。

用法（都在 `app/` 这一层跑，或者用绝对路径）：
    python3 app/tools/内置牌组.py 清单                 # 看现在内置了哪几副
    python3 app/tools/内置牌组.py 校验                 # 校验 decks/*.json + 生成物是不是最新
    python3 app/tools/内置牌组.py 生成                 # decks/*.json → www/js/builtin-decks.js
    python3 app/tools/内置牌组.py 生成 --检查          # 只比对不写（CI / 构建前用）
    python3 app/tools/内置牌组.py 新增 <key> [名字]    # 造一份骨架 + 打印六步清单
    python3 app/tools/内置牌组.py 下架 <key>           # 软下架：只写进 decks/不打包.txt（文件都留着）
    python3 app/tools/内置牌组.py 上架 <key>           # 撤销下架：删掉不打包.txt 里那一行
    python3 app/tools/内置牌组.py 删除 <key>           # ★ 先看清单（dry-run），不动任何文件
    python3 app/tools/内置牌组.py 删除 <key> --确认     # 真删（不可逆：不留备份）

固定动作（改完内置牌组）：生成 → 校验 → 走查 → 构建。完整流程见 `app/decks/00-必读-内置牌组增删流程.md`。
"""
import json
import os
import re
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # app/
DECKS = os.path.join(BASE, 'decks')
WWW = os.path.join(BASE, 'www')
GEN = os.path.join(WWW, 'js', 'builtin-decks.js')
CSS_GEN = os.path.join(WWW, 'css', 'builtin-decks.css')
DATA_JS = os.path.join(WWW, 'js', 'data.js')
UI_JS = os.path.join(WWW, 'js', 'ui.js')
LIB_JS = os.path.join(WWW, 'js', 'scenes', 'library.js')
INDEX = os.path.join(WWW, 'index.html')
TESTS = os.path.join(BASE, 'test')
TOOLS = os.path.join(BASE, 'tools')
CSS_DIR = os.path.join(WWW, 'css')
DECKS_README = os.path.join(DECKS, '00-必读-内置牌组增删流程.md')
# ★ 2026-10-12：项目记录拆成两页（`项目记录.md` 速查卡 + `变更日志.md` 历史）。
#   删/下架一副牌时，要看的是「还有哪儿的文档提到这副牌」—— 两页都得扫，只扫入口页会漏。
RECORD_FILES = [os.path.join(os.path.dirname(BASE), n) for n in ('项目记录.md', '变更日志.md')]
TEST_FILES = [
    os.path.join(TESTS, '走查-占卜桌选牌台.js'),
    os.path.join(TESTS, '走查-壳层与丢图.js'),
    os.path.join(TESTS, '走查-内置牌组.js'),
]
FORMAT = 1
FIELDS = ['name', 'keyword', 'symbol', 'sym', 'faceText', 'meaning', 'color', 'art', 'band', 'face',
          'kwWrap2', 'styleKey', 'image', 'oldNames']   # ★ 加卡片字段时这里也要加（红线第 6 条：字段要一次列全四处）
# ★ 2026-11-06：新增卡级 oldNames —— 内置卡**原地改名**用（老装机位置不动），
#   与「牌组级 oldNames」（整副改名）同名不同层，别混。

problems = []      # [(文件, 问题描述)]
NOT_PACKED_FILE = os.path.join(DECKS, '不打包.txt')


def not_packed():
    """app/decks/不打包.txt 里列出的 key：**不进这个包**（别的会话在做的牌组）。
    只影响"生成注册表/进包"，不校验、不修改那些 JSON。"""
    if not os.path.exists(NOT_PACKED_FILE):
        return set()
    keys = set()
    for ln in read(NOT_PACKED_FILE).splitlines():
        ln = ln.split('#')[0].strip()
        if ln:
            keys.add(ln)
    return keys


def err(where, msg):
    problems.append((where, msg))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def load_decks():
    """读 decks/*/deck.json（每副牌组一个目录），按 order 排。返回 [(deck.json路径, dict)]。
    ★ 专属资源（back.svg / symbols.json / style.css / checks.json）都在同一个目录里。"""
    out = []
    for dn in sorted(os.listdir(DECKS)):
        d = os.path.join(DECKS, dn)
        if not os.path.isdir(d):
            continue
        p = os.path.join(d, 'deck.json')
        if not os.path.exists(p):
            continue
        try:
            out.append((p, json.loads(read(p))))
        except Exception as e:
            err(dn, 'deck.json 读不了：%s' % e)
    out.sort(key=lambda x: (x[1].get('order') if isinstance(x[1].get('order'), int) else 999, x[0]))
    return out


def js(s):
    """Python 字符串 → JS 字符串字面量（顺带躲开 U+2028/U+2029 这两个会断行的字符）"""
    return (json.dumps(s, ensure_ascii=False)
            .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))


def symbol_tables():
    """各牌组的符号表：{deck_key: set(ids)}（从 decks/<key>/symbols.json 读）"""
    tables = {}
    for path, d in load_decks():
        k = d.get('key') if isinstance(d, dict) else None
        if not isinstance(k, str):
            continue
        sp = os.path.join(os.path.dirname(path), 'symbols.json')
        if not os.path.exists(sp):
            continue
        try:
            tables[k] = set(json.loads(read(sp)).keys())
        except Exception as e:
            err(os.path.basename(os.path.dirname(sp)), 'symbols.json 读不了：%s' % e)
    return tables


def palette():
    m = re.search(r'const PALETTE = \[(.*?)\];', read(DATA_JS), re.S)
    if not m:
        err('data.js', '找不到 PALETTE')
        return []
    return re.findall(r"'(#[0-9a-fA-F]{3,8})'", m.group(1))


def back_templates():
    """library.js 的 BACK_TPL：{id: builtin?}（id 为 None 的那项是「无边框」）"""
    src = read(LIB_JS)
    m = re.search(r'const BACK_TPL = \[(.*?)\n  \];', src, re.S)
    if not m:
        err('library.js', '找不到 BACK_TPL')
        return {}
    out = {}
    for item in re.finditer(r"\{\s*id:\s*(null|'([a-z0-9_\-]+)')[^}]*?(builtin:\s*true)?\s*\}", m.group(1)):
        raw, ident, builtin = item.group(1), item.group(2), item.group(3)
        out[None if raw == 'null' else ident] = bool(builtin)
    return out


def js_sources():
    """www/js 下所有手写的 js（生成物 builtin-decks.js 不算 —— 它会被重生成）。"""
    out = []
    for dp, dn, fns in os.walk(os.path.join(WWW, 'js')):
        for fn in sorted(fns):
            if fn.endswith('.js') and fn != 'builtin-decks.js':
                out.append(os.path.join(dp, fn))
    return sorted(out)


def hard_key_refs():
    """代码里按 key 硬找牌组的地方：`builtinKey === 'x'` 里的 x。
    ★ 这是"删了牌组、功能静静坏掉"的头号来源（周易桌就是按 'zy64' 找牌的）。"""
    out = set()
    pat = re.compile(r"builtinKey\s*===\s*'([a-z0-9_\-]+)'")
    for p in js_sources():
        for m in pat.finditer(read(p)):
            out.add(m.group(1))
    return out


def validate():
    """校验所有 decks/*.json。返回值：(牌组列表, 是否通过)"""
    decks = load_decks()
    syms = symbol_tables()
    pal = palette()
    tpls = back_templates()
    if not decks:
        err('decks/', '一副内置牌组都没有')
    skipped = [d.get('name') for _, d in decks if isinstance(d, dict) and d.get('key') in not_packed()]
    if skipped:
        print('（按「不打包.txt」排除，不进这个包：%s）' % '、'.join(skipped))
    keys, names, orders, old_names, card_names = {}, {}, {}, {}, {}
    for path, d in decks:
        fn = os.path.basename(path)
        if not isinstance(d, dict):
            err(fn, '内容不是一个对象')
            continue
        # ★ 2026-09-21：**排除了的牌组不再逐项校验**。
        #   为什么：不打包.txt 存在的意义就是"别的会话在做的、还不完整的东西别卡住这边的构建"。
        #   以前只打印一句"排除"、检查照做 —— 隔壁刚写进 decks/ 的「易经牌组」牌背模板还没接线，
        #   校验就红在它身上，构建前置检查直接把这边拦死（出构建 46 时踩到的）。
        #   排除 = 不进注册表、不进包、**也不参与任何校验**（它进包时把那一行删掉，自然就校验了）。
        if d.get('key') in not_packed():
            continue
        if d.get('format') != FORMAT:
            err(fn, 'format 必须是 %d' % FORMAT)
        key = d.get('key')
        if not isinstance(key, str) or not re.fullmatch(r'[a-z][a-z0-9_\-]*', key or ''):
            err(fn, 'key 必须是小写字母开头的英文/数字/下划线（现在：%r）' % key)
        elif key in keys:
            err(fn, 'key「%s」和 %s 撞了' % (key, keys[key]))
        else:
            keys[key] = fn
        name = d.get('name')
        if not isinstance(name, str) or not name.strip():
            err(fn, 'name 不能为空')
        elif name in names:
            err(fn, '名字「%s」和 %s 撞了' % (name, names[name]))
        else:
            names[name] = fn
        order = d.get('order')
        if not isinstance(order, int) or order < 0:
            err(fn, 'order 必须是 ≥0 的整数（越小越靠前）')
        elif order in orders:
            err(fn, 'order %d 和 %s 撞了（内置牌组之间的先后要唯一）' % (order, orders[order]))
        else:
            orders[order] = fn
        if not isinstance(d.get('onTable'), bool):
            err(fn, 'onTable 必须是 true/false（新装机要不要默认上占卜桌）')
        if not isinstance(d.get('seed'), bool):
            err(fn, 'seed 必须是 true/false（**新装机**要不要建这副。默认那副写 false —— '
                    '用户 2026-09-20 说星语牌组是"试用的"，新装机不再建；老装机上已有的不动）')
        if not isinstance(d.get('addIfMissing'), bool):
            err(fn, 'addIfMissing 必须是 true/false（老装机上缺了这副牌，要不要自动补上。'
                    '默认那副写 false —— 用户自己删了就别再塞回去；后来补的那副写 true，见 §54）')
        # ★ 2026-11-17：**牌组级纸边**（backEdge 牌背 / faceEdge 牌面）。不写 = 开（默认值），
        #   写了就必须是 true/false —— 写 "false" 字符串会让 data.js 的 `!== false` 判成"开"，
        #   手机上看着"我明明关了"，查半天。字符串一律当场红。
        for k in ('backEdge', 'faceEdge'):
            if k in d and not isinstance(d.get(k), bool):
                err(fn, '%s 必须是 true/false（牌组级纸边；不写 = 开。现在：%r）' % (k, d.get(k)))
        setname = d.get('symbols')
        if setname not in ('star', 'none'):
            err(fn, "symbols 只能是 star / none（psyche 那套 2026-10-06 随牌组删了；现在：%r）" % setname)
        olds = d.get('oldNames')
        if not isinstance(olds, list) or any(not isinstance(x, str) or not x.strip() for x in olds):
            err(fn, 'oldNames 必须是字符串数组（没有就写 []）')
            olds = []
        for o in olds:
            if o == name:
                err(fn, 'oldNames 里的「%s」和现在的名字一样，没必要写' % o)
            if o in old_names:
                err(fn, 'oldName「%s」和 %s 撞了' % (o, old_names[o]))
            old_names[o] = fn
        back = d.get('back')
        if not isinstance(back, dict):
            err(fn, 'back 必须是 {template, color}')
            back = {}
        tpl = back.get('template')
        has_back_svg = os.path.exists(os.path.join(os.path.dirname(path), 'back.svg'))
        if tpl is not None and tpl not in tpls and not has_back_svg:
            err(fn, 'back.template「%s」既不是通用模板（library.js 的 BACK_TPL）、又没有 back.svg —— '
                    '内置牌背必须配 decks/%s/back.svg' % (tpl, key))
        color = back.get('color')
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color or ''):
            err(fn, 'back.color 必须是 #rrggbb 形式（现在：%r）' % color)
        cards = d.get('cards')
        if not isinstance(cards, list) or not cards:
            err(fn, 'cards 不能为空')
            continue
        # ★ 2026-09-28：**keyword 允许整副为空**（用户：我没有加关键词）。
        # ★★ 2026-10-05 再放宽：**允许只有一部分卡有关键词** ——
        #   有牌组的牌面设计是「太长的名字切一半当关键词」（理智化 → 牌面「理智化」＋关键词「过度反省」），
        #   短名不切、自然没有关键词 ⇒ 混合是设计，不再是漏填。
        #   仍要求每张卡的 keyword 是字符串（空串 = 这张牌不画关键词层）。

        seen_sym, seen_card = {}, {}
        for i, c in enumerate(cards):
            at = '第 %d 张卡' % (i + 1)
            if not isinstance(c, dict):
                err(fn, '%s 不是一个对象' % at)
                continue
            for f in ('name', 'keyword', 'meaning'):
                if not isinstance(c.get(f), str):
                    err(fn, '%s 的 %s 要是字符串（现在是 %r）' % (at, f, c.get(f)))
            if not (c.get('name') or '').strip():
                err(fn, '%s 的 name 不能为空' % at)
            if not (c.get('meaning') or '').strip():
                err(fn, '%s 的 meaning 不能为空' % at)
            
            # faceText（牌面句）**可以没有**：它现在的作用是"当牌义的第一段索引"，
            # 要是它跟正文重复（阻碍认知），就应该删掉，而不是硬凑一句
            if c.get('faceText') is not None and not isinstance(c.get('faceText'), str):
                err(fn, '%s 的 faceText 要么是字符串、要么写 null' % at)
            cname = c.get('name')
            if isinstance(cname, str) and cname:
                if cname in seen_card:
                    err(fn, '卡名「%s」在这副牌里出现了两次' % cname)
                seen_card[cname] = 1
                prev = card_names.get(cname)
                if prev is None:
                    card_names[cname] = (fn, setname)
                elif (prev[1] in ('star',)) or (setname in ('star',)):
                    # ★ 只有星语那套"带符号身份"的牌组才靠卡名认身份，所以只有它跟别人不许撞名；
                    #   symbols:none 的整副不参与认身份（图形只是插画）→ 重名是安全的。
                    err(fn, '卡名「%s」和 %s 重了 —— 带符号的内置牌组之间卡名不能撞（界面按名字认身份）'
                            % (cname, prev[0]))
            if c.get('symbol') is not None and not isinstance(c.get('symbol'), str):
                err(fn, '%s 的 symbol 要么是字符串、要么省略' % at)
            sym = c.get('sym')
            # ★ 2026-10-01 用户：「每个都有符号，是**过时的规则**」——
            #   现在允许一副 symbols=star 的牌组里存在**不带符号的卡**（新加的内置卡就是这种）；
            #   带符号的仍然必须是合法 id（下面的分支照旧校验）。
            # ⚠ 只有**真的有符号**时才校验：symbols:none 的牌组（Aegis）每张卡都没有 sym，
            #   写成 if/else 会把 None 也送进校验（实测把 Aegis 78 张全报成 "sym「None」不在表里"）。
            if sym is not None:
                if not isinstance(sym, str):
                    err(fn, '%s 的 sym 必须是字符串' % at)
                else:
                    deck_syms = syms.get(key, set())
                    if not deck_syms:
                        err(fn, '%s 的 sym「%s」存在，但 decks/%s/ 里没有 symbols.json（symbols=%s）'
                            % (at, sym, key, setname))
                    elif sym not in deck_syms:
                        err(fn, '%s 的 sym「%s」不在 decks/%s/symbols.json 里' % (at, sym, key))
                    if sym in seen_sym:
                        err(fn, 'sym「%s」在这副牌里用了两次' % sym)
                    seen_sym[sym] = 1
            color = c.get('color')
            if not isinstance(color, int) or color < 0 or color >= len(pal):
                err(fn, '%s 的 color 必须是 0~%d 的整数（现在：%r）' % (at, len(pal) - 1, color))
            extra = set(c) - set(FIELDS)
            if extra:
                err(fn, '%s 有不认识的字段：%s（data.js 的卡片白名单只认 %s）' % (at, '、'.join(sorted(extra)), '/'.join(FIELDS)))
    # 生成物 / 接线检查
    want = emit(decks)
    if not os.path.exists(GEN):
        err('www/js/builtin-decks.js', '还没生成过 → 跑 `python3 app/tools/内置牌组.py 生成`')
    elif read(GEN) != want:
        err('www/js/builtin-decks.js', '和 decks/*.json 不一致 → 跑 `python3 app/tools/内置牌组.py 生成`')
    if not os.path.exists(INDEX):
        err('index.html', '找不到')
    else:
        html = read(INDEX)
        tags = re.findall(r'<script src="([^"]+)"', html)
        if 'js/builtin-decks.js' not in tags:
            err('index.html', '没有引 <script src="js/builtin-decks.js">')
        elif tags.index('js/data.js') < tags.index('js/builtin-decks.js'):
            err('index.html', 'builtin-decks.js 必须排在 data.js **前面**（data.js 一加载就要读它）')
    for t in TEST_FILES:
        if not os.path.exists(t):
            continue
        src = read(t)
        if 'builtin-decks.js' not in src:
            err(os.path.basename(t), "走查的 FILES 列表里没有 'js/builtin-decks.js'（要补在 data.js 前面）")
    # ★ 2026-10-06：**删除 / 下架**这条流程的三条"悬空引用"守卫。
    #   删除一副内置牌组时会牵连一堆别处（牌背模板、周易桌按 key 找牌、不打包.txt 那行），
    #   以前全靠人记着；这三条让"忘了清"当场变红。判据一律是"decks/*.json 里还有没有它"：
    #     · 下架（JSON 还留着，只是不进包）→ 三条都不红 ✓
    #     · 整副删掉（JSON 没了）→ 红，并指名道姓说该去清哪里 ✓
    all_keys = set(k for k in (d.get('key') for _, d in decks) if isinstance(k, str))
    for k in sorted(not_packed()):
        if k not in all_keys:
            err('decks/不打包.txt', '这一行排除了一个不存在的 key「%s」'
                                    '（牌组删了就该把这一行一起删；或者 key 写错了）' % k)
    # ★ 内置牌背模板的"悬空"检查不再需要：牌背 SVG 已数据化（decks/<key>/back.svg），
    #   跟着牌组目录走，删牌组 = back.svg 一起没了，没有"代码里残留模板"这回事。
    # ★ 2026-10-13 修复：这个 for 原先被吞在上一行注释里（`…这回事。    for k in …`）——
    #   hard_key_refs() 于是没人调用、下面的 if 错挂到「不打包」那个 for 上，守卫整条白挂。
    for k in sorted(hard_key_refs()):
        if k not in all_keys:
            err('www/js', "代码里按 builtinKey === '%s' 找牌组，但 decks/ 里已经没有这个 key —— "
                          "删这副牌时这里必须一起改（周易桌就是按 'zy64' 找牌的那个例子）" % k)
    # ★ 新增的牌组若没在 DECK_PATCHES 登记专属补丁，这里提一句（不拦）——
    #   有补丁就登记（README §0c），确实没有就登记成空列表注明，免得删除它时漏了。
    for k in sorted(all_keys - set(DECK_PATCHES)):
        print('  · 提示：牌组「%s」还没在 tools/内置牌组.py 的 DECK_PATCHES 里登记专属补丁（见 README §0c）' % k)
    return decks, not problems


def emit(decks=None):
    """decks/*.json → builtin-decks.js 的**全文**（纯函数：同样的输入永远同样的输出）
    ★ 不打包.txt 里列出的（别的会话在做的牌组）不进注册表、也就不进包。"""
    if decks is None:
        decks = load_decks()
    skip = not_packed()
    decks = [(p, d) for (p, d) in decks if not (isinstance(d, dict) and d.get('key') in skip)]
    L = []
    L.append('/* ============================================================')
    L.append(' * 猫卡 · 内置牌组注册表（builtin-decks.js）')
    L.append(' * ------------------------------------------------------------')
    L.append(' * ★★ 这个文件是**生成出来的，别手改**。')
    L.append(' *    改内容   → 编辑 app/decks/<牌组>.json')
    L.append(' *    重新生成 → python3 app/tools/内置牌组.py 生成')
    L.append(' *    校验一致 → python3 app/tools/内置牌组.py 校验')
    L.append(' *    为什么放 data.js 前面：data.js 一加载就要拿它建内置牌组。')
    L.append(' *    工作流程见 app/decks/00-必读-内置牌组增删流程.md。')
    L.append(' * ============================================================ */')
    L.append('(function (global) {')
    L.append("  'use strict';")
    L.append('  global.MoKaBuiltinDecks = [')
    for n, (path, d) in enumerate(decks):
        if not isinstance(d, dict):
            continue
        ddir = os.path.dirname(path)
        bp = os.path.join(ddir, 'back.svg')
        back_svg = read(bp) if os.path.exists(bp) else None
        sp = os.path.join(ddir, 'symbols.json')
        sym_table = json.loads(read(sp)) if os.path.exists(sp) else None
        L.append('    {')
        L.append('      key: %s,' % js(d.get('key', '')))
        L.append('      name: %s,' % js(d.get('name', '')))
        ret = d.get('retiredNames')
        if ret is not None and (not isinstance(ret, list) or any(not isinstance(x, str) or not x.strip() for x in ret)):
            err(os.path.relpath(path, BASE), 'retiredNames 必须是字符串数组（已下线的内置卡名；没有就写 [] 或省略）')
        olds = d.get('oldNames') or []
        L.append('      oldNames: [%s],' % ', '.join(js(x) for x in olds))
        L.append('      order: %s,' % json.dumps(d.get('order')) if isinstance(d.get('order'), int) else '      order: null,')
        L.append('      onTable: %s,' % ('true' if d.get('onTable') else 'false'))
        L.append('      addIfMissing: %s,' % ('true' if d.get('addIfMissing') else 'false'))
        L.append('      seed: %s,' % ('true' if d.get('seed') else 'false'))
        L.append('      hidden: %s,' % ('true' if d.get('hidden') else 'false'))
        # ★ 2026-11-17：**牌组级纸边**（用户 2026-11-17 导出包把两副都关了）→ 新装机由
        #   data.js: builtinDeck() 直接带上，老装机由 applyBuiltinDeckFlags() 迁移。
        #   牌组没写这两项就**不生成**（其余牌组行为、注册表字节都不变）。
        for k in ('backEdge', 'faceEdge'):
            if isinstance(d.get(k), bool):
                L.append('      %s: %s,' % (k, 'true' if d[k] else 'false'))
        L.append('      symbols: %s,' % js(d.get('symbols', 'none')))
        if sym_table:
            L.append('      symTable: %s,' % json.dumps(sym_table, ensure_ascii=False))
        L.append('      retiredNames: [%s],' % ', '.join(js(x) for x in (d.get('retiredNames') or [])))
        # ★ 2026-09-27：**这副牌的出厂牌面样式**（可选）。落到每张卡上当默认值，
        #   用户在「调整牌面」里改一次就覆盖 —— 版式走数据，不再写 CSS 用 !important 焊死。
        cs = d.get('cardStyle')
        if isinstance(cs, dict) and cs:
            L.append('      cardStyle: { %s },' % ', '.join(
                '%s: %s' % (js(k), json.dumps(v, ensure_ascii=False)) for k, v in cs.items()))
        # ★ 2026-09-28：历史上发过的几版出厂样式。老装机上"我们刷过、但没留快照"的卡，
        #   只要正好等于其中某一版，就认成"没被用户动过"、跟着更新（详见 data.js 的注释）。
        cp = d.get('cardStylePrev')
        if isinstance(cp, list) and cp:
            L.append('      cardStylePrev: [%s],' % ', '.join(
                '{ %s }' % ', '.join('%s: %s' % (js(k), json.dumps(v, ensure_ascii=False)) for k, v in o.items())
                for o in cp if isinstance(o, dict)))
        back = d.get('back') if isinstance(d.get('back'), dict) else {}
        tpl = back.get('template')
        L.append('      back: { template: %s, color: %s },' % ('null' if tpl is None else js(tpl), js(back.get('color', ''))))
        if back_svg:
            L.append('      backSvg: %s,' % js(back_svg))
        # ★ 使用说明（可选）：牌组自带的说明书（四符号 / 四位置 / 推荐牌阵）。
        mn = d.get('manual')
        if isinstance(mn, dict) and mn:
            L.append('      manual: %s,' % json.dumps(mn, ensure_ascii=False))
        face = d.get('face') if isinstance(d.get('face'), dict) else {}
        face_tpl = face.get('template') or None
        cards = d.get('cards') if isinstance(d.get('cards'), list) else []
        L.append('      cards: [')
        for c in cards:
            if not isinstance(c, dict):
                continue
            bits = []
            for f in ('name', 'keyword', 'symbol', 'sym', 'faceText', 'meaning', 'art', 'band',
                      'kwWrap2', 'styleKey', 'image'):
                v = c.get(f)
                bits.append('%s: %s' % (f, 'null' if v is None else js(v)))
            # ★ 牌面模板是**牌组级**的设定（deck JSON 里写一次 face.template），
            #   生成时展开到每张卡上 —— 这样 data.js / 编辑页 / 同步都跟 art、band 走同一条路。
            bits.append('face: %s' % ('null' if face_tpl is None else js(face_tpl)))
            bits.append('color: %s' % json.dumps(c.get('color')))
            # ★ 2026-11-06：这张内置卡**用过的旧名字**（data.js 拿它原地改名，不删不加、位置不动）。
            #   只在有值时才写，免得注册表里每张卡都多一个空数组。
            cn = c.get('oldNames')
            if cn:
                if (not isinstance(cn, list) or any(not isinstance(x, str) or not x.strip() for x in cn)):
                    err(os.path.relpath(path, BASE), '卡片 %s 的 oldNames 必须是字符串数组' % c.get('name'))
                bits.append('oldNames: [%s]' % ', '.join(js(x) for x in cn))
            L.append('        { %s },' % ', '.join(bits))
        L.append('      ]')
        L.append('    }%s' % (',' if n < len(decks) - 1 else ''))
    L.append('  ];')
    L.append('})(window);')
    return '\n'.join(L) + '\n'


def emit_css(decks=None):
    """decks/*/style.css → builtin-decks.css 全文（纯函数）"""
    if decks is None:
        decks = load_decks()
    skip = not_packed()
    parts = ['/* ============================================================',
             ' * 猫卡 · 内置牌组专属样式（builtin-decks.css）',
             ' * ------------------------------------------------------------',
             ' * ★★ 生成物，别手改。来源：decks/<key>/style.css',
             ' * ============================================================ */']
    for path, d in decks:
        if not isinstance(d, dict) or d.get('key') in skip:
            continue
        cp = os.path.join(os.path.dirname(path), 'style.css')
        if os.path.exists(cp):
            parts.append('/* ==== %s（%s）==== */' % (d.get('name'), d.get('key')))
            parts.append(read(cp).rstrip('\n'))
    return '\n'.join(parts) + '\n'


def cmd_list():
    decks, _ = load_decks(), None
    print('内置牌组（真源：app/decks/*.json）')
    skip = not_packed()
    print('  %-6s %-10s %5s %5s %-6s %-6s %-6s %-6s %-9s %s' % ('key', '名字', '张数', '顺序', '上桌', '新装建', '进包', '符号', '牌背', '文件'))
    for path, d in decks:
        back = d.get('back') or {}
        print('  %-6s %-10s %5s %5s %-6s %-6s %-6s %-6s %-9s %s' % (
            d.get('key'), d.get('name'), len(d.get('cards') or []), d.get('order'),
            '是' if d.get('onTable') else '否', '是' if d.get('seed') else '否',
            '否' if d.get('key') in skip else '是', d.get('symbols'),
            (back.get('template') or '无') + ' ' + str(back.get('color')), os.path.basename(path)))
    print('\n生成物：%s' % os.path.relpath(GEN, BASE))


def cmd_check():
    decks, ok = validate()
    if problems:
        print('✗ 校验没过（%d 条）：' % len(problems))
        for where, msg in problems:
            print('  · [%s] %s' % (where, msg))
        return 1
    skip = not_packed()
    packed = [1 for _, d in decks if isinstance(d, dict) and d.get('key') not in skip]
    print('✓ 校验通过：%d 副内置牌组进包（另有 %d 副按「不打包.txt」排除），生成物与 decks/*.json 一致'
          % (len(packed), len(decks) - len(packed)))
    for path, d in decks:
        print('  · %s（%s，%d 张）%s' % (d.get('name'), d.get('key'), len(d.get('cards') or []),
              ' ← 不进包（不打包.txt）' if d.get('key') in skip else ''))
    return 0


def cmd_gen(check_only=False):
    decks, ok = validate()
    # 只有「内容本身」的问题（decks/*.json）才拦生成；
    # 接线问题（index.html / 走查没引）单独提示，别挡住生成
    hard = [(w, m) for w, m in problems if w.endswith('.json')]
    soft = [(w, m) for w, m in problems if not w.endswith('.json')]
    if hard:
        print('✗ 校验没过，先别生成：')
        for where, msg in hard:
            print('  · [%s] %s' % (where, msg))
        return 1
    if soft:
        print('（还有 %d 条接线问题，生成完记得补上）' % len(soft))
        for where, msg in soft:
            print('  · [%s] %s' % (where, msg))
    text = emit(decks)
    css = emit_css(decks)
    old = read(GEN) if os.path.exists(GEN) else None
    old_css = read(CSS_GEN) if os.path.exists(CSS_GEN) else None
    skip = not_packed()
    packed = [(f, d) for f, d in decks if isinstance(d, dict) and d.get('key') not in skip]
    if old == text and old_css == css:
        print('✓ 已是最新（进包 %d 副 / %d 张卡；另有 %d 副按「不打包.txt」排除）：%s + %s' % (
            len(packed), sum(len(d.get('cards') or []) for _, d in packed),
            len(decks) - len(packed), os.path.relpath(GEN, BASE), os.path.relpath(CSS_GEN, BASE)))
        return 0
    if check_only:
        print('✗ 生成物和 decks/ 不一致（跑 `python3 app/tools/内置牌组.py 生成` 重生成）')
        if old is None:
            print('  · %s 还不存在' % os.path.relpath(GEN, BASE))
        elif old != text:
            a, b = old.splitlines(), text.splitlines()
            for i in range(max(len(a), len(b))):
                x = a[i] if i < len(a) else '<没有这一行>'
                y = b[i] if i < len(b) else '<没有这一行>'
                if x != y:
                    print('  · 第一处不同在第 %d 行：' % (i + 1))
                    print('      盘上： %s' % x[:120])
                    print('      应该： %s' % y[:120])
                    break
        elif old_css is None:
            print('  · %s 还不存在' % os.path.relpath(CSS_GEN, BASE))
        elif old_css != css:
            print('  · %s 和 decks/*/style.css 不一致' % os.path.relpath(CSS_GEN, BASE))
        return 1
    with open(GEN, 'w', encoding='utf-8') as f:
        f.write(text)
    with open(CSS_GEN, 'w', encoding='utf-8') as f:
        f.write(css)
    print('✓ 生成了 %s + %s（进包 %d 副 / %d 张卡；另有 %d 副按「不打包.txt」排除）' % (
        os.path.relpath(GEN, BASE), os.path.relpath(CSS_GEN, BASE),
        len(packed), sum(len(d.get('cards') or []) for _, d in packed),
        len(decks) - len(packed)))
    return 0


def cmd_new(key, name=None):
    if not key or not re.fullmatch(r'[a-z][a-z0-9_\-]*', key):
        print('✗ key 要小写字母开头（英文/数字/下划线），例如 deepsea')
        return 1
    decks = load_decks()
    if any((d.get('key') == key) for _, d in decks):
        print('✗ key「%s」已经有了' % key)
        return 1
    name = name or key
    order = max([d.get('order') for _, d in decks if isinstance(d.get('order'), int)] + [0]) + 10
    skel = {
        'format': FORMAT, 'key': key, 'name': name, 'oldNames': [], 'order': order,
        'onTable': True, 'addIfMissing': True, 'seed': True, 'symbols': 'none', 'back': {'template': None, 'color': '#8a7a3a'},
        'note': '待填：这副牌是什么、符号从哪来。',
        'cards': [{'name': '占位卡', 'keyword': '占位', 'symbol': None, 'sym': None,
                   'faceText': '一句话牌面（待填）', 'meaning': '一段牌义（待填）', 'color': 0}],
    }
    ddir = os.path.join(DECKS, key)
    if os.path.exists(ddir):
        print('✗ %s 已经存在' % ddir)
        return 1
    os.makedirs(ddir)
    p = os.path.join(ddir, 'deck.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(skel, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('✓ 造好了骨架：%s（key=%s，顺序=%d）' % (os.path.relpath(p, BASE), key, order))
    print("""
接着照这六步走（一步都别省）：

 1. 填内容     改 %s：cards 每张卡要有 name / keyword / faceText / meaning / color；
               symbols=star 的牌组每张还要有 sym（符号 id）；symbols=none 的留 null。
 2. 校验       python3 app/tools/内置牌组.py 校验
 3. 生成       python3 app/tools/内置牌组.py 生成      ← 写 www/js/builtin-decks.js
 4. 走查       cd app/test && node 走查-内置牌组.js    ← 再跑另两套（源码 + 包内各一遍）
 5. 构建       python3 app/build_catcard.py            ← 构建号 +1，同步 4 处
 6. 交付       成品/ + Download/ + sha256，按交接里的交付话术说

★ 老装机迁移是自动的（data.js 的 ensureBuiltinDecks）：按"名字是不是内置那副"认，
  绝不碰用户自己的牌组；旧名字写进 oldNames 就会一次性改名。
""" % os.path.relpath(p, BASE))
    return 0


# ---------------------------------------------------------------- 删除 / 下架 / 上架

def rel(p):
    return os.path.relpath(p, BASE)


def deck_by_key(key):
    """按 key **精确**找一副（找不到返回 (None, None)）。
    删除是不可逆动作，这里不做模糊匹配、不猜 —— key 打错就明确报错。"""
    for p, d in load_decks():
        if isinstance(d, dict) and d.get('key') == key:
            return p, d
    return None, None


def all_keys():
    return [d.get('key') for _, d in load_decks()
            if isinstance(d, dict) and isinstance(d.get('key'), str)]


def deck_dir_of(path):
    """deck.json 路径 → 它所在的牌组目录。"""
    return os.path.dirname(path)


def deck_asset_dir(key):
    """这副牌的**外置进包资源**目录：www/assets/deckimg/<key>/（存储层迭代，2026-10-08）。

    牌面图走相对资源路径（`assets/deckimg/<key>/<n>.png`）、不内嵌 data URL 的牌组，
    图片原字节躺在这里。它跟着牌组走 → 删除时必须一起清，否则留一地垃圾。
    判据只看「目录在不在」，不认牌组名 —— 和 io.js 的 DECK_ASSET_PREFIX 同一条口径。"""
    return os.path.join(BASE, 'www', 'assets', 'deckimg', key)


def dir_bytes(p):
    n = 0
    for root, _dirs, files in os.walk(p):
        for f in files:
            try:
                n += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return n


def gen_scripts(key, name):
    """tools/*.py 里疑似"这副牌的生成器"：[(路径, [理由], [疑似共用的别的 key], 是否强证据)]
    ★ 判定分强弱，因为**脚本删了就没了**：
      强证据（文件名含 key，或内容里有这副牌的注册项 `key: '<key>'`）→ 可以自动删；
      弱证据（只是文字/注释里提到牌组名或 key）→ **只列出来交人工**，绝不自动删
      （踩过：gen_zhouyi.py 里提了一句「易经牌组」，差点被当成 gua64 的生成器一起删掉）。
    另外，内容里还写着**别的牌组 key** 的 = 疑似共用 → 也不自动删。"""
    keys = all_keys()
    me = os.path.basename(__file__)
    out = []
    for fn in sorted(os.listdir(TOOLS)):
        if not fn.endswith('.py') or fn == me:
            continue
        p = os.path.join(TOOLS, fn)
        src = read(p)
        why, strong = [], False
        if key in fn:
            why.append('文件名含 %s' % key)
            strong = True
        if re.search(r"['\"]key['\"]\s*:\s*['\"]%s['\"]" % re.escape(key), src):
            why.append("内容就是这副牌的注册项（key: '%s'）" % key)
            strong = True
        if strong:
            if name and name in src:
                why.append('内容里也写着牌组名「%s」' % name)
        else:
            if re.search(r"['\"]%s['\"]" % re.escape(key), src):
                why.append("只是内容里提到 key「%s」" % key)
            if name and name in src:
                why.append('只是内容里提到牌组名「%s」' % name)
        if not why:
            continue
        shared = [k for k in keys if k != key and re.search(r"['\"]%s['\"]" % re.escape(k), src)]
        out.append((p, why, shared, strong))
    return out


def not_packed_add(key):
    """把 key 写进 decks/不打包.txt（软下架）。返回 True 表示真的改了文件。"""
    lines = read(NOT_PACKED_FILE).splitlines() if os.path.exists(NOT_PACKED_FILE) else []
    if any(ln.split('#')[0].strip() == key for ln in lines):
        return False
    lines.append(key)
    with open(NOT_PACKED_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    return True


def not_packed_remove(key):
    """删掉 decks/不打包.txt 里的那一行（注释一律不动）。返回 True 表示真的改了。"""
    if not os.path.exists(NOT_PACKED_FILE):
        return False
    lines = read(NOT_PACKED_FILE).splitlines()
    keep = [ln for ln in lines if ln.split('#')[0].strip() != key]
    if len(keep) == len(lines):
        return False
    with open(NOT_PACKED_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(keep) + ('\n' if keep else ''))
    return True


def css_files():
    return [os.path.join(CSS_DIR, f) for f in sorted(os.listdir(CSS_DIR)) if f.endswith('.css')]


def test_files():
    return [os.path.join(TESTS, f) for f in sorted(os.listdir(TESTS)) if f.endswith('.js')]


def _hits(files, pats):
    out = []
    for p in files:
        for i, ln in enumerate(read(p).splitlines(), 1):
            s = ln.strip()
            if s and any(x.search(ln) for x in pats):
                out.append((p, i, s))
    return out


def trace_report(key, name, tpl, stykeys):
    """这个 key / 牌组名 / 它专属的牌背模板与样式类，都还出现在哪儿。
    返回 (hard, code, test, doc)：
      hard = 代码里按 key 硬找牌组（**删了功能会坏**，必须人工改）
      code = 手写代码 / 样式里的引用    test = 走查里的写死断言    doc = 文档
    ⚠ 生成物 builtin-decks.js 不算 —— 它是重生成的。"""
    esc = re.escape(key)
    hard_pat = [re.compile(r"builtinKey\s*===\s*'%s'" % esc)]
    general = []
    if re.fullmatch(r'[a-z][a-z0-9_\-]*', key or ''):
        general.append(re.compile(r"['\"]%s['\"]" % esc))
        general.append(re.compile(r"(?<![A-Za-z0-9_\-])%s(?![A-Za-z0-9_\-])" % esc))
    for x in ([tpl] if tpl else []) + list(stykeys):
        general.append(re.compile(r"['\"]%s['\"]" % re.escape(x)))
        general.append(re.compile(r"(?<![A-Za-z0-9_\-])%s(?![A-Za-z0-9_\-])" % re.escape(x)))
    if name:
        general.append(re.compile(re.escape(name)))
    hard = _hits(js_sources(), hard_pat)
    hard_set = set((p, i) for p, i, _ in hard)
    code = [h for h in _hits(js_sources() + css_files(), general) if (h[0], h[1]) not in hard_set]
    test = _hits(test_files(), general)
    doc = _hits([p for p in [DECKS_README] + RECORD_FILES if os.path.exists(p)], general)
    return hard, code, test, doc


# ★ 每副内置牌组的「专属补丁」：除了通用机制（注册表 / 内容同步 / 牌背归属），
#   代码里还散着一堆**只服务某一副牌**的东西。删除 / 下架某副牌时，dry-run 会把它们列出来，
#   免得删完才发现漏了 —— 最典型：zy64 那副后面挂着**整个周易功能**。
#   每项 = (说明, [(文件(相对 app/), [正则关键词, ...])])；关键词用来在对应文件里定位行号。
DECK_PATCHES = {
    'star': [
        ('星语身份判据（data.js）：STAR_ENTRY / STAR_DECK_NAME / defaultDeck() / isStarName() / DEFAULT_SYM —— '
         '删星语时这些引用自然降级为空，但「默认牌组」语义会变',
         [('www/js/data.js', ['STAR_ENTRY', 'STAR_DECK_NAME', 'isStarName', 'DEFAULT_SYM'])]),
    ],
    'gua64': [
        ('牌背已数据化（back.svg 跟目录走），删除 = 删目录，代码无残留', []),
    ],
    'zy64': [
        ('⚠ 周易功能按 builtinKey 找它：zhouyi-table.js / zhouyi.js —— 删它周易功能会坏',
         [('www/js/scenes/zhouyi-table.js', ['zy64']), ('www/js/scenes/zhouyi.js', ['zy64'])]),
    ],
    'overflow2': [
        ('★ 2026-10-25 重做 O 字头：牌面/牌名/牌义复用旧 overflow（16 张、4 张共用符号图），'
         '牌背图片复用、参数用新增默认（template=null / color=#8a7a3a）；'
         '牌背已数据化（back.svg 跟目录走），代码里没有按 key 的硬引用；'
         '删除 = 删目录 + www/assets/deckimg/overflow2', []),
    ],
    'xiangchao': [
        ('牌背/牌面已数据化（back.svg 跟目录走，24 张图外置 decks/xiangchao/faces → www/assets/deckimg/xiangchao）；'
         '代码里没有按 key 的硬引用；删除 = 删目录 + 资源图', []),
    ],
    'lovearmour': [
        ('★ 2026-10-24 新建：由 stories（爱情 25）＋ aegis（防御 35）合并成 60 张，'
         '牌面图外置 decks/lovearmour/faces → www/assets/deckimg/lovearmour（gen_lovearmour.py --check）；'
         '牌背沿用原 Amour 的深墨绿玫瑰心结盘（back.svg 跟目录走）；'
         '卡带 styleKey=lovearmour（v3.css 里那条素字光晕）；旧两副已进「不打包.txt」。'
         '删除 = 删目录 + 资源图，代码里没有按 key 的硬引用', []),
    ],
}


def patch_report(key):
    """这副牌在代码里的「专属补丁」：[(说明, [(文件, 行号, 行内容), ...])]"""
    out = []
    for desc, files in DECK_PATCHES.get(key, []):
        hits = []
        for relf, kws in files:
            p = os.path.join(BASE, relf)
            if not os.path.exists(p):
                continue
            pats = [re.compile(k) for k in kws]
            for i, ln in enumerate(read(p).splitlines(), 1):
                s = ln.strip()
                if s and any(pt.search(ln) for pt in pats):
                    hits.append((p, i, s))
        out.append((desc, hits))
    return out


def _print_hits(title, hits, note='', limit=14):
    if not hits:
        return 0
    print('\n%s（%d 处）%s' % (title, len(hits), ('  ' + note) if note else ''))
    for p, i, s in hits[:limit]:
        print('   · %s:%d  %s' % (rel(p), i, (s[:96] + '…') if len(s) > 96 else s))
    if len(hits) > limit:
        print('   … 另有 %d 处' % (len(hits) - limit))
    return len(hits)


def cmd_delete(key, confirm=False):
    path, d = deck_by_key(key)
    if not path:
        print('✗ decks/*.json 里没有 key 为「%s」的内置牌组（**不做模糊匹配**，key 要精确对上）。' % key)
        ks = all_keys()
        print('  现在的 key：%s' % ('、'.join(ks) if ks else '（一副都没有）'))
        return 1
    name = d.get('name')
    cards = d.get('cards') or []
    tpl = (d.get('back') or {}).get('template') if isinstance(d.get('back'), dict) else None
    stykeys = sorted(set(c.get('styleKey') for c in cards if isinstance(c, dict) and c.get('styleKey')))
    # ⚠ 比 key、不比对象身份：load_decks() 每次都重新解析一遍 JSON，`o is not d` 永远成立
    others = [o for _, o in load_decks() if isinstance(o, dict) and o.get('key') != key]
    tpl_mine = bool(tpl) and not any(isinstance(o.get('back'), dict) and o['back'].get('template') == tpl
                                     for o in others)
    ddir = os.path.dirname(path)
    scripts = gen_scripts(key, name)
    # 自动删的门槛：**强证据 且 没写别的牌组 key**（弱证据 / 疑似共用 → 一律交人工）
    auto_scripts = [s for s in scripts if s[3] and not s[2]]
    warn_scripts = [s for s in scripts if s not in auto_scripts]
    in_skip = key in not_packed()
    hard, code, test, doc = trace_report(key, name, tpl, stykeys)

    print('将删除内置牌组：%s（key=%s，%d 张，order=%s）' % (name, key, len(cards), d.get('order')))
    print('  源文件：%s' % rel(path))
    print('  （只想让它"不进这个包、文件都留着" → 用「下架 %s」，别用删除）' % key)

    print('\n【① 会自动删掉的文件】（整副牌组的目录）')
    print('   · %s/（整目录：deck.json + back.svg + symbols.json + style.css + checks.json + faces…）' % rel(ddir))
    adir = deck_asset_dir(key)
    if os.path.isdir(adir):
        print('   · %s/（**外置进包资源**：牌面图原字节 %d 张，%.1f MB —— 不删就是留一地垃圾）'
              % (rel(adir), len(os.listdir(adir)), dir_bytes(adir) / 1048576))
    for sp, why, _, _ in auto_scripts:
        print('   · %s（生成器：%s）' % (rel(sp), '；'.join(why)))
    if in_skip:
        print('   · decks/不打包.txt 里那一行 %s' % key)
    for sp, why, shared, _ in warn_scripts:
        tail = ('、'.join(shared) + ' 的注册项') if shared else '只有弱证据（文字里提到过）'
        print('   ⚠ 不自动删 %s（%s；理由不足：%s）→ 交人工判断' % (rel(sp), '；'.join(why), tail))

    print('\n【② 会自动重做】')
    print('   · www/js/builtin-decks.js + www/css/builtin-decks.css ← 删完立刻重跑「生成」')
    print('   · 走查三套 + 构建前检查（构建脚本自己会再查一次）')

    if hard:
        _print_hits('【③ ❌ 代码里按这个 key 找牌组 —— 删了会坏，必须人工改】', hard)
    if tpl_mine or stykeys:
        print('\n【④ ⚠ 这副牌专属的东西（工具不碰，人工清）】')
        if tpl_mine:
            print("   牌背「%s」已数据化（back.svg 跟目录一起删），代码里没有要清的写死分支。" % tpl)
        for sk in stykeys:
            print("   牌面样式「%s」在 decks/%s/style.css 里，跟目录一起删（无需清 v3.css）。" % (sk, key))
    n_code = _print_hits('【⑤ 手写代码 / 样式里还提到它的地方（人工过一遍）】', code)
    n_test = _print_hits('【⑥ 走查里写死的断言（删完三套走查会红，要跟着改）】', test)
    n_doc = _print_hits('【⑦ 文档里提到它的地方】', doc, limit=8)

    patches = patch_report(key)
    if patches:
        print('\n【⑨ 这副牌的专属补丁（工具不碰，人工清 —— 删这副尤其别漏）】')
        for desc, hits in patches:
            print('   • %s' % desc)
            for p2, i, s2 in hits[:6]:
                print('       %s:%d  %s' % (rel(p2), i, (s2[:80] + '…') if len(s2) > 80 else s2))
            if len(hits) > 6:
                print('       … 另有 %d 处' % (len(hits) - 6))

    print('\n【⑧ 老装机：什么都不做】')
    print('   已经装到手机上的那副**原样保留** —— 它现在是用户的牌组，一个字都不碰（红线 2）。')
    print('   代价：以后它不再跟着内置内容同步（注册表里已经没有它了）。用户要清请他在「牌库」里自己删。')

    if not confirm:
        print('\n这是 **dry-run**：上面一个文件都还没动。确认无误再加 --确认 真删（不可逆、不留备份）：')
        print('  python3 app/tools/内置牌组.py 删除 %s --确认' % key)
        return 0

    print('\n──────────────── 真删（--确认）────────────────')
    removed = []
    shutil.rmtree(ddir)
    removed.append('%s/（整目录）' % rel(ddir))
    if os.path.isdir(adir):
        shutil.rmtree(adir)
        removed.append('%s/（外置进包资源）' % rel(adir))
    for sp, why, _, _ in auto_scripts:
        os.remove(sp)
        removed.append('%s' % rel(sp))
    if not_packed_remove(key):
        removed.append('decks/不打包.txt 里的 %s 行' % key)
    for x in removed:
        print('  ✓ 删了 %s' % x)
    for sp, why, shared, _ in warn_scripts:
        print('  ⚠ 没删 %s（%s）' % (rel(sp), '；'.join(why)))

    print('\n重生成注册表……')
    cmd_gen()
    problems.clear()
    decks2, ok = validate()
    print('\n删完的校验：%s' % ('✓ 全过' if ok else '✗ 还有 %d 条要人工处理' % len(problems)))
    for where, msg in problems:
        print('  · [%s] %s' % (where, msg))
    print("""
接着把这四步走完（和「新增」对称，一步都别省）：

  1. 清人工项   上面 ③④⑤⑥⑦⑨ 那些：代码硬引用 / 专属牌背模板 / 专属补丁 / CSS 规则 / 走查断言 / 文档
  2. 校验       python3 app/tools/内置牌组.py 校验     ← 上面那几条悬空引用要清到全绿
  3. 走查       cd app/test && node 走查-内置牌组.js      ← 再跑另两套（源码 + 包内各一遍）
  4. 构建交付   python3 app/build_catcard.py            ← 构建号 +1（4 处），成品进 成品/ 与 Download/

★ 提醒用户：手机上早就装好的那副**不会自己消失** —— 要清得他自己在「牌库」里删。
""")
    return 0


def cmd_offline(key):
    """软下架：只把 key 写进 decks/不打包.txt。文件一个字节都不动。"""
    path, d = deck_by_key(key)
    if not path:
        print('✗ decks/*.json 里没有 key 为「%s」的牌组。现在的 key：%s' % (key, '、'.join(all_keys())))
        return 1
    if key in not_packed():
        print('• 「%s」（key=%s）已经在 decks/不打包.txt 里了，本来就是下架状态。' % (d.get('name'), key))
        return 0
    not_packed_add(key)
    print('✓ 已下架「%s」（key=%s）：在 decks/不打包.txt 加了一行。' % (d.get('name'), key))
    print('  decks/%s、它的图、生成器、牌背 / CSS / 走查 —— 一个字节都没动，随时能上架。' % os.path.basename(path))
    print('  上架：python3 app/tools/内置牌组.py 上架 %s' % key)
    cmd_gen()
    # ★ 2026-10-20：下架只挡注册表，挡不住 www/ 下的进包图 —— aapt 是整目录打包，
    #   www/assets/deckimg/<key>/ 还在就会照样进包（实测 love 下架后仍多塞 6.0 MB）。
    asset = deck_asset_dir(key)
    if os.path.isdir(asset):
        print('  ⚠ 进包图还在：%s（%.1f MB）—— 打包会把 www/ 整目录带走，它也会进包。'
              % (rel(asset), dir_bytes(asset) / 1048576.0))
        print('    真要省体积就移走（源图在 decks/%s/faces/，上架前跑生成器搬回来）：'
              % key)
        print('      mv "%s" <目标目录>/%s' % (asset, key))
    print('\n⚠ 老装机上已经装好的那副**原样保留**：下架只影响"以后新装机建不建、这个包装不装"，'
          '不会去删用户设备上的东西。')
    return 0


def cmd_online(key):
    """撤销下架：删掉 decks/不打包.txt 里那一行。"""
    if not deck_by_key(key)[0]:
        print('✗ decks/*.json 里没有 key 为「%s」的牌组（下架过但已经删掉了？那就没法上架）。' % key)
        return 1
    if key not in not_packed():
        print('• 「%s」本来就没在 decks/不打包.txt 里，不需要上架。' % key)
        return 0
    not_packed_remove(key)
    print('✓ 已上架 %s：decks/不打包.txt 里那一行删掉了。' % key)
    cmd_gen()
    return 0


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help', '帮助'):
        print(__doc__)
        return 0
    cmd = argv[1]
    rest = argv[2:]
    if cmd in ('清单', 'list'):
        cmd_list()
        return 0
    if cmd in ('校验', 'check'):
        return cmd_check()
    if cmd in ('生成', 'gen', 'build'):
        return cmd_gen('--检查' in rest or '--check' in rest)
    if cmd in ('新增', 'new'):
        if not rest:
            print('用法：python3 app/tools/内置牌组.py 新增 <key> [名字]')
            return 1
        return cmd_new(rest[0], rest[1] if len(rest) > 1 else None)
    if cmd in ('下架', 'offline', 'softdelete'):
        if not rest:
            print('用法：python3 app/tools/内置牌组.py 下架 <key>')
            return 1
        return cmd_offline(rest[0])
    if cmd in ('上架', 'online', 'restore'):
        if not rest:
            print('用法：python3 app/tools/内置牌组.py 上架 <key>')
            return 1
        return cmd_online(rest[0])
    if cmd in ('删除', 'delete', 'del', 'rm'):
        if not rest:
            print('用法：python3 app/tools/内置牌组.py 删除 <key>            # 先看清单（dry-run）')
            print('      python3 app/tools/内置牌组.py 删除 <key> --确认     # 真删（不可逆、不留备份）')
            return 1
        confirm = any(x in ('--确认', '--confirm', '-y', '--yes') for x in rest[1:])
        return cmd_delete(rest[0], confirm)
    print('不认识的命令：%s\n' % cmd)
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
