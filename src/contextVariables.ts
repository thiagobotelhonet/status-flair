import * as os from 'os';
import * as vscode from 'vscode';
import { Variables } from './variables';

function userName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

function activeFolder(): vscode.WorkspaceFolder | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return (uri && vscode.workspace.getWorkspaceFolder(uri)) ?? vscode.workspace.workspaceFolders?.[0];
}

// Minimal slice of the built-in Git extension API (vscode.git, version 1).
interface GitRepository {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string; commit?: string }; onDidChange: vscode.Event<void> };
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

/** Feeds `${user}`, `${workspaceName}`, `${folderName}`, `${gitBranch}`, `${time}` and `${date}`. */
export function startContextVariables(vars: Variables): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const user = userName();

  const updateWorkspace = () =>
    vars.set({ user, workspaceName: vscode.workspace.name ?? '', folderName: activeFolder()?.name ?? '' });

  const updateClock = () => {
    const now = new Date();
    vars.set({
      time: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString(),
    });
  };

  updateWorkspace();
  updateClock();
  const clock = setInterval(updateClock, 10_000);
  disposables.push({ dispose: () => clearInterval(clock) });
  disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(updateWorkspace));
  disposables.push(vscode.window.onDidChangeActiveTextEditor(updateWorkspace));

  void watchGit(vars, disposables);
  return vscode.Disposable.from({ dispose: () => disposables.forEach((d) => d.dispose()) });
}

async function watchGit(vars: Variables, disposables: vscode.Disposable[]): Promise<void> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) {
    vars.set({ gitBranch: '' });
    return;
  }
  let api: GitApi;
  try {
    api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
  } catch {
    return;
  }

  const update = () => {
    const folder = activeFolder()?.uri.fsPath.toLowerCase();
    const repo =
      api.repositories.find((r) => folder?.startsWith(r.rootUri.fsPath.toLowerCase())) ?? api.repositories[0];
    const head = repo?.state.HEAD;
    vars.set({ gitBranch: head?.name ?? head?.commit?.slice(0, 7) ?? '' });
  };
  const watch = (repo: GitRepository) => disposables.push(repo.state.onDidChange(update));

  api.repositories.forEach(watch);
  disposables.push(
    api.onDidOpenRepository((repo) => {
      watch(repo);
      update();
    }),
    api.onDidCloseRepository(update),
    vscode.window.onDidChangeActiveTextEditor(update),
  );
  update();
}
