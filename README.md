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
http://127.0.0.1:5173/?v=110
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
http://127.0.0.1:5174/?v=110
```

## iPhone 使用

部署到 HTTPS 地址后，用手机 Chrome 或 Safari 打开网页，点「打开文件」，从“文件”App 里选择 PDF 或 EPUB。

如果想添加到主屏幕，建议用 Safari 打开 HTTPS 地址，再点分享按钮，选择“添加到主屏幕”。

## 注意

- PDF/EPUB 保存在当前浏览器对这个网址的本地存储里，不会自动上传。
- 换浏览器、换网址、清理浏览器网站数据后，已保存的 PDF/EPUB 可能不可见。
- 局域网 HTTP 地址适合测试；长期使用建议部署到 HTTPS。
