# This repository's settings

What GitHub holds for this repository, kept here so a change to them goes through the same checks as
any other change, and is in the history. Each
file is in the shape GitHub's API takes; the commands below apply them (an owner of the Lumovi
organisation runs them; `gh` and `jq`).

| File | What it holds |
| --- | --- |
| `rulesets/main.json` | main: changed only with every check passing; kept linear; never forced, never deleted. No one bypasses it, owners included. |
| `rulesets/main-reviews.json` | Switched off for now: pull requests are merged without approval. Kept, to switch on after launch: main changed only by a pull request, rebased, with an approval that isn't from whoever pushed last, except that the account that writes (WRITER, below) may merge without it (`bypass_mode: pull_request`, so never by pushing). |
| `rulesets/release-tags.json` | A tag, once made, is never moved or deleted. No one bypasses it. |
| (owed) | Only a workflow makes a tag: a rule on tags' creation with GitHub Actions as its only bypass. GitHub refuses that bypass on a repository's ruleset (`422: Actor GitHub Actions integration must be part of the ruleset source or owner organization`), so for now anyone who can write may push a tag, and the release workflow refuses a version that's already a tag, in its preflight and again just before it publishes. |
| `environments/release.json` | The release job runs from main alone, and waits for no one: a release goes once its checks pass. |
| `actions.json` | Workflows' token can only read unless a job asks for more; actions are GitHub's own and cosign's installer, pinned to commits; a pull request from anyone outside the repository waits for approval before it runs. |
| `repository.json` | Rebase merges only, secret scanning, private vulnerability reporting, immutable releases (a release's tag and files never change once it's published; on since 1.0.1, so 1.0.0's aren't held so). |

Who: the account that owns the organisation writes the pull requests and merges them, for now
without anyone's approval; and a release waits for no one. To change either, switch
`rulesets/main-reviews.json` on, or give the release environment reviewers, and apply it again.

These are the rules; `scripts/rules.mjs` is a lint that catches the commonest ways of breaking them
in a workflow's text, not the guarantee.

## Applying them

```sh
set -euo pipefail
REPO=Lumovi/Lumovi-plugins
WRITER=…        # the account that writes and merges pull requests
cd .github/settings

# The repository
jq .repository repository.json | gh api -X PATCH "repos/$REPO" --input -
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"
gh api -X PUT "repos/$REPO/immutable-releases"

# Rules (the writer in main-reviews' bypass by the account's id; that ruleset is made switched off)
writer=$(gh api "users/$WRITER" --jq .id)
for ruleset in rulesets/*.json; do
  jq --argjson writer "$writer" \
    '.bypass_actors |= map(if .actor_id == "WRITER" then .actor_id = $writer else . end)' \
    "$ruleset" | gh api -X POST "repos/$REPO/rulesets" --input -
done

# The release environment
jq '{wait_timer, prevent_self_review, deployment_branch_policy, reviewers}' environments/release.json |
  gh api -X PUT "repos/$REPO/environments/release" --input -
gh api -X POST "repos/$REPO/environments/release/deployment-branch-policies" -f name=main -f type=branch

# Actions
jq .permissions actions.json | gh api -X PUT "repos/$REPO/actions/permissions" --input -
jq .selected_actions actions.json | gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --input -
jq .workflow actions.json | gh api -X PUT "repos/$REPO/actions/permissions/workflow" --input -
jq .fork_pull_request_contributor_approval actions.json |
  gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --input -
```

To check them later, read each back (`gh api repos/$REPO/rulesets`, `…/environments/release`,
`…/immutable-releases`, `…/actions/permissions`) and compare with these files. main-reviews must read
back switched off (`disabled`), its bypass the writer's numeric id with `pull_request` and nothing
else.
