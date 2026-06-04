/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
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
