# Review Guidelines

Follow the [development flow](development-flow.md), including its [English collaboration-language convention](development-flow.md#collaboration-language). These instructions apply to contributors and AI reviewers of the WebXR emulator extension.

## Review against the Issue

Read the source Issue and relevant discussion, then the PR description and full diff. Treat the Issue's problem, expected outcome, and acceptance criteria as the reference for review.

Verify that the PR implements every requirement it claims to resolve. A deliberately partial PR must identify remaining work and leave the Issue open. Prefer the smallest change that fully addresses the Issue.

## Check scope and correctness

- Identify missing requirements and incorrect behavior.
- Check compatibility with the existing extension, emulator panel, device configuration, and polyfill architecture where relevant.
- Reject unrelated refactoring, unnecessary abstractions, speculative extensibility, frameworks, or configuration without a demonstrated need.
- Check that documentation matches the changed behavior and that existing useful instructions remain intact.

## Check pre-merge acceptance and post-merge verification

Require mandatory pre-merge acceptance to be achievable and verifiable before merge. Evaluate the validation actually performed against the changed files and the repository's [available tooling](development-flow.md#2-implement-and-validate-the-change). Check accurate reporting of failures, skipped checks, and unperformed checks; do not treat an unperformed required check as passing.

For collaboration templates or documentation only, verify template front matter, Markdown structure, links, whitespace, and consistency. Do not require new runtime tests, a polyfill build, physical-device/headset checks, or deployed-site verification for that scope.

Require human confirmation, subjective evaluation, physical-device testing, or external approval only when necessary for the actual Issue, with a stated reason and expected result. Optional checks do not block approval.

Record genuinely necessary checks possible only after merge separately as pending; they must not be prerequisites for pre-merge approval. For example, verify a merge-triggered publication after merge. Pre-merge build or other validation does not prove publication succeeded. This separation preserves all implementation requirements and applicable pre-merge checks. State that no post-merge verification is required when appropriate.

## Review outcome and revision

Clearly distinguish these outcomes:

- **Agent-fixable findings:** request changes with the affected file or behavior, the unmet requirement or defect, and the expected correction or validation. Review the updated PR again after the agent revises it.
- **Necessary human input:** record the specific unanswered question, why it blocks the Issue, and the expected answer or evidence. Use the workflow's wait path and resume review when the answer arrives. If the workflow has no named wait mechanism, mark the work as awaiting human input and pause the dependent action. Do not repeatedly request code fixes for a missing human decision. Continue independent review where possible.
- **Ready to merge:** approve when the implementation fully addresses the Issue, scope is justified, correctness and validation are sufficient, all mandatory pre-merge criteria pass, and no blocking findings or necessary unanswered human questions remain.

Separate optional suggestions from blocking findings. Waiting for checks possible only after merge is not a reason to withhold an otherwise warranted approval.

## Merge and follow-up

After review passes, merge into `dev` by default, subject to applicable repository requirements and the current task's authorization. Review the latest revision before merging; earlier approval does not establish that later changes pass review.

Perform only the post-merge verification required by the Issue, if any. Report actual results honestly, including failures or pending work, and record needed follow-up. Do not claim deployment or publication succeeded based on pre-merge evidence.
