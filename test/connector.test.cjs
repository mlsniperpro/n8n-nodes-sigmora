const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildRequest, collectJobPages, transformResponse } = require('../dist/nodes/Sigmora/operations.js');
const { signWebhook, verifyWebhookSignature } = require('../dist/nodes/Sigmora/webhook-signature.js');
const { eventOptions, SigmoraTrigger } = require('../dist/nodes/Sigmora/SigmoraTrigger.node.js');

test('trigger exposes every event in the shared automation contract', () => {
  const contract = require('../../shared/contract.json');
  assert.deepEqual(eventOptions.map((option) => option.value), contract.eventTypes);
  assert.deepEqual(contract.subscriptionEventJobKinds, ['video.edit', 'media.analysis']);
  assert.deepEqual(contract.artifactReadyJobKinds, ['video.edit']);
});

test('URL import request uses the public endpoint and idempotency header value', () => {
  const request = buildRequest('asset.import', {
    projectId: 'prj_1',
    sourceUrl: 'https://cdn.example/recording.mp4',
    platform: 'youtube',
    idempotencyKey: 'file-1-v2',
  });
  assert.deepEqual(request, {
    method: 'POST',
    path: '/v1/assets/import',
    idempotencyKey: 'file-1-v2',
    body: {
      projectId: 'prj_1',
      sourceUrl: 'https://cdn.example/recording.mp4',
      title: undefined,
      platform: 'youtube',
    },
  });
});

test('audio project creation omits the video-only path default', () => {
  const request = buildRequest('project.create', {
    title: 'Podcast season',
    mediaType: 'audio',
    videoPath: 'general',
    visibility: 'private',
    idempotencyKey: 'project:podcast-season:v1',
  });
  assert.deepEqual(request, {
    method: 'POST',
    path: '/v1/projects',
    idempotencyKey: 'project:podcast-season:v1',
    body: {
      title: 'Podcast season',
      mediaType: 'audio',
      visibility: 'private',
    },
  });
});

test('footage edit maps imported content IDs and exposes actual child jobs separately from its parent', () => {
  const request = buildRequest('job.startEdit', {
    projectId: 'prj_1',
    shootId: 'shoot_1',
    clipIds: 'asset_1, asset_2',
    title: 'Weekly recording',
    makeLong: true,
    shortsCount: 2,
    reviewCuts: false,
    idempotencyKey: 'edit-file-1-v2',
  });
  assert.deepEqual(request.body.clipIds, ['asset_1', 'asset_2']);
	const output = transformResponse('job.startEdit', {
		success: true,
		parentJobId: 'job_parent',
		childJobIds: ['job_child_1', 'job_child_2'],
	}, {});
	assert.equal(output[0].parentJobId, 'job_parent');
	assert.deepEqual(output[0].childJobIds, ['job_child_1', 'job_child_2']);
	assert.equal(output[0].jobId, 'job_child_1');
	const review = transformResponse('job.startEdit', {
		success: true,
		parentJobId: 'job_parent',
		childJobIds: [],
	}, {});
	assert.equal(review[0].jobId, null);
});

test('cut approval uses the public route and returns the first artifact-producing child job', () => {
	const request = buildRequest('job.approveEdit', {
		projectId: 'prj_1',
		parentJobId: 'job_parent',
		appliedCutIds: 'cut_1, cut_2',
		idempotencyKey: 'approve:job_parent:v1',
	});
	assert.deepEqual(request, {
		method: 'POST',
		path: '/v1/video/edit/approve',
		idempotencyKey: 'approve:job_parent:v1',
		body: {
			projectId: 'prj_1',
			parentJobId: 'job_parent',
			appliedCutIds: ['cut_1', 'cut_2'],
		},
	});
	const [output] = transformResponse('job.approveEdit', {
		success: true,
		parentJobId: 'job_parent',
		childJobIds: ['job_child'],
	}, {});
	assert.equal(output.parentJobId, 'job_parent');
	assert.equal(output.jobId, 'job_child');
});

