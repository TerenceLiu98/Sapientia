# Raw Kubernetes Manifests

This folder is the beginner-friendly deployment path. Each file is plain Kubernetes YAML and can be read or applied in order without knowing Kustomize.

## Files

- `namespace.yaml`: creates the `sapientia` namespace.
- `secret.example.yaml`: copy this to your own secret file and replace every value.
- `configmap.yaml`: non-secret app, Postgres init, and nginx config.
- `storage.yaml`: Postgres, Redis, and RustFS/S3-compatible object storage.
- `job.yaml`: RustFS bucket init and database migration jobs.
- `deployment.yaml`: API, worker, and web deployments/services.
- `ingress.yaml`: app and S3 ingress hosts.

## Deploy

```bash
kubectl apply -f infra/k8s/raw/namespace.yaml

cp infra/k8s/raw/secret.example.yaml /tmp/sapientia-secret.yaml
$EDITOR /tmp/sapientia-secret.yaml
kubectl apply -f /tmp/sapientia-secret.yaml

kubectl apply -f infra/k8s/raw/configmap.yaml
kubectl apply -f infra/k8s/raw/storage.yaml
kubectl apply -f infra/k8s/raw/job.yaml
kubectl apply -f infra/k8s/raw/deployment.yaml
kubectl apply -f infra/k8s/raw/ingress.yaml
```

For production, edit these before applying:

- hosts and TLS in `ingress.yaml`
- `BETTER_AUTH_URL`, `FRONTEND_ORIGIN`, and `S3_PUBLIC_ENDPOINT` in `configmap.yaml`
- image tags in `deployment.yaml` and `job.yaml`
- storage requests in `storage.yaml`
