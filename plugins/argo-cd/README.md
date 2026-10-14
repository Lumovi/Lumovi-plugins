# Argo CD

Argo CD (https://argo-cd.readthedocs.io): an overview of every Application, by project, and a tab
on each Application with its sync, health, revision, resources, history and conditions.

On Lumovi's own list of Applications, and above every tab of one, it adds Sync, which asks first
and then syncs to what the application tracks; Terminate sync, while a sync runs or waits to start,
which asks first too; and Refresh, which runs as soon as it's chosen. While a sync runs, Sync stays
where it was, busy, and says how long it has run.

Its pages read only Applications. From an Application's tab it proposes Sync (with a revision, prune
and strategy), Refresh (normal or hard) and Delete. Each is shown in Lumovi's own dialog, with the
change as the cluster would make it, and nothing changes until you confirm it there.

Terminate sync sets a running sync's phase to Terminating, as Argo CD's own Terminate does: on the
Application itself, as its kind has no status subresource. A sync that Argo CD hasn't started yet is
taken back instead. Either way, Lumovi reads the Application again as it's sent: if the sync you
were shown has started, ended or been replaced by another since, nothing is sent and nothing
changes.

A resource's row on the tab opens Lumovi's own list of its kind, showing only that resource, for
Deployments, StatefulSets, DaemonSets, Services, ConfigMaps, Ingresses, Jobs and CronJobs. The list
is Lumovi's, read as you; the plugin reads nothing of it.
