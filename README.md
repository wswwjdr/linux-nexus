# Linux Nexus

用于通过 SSH/SFTP 浏览和管理 Ubuntu 服务器文件的 Windows 桌面客户端。

## 功能

- [服务器连接与安全](docs/服务器连接与安全.md)：管理服务器连接，并查看 SSH 主机指纹与本机凭据的处理方式。
- [多会话与 SSH 终端](docs/多会话与SSH终端.md)：在多个 SFTP 文件管理器和 SSH 终端之间切换，并管理各自的连接状态。
- [文件浏览与操作](docs/文件浏览与操作.md)：浏览远端目录、切换列表视图，并管理文件和文件夹。
- [文件传输](docs/文件传输.md)：上传和下载文件或文件夹，查看进度并取消传输。
- [文件搜索](docs/文件搜索.md)：搜索远端文件名或文本内容。
- [文件预览](docs/文件预览.md)：预览支持的图片、文本、音频和视频格式。
- [应用设置](docs/应用设置.md)：设置默认文件视图和各类文件的预览大小上限。

## 开发

需要 Node.js 22.12 或更新版本，以及 npm。

```powershell
npm install
npm run dev
```

## Windows 安装包

```powershell
npm run dist:win
```

x64 NSIS 安装包生成在 `release/` 目录。
