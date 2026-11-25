# -*- coding: utf-8 -*-
"""字库构建 v2：fontTools API 子集化（GB2312 常用字 + 符号）→ woff2
字集：GB2312 全汉字 6763 + 符号区 + ASCII —— 牌面文字 99.9% 覆盖，体积约 1/3"""
import os, re, json, subprocess, shutil
from fontTools import subset
from fontTools.ttLib import TTFont

OUT = '/tmp/fontkit'; os.makedirs(OUT, exist_ok=True)
GH = 'https://ghproxy.net/'

def gb_chars():
    s = set()
    for b1 in range(0xA1, 0xFE):
        for b2 in range(0xA1, 0xFF):
            try: s.add(bytes([b1, b2]).decode('gb2312'))
            except Exception: pass
    return s
CHARS = gb_chars()
def extra_codes():
    cs = []
    for a, b in [(0x20,0x7E),(0xA0,0xFF),(0x2000,0x206F),(0x2190,0x21FF),(0x2460,0x24FF),
                 (0x25A0,0x25FF),(0x2600,0x27BF),(0x3000,0x303F),(0xFF00,0xFFEF)]:
        cs.extend(range(a, b+1))
    return cs
UNI = [ord(c) for c in CHARS] + extra_codes()

def to_w2(src, out):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    f = subset.load_font(src, opts)
    st = subset.Subsetter(options=opts)
    st.populate(unicodes=UNI)
    st.subset(f)
    subset.save_font(f, out, opts)

def gf_fetch(fam, dst):
    css = subprocess.run(['curl','-s','--max-time','30',
        'https://fonts.googleapis.com/css2?family=%s&display=swap' % fam.replace(' ','+')],
        capture_output=True, timeout=50).stdout.decode('utf-8','ignore')
    m = re.search(r'url\((https://fonts\.gstatic\.com[^)]+)\)', css)
    if not m: return None
    url = m.group(1); raw = dst + (os.path.splitext(url)[1] or '.ttf')
    subprocess.run(['curl','-s','--max-time','300','-o',raw,url], timeout=330)
    return raw if os.path.exists(raw) and os.path.getsize(raw) > 20000 else None

JOBS = [
  # key, 中文名, ('file', 已下载路径) 或 ('gf', 字体名) 或 ('gh', URL)
  ('kai',  '霞鹜文楷', 'file', '/tmp/fontkit/raw_kai.ttf'),
  ('ming', '汇文明朝', 'file', '/tmp/fontkit/raw_ming.ttf'),
  ('song', '思源宋体', 'file', '/tmp/fontcand/NotoSerifSC.ttf'),
  ('mao',  '马善政',   'file', '/tmp/fontcand/MaShanZheng.ttf'),
  ('xing', '志莽行书', 'file', '/tmp/fontcand/ZhiMangXing.ttf'),
  ('shou', '龙藏手写', 'file', '/tmp/fontcand/LongCang.ttf'),
  ('wei',  '站酷小薇', 'file', '/tmp/fontcand/ZCOOLXiaoWei.ttf'),
  ('you',  '悠哉',     'gh',  'https://github.com/lxgw/Yozai-Font/releases/download/v0.868/Yozai-Regular.ttf'),
  ('deyi', '得意黑',   'ghzip','https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip'),
  ('hei',  '思源黑体', 'gf',  'Noto Sans SC'),
]
report = []
for key, cn, kind, arg in JOBS:
    try:
        raw = None
        if kind == 'file':
            raw = arg if os.path.exists(arg) else None
        elif kind == 'gf':
            raw = gf_fetch(arg, os.path.join(OUT, 'raw_' + key))
        elif kind == 'gh':
            raw = os.path.join(OUT, 'raw_' + key + '.ttf')
            if not os.path.exists(raw) or os.path.getsize(raw) < 50000:
                subprocess.run(['curl','-sL','--max-time','600','-o',raw, GH + arg], timeout=650)
        elif kind == 'ghzip':
            zp = os.path.join(OUT, 'raw_' + key + '.zip')
            if not os.path.exists(zp) or os.path.getsize(zp) < 50000:
                subprocess.run(['curl','-sL','--max-time','600','-o',zp, GH + arg], timeout=650)
            shutil.unpack_archive(zp, os.path.join(OUT, 'unzip_' + key))
            d = os.path.join(OUT, 'unzip_' + key)
            cands = [os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs
                     if f.lower().endswith(('.ttf','.otf')) and 'oblique' in f.lower()]
            if not cands:
                cands = [os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs
                         if f.lower().endswith(('.ttf','.otf'))]
            raw = cands[0] if cands else None
        if not raw or not os.path.exists(raw) or os.path.getsize(raw) < 20000:
            report.append({'key': key, 'cn': cn, 'err': '源文件缺失'}); print('FAIL', cn, flush=True); continue
        out = os.path.join(OUT, key + '.woff2')
        to_w2(raw, out)
        fo = TTFont(out); chars = len(fo.getBestCmap())
        mb = round(os.path.getsize(out)/1048576, 2)
        report.append({'key': key, 'cn': cn, 'chars': chars, 'mb': mb})
        print('OK %-6s %-5s %5d字 %5.2fMB' % (key, cn, chars, mb), flush=True)
    except Exception as e:
        report.append({'key': key, 'cn': cn, 'err': str(e)[:100]}); print('ERR', cn, str(e)[:70], flush=True)

with open(os.path.join(OUT,'report.json'),'w',encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
print('=== DONE ===', flush=True)
