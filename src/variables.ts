import * as vscode from 'vscode';

/** Shared values for `${name}` placeholders. Fires once per batch of real changes. */
export class Variables implements vscode.Disposable {
  private readonly values: Record<string, string> = {};
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  get all(): Readonly<Record<string, string>> {
    return this.values;
  }

  set(partial: Record<string, string>): void {
    let changed = false;
    for (const [key, value] of Object.entries(partial)) {
      if (this.values[key] !== value) {
        this.values[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
