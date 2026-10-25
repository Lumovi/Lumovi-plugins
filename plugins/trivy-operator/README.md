# Trivy

Trivy Operator (https://aquasecurity.github.io/trivy-operator): what it found scanning the cluster,
on a Security page, a tab on each vulnerability report, and its reports' own lists.

The Security page has four tiles: critical and high vulnerabilities, each with how many have a fix
and in how many workloads; exposed secrets, with how many images; and misconfigured resources, of
how many. Critical and High open the vulnerabilities by workload filtered to that severity. Below
them:

- **Vulnerabilities by workload**: each workload's images as Trivy last scanned them, added up,
  fixable first: by fixable critical, then fixable high, then the rest by severity. Each row has
  its counts by severity, how many critical and high ones have a fix, the worst one with a fix and
  the version that fixes it, and when it was scanned. A row opens Lumovi's own list of its kind,
  showing only that workload. The table is searched by name and filtered by severity, fixable,
  namespace, kind and package, in Lumovi's own bar; the plugin is never told what's typed or set
  there.
- **Vulnerabilities by image**: each image once, however many workloads run it, with who runs it
  and its OS. A row opens its report.
- Critical and high **by namespace**, and fixable **by package**: each opens the workloads' table
  filtered to it.
- **Exposed secrets**: where Trivy found each one (the workload, its container and image, the file)
  and what kind it is, with its severity. Never the text that matched: the plugin's file withholds
  it, so Lumovi drops it before the page, or anything else, has it.
- **Misconfigurations** and **RBAC**: each resource or role with failed checks, by severity, and
  the worst one, as Trivy names it. Misconfigurations are of objects in a namespace: Trivy's
  ClusterConfigAuditReports, of cluster-wide ones, aren't among the plugin's kinds.

A VulnerabilityReport's Vulnerabilities tab has the image, its OS, the container and when it was
scanned, then every vulnerability in it, those with a fix first, worst first in each: its ID,
severity, package, the version installed and the one that fixes it, and Trivy's title. It's searched
by ID and filtered by severity and fixable.

Trivy scans a Deployment's ReplicaSet, not the Deployment, so besides its own kinds the plugin reads
ReplicaSets: their names, which Deployment made each, whether it runs pods and when it was made,
never what they run. A ReplicaSet's report is its Deployment's; an old ReplicaSet's, one that runs
nothing while another of its Deployment's runs pods or is newer, is of what's gone, and isn't
counted. Where the ReplicaSets can't be read, the page says so, with Try again, and each
ReplicaSet's report is its own row until they can.

Nothing is scanned, fixed or looked up anywhere from Lumovi: what Trivy wrote in the cluster is all
there is. ClusterComplianceReports stay a list.
