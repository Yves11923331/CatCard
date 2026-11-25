#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Love & Armour · 牌面图外置
decks/lovearmour/faces/*.jpg --原字节--> www/assets/deckimg/lovearmour/*.jpg（含 _back.jpg）
规矩同 stories/aegis：注册表只写相对路径，不内嵌；原字节搬；--check 幂等。
"""
import os, shutil, sys
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(BASE, 'decks', 'lovearmour', 'faces')
DST = os.path.join(BASE, 'www', 'assets', 'deckimg', 'lovearmour')

def main(check=False):
    if not os.path.isdir(SRC):
        print('✗ 源图目录不存在：%s' % SRC); return 1
    os.makedirs(DST, exist_ok=True)
    files = [f for f in sorted(os.listdir(SRC)) if f.lower().endswith('.jpg')]
    back = os.path.join(BASE, 'decks', 'lovearmour', '_back.jpg')
    if os.path.exists(back): files.append('_back.jpg')
    bad = 0
    for f in files:
        s = back if f == '_back.jpg' else os.path.join(SRC, f)
        d = os.path.join(DST, f)
        if check:
            if not (os.path.exists(d) and open(s,'rb').read() == open(d,'rb').read()):
                print('  ✗ 不一致：%s' % f); bad += 1
        else:
            shutil.copy2(s, d)
    if check:
        print('✓ 外置图一致（%d 张）' % (len(files)-bad) if not bad else '✗ %d 张不一致' % bad)
        return 0 if not bad else 1
    print('✓ 已外置 %d 张 → www/assets/deckimg/lovearmour/' % len(files))
    return 0

if __name__ == '__main__':
    sys.exit(main('--check' in sys.argv))
