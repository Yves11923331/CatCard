#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 构建号 / 版本名 **一致性自检**

为什么要有它（2026-10-12 用户抓出来的）
--------------------------------------
项目记录 §1 那句「**构建号是四处手改的**」是**手抄**——手抄的必然过期（项目自己的老规矩，
见 `decks/00-必读` §0c：「权威出处只有一个，手抄的必然过期」）。当天就过期了：

  · `index.html` 抽屉底部还写死着 `猫卡 2.1.0 · 239`，而构建号早滚到 241；
  · 用户原话：「构建号不是五处吗？应该又新加了一处」「**只写在项目记录里，似乎还不够**」。

所以**别再数"几处"了**，交给机器。它查两件事：

  ① **同步点**（常量）—— `CODE` / `versionCode` / `BUILD` / `VER` / `versionName` / `VERSION`
     这些地方必须**彼此相等**。多一处、少一处、写错一处，都在这里红。
  ② **展示串**（硬编码）—— `www/` 的 HTML 里**不许**出现写死的版本号/构建号字符串。
     要显示版本号，一律读 `MoKa.settings.VERSION / BUILD`（`app.js` 灌 `#drawer-ver` 就是范例）。

用法
----
  python3 tools/查构建号.py         # 只查；`build_catcard.py` 打包前会自动调它（红了不打包）
