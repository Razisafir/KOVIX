/*---------------------------------------------------------------------------------------------
 *  Construct IDE - GitService Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { GitService } from '../../../src/construct/services/GitService';
import { TerminalExecutor } from '../../../src/construct/services/TerminalExecutor';

// Mock TerminalExecutor
jest.mock('../../../src/construct/services/TerminalExecutor');

describe('GitService', () => {
	let service: GitService;
	let mockRun: jest.MockedFunction<TerminalExecutor['run']>;

	beforeEach(() => {
		const terminal = new TerminalExecutor();
		mockRun = terminal.run as jest.MockedFunction<typeof terminal.run>;
		service = new GitService(terminal, '/workspace');
		jest.clearAllMocks();
	});

	describe('getStatus', () => {
		test('parses git status porcelain v2 output', async () => {
			mockRun.mockResolvedValue({
				stdout: '# branch.head main\n1 M. N... 100644 100644 100644 abc123 def456 src/main.ts\n? untracked.txt\n',
				stderr: '',
				exitCode: 0,
			});

			const status = await service.getStatus();
			expect(status.branch).toBe('main');
			expect(status.staged).toContain('src/main.ts');
			expect(status.untracked).toContain('untracked.txt');
		});

		test('throws GitError on failure', async () => {
			mockRun.mockResolvedValue({
				stdout: '',
				stderr: 'not a git repository',
				exitCode: 128,
			});

			await expect(service.getStatus()).rejects.toThrow('git status failed');
		});
	});

	describe('add', () => {
		test('stages specified files', async () => {
			mockRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			await service.add(['src/main.ts', 'src/util.ts']);
			expect(mockRun).toHaveBeenCalledWith('git', ['add', 'src/main.ts', 'src/util.ts'], expect.any(Object));
		});
	});

	describe('addAll', () => {
		test('stages all changes', async () => {
			mockRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			await service.addAll();
			expect(mockRun).toHaveBeenCalledWith('git', ['add', '-A'], expect.any(Object));
		});
	});

	describe('commit', () => {
		test('creates a commit and returns hash', async () => {
			mockRun.mockResolvedValue({
				stdout: '[main abc1234] feat: add new feature\n 2 files changed, 10 insertions(+)\n',
				stderr: '',
				exitCode: 0,
			});

			const result = await service.commit('feat: add new feature');
			expect(result.success).toBe(true);
			expect(result.hash).toBe('abc1234');
		});

		test('returns failure on empty commit', async () => {
			mockRun.mockResolvedValue({
				stdout: '',
				stderr: 'nothing to commit',
				exitCode: 1,
			});

			const result = await service.commit('empty');
			expect(result.success).toBe(false);
		});
	});

	describe('undoLastCommit', () => {
		test('performs soft reset to HEAD~1', async () => {
			mockRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			await service.undoLastCommit();
			expect(mockRun).toHaveBeenCalledWith('git', ['reset', '--soft', 'HEAD~1'], expect.any(Object));
		});
	});

	describe('revertFile', () => {
		test('reverts file to HEAD state', async () => {
			mockRun.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
			await service.revertFile('src/main.ts');
			expect(mockRun).toHaveBeenCalledWith('git', ['checkout', 'HEAD', '--', 'src/main.ts'], expect.any(Object));
		});
	});

	describe('getLastCommitFiles', () => {
		test('returns list of changed files', async () => {
			mockRun.mockResolvedValue({
				stdout: 'src/main.ts\nsrc/util.ts\n',
				stderr: '',
				exitCode: 0,
			});

			const files = await service.getLastCommitFiles();
			expect(files).toEqual(['src/main.ts', 'src/util.ts']);
		});
	});
});
