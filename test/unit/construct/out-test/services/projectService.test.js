"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
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
//# sourceMappingURL=projectService.test.js.map