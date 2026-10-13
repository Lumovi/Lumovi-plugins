# Prometheus Operator

Prometheus operator (https://prometheus-operator.dev), as kube-prometheus-stack installs it.

Its **Target health** page asks the Prometheus server in each namespace with a Prometheus (the
`prometheus-operated` Service the operator makes there, port `web`) for `/api/v1/targets?state=active`,
through Lumovi and as you, and shows each scrape pool's targets, down ones first, with their last
error. Lumovi shows this in red on its Plugins page: what the server answers reaches the plugin's
code. Prometheus answers with every active target it discovered, each with the labels and
annotations of the Services and Pods behind it, from every namespace it watches. The page shows
each target's pool, instance, health and last error. A Prometheus scrapes across namespaces:
whoever may reach its server sees all its targets, whatever else they may see in the cluster. Where
several Prometheus servers share a namespace, the `prometheus-operated` Service sends each ask to
one of their pods, so the page shows whichever answered.
