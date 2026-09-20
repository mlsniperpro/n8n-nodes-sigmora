import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { RequestSpec } from './transport';
import { splitIds } from './transport';

export type OperationKey =
	| 'project.create'
	| 'project.find'
	| 'asset.import'
	| 'asset.getStatus'
	| 'job.approveEdit'
	| 'job.startEdit'
	| 'job.startRender'
	| 'job.get'
	| 'job.list'
	| 'job.cancel'
	| 'job.getArtifact'
	| 'capability.list'
	| 'workflow.createContextSnapshot'
	| 'workflow.findRecipe'
	| 'workflow.createProposal'
	| 'workflow.approveProposal'
	| 'workflow.rejectProposal'
	| 'workflow.cancelProposal'
	| 'workflow.getProposal'
	| 'workflow.getRun'
	| 'asset.exportTranscript'
	| 'publish.artifact';

// Unit-level request builders do not have a workflow node context. The live
// node always supplies its actual node, while this minimal descriptor keeps
// validation errors structured in direct connector tests as well.
const standaloneNode: INode = {
	id: 'sigmora-request-builder',
	name: 'Sigmora',
	type: 'sigmora',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function invalidRequest(node: INode | undefined, message: string): never {
	throw new NodeOperationError(node ?? standaloneNode, message);
}

function requireIdempotencyKey(value: unknown, node?: INode): string {
	const key = String(value ?? '');
	if (!key || key.length > 255) {
		return invalidRequest(node, 'Idempotency Key must be between 1 and 255 characters.');
	}
	return key;
}

function jsonValue(value: unknown, field: string, node?: INode): IDataObject | IDataObject[] {
	if (value && typeof value === 'object') return value as IDataObject | IDataObject[];
	if (typeof value !== 'string' || !value.trim()) return invalidRequest(node, `${field} must be valid JSON.`);
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object') return invalidRequest(node, `${field} must be valid JSON.`);
		return parsed as IDataObject | IDataObject[];
	} catch {
		return invalidRequest(node, `${field} must be valid JSON.`);
	}
}

