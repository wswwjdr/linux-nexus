# Ubuntu Server Files

一个用于浏览 Ubuntu 服务器文件的 Windows 桌面客户端，通过 SSH/SFTP 连接。

## 功能

- 保存多个服务器连接，并安全保存 SSH 密码。
- 浏览远程目录，默认从根目录 `/` 开始。
- 上传多个文件或递归上传文件夹，也可下载文件和递归下载文件夹。
- 预览 JPG、JPEG、PNG、GIF、TXT、SH、MP3 和 MP4 文件。
- 首次连接时校验服务器主机指纹，并记住已确认的指纹。

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

连接密码使用 Electron `safeStorage` 在 Windows 上加密，并保存在当前用户的应用数据目录。服务器主机指纹会在用户确认后固定保存。
