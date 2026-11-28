#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 app/www 组装成可以发布的网页版站点。

为什么要有这一步：APK 里的 www 走 WebView + Java 注入的 window.LotFile，
网页版没有那条通道，得补一个纯浏览器实现（web/web-bridge.js）。
源码 app/www 一行不改 —— 保证仓库里的 www 始终等于装机包里的 www，
网页版只是在发布时多贴一张皮。

用法：python3 web/建站点.py [源码目录] [输出目录]
      默认 app/www → _site
"""
import io
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = '  <script src="js/web-bridge.js"></script>\n'


def build_desktop(dst):
    """生成 dst/desktop/index.html。

    只多一个 HTML：靠 <base href="../"> 复用上一层的 js/css/图片，
    不为电脑版再拷一份 73MB。
    """
    src = os.path.join(dst, 'index.html')
    s = io.open(src, encoding='utf-8').read()
    if s.count('<head>') != 1:
        sys.exit('index.html 里 <head> 不唯一，桌面版拼接逻辑要改')
    s = s.replace('<head>', '<head>\n  <base href="../">', 1)
    # 样式必须排在应用自己的 css 之后，否则同权重规则会被 main.css 盖掉
    s = s.replace('</head>', '  <link rel="stylesheet" href="css/desktop.css">\n</head>', 1)
    s = s.replace('</body>',
                  '  <a class="desk-back" href="../" aria-label="回手机版">← 手机版</a>\n</body>', 1)
    out = os.path.join(dst, 'desktop')
    os.makedirs(out, exist_ok=True)
    io.open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(s)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), 'app', 'www')
    dst = sys.argv[2] if len(sys.argv) > 2 else '_site'
    if not os.path.isdir(src):
        sys.exit('源码目录不存在：' + src)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    shutil.copy(os.path.join(HERE, 'web-bridge.js'),
                os.path.join(dst, 'js', 'web-bridge.js'))
    shutil.copy(os.path.join(HERE, 'desktop.css'),
                os.path.join(dst, 'css', 'desktop.css'))
    idx = os.path.join(dst, 'index.html')
    s = io.open(idx, encoding='utf-8').read()
    if 'web-bridge.js' not in s:
        if '</body>' not in s:
            sys.exit('index.html 里找不到 </body>，注入点变了？')
        s = s.replace('</body>', TAG + '</body>', 1)
        io.open(idx, 'w', encoding='utf-8').write(s)
    build_desktop(dst)
    n = sum(len(f) for _, _, f in os.walk(dst))
    print('站点已生成：%s（%d 个文件，含 desktop/）' % (dst, n))


if __name__ == '__main__':
    main()
