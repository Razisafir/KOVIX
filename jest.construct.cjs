/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Jest Configuration
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/** @type {import('jest').Config} */
module.exports = {
	projects: [
		{
			displayName: 'construct-services',
			testEnvironment: 'node',
			rootDir: '.',
			testMatch: ['**/test/construct/services/**/*.test.ts'],
			transform: {
				'^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.construct.json' }],
			},
			moduleNameMapper: {
				'^@construct/(.*)$': '<rootDir>/src/construct/$1',
			},
			collectCoverageFrom: [
				'src/construct/services/**/*.ts',
				'src/construct/agent/**/*.ts',
				'!**/node_modules/**',
				'!**/out/**',
			],
		},
		{
			displayName: 'construct-webview',
			testEnvironment: 'jsdom',
			rootDir: '.',
			testMatch: ['**/test/construct/webview/**/*.test.tsx'],
			transform: {
				'^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.construct-webview.json' }],
			},
			moduleNameMapper: {
				'\\.css$': '<rootDir>/test/construct/__mocks__/styleMock.js',
			},
		},
	],
};
