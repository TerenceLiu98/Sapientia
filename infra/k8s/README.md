# Sapientia Kubernetes Deployment

Kubernetes manifests are maintained in two forms:

- `raw/` contains beginner-friendly plain YAML files such as `deployment.yaml`, `secret.example.yaml`, and `ingress.yaml`.
- `kustomize/base/` contains the same full stack as reusable Kustomize resources.
- `kustomize/overlays/dev/` is a local/dev cluster overlay.
- `kustomize/overlays/prod/` is a production-shaped overlay with TLS host placeholders and versioned images.

Both deployment paths create and use the `sapientia` namespace by default.

## 1. Publish Images

The GHCR workflow publishes:

- `ghcr.io/TerenceLiu98/sapientia-api:latest` from the `publish` branch
- `ghcr.io/TerenceLiu98/sapientia-web:latest` from the `publish` branch
- `ghcr.io/TerenceLiu98/sapientia-api:v-x` from `v-x` branch/tag
- `ghcr.io/TerenceLiu98/sapientia-web:v-x` from `v-x` branch/tag

If the GHCR packages are private, create an image pull secret in the namespace and patch the service account or deployments for your cluster.

## 2. Beginner Path: Raw YAML

Use this path if you want to see and edit normal Kubernetes resources directly.

```bash
kubectl apply -f infra/k8s/raw/namespace.yaml

cp infra/k8s/raw/secret.example.yaml /tmp/sapientia-secrets.yaml
$EDITOR /tmp/sapientia-secrets.yaml
kubectl apply -f /tmp/sapientia-secrets.yaml

kubectl apply -f infra/k8s/raw/configmap.yaml
kubectl apply -f infra/k8s/raw/storage.yaml
kubectl apply -f infra/k8s/raw/job.yaml
kubectl apply -f infra/k8s/raw/deployment.yaml
kubectl apply -f infra/k8s/raw/ingress.yaml
```

See `raw/README.md` for what each file contains.

## 3. Kustomize Path

Use this path once you want dev/prod overlays and image/tag patches.

### Create Secrets

Copy the example, replace every secret, then apply it:

```bash
kubectl apply -f infra/k8s/kustomize/base/namespace.yaml
cp infra/k8s/kustomize/base/secret.example.yaml /tmp/sapientia-secrets.yaml
$EDITOR /tmp/sapientia-secrets.yaml
kubectl apply -f /tmp/sapientia-secrets.yaml
```

The secret must be named `sapientia-secrets` in the `sapientia` namespace.

### Deploy

For a local/dev cluster:

```bash
kubectl apply -k infra/k8s/kustomize/overlays/dev
kubectl -n sapientia rollout status deploy/api
kubectl -n sapientia rollout status deploy/web
kubectl -n sapientia rollout status deploy/worker
```

For production, edit `infra/k8s/kustomize/overlays/prod/*.yaml` first, especially:

- hosts in `ingress-patch.yaml`
- public origins in `config-patch.yaml`
- image tags in `kustomization.yaml`

Then deploy:

```bash
kubectl apply -k infra/k8s/kustomize/overlays/prod
kubectl -n sapientia rollout status deploy/api
kubectl -n sapientia rollout status deploy/web
kubectl -n sapientia rollout status deploy/worker
```

## Notes

- The app uses external MinerU and LLM provider credentials configured by users in `/settings`.
- RustFS/S3 must be reachable through `S3_PUBLIC_ENDPOINT` for browser-facing presigned PDF URLs.
- `migrate` runs as a Kubernetes Job. If API pods start before it finishes, they may briefly fail readiness and then recover.
