#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英雄之旅 · 从多张豆包素材图里【择优拼】出 17 张牌面（2026-09-27）

为什么单独有这么一个脚本：豆包出的 5×5 总表**经常有残缺** ——
  · 一条鲸鱼被劈成两格画（图1 的 6/7 格）
  · 该有画的地方是空白（图1 的 4/5 格、图2 的 6~9 格）
  · 同一个符号画了两次（图3 的 9/10 格、13/16 格）
  · 两个阶段的符号挤进同一格（图1 的 18 格＝握手＋脚印）
所以不能指望一张图全对，而是**每张牌各自挑最好的那一格**，再统一重排。

本脚本做的事：
  1. 自动量出每张图真实的格子边框（豆包会偷偷画框线，直接按格心裁会把线裁进牌面）；
  2. 按 PICK 表取用指定图的指定格，把【墨】从纸里剥出来（alpha 合成，不带走原底）；
  3. 统一贴到同一张羊皮纸底上，缩放到一致的视觉尺寸，出 360×540＝卡面 2:3；
  4. 出一张对照表供人眼复核。

用法：python3 app/tools/pick_hero_faces.py            # 出 17 张 + 对照表
      python3 app/tools/pick_hero_faces.py --dry        # 只出对照表到 /tmp，不写牌面
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(BASE)
OUTDIR = os.path.join(BASE, 'decks', 'faces-hero')
PREVIEW = os.path.join(PROJ, '设计-界面', '53-英雄之旅-牌面裁剪核对.png')
CARD_W, CARD_H = 360, 540
FIT_W, FIT_H = 310, 420          # 符号统一缩放到这个框内（保持比例、居中）
INSET = 6                        # 从框线往里缩这么多，保证裁不到框线

SHEETDIR = os.path.join(PROJ, '设计-界面', 'Hero')     # 豆包原图放这儿
SHEETS = {
    'A': '1790471868681.png',    # 图1
    'B': '1790471906324.png',    # 图2
    'C': '1790471940090.png',    # 图3
}
# 每张牌的取用来源：('图', 格号)  —— 顺序＝牌组 01..17（启程Ⅰ…归返Ⅵ）
PICK = [
    (1,  '启程Ⅰ', '冒险的召唤',       ('C', 1)),
    (2,  '启程Ⅱ', '拒绝召唤',         ('B', 2)),
    (3,  '启程Ⅲ', '超自然助力',       ('B', 3)),
    (4,  '启程Ⅳ', '跨越第一道门槛',   ('B', 4)),
    (5,  '启程Ⅴ', '鲸鱼之腹',         ('C', 6)),
    (6,  '启始Ⅰ', '试炼之路',         ('B', 10)),
    (7,  '启始Ⅱ', '与女神相会',       ('B', 11)),
    (8,  '启始Ⅲ', '作为诱惑者的女人', ('A', 10)),
    (9,  '启始Ⅳ', '与父亲和解',       ('A', 12)),   # 王座；剑在下面单独叠（见 PARTS）
    (10, '启始Ⅴ', '神化',             ('B', 15)),
    (11, '启始Ⅵ', '终极恩赐',         ('B', 14)),
    (12, '归返Ⅰ', '拒绝归返',         ('B', 17)),
    (13, '归返Ⅱ', '魔法飞行',         ('B', 16)),
    (14, '归返Ⅲ', '外来救援',         ('B', 18)),
    (15, '归返Ⅳ', '跨越归返的门槛',   ('C', 21)),
    (16, '归返Ⅴ', '两个世界的主人',   ('B', 19)),
    (17, '归返Ⅵ', '自由自在',         ('B', 20)),
]
# 特殊：第 9 张「与父亲和解」＝王座 + 座前地上横放的剑（图1 把这两样画在了 12/13 两格）
#   格号 → (目标宽, 目标高, 中心 x, 中心 y)；中心以 360×540 卡面计
PARTS = {
    9: [('A', 12, 300, 300, 180, 195), ('A', 13, 250, 110, 180, 400)],
}
# 空白纸底取这里（图2 第 2 行第 1 格是干净的空白格）
PAPER_REF = ('B', 6)


def imread(path):
    return Image.open(path).convert('RGB')


def detect_boxes(im):
    """量出 5×5 的真实格子边框 → {cell_no: (l,t,r,b)}"""
    a = np.asarray(im.convert('L')).astype(np.float32)
    bg = float(np.median(a))                       # 纸色（图以纸为主）
    ink = a < bg - 40
    H, W = a.shape

    def lines(prof):
        th = prof.max() * 0.6                      # 真框线是贯通全图的长线，墨量远高于图形
        idx = np.where(prof > th)[0]
        gs = []
        for i in idx:
            if gs and i - gs[-1][-1] <= 3:
                gs[-1].append(i)
            else:
                gs.append([i])
        return [int(round(np.mean(g))) for g in gs]

    vx, hy = lines(ink.sum(0)), lines(ink.sum(1))
    if len(vx) != 10 or len(hy) != 10:
        raise SystemExit('✗ 框线没量准（竖线 %d 条、横线 %d 条，应为 10/10）—— 这张图版式不合规' % (len(vx), len(hy)))
    out = {}
    for r in range(5):
        for c in range(5):
            out[r * 5 + c + 1] = (vx[2 * c], hy[2 * r], vx[2 * c + 1], hy[2 * r + 1])
    return out, bg


