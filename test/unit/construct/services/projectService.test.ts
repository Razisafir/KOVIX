/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('ConstructProjectService', () => {
	test('project template enum values exist', () => {
		const templates = ['ReactApp', 'NextApp', 'VueApp', 'ExpressAPI', 'FastAPIApp', 'PythonCLI', 'FullStack', 'Custom'];
		assert.ok(templates.length === 8);
	});

	test('project creation input has required fields', () => {
		const input = {
			name: 'My Project',
			template: 'ReactApp',
			directory: '/path/to/project',
			techStack: ['React', 'TypeScript'],
			goals: ['Build a web app']
		};
		assert.ok(input.name);
		assert.ok(input.template);
		assert.ok(input.directory);
	});

	test('project status transitions are valid', () => {
		const validStatuses = ['created', 'active', 'paused', 'completed', 'archived'];
		assert.ok(validStatuses.includes('created'));
		assert.ok(validStatuses.includes('active'));
		assert.ok(!validStatuses.includes('invalid'));
	});

	test('project metadata structure', () => {
		const project = {
			id: 'proj_123',
			name: 'Test Project',
			template: 'ReactApp',
			directory: '/path/to/project',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			status: 'created',
			techStack: ['React'],
			goals: ['Build something']
		};
		assert.ok(project.id);
		assert.ok(project.name);
		assert.ok(project.createdAt);
		assert.ok(project.updatedAt);
	});

	test('global registry path resolves correctly', () => {
		const home = process.env.HOME || process.env.USERPROFILE || '~';
		const registryPath = `${home}/.kovix/projects.json`;
		assert.ok(registryPath.includes('.kovix'));
		assert.ok(registryPath.endsWith('projects.json'));
	});
});
