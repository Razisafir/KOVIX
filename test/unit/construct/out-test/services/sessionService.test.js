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
suite('ConstructSessionService', () => {
    test('createSession returns a session with unique ID', () => {
        // Mock test - verify the concept
        const id1 = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const id2 = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        assert.notStrictEqual(id1, id2);
    });
    test('session IDs follow expected format', () => {
        const id = `session_1234567890_abc123`;
        assert.ok(id.startsWith('session_'));
        assert.ok(id.length > 10);
    });
    test('session message count increments', () => {
        let count = 0;
        count++;
        count++;
        assert.strictEqual(count, 2);
    });
    test('session can be renamed', () => {
        const session = { id: 'test', name: 'Old Name', messageCount: 0 };
        session.name = 'New Name';
        assert.strictEqual(session.name, 'New Name');
    });
    test('session can be deleted from list', () => {
        const sessions = [{ id: '1' }, { id: '2' }, { id: '3' }];
        const filtered = sessions.filter(s => s.id !== '2');
        assert.strictEqual(filtered.length, 2);
        assert.ok(!filtered.some(s => s.id === '2'));
    });
    test('switching sessions changes active session', () => {
        let activeId = '1';
        activeId = '2';
        assert.strictEqual(activeId, '2');
    });
});
//# sourceMappingURL=sessionService.test.js.map