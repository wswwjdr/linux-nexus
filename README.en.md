# Linux Nexus · Windows SSH File Manager & Terminal

[简体中文](README.md) | English

**A Windows desktop app for managing multiple Linux servers over SSH: file manager, terminal, transfers, previews, and monitoring.**

Linux Nexus brings remote file management and an SSH terminal into one desktop application for developers and system administrators. It runs on your Windows PC and invokes native server commands over SSH, with no resident helper to install on the server.

[**Download for Windows x64**](https://github.com/wswwjdr/linux-nexus/releases/latest) · [Quick start](#quick-start) · [Documentation](#documentation) · [More screenshots](#screenshots)

![Linux Nexus: Linux server file manager on the Windows desktop](docs/系统功能截图/列表视图.png)

## Features

| Feature | What you can do |
| --- | --- |
| Remote file manager | Browse list and icon views, search filenames and contents, copy, move, rename, delete, and extract archives |
| SSH terminal and multiple servers | Connect to multiple servers and switch between file manager and terminal tabs |
| Uploads and downloads | Transfer files and folders, track progress, cancel tasks, and configure concurrency |
| Previews and editing | Edit text files; preview Markdown, images, PDF, audio, video, and logs |
| Scripts and commands | Run remote scripts, manage Bash command aliases, and enable sudo root mode for an individual file session |
| Performance monitoring | View server metrics and configure sampling intervals and alert thresholds |

File management and transfers use **SSH command channels**. Remote copies and moves run through the server's `cp` and `mv` commands without routing file contents through Windows.

Markdown previews include a table of contents, syntax highlighting, and code copying. Image previews support zooming, dragging, rotation, and flipping. Audio and video support keyboard shortcuts; video also supports fullscreen and temporary faster playback while holding a key. See [File previews (Chinese)](docs/文件预览.md) for controls and format limitations.

## Download and install

Open [GitHub Releases](https://github.com/wswwjdr/linux-nexus/releases/latest) and download the Windows x64 `.exe` installer under **Assets**. Run it and follow the installation wizard. Node.js and npm are not required to use the installer.

This README describes the current source code. For features included in a published installer, see its release notes.

### System requirements

| Environment | Requirement |
| --- | --- |
| Local PC | Windows x64; the current build target is an x64 NSIS installer |
| Connection | A reachable SSH server with username and password authentication; default port `22` |
| File sessions | Ubuntu, Debian, CentOS 7/8, CentOS Stream 8/9/10, or RHEL 8/9/10, passing command capability checks at connection time |
| Server tools | Bash, GNU coreutils, GNU findutils, GNU grep, GNU tar, and sed; archive extraction requires tools for the selected format |
| Download destination | A local file system with hard-link support, such as NTFS |
| Remote text saves | The server needs `acl` and `attr` tools; the app can install missing packages after confirmation |

SSH terminal sessions are not restricted to the file-session distribution list above. See [Server connections and security (Chinese)](docs/服务器连接与安全.md) for capability checks, permissions, and sudo requirements. Checks still pending on real systems are tracked in [Pending verification (Chinese)](docs/待处理.md).

## Quick start

1. Launch the app and add a server with a connection name, host, SSH port, username, and password.
2. Open a file manager or SSH terminal session. On first connection, verify the server's host fingerprint before trusting it.
3. Browse remote directories, drag in local files to upload, or use the context menu to download, preview, and manage files.
4. Open tabs for other servers and switch between file manager and terminal sessions.

## Interface language

Simplified Chinese and English are included with the application and work offline. The default follows the system language: Chinese systems use Simplified Chinese; other languages use English.
In application settings, choose **Follow system**, **简体中文**, or **English**. Changes take effect immediately and are saved automatically, without interrupting connections, transfers, or previews.
Filenames, commands, terminal output, and remote file contents remain in their original language. Windows native controls follow the operating system language.

## Local development and packaging

Development requires Windows, Node.js 22.12+, and npm:

```powershell
npm install
npm run dev
```

The development server uses port `50001`. Startup fails if the port is occupied; it does not switch ports automatically.

Build an x64 NSIS installer:

```powershell
npm run dist:win
```

Build artifacts are written to `release/`.

## Documentation

Detailed user documentation is currently available in Chinese:

- [Server connections and security](docs/服务器连接与安全.md)
- [Multiple sessions and SSH terminals](docs/多会话与SSH终端.md)
- [File browsing and operations](docs/文件浏览与操作.md)
- [File transfers](docs/文件传输.md)
- [File search](docs/文件搜索.md)
- [File previews](docs/文件预览.md)
- [Remote script execution](docs/脚本执行.md)
- [Application settings](docs/应用设置.md)

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

See [Pending verification (Chinese)](docs/待处理.md) for the remaining checks on real systems.

## Screenshots

The screenshots below show the Chinese interface.

### Home

![Home](docs/系统功能截图/首页.png)

### Icon view

![Icon view](docs/系统功能截图/图标视图.png)

### Context menu: directory background

![Context menu: directory background](docs/系统功能截图/右键菜单-空白处.png)

### Context menu: file

![Context menu: file](docs/系统功能截图/右键菜单-文件.png)

### Context menu: folder

![Context menu: folder](docs/系统功能截图/右键菜单-文件夹.png)

### Search by filename

![Search by filename](docs/系统功能截图/文件搜索-通过文件名.png)

### Search by content

![Search by content](docs/系统功能截图/文件搜索-通过文本.png)

### Archive extraction

![Archive extraction](docs/系统功能截图/文件解压.png)

### Markdown preview

![Markdown preview](docs/系统功能截图/文件预览-md.png)

### Image preview

![Image preview](docs/系统功能截图/文件预览-图片.png)

### Audio preview

![Audio preview](docs/系统功能截图/文件预览-音频.png)

### Video preview

![Video preview](docs/系统功能截图/文件预览-视频.png)

### SSH terminal

![SSH terminal](docs/系统功能截图/SSH终端.png)

### Script execution

![Script execution](docs/系统功能截图/脚本快捷执行.png)

### Performance monitoring

![Performance monitoring](docs/系统功能截图/性能监控.png)

### Keyboard shortcuts

![Keyboard shortcuts](docs/系统功能截图/快捷键说明.png)

### Settings

![Settings](docs/系统功能截图/设置.png)

