#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 周易经部数据管线（解析 → 校验 → 生成）

一句话：把用户的《周易》参考材料（markdown）解析成权威数据，
        产出 `app/data/zhouyi.json` 与编译进包的 `app/www/js/builtin-zhouyi.js`。

数据流向（**单向**，脚本是唯一的生成入口）：

    /sdcard/魔门有仙气/周易古经占_参考.md   ← 材料（只读，绝不修改）
    app/decks/易经牌组.json                  ← 现成牌组（只读，只用来做「卦画」交叉校验）
                     │
                     │  python3 app/tools/gen_zhouyi.py
                     ▼
    app/data/zhouyi.json                     （权威数据）
    app/www/js/builtin-zhouyi.js             （= zhouyi.json 的内联副本，给 www 用）

用法：
    python3 app/tools/gen_zhouyi.py            # 解析 + 自检 + 写两个文件
    python3 app/tools/gen_zhouyi.py --check    # 只比对，不一致 exit 1 并指出第一处不同
    python3 app/tools/gen_zhouyi.py --help

自检是**硬断言**：任何一条不过就 exit 1，并且**一个文件都不写**。
断言里刻意有一条与卦名字面完全无关的校验（见 `check_deck_art`）：
把牌组每张卡的 `art`（六爻卦画 SVG）按 y 解成阴阳串，与脚本里硬编码的
「通行本卦序 → 上下卦」表逐位比对，64/64 全对才算过。

