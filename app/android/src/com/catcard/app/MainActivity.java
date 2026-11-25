package com.catcard.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.ColorDrawable;   // t7：把窗口底色刷成系统栏同色
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.view.PixelCopy;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.mqimen.lotfile.LotFileBridge;

/**
 * 猫卡 · 独立壳（极简 WebView）
 *
 * 只做四件事：
 *   1. 建 WebView，开 JS / localStorage / 文件访问，加载 assets/www/index.html
 *   2. 把 LotFileBridge 以 "LotFile" 注入进去（文件导出/导入/分享走它）
 *   3. 把 onActivityResult 转发给桥（导入要开系统文件选择器）
 *   4. 返回键先问网页 window.catcardBack()，它没处理才退出应用
 *
 * 注意：本 App 不用 androidx，纯框架 API，避免额外依赖与资源编译问题。
 */
public class MainActivity extends Activity {

    private static final String TAG = "CatCard";
    private static final int REQ_FILE_CHOOSER = 0x2328;   // 与桥的 REQ_IMPORT(0x2329) 错开

    /* ============================================================
       系统栏配色（2026-11-17 · 两次迭代：先「顶部信息栏是黑的」，后「换了包还是黑的」）
       ------------------------------------------------------------
       黑在哪一层：**Android 系统状态栏那一条**，不是页面画的（页面顶栏本身就是白的：
       浅色 v3.css §24 `.table-bar … background:#ffffff !important`，深色 `--panel` = #1b1f24）。

       ① 2.5.2（312）第一版只做了「onCreate 里 setStatusBarColor + 图标反色」——**真机上无效**。
       ② 真正的根因（t7）：**主题**。原来用 `@android:style/Theme.NoTitleBar`，这是 framework 里
          **最老那支非 Material 主题**，`android:windowDrawsSystemBarBackgrounds` 默认 **false**
          → 窗口根本不绘制系统栏背景 → `setStatusBarColor()` 被**静默忽略**（不报错、就是没效果）；
          状态栏那块露出的是 decor 的 **windowBackground**，而这支深色主题的 windowBackground
          是黑的 → 怎么设颜色都还是黑。与「Android 6 到 16 一直黑」的现象吻合。
       ③ 同向叠加：Android 15（API 35）起 setStatusBarColor 已废弃，应用一旦被判成
          edge-to-edge（新系统上常见）它就是 no-op。所以「只改一个颜色 API」这条路本来就不牢。

       现在的修法（两条腿走路，缺一条都可能在新/旧系统上失效）：
         · res/values/styles.xml 的 AppTheme（父主题仍 Theme.NoTitleBar）把
           `windowDrawsSystemBarBackgrounds` 打开，并补上 statusBarColor / navigationBarColor /
           windowBackground / windowLight*Bar —— 让「设颜色」这件事真正生效；
         · applySystemBars() 里**连窗口底色一起刷**（setBackgroundDrawable）—— 状态栏那块
           最终显示的就是窗口底色，于是即便 setStatusBarColor 变 no-op，颜色也跟着主题走。

       配色：与顶栏 / 底栏同色，图标明暗跟着主题反色
         浅色 → #FFFFFF（= 顶栏底色），图标深色
         深色 → #1B1F24（= 深色 --panel），图标浅色
       颜色的唯一真源仍然是网页的 `html[data-ui-theme]`：app.js 的 applyTheme() 每次
       （启动 / 切主题）都调 `CatCard.setUiTheme()`，原生只负责照单上色；
       主题里的静态值只管「冷启动第一帧」，取浅色（= 默认主题）。

       ★ 为什么还是不上 edge-to-edge：WebView 在 edge-to-edge 下 `env(safe-area-inset-top)`
         不保证有值（顶栏 .table-bar 就靠它留白），真钻到状态栏底下左上菜单钮会点不到；
         而本机没有真机观察通道，这种"改完没法验"的布局风险不该现在冒。等 targetSdk 升 35
         时再一起做，届时按原生 inset 给页面灌 --status-bar-h 兜底。
       ============================================================ */
    private static final int BAR_COLOR_LIGHT = 0xFFFFFFFF;   // #FFFFFF = 浅色顶栏/底栏底色
    private static final int BAR_COLOR_DARK = 0xFF1B1F24;    // #1B1F24 = 深色 --panel

