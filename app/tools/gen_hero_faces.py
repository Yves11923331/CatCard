#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英雄之旅 · 牌面图流水线（2026-09-27 v2：5 列 × 5 行 / 17 格）

输入：豆包出的一张【正方形 1:1】素材总表 —— 5 列 × 5 行 ＝ 25 格，
      第 1~17 格各一个符号，第 18~25 格留空（右下角整片空白＝豆包水印区）。
      出图提示词见项目根目录 `给豆包的提示词-英雄之旅素材.md`（与本文件的几何**必须一致**）。
输出：`app/decks/faces-hero/01..17.jpg`（360×540 ＝ 卡面 2:3，`.fc-img` 用 cover 铺满，正好满幅）。

几何（**全部按比例算** —— 豆包出的图不是 2048×2048 也照样能裁，不用改本文件）：
    四周留白 = 画布宽的 124/2048 ≈ 6.05%
    格子边长 = (1 - 2×留白) / 5                → 2048 下每格 360×360
    裁切框   = 格心横 2/3 宽 × 全格高          → 2048 下 240×360，正好 2:3，零拉伸
    提示词让豆包把图案画在【格心 220×330（严格 2:3）】内，比刀口小一圈（左右 10px、上下 15px 余量），
    所以它就算画大一点点也**切不到边**；不越界就是零损失。

用法：
    python3 app/tools/gen_hero_faces.py <素材图路径>            # 裁 17 张 + 出两张自检图
    python3 app/tools/gen_hero_faces.py <素材图路径> --preview  # 只出自检图，不写牌面
自检图（**每次裁完必须看一眼**）：
    设计-界面/53-英雄之旅-牌面裁剪核对.png   17 张裁好的排一张，看有没有切到水印/切进邻格
    设计-界面/53-英雄之旅-网格自检.png       25 个格框 + 17 个裁切框画回原图，看豆包画歪没歪
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(BASE)
OUTDIR = os.path.join(BASE, 'decks', 'faces-hero')
CHK_TILES = os.path.join(PROJ, '设计-界面', '53-英雄之旅-牌面裁剪核对.png')
CHK_GRID = os.path.join(PROJ, '设计-界面', '53-英雄之旅-网格自检.png')

# 17 张的格子序号 → 牌位（与提示词第 1~17 条**严格 1:1**，也是 gen_hero.py 里 01..17.jpg 的顺序）
TILES = [
    (1,  '启程Ⅰ', '冒险的召唤'),   (2,  '启程Ⅱ', '拒绝召唤'),       (3,  '启程Ⅲ', '超自然助力'),
    (4,  '启程Ⅳ', '跨越第一道门槛'), (5,  '启程Ⅴ', '鲸鱼之腹'),       (6,  '启始Ⅰ', '试炼之路'),
    (7,  '启始Ⅱ', '与女神相会'),   (8,  '启始Ⅲ', '作为诱惑者的女人'), (9,  '启始Ⅳ', '与父亲和解'),
    (10, '启始Ⅴ', '神化'),        (11, '启始Ⅵ', '终极恩赐'),       (12, '归返Ⅰ', '拒绝归返'),
    (13, '归返Ⅱ', '魔法飞行'),     (14, '归返Ⅲ', '外来救援'),       (15, '归返Ⅳ', '跨越归返的门槛'),
    (16, '归返Ⅴ', '两个世界的主人'), (17, '归返Ⅵ', '自由自在'),
]
COLS, ROWS = 5, 5
MARGIN_RATIO = 124.0 / 2048.0     # 四周留白（与提示词一致）
KEEP_W_RATIO = 2.0 / 3.0          # 格心保留宽度 ＝ 格宽 × 2/3 → 竖长方形＝ 2:3
CARD_W, CARD_H = 360, 540         # 卡面 2:3


def font(sz):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', sz)
    except Exception:
        return ImageFont.load_default()


def geometry(W, H):
    """→ (格宽, 格高, 左上角 x, 左上角 y)：全部按比例，出图多大都吃"""
    gw = W * (1 - 2 * MARGIN_RATIO)
    gh = H * (1 - 2 * MARGIN_RATIO)
    return gw / COLS, gh / ROWS, W * MARGIN_RATIO, H * MARGIN_RATIO


def cell_box(no, W, H):
    """第 no 格（1 起、左到右、上到下）的格子框"""
    cw, ch, gx, gy = geometry(W, H)
    r, c = (no - 1) // COLS, (no - 1) % COLS
    return (gx + c * cw, gy + r * ch, gx + (c + 1) * cw, gy + (r + 1) * ch)


def keep_box(no, W, H):
    """第 no 格的【裁切框】：格心横 2/3 宽 × 全格高"""
    x0, y0, x1, y1 = cell_box(no, W, H)
    cw, ch = x1 - x0, y1 - y0
    inset = cw * (1 - KEEP_W_RATIO) / 2          # 左右各内收 1/6 格宽
    return (x0 + inset, y0, x1 - inset, y1)