只用标准库。
"""
import argparse
import json
import os
import re
import sys

# ---------------------------------------------------------------- 路径

HERE = os.path.dirname(os.path.abspath(__file__))          # app/tools
APP = os.path.dirname(HERE)                                # app/
REPO = os.path.dirname(APP)                                # 猫卡/
DEFAULT_SRC = os.path.join(os.path.dirname(REPO), "周易古经占_参考.md")
DEFAULT_DECK = os.path.join(APP, "decks", "易经牌组.json")
DEFAULT_JSON = os.path.join(APP, "data", "zhouyi.json")
DEFAULT_JS = os.path.join(APP, "www", "js", "builtin-zhouyi.js")

FORMAT = "moka-zhouyi/1"
GLOBAL_NAME = "MoKaBuiltinZhouyi"

# ---------------------------------------------------------------- 常量

# 标注符号：材料里一个都不能丢
NOTE_SYMS = ("〔异文〕", "〔异解〕", "〔待考〕")

# 爻题（386 条）＋ 乾坤各多一条用爻
YAO_LABELS = ("初九", "九二", "九三", "九四", "九五", "上九",
              "初六", "六二", "六三", "六四", "六五", "上六",
              "用九", "用六")

# 材料条目数（防漏条）：64 卦名 ＋ 64 卦辞 ＋ 386 爻辞 = 514 条 `**`
EXPECT_BOLD = 514
EXPECT_HEX = 64
EXPECT_YAO = 386

# 通行本卦名之外另有异名者（材料里只有一处：遁 → 遯）
ALIASES = {33: "遯"}

# 八卦：三爻，自下而上，1=阳 0=阴
TRIGRAMS = {
    "乾": "111", "兑": "110", "离": "101", "震": "100",
    "巽": "011", "坎": "010", "艮": "001", "坤": "000",
}

# 通行本（周易）卦序 → (下卦, 上卦)。
# ★ 这张表是"与卦名字面无关"的那把尺：下面按卦序解出来的六位阴阳串
#   必须与牌组 art 解出来的逐位相同，而不是靠比名字。
KINGWEN = [
    ("乾", "乾"),  # 1  乾为天
    ("坤", "坤"),  # 2  坤为地
    ("震", "坎"),  # 3  水雷屯
    ("坎", "艮"),  # 4  山水蒙
    ("乾", "坎"),  # 5  水天需
    ("坎", "乾"),  # 6  天水讼
    ("坎", "坤"),  # 7  地水师
    ("坤", "坎"),  # 8  水地比
    ("乾", "巽"),  # 9  风天小畜
    ("兑", "乾"),  # 10 天泽履
    ("乾", "坤"),  # 11 地天泰
    ("坤", "乾"),  # 12 天地否
    ("离", "乾"),  # 13 天火同人
    ("乾", "离"),  # 14 火天大有
    ("艮", "坤"),  # 15 地山谦
    ("坤", "震"),  # 16 雷地豫
    ("震", "兑"),  # 17 泽雷随
    ("巽", "艮"),  # 18 山风蛊
    ("兑", "坤"),  # 19 地泽临
    ("坤", "巽"),  # 20 风地观
    ("震", "离"),  # 21 火雷噬嗑
    ("离", "艮"),  # 22 山火贲
    ("坤", "艮"),  # 23 山地剥
    ("震", "坤"),  # 24 地雷复
    ("震", "乾"),  # 25 天雷无妄
    ("乾", "艮"),  # 26 山天大畜
    ("震", "艮"),  # 27 山雷颐
    ("巽", "兑"),  # 28 泽风大过
    ("坎", "坎"),  # 29 坎为水
    ("离", "离"),  # 30 离为火
    ("艮", "兑"),  # 31 泽山咸
    ("巽", "震"),  # 32 雷风恒
    ("艮", "乾"),  # 33 天山遁
    ("乾", "震"),  # 34 雷天大壮
    ("坤", "离"),  # 35 火地晋
    ("离", "坤"),  # 36 地火明夷
    ("离", "巽"),  # 37 风火家人
    ("兑", "离"),  # 38 火泽睽
    ("艮", "坎"),  # 39 水山蹇
    ("坎", "震"),  # 40 雷水解
    ("兑", "艮"),  # 41 山泽损
    ("震", "巽"),  # 42 风雷益
    ("乾", "兑"),  # 43 泽天夬
    ("巽", "乾"),  # 44 天风姤
    ("坤", "兑"),  # 45 泽地萃
    ("巽", "坤"),  # 46 地风升
    ("坎", "兑"),  # 47 泽水困
    ("巽", "坎"),  # 48 水风井
    ("离", "兑"),  # 49 泽火革
    ("巽", "离"),  # 50 火风鼎
    ("震", "震"),  # 51 震为雷
    ("艮", "艮"),  # 52 艮为山
    ("艮", "巽"),  # 53 风山渐
    ("兑", "震"),  # 54 雷泽归妹
    ("离", "震"),  # 55 雷火丰
    ("艮", "离"),  # 56 火山旅
    ("巽", "巽"),  # 57 巽为风
    ("兑", "兑"),  # 58 兑为泽
    ("坎", "巽"),  # 59 风水涣
    ("兑", "坎"),  # 60 水泽节
    ("兑", "巽"),  # 61 风泽中孚
    ("艮", "震"),  # 62 雷山小过
    ("离", "坎"),  # 63 水火既济
    ("坎", "离"),  # 64 火水未济
]

# ---------------------------------------------------------------- 正则

HEX_HEAD_RE = re.compile(r"^## ([\u4dc0-\u4dff]) (\S+) ([^（]+?)(?:（([^）]+)）)?$")
GLOSS_RE = re.compile(r"^\*\*【卦名】\*\*(.*)$")
INSP_RE = re.compile(r"^> 启发：(.*)$")
GUA_RE = re.compile(r"^\*\*卦辞：(.*?)\*\*(.*)$")
YAO_RE = re.compile(r"^\*\*([^：*]{1,4})：(.*?)\*\*(.*)$")
YI_RE = re.compile(r"^译：(.*)$")
PY_RE = re.compile(r"^[A-Za-z\u00c0-\u024f ]+$")
LINE_RE = re.compile(
    r"<line\b[^>]*?x1=\"(-?[\d.]+)\"[^>]*?y1=\"(-?[\d.]+)\""
    r"[^>]*?x2=\"(-?[\d.]+)\"[^>]*?y2=\"(-?[\d.]+)\""
)

FULL_WIDTH = 15.0   # 通栏爻线的宽度（实测 18.46）
HALF_WIDTH = 7.07   # 断开爻线的每段宽度（实测）


class ParseError(Exception):
    """材料不符合预期结构 —— 直接报错退出，绝不用旧数据兜底。"""


def kingwen_bits(no):
    """通行本卦序 → 六位阴阳串（自下而上，1=阳 0=阴；先下卦三爻，再上卦三爻）。"""
    lower, upper = KINGWEN[no - 1]
    return TRIGRAMS[lower] + TRIGRAMS[upper]


def expect_yao_labels(no):
    """由上下卦推出的爻题序列（初九/六二/…/上六，乾坤另加用九/用六）。"""
    bits = kingwen_bits(no)
    out = []
    for i, b in enumerate(bits):
        yy = "九" if b == "1" else "六"
        if i == 0:
            out.append("初" + yy)
        elif i == 5:
            out.append("上" + yy)
        else:
            out.append(yy + "二三四五"[i - 1])
    if no == 1:
        out.append("用九")
    if no == 2:
        out.append("用六")
    return out


# ---------------------------------------------------------------- 材料读取

def read_text(path, what):
    """读材料，丢了/空了直接报错退出（不允许静默用旧数据重建）。"""
    if not os.path.isfile(path):
        raise ParseError(
            "找不到%s：%s\n"
            "  这是数据管线的输入，必须存在；本脚本绝不拿旧的生成物兜底。"
            "可用 --src / --deck 指定。" % (what, path)
        )
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if not text.strip():
        raise ParseError("%s是空文件：%s" % (what, path))
    return text


def find_line(lines, pattern, what):
    rx = re.compile(pattern)
    for i, ln in enumerate(lines):
        if rx.match(ln.strip()):
            return i
    raise ParseError("材料里找不到 %s（按 %r 匹配）" % (what, pattern))


def slice_section(lines, start, stop_pattern=r"^#{1,2} |^---$"):
    """从 start（含标题行）向后取内容，直到下一个标题 / 分隔线。"""
    rx = re.compile(stop_pattern)
    body = []
    i = start + 1
    while i < len(lines):
        if rx.match(lines[i].strip()):
            break
        body.append(lines[i])
        i += 1
    return body


def join_raw(lines):
    """原文保留：去掉首尾空行，逐行 rstrip（不动行内任何字符）。"""
    out = [ln.rstrip() for ln in lines]
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out)


def table_rows(lines):
    """markdown 表格 → [[cell, ...], ...]（跳过表头分隔行）。"""
    rows = []
    for ln in lines:
        s = ln.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append(cells)
    return rows


# ---------------------------------------------------------------- 解析

def parse_meta(lines, up_i, idx_i):
    """体例 / 兆辞表 / 帛书对照表 / 索引表 / 参考来源 —— 原文整块收进 meta。"""
    def sec(pattern, what):
        start = find_line(lines, pattern, what)
        return start, join_raw(slice_section(lines, start))

    ti_i, ti_raw = sec(r"^## 体例$", "「体例」小节")
    tm_i, tm_raw = sec(r"^## 核心术语", "「核心术语·兆辞一览」小节")
    bs_i, bs_raw = sec(r"^## 六十四卦卦名古今对照表", "「六十四卦卦名古今对照表」小节")
    src_i, src_raw = sec(r"^## 主要参考", "「主要参考（考据来源）」小节")

    # 体例：逐条
    ti_items = []
    for ln in lines[ti_i + 1:tm_i]:
        m = re.match(r"^-\s+\*\*(.+?)\*\*：\s*(.*)$", ln.strip())
        if m:
            ti_items.append({"label": m.group(1), "text": m.group(2)})
    if not ti_items:
        raise ParseError("「体例」小节没解析出条目")

    # 兆辞一览表
    tm_lines = lines[tm_i + 1:bs_i]
    tm_rows = table_rows(tm_lines)
    terms = []
    for r in tm_rows:
        if len(r) != 3:
            raise ParseError("兆辞一览表列数不是 3：%r" % (r,))
        if r[0] == "术语":
            continue
        terms.append({"term": r[0], "kaoju": r[1], "old": r[2]})
    tm_note = ""
    for ln in tm_lines:
        m = re.match(r"^>\s*(.*)$", ln.strip())
        if m:
            tm_note = m.group(1)
    if len(terms) != 12 or not tm_note:
        raise ParseError("兆辞一览表解析异常：%d 行 / 说明=%r" % (len(terms), tm_note[:20]))

    # 帛书卦名对照表（一行两半：1-32 在左，33-64 在右）
    bs_lines = lines[bs_i:idx_i]
    bs_rows = table_rows(bs_lines)
    boshu = {}
    for r in bs_rows:
        if len(r) != 6:
            raise ParseError("帛书对照表列数不是 6：%r" % (r,))
        if r[0] == "卦序":
            continue
        for k in (0, 3):
            no, name, bs = r[k], r[k + 1], r[k + 2]
            if not no.isdigit():
                raise ParseError("帛书对照表卦序不是数字：%r" % (no,))
            boshu[int(no)] = {"name": name, "boshu": bs}
    bs_caption = ""
    for ln in lines[bs_i + 1:]:
        s = ln.strip()
        if not s:
            continue
        if not s.startswith("|"):
            bs_caption = s
        break
    if not bs_caption:
        raise ParseError("「六十四卦卦名古今对照表」没解析到表说明")
    if len(boshu) != EXPECT_HEX or sorted(boshu) != list(range(1, EXPECT_HEX + 1)):
        raise ParseError("帛书对照表不是 1~64 齐全：%d 条" % len(boshu))

    # 索引表（一行两半：8 列；raw 不含标题行，与别的小节一致）
    idx_lines = slice_section(lines, idx_i)
    idx_rows = table_rows(idx_lines)
    index = {}
    for r in idx_rows:
        if len(r) != 8:
            raise ParseError("索引表列数不是 8：%r" % (r,))
        if r[0] == "卦序":
            continue
        for k in (0, 4):
            no, glyph, name, py = r[k], r[k + 1], r[k + 2], r[k + 3]
            if not no.isdigit():
                raise ParseError("索引表卦序不是数字：%r" % (no,))
            index[int(no)] = {"glyph": glyph, "name": name, "py": py}
    if len(index) != EXPECT_HEX or sorted(index) != list(range(1, EXPECT_HEX + 1)):
        raise ParseError("索引表不是 1~64 齐全：%d 条" % len(index))

    sources = []
    for ln in lines[src_i + 1:]:
        m = re.match(r"^-\s+(.*)$", ln.strip())
        if m:
            sources.append(m.group(1))
    src_note = ""
    for ln in lines[src_i + 1:]:
        m = re.match(r"^>\s*(.*)$", ln.strip())
        if m:
            src_note = m.group(1)
    if not sources or not src_note:
        raise ParseError("「主要参考」小节解析异常")

    return {
        "tiLi": {"heading": "体例", "raw": ti_raw, "items": ti_items},
        "terms": {"heading": "核心术语·兆辞一览", "raw": tm_raw, "rows": terms, "note": tm_note},
        "guNameTable": {"heading": "六十四卦卦名古今对照表", "raw": bs_raw,
                        "caption": bs_caption,
                        "rows": [{"no": n, "name": boshu[n]["name"], "boshu": boshu[n]["boshu"]}
                                 for n in range(1, EXPECT_HEX + 1)]},
        "index": {"heading": "六十四卦索引", "raw": join_raw(idx_lines),
                  "rows": [{"no": n, "glyph": index[n]["glyph"], "name": index[n]["name"],
                            "py": index[n]["py"]} for n in range(1, EXPECT_HEX + 1)]},
        "sources": {"heading": "主要参考（考据来源）", "raw": src_raw,
                    "items": sources, "note": src_note},
    }


def split_note(text):
    """把译文里结尾的 〔…〕 标注切出来（标注绝不能拼进译文）。"""
    idx = text.find("〔")
    if idx < 0:
        return text.strip(), ""
    tr, note = text[:idx].strip(), text[idx:].strip()
    if not any(note.startswith(sym) for sym in NOTE_SYMS):
        raise ParseError("疑似标注但开头不是 %s：%r" % ("/".join(NOTE_SYMS), note[:30]))
    return tr, note


def split_hexagrams(body_lines, base_lineno):
    """按 `## ䷀ 乾 qián` 标题切段，段间别的行一概不许出现。"""
    sections = []
    cur = None
    for off, raw in enumerate(body_lines):
        lineno = base_lineno + off
        s = raw.strip()
        if s.startswith("## "):
            if not HEX_HEAD_RE.match(s):
                raise ParseError("第 %d 行：卦标题不符合「## 卦画 卦名 拼音」：%r" % (lineno, s))
            if cur is not None:
                sections.append(cur)
            cur = {"head": s, "lineno": lineno, "lines": []}
            continue
        if s.startswith("# "):
            if not re.match(r"^# (上经|下经)", s):
                raise ParseError("第 %d 行：正文里出现预期外的标题：%r" % (lineno, s))
            if cur is not None:
                sections.append(cur)
                cur = None
            continue
        if cur is not None:
            cur["lines"].append((lineno, raw))
    if cur is not None:
        sections.append(cur)
    if len(sections) != EXPECT_HEX:
        raise ParseError("正文解析出 %d 卦（应为 %d）" % (len(sections), EXPECT_HEX))
    return sections


def parse_section(sec, no):
    """单卦段落 → 一条 hexagram 记录。任何不认识的行都直接报错（防静默漏条）。"""
    lines = sec["lines"]
    n = len(lines)
    rec = {"no": no, "glyph": "", "name": "", "py": "", "alias": "",
           "gloss": "", "insp": "", "gua": "", "guaTr": "", "guaNotes": [], "yaos": []}

    def next_nonblank(k):
        while k < n and not lines[k][1].strip():
            k += 1
        return k

    def take_translation(after, i, what):
        """取 `译：…`（同一行或紧邻的下一行），返回 (tr, note, 新下标)。"""
        j = next_nonblank(i)
        if j >= n:
            raise ParseError("第 %d 行：%s 后面没有译文行" % (after, what))
        m = YI_RE.match(lines[j][1].strip())
        if not m:
            raise ParseError("第 %d 行：%s 后面不是「译：」行：%r"
                             % (lines[j][0], what, lines[j][1].strip()[:40]))
        tr, note = split_note(m.group(1))
        return tr, note, j + 1

    i = 0
    while i < n:
        lineno, raw = lines[i]
        s = raw.strip()
        i += 1
        if not s or s == "---":
            continue

        m = GLOSS_RE.match(s)
        if m:
            if rec["gloss"]:
                raise ParseError("第 %d 行：重复的【卦名】" % lineno)
            # 只存"那段"本身，不带 `**【卦名】**` 标记（渲染时由界面加小标题）
            rec["gloss"] = m.group(1).strip()
            continue

        m = INSP_RE.match(s)
        if m:
            if rec["insp"]:
                raise ParseError("第 %d 行：重复的启发" % lineno)
            # 只存"那句"本身，不带 `启发：` 前缀
            rec["insp"] = m.group(1).strip()
            continue

        m = GUA_RE.match(s)
        if m:
            if rec["gua"]:
                raise ParseError("第 %d 行：重复的卦辞" % lineno)
            rec["gua"] = m.group(1).strip()
            rest = m.group(2)
            inline = YI_RE.match(rest.strip()) if rest.strip() else None
            if inline:
                tr, note = split_note(inline.group(1))
            else:
                if rest.strip():
                    raise ParseError("第 %d 行：卦辞后的内容不认识：%r" % (lineno, rest[:40]))
                tr, note, i = take_translation(lineno, i, "卦辞")
            rec["guaTr"] = tr
            if note:
                rec["guaNotes"].append(note)
            while True:                       # 卦辞的〔…〕可能另起一行（乾/坤）
                j = next_nonblank(i)
                if j < n and lines[j][1].strip().startswith("〔"):
                    rec["guaNotes"].append(lines[j][1].strip())
                    i = j + 1
                else:
                    break
            continue

        m = YAO_RE.match(s)
        if m:
            label, text, rest = m.group(1), m.group(2), m.group(3)
            if label not in YAO_LABELS:
                raise ParseError("第 %d 行：爻题不认识：%r" % (lineno, label))
            if "**" in text or not text.strip():
                raise ParseError("第 %d 行：爻辞原文异常：%r" % (lineno, text[:40]))
            inline = YI_RE.match(rest.strip()) if rest.strip() else None
            if inline:
                tr, note = split_note(inline.group(1))
            else:
                if rest.strip():
                    raise ParseError("第 %d 行：爻辞后的内容不认识：%r" % (lineno, rest[:40]))
                tr, note, i = take_translation(lineno, i, label)
            rec["yaos"].append({"label": label, "text": text.strip(), "tr": tr,
                                "note": note, "special": label in ("用九", "用六")})
            while True:                       # 爻辞标注若另起一行，也接上
                j = next_nonblank(i)
                if j < n and lines[j][1].strip().startswith("〔"):
                    extra = lines[j][1].strip()
                    rec["yaos"][-1]["note"] = (rec["yaos"][-1]["note"] + extra).strip()
                    i = j + 1
                else:
                    break
            continue

        raise ParseError("第 %d 行：卦段落里出现无法解析的行：%r" % (lineno, s[:60]))

    # ---- 单卦硬断言
    m = HEX_HEAD_RE.match(sec["head"])
    rec["glyph"], rec["name"], rec["py"], rec["alias"] = (
        m.group(1), m.group(2), m.group(3).strip(), (m.group(4) or "").strip())
    want_alias = ALIASES.get(rec["no"], "")
    if rec["alias"] != want_alias:
        raise ParseError("卦序 %d（%s）：异名 alias=%r，应为 %r（材料里只有「遁（遯）」一处）"
                         % (rec["no"], rec["name"], rec["alias"], want_alias))
    if not PY_RE.match(rec["py"]):
        raise ParseError("%s：拼音形态异常 %r" % (rec["name"], rec["py"]))
    for field in ("gloss", "insp", "gua", "guaTr"):
        if not rec[field]:
            raise ParseError("第 %d 卦（%s）：%s 为空" % (rec["no"], rec["name"], field))
    want = 7 if rec["no"] in (1, 2) else 6
    if len(rec["yaos"]) != want:
        raise ParseError("%s：爻 %d 条，应为 %d 条" % (rec["name"], len(rec["yaos"]), want))
    first = rec["yaos"][0]["label"]
    if first not in ("初九", "初六"):
        raise ParseError("%s：初爻爻题异常 %r" % (rec["name"], first))
    seq = expect_yao_labels(rec["no"])
    got = [y["label"] for y in rec["yaos"]]
    if got != seq:
        raise ParseError("%s：爻题顺序不对\n  期望 %s\n  实际 %s" % (rec["name"], seq, got))
    for y in rec["yaos"]:
        if not y["text"] or not y["tr"]:
            raise ParseError("%s·%s：原文或译文为空" % (rec["name"], y["label"]))
        if "**" in y["tr"] or "**" in y["note"]:
            raise ParseError("%s·%s：译文里残留 markdown 粗体" % (rec["name"], y["label"]))
    if rec["no"] == 1 and "用九" not in got:
        raise ParseError("乾：缺用九")
    if rec["no"] == 2 and "用六" not in got:
        raise ParseError("坤：缺用六")
    return rec


# ---------------------------------------------------------------- 自检

def check_glyph_order(hexes):
    for h in hexes:
        want = chr(0x4DC0 + h["no"] - 1)
        if h["glyph"] != want:
            raise ParseError("卦序 %d：卦画 %r ≠ chr(0x4DC0+no-1)=%r"
                             % (h["no"], h["glyph"], want))


def check_index(hexes, meta):
    """索引表 / 帛书对照表 与 正文标题 三方对齐。"""
    idx = {r["no"]: r for r in meta["index"]["rows"]}
    bs = {r["no"]: r for r in meta["guNameTable"]["rows"]}
    for h in hexes:
        r = idx[h["no"]]
        if (r["glyph"], r["name"], r["py"]) != (h["glyph"], h["name"], h["py"]):
            raise ParseError("卦序 %d：索引表 %r 与正文 %r 不一致"
                             % (h["no"], (r["glyph"], r["name"], r["py"]),
                                (h["glyph"], h["name"], h["py"])))
        if bs[h["no"]]["name"] != h["name"]:
            raise ParseError("卦序 %d：帛书表通行本名 %r ≠ 正文 %r"
                             % (h["no"], bs[h["no"]]["name"], h["name"]))


def decode_art_bits(art, name, no):
    """把牌组 art 里的 <line> 解成自下而上的 6 位阴阳串。
    一条通栏长线 = 阳(1)；同一 y 上断开成两段短线 = 阴(0)。"""
    rows = {}
    for m in LINE_RE.finditer(art):
        x1, y1, x2, y2 = (float(v) for v in m.groups())
        if abs(y1 - y2) > 1e-6:
            raise ParseError("牌组第 %d 张（%s）：爻线不是水平线（y1=%s y2=%s）"
                             % (no, name, y1, y2))
        rows.setdefault(round(y1, 2), []).append(abs(x2 - x1))
    if len(rows) != 6:
        raise ParseError("牌组第 %d 张（%s）：解出 %d 条爻线（应为 6）" % (no, name, len(rows)))
    bits = []
    for y in sorted(rows, reverse=True):          # y 越大越靠下 → 自下而上
        segs = sorted(rows[y], reverse=True)
        if len(segs) == 1 and segs[0] >= FULL_WIDTH:
            bits.append("1")                      # 阳：一条通栏长线
        elif len(segs) == 2 and all(abs(s - HALF_WIDTH) < 1.0 for s in segs):
            bits.append("0")                      # 阴：断开成两段短线
        else:
            raise ParseError("牌组第 %d 张（%s）：y=%s 处的爻线解不出阴阳：%r"
                             % (no, name, y, segs))
    return "".join(bits)


def check_deck_art(deck_path):
    """★ 与卦名字面无关的校验：牌组 art 解出的阴阳串 ↔ 脚本里的通行本上下卦表。"""
    raw = read_text(deck_path, "易经牌组")
    try:
        deck = json.loads(raw)
    except ValueError as exc:
        raise ParseError("易经牌组不是合法 JSON：%s" % exc)
    cards = deck.get("cards") if isinstance(deck, dict) else deck
    if not isinstance(cards, list) or len(cards) != EXPECT_HEX:
        raise ParseError("易经牌组卡数不是 64：%r" % (len(cards) if isinstance(cards, list) else cards))
    for i, card in enumerate(cards):
        no = i + 1
        name = card.get("name", "?")
        if not isinstance(card.get("art"), str) or not card["art"].strip():
            raise ParseError("牌组第 %d 张（%s）没有 art" % (no, name))
        got = decode_art_bits(card["art"], name, no)
        lower, upper = KINGWEN[no - 1]
        want = TRIGRAMS[lower] + TRIGRAMS[upper]       # 自下而上：先下卦三爻，再上卦三爻
        if got != want:
            raise ParseError(
                "牌组卦画与通行本卦序不符：第 %d 张（%s）\n"
                "  牌组 art 解出 %s（自下而上）\n"
                "  通行本表为   %s（下卦%s + 上卦%s）" % (no, name, got, want, lower, upper))
    return len(cards)


def check_counts(hexes, src_text):
    n_yao = sum(len(h["yaos"]) for h in hexes)
    if len(hexes) != EXPECT_HEX:
        raise ParseError("卦数 %d ≠ %d" % (len(hexes), EXPECT_HEX))
    if n_yao != EXPECT_YAO:
        raise ParseError("爻总数 %d ≠ %d" % (n_yao, EXPECT_YAO))
    if any(len(h["yaos"]) != 7 for h in hexes if h["no"] in (1, 2)):
        raise ParseError("乾/坤 不是各 7 条爻")
    if any(len(h["yaos"]) != 6 for h in hexes if h["no"] not in (1, 2)):
        raise ParseError("非乾/坤的卦不是各 6 条爻")
    if len([y for h in hexes for y in h["yaos"] if y["special"]]) != 2:
        raise ParseError("special（用九/用六）不是 2 条")

    # 材料条目数：64 卦名 + 64 卦辞 + 386 爻辞 = 514 条 `**` 开头的粗体条目
    bold = 0
    for ln in src_text.split("\n"):
        s = ln.strip()
        if s.startswith("**") and s.count("**") >= 2:
            bold += 1
    if bold != EXPECT_BOLD:
        raise ParseError("材料 `**` 条目数 %d ≠ %d（64 卦名 + 64 卦辞 + 386 爻辞）"
                         % (bold, EXPECT_BOLD))


def check_notes(hexes, src_text):
    """标注一个不丢：卦段落里的 3 种标注 == 数据里 note 字段的 3 种标注。"""
    lines = src_text.split("\n")
    up_i = find_line(lines, r"^# 上经", "「# 上经」标题")
    idx_i = find_line(lines, r"^# 六十四卦索引", "「# 六十四卦索引」标题")
    body = "\n".join(lines[up_i:idx_i])

    got = {"gua": {s: 0 for s in NOTE_SYMS}, "yao": {s: 0 for s in NOTE_SYMS}}
    for h in hexes:
        for s in NOTE_SYMS:
            for note in h["guaNotes"]:
                got["gua"][s] += note.count(s)
            for y in h["yaos"]:
                got["yao"][s] += y["note"].count(s)
    for s in NOTE_SYMS:
        want = body.count(s)
        have = got["gua"][s] + got["yao"][s]
        if want != have:
            raise ParseError("标注 %s 数量不符：材料卦段落 %d 处，数据 %d 处" % (s, want, have))

    gua_n = sum(1 for h in hexes if h["guaNotes"])
    yao_n = sum(1 for h in hexes for y in h["yaos"] if y["note"])
    if gua_n != 2 or yao_n != 8:
        raise ParseError("带标注的卦辞应为 2 条、爻辞应为 8 条，实际 %d / %d" % (gua_n, yao_n))
    return gua_n, yao_n


def check_note_preserved(data, src_text):
    """整个输出里 3 种标注的总数 ≥ 材料（防任何一处被吞）；且三种都得出现。"""
    blob = json.dumps(data, ensure_ascii=False)
    for s in NOTE_SYMS:
        if blob.count(s) < src_text.count(s):
            raise ParseError("输出里 %s 只有 %d 处，材料有 %d 处（有标注被吞）"
                             % (s, blob.count(s), src_text.count(s)))
    for s in NOTE_SYMS:
        if blob.count(s) == 0:
            raise ParseError("输出里完全不见 %s" % s)


def check_roundtrip(hexes, src_text):
    """还原检查：原文 text / 卦辞 / 卦名 / 启发 必须能在材料里逐字找到。"""
    def has(s):
        return s in src_text
    for h in hexes:
        for s, what in ((h["name"], "卦名"), (h["gloss"], "卦名考释"), (h["insp"], "启发"),
                        (h["gua"], "卦辞")):
            if not has(s):
                raise ParseError("%s：%s 无法在材料里逐字找到：%r" % (h["name"], what, s[:30]))
        for y in h["yaos"]:
            if not has(y["text"]):
                raise ParseError("%s·%s：爻辞原文无法回溯：%r" % (h["name"], y["label"], y["text"][:30]))
            if y["note"] and not has(y["note"]):
                raise ParseError("%s·%s：标注无法回溯：%r" % (h["name"], y["label"], y["note"][:30]))
    for note in (n for h in hexes for n in h["guaNotes"]):
        if not has(note):
            raise ParseError("卦辞标注无法回溯：%r" % note[:30])


# ---------------------------------------------------------------- 组装

def build_data(src_path, deck_path):
    src_text = read_text(src_path, "周易参考材料")
    lines = src_text.split("\n")

    up_i = find_line(lines, r"^# 上经", "「# 上经」标题")
    idx_i = find_line(lines, r"^# 六十四卦索引", "「# 六十四卦索引」标题")
    if up_i >= idx_i:
        raise ParseError("材料结构异常：# 上经 在 # 六十四卦索引 之后")

    meta = parse_meta(lines, up_i, idx_i)
    sections = split_hexagrams(lines[up_i + 1:idx_i], up_i + 2)
    hexes = [parse_section(sec, i + 1) for i, sec in enumerate(sections)]

    check_glyph_order(hexes)
    check_index(hexes, meta)
    check_counts(hexes, src_text)
    gua_n, yao_n = check_notes(hexes, src_text)
    check_roundtrip(hexes, src_text)

    data = {
        "format": FORMAT,
        "meta": meta,
        "hexagrams": hexes,
    }
    check_note_preserved(data, src_text)
    n_deck = check_deck_art(deck_path)
    stats = {
        "hex": len(hexes),
        "yao": sum(len(h["yaos"]) for h in hexes),
        "guaNotes": gua_n,
        "yaoNotes": yao_n,
        "gloss": sum(1 for h in hexes if h["gloss"]),
        "insp": sum(1 for h in hexes if h["insp"]),
        "deck": n_deck,
    }
    return data, stats


def dump_json(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def dump_js(data, src_path):
    body = json.dumps(data, ensure_ascii=False, indent=2)
    body = body.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    body = "\n".join(("  " + ln) if ln else ln for ln in body.split("\n"))
    head = (
        "/* ============================================================\n"
        " * 猫卡 · 内置周易经部数据（builtin-zhouyi.js）\n"
        " * ------------------------------------------------------------\n"
        " * ★★ 这个文件是**生成出来的，别手改**。\n"
        " *    改内容   → 编辑 app/tools/gen_zhouyi.py 的解析逻辑（材料见下）\n"
        " *    重新生成 → python3 app/tools/gen_zhouyi.py\n"
        " *    校验一致 → python3 app/tools/gen_zhouyi.py --check\n"
        " *    数据正文 = app/data/zhouyi.json（本文件是它的内联副本）。\n"
        " *    材料     = %s\n"
        " *    结构说明见 app/data/README.md。\n"
        " * ============================================================ */\n"
        % os.path.basename(src_path)
    )
    return (
        head
        + "(function (global) {\n"
        + "  'use strict';\n"
        + "  global.%s =\n" % GLOBAL_NAME
        + body
        + ";\n})(window);\n"
    )


# ---------------------------------------------------------------- 比对（--check）

def short(v):
    s = repr(v)
    return s if len(s) <= 40 else s[:37] + "..."


def diff_json(exp, got, path="root"):
    """返回第一处不同的描述；完全一致返回 None。"""
    if isinstance(exp, bool) != isinstance(got, bool):
        return "%s: 期望 %s / 实际 %s" % (path, short(exp), short(got))
    if isinstance(exp, dict):
        if not isinstance(got, dict):
            return "%s: 期望对象 / 实际 %s" % (path, type(got).__name__)
        for k in exp:
            if k not in got:
                return "%s.%s: 生成物里缺失" % (path, k)
            d = diff_json(exp[k], got[k], "%s.%s" % (path, k))
            if d:
                return d
        for k in got:
            if k not in exp:
                return "%s.%s: 生成物里多余" % (path, k)
        return None
    if isinstance(exp, list):
        if not isinstance(got, list):
            return "%s: 期望数组 / 实际 %s" % (path, type(got).__name__)
        if len(exp) != len(got):
            return "%s: 长度 期望 %d / 实际 %d" % (path, len(exp), len(got))
        for i, (a, b) in enumerate(zip(exp, got)):
            d = diff_json(a, b, "%s[%d]" % (path, i))
            if d:
                return d
        return None
    if exp != got:
        return "%s: 期望 %s / 实际 %s" % (path, short(exp), short(got))
    return None


def diff_text(exp, got, path):
    if exp == got:
        return None
    a, b = exp.split("\n"), got.split("\n")
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else "<没有这一行>"
        y = b[i] if i < len(b) else "<没有这一行>"
        if x != y:
            return "%s 第 %d 行不同：\n  期望 %s\n  实际 %s" % (path, i + 1, short(x), short(y))
    return "%s 不同" % path


def do_check(json_path, js_path, exp_json_text, exp_js_text):
    problems = []
    if not os.path.isfile(json_path):
        problems.append("生成物缺失：%s" % json_path)
    else:
        with open(json_path, encoding="utf-8") as fh:
            got = fh.read()
        if got != exp_json_text:
            try:
                d = diff_json(json.loads(exp_json_text), json.loads(got))
            except ValueError as exc:
                d = "JSON 解析失败：%s" % exc
            problems.append("%s 与生成物不一致 —— 第一处不同：%s" % (json_path, d or "（仅空白/格式不同）"))
    if not os.path.isfile(js_path):
        problems.append("生成物缺失：%s" % js_path)
    else:
        with open(js_path, encoding="utf-8") as fh:
            d = diff_text(exp_js_text, fh.read(), js_path)
        if d:
            problems.append("%s 与生成物不一致 —— %s" % (js_path, d))
    return problems


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="猫卡 · 周易经部数据管线（解析参考材料 → zhouyi.json + builtin-zhouyi.js）")
    ap.add_argument("--check", action="store_true",
                    help="只比对生成物，不写文件；不一致 exit 1 并指出第一处不同")
    ap.add_argument("--src", default=DEFAULT_SRC, help="参考材料 markdown（默认 %(default)s）")
    ap.add_argument("--deck", default=DEFAULT_DECK, help="易经牌组 JSON（默认 %(default)s）")
    ap.add_argument("--json-out", default=DEFAULT_JSON, help="输出 JSON（默认 %(default)s）")
    ap.add_argument("--js-out", default=DEFAULT_JS, help="输出 JS（默认 %(default)s）")
    args = ap.parse_args(argv)

    try:
        data, stats = build_data(args.src, args.deck)
    except ParseError as exc:
        sys.stderr.write("✗ 解析/自检失败，未写任何文件：\n  %s\n" % exc)
        return 1

    json_text = dump_json(data)
    js_text = dump_js(data, args.src)

    if args.check:
        problems = do_check(args.json_out, args.js_out, json_text, js_text)
        if problems:
            sys.stderr.write("✗ 生成物不是最新（%d 处）：\n" % len(problems))
            for p in problems:
                sys.stderr.write("  - %s\n" % p)
            return 1
        print("✓ 生成物与材料一致（%s / %s）" % (args.json_out, args.js_out))
        return 0

    for path, text in ((args.json_out, json_text), (args.js_out, js_text)):
        d = os.path.dirname(path)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)

    print("✓ 自检全过，已写出：")
    print("  %s (%d 字节)" % (args.json_out, len(json_text.encode("utf-8"))))
    print("  %s (%d 字节)" % (args.js_out, len(js_text.encode("utf-8"))))
    print("  卦 %d · 爻 %d · 卦辞标注 %d · 爻辞标注 %d · gloss %d/64 · insp %d/64 · 牌组卦画 %d/64 全对"
          % (stats["hex"], stats["yao"], stats["guaNotes"], stats["yaoNotes"],
             stats["gloss"], stats["insp"], stats["deck"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
