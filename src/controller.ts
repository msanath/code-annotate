import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { Annotation, Reply } from "./types";
import { Storage } from "./storage";

const execAsync = promisify(exec);

interface ThreadHandle {
  thread: vscode.CommentThread;
  annotationId: string;
}

export class AnnotationController implements vscode.Disposable {
  readonly commentController: vscode.CommentController;
  private threads = new Map<string, ThreadHandle>();
  private author: string = "user";
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private storage: Storage,
    private workspaceFolder: vscode.WorkspaceFolder
  ) {
    this.commentController = vscode.comments.createCommentController(
      "codeAnnotate",
      "Code Annotate"
    );
    this.commentController.commentingRangeProvider = {
      provideCommentingRanges: (document) => {
        return [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
      }
    };
    this.commentController.options = {
      prompt: "Add an annotation...",
      placeHolder: "What about this code?"
    };
  }

  async init(): Promise<void> {
    this.author = await this.resolveAuthor();
    this.renderAll();
  }

  private async resolveAuthor(): Promise<string> {
    try {
      const { stdout } = await execAsync("git config user.name", {
        cwd: this.workspaceFolder.uri.fsPath
      });
      const name = stdout.trim();
      if (name) return name;
    } catch {
      // fall through
    }
    return process.env.USER || process.env.USERNAME || "user";
  }

  refresh(): void {
    this.renderAll();
  }

  private renderAll(): void {
    for (const handle of this.threads.values()) {
      handle.thread.dispose();
    }
    this.threads.clear();
    for (const ann of this.storage.getAll()) {
      this.createThreadFor(ann);
    }
    this.changeEmitter.fire();
  }

  private createThreadFor(ann: Annotation): void {
    const fileUri = this.resolveAnnotationUri(ann.file);
    const range = new vscode.Range(
      Math.max(0, ann.startLine - 1),
      0,
      Math.max(0, ann.endLine - 1),
      0
    );
    const comments: vscode.Comment[] = ann.thread.map((reply) => this.toComment(reply));
    const thread = this.commentController.createCommentThread(fileUri, range, comments);
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.state =
      ann.status === "resolved"
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
    thread.contextValue = ann.status;
    this.threads.set(ann.id, { thread, annotationId: ann.id });
  }

  private toComment(reply: Reply): vscode.Comment {
    return {
      body: new vscode.MarkdownString(reply.body),
      mode: vscode.CommentMode.Preview,
      author: { name: reply.author },
      timestamp: new Date(reply.timestamp)
    };
  }

  findAnnotationIdByThread(thread: vscode.CommentThread): string | undefined {
    for (const [id, handle] of this.threads.entries()) {
      if (handle.thread === thread) return id;
    }
    return undefined;
  }

  private resolveAnnotationUri(stored: string): vscode.Uri {
    if (path.isAbsolute(stored)) return vscode.Uri.file(stored);
    return vscode.Uri.joinPath(this.workspaceFolder.uri, stored);
  }

  private toRelativePath(uri: vscode.Uri): string {
    const workspaceFsPath = this.realPath(this.workspaceFolder.uri.fsPath);
    const targetFsPath = this.realPath(uri.fsPath);
    const rel = path.relative(workspaceFsPath, targetFsPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split("\\").join("/");
    }
    return targetFsPath.split("\\").join("/");
  }

  private realPath(p: string): string {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return p;
    }
  }

  startDraftThread(uri: vscode.Uri, range: vscode.Range): vscode.CommentThread {
    const thread = this.commentController.createCommentThread(uri, range, []);
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.state = vscode.CommentThreadState.Unresolved;
    thread.contextValue = "draft";
    return thread;
  }

  async submit(thread: vscode.CommentThread, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    const existingId = this.findAnnotationIdByThread(thread);
    if (existingId) {
      const ann = this.storage.getById(existingId);
      if (!ann) return;
      ann.thread.push({
        author: this.author,
        timestamp: new Date().toISOString(),
        body: trimmed
      });
      await this.storage.upsert(ann);
      thread.comments = [...ann.thread.map((r) => this.toComment(r))];
      return;
    }
    const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
    const ann: Annotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: this.toRelativePath(thread.uri),
      startLine: range.start.line + 1,
      endLine: range.end.line + 1,
      status: "open",
      createdAt: new Date().toISOString(),
      thread: [
        {
          author: this.author,
          timestamp: new Date().toISOString(),
          body: trimmed
        }
      ]
    };
    await this.storage.upsert(ann);
    thread.comments = [this.toComment(ann.thread[0])];
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.state = vscode.CommentThreadState.Unresolved;
    thread.contextValue = "open";
    this.threads.set(ann.id, { thread, annotationId: ann.id });
    this.changeEmitter.fire();
  }

  async setStatus(thread: vscode.CommentThread, status: "open" | "resolved"): Promise<void> {
    const id = this.findAnnotationIdByThread(thread);
    if (!id) return;
    const ann = this.storage.getById(id);
    if (!ann) return;
    ann.status = status;
    await this.storage.upsert(ann);
    thread.state =
      status === "resolved"
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
    thread.contextValue = status;
    this.changeEmitter.fire();
  }

  async clearResolved(): Promise<number> {
    const resolvedIds = this.storage
      .getAll()
      .filter((a) => a.status === "resolved")
      .map((a) => a.id);
    if (resolvedIds.length === 0) return 0;
    for (const id of resolvedIds) {
      const handle = this.threads.get(id);
      if (handle) {
        handle.thread.dispose();
        this.threads.delete(id);
      }
    }
    await this.storage.removeMany(resolvedIds);
    this.changeEmitter.fire();
    return resolvedIds.length;
  }

  async deleteThread(thread: vscode.CommentThread): Promise<void> {
    const id = this.findAnnotationIdByThread(thread);
    if (id) {
      await this.storage.remove(id);
      this.threads.delete(id);
    }
    thread.dispose();
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const handle of this.threads.values()) handle.thread.dispose();
    this.threads.clear();
    this.commentController.dispose();
    this.changeEmitter.dispose();
  }
}