"""

import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # app/
BUILD_PY = os.path.join(BASE, 'build_catcard.py')

# 不扫的地方：第三方压缩件 / 二进制资源 / 构建中间产物 / 牌组数据（跟版本号无关）
SKIP_DIRS = {'build', 'out', '__pycache__', 'node_modules', 'decks', 'assets', 'fixtures', '.git'}
SKIP_FILES = {'three.min.js', 'jszip.min.js', 'cropper.min.js', '查构建号.py'}
TEXT_EXT = ('.js', '.py', '.java', '.xml', '.html', '.json', '.css')

# ★ ① 同步点：正则 → 人话名字。抓到几个就该有几个点（数量不写死，机器说了算）
# ⚠ build_catcard.py 把两个值写在**同一个元组**里（`NAME, VER, CODE = '猫卡', '2.1.0', 241`），
#   所以它的两条模式单独写；`CODE = 241` 那种独立赋值的写法也留着认。
CODE_POINTS = [
    (r"NAME\s*,\s*VER\s*,\s*CODE\s*=\s*'[^']*'\s*,\s*'[^']*'\s*,\s*(\d{2,6})",
     'build_catcard.py 的 CODE'),
    (r'\bCODE\s*=\s*(\d{2,6})\b', 'CODE = N'),
    (r'versionCode\s*=\s*"(\d{2,6})"', 'AndroidManifest 的 versionCode'),
    (r"\bBUILD\s*=\s*'(\d{2,6})'", 'BUILD 常量'),
    (r"\bBUILD\s*=\s*(\d{2,6})\b", '文案里的 BUILD = N'),
]
VER_POINTS = [
    (r"NAME\s*,\s*VER\s*,\s*CODE\s*=\s*'[^']*'\s*,\s*'([0-9][0-9.]*)'",
     'build_catcard.py 的 VER'),
    (r"\bVER\s*=\s*'([0-9][0-9.]*)'", 'VER = X.Y.Z'),
    (r'versionName\s*=\s*"([0-9][0-9.]*)"', 'AndroidManifest 的 versionName'),
    (r"\bVERSION\s*=\s*'([0-9][0-9.]*)'", 'VERSION 常量'),
    (r'版本名\s*([0-9][0-9.]*)', '文案里的「版本名 X.Y.Z」'),
]

# ★ ② 展示串：只扫 HTML —— JS 里的历史注释会提到老版本号（那是记录，不是手改点）
DISPLAY_POINTS = [
    (r'猫卡\s*v?\d+\.\d+\.\d+(?:\s*[·・]\s*\d{1,5})?', '写死的「猫卡 X.Y.Z · 构建号」'),
    (r'\bv\d+\.\d+\.\d+\b', '写死的 vX.Y.Z'),
]

RED, GRN, YEL, DIM, RST = '\033[31m', '\033[32m', '\033[33m', '\033[2m', '\033[0m'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def truth():
    """权威出处：`build_catcard.py` 的 CODE / VER —— 别的点都对着它比。"""
    src = read(BUILD_PY)
    m = re.search(r"NAME\s*,\s*VER\s*,\s*CODE\s*=\s*'[^']*'\s*,\s*'[^']*'\s*,\s*(\d{2,6})", src)
    v = re.search(r"NAME\s*,\s*VER\s*,\s*CODE\s*=\s*'[^']*'\s*,\s*'([0-9][0-9.]*)'", src)
    if not m or not v:
        print(RED + '✗ 读不出 build_catcard.py 的 CODE / VER（它改写法了？）' + RST)
        sys.exit(1)
    return m.group(1), v.group(1)


def walk():
    for root, dirs, files in os.walk(BASE):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for f in sorted(files):
            if f in SKIP_FILES or not f.endswith(TEXT_EXT):
                continue
            yield os.path.join(root, f)


def scan():
    code, ver = truth()
    hits, display, files = [], [], 0
    for p in walk():
        rel = os.path.relpath(p, BASE)
        try:
            src = read(p)
        except (UnicodeDecodeError, OSError):
            continue
        files += 1
        for pat, label in CODE_POINTS:
            for m in re.finditer(pat, src):
                line = src.count('\n', 0, m.start()) + 1
                hits.append(('code', rel, line, m.group(1), label))
        for pat, label in VER_POINTS:
            for m in re.finditer(pat, src):
                line = src.count('\n', 0, m.start()) + 1
                hits.append(('ver', rel, line, m.group(1), label))
        if p.endswith(('.html',)):
            for pat, label in DISPLAY_POINTS:
                for m in re.finditer(pat, src):
                    line = src.count('\n', 0, m.start()) + 1
                    display.append((rel, line, m.group(0), label))
    return code, ver, hits, display, files


def main():
    code, ver, hits, display, files = scan()
    bad = 0

    print('权威出处：build_catcard.py → CODE = %s · VER = %s' % (code, ver))
    print('扫了 %d 个文件，找到同步点 %d 处、HTML 展示串 %d 处\n' % (files, len(hits), len(display)))

    by_code = [h for h in hits if h[0] == 'code']
    by_ver = [h for h in hits if h[0] == 'ver']
    for title, group, want, label in (('构建号', by_code, code, 'CODE'), ('版本名', by_ver, ver, 'VER')):
        print('%s（%d 处，都该等于 %s = %s）：' % (title, len(group), label, want))
        for _k, rel, line, val, name in group:
            mark = GRN + '✓' + RST if val == want else RED + '✗' + RST
            if val != want:
                bad += 1
            print('  %s %-42s :%d  %s  %s' % (mark, rel, line, val, DIM + name + RST))
        if not group:
            print('  ' + RED + '✗ 一处都没找到 —— 同步点被删/改写法了？' + RST)
            bad += 1
        print()

    if display:
        print('HTML 里写死的版本号（一条都不许有）：')
        for rel, line, txt, label in display:
            bad += 1
            print('  ' + RED + '✗' + RST + ' %-42s :%d  %s  %s' % (rel, line, repr(txt), DIM + label + RST))
        print('  ' + YEL + '要显示版本号 → 读 MoKa.settings.VERSION / BUILD（app.js 灌 #drawer-ver 就是范例）' + RST)
        print()

    if bad:
        print(RED + '✗ 构建号自检没过：%d 处' % bad + RST)
        return 1
    print(GRN + '✓ 构建号自检通过：%s 处同步点全都 = %s / %s，HTML 里没有写死的版本号'
          % (len(hits), code, ver) + RST)
    return 0


if __name__ == '__main__':
    sys.exit(main())