    private WebView web;
    private LotFileBridge bridge;
    private ValueCallback<Uri[]> filePathCallback;        // 网页 <input type=file> 的回调
    private Handler mainHandler;                          // 主线程 Handler（截图 PixelCopy 用）

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // ★ 必须：牌组数据存在 localStorage
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                  // 不跟随系统字体缩放，版面才稳定
        /* ★★ 2026-10-05 修「关键词太长时文字冲出底色 / 块向右偏」的**真凶**：
           Android WebView 的 `Minimum font size` **默认是 8px**。牌面小的时候字也跟着小 ——
           牌义弹窗里那张牌只有 --card-w:66px，关键词字号算下来才 **4.89px**，
           于是被浏览器**强制抬到 8px**（1.64 倍），文字一下比盒子宽，
           而 white-space:nowrap 又不让折行 → 直接从盒子里漏出去、冲出底色。
           桌面 Chrome 的最小字号默认是 0，所以本地怎么复现都复现不出来。
           （实测证据：诊断报告里 66px 的「离为火」关键词 —— 行内 font-size 算出来 4.886px、
              getComputedStyle 实算是 8px、文字实宽 65 > 内容宽 54。
              Aegis 牌名字号 9.53px 在 8px 之上，所以同一张牌上牌名一直是好的。） */
        s.setMinimumFontSize(1);
        /* ★★ 每次启动都从 APK 里的 assets 重新读，**不许用 WebView 缓存**。
           猫卡的版本名一直是 1.0.5、加载的 URL 也一直是 file:///android_asset/index.html ——
           光把 APK 里的 JS 换掉，WebView 很可能继续拿缓存里那份旧的，
           表现就是"明明装了新包，老毛病一个没少"（2026-09-18 排查"牌面还有怪符号"时怀疑到的）。
           loadUrl 之前再 clearCache(true) 清一次旧的资源缓存。
           ★ clearCache 只清**资源缓存**，不碰 localStorage —— 用户的牌组数据安全。 */
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);

        web.setWebViewClient(new WebViewClient());   // 站内跳转不外开浏览器
        // ★ 必须自己实现 onShowFileChooser。
        //   安卓 WebView 不会自动弹系统文件选择器：不实现的话，网页里
        //   <input type="file">（选牌面图 / 牌背图）点下去**毫无反应**，
        //   表现就是"点了选图片没任何动静"。这是独立壳最容易漏的一个回调。
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) {          // 上一次没走完，先销掉，避免回调被吞
                    try { filePathCallback.onReceiveValue(null); } catch (Exception e) {}
                }
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    Log.w(TAG, "打开文件选择器失败", e);
                    filePathCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "JS " + cm.message() + "  @" + cm.lineNumber());   // 方便真机排查
                return true;
            }
        });

        web.setBackgroundColor(0xFFFAFBFC);          // 与皮肤底色一致，避免白闪
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.addJavascriptInterface(new WebBridge(), "CatCard");

        bridge = new LotFileBridge(this);
        web.addJavascriptInterface(bridge, "LotFile");

        setContentView(web);
        /* 先按浅色上色（= 内联启动脚本的默认值），随后 app.js 的 applyTheme() 会立刻纠成用户那套主题。
           默认值故意跟页面默认一致，深色用户冷启动最多只看到一帧白条，不会是黑条。 */
        applySystemBars(false);
        /* ★ 这里**故意不调 clearCache(true)**：用户的图都在 WebView 的存储里，
           任何"清缓存/清数据"的调用都宁可不碰 —— 换包读新 JS 靠上面的 LOAD_NO_CACHE 就够了
           （它只是"每次都去源头读"，不删任何东西）。 */
        web.loadUrl("file:///android_asset/index.html");   // assets 根 = www 目录内容
    }

    /**
     * 按主题给系统栏上色 + 反色图标。dark=true 走深色那套。
     *
     * ★ 2026-11-17（t7）：2.5.2 只调 setStatusBarColor 那版**在真机上没效果**（用户装上还是黑的）。
     *   根因不在这个函数，而在**主题**：原来用的 `@android:style/Theme.NoTitleBar` 属于 framework
     *   最老那支非 Material 主题，`windowDrawsSystemBarBackgrounds` 默认 false，
     *   窗口不绘制系统栏背景 → setStatusBarColor 被静默忽略，状态栏那块露出的是
     *   decor 的 windowBackground（这支深色主题 = 黑）。现在：
     *     ① res/values/styles.xml 的 AppTheme 把 windowDrawsSystemBarBackgrounds 打开（关键条）；
     *     ② 这里再多刷一层 **窗口底色** —— 状态栏区域最终显示的就是它。于是即便在
     *        Android 15+ / 强制 edge-to-edge 的环境里 setStatusBarColor 变成 no-op，
     *        那条颜色也照样跟着主题走（这是新系统上真正管用的那半招）。
     *
     * 图标明暗两条路（minSdk 29，所以两套都得留）：
     *   API 30+：WindowInsetsController.setSystemBarsAppearance(APPEARANCE_LIGHT_*_BARS)
     *   API 29 ：View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR / _LIGHT_NAVIGATION_BAR
     */
    private void applySystemBars(boolean dark) {
        int color = dark ? BAR_COLOR_DARK : BAR_COLOR_LIGHT;
        try { getWindow().setStatusBarColor(color); } catch (Exception e) {}
        try { getWindow().setNavigationBarColor(color); } catch (Exception e) {}
        /* ★ 2026-11-17（用户实机）：导航栏被系统强制 edge-to-edge 时，setNavigationBarColor
           会被忽略，系统还会往手势导航栏上加一层对比度 scrim（浅色页面上就是一条 ~34% 的灰带）。
           这条 API（29+）关掉自动 scrim，导航栏恢复透明，露出页面底色。
           主题里 android:enforceNavigationBarContrast=false 是第一道，这里是第二道。 */
        try { getWindow().setNavigationBarContrastEnforced(false); } catch (Exception e) {}
        /* ★ 关键的第二半招：状态栏 / 导航栏那一条如果不归窗口画（老主题）或被系统强制
           edge-to-edge（新系统），露出来的都是**窗口底色**。把它一起刷成同一个颜色，
           两种机制下都能变色。 */
        try { getWindow().setBackgroundDrawable(new ColorDrawable(color)); } catch (Exception e) {}
        // 浅色底 → 需要深色图标；深色底 → 浅色图标（清掉 LIGHT_* 位就是系统默认的浅色图标）
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                android.view.WindowInsetsController ic = getWindow().getInsetsController();
                if (ic != null) {
                    int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                             | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    ic.setSystemBarsAppearance(dark ? 0 : mask, mask);
                }
            } catch (Exception e) {}
        } else if (web != null) {
            int f = web.getSystemUiVisibility();
            int want = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            web.setSystemUiVisibility(dark ? (f & ~want) : (f | want));
        }
    }

    /** 转发给文件桥：导入流程要等系统文件选择器的结果 */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        // 网页 <input type=file> 选完图：把结果回给 WebView
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] uris = null;
                try { uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data); }
                catch (Exception e) { uris = null; }
                try { filePathCallback.onReceiveValue(uris); } catch (Exception e) {}
                filePathCallback = null;
            }
            return;
        }
        if (requestCode == LotFileBridge.REQ_IMPORT) {
            try { bridge.onImportResult(data); } catch (Throwable t) { /* 让网页侧的超时兜底 */ }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** 返回键：先让网页关掉浮层（选牌台/牌义/弹窗），它没处理才退出 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web != null) {
                web.evaluateJavascript(
                    "(function(){try{return (window.catcardBack&&window.catcardBack())?1:0}catch(e){return 0}})()",
                    new ValueCallback<String>() {
                        @Override public void onReceiveValue(String v) {
                            if (!"1".equals(v)) finish();
                        }
                    });
            } else {
                finish();
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        filePathCallback = null;
        if (web != null) {
            web.removeJavascriptInterface("LotFile");
            web.removeJavascriptInterface("CatCard");
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** 给网页留一个"回原生"的口子（目前只暴露版本号，方便排查） */
    private class WebBridge {
        @JavascriptInterface
        public String appVersion() { return "1.0.0"; }

        @JavascriptInterface
        public String shell() { return "catcard-standalone"; }

        /* ★ 2026-11-17：网页侧每次 applyTheme() 都会调一次，告诉壳「现在深还是浅」。
           壳只做两件事：系统栏上色 + 图标反色（见 applySystemBars）。
           ⚠ 不能叫 setTheme —— 会跟 Context.setTheme(int) 撞名，反射挑方法时容易挑错。 */
        @JavascriptInterface
        public void setUiTheme(String theme) {
            final boolean dark = "dark".equals(theme);
            runOnUiThread(new Runnable() {
                @Override public void run() { applySystemBars(dark); }
            });
        }

        /* ★ 2026-10-11「鲸造」编辑器：导出牌面/牌背高清 PNG。
           网页把牌面矩形（物理像素）传进来，这里用 PixelCopy 截当前 Window
           （硬件加速下 View.draw 会黑屏/空白，PixelCopy 是官方正解），
           裁出那块，存进 Download/猫卡/ 并返回文件名。
           ⚠ 只写 Downloads（MediaStore.Downloads）—— 绝不写 DCIM/Pictures，
             所以导出的图**不会溢出到系统相册**。 */
        @JavascriptInterface
        public String capturePNG(String name, int x, int y, int w, int h) {
            if (web == null) return "失败";
            try {
                final int vw = web.getWidth(), vh = web.getHeight();
                if (vw <= 0 || vh <= 0) return "失败";
                final Bitmap full = Bitmap.createBitmap(vw, vh, Bitmap.Config.ARGB_8888);
                final CountDownLatch latch = new CountDownLatch(1);
                final int[] result = { PixelCopy.ERROR_UNKNOWN };
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        try {
                            PixelCopy.request(getWindow(), full,
                                new PixelCopy.OnPixelCopyFinishedListener() {
                                    @Override public void onPixelCopyFinished(int copyResult) {
                                        result[0] = copyResult;
                                        latch.countDown();
                                    }
                                }, mainHandler);
                        } catch (Exception e) {
                            result[0] = PixelCopy.ERROR_UNKNOWN;
                            latch.countDown();
                        }
                    }
                });
                if (!latch.await(5, TimeUnit.SECONDS) || result[0] != PixelCopy.SUCCESS) {
                    full.recycle();
                    return "失败";
                }
                /* 裁剪（clamp 到视口内，防越界） */
                final int cx = Math.max(0, Math.min(x, vw - 1));
                final int cy = Math.max(0, Math.min(y, vh - 1));
                final int cw = Math.max(1, Math.min(w, vw - cx));
                final int ch = Math.max(1, Math.min(h, vh - cy));
                Bitmap crop = null;
                try {
                    crop = Bitmap.createBitmap(full, cx, cy, cw, ch);
                } finally {
                    full.recycle();
                }
                try {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/猫卡");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) { crop.recycle(); return "失败"; }
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) { crop.recycle(); return "失败"; }
                    boolean ok = crop.compress(Bitmap.CompressFormat.PNG, 100, os);
                    os.close();
                    crop.recycle();
                    return ok ? name : "失败";
                } catch (Exception e) {
                    if (crop != null) crop.recycle();
                    return "失败";
                }
            } catch (Exception e) {
                return "失败";
            }
        }
    }
}
