import { createHash, createHmac } from 'node:crypto';

import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { sigmoraApiRequest } from './transport';
import { verifyWebhookSignature } from './webhook-signature';

export const eventOptions = [
	{ name: 'Job Awaiting Approval', value: 'job.awaiting_approval' },
	{ name: 'Job Progressed', value: 'job.progressed' },
	{ name: 'Job Completed', value: 'job.completed' },
	{ name: 'Job Failed', value: 'job.failed' },
	{ name: 'Job Cancelled', value: 'job.cancelled' },
	{ name: 'Artifact Ready', value: 'artifact.ready' },
	{ name: 'Publish Completed', value: 'publish.completed' },
	{ name: 'Publish Failed', value: 'publish.failed' },
];

function normalizedEvents(events: string[]): string[] {
	return [...events].sort();
}

async function hookIdentity(context: IHookFunctions) {
	const webhookUrl = context.getNodeWebhookUrl('default');
	if (!webhookUrl || !webhookUrl.startsWith('https://') || /\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(webhookUrl)) {
		throw new NodeOperationError(
			context.getNode(),
			'Sigmora requires a public HTTPS webhook URL. Configure WEBHOOK_URL and your reverse proxy before activating this workflow.',
		);
	}
	const events = normalizedEvents(context.getNodeParameter('events') as string[]);
	const credentials = await context.getCredentials('sigmoraApi');
	const apiKey = String(credentials.apiKey);
	const seed = `${webhookUrl}\n${events.join(',')}\n${context.getWorkflow().id ?? 'workflow'}`;
	return {
		webhookUrl,
		events,
		secret: createHmac('sha256', apiKey).update(`n8n-hook-v1\n${seed}`).digest('hex'),
		idempotencyKey: `n8n-hook-${createHash('sha256').update(seed).digest('hex')}`,
	};
}

function errorStatus(error: unknown): number | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const candidate = error as { httpCode?: string | number; statusCode?: number; response?: { statusCode?: number } };
	return Number(candidate.httpCode ?? candidate.statusCode ?? candidate.response?.statusCode) || undefined;
}

export class SigmoraTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sigmora Trigger',
		name: 'sigmoraTrigger',
		icon: { light: 'file:sigmora.svg', dark: 'file:sigmora.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow from a signed Sigmora job, artifact, or publishing event',
		defaults: { name: 'Sigmora Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sigmoraApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: eventOptions,
				default: ['job.completed', 'job.failed', 'artifact.ready'],
				required: true,
				description:
					'Job events cover footage edits and media-analysis jobs created in Sigmora. Artifact Ready is footage-edit only. Publish events come from Sigmora’s publishing rail. Poll Get Job for prose-to-video renders.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (typeof data.subscriptionId !== 'string') return false;
				try {
					const response = await sigmoraApiRequest.call(this, {
						method: 'GET',
						path: `/v1/webhook-subscriptions/${encodeURIComponent(data.subscriptionId)}`,
					});
					const subscription = response.subscription as IDataObject | undefined;
					return subscription?.status === 'active';
				} catch (error) {
					if (errorStatus(error) === 404) {
						delete data.subscriptionId;
						delete data.webhookSecret;
						return false;
					}
					throw new NodeOperationError(this.getNode(), error);
				}
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const identity = await hookIdentity(this);
				const response = await sigmoraApiRequest.call(this, {
					method: 'POST',
					path: '/v1/webhook-subscriptions',
					idempotencyKey: identity.idempotencyKey,
					body: { url: identity.webhookUrl, events: identity.events, secret: identity.secret },
				});
				const subscription = response.subscription as IDataObject | undefined;
				if (typeof subscription?.id !== 'string') {
					throw new NodeOperationError(this.getNode(), 'Sigmora did not return a webhook subscription ID.');
				}
				const data = this.getWorkflowStaticData('node');
				data.subscriptionId = subscription.id;
				data.webhookSecret = identity.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (typeof data.subscriptionId !== 'string') return true;
				try {
					await sigmoraApiRequest.call(this, {
						method: 'DELETE',
						path: `/v1/webhook-subscriptions/${encodeURIComponent(data.subscriptionId)}`,
					});
				} catch (error) {
					throw new NodeOperationError(this.getNode(), error);
				}
				delete data.subscriptionId;
				delete data.webhookSecret;
				delete data.seenEventIds;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const headers = this.getHeaderData();
		const data = this.getWorkflowStaticData('node');
		const secret = typeof data.webhookSecret === 'string' ? data.webhookSecret : '';
		const rawValue = request.rawBody;
		const rawBody = Buffer.isBuffer(rawValue)
			? rawValue.toString('utf8')
			: typeof rawValue === 'string'
				? rawValue
				: JSON.stringify(request.body);
		const timestamp = headers['x-sigmora-timestamp'];
		const signature = headers['x-sigmora-signature'];
		if (
			!secret ||
			!verifyWebhookSignature(
				secret,
				typeof timestamp === 'string' ? timestamp : undefined,
				rawBody,
				typeof signature === 'string' ? signature : undefined,
			)
		) {
			this.getResponseObject().status(401).send('Invalid Sigmora webhook signature').end();
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events') as string[];
		if (
			body.schemaVersion !== 'automation-event.v1' ||
			typeof body.eventId !== 'string' ||
			typeof body.event !== 'string' ||
			!events.includes(body.event)
		) {
			return {};
		}

		const seen = Array.isArray(data.seenEventIds) ? (data.seenEventIds as string[]) : [];
		if (seen.includes(body.eventId)) return {};
		data.seenEventIds = [...seen.slice(-999), body.eventId];

		return {
			workflowData: [this.helpers.returnJsonArray([body])],
		};
	}
}
