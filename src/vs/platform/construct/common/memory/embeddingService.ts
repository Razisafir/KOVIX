/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IEmbeddingConfig } from './memoryTypes.js';

export const IEmbeddingService = createDecorator<IEmbeddingService>('construct.embedding');

export interface IEmbeddingService extends IDisposable {
	readonly _serviceBrand: undefined;

	embed(text: string): Promise<number[]>;
	embedBatch(texts: string[]): Promise<number[][]>;
	getConfig(): IEmbeddingConfig;
	isLocal(): boolean;

	readonly onDidLoadModel: Event<void>;
	readonly onDidError: Event<string>;
}
