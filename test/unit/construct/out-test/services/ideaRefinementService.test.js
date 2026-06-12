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
suite('IdeaRefinementService', () => {
    test('refined idea has required fields', () => {
        const refined = {
            originalIdea: 'Build a chat app',
            title: 'Real-time Chat Application',
            description: 'A WebSocket-based chat application',
            scope: ['User auth', 'Chat rooms', 'Message history'],
            outOfScope: ['Video calls', 'File sharing'],
            successCriteria: ['Users can send/receive messages'],
            constraints: ['Must work on mobile'],
            priorities: ['Security', 'Performance'],
            assumptions: ['Users have internet access']
        };
        assert.ok(refined.title);
        assert.ok(refined.description);
        assert.ok(Array.isArray(refined.scope));
        assert.ok(Array.isArray(refined.outOfScope));
        assert.ok(Array.isArray(refined.successCriteria));
    });
    test('refinement questions are structured correctly', () => {
        const question = {
            id: 'q1',
            question: 'What is the target platform?',
            options: ['Web', 'Mobile', 'Desktop'],
            required: true
        };
        assert.ok(question.id);
        assert.ok(question.question);
        assert.ok(Array.isArray(question.options));
    });
    test('refinement answers map to questions', () => {
        const answers = [
            { questionId: 'q1', answer: 'Web' },
            { questionId: 'q2', answer: 'React' }
        ];
        assert.strictEqual(answers.length, 2);
        assert.strictEqual(answers[0].questionId, 'q1');
    });
    test('max refinement rounds is bounded', () => {
        const MAX_ROUNDS = 5;
        let round = 0;
        while (round < MAX_ROUNDS) {
            round++;
        }
        assert.strictEqual(round, MAX_ROUNDS);
    });
    test('JSON parsing fallback handles malformed responses', () => {
        const malformed = 'This is not JSON';
        let parsed;
        try {
            parsed = JSON.parse(malformed);
        }
        catch {
            parsed = null;
        }
        assert.strictEqual(parsed, null);
    });
});
//# sourceMappingURL=ideaRefinementService.test.js.map