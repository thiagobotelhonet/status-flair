import * as vscode from 'vscode';
import { ColorMap, mapsEqual, mergeOwned, Owned } from './colors';
import { ColorTarget, hasWorkspace } from './config';

const OWNED_KEY = 'statusFlair.ownedColors';

export interface DesiredColors {
  global: ColorMap;
  workspace: ColorMap;
}

/**
 * Writes status bar colors into `workbench.colorCustomizations`, remembering
 * what each key held before so it can be restored. Only touches settings when
 * something actually changes.
 */
export class ColorManager {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  apply(desired: DesiredColors): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        await this.applyTarget('global', desired.global);
        if (hasWorkspace()) {
          await this.applyTarget('workspace', desired.workspace);
        }
      })
      .catch((err) => {
        void vscode.window.showWarningMessage(`Status Flair could not update colors: ${err?.message ?? err}`);
      });
    return this.queue;
  }

  private async applyTarget(target: ColorTarget, desired: ColorMap): Promise<void> {
    const memento = target === 'global' ? this.context.globalState : this.context.workspaceState;
    const owned = memento.get<Owned>(OWNED_KEY, {});
    if (Object.keys(owned).length === 0 && Object.keys(desired).length === 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration('workbench');
    const inspected = config.inspect<ColorMap>('colorCustomizations');
    const current = { ...((target === 'global' ? inspected?.globalValue : inspected?.workspaceValue) ?? {}) };
    const { next, owned: nextOwned } = mergeOwned(current, owned, desired);

    await memento.update(OWNED_KEY, nextOwned);
    if (!mapsEqual(current, next)) {
      const scope = target === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
      await config.update('colorCustomizations', Object.keys(next).length > 0 ? next : undefined, scope);
    }
  }
}
