# n8n-nodes-sigmora

Community nodes for the public Sigmora automation API.

The **Sigmora** node creates/finds projects, imports a public media URL, checks
asset status, starts footage edits, approves review-mode cuts, starts prose video renders, lists/gets/cancels
jobs, and returns artifact URLs. The **Sigmora Trigger** owns the complete remote
webhook lifecycle and verifies `X-Sigmora-Signature` against the exact raw body.
It rejects delivery timestamps outside a five-minute window and retains a
bounded list of event IDs to suppress ordinary at-least-once retry
duplicates within one workflow activation.

Signed `job.*` subscription events come from the shared footage-edit rail and
media-analysis jobs created in Sigmora. `artifact.ready` is footage-edit only.
**Start Prose Video Render** returns a curriculum
render job ID that must be followed with **Get Job** polling; it does not produce
Sigmora Trigger events yet. A webhook's `data.resourceUrl` points to the job API
resource. Use **Get Artifact URLs** to resolve its playback and download URLs.
The **Workflow** resource creates immutable context snapshots, discovers approved
recipes, creates version-pinned proposals, and approves, rejects, cancels, or
retrieves them. **Get Workflow Run** exposes durable execution state.
**Export Transcript** and **Publish Artifact** are separate resources; publishing
remains subject to Sigmora destination and approval policy. Publishing
completion/failure events continue to arrive through the signed trigger.

An import returns a project asset `id` and a media `contentId`. If it is still
processing, use **Get Ingest Status** with the project asset ID until `ready` is true;
pass the resulting `contentId` to **Source Content IDs** when starting an edit.

**Start Footage Edit** returns its orchestration parent as `parentJobId`, every
artifact-producing render as `childJobIds`, and the first child as `jobId`.
Review mode has no child until **Approve Footage Edit Cuts** is called; poll the
parent until it is awaiting review before approving stored proposal cut IDs.

## Install and test locally

```bash
pnpm install
pnpm --filter n8n-nodes-sigmora test
pnpm --filter n8n-nodes-sigmora dev
```

The build and tests need no external credentials. Add a **Sigmora API**
credential in n8n for live use. Keep the hosted API URL unless you operate an
approved Sigmora deployment.

Importable examples live in `templates/`:

- `native-import-edit.json` imports a provider URL and starts an edit;
- `native-artifact-ready.json` receives a signed completion event and resolves
  the artifact URL; and
- `http-import-edit.json` performs the same import-and-edit start with built-in
  HTTP Request nodes.

For a self-hosted n8n instance, set `WEBHOOK_URL` to a publicly reachable HTTPS
origin, forward that origin through the reverse proxy to n8n, and confirm that
the displayed production webhook URL is not localhost. Sigmora acknowledges any
2xx quickly and retries unsuccessful deliveries. Workflows should still use the
event ID as an idempotency key for downstream systems where concurrent duplicate
execution would be costly.

Publishing requires ownership of the npm package name and n8n Creator Portal
verification. npm cannot generate the provenance statement n8n requires from a
private repository, so this package publishes from its public mirror,
`https://github.com/mlsniperpro/n8n-nodes-sigmora`. The monorepo workflow
`.github/workflows/mirror-n8n.yml` pushes `git subtree split --prefix
integrations/n8n` to that repository's `main` when you run it, from
`main` only. It is manual only (no push trigger): run it from Actions after a change under `integrations/n8n/` lands on `main` (it needs the `N8N_MIRROR_DEPLOY_KEY` secret, the private half of a
write deploy key on the mirror, stored in the `n8n-mirror` GitHub environment
whose deployment branches are limited to `main`; it skips with a notice when
the secret is absent). The mirror runs
`.github/workflows/publish.yml` from this directory, which is inert in the
monorepo.

To release, bump `version` in `package.json`, let the change reach the mirror,
then push a tag `n8n-v<version>` (for example `n8n-v0.1.0`) to the mirror. The
workflow checks the tag matches the package version, installs from the
committed `package-lock.json` with `npm ci --ignore-scripts`, lints, builds and
packs with no credential, and then a separate job holding only the npm OIDC
permission publishes that tarball with provenance (the npm token, when set, is
written only in that final step). After changing dependencies here, refresh the
lockfile with `npm install --package-lock-only --ignore-scripts` in a copy of
this directory outside the pnpm workspace; `test/connector.test.cjs` fails
when it drifts from `package.json`. For the first
publish of the unclaimed `n8n-nodes-sigmora` name, store a granular npm token
as the mirror's `NPM_TOKEN` secret. Then configure an npm trusted publisher
with repository owner `mlsniperpro`, repository `n8n-nodes-sigmora` and
workflow filename `publish.yml`, enable its direct `npm publish` action, and
remove `NPM_TOKEN`. Run a live subscription smoke test with a workspace API key
before Creator Portal submission.

The nodes intentionally omit an arbitrary API-request escape hatch. Typed
operations preserve Sigmora's source scope validation, idempotency, proposal
approval, and publishing policy boundary.
