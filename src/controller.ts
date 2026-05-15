import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
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
    const fileUri = vscode.Uri.joinPath(this.workspaceFolder.uri, ann.file);
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

  private toRelativePath(uri: vscode.Uri): string {
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel.split("\\").join("/");
  }

  async addAnnotation(uri: vscode.Uri, range: vscode.Range, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    const ann: Annotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: this.toRelativePath(uri),
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
    this.createThreadFor(ann);
    this.changeEmitter.fire();
  }

  async reply(thread: vscode.CommentThread, body: string): Promise<void> {
    const id = this.findAnnotationIdByThread(thread);
    if (!id) return;
    const ann = this.storage.getById(id);
    if (!ann) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    ann.thread.push({
      author: this.author,
      timestamp: new Date().toISOString(),
      body: trimmed
    });
    await this.storage.upsert(ann);
    thread.comments = [...ann.thread.map((r) => this.toComment(r))];
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

  async deleteThread(thread: vscode.CommentThread): Promise<void> {
    const id = this.findAnnotationIdByThread(thread);
    if (!id) return;
    await this.storage.remove(id);
    thread.dispose();
    this.threads.delete(id);
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const handle of this.threads.values()) handle.thread.dispose();
    this.threads.clear();
    this.commentController.dispose();
    this.changeEmitter.dispose();
  }
}
