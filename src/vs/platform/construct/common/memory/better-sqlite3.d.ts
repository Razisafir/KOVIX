/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'better-sqlite3' {
	interface Database {
		exec(sql: string): void;
		prepare(sql: string): Statement;
		transaction<T>(fn: () => T): () => T;
		close(): void;
	}

	interface Statement {
		run(...params: unknown[]): void;
		get(...params: unknown[]): Record<string, unknown> | undefined;
		all(...params: unknown[]): Array<Record<string, unknown>>;
	}

	export default class BetterSqlite3 {
		constructor(filename: string, options?: { readonly?: boolean });
	}
}
