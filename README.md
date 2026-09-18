# 随身阅读

一个静态网页版 PDF/EPUB 阅读器，适合在 iPhone Chrome 或 Safari 里使用。

## 第一版功能

- 从手机文件选择器打开本地 PDF 或 EPUB
- 单页阅读
- 上一页、下一页、页码跳转
- 放大、缩小、适宽
- 自动保存最近打开的 PDF/EPUB 和阅读进度
- 书架列表，可查看、切换、删除已保存的 PDF/EPUB
- EPUB 章节目录，可快速跳转
- 本地密码锁，可锁住阅读器入口
- 悬浮锁按钮，连续阅读时不用回到顶部
- PWA manifest 与基础离线缓存

## 本地预览

```powershell
npm.cmd run start
```

电脑访问：

```text
http://127.0.0.1:5173/?v=114
```

手机访问时，手机和电脑需要在同一个 Wi-Fi 下，然后把 `127.0.0.1` 换成电脑的局域网 IP。

## 构建静态站点

```powershell
npm.cmd run build
```

构建后会生成：

```text
dist/
```

`dist` 目录就是完整静态网页，可以部署到 GitHub Pages、Cloudflare Pages、Vercel、Netlify、自己的服务器，或任何能托管静态文件的地方。

本地预览构建产物：

```powershell
npm.cmd run serve:dist
```

然后访问：

```text
http://127.0.0.1:5174/?v=114
```

## iPhone 使用

部署到 HTTPS 地址后，用手机 Chrome 或 Safari 打开网页，点「打开文件」，从“文件”App 里选择 PDF 或 EPUB。

如果想添加到主屏幕，建议用 Safari 打开 HTTPS 地址，再点分享按钮，选择“添加到主屏幕”。

## 注意

- PDF/EPUB 保存在当前浏览器对这个网址的本地存储里，不会自动上传。
- 换浏览器、换网址、清理浏览器网站数据后，已保存的 PDF/EPUB 可能不可见。
- 局域网 HTTP 地址适合测试；长期使用建议部署到 HTTPS。
- 超过 32 MiB 的解密导出和分块备份导出使用浏览器临时文件，需 HTTPS（或 localhost）及支持 OPFS 的浏览器。空间不足或不支持时会提示失败，保留书架原文件。
- 导出临时文件在下载触发约 5 分钟后清理；异常退出留下的文件会在后续大文件导出时清理（保留不到 24 小时的文件，避免打断其他页面的导出）。

## 回归验证

运行 `npm.cmd test` 验证空白页、恢复次数上限、PDF/EPUB 临时阅读进度、书架读取次数及导出内容和清理逻辑。

浏览器自测使用独立的本地测试端口，避免改变日常书架的阅读状态：

```powershell
py -3 -m http.server 5183 --bind 127.0.0.1
```

访问 `http://127.0.0.1:5183/?selftest=reader-regressions`，测试空白首页、连续空白页、存储失败后的进度，以及 33 MiB 临时文件导出。页面显示「自测通过」表示完成。已有 `encrypted-switch`、`rapid-switch`、`continuous-window` 和 `fullscreen-progress` 自测仍可通过同一参数运行。
