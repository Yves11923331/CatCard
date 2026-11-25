#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · **构建门禁**（打包前必须全绿的那几件事）

一个入口，`build_catcard.py` 打包前调它一次；红了就不出包。现在守三条：

  ① **注册表一致** —— `decks/*.json` ↔ `www/js/builtin-decks.js`
     （改了 JSON 忘了跑「生成」；`www/` 是唯一进包的目录，注册表不同步＝包里是旧内容）
  ② **构建号 / 版本名一致** —— 全工程的同步点都等于 `build_catcard.py` 的 `CODE` / `VER`，
     且 HTML 里不许写死版本号（`tools/查构建号.py` 说了算 —— 它会把"几处"数出来）
  ③ **专属补丁都登记了** —— 每副进包牌组的**专属补丁**（代码里的硬引用、专属模板、专属样式…）
     必须在 `tools/内置牌组.py` 的 `DECK_PATCHES` 里登记

为什么 ③ 要进门禁：这条规则原来只写在 `decks/00-必读-内置牌组增删流程.md` §0c
（"专属补丁跟着牌的文件走"）＋ 走查第 7 组 —— 而**走查是人跑的，构建不跑**。
用户原话：「我记得增删流程里面也有一条规则 —— 这是补丁，必须跟着牌的文件走，这个也写入门禁吧」。
删/下架时漏清一处专属补丁（比如周易桌按 `builtinKey === 'zy64'` 找牌组），
功能会**静静坏掉**、不报错 —— 所以它必须挡在构建门口，而不是等人想起来。

用法：
  python3 tools/门禁.py        # 全绿退出 0；任意一条红就退出 1
"""

import importlib.util
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # app/
TOOLS = os.path.join(BASE, 'tools')
ENV = dict(os.environ, LANG='C.UTF-8', LC_ALL='C.UTF-8')

RED, GRN, YEL, DIM, RST = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'


def load_builtin_tool():
    """把 `内置牌组.py` 当模块载入 —— 直接拿它的 DECK_PATCHES / load_decks()，
    **不手抄**那份表（项目老规矩：手抄的必然过期，见 00 §0c）。"""
    spec = importlib.util.spec_from_file_location(
        'moka_builtin_decks', os.path.join(TOOLS, '内置牌组.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)          # 它只在 __main__ 里跑 main()，import 无副作用
    return mod


def run_tool(name, *args):
    p = subprocess.run([sys.executable, os.path.join(TOOLS, name)] + list(args),
                       capture_output=True, text=True, env=ENV)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def gate_registry():
    code, out = run_tool('内置牌组.py', '生成', '--检查')
    if code != 0:
        return False, ["注册表与 decks/*.json 不一致 —— 跑：python3 app/tools/内置牌组.py 生成"]
    return True, [l for l in out.strip().splitlines() if l.strip()][:2]


def gate_build_number():
    """构建号 / 版本名 —— 明细由 `查构建号.py` 打（它就是干这个的），这里只转发它的结论。"""
    code, out = run_tool('查构建号.py')
    lines = [l for l in out.strip().splitlines() if l.strip()]
    if code != 0:
        return False, lines
    return True, [lines[-1]] if lines else []


def gate_patches():
    """专属补丁登记：进包的每副牌组都要在 DECK_PATCHES 里有条目（有补丁写补丁，没有写空表）。"""
    mod = load_builtin_tool()
    try:
        skip = set(mod.not_packed())
    except Exception:
        skip = set()
    keys = []
    for _path, deck in mod.load_decks():
        k = deck.get('key')
        if k and k not in skip:
            keys.append(k)
    unknown = set(mod.DECK_PATCHES) - set(keys) - skip
    missing = [k for k in keys if k not in mod.DECK_PATCHES]
    msgs = []
    if missing:
        msgs.append('没登记专属补丁：%s → 在 tools/内置牌组.py 的 DECK_PATCHES 里加一条'
                    '（真没有就写空列表并注明，见 00 §0c）' % '、'.join(missing))
    if unknown:
        msgs.append('登记了不存在的 key：%s → 牌组已删/改名，这条留着就是死行' % '、'.join(sorted(unknown)))
    if msgs:
        return False, msgs
    return True, ['%d 副进包牌组的专属补丁都登记了（%s）' % (len(keys), '、'.join(keys))]


GATES = [
    ('① 注册表一致', gate_registry),
    ('② 构建号 / 版本名一致', gate_build_number),
    ('③ 专属补丁都登记了', gate_patches),
]


def main():
    print('猫卡 · 构建门禁（三条，全绿才打包）')
    bad = 0
    for title, fn in GATES:
        try:
            ok, detail = fn()
        except Exception as e:                      # 门禁自己崩了也要算红，不许"装作过了"
            ok, detail = False, ['门禁自身出错：%s' % e]
        print('\n%s %s' % (GRN + '✓' + RST if ok else RED + '✗' + RST, title))
        for line in detail:
            print(('   ' + (DIM if ok else RED)) + line + RST)
        if not ok:
            bad += 1
    print()
    if bad:
        print(RED + '✗ 门禁没过（%d / %d 条）—— 修完再打包' % (bad, len(GATES)) + RST)
        return 1
    print(GRN + '✓ 门禁全过（%d / %d 条）' % (len(GATES), len(GATES)) + RST)
    return 0


if __name__ == '__main__':
    sys.exit(main())
