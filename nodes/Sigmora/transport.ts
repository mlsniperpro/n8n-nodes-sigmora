import type {
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IDataObject,
} from 'n8n-workflow';

export type SigmoraContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export type RequestSpec = {
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	idempotencyKey?: string;
};

function compact(value: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
	);
}

export async function sigmoraApiRequest(
	this: SigmoraContext,
	spec: RequestSpec,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('sigmoraApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.sigmora.org').replace(/\/+$/, '');
	const options: IHttpRequestOptions = {
		method: spec.method,
		url: `${baseUrl}${spec.path}`,
		json: true,
	};
	if (spec.qs) options.qs = compact(spec.qs);
	if (spec.body) options.body = compact(spec.body);
	if (spec.idempotencyKey) options.headers = { 'Idempotency-Key': spec.idempotencyKey };
	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'sigmoraApi',
		options,
	)) as IDataObject;
}

export function splitIds(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
	return String(value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}
