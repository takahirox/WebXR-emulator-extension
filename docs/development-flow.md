# Development Flow

This is the default Issue → implementation → PR → review → revision as needed → merge flow for contributors and AI agents working on the WebXR emulator extension.

## Collaboration language

Use **English** for newly authored templates, development/review/merge documentation, AI instructions, Issue and PR titles and bodies, review comments, and commit messages. This collaboration convention does not require translating historical content or changing product localization.

## 1. Start with an Issue

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to describe the problem, expected outcome, relevant context, reproduction steps where applicable, and concrete completion criteria. An assignee or owner field is not required.

Treat the source Issue as the scope of work. Clarify genuinely blocking ambiguity before implementing dependent changes; use reasonable judgment for routine implementation choices. Choose the smallest change that fully addresses the Issue, without unrelated refactoring or speculative frameworks.

Default to completion criteria an AI agent can execute and verify. Require human confirmation, physical-device testing, subjective evaluation, or external approval only when necessary for the actual Issue. Explain why it is needed and what result is expected.

Keep three kinds of checks separate:

- **Pre-merge acceptance:** mandatory implementation requirements and applicable checks achievable and verifiable before merge.
- **Optional validation:** helpful additional checks that do not block completion or approval.
- **Required post-merge verification:** genuinely necessary checks possible only after merge, recorded separately and pending until performed. State that none are required when appropriate; do not add them routinely.

Checks possible only after merge must not be pre-merge approval conditions. For example, if an Issue involves merge-triggered publication, validate the relevant changes and applicable local checks before merge and verify publication afterward. Pre-merge evidence does not prove deployment or publication succeeded.

## 2. Implement and validate the change

The current default and integration branch is `dev`. Start work from `dev` and target PRs to `dev` unless the source Issue or workflow specifies another branch; confirm the default branch if repository settings change.

