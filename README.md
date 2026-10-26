# Linux Nexus

用于通过 SSH/SFTP 浏览和管理 Ubuntu 服务器文件的 Windows 桌面客户端。

## 功能

- [服务器连接与安全](docs/服务器连接与安全.md)：管理服务器连接，并查看 SSH 主机指纹与本机凭据的处理方式。
- [多会话与 SSH 终端](docs/多会话与SSH终端.md)：在多个 SFTP 文件管理器和 SSH 终端之间切换，并管理各自的连接状态。
- [文件浏览与操作](docs/文件浏览与操作.md)：浏览远端目录、切换列表视图，并管理文件和文件夹。
- [文件传输](docs/文件传输.md)：上传和下载文件或文件夹，查看进度并取消传输。
- [文件搜索](docs/文件搜索.md)：搜索远端文件名或文本内容。
- [文件预览](docs/文件预览.md)：预览文本、Markdown、PDF 和图片，播放音频与视频。
- [远端脚本执行](docs/脚本执行.md)：在服务器上执行脚本、查看输出并停止执行。
- [应用设置](docs/应用设置.md)：设置外观、启动连接、命令别名、文件类型、传输并发、性能监控和预览大小上限。

## 系统功能截图

### 文件管理

![首页](docs/系统功能截图/首页.png)

![SFTP 模式](docs/系统功能截图/SFTP 模式.png)

![SFTP 列表视图](docs/系统功能截图/SFTP 列表视图.png)

![右键菜单](docs/系统功能截图/右键菜单.png)

### SSH 终端

![SSH 终端](docs/系统功能截图/SSH 终端.png)

### 文件预览

![Markdown 文件预览](docs/系统功能截图/markdown 文件预览.png)

### 设置与辅助功能

![设置](docs/系统功能截图/设置.png)

![性能监控](docs/系统功能截图/性能监控.png)

![快捷键说明](docs/系统功能截图/快捷键说明.png)

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