test('asset ingest status uses the project asset ID and yields the content ID', () => {
  const request = buildRequest('asset.getStatus', { projectId: 'prj_1', assetId: 'asset_1' });
  assert.deepEqual(request, {
    method: 'GET',
    path: '/v1/assets/asset_1/ingest',
    qs: { projectId: 'prj_1' },
  });
  const output = transformResponse('asset.getStatus', {
    success: true,
    assetId: 'asset_1',
    contentId: 'content_1',
    ready: true,
  }, {});
  assert.equal(output[0].contentId, 'content_1');
});

test('capability listing reads the canonical API capabilities collection', () => {
  const output = transformResponse('capability.list', {
    success: true,
    workspaceId: 'ws_1',
    capabilities: [{ id: 'video.edit', method: 'POST', path: '/v1/video/edit' }],
  }, {});
  assert.deepEqual(output, [{ id: 'video.edit', method: 'POST', path: '/v1/video/edit' }]);
});

test('job listing follows sparse cursor pages until it collects the requested items', async () => {
  const cursors = [];
  const pages = [
    { success: true, jobs: [], hasMore: true, nextCursor: 'cursor_2' },
    { success: true, jobs: [{ id: 'job_1' }], hasMore: false, nextCursor: null },
  ];
  const jobs = await collectJobPages(
    { projectId: 'prj_1', kind: 'video.edit', limit: 1 },
    async (request) => {
      cursors.push(request.qs.cursor);
      return pages.shift();
    },
  );
  assert.deepEqual(cursors, ['', 'cursor_2']);
  assert.deepEqual(jobs, [{ id: 'job_1' }]);
});

test('native and HTTP templates wait for ingest readiness and edit the content ID', () => {
  for (const name of ['native-import-edit.json', 'http-import-edit.json']) {
    const template = JSON.parse(readFileSync(path.join(__dirname, '..', 'templates', name), 'utf8'));
    assert.ok(template.nodes.some((node) => node.name === 'Asset ready?'));
    assert.ok(template.nodes.some((node) => /Get ingest status/.test(node.name)));
    const edit = template.nodes.find((node) => /Start footage edit/.test(node.name));
    assert.match(JSON.stringify(edit.parameters), /contentId/);
    assert.doesNotMatch(JSON.stringify(edit.parameters), /clipIds[^]*asset\.id/);
  }
});

test('artifact operation returns URLs from the job without fetching media bytes', () => {
  const output = transformResponse('job.getArtifact', {
    success: true,
    job: {
      id: 'job_1',
      projectId: 'prj_1',
      kind: 'video.render',
      status: 'done',
      artifacts: { download: 'https://media.example/final.mp4' },
    },
  }, {});
  assert.equal(output[0].artifacts.download, 'https://media.example/final.mp4');
});

test('webhook signature uses timestamp dot raw-body HMAC and rejects tampering', () => {
  const secret = 's'.repeat(64);
  const timestamp = '2026-09-13T12:00:00.000Z';
  const now = Date.parse(timestamp);
  const rawBody = '{"eventId":"evt_1"}';
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  assert.equal(signWebhook(secret, timestamp, rawBody), signature);
  assert.equal(verifyWebhookSignature(secret, timestamp, rawBody, signature, now), true);
  assert.equal(verifyWebhookSignature(secret, timestamp, `${rawBody} `, signature, now), false);
  assert.equal(verifyWebhookSignature(secret, timestamp, rawBody, signature, now + 6 * 60 * 1000), false);
});

