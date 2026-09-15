# SAARTHI Mission Proposal (No Code — Definition Readiness Only)

## 1. Empty-Workspace Facts (verified 2026-09-15, HIGH confidence — local filesystem)
- Root contains only `.opencode/` (todo.md, context.md, status.md, work-log.md, archive/, plugins/) and `claude-justworker-setup.sh` (gateway setup script, not project source).
- No package.json, tsconfig.json, Cargo.toml, go.mod, requirements.txt, pyproject.toml, pom.xml, Gemfile, composer.json, *.csproj, pubspec.yaml found.
- No src/, lib/, app/, tests/, docs/ directories. No entry point. No build/test/lint commands.
- Source: direct directory listing per `.opencode/context.md`.

## 2. Name-Origin Hypothesis (HYPOTHESIS — unverified, not a fact)
- HYPOTHESIS: "SAARTHI" (Sanskrit/Hindi सारथी) commonly means guide / charioteer / one who shows the path.
- This is a linguistic hypothesis only. It does NOT imply any project goal, stack, or scope.
- Awaiting user confirmation of intended meaning and mission.

## 3. Project-Type Options (no implementation, pros/cons only)
### Option A: CLI / Tooling project
- Pros: small scope, easy to verify (build + unit tests), fits empty workspace.
- Cons: unknown user need; premature without goal.

### Option B: Web application
- Pros: visible demo, fits "guide" theme (dashboards, onboarding).
- Cons: large scope, requires stack choice (Node/Python/etc.), no evidence user wants this.

### Option C: Docs-first / Specification project
- Pros: lowest risk from empty state; captures goal before code; autonomously completable now.
- Cons: no runnable artifact; still needs user goal to proceed to code.

Recommendation: Stay with Option C until user defines goal. Create no source code.

## 4. Explicit Questions for User
1. What is the SAARTHI mission goal in one sentence?
2. What project type do you want (CLI / web / library / docs-only / other)?
3. What stack (language, runtime, package manager) should we use, if any?
4. What is the first verifiable deliverable (build/test/demo)?

## 5. Scope Guard
- No source code, no implementation tasks in this milestone.
- Next step after user answers: Planner creates M/T/S implementation plan; Worker implements; Reviewer verifies.
