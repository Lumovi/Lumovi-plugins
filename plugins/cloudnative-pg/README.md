# CloudNativePG

CloudNativePG (https://cloudnative-pg.io): PostgreSQL clusters and their backups.

Its Overview and Backup health pages are drawn by its own code, in Lumovi’s box: it reads its own
kinds (clusters, backups, scheduled backups and poolers), and of pods their names, namespaces,
labels, ages, nodes, conditions and restarts, asking only for its instances’ (labelled
`cnpg.io/cluster`).

From the cluster picked on its Overview it proposes Back up now: a Backup of that cluster, in its
namespace, by the method you pick where it has more than one set up. It’s shown in Lumovi’s own
dialog, as the cluster would make it, and nothing changes until you confirm it there. It can’t be
pressed while a backup of the cluster is running, or when the cluster has no backup method set up.
On Lumovi’s own list of clusters, Back up now, Switch over and Restart stay as they were, for
wherever its pages don’t run.
