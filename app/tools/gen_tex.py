# -*- coding: utf-8 -*-
"""猫卡 · 牌面质感生成器（2026-10-11「鲸造」主题升级）
用法：python3 app/tools/gen_tex.py     → app/www/assets/tex/*.png（10 张，512×768 灰度）
技术：numpy + PIL 程序化生成（fBm + 域扭曲 + 方向滤波 + 等值线），无版权风险、可重调。
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www', 'assets', 'tex')
W, H = 512, 768
rng = np.random.default_rng(20261011)

def vnoise(res, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    g = (r.random((res + 1, res + 1)) * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(g).resize((W, H), Image.BICUBIC), np.float32) / 255.0

def fbm(octaves=6, base=3, gain=0.55, lac=2.0, seed=None):
    t = np.zeros((H, W), np.float32); a = 1.0; n = 0.0
    for o in range(octaves):
        t += a * vnoise(max(2, int(base * lac ** o)), None if seed is None else seed + o)
        n += a; a *= gain
    return t / n

def blur_arr(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L')
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), np.float32) / 255.0

def warp(field, amount=0.35, octaves=4, seed=None):
    dx = (fbm(octaves, 3, 0.6, 2.0, seed) - 0.5) * 2 * amount * W
    dy = (fbm(octaves, 3, 0.6, 2.0, None if seed is None else seed + 77) - 0.5) * 2 * amount * H
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    return field[np.clip((ys + dy).astype(np.int32), 0, H - 1), np.clip((xs + dx).astype(np.int32), 0, W - 1)]

def norm(a):
    a = np.asarray(a, np.float32); mn, mx = float(a.min()), float(a.max())
    return np.zeros_like(a) if mx - mn < 1e-6 else (a - mn) / (mx - mn)

def save(name, arr, contrast=1.0, center=True, spread=0.42):
    a = norm(arr)
    if contrast != 1.0: a = np.clip((a - 0.5) * contrast + 0.5, 0, 1)
    if center: a = np.clip(0.5 + (a - float(a.mean())) / max(1e-6, float(a.std())) * spread, 0, 1)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((a * 255).astype(np.uint8), 'L').save(os.path.join(OUT, name + '.png'), optimize=True)
    print('  %-10s %6.1f KB  mean=%.3f' % (name, os.path.getsize(os.path.join(OUT, name + '.png')) / 1024, a.mean()))

def main():
    print('生成牌面质感 →', os.path.normpath(OUT))
    # ① paper 纸纹
    save('paper', 0.62 * fbm(7, 4, 0.55, 2.0) + 0.38 * fbm(5, 2, 0.7, 3.0, 11), contrast=1.25)
    # ② grain 砂粒（矿物颗粒：高频 + 密集砂点）
    dots = (rng.random((H, W)) < 0.14).astype(np.float32) * (0.4 + 0.6 * rng.random((H, W)).astype(np.float32))
    save('grain', 0.5 * fbm(3, 60, 0.5, 2.0) + 0.5 * fbm(5, 120, 0.5, 2.0) * 0.5 + 0.45 * blur_arr(dots, 0.45),
         contrast=1.15, spread=0.30)
    # ③ stone 石纹（域扭曲 → 大理石流动）
    save('stone', 1 - np.abs(warp(fbm(6, 3, 0.6, 2.0, 31), 0.42, 5, 41) - 0.5) * 2, contrast=1.35)
    # ④ crack 裂纹（等值线细线 + 斑驳，暗线做旧）
    cr = warp(fbm(5, 3, 0.6, 2.0, 51), 0.30, 4, 52)
    l1 = np.clip(np.abs(cr - 0.5) * 46, 0, 1)
    cr2 = warp(fbm(7, 7, 0.6, 2.0, 53), 0.16, 3, 54)
    l2 = np.clip(np.abs(cr2 - 0.5) * 70, 0, 1)
    spot = norm(fbm(6, 4, 0.62, 2.0, 55))
    save('crack', (0.55 + 0.45 * spot) * (0.35 + 0.65 * np.clip(l1 * 0.85 + l2 * 0.5, 0, 1)), contrast=0.9, spread=0.30)
    # ⑤ fiber 布纹（经纬交织 + 相位扰动）
    xx = np.arange(W)[None, :].astype(np.float32); yy = np.arange(H)[:, None].astype(np.float32)
    px = fbm(5, 3, 0.6, 2.0, 7) * 14.0; py = fbm(5, 3, 0.6, 2.0, 8) * 14.0
    weave = (0.5 + 0.5 * np.sin(xx * (2 * np.pi / 13.0) + px)) * (0.5 + 0.5 * np.sin(yy * (2 * np.pi / 13.0) + py))
    save('fiber', 0.44 * weave + 0.34 * fbm(6, 26, 0.6, 2.0, 9) + 0.22 * fbm(4, 140, 0.5, 2.0, 10),
         contrast=0.85, spread=0.24)
    # ⑥ brushed 拉丝（水平拉伸 + 细密方向线）
    b = vnoise(6, 71)
    b = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).resize((W, 4), Image.BICUBIC).resize((W, H), Image.BICUBIC), np.float32) / 255
    fine = blur_arr(rng.random((H, W)), 0.4)
    lines = 0.5 + 0.5 * np.sin(np.linspace(0, np.pi * 220, H))[:, None]
    save('brushed', 0.5 * b + 0.25 * fine + 0.25 * lines, contrast=1.4)
    # ⑦ watercolor 水彩（大尺度晕染 + 边缘沉积）
    wc = warp(fbm(5, 2, 0.65, 1.9, 91), 0.5, 4, 101)
    edge = np.asarray(Image.fromarray((norm(wc) * 255).astype(np.uint8), 'L').filter(ImageFilter.FIND_EDGES), np.float32) / 255
    save('watercolor', norm(wc) * 0.75 + np.clip(edge * 3, 0, 1) * 0.25, contrast=1.1)
    # ⑧ stars 星点（幂律明暗 + 三层光晕；暗底，不居中）
    st = (rng.random((H, W)) < 0.0075).astype(np.float32) * (rng.random((H, W)).astype(np.float32) ** 2.6)
    save('stars', 0.55 * blur_arr(st, 0.35) + 0.28 * blur_arr(st, 1.4) + 0.17 * blur_arr(st, 4.5), center=False)
    # ⑨ nebula 星云（域扭曲云气 + 多尺度）
    ne = warp(fbm(6, 2, 0.62, 2.0, 111), 0.55, 5, 121)
    save('nebula', 0.68 * norm(ne) + 0.32 * fbm(4, 2, 0.7, 2.0, 131), contrast=1.2)
    # ⑩ frost 霜花（枝晶：高频等值线叠加）
    f1 = warp(fbm(6, 5, 0.58, 2.2, 141), 0.22, 4, 142)
    f2 = fbm(8, 14, 0.6, 2.3, 143)
    frost = np.clip((1 - np.clip(np.abs(f1 - 0.5) * 16, 0, 1)) * 0.8 + (1 - np.clip(np.abs(f2 - 0.5) * 26, 0, 1)) * 0.55, 0, 1)
    save('frost', 0.72 * frost + 0.28 * fbm(4, 40, 0.5, 2.0, 144), contrast=1.0, spread=0.26)
    print('完成。')

if __name__ == '__main__':
    main()
