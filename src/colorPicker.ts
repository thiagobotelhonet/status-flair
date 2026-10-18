import * as vscode from 'vscode';
import { normalizeHex, PRESETS, randomColor } from './colors';
import { ColorTarget, hasWorkspace, readColorTarget, updateSetting } from './config';

interface ColorPick extends vscode.QuickPickItem {
  hex?: string;
  action?: 'custom' | 'random' | 'remove';
}

/** Hooks the picker uses to preview a color live and to apply the final choice. */
export interface PickerHost {
  preview(hex: string | undefined): Promise<void>;
}

export async function pickColor(host: PickerHost, scope: 'configured' | 'workspace'): Promise<void> {
  const target: ColorTarget = scope === 'workspace' ? 'workspace' : readColorTarget();
  if (target === 'workspace' && !hasWorkspace()) {
    void vscode.window.showWarningMessage('Open a folder to set a color for this workspace.');
    return;
  }

  const items: ColorPick[] = [
    { label: '$(edit) Custom hex color…', action: 'custom' },
    { label: '$(refresh) Random color', action: 'random' },
    { label: 'Presets', kind: vscode.QuickPickItemKind.Separator },
    ...PRESETS.map((p) => ({ label: `$(circle-filled) ${p.name}`, description: p.hex, hex: p.hex })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(circle-slash) Remove color', description: 'back to the theme', action: 'remove' },
  ];

  const picked = await new Promise<ColorPick | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<ColorPick>();
    qp.title = target === 'workspace' ? 'Status bar color for this workspace' : 'Status bar color';
    qp.placeholder = 'Move through the presets to preview them';
    qp.items = items;
    qp.onDidChangeActive(([item]) => void host.preview(item?.hex));
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });

  let hex: string | undefined;
  if (picked?.action === 'custom') {
    hex = await askHex(host);
  } else if (picked?.action === 'random') {
    hex = randomColor();
  } else if (picked?.action === 'remove') {
    hex = '';
  } else {
    hex = picked?.hex;
  }

  await host.preview(undefined);
  if (hex === undefined) {
    return;
  }
  if (scope === 'workspace') {
    await updateSetting('colors.target', 'workspace', 'workspace');
  }
  await updateSetting('colors.background', hex, target);
}

async function askHex(host: PickerHost): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Custom status bar color',
    prompt: 'Hex color, like #9f00a6 or #c33',
    validateInput: (text) => {
      const hex = normalizeHex(text);
      void host.preview(hex);
      return hex || !text ? undefined : 'Use a hex color such as #9f00a6';
    },
  });
  return value === undefined ? undefined : normalizeHex(value);
}

export async function applyRandomColor(): Promise<void> {
  await updateSetting('colors.background', randomColor(), readColorTarget());
}
