#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""猫卡 · 独立 App 构建脚本

工具链（默认值适用于 Debian/Ubuntu + Android SDK，可用环境变量覆盖）：
  aapt      CATCARD_AAPT       默认 /usr/bin/aapt（android-sdk-build-tools）
  zipalign  CATCARD_ZIPALIGN   默认 /usr/bin/zipalign
  ecj       CATCARD_ECJ        默认 /usr/share/java/ecj.jar      Java → .class
  d8        CATCARD_D8         默认 /usr/share/java/d8.jar       .class → classes.dex
  smali     CATCARD_SMALI      默认 /usr/share/java/smali.jar
  apksigner CATCARD_APKSIGNER  默认 /usr/share/java/apksigner.jar
  android.jar  CATCARD_ANDROID_JAR（API 34）

★ 关键的坑（都踩过）：
  1) Java 工具（ecj/d8/apksigner）的 -cp/--ks 里**不能出现中文路径**，
     java 会直接报「找不到主类」或 InvalidPathException。所以统一先复制到 ASCII 暂存区（CATCARD_AT）。
  2) 编译桩 com/mqimen/lotfile/LotFileBridge.java 只用于编译，
     d8 之前必须删掉它的 class —— 否则空壳会覆盖 classes2.dex 里的真桥，
     文件导出/导入/分享会「看起来正常但什么都不做」。
  3) 必须 LANG=C.UTF-8，否则 java 在中文路径下直接崩。

