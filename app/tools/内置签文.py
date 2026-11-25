#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 内置签文包工具

内容只写在 app/lots/*.txt（就是 App 里「导出签文」那种 ===== N ===== 分段格式），
本工具把它生成/校验成 www/js/builtin-lots.js（别手改生成物）。

用法：
  python3 app/tools/内置签文.py 清单     # 有哪些内置签文包、各多少条
  python3 app/tools/内置签文.py 校验     # 格式 + 生成物是否最新（构建前会跑它）
  python3 app/tools/内置签文.py 生成     # 重写 www/js/builtin-lots.js

★ 为什么要有这个文件：别把 108 条签文直接写进 js —— 那是"内容散在代码里"，
  改一个字要翻代码、还容易和生成物对不上（内置牌组当年就是这么改成现在的样子的）。
"""
import os, re, sys, json, glob

# ★ 内置签文包改名表：{ 新名: [旧名, …] } —— 老装机「恢复内置」时会先把旧名那条清掉，避免同名内容留两份
RENAME = {
    '一条字句': ['杂签368'],
}

BASE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(BASE)
SRC = os.path.join(APP, 'lots')
GEN = os.path.join(APP, 'www', 'js', 'builtin-lots.js')
# ★ 2026-10-13：常问词库（求签页的「常问」）单独一路 —— 它**不是**签文包，
#   所以放 app/asks/（放 lots/ 会被 load() 当成一个空签文包而报错）。
ASKS_SRC = os.path.join(APP, 'asks')
ASKS_GEN = os.path.join(APP, 'www', 'js', 'builtin-asks.js')
problem = []


def err(where, msg):
    problem.append('[%s] %s' % (where, msg))


def parse(path):
    """===== N ===== 分段 → [签文,…]；每条只做 trim，不动里面的换行（多行签要保原样）"""
    txt = open(path, encoding='utf-8').read()
    blocks = re.split(r'^=====\s*\d*\s*=====$', txt, flags=re.M)
    out = [b.strip() for b in blocks if b.strip()]
    return out


def load():
    packs = []
    for path in sorted(glob.glob(os.path.join(SRC, '*.txt'))):
        name = os.path.splitext(os.path.basename(path))[0]
        lots = parse(path)
        if not lots:
            err(os.path.basename(path), '一条签文都没有（===== N ===== 分段格式）')
        for i, t in enumerate(lots, 1):
            if len(t) > 600:
                err(os.path.basename(path), '第 %d 条太长（%d 字）' % (i, len(t)))
        packs.append({'name': name, 'file': os.path.basename(path), 'lots': lots})
    return packs


def emit(packs):
    L = []
    L.append('/* ============================================================')
    L.append(' * 猫卡 · 内置签文包（builtin-lots.js）')
    L.append(' * ------------------------------------------------------------')
    L.append(' * ★★ 生成物，别手改：内容在 app/lots/*.txt')
    L.append(' *    改内容   → 编辑 app/lots/<包名>.txt')
    L.append(' *    重新生成 → python3 app/tools/内置签文.py 生成')
    L.append(' *    校验一致 → python3 app/tools/内置签文.py 校验')
    L.append(' * 首次装机由 lots.js 的 seedBuiltin() 播进签文包；老装机"缺了才补"，')
    L.append(' * 用户删过就再不塞回来（localStorage 里的 moka.lots.seed 标记）。')
    L.append(' * ============================================================ */')
    L.append('(function (global) {')
    L.append("  'use strict';")
    L.append('  global.MoKaBuiltinLots = [')
    for pi, p in enumerate(packs):
        L.append('    {')
        L.append('      name: %s,' % json.dumps(p['name'], ensure_ascii=False))
        olds = RENAME.get(p['name'])
        if olds:
            L.append('      renamedFrom: %s,' % json.dumps(olds, ensure_ascii=False))
        L.append('      lots: [')
        for i, t in enumerate(p['lots']):
            L.append('        %s%s' % (json.dumps(t, ensure_ascii=False), ',' if i < len(p['lots']) - 1 else ''))
        L.append('      ]')
        L.append('    }%s' % (',' if pi < len(packs) - 1 else ''))
    L.append('  ];')
    L.append('})(window);')
    return '\n'.join(L) + '\n'


def parse_asks(path):
    """`## 类别` 开一行，下面每行一句；空行与 # 注释忽略。返回 [{name, asks}]"""
    groups, cur = [], None
    for raw in open(path, encoding='utf-8'):
        line = raw.strip()
        if not line:
            continue
        # ⚠ 顺序要紧：`##` 也是以 `#` 开头的 —— 先判注释会把类别行整行吃掉；
        #   但注释判据也不能丢（文件头那一大段说明就是 `#` 开头的）。
        if line.startswith('##'):
            cur = {'name': line[2:].strip(), 'asks': []}
            if not cur['name']:
                err(os.path.basename(path), '有一个 `##` 后面没写类别名')
            groups.append(cur)
            continue
        if line.startswith('#'):
            continue
        if cur is None:
            err(os.path.basename(path), '「%s」前面还没有 `## 类别`' % line[:14])
            continue
        cur['asks'].append(line)
    for g in groups:
        if not g['asks']:
            err(os.path.basename(path), '类别「%s」一句都没有' % g['name'])
    return groups


