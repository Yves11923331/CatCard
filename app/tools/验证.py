#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · **按改动范围跑验证**（省时间、更省上下文）

为什么要有它
------------
全量验证的实测成本（2026-10-12 本机）：门禁 3.5s ＋ 内置牌组走查 8.1s ＋ 壳层走查 8.0s
＋ 占卜桌走查 **23.6s** ＋ 外置图验证 5.8s ≈ **49 秒**；而光"占卜桌"那套就打 **571 行**输出
（每条断言一行 ✔）。改个牌义、改行 CSS 也这么全套跑一遍的话，时间和上下文都白烧。

所以：**按"改动落在哪"选范围**，小的只跑小的。它顺带干两件事：
  · 给子进程设 `MOKA_QUIET=1`（走查只打失败与汇总）；
  · **把子进程的输出吞掉**，只端出"状态 + 耗时 + 结论（失败才附详情）"—— 进上下文的是十来行，不是几百行。

用法
----
  python3 tools/验证.py 数据                 # 改了 decks/*.json（牌义 / 牌面图路径 / 出厂样式）
  python3 tools/验证.py 编辑器               # 改了 www/js/scenes/editor.js
  python3 tools/验证.py 界面 门禁            # 可以叠：改了 CSS + 工具
  python3 tools/验证.py 图                   # 改了 www/assets/deckimg|fonts|tex
  python3 tools/验证.py --改了 www/js/scenes/editor.js www/css/v3.css
  python3 tools/验证.py 全部                 # 心里没底 / 收尾 / 出包前
  python3 tools/验证.py --清单               # 看"范围 ↔ 跑什么"

