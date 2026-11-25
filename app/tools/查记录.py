#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 记录过滤网检查（规矩见 `项目记录.md` §0）

背景：用户 2026-10-12 说「**不要啥玩意儿都往里面写**」——
两页文档（`项目记录.md` 速查卡 / `变更日志.md` 历史）立了写入规矩。
这个脚本只做**机械判得了**的四件事，判不了的主观内容不猜：

  ① 速查卡整页 ≤ 300 行（超了先删旧账，别加新账）；
  ② 速查卡 §6「最近两轮」每条 ≤ 20 行；
  ③ `变更日志.md` 里**构建号 ≥ BASELINE** 的条目 ≤ 12 行（更老的条目不回炉，不查）；
  ④ 这些新条目里不许出现空话词（待优化 / 已完成 / 后续再看 / TODO）—— 不指向动作的话不配占行。

BASELINE = 规矩从哪一版起生效。再往后的新条目都照此检查，不用改这里（除非要给老条目也立规矩）。

用法：
    python3 app/tools/查记录.py          # 全绿 exit 0；有违规 exit 1 并列出条目名
"""
import io
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))    # app/tools
APP = os.path.dirname(BASE)                          # app
ROOT = os.path.dirname(APP)                          # 猫卡（两页文档在这儿）
QUICK = os.path.join(ROOT, '项目记录.md')
LOG = os.path.join(ROOT, '变更日志.md')

QUICK_MAX = 300        # 速查卡整页上限
SEC6_MAX = 20          # §6 每条上限
ENTRY_MAX = 12         # 日志新条目上限
BASELINE = 238         # 构建号 ≥ 它的日志条目才受 ③④ 约束
FILLER = ['待优化', '已完成', '后续再看', 'TODO']

problems = []


def lines_of(path):
    if not os.path.exists(path):
        problems.append('找不到文件：' + path)
        return []
    return io.open(path, encoding='utf-8').read().split('\n')


def entries(lines):
    """按 `### ` 切条目 → [(名字, 行列表)]（不含标题行本身）"""
    out, name, cur = [], None, []
    for l in lines:
        if l.startswith('### '):
            if name is not None:
                out.append((name, cur))
            name, cur = l[4:].strip(), []
        elif name is not None:
            cur.append(l)
    if name is not None:
        out.append((name, cur))
    return out


def section(lines, start_pat, end_pat):
    """取 [start_pat 行, end_pat 行) 之间的内容（含 start 标题）"""
    a = b = None
    for i, l in enumerate(lines):
        if a is None and re.match(start_pat, l):
            a = i
        elif a is not None and re.match(end_pat, l):
            b = i
            break
    return lines[a:b] if a is not None else []


def check():
    quick = lines_of(QUICK)
    log = lines_of(LOG)
    if problems:
        return

    # ① 速查卡整页
    if len(quick) > QUICK_MAX:
        problems.append('速查卡 %d 行 > %d 行上限（先删旧账再写字）' % (len(quick), QUICK_MAX))

    # ② 速查卡 §6 每条
    sec6 = section(quick, r'^##\s*6\.', r'^##\s*7\.')
    for name, body in entries(sec6):
        n = len(body) + 1
        if n > SEC6_MAX:
            problems.append('速查卡 §6「%s」%d 行 > %d 行' % (name[:34], n, SEC6_MAX))

    # ③④ 日志新条目
    checked = 0
    for name, body in entries(log):
        m = re.search(r'构建\s*(\d+)', name)
        if not m or int(m.group(1)) < BASELINE:
            continue
        checked += 1
        n = len(body) + 1
        if n > ENTRY_MAX:
            problems.append('变更日志「%s」%d 行 > %d 行' % (name[:34], n, ENTRY_MAX))
        for w in FILLER:
            if any(w in l for l in body):
                problems.append('变更日志「%s」出现空话词「%s」' % (name[:34], w))

    print('查记录：速查卡 %d 行（≤%d）；§6 %d 条；日志新条目（构建 ≥%d）%d 条'
          % (len(quick), QUICK_MAX, len(entries(sec6)), BASELINE, checked))


check()
if problems:
    print('✘ 过滤网拦下 %d 条：' % len(problems))
    for p in problems:
        print('   · ' + p)
    sys.exit(1)
print('✔ 两页都过网')
