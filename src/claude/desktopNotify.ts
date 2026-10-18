import { execFile } from 'child_process';

function psString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Shows an operating system notification. Failures are ignored: this is a nicety. */
export function desktopNotify(title: string, body: string): void {
  const done = () => undefined;
  if (process.platform === 'win32') {
    // Windows toasts need an app id; PowerShell's own is always registered.
    const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Reminder"/></toast>`;
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
      '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
      `$doc.LoadXml(${psString(xml)})`,
      "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))',
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 }, done);
  } else if (process.platform === 'darwin') {
    const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    execFile('osascript', ['-e', `display notification ${q(body)} with title ${q(title)} sound name "Glass"`], { timeout: 10_000 }, done);
  } else {
    execFile('notify-send', ['-a', 'Status Flair', title, body], { timeout: 10_000 }, done);
  }
}
