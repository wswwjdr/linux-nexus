# Linux Nexus

[简体中文](README.md) | English

**Manage Linux server files from a Windows desktop interface and run remote SSH commands directly.**

## Features

- File management: browse directories, search, upload, download, copy, move, rename, delete, and extract archives.
- SSH sessions: file manager and terminal tabs, with simultaneous connections to multiple servers.
- Previews and tools: text, Markdown, images, PDF, audio, video, and logs, plus remote script execution, command aliases, and performance monitoring.

Markdown previews provide read-only formatting, a table of contents, syntax highlighting, code copying, and images from the server or the web. Image previews support zooming, dragging, rotation, and flipping. Audio and video support keyboard shortcuts; video also supports fullscreen and temporary faster playback while holding a key. See [File previews (Chinese)](docs/文件预览.md) for controls and limitations.

## Design principles

The file manager collects parameters through its interface and invokes native server commands over SSH. Remote file copies and moves do not route file contents through Windows.
Multi-step operations retain known inputs, collect any remaining parameters through the interface, then generate and execute the command over SSH.

## Interface language

Simplified Chinese and English are included with the application and work offline. The default follows the system language: Chinese systems use Simplified Chinese; other languages use English.
In application settings, choose **Follow system**, **简体中文**, or **English**. Changes take effect immediately and are saved automatically, without interrupting connections, transfers, or previews.
Filenames, commands, terminal output, and remote file contents remain in their original language. Windows native controls follow the operating system language.

## Running locally

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

See [Pending verification (Chinese)](docs/待处理.md) for the remaining checks on real systems. Download destinations must support hard links. Preserving metadata when editing remote files requires the server's `acl` and `attr` tools.

## Screenshots

The screenshots below show the Chinese interface.

### Home

![Home](docs/系统功能截图/首页.png)

### Details view

![Details view](docs/系统功能截图/列表视图.png)

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
