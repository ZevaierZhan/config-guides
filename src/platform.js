import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigGuideError } from './errors.js';
const execFileAsync = promisify(execFile);

function windowsPowerShell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
function windowsPowerShellEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // PowerShell 7 hosts can inject a PSModulePath that Windows PowerShell 5.1
  // cannot use. Let the child rebuild its own system module path instead.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}

// A fixed command, not a downloaded .ps1. Only a file path travels in the child
// environment, never a credential. Run BEFORE writing bytes to an empty temp file.
// chmod(0600) alone does NOT enforce user-only DACLs on Windows.
const privateAclScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $p = $env:CONFIG_GUIDES_PRIVATE_FILE
  $item = Get-Item -LiteralPath $p -Force
  if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Not a regular local file' }
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($p))
  if ($drive.DriveFormat -notin @('NTFS', 'ReFS')) { throw 'A local NTFS or ReFS filesystem is required' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($sid)
  $allowed = @($sid.Value, $system.Value) | Select-Object -Unique
  foreach ($s in $allowed) {
    $identity = [Security.Principal.SecurityIdentifier]::new($s)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $p -AclObject $acl
  $check = Get-Acl -LiteralPath $p
  if (-not $check.AreAccessRulesProtected) { throw 'ACL inheritance was not disabled' }
  $rules = @($check.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne $allowed.Count) { throw 'Unexpected ACL count' }
  foreach ($r in $rules) {
    if (($r.IdentityReference.Value -notin $allowed) -or $r.IsInherited -or
        ($r.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) -or
        ($r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl)) { throw 'Unexpected ACL' }
  }
} catch { [Console]::Error.WriteLine('Unable to enforce private file ACL.'); exit 1 }
`;
export async function secureEmptyFile(filename) {
  if (process.platform !== 'win32') { await chmod(filename, 0o600); return; }
  try {
    await execFileAsync(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(privateAclScript, 'utf16le').toString('base64')], {
      env: windowsPowerShellEnv({ CONFIG_GUIDES_PRIVATE_FILE: filename }),
      shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 16_384,
    });
  } catch (cause) {
    throw new ConfigGuideError('PERMISSION_FAILED', '无法设置 Windows 私有 ACL，未写入配置内容。需要可用的系统 PowerShell 和本地 NTFS/ReFS；请检查组织策略。', { cause });
  }
}

/** Best effort only. Failure must not destroy a usable guide session. */
export async function launchBrowser(url) {
  const opts = { shell: false, windowsHide: true, timeout: 5_000, maxBuffer: 16_384 };
  if (process.platform === 'win32') {
    // Generated numeric-loopback URL only; passed through environment, not command text.
    const command = "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:CONFIG_GUIDES_OPEN_URL";
    await execFileAsync(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      ...opts, env: windowsPowerShellEnv({ CONFIG_GUIDES_OPEN_URL: url }),
    });
  } else if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/open', [url], opts);
  } else if (process.platform === 'linux') {
    if (process.env.WSL_DISTRO_NAME) {
      try { await execFileAsync('wslview', [url], opts); return; } catch { /* try desktop opener */ }
    }
    await execFileAsync('xdg-open', [url], opts);
  } else throw new Error('No supported browser opener');
}
