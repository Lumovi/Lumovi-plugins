# Karpenter

Karpenter (https://karpenter.sh): node pools, and the nodes it launched for them.

Its overview is drawn by its own code, in Lumovi’s box: it reads nodes’ names, labels, taints,
capacity, conditions and usage, and pods’ names, namespaces, ages, nodes and conditions (its
overview lists only the pods on no node yet); and changes nothing.
