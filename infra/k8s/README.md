# Sapientia Kubernetes Deployment

Kubernetes manifests are organized as Kustomize overlays:

- `base/` contains the full stack: web, API, worker, migration job, Postgres, Redis, RustFS, bucket init, services, and ingress.
- `overlays/dev/` is a local/dev cluster overlay.
- `overlays/prod/` is a production-shaped overlay with TLS host placeholders and versioned images.

All overlays create and use the `sapientia` namespace by default.

## 1. Publish Images

The GHCR workflow publishes:

- `ghcr.io/<owner>/sapientia-api:latest` from the `publish` branch
- `ghcr.io/<owner>/sapientia-web:latest` from the `publish` branch
- `ghcr.io/<owner>/sapientia-api:v0.1` from `v0.1` branch/tag
- `ghcr.io/<owner>/sapientia-web:v0.1` from `v0.1` branch/tag

If the GHCR packages are private, create an image pull secret in the namespace and patch the service account or deployments for your cluster.

## 2. Create Secrets

Copy the example, replace every secret, then apply it:

```bash
kubectl apply -f infra/k8s/base/namespace.yaml
cp infra/k8s/base/secret.example.yaml /tmp/sapientia-secrets.yaml
$EDITOR /tmp/sapientia-secrets.yaml
kubectl apply -f /tmp/sapientia-secrets.yaml
```

The secret must be named `sapientia-secrets` in the `sapientia` namespace.

## 3. Deploy

For a local/dev cluster:

```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl -n sapientia rollout status deploy/api
kubectl -n sapientia rollout status deploy/web
kubectl -n sapientia rollout status deploy/worker
```

For production, edit `infra/k8s/overlays/prod/*.yaml` first, especially:

- hosts in `ingress-patch.yaml`
- public origins in `config-patch.yaml`
- image tags in `kustomization.yaml`

Then deploy:

```bash
kubectl apply -k infra/k8s/overlays/prod
kubectl -n sapientia rollout status deploy/api
kubectl -n sapientia rollout status deploy/web
kubectl -n sapientia rollout status deploy/worker
```

## Notes

- The app uses external MinerU and LLM provider credentials configured by users in `/settings`.
- RustFS/S3 must be reachable through `S3_PUBLIC_ENDPOINT` for browser-facing presigned PDF URLs.
- `migrate` runs as a Kubernetes Job. If API pods start before it finishes, they may briefly fail readiness and then recover.
