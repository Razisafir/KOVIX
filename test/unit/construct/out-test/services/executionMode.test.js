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
suite('ExecutionMode', () => {
    test('all four execution modes exist', () => {
        const modes = ['every_milestone', 'major_milestone', 'selective', 'full_auto'];
        assert.strictEqual(modes.length, 4);
        assert.ok(modes.includes('full_auto'));
        assert.ok(modes.includes('every_milestone'));
    });
    test('execution mode configs have unique labels', () => {
        const labels = ['Every Milestone', 'Major Milestones', 'Selective', 'Full Auto'];
        const unique = new Set(labels);
        assert.strictEqual(unique.size, 4);
    });
    test('only FullAuto does not pause at milestones', () => {
        const configs = {
            every_milestone: { pausesAtMilestones: true },
            major_milestone: { pausesAtMilestones: true },
            selective: { pausesAtMilestones: true },
            full_auto: { pausesAtMilestones: false },
        };
        const nonPausing = Object.entries(configs).filter(([_, v]) => !v.pausesAtMilestones);
        assert.strictEqual(nonPausing.length, 1);
        assert.strictEqual(nonPausing[0][0], 'full_auto');
    });
    test('only Selective shows milestone picker', () => {
        const configs = {
            every_milestone: { showsMilestonePicker: false },
            major_milestone: { showsMilestonePicker: false },
            selective: { showsMilestonePicker: true },
            full_auto: { showsMilestonePicker: false },
        };
        const showing = Object.entries(configs).filter(([_, v]) => v.showsMilestonePicker);
        assert.strictEqual(showing.length, 1);
        assert.strictEqual(showing[0][0], 'selective');
    });
    test('every mode has an icon', () => {
        const icons = {
            every_milestone: '\u23F8',
            major_milestone: '\u23EF',
            selective: '\u2705',
            full_auto: '\u26A1',
        };
        for (const [mode, icon] of Object.entries(icons)) {
            assert.ok(icon.length > 0, `Mode ${mode} missing icon`);
        }
    });
    test('execution mode labels match mode names', () => {
        const labels = {
            every_milestone: 'Every Milestone',
            major_milestone: 'Major Milestones',
            selective: 'Selective',
            full_auto: 'Full Auto',
        };
        assert.strictEqual(labels.every_milestone, 'Every Milestone');
        assert.strictEqual(labels.full_auto, 'Full Auto');
    });
});
//# sourceMappingURL=executionMode.test.js.map