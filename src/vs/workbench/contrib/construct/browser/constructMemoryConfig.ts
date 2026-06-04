/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Memory Settings Configuration
 *  Registers configuration settings for Supermemory integration.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

// Register Construct memory settings as VS Code configuration
const memoryConfiguration: IConfigurationNode = {
	id: 'construct.memory',
	order: 100,
	title: localize('construct.memory', "Construct Memory"),
	type: 'object',
	properties: {
		'construct.memory.enabled': {
			type: 'boolean',
			default: false,
			description: localize('construct.memory.enabled', "Enable Supermemory persistent memory. When enabled, conversation context and learned facts are stored in Supermemory and survive across sessions. When disabled, only local in-memory storage is used (lost on reload).")
		},
		'construct.memory.autoLearn': {
			type: 'boolean',
			default: true,
			description: localize('construct.memory.autoLearn', "Automatically extract and store memories from every conversation. When enabled, user messages, agent actions, and task completions are stored as memories. When disabled, only manually added memories (via 'Construct: Add Memory' command) are stored.")
		},
		'construct.memory.apiKey': {
			type: 'string',
			default: '',
			description: localize('construct.memory.apiKey', "Supermemory API key for persistent memory. Get your key at https://supermemory.ai. This setting is stored securely and not displayed in plain text."),
			scope: 0 /* ConfigurationScope.APPLICATION */
		},
		'construct.memory.searchMode': {
			type: 'string',
			default: 'hybrid',
			enum: ['memories', 'hybrid', 'documents'],
			enumDescriptions: [
				localize('construct.memory.searchMode.memories', "Low-latency conversational memory search — fastest, retrieves stored facts and recent activity."),
				localize('construct.memory.searchMode.hybrid', "Combines memory + document RAG search — best for finding both facts and document snippets."),
				localize('construct.memory.searchMode.documents', "Document/chunk search only — retrieves relevant text chunks from stored documents.")
			],
			description: localize('construct.memory.searchMode', "Default search mode for memory queries. 'hybrid' provides the best balance of facts and document context.")
		},
		'construct.memory.maxResults': {
			type: 'number',
			default: 5,
			minimum: 1,
			maximum: 50,
			description: localize('construct.memory.maxResults', "Maximum number of memory results to inject into the system prompt per task. Higher values provide more context but consume more tokens.")
		},
		'construct.memory.containerTag': {
			type: 'string',
			default: '',
			description: localize('construct.memory.containerTag', "Custom container tag for Supermemory. Leave empty to auto-generate from workspace name. Container tags separate memories between different projects.")
		}
	}
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(memoryConfiguration);
