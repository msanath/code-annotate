# Code Annotate

GitHub-style review annotations for any file in VS Code — code, docs, notes, anything. Select lines, leave a comment, reply, resolve. Annotations are stored in a plain `.annotations.json` at the root of your workspace so **AI agents can read them too**.

## Features

- **Annotate any range of lines** — `Cmd+Alt+A` (macOS) / `Ctrl+Alt+A` (Windows/Linux) on a selection, or right-click → *Add Annotation*.
- **Threaded replies** — click into a thread and reply, just like a PR review.
- **Resolve / unresolve** — mark threads done; resolved threads collapse to the resolved state.
- **Gutter markers** — a blue speech-bubble icon in the gutter for open annotations, green check-bubble for resolved.
- **Plain JSON storage** — everything lives in `.annotations.json` at the workspace root. Diffable, commit-friendly, AI-readable.
- **Show All Annotations** — palette command jumps you to any annotation across the workspace.

## Use with AI agents

The whole point. Drop this into your `CLAUDE.md`, `.cursorrules`, or equivalent agent instructions:

> If `.annotations.json` exists at the repo root, read it before starting work. Each entry has `file`, `startLine`, `endLine`, `status`, and a `thread` of comments. Treat `status: "open"` annotations as TODOs from the user. When you address one, either append a reply to its `thread` array or set its `status` to `"resolved"`.

Now you can leave annotations on the actual lines you want changed, then say *"go address the open annotations"* and your agent picks up the conversation in context.

## Storage format

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "ann_1715800000000_abc123",
      "file": "src/foo.ts",
      "startLine": 10,
      "endLine": 14,
      "status": "open",
      "createdAt": "2026-05-15T12:00:00.000Z",
      "thread": [
        { "author": "you", "timestamp": "2026-05-15T12:00:00.000Z", "body": "this loop is O(n^2)" }
      ]
    }
  ]
}
```

Line numbers are 1-indexed, inclusive. Author defaults to your `git config user.name`.

## Commands

| Command | Default keybinding |
|---|---|
| Code Annotate: Add Annotation | `Cmd+Alt+A` / `Ctrl+Alt+A` |
| Code Annotate: Show All Annotations | — |

Reply / Resolve / Unresolve / Delete appear in the comment thread's title and reply bars.

## Caveats (v1)

- Annotations are anchored by line number. If you edit the file heavily, they may drift. A future version may add content-aware re-anchoring.
- One workspace folder is supported per session.

## License

MIT