def to_card(t):
    """裁成严格 2:3 再缩到 360×540（多出来的那点居中裁掉，绝不拉伸）"""
    tw, th = t.size
    want = CARD_W / float(CARD_H)
    if tw / float(th) > want:                    # 太宽 → 削左右
        w = max(1, int(round(th * want)))
        left = (tw - w) // 2
        t = t.crop((left, 0, left + w, th))
    else:                                        # 太高 → 削上下
        h = max(1, int(round(tw / want)))
        top = (th - h) // 2
        t = t.crop((0, top, tw, top + h))
    return t.resize((CARD_W, CARD_H), Image.LANCZOS)


def check_grid(im, boxes_used):
    """把格框（灰）+ 裁切框（红）画回原图 → 一眼看出豆包画歪没歪"""
    W, H = im.size
    vis = im.copy()
    d = ImageDraw.Draw(vis)
    lw = max(2, int(W / 512))
    for no in range(1, COLS * ROWS + 1):
        b = cell_box(no, W, H)
        d.rectangle(b, outline='#8a8a8a', width=lw)
    for no in boxes_used:
        d.rectangle(keep_box(no, W, H), outline='#e0342b', width=lw + 1)
    d.text((int(W * MARGIN_RATIO), max(4, int(H * MARGIN_RATIO) - 26)),
           '灰=25 格框  红=17 个裁切框  右下空白区=水印区', font=font(max(14, W // 60)), fill='#e0342b')
    vis.save(CHK_GRID)
    return CHK_GRID


def check_tiles(faces):
    """17 张裁好的排一张核对表"""
    CW, CH, PAD, LBL = 180, 270, 8, 26
    labels = ['%d %s｜%s' % (no, pos, name) for no, pos, name, _ in faces]
    ft = font(15)
    # 列距按最长的那条标签算，免得「归返Ⅳ｜跨越归返的门槛」这种长标签跟邻格挤在一起
    pitch = int(max(CW + PAD, max(ft.getlength(s) for s in labels) + PAD * 2))
    rows = (len(faces) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * pitch + PAD, rows * (CH + LBL) + PAD), '#eef0f4')
    d = ImageDraw.Draw(sheet)
    for i, (no, pos, name, t) in enumerate(faces):
        r, c = divmod(i, COLS)
        x, y = PAD + c * pitch, PAD + r * (CH + LBL)
        sheet.paste(t.resize((CW, CH), Image.LANCZOS), (x, y))
        d.text((x + 3, y + CH + 4), labels[i], font=ft, fill='#33333c')
    sheet.save(CHK_TILES)
    return CHK_TILES


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview_only = '--preview' in sys.argv
    if not args:
        print(__doc__)
        return 1
    src = args[0]
    im = Image.open(src).convert('RGB')
    W, H = im.size
    print('素材图：%s  %d×%d' % (src, W, H))
    if abs(W / float(H) - 1) > 0.03:
        print('  ⚠ 不是正方形（宽高比 %.3f）—— 提示词要的是 1:1，裁出来可能整体偏移，建议重出' % (W / float(H)))
    if W < COLS * 100:
        print('  ⚠ 分辨率偏低（%d 宽），裁出来只有 %d 像素/格，牌面会糊' % (W, W // COLS))
    cw, ch = geometry(W, H)[:2]
    print('  几何：四周留白 %.0fpx ｜ 每格 %.1f×%.1f ｜ 裁切框 %.1f×%.1f（2:3）'
          % (W * MARGIN_RATIO, cw, ch, cw * KEEP_W_RATIO, ch))

    faces, used = [], []
    if not preview_only:
        os.makedirs(OUTDIR, exist_ok=True)
    for no, pos, name in TILES:
        used.append(no)
        x0, y0, x1, y1 = keep_box(no, W, H)
        t = to_card(im.crop((int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1)))))
        if not preview_only:
            p = os.path.join(OUTDIR, '%02d.jpg' % no)
            t.save(p, 'JPEG', quality=88, optimize=True)
            print('  裁出 %s  ← 第 %d 格 %s' % (os.path.basename(p), no, name))
        faces.append((no, pos, name, t))

    check_grid(im, used)
    check_tiles(faces)
    print('自检图：')
    print('  %s' % os.path.relpath(CHK_GRID, PROJ))
    print('  %s' % os.path.relpath(CHK_TILES, PROJ))
    print('★ 看一眼「网格自检」：红框有没有框偏 / 框进空白格；再看「裁剪核对」：有没有切到水印或邻格')
    if not preview_only:
        print('下一步：python3 app/tools/gen_hero.py   # 把 17 张灌进 app/decks/英雄之旅.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
