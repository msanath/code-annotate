import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Storage } from "./storage";
import { Annotation } from "./types";

export class Decorations implements vscode.Disposable {
  private readonly openDecoration: vscode.TextEditorDecorationType;
  private readonly resolvedDecoration: vscode.TextEditorDecorationType;
  private readonly highlightDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    private storage: Storage,
    private workspaceFolder: vscode.WorkspaceFolder
  ) {
    const openIcon = vscode.Uri.joinPath(context.extensionUri, "media", "annotation.svg");
    const resolvedIcon = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "annotation-resolved.svg"
    );

    this.openDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: openIcon,
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.infoForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.resolvedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: resolvedIcon,
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.highlightDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.selectionHighlightBackground"),
      isWholeLine: true
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh())
    );
  }

  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyTo(editor);
    }
  }

  private applyTo(editor: vscode.TextEditor): void {
    const editorFsPath = this.realPath(editor.document.uri.fsPath);
    const workspaceFsPath = this.realPath(this.workspaceFolder.uri.fsPath);
    const matching = this.storage.getAll().filter((a) => {
      const annFsPath = path.isAbsolute(a.file)
        ? this.realPath(a.file)
        : this.realPath(path.join(workspaceFsPath, a.file));
      return annFsPath === editorFsPath;
    });
    const openRanges: vscode.Range[] = [];
    const resolvedRanges: vscode.Range[] = [];
    const highlightRanges: vscode.Range[] = [];
    for (const ann of matching) {
      const range = this.toRange(ann, editor.document);
      if (!range) continue;
      for (let line = range.start.line; line <= range.end.line; line++) {
        const singleLine = new vscode.Range(line, 0, line, 0);
        if (ann.status === "resolved") {
          resolvedRanges.push(singleLine);
        } else {
          openRanges.push(singleLine);
        }
      }
      if (ann.status === "open") {
        highlightRanges.push(range);
      }
    }
    editor.setDecorations(this.openDecoration, openRanges);
    editor.setDecorations(this.resolvedDecoration, resolvedRanges);
    editor.setDecorations(this.highlightDecoration, highlightRanges);
  }

  private realPath(p: string): string {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return p;
    }
  }

  private toRange(ann: Annotation, document: vscode.TextDocument): vscode.Range | undefined {
    const maxLine = document.lineCount - 1;
    const start = Math.min(Math.max(0, ann.startLine - 1), maxLine);
    const end = Math.min(Math.max(0, ann.endLine - 1), maxLine);
    return new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
  }

  dispose(): void {
    this.openDecoration.dispose();
    this.resolvedDecoration.dispose();
    this.highlightDecoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
