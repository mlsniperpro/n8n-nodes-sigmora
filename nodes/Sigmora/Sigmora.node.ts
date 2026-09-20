import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { properties } from './descriptions';
import { buildRequest, collectJobPages, transformResponse, type OperationKey } from './operations';
import { sigmoraApiRequest } from './transport';

const parameterNames = [
	'projectId',
		'assetId',
		'jobId',
		'parentJobId',
		'appliedCutIds',
	'title',
	'mediaType',
	'videoPath',
	'visibility',
	'exactTitle',
	'sourceUrl',
	'platform',
	'shootId',
	'clipIds',
	'brief',
	'makeLong',
	'shortsCount',
	'longPlatform',
	'shortsPlatform',
	'reviewCuts',
	'story',
	'videoType',
	'aspect',
	'quality',
	'renderer',
	'draft',
	'reason',
	'kind',
	'status',
	'limit',
	'cursor',
	'after',
	'scopeJson',
	'purpose',
	'audience',
	'sourcesJson',
	'retrievedPassagesJson',
	'exclusionsJson',
	'policyVersion',
	'retentionMode',
	'recipeId',
	'snapshotId',
	'recipeVersion',
	'executionJson',
	'usageEstimateJson',
	'publishDestinationId',
	'expiresAt',
	'proposalId',
	'runId',
	'videoJobId',
	'connectedAccountId',
	'caption',
	'scheduledAt',
	'idempotencyKey',
] as const;

function parametersForItem(context: IExecuteFunctions, index: number): IDataObject {
	const values: IDataObject = {};
	for (const name of parameterNames) {
		try {
			values[name] = context.getNodeParameter(name, index, undefined) as never;
		} catch {
			// Hidden parameters are absent for the selected operation.
		}
	}
	return values;
}

export class Sigmora implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sigmora',
		name: 'sigmora',
		icon: { light: 'file:sigmora.svg', dark: 'file:sigmora.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Import media and run, inspect, or cancel Sigmora video jobs',
		defaults: { name: 'Sigmora' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'sigmoraApi', required: true }],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let index = 0; index < inputItems.length; index++) {
			try {
				const resource = this.getNodeParameter('resource', index) as string;
				const operation = this.getNodeParameter('operation', index) as string;
				const key = `${resource}.${operation}` as OperationKey;
				const parameters = parametersForItem(this, index);
					const results =
						key === 'job.list'
							? await collectJobPages(parameters, async (spec) =>
									sigmoraApiRequest.call(this, spec),
								)
							: transformResponse(
									key,
									await sigmoraApiRequest.call(this, buildRequest(key, parameters)),
									parameters,
								);
					for (const json of results) {
					output.push({ json, pairedItem: { item: index } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: inputItems[index]?.json ?? {}, error, pairedItem: { item: index } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error, { itemIndex: index });
			}
		}

		return [output];
	}
}
