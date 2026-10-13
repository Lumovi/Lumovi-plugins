# CloudNativePG

CloudNativePG (https://cloudnative-pg.io): PostgreSQL clusters and their backups.

Its Overview and Backup health pages are drawn by its own code, in Lumovi’s box: it reads its own
kinds (clusters, backups, scheduled backups and poolers), and of pods their names, namespaces,
labels, ages, nodes, conditions and restarts, asking only for its instances’ (labelled
`cnpg.io/cluster`); and changes nothing.
