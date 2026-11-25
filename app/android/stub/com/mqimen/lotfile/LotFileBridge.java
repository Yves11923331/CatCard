package com.mqimen.lotfile;

import android.content.Context;
import android.content.Intent;

/**
 * 编译期桩（stub）—— 只为让 MainActivity.java 能通过编译。
 *
 * ★ 真正的实现在 dex/classes2.dex 里（原始桥，仅改了 3 个字符串），打包时以 classes2.dex 提供。
 * ★ 构建脚本会在 d8 之前**删掉**本文件编译出的 class，绝不能让它进 classes.dex：
 *   否则同一个类出现在两个 dex 里，Android 会优先用 classes.dex 里这个空壳，
 *   文件导出/导入/分享会「看起来正常但什么都不做」——静默失效，极难排查。
 *
 * 方法签名必须与真桥一致（含 REQ_IMPORT 常量），否则 MainActivity 编译不过。
 */
public class LotFileBridge {
    public static final int REQ_IMPORT = 0x2329;

    public LotFileBridge(Context ctx) {}

    public void onImportResult(Intent data) {}
    public boolean pickImport() { return false; }
    public String getImportStatus() { return ""; }
    public String getImportResult() { return ""; }
    public String getImportBinaryBase64() { return ""; }
    public String saveText(String text, String name) { return ""; }
    public String saveBinary(String name, String mime, String b64) { return ""; }
    public String shareFile(String name, String mime) { return ""; }
    public String shareSavedFile(String name) { return ""; }
}
