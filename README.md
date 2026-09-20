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
verification. `n8n-nodes-sigmora` is currently unclaimed, so its first public
release must use a granular npm token that can create the package. Store that
token as the `NPM_TOKEN` Actions secret. The GitHub repository named in
`package.json` must be public before publishing because npm cannot generate the
required provenance statement from a private repository. If this monorepo will
remain private, publish the connector from a dedicated public repository and
update the package repository field and trusted-publisher coordinates to match
it exactly. Then run `pnpm release` in this directory. The package-scoped
release configuration creates an n8n-only tag
such as `n8n-v0.2.0`; the root workflow accepts only that exact prefix and checks
that its version matches this package before publishing with provenance.

After the first publish creates the package, configure npm trusted publishing
with repository owner `mlsniperpro`, repository `sigmora-platform`, and workflow
filename `publish-n8n.yml`; enable the trusted publisher's direct `npm publish`
action because this workflow does not use npm's staged-publish flow. Then remove
the `NPM_TOKEN` secret. Subsequent
releases use GitHub OIDC without a long-lived npm credential. Keep `NPM_TOKEN`
only as a fallback when trusted publishing is unavailable. Run a live
subscription smoke test with a workspace API key before Creator Portal
submission.

The nodes intentionally omit an arbitrary API-request escape hatch. Typed
operations preserve Sigmora's source scope validation, idempotency, proposal
approval, and publishing policy boundary.
