import * as vscode from "vscode";
import { Storage } from "./storage";
import { AnnotationController } from "./controller";
import { Decorations } from "./decorations";

interface WorkspaceState {
  storage: Storage;
  controller: AnnotationController;
  decorations: Decorations;
  folder: vscode.WorkspaceFolder;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let state: WorkspaceState | undefined;

  const initForFolder = async (folder: vscode.WorkspaceFolder): Promise<WorkspaceState> => {
    const storage = new Storage(folder);
    await storage.init();
    const controller = new AnnotationController(storage, folder);
    await controller.init();
    const decorations = new Decorations(context, storage, folder);
    decorations.refresh();

    const subs: vscode.Disposable[] = [
      storage,
      controller,
      decorations,
      storage.onDidChangeExternal(() => {
        controller.refresh();
        decorations.refresh();
      }),
      controller.onDidChange(() => {
        decorations.refresh();
      })
    ];
    context.subscriptions.push(...subs);
    return { storage, controller, decorations, folder };
  };

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    state = await initForFolder(folder);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      if (state) return;
      const next = vscode.workspace.workspaceFolders?.[0];
      if (next) state = await initForFolder(next);
    })
  );

  const requireState = (): WorkspaceState | undefined => {
    if (!state) {
      vscode.window.showWarningMessage(
        "Code Annotate needs an open folder. Open a folder, then try again."
      );
      return undefined;
    }
    return state;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("codeAnnotate.addAnnotation", async () => {
      const s = requireState();
      if (!s) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file and select lines to annotate.");
        return;
      }
      const selection = editor.selection;
      const startLine = selection.start.line;
      const endLine =
        selection.end.character === 0 && selection.end.line > selection.start.line
          ? selection.end.line - 1
          : selection.end.line;
      const endLineLength = editor.document.lineAt(endLine).range.end.character;
      const range = new vscode.Range(startLine, 0, endLine, endLineLength);
      s.controller.startDraftThread(editor.document.uri, range);
      editor.selection = new vscode.Selection(startLine, 0, endLine, endLineLength);
    }),

    vscode.commands.registerCommand(
      "codeAnnotate.replyToThread",
      async (reply: vscode.CommentReply) => {
        const s = requireState();
        if (!s) return;
        await s.controller.submit(reply.thread, reply.text);
        s.decorations.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "codeAnnotate.resolveThread",
      async (thread: vscode.CommentThread) => {
        const s = requireState();
        if (!s) return;
        await s.controller.setStatus(thread, "resolved");
        s.decorations.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "codeAnnotate.unresolveThread",
      async (thread: vscode.CommentThread) => {
        const s = requireState();
        if (!s) return;
        await s.controller.setStatus(thread, "open");
        s.decorations.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "codeAnnotate.deleteAnnotation",
      async (thread: vscode.CommentThread) => {
        const s = requireState();
        if (!s) return;
        const isSaved = !!s.controller.findAnnotationIdByThread(thread);
        if (isSaved) {
          const confirm = await vscode.window.showWarningMessage(
            "Delete this annotation and its thread?",
            { modal: true },
            "Delete"
          );
          if (confirm !== "Delete") return;
        }
        await s.controller.deleteThread(thread);
        s.decorations.refresh();
      }
    ),

    vscode.commands.registerCommand("codeAnnotate.clearResolved", async () => {
      const s = requireState();
      if (!s) return;
      const resolvedCount = s.storage.getAll().filter((a) => a.status === "resolved").length;
      if (resolvedCount === 0) {
        vscode.window.showInformationMessage("No resolved annotations to clear.");
        return;
      }
      const label = resolvedCount === 1 ? "1 resolved annotation" : `${resolvedCount} resolved annotations`;
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${label}? This cannot be undone.`,
        { modal: true },
        "Delete"
      );
      if (confirm !== "Delete") return;
      const removed = await s.controller.clearResolved();
      s.decorations.refresh();
      vscode.window.showInformationMessage(
        `Cleared ${removed} resolved annotation${removed === 1 ? "" : "s"}.`
      );
    }),

    vscode.commands.registerCommand("codeAnnotate.showAllAnnotations", async () => {
      const s = requireState();
      if (!s) return;
      const items = s.storage.getAll().map((a) => ({
        label: `${a.status === "resolved" ? "✓" : "●"} ${a.file}:${a.startLine}-${a.endLine}`,
        description: a.thread[0]?.body.split("\n")[0] ?? "",
        annotation: a
      }));
      if (items.length === 0) {
        vscode.window.showInformationMessage("No annotations yet.");
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Jump to annotation"
      });
      if (!picked) return;
      const target = vscode.Uri.joinPath(s.folder.uri, picked.annotation.file);
      const doc = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, picked.annotation.startLine - 1);
      const range = new vscode.Range(line, 0, line, 0);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(line, 0, line, 0);
    })
  );
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