export function buildRequest(key: OperationKey, parameters: IDataObject, node?: INode): RequestSpec {
	switch (key) {
		case 'project.create':
			return {
				method: 'POST',
				path: '/v1/projects',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					title: parameters.title,
					mediaType: parameters.mediaType,
					...(parameters.mediaType === 'video' ? { videoPath: parameters.videoPath } : {}),
					visibility: parameters.visibility,
				},
			};
		case 'project.find': {
			const projectId = String(parameters.projectId ?? '').trim();
			return projectId
				? { method: 'GET', path: `/v1/projects/${encodeURIComponent(projectId)}` }
				: { method: 'GET', path: '/v1/projects', qs: { status: 'all', limit: 100 } };
		}
		case 'asset.import':
			return {
				method: 'POST',
				path: '/v1/assets/import',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					sourceUrl: parameters.sourceUrl,
					title: parameters.title,
					platform: parameters.platform,
				},
			};
		case 'asset.getStatus':
			return {
				method: 'GET',
				path: `/v1/assets/${encodeURIComponent(String(parameters.assetId))}/ingest`,
				qs: { projectId: parameters.projectId },
			};
		case 'job.startEdit':
			return {
				method: 'POST',
				path: '/v1/video/edit',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					shootId: parameters.shootId,
					clipIds: splitIds(parameters.clipIds),
					title: parameters.title,
					brief: parameters.brief,
					makeLong: parameters.makeLong,
					shortsCount: parameters.shortsCount,
					longPlatform: parameters.longPlatform,
					shortsPlatform: parameters.shortsPlatform,
					reviewCuts: parameters.reviewCuts,
				},
			};
		case 'job.approveEdit':
			return {
				method: 'POST',
				path: '/v1/video/edit/approve',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					parentJobId: parameters.parentJobId,
					appliedCutIds: splitIds(parameters.appliedCutIds),
				},
			};
		case 'job.startRender':
			return {
				method: 'POST',
				path: '/v1/video/render',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					story: parameters.story,
					title: parameters.title,
					videoType: parameters.videoType,
					aspect: parameters.aspect,
					quality: parameters.quality,
					renderer: parameters.renderer,
					draft: parameters.draft,
				},
			};
		case 'job.get':
		case 'job.getArtifact':
			return { method: 'GET', path: `/v1/jobs/${encodeURIComponent(String(parameters.jobId))}` };
		case 'job.list':
			return {
				method: 'GET',
				path: '/v1/jobs',
				qs: {
					projectId: parameters.projectId,
					kind: parameters.kind,
					status: parameters.status,
					limit: parameters.limit,
					cursor: parameters.cursor,
				},
			};
		case 'job.cancel':
			return {
				method: 'POST',
				path: `/v1/jobs/${encodeURIComponent(String(parameters.jobId))}/cancel`,
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: { reason: parameters.reason },
			};
		case 'capability.list':
			return { method: 'GET', path: '/v1/capabilities' };
		case 'workflow.createContextSnapshot':
			return {
				method: 'POST',
				path: '/v1/workflow/context-snapshots',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					scope: jsonValue(parameters.scopeJson, 'Scope', node),
					purpose: parameters.purpose,
					audience: parameters.audience,
					sources: jsonValue(parameters.sourcesJson, 'Authorized Sources', node),
					retrievedPassages: parameters.retrievedPassagesJson
						? jsonValue(parameters.retrievedPassagesJson, 'Retrieved Passages', node)
						: [],
					exclusions: parameters.exclusionsJson ? jsonValue(parameters.exclusionsJson, 'Exclusions', node) : [],
					policyVersion: parameters.policyVersion,
					retentionMode: parameters.retentionMode,
				},
			};
		case 'workflow.findRecipe': {
			const recipeId = String(parameters.recipeId ?? '').trim();
			return recipeId
				? { method: 'GET', path: `/v1/workflow/recipes/${encodeURIComponent(recipeId)}` }
				: { method: 'GET', path: '/v1/workflow/recipes', qs: { limit: 100 } };
		}
		case 'workflow.createProposal':
			return {
				method: 'POST',
				path: '/v1/workflow/proposals',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					projectId: parameters.projectId,
					snapshotId: parameters.snapshotId,
					recipeId: parameters.recipeId,
					recipeVersion: parameters.recipeVersion,
					execution: jsonValue(parameters.executionJson, 'Execution', node),
					usageEstimate: jsonValue(parameters.usageEstimateJson, 'Usage Estimate', node),
					publishDestinationId: parameters.publishDestinationId,
					expiresAt: parameters.expiresAt,
				},
			};
		case 'workflow.approveProposal':
		case 'workflow.rejectProposal':
		case 'workflow.cancelProposal': {
			const operation = key === 'workflow.approveProposal'
				? 'approve'
				: key === 'workflow.rejectProposal'
					? 'reject'
					: 'cancel';
			return {
				method: 'POST',
				path: `/v1/workflow/proposals/${encodeURIComponent(String(parameters.proposalId))}/${operation}`,
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {},
			};
		}
		case 'workflow.getProposal':
			return { method: 'GET', path: `/v1/workflow/proposals/${encodeURIComponent(String(parameters.proposalId))}` };
		case 'workflow.getRun':
			return { method: 'GET', path: `/v1/workflow/runs/${encodeURIComponent(String(parameters.runId))}` };
		case 'asset.exportTranscript':
			return {
				method: 'GET',
				path: `/v1/assets/${encodeURIComponent(String(parameters.assetId))}/transcript`,
				qs: { projectId: parameters.projectId, limit: parameters.limit, after: parameters.after },
			};
		case 'publish.artifact':
			return {
				method: 'POST',
				path: '/v1/publish',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey, node),
				body: {
					videoJobId: parameters.videoJobId,
					connectedAccountId: parameters.connectedAccountId,
					caption: parameters.caption,
					scheduledAt: parameters.scheduledAt,
				},
			};
	}
}

