/*---------------------------------------------------------------------------------------------
 *  Construct IDE - ServiceLocator Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ServiceLocator } from '../../../src/construct/services/ServiceLocator';

describe('ServiceLocator', () => {
	let locator: ServiceLocator;

	beforeEach(() => {
		// Reset singleton between tests
		(ServiceLocator as any).instance = undefined;
		locator = ServiceLocator.getInstance();
	});

	afterEach(() => {
		locator.reset();
	});

	test('registers and resolves a service', () => {
		const key = Symbol('test');
		const service = { name: 'TestService' };
		locator.register(key, service);
		expect(locator.resolve(key)).toBe(service);
	});

	test('throws when resolving unregistered service', () => {
		const key = Symbol('missing');
		expect(() => locator.resolve(key)).toThrow('No service registered');
	});

	test('throws when registering duplicate key', () => {
		const key = Symbol('dup');
		locator.register(key, 'first');
		expect(() => locator.register(key, 'second')).toThrow('Service already registered');
	});

	test('has() returns true for registered service', () => {
		const key = Symbol('exists');
		locator.register(key, 'value');
		expect(locator.has(key)).toBe(true);
	});

	test('has() returns false for unregistered service', () => {
		expect(locator.has(Symbol('nope'))).toBe(false);
	});

	test('reset() clears all registrations', () => {
		locator.register(Symbol('a'), 1);
		locator.register(Symbol('b'), 2);
		locator.reset();
		expect(locator.has(Symbol('a'))).toBe(false);
	});

	test('getInstance() returns same singleton', () => {
		const a = ServiceLocator.getInstance();
		const b = ServiceLocator.getInstance();
		expect(a).toBe(b);
	});
});