def load_asks():
    if not os.path.isdir(ASKS_SRC):
        return []
    groups = []
    for path in sorted(glob.glob(os.path.join(ASKS_SRC, '*.txt'))):
        groups += parse_asks(path)
    # 全局去重：同一句出现在两个类别里，随机抽的时候会冷不丁重复端出来
    seen = {}
    for g in groups:
        keep = []
        for t in g['asks']:
            if t in seen:
                err('常问', '「%s」在「%s」和「%s」里重复了' % (t[:14], seen[t], g['name']))
                continue
            seen[t] = g['name']
            keep.append(t)
        g['asks'] = keep
    return groups


def emit_asks(groups):
    L = []
    L.append('/* ============================================================')
    L.append(' * 猫卡 · 常问词库（builtin-asks.js）')
    L.append(' * ------------------------------------------------------------')
    L.append(' * ★★ 生成物，别手改：内容在 app/asks/*.txt')
    L.append(' *    改内容   → 编辑 app/asks/常问.txt')
    L.append(' *    重新生成 → python3 app/tools/内置签文.py 生成')
    L.append(' *    校验一致 → python3 app/tools/内置签文.py 校验')
    L.append(' * 用途：求签页的「常问」——点一句就直接问签，不用手打。')
    L.append(' * 界面一次只随机端出 6 句、每几秒换一批（见 scenes/lots.js 的 renderGod）。')
    L.append(' * ============================================================ */')
    L.append('(function (global) {')
    L.append("  'use strict';")
    L.append('  global.MoKaBuiltinAsks = [')
    for gi, g in enumerate(groups):
        L.append('    {')
        L.append('      name: %s,' % json.dumps(g['name'], ensure_ascii=False))
        L.append('      asks: [')
        for i, t in enumerate(g['asks']):
            L.append('        %s%s' % (json.dumps(t, ensure_ascii=False), ',' if i < len(g['asks']) - 1 else ''))
        L.append('      ]')
        L.append('    }%s' % (',' if gi < len(groups) - 1 else ''))
    L.append('  ];')
    L.append('})(window);')
    return '\n'.join(L) + '\n'


def cmd_list():
    packs = load()
    print('内置签文包（真源：app/lots/*.txt）')
    total = 0
    for p in packs:
        print('  %-14s %4d 条   %s' % (p['name'], len(p['lots']), p['file']))
        total += len(p['lots'])
    print('  合计 %d 条' % total)
    groups = load_asks()
    if groups:
        print('常问词库（真源：app/asks/*.txt）')
        for g in groups:
            print('  %-14s %4d 句' % (g['name'], len(g['asks'])))
        print('  合计 %d 类 / %d 句' % (len(groups), sum(len(g['asks']) for g in groups)))


def cmd_gen(check_only=False):
    packs = load()
    groups = load_asks()
    jobs = [(GEN, emit(packs), 'www/js/builtin-lots.js', 'app/lots/*.txt',
             '%d 个包 / %d 条' % (len(packs), sum(len(p['lots']) for p in packs)))]
    if groups:
        jobs.append((ASKS_GEN, emit_asks(groups), 'www/js/builtin-asks.js', 'app/asks/*.txt',
                     '%d 类 / %d 句' % (len(groups), sum(len(g['asks']) for g in groups))))
    rc = 0
    for path, want, rel, src, info in jobs:
        old = open(path, encoding='utf-8').read() if os.path.exists(path) else None
        if old == want:
            print('✓ 已是最新（%s）：%s' % (info, rel))
            continue
        if check_only:
            err(rel, '和 %s 不一致 → 跑 `python3 app/tools/内置签文.py 生成`' % src)
            rc = 1
            continue
        open(path, 'w', encoding='utf-8').write(want)
        print('✓ 生成了 %s（%s，%d B）' % (rel, info, len(want.encode('utf-8'))))
    return rc


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else '清单'
    if cmd == '清单':
        cmd_list()
        return 0
    if cmd == '校验':
        cmd_gen(check_only=True)
        # 接线检查：index.html 要在 lots.js 之前引它
        idx = open(os.path.join(APP, 'www', 'index.html'), encoding='utf-8').read()
        tags = re.findall(r'<script src="([^"]+)"', idx)
        for f in ('js/builtin-lots.js', 'js/builtin-asks.js'):
            if f not in tags:
                err('index.html', '没有引 <script src="%s">' % f)
            elif tags.index(f) > tags.index('js/scenes/lots.js'):
                err('index.html', '%s 必须排在 scenes/lots.js **前面**' % f)
        if problem:
            print('✗ 校验没过（%d 条）：' % len(problem))
            for m in problem:            # ★ 原先是 `for w, m in problem` —— 但 err() 存的是**字符串**，
                print('  · %s' % m)       #   一直没错是因为校验从没红过；2026-10-13 常问查出重复时它先崩了
            return 1
        packs, groups = load(), load_asks()
        print('✓ 校验通过：%d 个内置签文包 / %d 条；常问 %d 类 / %d 句'
              % (len(packs), sum(len(p['lots']) for p in packs), len(groups),
                 sum(len(g['asks']) for g in groups)))
        return 0
    if cmd == '生成':
        rc = cmd_gen()
        return rc
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main())
