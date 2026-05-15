import * as vscode from "vscode";
import { AnnotationsFile, Annotation, emptyFile } from "./types";

const FILE_NAME = ".annotations.json";

export class Storage implements vscode.Disposable {
  private data: AnnotationsFile = emptyFile();
  private fileUri: vscode.Uri | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private selfWriteUntil = 0;
  private externalChangeEmitter = new vscode.EventEmitter<AnnotationsFile>();

  readonly onDidChangeExternal = this.externalChangeEmitter.event;

  constructor(private workspaceFolder: vscode.WorkspaceFolder) {
    this.fileUri = vscode.Uri.joinPath(workspaceFolder.uri, FILE_NAME);
  }

  async init(): Promise<void> {
    await this.load();
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, FILE_NAME)
    );
    const onChange = () => this.handleExternalChange();
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(() => {
      this.data = emptyFile();
      this.externalChangeEmitter.fire(this.data);
    });
  }

  private debounceTimer: NodeJS.Timeout | undefined;
  private handleExternalChange(): void {
    if (Date.now() < this.selfWriteUntil) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      await this.load();
      this.externalChangeEmitter.fire(this.data);
    }, 250);
  }

  async load(): Promise<AnnotationsFile> {
    if (!this.fileUri) return this.data;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text) as AnnotationsFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.annotations)) {
        this.data = parsed;
      } else {
        this.data = emptyFile();
      }
    } catch {
      this.data = emptyFile();
    }
    return this.data;
  }

  getAll(): Annotation[] {
    return this.data.annotations;
  }

  getById(id: string): Annotation | undefined {
    return this.data.annotations.find((a) => a.id === id);
  }

  async upsert(annotation: Annotation): Promise<void> {
    const idx = this.data.annotations.findIndex((a) => a.id === annotation.id);
    if (idx >= 0) this.data.annotations[idx] = annotation;
    else this.data.annotations.push(annotation);
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.data.annotations = this.data.annotations.filter((a) => a.id !== id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.fileUri) return;
    const text = JSON.stringify(this.data, null, 2) + "\n";
    this.selfWriteUntil = Date.now() + 500;
    await vscode.workspace.fs.writeFile(this.fileUri, new TextEncoder().encode(text));
  }

  dispose(): void {
    this.watcher?.dispose();
    this.externalChangeEmitter.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
