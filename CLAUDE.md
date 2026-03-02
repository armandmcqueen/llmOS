## Development Principles

- **Human-in-the-loop:** Development proceeds in milestones. Do not move past a milestone without explicit approval. 
- **Human-testable milestone:** Milestones should be designed to be testable. Writing code whose only purpose is to make it easy for the human to understand the code that has been written can be a good idea. Feel free to write HTML pages or CLIs to enable this. 
- **Test-first mindset:** All non-trivial logic should have CLI-runnable tests. `pnpm test` must pass before presenting a milestone. Lean towards red/green/refactor TDD.
- **Debugging discipline:** Quick fixes are a good first response, but if two or three attempts don't resolve a problem, stop and re-evaluate. Step back, list what you know for certain vs what you're assuming, form explicit theories, and add diagnostic steps to collect evidence. Rigorous chains of logic built on proven facts beat rapid trial-and-error for persistent problems.


### Testing Philosophy

With AI-assisted development producing larger PRs, code review alone doesn't scale as the primary confidence mechanism. **Testing is one of the primary confidence source; code review catches what tests can't** (naming, architecture, intent).

**Prioritize testing:**
- User-facing behavior and workflows (does the page load? does the form submit?)
- Security boundaries (auth checks, input validation)
- Data integrity (DB operations, file storage)
- Non-obvious logic (parsers, transformers, state machines)

**Keep lightweight:**
- Pass-through components that just render props
- Styling and layout details
- Volatile internals likely to change with refactors

### Human Understanding

When the human isn't writing the code, it is difficult to develop understanding of what is being written. We want to try different ways to enable the human to understand the code that has been written in the milestone. Some possible ideas

- Generate a web ui or CLI that lets you interact with the milestone deliverables
- A UI that shows test inputs and conditions from some component to enable understanding the code as a black box.
- Alternative ideas! Suggest new ideas that make sense for the milestone. We need to try stuff to see what works.

Spending 50% of the effort writing the main code and 50% of the time writing tools to help the user understand the code that has been written is perfectly valid. 


## Scratch Notes

Every session uses scratch notes in `claude/scratch/` for continuity across sessions and context compaction. Each branch gets a pair of files:

- **`<branch>_state.md`** — Current snapshot: what exists, key files, current status, known issues. Updated in-place as things change — always reflects the present state.
- **`<branch>_log.md`** — Append-only chronological record of what was done. Each session gets a timestamped entry (use `date -u '+%Y-%m-%dT%H:%M:%SZ'` for the timestamp) listing changes made.


## Documentation

Every major component (workspace packages, significant subsystems) gets two docs at its root:

- **`README.md`** — High-level: what it is, how to use it, key concepts, getting started. A new contributor should be able to understand the component's purpose and run it from the README alone.
- **`DESIGN.md`** — In-depth: architecture, subsystem breakdown, key decisions and tradeoffs, data flow, what was considered and rejected. **This is the primary artifact a human reviews during code review** — it should be detailed enough that the reviewer can evaluate the approach without reading every source file.

Both docs should be kept current as the code evolves. When a PR changes a component's behavior or architecture, updating its DESIGN.md is part of the work, not a follow-up task.

## Pre-Review Checklist

Before we open up a PR for a change, the user may ask Claude to run the pre-review process. This is Claude making sure the code is ready for a human to spend time reviewing. This is only run on demand, not on every change (although some of the individual steps may be useful to run frequently).

### Automated checks
1. **Unit/integration tests pass** — `pnpm test`
2. **E2E tests pass** — `pnpm test:e2e`
3. **Build succeeds** — `pnpm run build`
4. **Lint passes** — `pnpm run lint`
5. **Generated files are current** — `pnpm run generate` produces no diff

### PR comments
6. **Review unresolved PR comments** — run `gh api repos/{owner}/{repo}/pulls/{number}/comments` and check for unresolved comments (often automated review notes). Ignore resolved comments. Don't assume every comment needs action — consider the idea and flag anything worth discussing.

### Manual review
7. **No leftover debug code** — no stray `console.log`, commented-out code, or TODOs from the work session
8. **Docs match code** — CLAUDE.md reflects actual state (file tree, commands, instructions). README.md and DESIGN.md for affected components have been written or updated.
9. **No unintended changes** — review `git diff` to confirm only expected files are touched
10. **No secrets or sensitive data** in the diff

### PR review guide
11. **Post PR review guide** — post a comment via `gh pr comment` with:
    - **Summary**: What changed and why (2-3 sentences)
    - **Verification**: What was tested and how (commands run, results)
    - **Review notes**: What a human reviewer should focus on — architecture decisions, tradeoffs, areas of uncertainty
    - **Commit message**: A ready-to-use commit message for squash-merge (include in a code block so it's easy to copy)
    - End the comment with: `🤖 Generated with Claude Code`

## Git Policy

Readonly git commands (`git status`, `git log`, `git diff`, etc.) are fine to use freely. However, git mutations (commit, push, branch, reset, etc.) should be rare — git history is used to protect against agentic mistakes. Creating a branch for testing something can be acceptable, but should usually be coordinated with the user first.

### Session start behavior

- **On a branch**: Check if `claude/scratch/<branch>_state.md` and `<branch>_log.md` exist. If they do, read both to load context. If they don't, create them.
- **On main**: Ask the user whether they want to set up a branch, or if this is a non-writing task (research, review, etc.) that doesn't need scratch notes.

### During a session

- Update the log with significant changes as you go (not every micro-step, but enough to reconstruct what happened).
- Update the state file when the current status meaningfully changes (new features complete, status shifts, new issues discovered).
- On resumption after context compaction, re-read both files to reconstruct context. Between the scratch notes, git history, and the code itself, you should have enough to continue without the original conversation.

Keep entries concise — these are working notes for yourself, not documentation for humans.