**拿不准就往上选一级**（比如动了 `data.js` 直接 `全部`）—— 省时间的前提是别再返工。
但它**不替代**两件事：`python3 app/build_catcard.py`（出包）和构建号那套同步（门禁会查）。
"""

import json
import os
import re
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # app/
ROOT = os.path.dirname(BASE)                                          # 工作区根
DECKS = os.path.join(BASE, 'decks')
TEST = os.path.join(BASE, 'test')
PY = sys.executable

RED, GRN, YEL, DIM, RST = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'

# ---------------------------------------------------------------- 范围 → 命令

def external_keys():
    """自动找出"牌面图外置"的牌组（image 以 assets/deckimg/ 开头）—— 不写死名字，不加新牌组时也不用改这里。"""
    keys = []
    if not os.path.isdir(DECKS):
        return keys
    for dn in sorted(os.listdir(DECKS)):
        p = os.path.join(DECKS, dn, 'deck.json')
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding='utf-8') as f:
                d = json.load(f)
        except Exception:
            continue
        if any(str(c.get('image', '')).startswith('assets/deckimg/') for c in d.get('cards', [])):
            keys.append(d.get('key') or dn)
    return keys


def scope_cmds(scope):
    """范围 → [(标题, argv, cwd)]。"""
    tool = lambda n: os.path.join(BASE, 'tools', n)
    T = lambda label, script: (label, ['node', script], TEST)
    out = {
        '文档': [('记录闸门', [PY, tool('查记录.py')], ROOT)],
        '门禁': [('构建门禁', [PY, tool('门禁.py')], BASE)],
        '数据': [('牌组校验', [PY, tool('内置牌组.py'), '校验'], BASE),
                 T('内置牌组走查', '走查-内置牌组.js')],
        '图':   [('构建门禁', [PY, tool('门禁.py')], BASE),
                 T('内置牌组走查', '走查-内置牌组.js')]
                + [('外置图验证 ' + k, ['node', '验证-外置资源图.js', '', k], TEST) for k in external_keys()],
        '编辑器': [T('编辑与抽牌回归', '回归-编辑与抽牌.js'), T('占卜桌走查', '走查-占卜桌选牌台.js')],
        '界面': [T('编辑与抽牌回归', '回归-编辑与抽牌.js'), T('占卜桌走查', '走查-占卜桌选牌台.js'), T('壳层与丢图走查', '走查-壳层与丢图.js')],
        '核心': [('构建门禁', [PY, tool('门禁.py')], BASE),
                 T('存储与导入回归', '回归-存储与导入.js'),
                 T('编辑与抽牌回归', '回归-编辑与抽牌.js'),
                 T('内置牌组走查', '走查-内置牌组.js'),
                 T('壳层与丢图走查', '走查-壳层与丢图.js'),
                 T('占卜桌走查', '走查-占卜桌选牌台.js')],
    }
    out['全部'] = out['核心'] + [('牌组校验', [PY, tool('内置牌组.py'), '校验'], BASE)] + out['图'][2:]
    return out.get(scope, [])          # ★ 只回这一个范围的命令（原来整个字典都返回了 —— 迭代字典拿到的是"键"）

ALL_SCOPES = ['文档', '门禁', '数据', '图', '编辑器', '界面', '核心', '全部']

# 改了哪些文件 → 该跑哪个范围（没有 git，靠人给路径；拿不准就往上选一级）
FILE_RULES = [
    (r'^app/decks/.*\.json$', '数据'),
    (r'^app/decks/.*\.md$', '文档'),
    (r'^app/www/assets/deckimg/', '图'),
    (r'^app/www/assets/(fonts|tex)/', '界面'),
    (r'^app/www/js/scenes/editor\.js$', '编辑器'),
    (r'^app/www/js/scenes/', '界面'),
    (r'^app/www/js/lot-shot\.js$', '界面'),        # 神签截图（走查在占卜桌那套的【15j】）
    (r'^app/www/js/(data|ui|io|app|idb)\.js$', '核心'),
    (r'^app/www/js/builtin-decks\.js$', '数据'),
    (r'^app/www/index\.html$', '界面'),
    (r'^app/www/css/', '界面'),
    (r'^app/tools/|^app/build_catcard\.py$', '门禁'),
    (r'\.md$', '文档'),
]

KEEP_FAIL = ('✗', '✘', '失败', '没过', '不一致', 'ERROR', 'Error', 'error:', '缺少', '没登记')


def norm(p):
    """任意写法 → 工作区相对路径（`app/...`），好套规则。"""
    p = os.path.abspath(p)
    if p.startswith(ROOT + os.sep):
        p = os.path.relpath(p, ROOT)
    return p.replace(os.sep, '/')


def scopes_from_files(files):
    hit, unknown = [], []
    for f in files:
        rel = norm(f)
        for pat, sc in FILE_RULES:
            if re.search(pat, rel):
                hit.append(sc)
                break
        else:
            unknown.append(rel)
    return hit, unknown


# ---------------------------------------------------------------- 跑

def run(title, argv, cwd):
    t0 = time.time()
    env = dict(os.environ, MOKA_QUIET='1', LANG='C.UTF-8', LC_ALL='C.UTF-8')
    try:
        p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=900)
        code, out = p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired:
        code, out = 124, '超时（900s）'
    except FileNotFoundError as e:
        code, out = 127, str(e)
    return code, out, time.time() - t0


def digest(out, ok):
    """结论那一行（成功）／含失败标记的几行（失败）。"""
    lines = [l.rstrip() for l in out.splitlines() if l.strip()]
    if ok:
        for l in reversed(lines):
            s = l.strip()
            if any(k in s for k in ('全部通过', '通过 ', '校验通过', '门禁全过', '过网', '已是最新')):
                return s
        return lines[-1].strip() if lines else '（无输出）'
    bad = [l.strip() for l in lines if any(k in l for k in KEEP_FAIL)]
    return '\n'.join(bad[:10]) if bad else ('\n'.join(lines[-6:]) if lines else '（无输出）')


def main(argv):
    args = [a for a in argv[1:]]

    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        print('可用范围：' + '、'.join(ALL_SCOPES) + '\n')
        print('当前"图外置"的牌组（自动识别）：' + ('、'.join(external_keys()) or '（无）'))
        return 0

    if args[0] == '--清单':
        print('范围 ↔ 跑什么（实测耗时按本机 2026-10-12）\n')
        for sc in ALL_SCOPES:
            cmds = scope_cmds(sc)
            print('  %-6s → %s' % (sc, ' ＋ '.join('%s' % c[0] for c in cmds)))
        print('\n按文件推断：')
        for pat, sc in FILE_RULES:
            print('  %-42s → %s' % (pat.replace('^app/', 'app/'), sc))
        return 0

    if args[0] == '--改了':
        files = args[1:]
        if not files:
            print(RED + '✗ --改了 后面要跟改动过的文件路径' + RST)
            return 2
        hit, unknown = scopes_from_files(files)
        if unknown:
            print(YEL + '⚠ 这些路径没匹配到规则，按"核心"处理（宁大勿小）：' + '、'.join(unknown) + RST)
            hit.append('核心')
        if not hit:
            print('没有匹配到范围 —— 没什么要跑的')
            return 0
        scopes = list(dict.fromkeys(hit))
        print('改了：' + '、'.join(norm(f) for f in files))
    else:
        scopes = list(dict.fromkeys(args))

    bad = [s for s in scopes if s not in ALL_SCOPES]
    if bad:
        print(RED + '✗ 不认识的范围：%s（可用：%s）' % ('、'.join(bad), '、'.join(ALL_SCOPES)) + RST)
        return 2

    # 合并命令（按标题去重，保持顺序）
    cmds, seen = [], set()
    for sc in scopes:
        for c in scope_cmds(sc):
            if c[0] not in seen:
                seen.add(c[0])
                cmds.append(c)

    print('▶ 范围：%s（%d 条命令）\n' % ('、'.join(scopes), len(cmds)))
    t_all, red = time.time(), 0
    for title, cmd, cwd in cmds:
        code, out, dt = run(title, cmd, cwd)
        ok = code == 0
        red += 0 if ok else 1
        info = digest(out, ok)
        lines = info.splitlines() or ['']
        print('  %s %-18s %5.1fs  %s' % ((GRN + '✓' + RST if ok else RED + '✗' + RST),
                                         title, dt, lines[0].strip()))
        for line in lines[1:]:                 # 失败详情接着往下排（别把第一行再抄一遍）
            print('      ' + line.strip())

    total = time.time() - t_all
    print()
    if red:
        print(RED + '✗ 有 %d 条没过（%d 条命令 / %.1fs）' % (red, len(cmds), total) + RST)
        return 1
    print(GRN + '✔ 全绿：%d 条命令 / %.1fs' % (len(cmds), total) + RST
          + DIM + '（改动范围之外的那些没跑 —— 收尾/出包前用 `全部`）' + RST)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
