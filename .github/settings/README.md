# This repository's settings

What GitHub holds for this repository, kept here so a change to them is a reviewed change too. Each
file is in the shape GitHub's API takes; the commands below apply them (an owner of the Lumovi
organisation runs them; `gh` and `jq`).

| File | What it holds |
| --- | --- |
| `rulesets/main.json` | main: changed only with every check passing; kept linear; never forced, never deleted. No one bypasses it, owners included. |
| `rulesets/main-reviews.json` | main: changed only by a pull request, rebased, with a code owner's approval that isn't from whoever pushed last. One exception, for now: the account that writes (WRITER, below) may merge a pull request without that approval (`bypass_mode: pull_request`, so never by pushing). It's this ruleset's only bypass, and it bypasses this rule and nothing else. |
| `rulesets/release-tags.json` | A tag, once made, is never moved or deleted. No one bypasses it. |
| (owed) | Only a workflow makes a tag: a rule on tags' creation with GitHub Actions as its only bypass. GitHub refuses that bypass on a repository's ruleset (`422: Actor GitHub Actions integration must be part of the ruleset source or owner organization`), so for now anyone who can write may push a tag, and the release workflow refuses a version that's already a tag, in its preflight and again just before it publishes. |
| `environments/release.json` | The release job runs from main alone. For now it waits for no one: a release goes once its checks pass. Its `reviewers` are that one setting: `[{ "type": "Team", "slug": "plugin-maintainers" }]`, and it waits for a maintainer's approval, never from whoever started the run (`prevent_self_review`). |
| `actions.json` | Workflows' token can only read unless a job asks for more; actions are GitHub's own and cosign's installer, pinned to commits; a pull request from anyone outside the repository waits for approval before it runs. |
| `repository.json` | Rebase merges only, secret scanning, private vulnerability reporting, immutable releases (a release's tag and files never change once it's published; on since 1.0.1, so 1.0.0's aren't held so), the maintainers' team. |

Who: `@Lumovi/plugin-maintainers` are the code owners and the release's reviewers. Pull requests are
written and merged by an account with write access and nothing more, which isn't in the team: a
pull request by anyone else waits for a maintainer's approval, never its author's. For now that
account may merge without an approval, and a release waits for no one; to end either, take the
bypass out of `rulesets/main-reviews.json`, or give the release its reviewers (above), and apply it
again. Who is in each team an owner sets when the
repository is made (below); they're people's accounts, so they aren't written here.

These are the rules; `scripts/rules.mjs` is a lint that catches the commonest ways of breaking them
in a workflow's text, not the guarantee.

## Applying them

```sh
set -euo pipefail
REPO=Lumovi/Lumovi-plugins
MAINTAINERS=…   # who approves changes and releases
WRITER=…        # who writes and merges pull requests (not one of the maintainers)
cd .github/settings

# Who: the team, its maintainers (MAINTAINERS, by their accounts), and the account that writes
gh api -X POST orgs/Lumovi/teams -f name=plugin-maintainers -f privacy=closed
for user in $MAINTAINERS; do
  gh api -X PUT "orgs/Lumovi/teams/plugin-maintainers/memberships/$user" -f role=member
done
gh api -X PUT "orgs/Lumovi/teams/plugin-maintainers/repos/$REPO" -f permission=maintain
gh api -X PUT "repos/$REPO/collaborators/$WRITER" -f permission=push

# The repository
jq .repository repository.json | gh api -X PATCH "repos/$REPO" --input -
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"
gh api -X PUT "repos/$REPO/immutable-releases"

# Rules (the writer in its bypass by the account's id)
writer=$(gh api "users/$WRITER" --jq .id)
for ruleset in rulesets/*.json; do
  jq --argjson writer "$writer" \
    '.bypass_actors |= map(if .actor_id == "WRITER" then .actor_id = $writer else . end)' \
    "$ruleset" | gh api -X POST "repos/$REPO/rulesets" --input -
done

# The release environment (its reviewers, if it has any, by the team's id)
team=$(gh api orgs/Lumovi/teams/plugin-maintainers --jq .id)
jq --argjson team "$team" '{wait_timer, prevent_self_review, deployment_branch_policy,
  reviewers: [.reviewers[] | {type: "Team", id: $team}]}' environments/release.json |
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
`…/immutable-releases`, `…/actions/permissions`) and compare with these files. main-reviews' bypass
must read back as the writer's numeric id with `pull_request`, and nothing else.
