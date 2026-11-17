import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import type { BrowserWindow } from 'electron'
import { LocalizedError, msg } from '../shared/i18n/messages'

const command = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NexusOpenWith {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct OpenAsInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string File;
    public IntPtr Class;
    public uint Flags;
  }
  [DllImport("shell32.dll", ExactSpelling = true)]
  static extern int SHOpenWithDialog(IntPtr parent, ref OpenAsInfo info);
  public static int Show(long parent, string file) {
    var info = new OpenAsInfo { File = file, Flags = 4 };
    return SHOpenWithDialog(new IntPtr(parent), ref info);
  }
}
'@
$result = [NexusOpenWith]::Show([long]$env:NEXUS_OPEN_WITH_PARENT, $env:NEXUS_OPEN_WITH_FILE)
[Console]::WriteLine($result.ToString('X8'))
`, 'utf16le').toString('base64')

/** Opens the Windows software picker for a completed local copy.
 * @param window Window owning the picker.
 * @param file Absolute path of the app-managed copy.
 * @returns Whether Windows accepted the selection or reported cancellation.
 */
export function showWindowsOpenWith(window: BrowserWindow, file: string): Promise<'opened' | 'cancelled'> {
  const systemRoot = process.env.SystemRoot
  if (process.platform !== 'win32' || !systemRoot || !win32.isAbsolute(systemRoot)) {
    throw new LocalizedError(msg('localEdit.openUnavailable'))
  }
  const handle = window.getNativeWindowHandle()
  const parent = handle.length === 8 ? handle.readBigInt64LE().toString() : String(handle.readUInt32LE())
  const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', command], {
      windowsHide: true,
      env: { ...process.env, NEXUS_OPEN_WITH_PARENT: parent, NEXUS_OPEN_WITH_FILE: file },
    }, (error, stdout, stderr) => {
      const result = stdout.trim()
      if (!error && (result === '800704C7' || result === '80004004')) resolve('cancelled')
      else if (!error && result === '00000000') resolve('opened')
      else {
        console.error('Windows Open With failed', error?.code, result, stderr)
        reject(new LocalizedError(msg('localEdit.openFailed')))
      }
    })
  })
}
