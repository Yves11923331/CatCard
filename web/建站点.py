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
    idx = os.path.join(dst, 'index.html')
    s = io.open(idx, encoding='utf-8').read()
    if 'web-bridge.js' not in s:
        if '</body>' not in s:
            sys.exit('index.html 里找不到 </body>，注入点变了？')
        s = s.replace('</body>', TAG + '</body>', 1)
        io.open(idx, 'w', encoding='utf-8').write(s)
    n = sum(len(f) for _, _, f in os.walk(dst))
    print('站点已生成：%s（%d 个文件）' % (dst, n))


if __name__ == '__main__':
    main()