This repository is a browser extension with extension code in `src/extension/`, the emulator panel in `src/app/`, device configurations in `src/devices.json`, and custom polyfill source in `src/polyfill/`. Preserve the useful installation and build instructions in the [README](../README.md#for-development).

Choose validation for the changed files and the actual tooling, following the [testing and CI performance principles](#testing-and-ci-performance-principles):

- `package.json` provides `npm run typecheck` and `npm run build`, which check all maintained TypeScript and compile/bundle `src/polyfill/CustomWebXRPolyfill.ts` into `polyfill/webxr-polyfill.js` plus the extension and panel entry points into `dist/`. For changes affecting that bundle, install dependencies with `npm install` as needed and run the build. Inspect generated changes before including them.
- For extension behavior changes, use the README's developer installation instructions and validate the affected behavior in a desktop browser. Record the browser, reproduction steps, and results. Physical XR hardware is required only when the Issue explains why emulator/browser checks are insufficient.
- For templates or documentation only, check template front matter, Markdown structure, links, whitespace (`git diff --check`), and consistency against the Issue. No new runtime tests, polyfill build, headset/device checks, or deployed-site verification are required for that scope.

For runtime regression checks, `npm run test:browser` loads the unpacked extension in a fresh desktop Chromium profile; follow the README for current Playwright Chromium or a current stable Chrome for Testing executable. No Manifest V2 compatibility flags are used. There are no lint or Markdown-check scripts. Use applicable available tools and report what was checked; do not add dependencies or CI merely to validate documentation.

### Testing and CI performance principles

**Detect the required failures at the lightest appropriate layer, without redundant execution.** Preserve required correctness, regression assertions, and meaningful integration coverage when moving or consolidating checks.

The repository currently has local checks in [package.json](../package.json), with setup and coverage described in the [README](../README.md#browser-regression-checks) and feature guides. No CI workflow is checked in. Apply these principles to local validation and future CI; changes to tests or automation need separately scoped implementation work.

1. **Prefer the lightest meaningful layer.** Cover calculations, branches, and broad data combinations in unit/component tests where possible. Existing Node tests (`npm run test:environment` and `npm run test:haptics`) exercise room geometry/play-area logic and deterministic haptic scheduling without launching browsers. Use browser, WebGL renderer, emulator, and pinned application checks for boundaries that require them, such as injection, cross-realm bindings, panel input, and presented pixels. Add assertions that catch concrete defects rather than mirror implementation steps; retain necessary physical-device checks when the Issue justifies them.
2. **Choose combinations deliberately.** Select representative cases for distinct paths across Quest VR/MR, Android AR, inline/immersive sessions, Chromium/Firefox, and sample applications. Expand combinations exhaustively where interactions require it, rather than automatically multiplying every profile, mode, browser, and application. Preserve required regressions and meaningful integration coverage when redistributing checks.
3. **Match validation to the change.** Documentation needs Markdown/link/whitespace/consistency checks; panel UI changes need affected interaction and rendering checks; core/polyfill changes need applicable Node tests, builds, and focused browser contracts plus affected application regressions. Build/packaging or future CI changes need their applicable build, package, and execution-path checks, including Firefox packaging when affected. Use targeted checks for fast feedback and the applicable broader regression suites before merge. If CI is added, give fast feedback, full regression validation, and publication distinct responsibilities and triggers. Keep mandatory pre-merge acceptance applicable to the change, optional validation nonblocking, and genuinely post-merge-only publication/deployment verification separately pending, as defined [above](#1-start-with-an-issue).
4. **Reuse work and avoid duplicate execution.** Reuse unchanged builds, pinned fixture downloads, and expensive setup with keys tied to source, lockfile, tool/browser versions, and fixture hashes as appropriate; preserve profile and test-state isolation. `npm run build` already runs typecheck, and `npm run build:firefox` includes the main build. Avoid repeating equivalent work for the same revision; future CI should avoid overlapping push/PR runs and safely cancel superseded validation while preserving deployment ordering. Measure resource use before parallelizing independent work. Keep browser suites sequential on a shared desktop to avoid visibility interference, as the [haptics guide](webxr-haptics.md) requires.
5. **Review value and cost together.** Identify the additional defect each new or expanded test detects, whether existing coverage already supplies that assurance, and its execution and maintenance cost. Watch repeated fresh browser/WebGL/compiler setup, large room/model fixtures, long emulation loops, and Cartesian-product growth. Reduce duplication while retaining meaningful assertions and required coverage.
6. **Maintain an execution-time budget.** A normal-CI timing baseline and target are not established here. Establish them from actual measurements during future test/CI performance work, recording revision, environment, and check scope. Track elapsed feedback time, total runner/computation time, and queue time separately; monitor growth and investigate work exceeding the target by revisiting setup, duplication, and validation structure while retaining required coverage. This documentation introduces no timing threshold, benchmark requirement, or new merge gate.

## 3. Create a Pull Request for the Issue

Use the [PR template](../.github/pull_request_template.md). Explain the problem, resulting behavior, focused changes, related Issues, and validation actually performed. Report failures, skipped checks, and unperformed checks accurately, including reasons and remaining limitations.

Claim to close an Issue only when the PR fully implements its requirements. If intentionally partial, state the remaining work and leave the Issue open. Record required post-merge checks separately as pending; pending checks possible only after merge do not make a complete implementation partial.

## 4. Review and revise as needed

Every PR should be reviewed before merge using the [review guidelines](review-guidelines.md). Check completeness against the source Issue, correctness, unnecessary scope, and appropriate validation.

Request revisions for agent-fixable findings, update the PR, and review the updated change again. If genuinely necessary human input is missing, record the specific question and expected answer, then use the workflow's wait path. Distinguish waiting for human input from requests for code fixes; do not repeatedly ask for revisions that cannot resolve the missing answer.

## 5. Merge

Approve and merge when the implementation and mandatory pre-merge checks are sufficient and no blocking review findings remain. Follow applicable repository merge requirements and the current task's authorization; guidance describing the normal flow does not authorize an agent to merge independently.

## 6. Perform required post-merge verification

When the Issue requires post-merge checks, perform them after merge and record actual results, including failures and follow-up work. Keep unperformed checks pending. If none are required, no post-merge validation is needed; templates/documentation-only work does not require deployment or publication checks.

These files adapt the current GitWeave [Issue template](https://github.com/takahirox/gitweave/blob/main/.github/ISSUE_TEMPLATE/issue.md), [PR template](https://github.com/takahirox/gitweave/blob/main/.github/pull_request_template.md), [development flow](https://github.com/takahirox/gitweave/blob/main/docs/development-flow.md), and [review guidelines](https://github.com/takahirox/gitweave/blob/main/docs/review-guidelines.md) to this repository.
