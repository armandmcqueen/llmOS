Review and update README.md and DESIGN.md files across the repo to match the current code.

## Instructions

1. **Read documentation standards.** Read the "Documentation" section of CLAUDE.md to understand what README.md and DESIGN.md should contain.

2. **Find all documented components.** Search for existing README.md and DESIGN.md files across the entire repo (not just `packages/*/` — also `src/lib/`, `src/components/`, `scripts/`, or anywhere else docs live). Use glob patterns like `**/README.md` and `**/DESIGN.md`, excluding `node_modules/` and `.next/`.

3. **Audit each doc.** For every doc found:
   - Read the doc.
   - Read the actual source code in the surrounding directory — key files, exports, config, tests — to understand what the component currently does.
   - Compare the doc against the code. Identify sections that are stale, incomplete, or missing.

4. **Update stale docs.** Edit docs that have drifted from the code. Preserve the author's voice and structure where possible — fix facts, don't rewrite prose for style.

5. **Create missing docs.** Only if a component clearly warrants documentation (significant subsystem, not a leaf directory). Follow the standards from CLAUDE.md.

6. **Report.** When finished, summarize what was changed:
   - Which files were updated and what changed
   - Which files were created
   - Which files were already up-to-date

## Guidelines

- Focus on factual accuracy — do the docs describe what the code actually does today?
- Don't pad docs with boilerplate. Short and accurate beats long and vague.
- Check imports, exports, CLI commands, env vars, config options, and API surfaces — these are the most common sources of doc drift.
- If a package is undergoing active development (uncommitted changes, TODO comments), note that in the report but still update docs to match the current committed state.
