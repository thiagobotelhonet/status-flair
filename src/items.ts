import * as vscode from 'vscode';
import { readExtraItems, readItem, toAlignment } from './config';
import { label, render } from './template';
import { Variables } from './variables';

interface Rendered {
  item: vscode.StatusBarItem;
  text: string;
  icon: string;
  tooltip: string;
}

export const ITEM_CLICK_COMMAND = 'statusFlair.itemClick';

/** The main custom item plus any `extraItems`. */
export class ItemsManager implements vscode.Disposable {
  private items: Rendered[] = [];
  private readonly subscription: vscode.Disposable;

  constructor(private readonly vars: Variables) {
    this.subscription = vars.onDidChange(() => this.render());
  }

  /** Alignment and priority are fixed at creation, so any config change recreates the items. */
  rebuild(): void {
    this.disposeItems();

    const main = readItem();
    if (main.enabled) {
      const item = vscode.window.createStatusBarItem('statusFlair.main', toAlignment(main.alignment), main.priority);
      item.name = 'Status Flair';
      item.command = main.clickAction === 'none' ? undefined : ITEM_CLICK_COMMAND;
      this.items.push({ item, text: main.text, icon: main.icon, tooltip: main.tooltip });
    }

    readExtraItems().forEach((extra, i) => {
      const item = vscode.window.createStatusBarItem(`statusFlair.extra.${i}`, toAlignment(extra.alignment), extra.priority ?? 0);
      item.name = `Status Flair: ${extra.text ?? `item ${i + 1}`}`;
      if (extra.url) {
        item.command = { title: 'Open', command: 'vscode.open', arguments: [vscode.Uri.parse(extra.url)] };
      } else if (extra.command) {
        item.command = { title: extra.command, command: extra.command, arguments: extra.args ?? [] };
      }
      this.items.push({ item, text: extra.text ?? '', icon: extra.icon ?? '', tooltip: extra.tooltip ?? '' });
    });

    this.render();
  }

  private render(): void {
    const vars = this.vars.all;
    for (const r of this.items) {
      r.item.text = label(r.icon, render(r.text, vars));
      r.item.tooltip = render(r.tooltip, vars) || undefined;
      r.item.show();
    }
  }

  private disposeItems(): void {
    this.items.forEach((r) => r.item.dispose());
    this.items = [];
  }

  dispose(): void {
    this.disposeItems();
    this.subscription.dispose();
  }
}