def ink_of(im, box):
    """把一个格子里的【墨】从纸里剥出来 → (RGB, alpha)，纸被剥成透明"""
    l, t, r, b = box
    sub = im.crop((l + INSET, t + INSET, r - INSET, b - INSET))
    g = np.asarray(sub.convert('L')).astype(np.float32)
    paper = float(np.percentile(g, 88))            # 这一格的纸色
    a = np.clip((paper - g) / max(35.0, paper * 0.55), 0, 1)
    a[a < 0.12] = 0.0                              # 纸纹噪点归零
    return sub, a


def bbox_of(a):
    """按投影裁掉零散噪点后的内容框"""
    cs, rs = a.sum(0), a.sum(1)
    if cs.max() <= 0:
        return None
    def ext(v):
        i = np.where(v > v.max() * 0.03)[0]
        return int(i.min()), int(i.max()) + 1
    x0, x1 = ext(cs)
    y0, y1 = ext(rs)
    return x0, y0, x1, y1


def make_paper(imgs, boxes):
    """共用的一张羊皮纸底：取一个干净空白格，镜像拼 2×2 再缩到卡面，避免拉伸感"""
    tag, no = PAPER_REF
    im = imgs[tag]
    l, t, r, b = boxes[tag][no]
    p = im.crop((l + INSET + 4, t + INSET + 4, r - INSET - 4, b - INSET - 4))
    w, h = p.size
    tile = Image.new('RGB', (w * 2, h * 2))
    tile.paste(p, (0, 0)); tile.paste(p.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    tile.paste(p.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    tile.paste(p.transpose(Image.ROTATE_180), (w, h))
    return tile.resize((CARD_W, CARD_H), Image.LANCZOS)


def paste_fit(card, im, alpha, tw, th, cx, cy):
    """把符号按比例缩放进 tw×th 的框，中心落在 (cx, cy)"""
    bb = bbox_of(alpha)
    if bb is None:
        return False, 0
    x0, y0, x1, y1 = bb
    sym = im.crop((x0, y0, x1, y1))
    am = Image.fromarray((np.clip(alpha[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8), 'L')
    sw, sh = sym.size
    k = min(tw / float(sw), th / float(sh))
    nw, nh = max(1, int(round(sw * k))), max(1, int(round(sh * k)))
    sym = sym.resize((nw, nh), Image.LANCZOS)
    am = am.resize((nw, nh), Image.LANCZOS)
    card.paste(sym, (int(cx - nw / 2), int(cy - nh / 2)), am)
    return True, int((np.asarray(am) > 16).sum())


def main():
    dry = '--dry' in sys.argv
    imgs, boxes = {}, {}
    for tag, fn in SHEETS.items():
        p = os.path.join(SHEETDIR, fn)
        if not os.path.exists(p):
            raise SystemExit('✗ 找不到素材图 %s（应放在 设计-界面/Hero/）' % fn)
        imgs[tag] = imread(p)
        boxes[tag], bg = detect_boxes(imgs[tag])
        if tag == 'B':
            print('  图 %s：纸色 %.0f，格子边框 l=%d t=%d' % (tag, bg, boxes[tag][1][0], boxes[tag][1][1]))
    paper = make_paper(imgs, boxes)
    os.makedirs(OUTDIR, exist_ok=True)
    faces, report = [], []
    for no, pos, name, (tag, cell) in PICK:
        card = paper.copy()
        if no in PARTS:
            for ptag, pcell, tw, th, cx, cy in PARTS[no]:
                im, al = ink_of(imgs[ptag], boxes[ptag][pcell])
                ok, px = paste_fit(card, im, al, tw, th, cx, cy)
                report.append('      └ %s 第%d格 → %dx%d @(%d,%d) %s' % (ptag, pcell, tw, th, cx, cy, '✓' if ok else '✗ 空'))
            src = '＋'.join('%s%d' % (t, c) for t, c, _, _, _, _ in PARTS[no])
        else:
            im, al = ink_of(imgs[tag], boxes[tag][cell])
            ok, px = paste_fit(card, im, al, FIT_W, FIT_H, CARD_W // 2, CARD_H // 2)
            src = '%s%d' % (tag, cell)
            if not ok:
                print('  ✗ %s（%s）第 %d 格是空白的！' % (pos, name, cell))
        if not dry:
            card.save(os.path.join(OUTDIR, '%02d.jpg' % no), 'JPEG', quality=90, optimize=True)
        report.append('%2d %s｜%-8s ← %-5s' % (no, pos, name, src))
        faces.append((no, pos, name, card))
    # 对照表
    CW, CH, PAD, LBL = 180, 270, 8, 26
    f = ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 15)
    labels = ['%d %s｜%s' % (n, p, nm) for n, p, nm, _ in faces]
    pitch = int(max(CW + PAD, max(f.getlength(s) for s in labels) + PAD * 2))
    sheet = Image.new('RGB', (5 * pitch + PAD, 4 * (CH + LBL) + PAD), '#eef0f4')
    d = ImageDraw.Draw(sheet)
    for i, (n, p, nm, c) in enumerate(faces):
        r, cc = divmod(i, 5)
        x, y = PAD + cc * pitch, PAD + r * (CH + LBL)
        sheet.paste(c.resize((CW, CH), Image.LANCZOS), (x, y))
        d.text((x + 3, y + CH + 4), labels[i], font=f, fill='#33333c')
    out = '/tmp/pick_preview.png' if dry else PREVIEW
    sheet.save(out)
    print('\n'.join(report))
    print('\n对照表：%s' % out)
    if not dry:
        print('下一步：python3 app/tools/gen_hero.py    # 灌进牌组')
    return 0


if __name__ == '__main__':
    sys.exit(main())
