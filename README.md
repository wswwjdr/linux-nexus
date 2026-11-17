# Linux Nexus · Windows SSH 服务器管理工具

简体中文 | [English](README.en.md)

**在 Windows 桌面上，通过 SSH 管理多台 Linux 服务器：文件管理、终端、上传下载、文件预览与性能监控。**

Linux Nexus 面向日常需要维护 Linux 服务器的开发者和运维人员，将远端文件管理器（file manager）与 SSH terminal 放在同一个桌面应用中。应用安装在 Windows 本机，通过 SSH 调用服务器原生命令，无需在服务器安装常驻助手。

[**下载 Windows x64 安装包**](https://github.com/wswwjdr/linux-nexus/releases/latest) · [快速开始](#快速开始) · [功能文档](#文档) · [更多截图](#界面截图)

![Linux Nexus：Windows 桌面上的 Linux 服务器文件管理器](https://preview.tcwwj.icu/linux_nexus/列表视图.png)

## 主要功能

| 功能 | 可以做什么 |
| --- | --- |
| 远端文件管理 | 列表与图标视图、文件名与内容搜索、复制、移动、重命名、删除和解压 |
| 智能体助手 | 通过 SSH 自主执行运维任务，支持命令审批、实时日志和可编辑提示词 |
| SSH 终端与多服务器 | 同时连接多台服务器，在文件管理和终端标签间切换 |
| 上传与下载 | 传输文件和文件夹，查看进度、取消任务，设置传输并发数 |
| 文件预览与编辑 | 编辑文本，预览 Markdown、图片、PDF、音视频与日志，或右键[使用本机软件打开](docs/文件预览.md#使用本机软件打开)远程文件 |
| 脚本与命令工具 | 执行远端脚本、管理 Bash 命令别名、为当前文件会话启用 sudo root 模式 |
| 性能监控 | 按服务器配置开启实时监控，文件管理与 SSH 终端标签共享读数，包括逐逻辑 CPU、内存、Swap、本地挂载点、块设备 I/O 和网卡流量 |

文件管理和传输通过 **SSH 命令通道**执行。远端复制、移动由服务器的 `cp`、`mv` 完成，文件内容不经 Windows 中转。

Markdown 支持目录、代码高亮与复制；图片支持缩放、拖拽、旋转和翻转；音视频支持快捷键，视频支持全屏和长按临时倍速。操作与格式限制见[文件预览](docs/文件预览.md)。

## 下载与安装

前往 [GitHub Releases](https://github.com/wswwjdr/linux-nexus/releases/latest)，在 **Assets** 中下载 Windows x64 的 `.exe` 安装包，运行后按向导安装。使用安装包无需安装 Node.js 或 npm。

README 描述当前源码的功能；已发布安装包的功能以对应 Release 说明为准。

### 系统要求

| 环境 | 要求 |
| --- | --- |
| 本机 | Windows x64；当前打包目标为 x64 NSIS 安装包 |
| 连接 | 可访问服务器的 SSH 服务，使用用户名和密码认证，默认端口 `22` |
| 文件会话 | Linux 服务器通过 Bash 和目录浏览所需的 `find` 检查即可使用 |
| 依赖准备 | 首次可跳过解压工具准备。具体功能缺少可识别的依赖时，可确认使用 apt-get、dnf 或 yum 安装并复查 |
| 下载位置 | 支持硬链接的本机文件系统，例如 NTFS |
| 在线文本保存 | 服务器需提供 `acl`、`attr` 工具；缺失时应用可在确认后安装 |

SSH 终端保持服务器原生交互。具体能力检查、权限和 sudo 要求见[服务器连接与安全](docs/服务器连接与安全.md)。各发行版的实机验证进度见[待处理](docs/待处理.md)。

## 快速开始

1. 启动应用，添加服务器，填写连接名称、主机、SSH 端口、用户名和密码。
2. 打开文件管理或 SSH 终端会话；首次连接时，核对服务器主机指纹后再信任。
3. 在文件管理中浏览目录、拖入本机文件上传，或通过右键菜单下载、预览和操作远端文件。
4. 为其他服务器打开新标签，在多个文件管理与终端会话之间切换。

## 界面语言

支持简体中文和英文，语言资源随应用分发，无需联网。首次启动默认跟随系统：中文系统使用简体中文，其余语言使用英文。
在应用设置的「语言」中选择「跟随系统」「简体中文」或「English」，切换立即生效并自动保存，不会中断连接、传输或预览。
文件名、命令、终端输出和远端文件内容保持原文；Windows 原生控件遵循系统语言。

## 本地开发与打包

开发运行需要 Windows、Node.js 22.12+ 和 npm：

```powershell
npm install
npm run dev
```

开发服务固定使用 `50001` 端口；端口被占用时启动会报错，不会自动切换端口。

生成 x64 NSIS 安装包：

```powershell
npm run dist:win
```

安装包位于 `release/`，版本取自 `package.json` 的 `version`。发版时，在 GitHub Releases 创建 Release，选择 tag，填写版本说明，并上传生成的 `.exe`。用户下载并运行该安装包即可安装或升级。

## 文档

各模块功能、服务器要求和操作规则详见：

- [服务器连接与安全](docs/服务器连接与安全.md)
- [多会话与 SSH 终端](docs/多会话与SSH终端.md)
- [文件浏览与操作](docs/文件浏览与操作.md)
- [智能体助手](docs/智能体助手.md)
- [文件传输](docs/文件传输.md)
- [文件搜索](docs/文件搜索.md)
- [文件预览](docs/文件预览.md)
- [远端脚本执行](docs/脚本执行.md)
- [应用设置](docs/应用设置.md)

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

剩余实机验证项目见[待处理](docs/待处理.md)。

## 界面截图

### 首页

![首页](https://preview.tcwwj.icu/linux_nexus/首页.png)

### 图标视图

![图标视图](https://preview.tcwwj.icu/linux_nexus/图标视图.png)

### 右键菜单：空白处

![右键菜单-空白处](https://preview.tcwwj.icu/linux_nexus/右键菜单-空白处.png)

### 右键菜单：文件

![右键菜单-文件](https://preview.tcwwj.icu/linux_nexus/右键菜单-文件.png)

### 右键菜单：文件夹

![右键菜单-文件夹](https://preview.tcwwj.icu/linux_nexus/右键菜单-文件夹.png)

### 文件搜索：通过文件名

![文件搜索-通过文件名](https://preview.tcwwj.icu/linux_nexus/文件搜索-通过文件名.png)

### 文件搜索：通过文本

![文件搜索-通过文本](https://preview.tcwwj.icu/linux_nexus/文件搜索-通过文本.png)

### 文件解压

![文件解压](https://preview.tcwwj.icu/linux_nexus/文件解压.png)

### 文件预览：md

![文件预览-md](https://preview.tcwwj.icu/linux_nexus/文件预览-md.png)

### 文件预览：图片

![文件预览-图片](https://preview.tcwwj.icu/linux_nexus/文件预览-图片.png)

### 文件预览：音频

![文件预览-音频](https://preview.tcwwj.icu/linux_nexus/文件预览-音频.png)

### 文件预览：视频

![文件预览-视频](https://preview.tcwwj.icu/linux_nexus/文件预览-视频.png)

### SSH终端

![SSH终端](https://preview.tcwwj.icu/linux_nexus/SSH终端.png)

### 脚本快捷执行

![脚本快捷执行](https://preview.tcwwj.icu/linux_nexus/脚本快捷执行.png)

### 性能监控

![性能监控](https://preview.tcwwj.icu/linux_nexus/性能监控.png)

### 快捷键说明

![快捷键说明](https://preview.tcwwj.icu/linux_nexus/快捷键说明.png)

### 设置

![设置](https://preview.tcwwj.icu/linux_nexus/设置.png)

