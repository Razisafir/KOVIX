/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode } from '../../../../platform/configuration/common/configurationRegistry.js';

const apiConfiguration: IConfigurationNode = {
                id: 'construct.anthropic',
                order: 99,
                title: localize('construct.anthropic', "Construct -- Anthropic API"),
                type: 'object',
                properties: {
                                'construct.anthropic.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('construct.anthropic.apiKey', "Anthropic API key for the Construct agent. Get your key at https://console.anthropic.com/. This is required for the agent to function."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'construct.anthropic.model': {
                                                type: 'string',
                                                default: 'claude-sonnet-4-20250514',
                                                description: localize('construct.anthropic.model', "Anthropic model to use for the Construct agent. Available options: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, claude-3-opus-20240229."),
                                                enum: [
                                                                'claude-sonnet-4-20250514',
                                                                'claude-3-5-sonnet-20241022',
                                                                'claude-3-opus-20240229'
                                                ]
                                },
                                'construct.anthropic.maxTokens': {
                                                type: 'number',
                                                default: 8192,
                                                minimum: 1024,
                                                maximum: 32768,
                                                description: localize('construct.anthropic.maxTokens', "Maximum number of tokens the LLM can generate per response. Higher values allow longer responses but cost more.")
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(apiConfiguration);

// --- Phase 1: AI Provider Layer Configuration ---

const ollamaConfiguration: IConfigurationNode = {
                id: 'construct.ollama',
                order: 100,
                title: localize('construct.ollama', "Construct -- Ollama (Local)"),
                type: 'object',
                properties: {
                                'construct.ollama.baseUrl': {
                                                type: 'string',
                                                default: 'http://localhost:11434',
                                                description: localize('construct.ollama.baseUrl', "Base URL for the Ollama API. Defaults to localhost:11434. Change this if you run Ollama on a different host or port."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                }
                }
};

const xenovaConfiguration: IConfigurationNode = {
                id: 'construct.xenova',
                order: 101,
                title: localize('construct.xenova', "Construct -- Xenova (In-Process)"),
                type: 'object',
                properties: {
                                'construct.xenova.model': {
                                                type: 'string',
                                                default: 'Xenova/Qwen1.5-0.5B-Chat',
                                                description: localize('construct.xenova.model', "ONNX model to load via @xenova/transformers for in-process inference. This is the offline fallback when Ollama is not available."),
                                                enum: [
                                                                'Xenova/Qwen1.5-0.5B-Chat',
                                                                'Xenova/Phi-3-mini-4k-instruct',
                                                                'Xenova/codellama-7b-instruct',
                                                                'Xenova/starcoder2-3b'
                                                ]
                                }
                }
};

const cloudConfiguration: IConfigurationNode = {
                id: 'construct.cloud',
                order: 102,
                title: localize('construct.cloud', "Construct -- Cloud (OpenAI-Compatible)"),
                type: 'object',
                properties: {
                                'construct.cloud.baseUrl': {
                                                type: 'string',
                                                default: 'https://api.openai.com/v1',
                                                description: localize('construct.cloud.baseUrl', "Base URL for the OpenAI-compatible cloud API. Supports OpenAI, Together AI, Groq, LM Studio, or any LiteLLM proxy."),
                                                scope: 4 /* ConfigurationScope.WINDOW */
                                },
                                'construct.cloud.apiKey': {
                                                type: 'string',
                                                default: '',
                                                description: localize('construct.cloud.apiKey', "API key for the cloud provider. Required for cloud inference."),
                                                scope: 1 /* ConfigurationScope.APPLICATION */
                                },
                                'construct.cloud.model': {
                                                type: 'string',
                                                default: 'gpt-4o-mini',
                                                description: localize('construct.cloud.model', "Model ID to use with the cloud provider. Must be available from the /v1/models endpoint.")
                                }
                }
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(ollamaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(xenovaConfiguration);
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(cloudConfiguration);