export function transformResponse(
	key: OperationKey,
	response: IDataObject,
	parameters: IDataObject,
	node?: INode,
): IDataObject[] {
	switch (key) {
		case 'project.create':
			return [response.project as IDataObject];
		case 'project.find': {
			if (response.project) return [response.project as IDataObject];
			const exactTitle = String(parameters.exactTitle ?? '');
			if (!exactTitle) return invalidRequest(node, 'Enter either Project ID or Exact Title.');
			const match = ((response.projects as IDataObject[]) ?? []).find(
				(project) => project.title === exactTitle,
			);
			return match ? [match] : [];
		}
		case 'asset.import':
			return [response.asset as IDataObject];
		case 'asset.getStatus':
			return [{ ...response, id: response.assetId }];
		case 'job.startEdit':
		case 'job.approveEdit':
			return [normalizeVideoEditResponse(response)];
		case 'job.startRender':
		case 'job.cancel':
			return [response];
		case 'job.get':
			return [response.job as IDataObject];
		case 'job.list':
			return (response.jobs as IDataObject[]) ?? [];
		case 'job.getArtifact': {
			const job = response.job as IDataObject;
			return [
				{
					id: job.id,
					jobId: job.id,
					projectId: job.projectId ?? null,
					kind: job.kind,
					status: job.status,
					artifacts: (job.artifacts as IDataObject | undefined) ?? {},
					error: job.error ?? null,
				},
			];
		}
		case 'capability.list':
			return (response.capabilities as IDataObject[]) ?? [];
		case 'workflow.createContextSnapshot':
			return [response.contextSnapshot as IDataObject];
		case 'workflow.findRecipe': {
			if (response.recipe) return [response.recipe as IDataObject];
			const exactTitle = String(parameters.exactTitle ?? '');
			if (!exactTitle) return invalidRequest(node, 'Enter either Workflow Recipe ID or Exact Title.');
			const match = ((response.recipes as IDataObject[]) ?? []).find(
				(recipe) => recipe.title === exactTitle,
			);
			return match ? [match] : [];
		}
		case 'workflow.createProposal':
		case 'workflow.rejectProposal':
		case 'workflow.cancelProposal':
			return [response.proposal as IDataObject];
		case 'workflow.approveProposal':
			return [{
				...(response.proposal as IDataObject),
				runId: (response.run as IDataObject | undefined)?.id ?? null,
				provenanceManifestId: (response.provenanceManifest as IDataObject | undefined)?.id ?? null,
			}];
		case 'workflow.getProposal':
			return [response.proposal as IDataObject];
		case 'workflow.getRun':
			return [response.run as IDataObject];
		case 'asset.exportTranscript':
		case 'publish.artifact':
			return [response];
	}
}

/** Parent jobs own the shoot/proposal; child jobs are the artifact-producing work. */
export function normalizeVideoEditResponse(response: IDataObject): IDataObject {
	const childJobIds = Array.isArray(response.childJobIds)
		? response.childJobIds.map(String).filter(Boolean)
		: [];
	return {
		...response,
		parentJobId: response.parentJobId ?? null,
		childJobIds,
		jobId: childJobIds[0] ?? null,
	};
}

export async function collectJobPages(
	parameters: IDataObject,
	request: (spec: RequestSpec) => Promise<IDataObject>,
	node?: INode,
): Promise<IDataObject[]> {
	const requestedLimit = Math.max(1, Math.min(100, Number(parameters.limit) || 50));
	const jobs: IDataObject[] = [];
	let cursor = String(parameters.cursor ?? '');
	const seenCursors = new Set<string>();

	while (jobs.length < requestedLimit) {
		const response = await request(
			buildRequest('job.list', {
				...parameters,
				limit: requestedLimit - jobs.length,
				cursor,
			}, node),
		);
		jobs.push(...((response.jobs as IDataObject[] | undefined) ?? []));
		const nextCursor = typeof response.nextCursor === 'string' ? response.nextCursor : '';
		if (!response.hasMore || !nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) break;
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}

	return jobs.slice(0, requestedLimit);
}
