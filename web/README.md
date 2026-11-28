# 网页版（GitHub Pages）

纯网页版，打开就能用：

- 手机版：<https://yves11923331.github.io/CatCard/>
- 电脑版：<https://yves11923331.github.io/CatCard/desktop/>（`/desktop/` 子路径）

## 这里放什么

| 文件 | 作用 |
|---|---|
| `web-bridge.js` | 浏览器版文件通道：补上 App 里由 Java 注入的 `window.LotFile`（下载 / 选文件 / 分享）。APK 内检测到原生桥就自动让路，纯网页才生效。 |
| `desktop.css` | 电脑版布局：≥1000px 时底部 tab → 左侧竖栏、占卜桌 → 画布 + 右侧牌堆栏、牌库 → 多列网格；窄窗口自动退回手机布局。 |
| `建站点.py` | 发布时把 `app/www` 拷成 `_site/`，再补 `js/web-bridge.js`，并生成 `_site/desktop/`。 |

**为什么不在 `app/www` 里直接改**：仓库里的 `www` 要和装机包里的 `www` 逐字节一致，
网页版只是发布时多贴的一张皮。所以 `app/www` 一行没动，差异全在发布产物里。

## 本地预览

```bash
python3 web/建站点.py app/www _site
python3 -m http.server 8900 --directory _site
# 打开 http://127.0.0.1:8900/
```

子路径也要正常（Pages 挂在 `/CatCard/` 下）：把 `_site` 放进一个名为 `CatCard`
的目录里再起服务，用 `http://127.0.0.1:8900/CatCard/` 访问 —— 资源全是相对路径，能过这一关就说明没问题。

## 电脑版是怎么省的

`_site/desktop/index.html` 是和手机版同一份 HTML，只多两样：`<base href="../">` 和一行 `desktop.css`。
图片、JS、CSS 全都复用上一层的，**不会为电脑版再拷一份 73MB**。一个仓只有一个 Pages，所以电脑版
走 `/desktop/` 子路径而不是单独建仓。

## 功能差异

- 牌组 / 签文包的导入导出：**能用**（浏览器下载 + `<input type=file>`）。
- 神签截图：**能用**（`lot-shot.js` 自己用 Canvas 重画，不依赖原生截图）。
- 编辑器「导出牌面 / 牌背 PNG」：**不能用**。它走的是 `window.CatCard.capturePNG`
  （Android 截视图），网页版不给假实现，界面会继续提示「导出需在猫卡 App 内使用」。
- 其余（占卜桌、牌库、编辑器、神签、骰子、周易、主题、数据全存 IndexedDB）与 App 一致。

## 发布

`.github/workflows/pages.yml`：`main` 上动到 `app/www/**` 或 `web/**` 就自动重建并发布，
不需要手动传文件，也不需要 gh-pages 分支。
