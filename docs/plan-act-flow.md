# CONSTRUCT IDE — Plan/Act Flow

## User Experience

1. **User types a task** in the Construct Agent panel (e.g., "Create a React counter app")
2. **Planning phase**: The LLM generates a numbered list of steps
3. **Review phase**: The Plan Modal shows the steps with checkboxes
4. **User modifies**: Can uncheck steps to skip, edit descriptions, or delete steps
5. **Approval**: User clicks "Approve & Execute"
6. **Execution phase**: The agent executes steps one at a time using tools
7. **Completion**: Agent outputs a summary of what was done

## Plan Modal (Webview)

The Plan Modal is a React component rendered in a VS Code webview. Communication with the extension host happens via `postMessage`:

### Extension Host → Webview

```typescript
// Send plan for review
panel.webview.postMessage({
  type: 'plan',
  steps: [{ description: 'Create project directory' }, ...]
});

// Send execution output
panel.webview.postMessage({
  type: 'executionOutput',
  text: 'Created directory: /workspace/my-app'
});

// Signal completion
panel.webview.postMessage({ type: 'done' });
```

### Webview → Extension Host

```typescript
// User approves plan
vscode.postMessage({ type: 'approve', steps: [...] });

// User cancels
vscode.postMessage({ type: 'cancel' });
```

## Tool Use Format

The LLM outputs tool calls in fenced code blocks:

```
Some reasoning text...

```tool
{"tool": "write", "args": {"path": "src/App.tsx", "content": "..."}}
```
```

The `AgentEngine.parseToolUse()` method extracts the JSON between ` ```tool ` and ` ``` ` fences.

## Execution Loop

```
execute(steps, maxRounds=15):
  round = 0
  while round < maxRounds:
    1. Build prompt with plan + last tool result
    2. Check token budget (ensureBudget)
    3. Stream LLM completion
    4. Parse tool use from output
    5. If no tool use → agent is done → return output
    6. Dispatch tool → get result
    7. Feed result back as context
    8. round++
  
  throw AgentError('MAX_ROUNDS')
```

## Undo Last Step

The "Undo last step" button uses `GitService.undoLastCommit()` which performs a `git reset --soft HEAD~1`. This:

1. Removes the last commit from the history
2. Keeps all changes from that commit staged in the index
3. The user can then review and modify before re-committing

For file-level undo, `GitService.revertFile(path)` performs `git checkout HEAD -- <path>` to restore a file to its last committed state.
