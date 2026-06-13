// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IEmbeddingConfig } from './memoryTypes';

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
