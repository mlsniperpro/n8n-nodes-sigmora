import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SigmoraApi implements ICredentialType {
	name = 'sigmoraApi';

	displayName = 'Sigmora API';

	icon: Icon = {
		light: 'file:../icons/sigmora.svg',
		dark: 'file:../icons/sigmora.dark.svg',
	};

	documentationUrl = 'https://docs.sigmora.org';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'A personal workspace API key from Sigmora Settings → API Keys',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.sigmora.org',
			required: true,
			description: 'Sigmora API origin. Keep the default for the hosted service.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				Accept: 'application/json',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/capabilities',
			method: 'GET',
		},
	};
}
