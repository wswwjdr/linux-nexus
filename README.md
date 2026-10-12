# Ubuntu Server Files

Windows desktop file browser for Ubuntu servers over SSH/SFTP.

## Development

Requires Node.js 22.12 or newer and npm.

```powershell
npm install
npm run dev
```

## Windows installer

```powershell
npm run dist:win
```

The x64 NSIS installer is written to `release/`.

Connection passwords are encrypted with Electron `safeStorage` on Windows and stored in the current user's application data directory. Server host key fingerprints are pinned after explicit confirmation.
