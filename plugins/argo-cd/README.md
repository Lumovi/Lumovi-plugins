# Argo CD

Argo CD (https://argo-cd.readthedocs.io): an overview of every Application, by project, and a tab
on each Application with its sync, health, revision, resources, history and conditions.

On Lumovi's own list of Applications it adds Sync (to the revision the application tracks) and
Refresh, which run as soon as they're chosen.

Its pages read only Argo CD's own kinds (Applications and AppProjects). From an Application's tab
it proposes Sync (with a revision, prune and strategy), Refresh (normal or hard) and Delete. Each is
shown in Lumovi's own dialog, with the change as the cluster would make it, and nothing changes
until you confirm it there.
