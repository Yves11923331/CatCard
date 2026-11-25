#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英雄之旅 · 生成器（2026-09-27 版：牌面改用**图片**）

牌名＝幕名＋罗马数字 ｜ 关键词＝阶段名 ｜ 索引句＝牌义第一段 ｜ 牌面＝`image`（jpeg data URL）
★ 牌面图：豆包出的**一张 5×5 素材总表**（17 格有画 + 8 格留白）裁出来的，
  裁切规则见 `gen_hero_faces.py`；出图提示词见项目根目录 `给豆包的提示词-英雄之旅素材.md`。

用法：python3 app/tools/gen_hero.py            # 写 app/decks/英雄之旅.json
      python3 app/tools/gen_hero.py --check    # 只比对
"""
import base64, io, json, os, sys
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(BASE)
OUT = os.path.join(BASE, 'decks', '英雄之旅.json')
FACES = os.path.join(BASE, 'decks', 'faces-hero')
FACE_DL = 540          # 牌面图【长边】像素：牌面 2:3＝360×540，长边就是 540。
                       # ⚠ 原来写的 360 会把 360×540 压成 240×360 ——
                       #   牌义弹层的放大镜能显示到 258 CSS px 宽，压完就糊，所以必须 ≥540。

# (牌名, 关键词=阶段名, 索引句, 牌义, 牌面图文件名或 None)
CARDS = [
 ('启程Ⅰ','冒险的召唤','某样东西开始叫你',
  '一个失误，或者一件小得不能再小的事，露出了一片你原本不知道的地方。原来的想法、说法、过法，忽然都套不上了。召唤一般由一个信使送到：一道消息、一场病、一次失去。你没有去找它，它自己找上来的。','01.jpg'),
 ('启程Ⅱ','拒绝召唤','装作没听见',
  '把召唤推回去的人，会被困在无聊、苦工、或者"大家都这样"里，慢慢失去做决定的能力，变成等着别人来救的那个。说到底，是不肯放手自己那点好处。召唤不会因为被拒绝就走开，它会转成一股往回拽的力气。','02.jpg'),
 ('启程Ⅲ','超自然助力','有人递来一件东西',
  '上路后遇到的第一个人，常常是来护着你的：一个小老头，一个老妇人。他给你对付恶龙要用的东西。坎贝尔说，这是命运里那股护着人的力量，借了一个具体的人出现。他塞给你的往往不是宝物，是一件信物，提醒你这一趟要去哪儿。','03.jpg'),
 ('启程Ⅳ','跨越第一道门槛','从"知道"迈到"在做"',
  '门槛上站着一个守卫，那是力量变大那块地方的入口。门外是黑的，是你不知道的东西。坎贝尔说，跨过这道门槛等于一次自我消灭：迈过去的那一步，把原来的你留在门这边了。','04.jpg'),
 ('启程Ⅴ','鲸鱼之腹','旧身份在这里死掉',
  '这一次你没有打赢守卫，也没有跟它讲和，你被整个吞了进去。外面看你，像死了一样。坎贝尔说，鲸腹是重生的子宫：英雄往深处走，是为了在那儿被重新生一次。所以别急着出来，你就是来这儿待着的。','05.jpg'),
 ('启始Ⅰ','试炼之路','一关接着一关',
  '接下来的路像做梦：地形是流动的，人是暧昧的，好人和坏人一时分不清。你要一关一关活下来。坎贝尔说，这一段里，先前那位帮手给的东西一直在暗处起作用，你未必察觉得到。','06.jpg'),
 ('启始Ⅱ','与女神相会','你遇见了那个"全都对"的东西',
  '障碍过完、妖魔过完，最后那一场冒险，坎贝尔说，通常写成一场婚礼：凯旋的英雄之魂，跟"世界女王"结合。她是圆满本身，是你一直知道"应该有那么个东西"的那一面。跟她结合，你才算真正认得生命，也才拿得住它。','07.jpg'),
 ('启始Ⅲ','作为诱惑者的女人','有个东西在把你往回拉',
  '婚礼不是终点。坎贝尔说，她就是生命本身，可你得做生命的主人，不能被它收留下来。求道的人要从她身边走过去，走过她喊你回去的那些好话，才能再往上。','08.jpg'),
 ('启始Ⅳ','与父亲和解','你终于不再跟他争了',
  'atonement 这个词拆开，就是"成为一体"。坎贝尔说，这一步要放下的是你自己造出来的两头怪物：一头是你当成神的恶龙，一头是你当成罪的恶龙。父亲是那道门，年轻人从他那儿走进更大的世界。你不用再跟他争，也不用再等谁点头。','09.jpg'),
 ('启始Ⅴ','神化','你换了一层皮',
  '坎贝尔给这一步的定义很短：英雄达到、或者被唤回的那个"神的状态"。人成了神。听着玄，落到身上是这样的：你还在局里，可你看得见这局在做什么，也知道自己在做什么。','10.jpg'),
 ('启始Ⅵ','终极恩赐','顶点上拿到的那件东西',
  '坎贝尔说，等这一趟走到头，不管是自己打通的，还是哪位神开恩给的，最后那件东西就到手了。它是长生不老药，是点金石，是圣杯。有时候它是件实物，更多时候是你这一路在深处炼出来的那点本事。','11.jpg'),
 ('归返Ⅰ','拒绝归返','回去了，可我舍不得',
  '坎贝尔说，走完整的一圈，接下来该做的是：把你在那边拿到的智慧的符文、金羊毛、或者你那位睡着的公主，带回人间来，让这份东西能养活别人。可英雄常常不愿意回去。那边的日子是亮的，这边的人还在睡。','12.jpg'),
 ('归返Ⅱ','魔法飞行','一路逃着回去',
  '回程在神话里常写成一场魔法飞行：你得罪过的那些力量追上来，你带着东西跑，一边跑一边往身后丢障碍。坎贝尔说，这一段跑法不重要，跑掉才算数。','13.jpg'),
 ('归返Ⅲ','外来救援','有人把你捞了上来',
  '坎贝尔说，英雄有时候自己回不来，得靠外面的人把他弄回去。世界要伸一只手，把他从那边捞回来。这不丢人，这一段本来就是旅程的一部分。','14.jpg'),
 ('归返Ⅳ','跨越归返的门槛','两个世界要接上头',
  '坎贝尔说，回来的英雄要扛住这个世界的一撞：日常的重力、别人的迟钝、一堆琐碎事，一样都躲不开。他还说，神界和人界其实是同一个世界。你要做的，是把那边学到的翻译成这边能听懂的话。','15.jpg'),
 ('归返Ⅴ','两个世界的主人','两边都待得住',
  '坎贝尔说，走到这一步，英雄成了两个世界的主人：能上去，也能下来；来回都自由，不被哪一边关住。不用躲进山里，也不用把里面的东西丢掉。','16.jpg'),
 ('归返Ⅵ','自由自在','不再被同一件事绑住',
  '坎贝尔说，最后那件好东西，是"当下这一刻的欢喜"。英雄站在"正在成为的东西"那一边，不替"已经成了的东西"站岗。恐惧还在，可它不再安排你的日子。','17.jpg'),
]
COLOR = {'启程': 0, '启始': 3, '归返': 4}      # 三幕三色：蓝 / 琥珀 / 青绿

def data_url(path):
    """牌面图 → jpeg data URL（牌面走 ui.js 的 .fc-img，只认 URL）"""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    if max(w, h) > FACE_DL:                      # 压到合适的边长，别让 meta 变胖
        k = FACE_DL / float(max(w, h))
        im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=86, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

def build():
    cards, missing = [], []
    for name, kw, idx, mean, face in CARDS:
        p = os.path.join(FACES, face) if face else None
        img = None
        if p and os.path.exists(p):
            img = data_url(p)
        else:
            missing.append('%s(%s)' % (name, face))
        cards.append({'name': name, 'keyword': kw, 'symbol': None, 'sym': None,
                      'faceText': None,
                      'meaning': '%s\n%s' % (idx, mean),   # 索引句＝牌义第一段
                      'image': img,                        # ★ 牌面图（data URL）
                      'styleKey': 'hero',                  # 图片牌面的版式钩子
                      'color': COLOR[name[:2]]})
    if missing:
        print('⚠ 还缺 %d 张牌面图：%s' % (len(missing), '、'.join(missing)))
    return {
        'format': 1, 'key': 'hero', 'name': '英雄之旅', 'oldNames': ['英雄之旅牌组'],
        'order': 60, 'onTable': True, 'addIfMissing': True, 'seed': True,
        'symbols': 'none',
        'back': {'template': 'hero', 'color': '#7a6a4f'},
        # ★ 2026-09-27：出厂牌面样式（用户：「英雄之旅 名字改为素字。关键词改为 光环」）
        #   名字素字 plain = 不画底、深墨字；关键词光环 halo = 字底下一点柔光。
        #   只是默认值，用户在「调整牌面」里逐张改得动。
        'cardStyle': {'nameBgStyle': 'plain', 'kwBgStyle': 'halo'},
        'note': ('第六副内置牌组：坎贝尔《千面英雄》单一神话 17 阶段，17 张。'
                 '★ 牌名＝幕名＋罗马数字，关键词＝阶段名，索引句＝牌义第一段（faceText 留 null）。'
                 '★ 牌面＝用户给的素材总表裁出来的图片（`decks/faces-hero/01..17.jpg`，360×540＝卡面 2:3），'
                 '内嵌成 jpeg data URL 写进 `image` 字段（`.fc-img` 用 cover 铺满，正好满幅）。'
                 '★ 牌背＝内置模板「里程线」（一条折线＋四个里程点，见 ui.js 的 heroBackSVG）。'
                 '★ 色号按三幕：0 启程蓝 / 3 启始琥珀 / 4 归返青绿。'),
        'retiredNames': [], 'cards': cards,
    }

def main():
    deck = build()
    txt = json.dumps(deck, ensure_ascii=False, indent=2) + '\n'
    if '--check' in sys.argv:
        old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        print('一致' if old == txt else '不一致')
        return 0 if old == txt else 1
    open(OUT, 'w', encoding='utf-8').write(txt)
    print('写出 %s（%d 张，%.1f MB）' % (os.path.relpath(OUT, PROJ), len(deck['cards']), len(txt.encode()) / 1048576.0))
    return 0

if __name__ == '__main__':
    sys.exit(main())