流程：门禁 → aapt → ecj → 删桩 → d8 → 装 dex → zipalign → apksigner。
产物：out/猫卡-<VER>.apk（sha256 打印在最后）。
"""
import glob
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.join(BASE, 'android')
WWW = os.path.join(BASE, 'www')
BUILD = os.path.join(BASE, 'build')
OUT = os.path.join(BASE, 'out')
BRIDGE = os.path.join(BASE, 'dex', 'classes2.dex')
# 冻结 2.6.8 已出包的桥；无可编译实现，不允许误换无关或未经真机验证的二进制。
BRIDGE_SHA256 = 'c43d13352e7f33b2560559ce5891348d90f07d3912b209b2a3e2e6b123a8047d'
# ★ 签名口令/密钥库不进仓库。二选一：
#   ① export CATCARD_KS_PASS='...'（推荐，apksigner 用 env: 读取）
#   ② 把口令写成单行文件（权限 0600），路径由 CATCARD_KS_PASS_FILE 指定
PASSWORD_FILE = os.environ.get(
    'CATCARD_KS_PASS_FILE',
    os.path.join(os.path.expanduser('~'), '.config', 'catcard', 'signing-password'))
ANDROID_JAR_SRC = os.environ.get('CATCARD_ANDROID_JAR', '/usr/share/java/android.jar')
KS_SRC = os.environ.get('CATCARD_KS', os.path.join(BASE, 'catcard.keystore'))
ECJ = os.environ.get('CATCARD_ECJ', '/usr/share/java/ecj.jar')
D8 = os.environ.get('CATCARD_D8', '/usr/share/java/d8.jar')
SMALI = os.environ.get('CATCARD_SMALI', '/usr/share/java/smali.jar')
AAPT = os.environ.get('CATCARD_AAPT', '/usr/bin/aapt')
ZIPALIGN = os.environ.get('CATCARD_ZIPALIGN', '/usr/bin/zipalign')
APKSIGNER_JAR = os.environ.get('CATCARD_APKSIGNER', '/usr/share/java/apksigner.jar')
AT = os.environ.get('CATCARD_AT', '/tmp/catcard-at')          # ASCII 暂存区

NAME, VER, CODE = '猫卡', '2.6.10', 333
ALIAS = 'catcard'
MIN_SDK, TARGET_SDK = 29, 34

ENV = dict(os.environ, LANG='C.UTF-8', LC_ALL='C.UTF-8')


def run(cmd, cwd=None, quiet=False):
    p = subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True)
    if p.returncode != 0:
        safe_cmd = list(cmd)
        if '--ks-pass' in safe_cmd:
            i = safe_cmd.index('--ks-pass')
            if i + 1 < len(safe_cmd): safe_cmd[i + 1] = 'file:<private>'
        if '--key-pass' in safe_cmd:
            i = safe_cmd.index('--key-pass')
            if i + 1 < len(safe_cmd): safe_cmd[i + 1] = '<redacted>'
        print('!! 命令失败:', ' '.join(safe_cmd))
        print(p.stdout[-3000:])
        print(p.stderr[-3000:])
        sys.exit(1)
    if not quiet and (p.stdout.strip() or p.stderr.strip()):
        tail = (p.stdout + p.stderr).strip().splitlines()
        for line in tail[-4:]:
            print('   ', line)
    return p


def check_gates():
    """构建门禁（三条，见 tools/门禁.py）：
         ① 内置牌组注册表一致（改了 decks/*.json 忘了跑「生成」）
         ② 构建号 / 版本名全工程一致、HTML 里没有写死的版本号
         ③ 每副进包牌组的**专属补丁**都在 DECK_PATCHES 里登记了（删/下架时才漏不了）
       红一条就不出包 —— 规则出处：decks/00-必读（增删）与 01-必读（更新）。"""
    gate = os.path.join(BASE, 'tools', '门禁.py')
    if not os.path.isfile(gate):
        sys.exit('!! 构建门禁脚本缺失，不出包。')
    print('[0/6] 构建门禁')
    p = subprocess.run([sys.executable, gate], capture_output=True, text=True, env=ENV)
    for line in (p.stdout or '').strip().splitlines():
        print('   ', line)
    if p.returncode != 0:
        print((p.stderr or '')[-2000:])
        print('!! 门禁没过 —— 上面每条都写了怎么修（单跑：python3 app/tools/门禁.py）')
        sys.exit(1)


def prepare_tools():
    os.makedirs(AT, exist_ok=True)
    for src, dst in (
        (ANDROID_JAR_SRC, os.path.join(AT, 'android.jar')),
        (KS_SRC, os.path.join(AT, 'catcard.keystore')),
    ):
        if not os.path.exists(dst) and os.path.exists(src):
            shutil.copy2(src, dst)
    for p in (os.path.join(AT, 'android.jar'), os.path.join(AT, 'catcard.keystore')):
        if not os.path.exists(p):
            print('!! 缺工具件：%s（按 toolkit-restore 技能恢复）' % p)
            sys.exit(1)


def clean_dir(p):
    if os.path.isdir(p):
        shutil.rmtree(p)
    os.makedirs(p, exist_ok=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)   # 2026-11-13：build/ 允许整目录删掉，脚本自己重建
    check_gates()
    prepare_tools()
    if os.environ.get('CATCARD_KS_PASS'):
        pass_arg = 'env:CATCARD_KS_PASS'
    elif os.path.isfile(PASSWORD_FILE) and os.access(PASSWORD_FILE, os.R_OK):
        pass_arg = 'file:' + PASSWORD_FILE
    else:
        sys.exit('!! 没有签名口令：export CATCARD_KS_PASS=...，或把口令写到 %s' % PASSWORD_FILE)

    # ---------- [1/6] aapt 打资源与 assets ----------
    print('[1/6] aapt 打资源与 assets')
    base_apk = os.path.join(BUILD, 'base.apk')
    if os.path.exists(base_apk):
        os.remove(base_apk)
    run([AAPT, 'package', '-f',
         '-M', os.path.join(ANDROID, 'AndroidManifest.xml'),
         '-S', os.path.join(ANDROID, 'res'),
         '-A', WWW,
         '-I', os.path.join(AT, 'android.jar'),
         '-F', base_apk])
    print('    base.apk %.1f KB' % (os.path.getsize(base_apk) / 1024.0))

    # ---------- [2/6] ecj 编译 Java ----------
    print('[2/6] ecj 编译 Java')
    classes = os.path.join(BUILD, 'classes')
    clean_dir(classes)
    sources = sorted(glob.glob(os.path.join(ANDROID, 'src', '**', '*.java'), recursive=True))
    sources += sorted(glob.glob(os.path.join(ANDROID, 'stub', '**', '*.java'), recursive=True))
    if not sources:
        print('!! 没找到 Java 源文件')
        sys.exit(1)
    run(['java', '-jar', ECJ,
         '-source', '1.8', '-target', '1.8', '-encoding', 'UTF-8',
         '-cp', os.path.join(AT, 'android.jar'),
         '-d', classes] + sources)
    nclass = len(glob.glob(os.path.join(classes, '**', '*.class'), recursive=True))
    print('    .class 数: %d' % nclass)
    stub = os.path.join(classes, 'com', 'mqimen')
    if os.path.isdir(stub):
        shutil.rmtree(stub)
        print('    ✔ 已删除编译桩 com/mqimen/**（避免空壳顶掉真桥）')

    # ---------- [3/6] d8 生成 classes.dex ----------
    print('[3/6] d8 生成 classes.dex')
    dexdir = os.path.join(BUILD, 'dex')
    clean_dir(dexdir)
    # ★ d8 只吃 .class / jar / zip；直接喂目录会报 "Unsupported source file type"。
    #   先打成一个 jar 再进 d8。
    classes_jar = os.path.join(BUILD, 'classes.jar')
    if os.path.exists(classes_jar):
        os.remove(classes_jar)
    with zipfile.ZipFile(classes_jar, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(classes):
            for fn in files:
                if fn.endswith('.class'):
                    p = os.path.join(root, fn)
                    z.write(p, os.path.relpath(p, classes))
    run(['java', '-cp', D8, 'com.android.tools.r8.D8', '--min-api', str(MIN_SDK),
         '--lib', os.path.join(AT, 'android.jar'),
         '--output', dexdir, classes_jar])

    # ---------- [4/6] 装入 dex ----------
    print('[4/6] 装入 dex')
    stage = os.path.join(BUILD, 'stage')
    clean_dir(stage)
    shutil.copy2(os.path.join(dexdir, 'classes.dex'), os.path.join(stage, 'classes.dex'))
    if not os.path.isfile(BRIDGE) or sha256(BRIDGE) != BRIDGE_SHA256:
        sys.exit('!! 文件桥缺失或与已验证的版本不一致；请从原项目备份恢复。')
    shutil.copy2(BRIDGE, os.path.join(stage, 'classes2.dex'))
    with zipfile.ZipFile(base_apk, 'a', zipfile.ZIP_DEFLATED) as z:
        for fn in ('classes.dex', 'classes2.dex'):
            z.write(os.path.join(stage, fn), fn)
    with zipfile.ZipFile(base_apk) as z:
        dexes = [n for n in z.namelist() if n.endswith('.dex')]
    print('    包内 dex:', dexes)

    # ---------- [5/6] zipalign ----------
    print('[5/6] zipalign')
    aligned = os.path.join(BUILD, 'aligned.apk')
    if os.path.exists(aligned):
        os.remove(aligned)
    run([ZIPALIGN, '-f', '4', base_apk, aligned])
    run([ZIPALIGN, '-c', '-v', '4', aligned], quiet=True)
    print('    对齐检查通过（zipalign -c 退出码 0）')

    # ---------- [6/6] apksigner 签名 ----------
    print('[6/6] apksigner 用猫卡密钥签名')
    out_apk = os.path.join(OUT, '%s-%s.apk' % (NAME, VER))
    if os.path.exists(out_apk):
        os.remove(out_apk)
    run(['java', '-jar', APKSIGNER_JAR, 'sign',
         '--ks', os.path.join(AT, 'catcard.keystore'),
         '--ks-key-alias', ALIAS,
         '--ks-pass', pass_arg,
         '--min-sdk-version', str(MIN_SDK),
         '--out', out_apk, aligned])
    run(['java', '-jar', APKSIGNER_JAR, 'verify', '--min-sdk-version', str(MIN_SDK), out_apk], quiet=True)
    run([ZIPALIGN, '-c', '4', out_apk], quiet=True)

    size_mb = os.path.getsize(out_apk) / (1024.0 * 1024.0)
    print('    成品: %s %.2f MB' % (out_apk, size_mb))
    print('    sha256: %s' % sha256(out_apk))
    print('\n完成。下一步：')
    print('  aapt dump badging "%s" | head -5' % out_apk)
    print('  java -jar %s verify --min-sdk-version %d $CATCARD_AT/x.apk' % (APKSIGNER_JAR, MIN_SDK))
    return 0


if __name__ == '__main__':
    sys.exit(main())
