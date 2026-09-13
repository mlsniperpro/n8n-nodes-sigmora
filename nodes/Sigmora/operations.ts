import type { IDataObject } from 'n8n-workflow';

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
	| 'capability.list';

function requireIdempotencyKey(value: unknown): string {
	const key = String(value ?? '');
	if (!key || key.length > 255) throw new Error('Idempotency Key must be between 1 and 255 characters.');
	return key;
}

export function buildRequest(key: OperationKey, parameters: IDataObject): RequestSpec {
	switch (key) {
		case 'project.create':
			return {
				method: 'POST',
				path: '/v1/projects',
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
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
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
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
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
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
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
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
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
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
				idempotencyKey: requireIdempotencyKey(parameters.idempotencyKey),
				body: { reason: parameters.reason },
			};
		case 'capability.list':
			return { method: 'GET', path: '/v1/capabilities' };
	}
}

export function transformResponse(
	key: OperationKey,
	response: IDataObject,
	parameters: IDataObject,
): IDataObject[] {
	switch (key) {
		case 'project.create':
			return [response.project as IDataObject];
		case 'project.find': {
			if (response.project) return [response.project as IDataObject];
			const exactTitle = String(parameters.exactTitle ?? '');
			if (!exactTitle) throw new Error('Enter either Project ID or Exact Title.');
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
			}),
		);
		jobs.push(...((response.jobs as IDataObject[] | undefined) ?? []));
		const nextCursor = typeof response.nextCursor === 'string' ? response.nextCursor : '';
		if (!response.hasMore || !nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) break;
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}

	return jobs.slice(0, requestedLimit);
}
