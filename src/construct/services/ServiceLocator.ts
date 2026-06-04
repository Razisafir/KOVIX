/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Service Locator (DI Container)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export class ServiceLocator {
	private static instance: ServiceLocator;
	private readonly registry = new Map<symbol, unknown>();

	private constructor() {}

	static getInstance(): ServiceLocator {
		if (!ServiceLocator.instance) {
			ServiceLocator.instance = new ServiceLocator();
		}
		return ServiceLocator.instance;
	}

	register<T>(key: symbol, implementation: T): void {
		if (this.registry.has(key)) {
			throw new Error(`Service already registered for key: ${key.toString()}`);
		}
		this.registry.set(key, implementation);
	}

	resolve<T>(key: symbol): T {
		const impl = this.registry.get(key);
		if (impl === undefined) {
			throw new Error(`No service registered for key: ${key.toString()}`);
		}
		return impl as T;
	}

	has(key: symbol): boolean {
		return this.registry.has(key);
	}

	reset(): void {
		this.registry.clear();
	}
}