test('trigger creates, deletes, and reactivates a webhook with retry-safe request identity', async () => {
  const calls = [];
  const staticData = {};
  let creates = 0;
  const context = {
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/sigmora',
    getNodeParameter: () => ['job.completed', 'artifact.ready'],
    getCredentials: async () => ({ apiKey: 'sk_test_example', baseUrl: 'https://api.sigmora.org' }),
    getWorkflow: () => ({ id: 'workflow_1' }),
    getNode: () => ({ name: 'Sigmora Trigger', type: 'sigmoraTrigger', typeVersion: 1, position: [0, 0], parameters: {} }),
    getWorkflowStaticData: () => staticData,
    helpers: {
      httpRequestWithAuthentication: async (_credential, options) => {
        calls.push(options);
        if (options.method === 'POST') {
          creates += 1;
          return { success: true, subscription: { id: `sub_${creates}` } };
        }
        return { success: true, deleted: true, subscriptionId: 'sub_1' };
      },
    },
  };
  const trigger = new SigmoraTrigger();
  assert.equal(await trigger.webhookMethods.default.create.call(context), true);
  assert.equal(staticData.subscriptionId, 'sub_1');
  assert.match(staticData.webhookSecret, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].url, 'https://api.sigmora.org/v1/webhook-subscriptions');
  assert.match(calls[0].headers['Idempotency-Key'], /^n8n-hook-/);
  const firstKey = calls[0].headers['Idempotency-Key'];
  const firstSecret = staticData.webhookSecret;
  assert.equal(await trigger.webhookMethods.default.delete.call(context), true);
  assert.equal(staticData.subscriptionId, undefined);
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(await trigger.webhookMethods.default.create.call(context), true);
  assert.equal(staticData.subscriptionId, 'sub_2');
  assert.equal(calls[2].headers['Idempotency-Key'], firstKey);
  assert.equal(staticData.webhookSecret, firstSecret);
});

// The package publishes from the public mirror (decision 8, S-W5-09): npm
// refuses provenance from the private monorepo, so the monorepo only mirrors
// integrations/n8n and the publish workflow lives inside the package, where it
// is inert here and active at the mirror root.
const MONOREPO_ROOT = path.join(__dirname, '..', '..', '..');
const PUBLIC_MIRROR_URL = 'https://github.com/mlsniperpro/n8n-nodes-sigmora.git';

test('release tags and the package repository point at the public n8n mirror', () => {
  const releaseConfig = require('../.release-it.json');
  const packageJson = require('../package.json');
  const workflow = readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml'), 'utf8');

  assert.deepEqual(releaseConfig.git, {
    tagName: 'n8n-v${version}',
    tagMatch: 'n8n-v*',
  });
  assert.equal(packageJson.repository.url, PUBLIC_MIRROR_URL);
  assert.doesNotMatch(packageJson.repository.url, /sigmora-platform/);
  // The mirror root is this directory, so a monorepo subdirectory would make
  // the provenance statement point at a path that does not exist.
  assert.equal(packageJson.repository.directory, undefined);
  assert.match(workflow, /- "n8n-v\*\.\*\.\*"/);
  assert.match(workflow, /const expectedTag = `n8n-v\$\{packageJson\.version\}`/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm run release/);
});

test('the monorepo mirrors the package and holds no n8n npm publish workflow', () => {
  const workflowsDir = path.join(MONOREPO_ROOT, '.github', 'workflows');
  assert.equal(existsSync(path.join(workflowsDir, 'publish-n8n.yml')), false);
  for (const name of readdirSync(workflowsDir)) {
    const text = readFileSync(path.join(workflowsDir, name), 'utf8');
    if (/integrations\/n8n/.test(text)) {
      assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|npm publish|pnpm release/, name);
    }
  }

  const mirror = readFileSync(path.join(workflowsDir, 'mirror-n8n.yml'), 'utf8');
  assert.match(mirror, /- main\n/);
  assert.match(mirror, /- "integrations\/n8n\/\*\*"/);
  assert.match(mirror, /git subtree split --prefix integrations\/n8n/);
  assert.match(mirror, /secrets\.N8N_MIRROR_DEPLOY_KEY/);
  assert.match(mirror, /::notice::N8N_MIRROR_DEPLOY_KEY is not set/);
  assert.match(mirror, /git@github\.com:mlsniperpro\/n8n-nodes-sigmora\.git/);
  assert.match(mirror, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(mirror, /contents: write|id-token: write/);
});

test('the package builds from its own directory, as the mirror root requires', () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) sources.push(full);
    }
  };
  walk(path.join(__dirname, '..', 'nodes'));
  walk(path.join(__dirname, '..', 'credentials'));
  const packageRoot = path.join(__dirname, '..');
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from '(\.[^']+)'|require\('(\.[^']+)'\)/g)) {
      const resolved = path.resolve(path.dirname(file), match[1] ?? match[2]);
      assert.ok(resolved.startsWith(packageRoot + path.sep), `${file} imports ${resolved} outside the package`);
    }
  }
});
