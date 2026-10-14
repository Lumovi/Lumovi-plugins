# Argo CD

Argo CD (https://argo-cd.readthedocs.io): an Overview of what's happening and what needs a look,
every Application in one table, and a tab on each Application.

The Overview has four tiles (healthy, synced, syncing now, last sync failed). Below them: every
application that wants a look, worst first, with Argo CD's own line for it; the syncs running now,
with where each one is and what it waits on; health and sync broken down; the syncs that ended
last; projects and where the applications run; and ApplicationSets, with what each makes its
applications from. Its tiles and counts open the Applications page, filtered to what they count.

The Applications page is also the tab Lumovi shows for the Application kind. Its table is searched
by name and filtered by health, sync, operation, project, cluster, namespace and auto-sync, in
Lumovi's own bar; the plugin is never told what's typed or set there. Rows can be ticked, and
Lumovi's own selection bar then offers Sync and Refresh for them, asked once (no revision: each
syncs to what it tracks) and done to each; Lumovi follows each sync to how it ended.

An Application's tab has its health, and beside it what's happening to it; while a sync runs, where
it is, hook phase by phase and wave by wave, and what it waits on; its revision, last sync and
auto-sync; its resources as a graph, those out of sync marked; its sync's result, resource by
resource, in the order Argo CD applies them; its problems in one place; and its history. Where it
deploys to the cluster Lumovi is connected to, the graph goes down to its Deployments' ReplicaSets
and their Pods, each card opens what it is, and its problems include the warning events of those
that aren't well. Anywhere else, it shows what Argo CD reports of it, and opens nothing.

On Lumovi's own list of Applications, and above every tab of one, it adds Sync, which asks first
for a revision (empty: the one it tracks), prune and the strategy; Terminate sync, while a sync
runs or waits to start, which asks first too; and Refresh, which runs as soon as it's chosen. While
a sync runs, Sync stays where it was, busy, and says how long it has run.

From an Application's tab it proposes Sync, with every option Argo CD's own sync has (a revision;
prune, dry run, apply only and force; its sync options; retry; and only some resources), starting
from the Application's own; Refresh (normal or hard); Delete (saying what happens to what it
deployed); turning auto-sync on (prune and self-heal asked first) or off; and Roll back to an entry
of its history, as Argo CD's own Rollback does (prune asked first; off while auto-sync is on, a sync
runs, or it's being deleted). Each is shown in Lumovi's own dialog, with the change as the cluster
would make it, and nothing changes until you confirm it there. Its file says what in a sync does
harm (prune, force, and syncing only some resources), and Lumovi draws it in red and names it on
the button, whatever the code says; a dry run changes nothing, and says so on the button instead.

Terminate sync sets a running sync's phase to Terminating, as Argo CD's own Terminate does: on the
Application itself, as its kind has no status subresource. A sync that Argo CD hasn't started yet is
taken back instead. Either way, Lumovi reads the Application again as it's sent: if the sync you
were shown has started, ended or been replaced by another since, nothing is sent and nothing
changes.

Besides its own kinds, it reads ReplicaSets and Pods in the namespace an Application deploys to:
their names, who made them and how ready they are, never what they run. Of those that aren't well,
it reads their warning events: why, what each says (Lumovi cuts a message where it could carry
something only you may read) and when. A row for one of what it manages opens Lumovi's own list of
its kind, showing only that resource, for Deployments, StatefulSets, DaemonSets, Services,
ConfigMaps, Ingresses, Jobs and CronJobs; the list is Lumovi's, read as you, and the plugin reads
nothing of it.
