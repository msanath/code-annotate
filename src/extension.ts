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
      const range = new vscode.Range(startLine, 0, endLine, 0);
      const body = await vscode.window.showInputBox({
        prompt: `Annotate lines ${startLine + 1}-${endLine + 1}`,
        placeHolder: "What about this code?"
      });
      if (!body) return;
      await s.controller.addAnnotation(editor.document.uri, range, body);
      s.decorations.refresh();
    }),

    vscode.commands.registerCommand(
      "codeAnnotate.replyToThread",
      async (reply: vscode.CommentReply) => {
        const s = requireState();
        if (!s) return;
        await s.controller.reply(reply.thread, reply.text);
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
        const confirm = await vscode.window.showWarningMessage(
          "Delete this annotation and its thread?",
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") return;
        await s.controller.deleteThread(thread);
        s.decorations.refresh();
      }
    ),

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
