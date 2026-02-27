import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';

type RunMode = 'development' | 'production';
type UpdateSource = 'manual' | 'auto';

const DEFAULT_INTERVAL_MINUTES = 10;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 720;
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const LONG_TIMEOUT_MS = 20 * 60 * 1000;

interface UpdateSettings {
    intervalMinutes: number;
    autoUpdateEnabled: boolean;
}

interface ChangelogSummary {
    latestTitle: string | null;
    latestBody: string | null;
}

interface CommitSnapshot {
    full: string | null;
    short: string | null;
    date: string | null;
    subject: string | null;
    version: string | null;
}

interface UpdateState {
    isChecking: boolean;
    isUpdating: boolean;
    hasUpdate: boolean;
    current: CommitSnapshot;
    remote: CommitSnapshot;
    changelog: ChangelogSummary;
    lastCheckedAt: string | null;
    lastUpdatedAt: string | null;
    lastAutoUpdatedAt: string | null;
    lastError: string | null;
}

export interface UpdateStatusPayload {
    runMode: RunMode;
    branch: string;
    settings: UpdateSettings;
    autoUpdateActive: boolean;
    state: UpdateState;
}

export class UpdateServiceError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(message: string, code: string, status = 400) {
        super(message);
        this.name = 'UpdateServiceError';
        this.code = code;
        this.status = status;
    }
}

function normalizeRunMode(raw: string | undefined): RunMode {
    return String(raw || '').trim().toLowerCase() === 'production' ? 'production' : 'development';
}

function nowIso(): string {
    return new Date().toISOString();
}

function clampNumber(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function normalizeInterval(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return clampNumber(parsed, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return fallback;
}

function safeTrim(value: string | Buffer | undefined): string {
    if (typeof value === 'string') return value.trim();
    if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
    return '';
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || 'Unknown error');
}

function isGitAuthError(message: string): boolean {
    const lowered = message.toLowerCase();
    return lowered.includes('could not read username')
        || lowered.includes('permission denied (publickey)')
        || lowered.includes('authentication failed')
        || lowered.includes('repository not found');
}

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            args,
            {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 10 * 1024 * 1024,
                env: process.env,
            },
            (error, stdout, stderr) => {
                const stdoutText = safeTrim(stdout);
                const stderrText = safeTrim(stderr);

                if (error) {
                    const details = [stderrText, stdoutText, error.message].filter(Boolean).join('\n').trim();
                    reject(new Error(details || 'Command failed'));
                    return;
                }

                resolve(stdoutText);
            },
        );
    });
}

function parseChangelog(markdown: string): ChangelogSummary {
    const lines = markdown.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => line.startsWith('## '));

    if (headingIndex === -1) {
        return {
            latestTitle: null,
            latestBody: null,
        };
    }

    const latestTitle = lines[headingIndex]?.replace(/^##\s+/, '').trim() || null;
    const body: string[] = [];

    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        const line = lines[index] || '';
        if (line.startsWith('## ')) break;
        body.push(line);
    }

    const latestBody = body
        .join('\n')
        .trim()
        .slice(0, 4000) || null;

    return {
        latestTitle,
        latestBody,
    };
}

function parseVersionFromPackage(rawContent: string): string | null {
    try {
        const parsed = JSON.parse(rawContent) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.trim()) {
            return parsed.version.trim();
        }
        return null;
    } catch {
        return null;
    }
}

class UpdateService {
    private runMode: RunMode;

    private readonly serverRoot: string;

    private readonly repoRoot: string;

    private readonly settingsPath: string;

    private branch = '';

    private initialized = false;

    private initPromise: Promise<void> | null = null;

    private autoTimer: NodeJS.Timeout | null = null;

    private settings: UpdateSettings;

    private state: UpdateState = {
        isChecking: false,
        isUpdating: false,
        hasUpdate: false,
        current: {
            full: null,
            short: null,
            date: null,
            subject: null,
            version: null,
        },
        remote: {
            full: null,
            short: null,
            date: null,
            subject: null,
            version: null,
        },
        changelog: {
            latestTitle: null,
            latestBody: null,
        },
        lastCheckedAt: null,
        lastUpdatedAt: null,
        lastAutoUpdatedAt: null,
        lastError: null,
    };

    constructor() {
        this.runMode = 'development';
        this.serverRoot = process.cwd();
        this.repoRoot = path.resolve(this.serverRoot, '..');
        this.settingsPath = path.resolve(this.serverRoot, 'data', 'update-settings.json');

        this.settings = {
            intervalMinutes: DEFAULT_INTERVAL_MINUTES,
            autoUpdateEnabled: false,
        };
    }

    async start(): Promise<void> {
        await this.ensureInitialized();
    }

    async getStatus(): Promise<UpdateStatusPayload> {
        await this.ensureInitialized();
        return this.snapshot();
    }

    async checkForUpdates(_source: UpdateSource): Promise<UpdateStatusPayload> {
        await this.ensureInitialized();

        if (this.state.isChecking) {
            return this.snapshot();
        }

        this.state.isChecking = true;
        this.state.lastError = null;

        try {
            await this.refreshRemoteSnapshot();
            this.state.lastCheckedAt = nowIso();
            return this.snapshot();
        } catch (error) {
            const message = toErrorMessage(error);
            this.state.lastError = message;
            this.state.lastCheckedAt = nowIso();

            if (isGitAuthError(message)) {
                throw new UpdateServiceError(
                    'Git authorization is required on server to check updates.',
                    'GIT_AUTH_REQUIRED',
                    500,
                );
            }

            throw new UpdateServiceError(message || 'Failed to check updates.', 'UPDATE_CHECK_FAILED', 500);
        } finally {
            this.state.isChecking = false;
        }
    }

    async applyUpdate(source: UpdateSource): Promise<UpdateStatusPayload> {
        await this.ensureInitialized();

        if (source === 'auto' && this.runMode !== 'production') {
            return this.snapshot();
        }

        if (this.state.isUpdating) {
            throw new UpdateServiceError('Update is already running.', 'UPDATE_IN_PROGRESS', 409);
        }

        this.state.isUpdating = true;
        this.state.lastError = null;

        try {
            const branch = await this.resolveBranch();
            await this.refreshRemoteSnapshot();

            if (!this.state.hasUpdate) {
                return this.snapshot();
            }

            await this.ensureCleanWorktree();
            await this.runUpdatePipeline(branch);
            await this.refreshLocalSnapshot();

            this.state.lastUpdatedAt = nowIso();
            if (source === 'auto') {
                this.state.lastAutoUpdatedAt = this.state.lastUpdatedAt;
            }

            this.queuePm2Restart();
            return this.snapshot();
        } catch (error) {
            const message = toErrorMessage(error);
            this.state.lastError = message;

            if (isGitAuthError(message)) {
                throw new UpdateServiceError(
                    'Git authorization is required on server to pull updates.',
                    'GIT_AUTH_REQUIRED',
                    500,
                );
            }

            if (message.toLowerCase().includes('local changes')) {
                throw new UpdateServiceError(
                    'Local changes detected in repository. Update canceled.',
                    'DIRTY_WORKTREE',
                    409,
                );
            }

            throw new UpdateServiceError(message || 'Update failed.', 'UPDATE_APPLY_FAILED', 500);
        } finally {
            this.state.isUpdating = false;
        }
    }

    async updateSettings(payload: {
        intervalMinutes?: unknown;
        autoUpdateEnabled?: unknown;
    }): Promise<UpdateStatusPayload> {
        await this.ensureInitialized();

        const nextInterval = normalizeInterval(payload.intervalMinutes, this.settings.intervalMinutes);
        const nextAuto = normalizeBoolean(payload.autoUpdateEnabled, this.settings.autoUpdateEnabled);

        this.settings = {
            intervalMinutes: nextInterval,
            autoUpdateEnabled: this.runMode === 'production' ? nextAuto : false,
        };

        this.persistSettings();
        this.restartScheduler();

        return this.snapshot();
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.initPromise) {
            this.initPromise = this.initializeInternal().catch((error) => {
                this.initPromise = null;
                throw error;
            });
        }

        await this.initPromise;
    }

    private async initializeInternal(): Promise<void> {
        this.runMode = normalizeRunMode(process.env.RUN_MODE);
        await this.loadSettings();
        await this.refreshLocalSnapshot();
        this.restartScheduler();
        this.initialized = true;
    }

    private snapshot(): UpdateStatusPayload {
        return {
            runMode: this.runMode,
            branch: this.branch,
            settings: {
                intervalMinutes: this.settings.intervalMinutes,
                autoUpdateEnabled: this.settings.autoUpdateEnabled,
            },
            autoUpdateActive: this.runMode === 'production' && this.settings.autoUpdateEnabled,
            state: {
                ...this.state,
                current: { ...this.state.current },
                remote: { ...this.state.remote },
                changelog: { ...this.state.changelog },
            },
        };
    }

    private async loadSettings(): Promise<void> {
        const defaults: UpdateSettings = {
            intervalMinutes: DEFAULT_INTERVAL_MINUTES,
            autoUpdateEnabled: this.runMode === 'production',
        };

        if (!fs.existsSync(this.settingsPath)) {
            this.settings = defaults;
            this.persistSettings();
            return;
        }

        try {
            const raw = fs.readFileSync(this.settingsPath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<UpdateSettings>;

            this.settings = {
                intervalMinutes: normalizeInterval(parsed.intervalMinutes, defaults.intervalMinutes),
                autoUpdateEnabled: this.runMode === 'production'
                    ? normalizeBoolean(parsed.autoUpdateEnabled, defaults.autoUpdateEnabled)
                    : false,
            };
        } catch {
            this.settings = defaults;
        }

        this.persistSettings();
    }

    private persistSettings(): void {
        const dirPath = path.dirname(this.settingsPath);
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    }

    private async resolveBranch(): Promise<string> {
        if (this.branch) return this.branch;

        const override = String(process.env.UPDATE_BRANCH || '').trim();
        if (override) {
            this.branch = override;
            return this.branch;
        }

        const currentBranch = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], this.repoRoot);
        const normalizedBranch = (currentBranch || '').trim();
        this.branch = (!normalizedBranch || normalizedBranch === 'HEAD' || normalizedBranch === 'master')
            ? 'main'
            : normalizedBranch;
        return this.branch;
    }

    private async getCommitSnapshot(ref: string): Promise<CommitSnapshot> {
        const output = await runCommand(
            'git',
            ['log', '-1', '--format=%H%n%h%n%cI%n%s', ref],
            this.repoRoot,
        );

        const [fullRaw, shortRaw, dateRaw, subjectRaw] = output.split('\n');

        return {
            full: fullRaw || null,
            short: shortRaw || null,
            date: dateRaw || null,
            subject: subjectRaw || null,
            version: null,
        };
    }

    private readLocalVersion(): string | null {
        const packagePath = path.resolve(this.repoRoot, 'client', 'package.json');
        if (!fs.existsSync(packagePath)) return null;

        const content = fs.readFileSync(packagePath, 'utf8');
        return parseVersionFromPackage(content);
    }

    private async readRemoteVersion(branch: string): Promise<string | null> {
        const content = await runCommand(
            'git',
            ['show', `origin/${branch}:client/package.json`],
            this.repoRoot,
        );

        return parseVersionFromPackage(content);
    }

    private readLocalChangelog(): ChangelogSummary {
        const changelogPath = path.resolve(this.repoRoot, 'CHANGELOG.md');
        if (!fs.existsSync(changelogPath)) {
            return {
                latestTitle: null,
                latestBody: null,
            };
        }

        const content = fs.readFileSync(changelogPath, 'utf8');
        return parseChangelog(content);
    }

    private async readRemoteChangelog(branch: string): Promise<ChangelogSummary> {
        const content = await runCommand(
            'git',
            ['show', `origin/${branch}:CHANGELOG.md`],
            this.repoRoot,
        );

        return parseChangelog(content);
    }

    private async refreshLocalSnapshot(): Promise<void> {
        const branch = await this.resolveBranch();
        const current = await this.getCommitSnapshot('HEAD');
        current.version = this.readLocalVersion();

        this.state.current = current;
        this.state.remote = {
            full: null,
            short: null,
            date: null,
            subject: null,
            version: null,
        };
        this.state.hasUpdate = false;
        this.state.changelog = this.readLocalChangelog();
        this.branch = branch;
    }

    private async refreshRemoteSnapshot(): Promise<void> {
        const branch = await this.resolveBranch();

        await runCommand('git', ['fetch', 'origin', branch], this.repoRoot, CHECK_TIMEOUT_MS);

        const current = await this.getCommitSnapshot('HEAD');
        const remote = await this.getCommitSnapshot(`origin/${branch}`);

        current.version = this.readLocalVersion();
        remote.version = await this.readRemoteVersion(branch);

        this.state.current = current;
        this.state.remote = remote;
        this.state.hasUpdate = Boolean(current.full && remote.full && current.full !== remote.full);

        if (this.state.hasUpdate) {
            try {
                this.state.changelog = await this.readRemoteChangelog(branch);
            } catch {
                this.state.changelog = this.readLocalChangelog();
            }
        } else {
            this.state.changelog = this.readLocalChangelog();
        }
    }

    private async ensureCleanWorktree(): Promise<void> {
        const status = await runCommand('git', ['status', '--porcelain'], this.repoRoot);
        if (status.trim()) {
            throw new Error('Local changes detected in repository.');
        }
    }

    private async runUpdatePipeline(branch: string): Promise<void> {
        const serverDir = path.resolve(this.repoRoot, 'server');
        const clientDir = path.resolve(this.repoRoot, 'client');
        const botDir = path.resolve(this.repoRoot, 'bot');

        await runCommand('git', ['pull', '--ff-only', 'origin', branch], this.repoRoot, LONG_TIMEOUT_MS);

        if (fs.existsSync(clientDir)) {
            await runCommand('npm', ['ci'], clientDir, LONG_TIMEOUT_MS);
        }

        if (fs.existsSync(serverDir)) {
            await runCommand('npm', ['ci'], serverDir, LONG_TIMEOUT_MS);
            await runCommand('npm', ['run', 'prisma:generate'], serverDir, LONG_TIMEOUT_MS);
            await runCommand('npm', ['run', 'prisma:migrate'], serverDir, LONG_TIMEOUT_MS);
            await runCommand('npm', ['run', 'build'], serverDir, LONG_TIMEOUT_MS);
        }

        if (fs.existsSync(clientDir)) {
            await runCommand('npm', ['run', 'build'], clientDir, LONG_TIMEOUT_MS);
        }

        if (fs.existsSync(botDir)) {
            const botPackageJson = path.resolve(botDir, 'package.json');
            if (fs.existsSync(botPackageJson)) {
                await runCommand('npm', ['ci'], botDir, LONG_TIMEOUT_MS);
            }

            const requirementsPath = path.resolve(botDir, 'requirements.txt');
            if (fs.existsSync(requirementsPath)) {
                const venvPip = path.resolve(botDir, '.venv', 'bin', 'pip');
                if (fs.existsSync(venvPip)) {
                    await runCommand(venvPip, ['install', '-r', 'requirements.txt'], botDir, LONG_TIMEOUT_MS);
                } else {
                    await runCommand('python3', ['-m', 'pip', 'install', '-r', 'requirements.txt'], botDir, LONG_TIMEOUT_MS);
                }
            }
        }
    }

    private getPm2Apps(): string[] {
        const fromEnv = String(process.env.PM2_UPDATE_APPS || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

        if (fromEnv.length > 0) {
            return fromEnv;
        }

        if (this.runMode === 'production') {
            return ['nfttoys-prod-api', 'nfttoys-prod-web', 'nfttoys-prod-bot'];
        }

        return ['nfttoys-dev-api', 'nfttoys-dev-web', 'nfttoys-dev-bot'];
    }

    private queuePm2Restart(): void {
        const apps = this.getPm2Apps();
        if (apps.length === 0) {
            return;
        }

        const restartCommands = apps
            .map((appName) => `pm2 restart ${quoteForShell(appName)} || true`)
            .join('; ');

        const command = `${restartCommands}; pm2 save || true`;

        const child = spawn('bash', ['-lc', command], {
            cwd: this.repoRoot,
            detached: true,
            stdio: 'ignore',
            env: process.env,
        });

        child.unref();
    }

    private restartScheduler(): void {
        if (this.autoTimer) {
            clearInterval(this.autoTimer);
            this.autoTimer = null;
        }

        if (this.runMode !== 'production' || !this.settings.autoUpdateEnabled) {
            return;
        }

        const intervalMs = this.settings.intervalMinutes * 60 * 1000;

        this.autoTimer = setInterval(() => {
            void this.runAutoCycle();
        }, intervalMs);
    }

    private async runAutoCycle(): Promise<void> {
        if (this.state.isChecking || this.state.isUpdating) {
            return;
        }

        try {
            await this.checkForUpdates('auto');
            if (this.state.hasUpdate) {
                await this.applyUpdate('auto');
            }
        } catch (error) {
            const message = toErrorMessage(error);
            this.state.lastError = message;
            console.error('Auto update cycle failed:', error);
        }
    }
}

const updateService = new UpdateService();

export function getUpdateService(): UpdateService {
    return updateService;
}

export async function startUpdateService(): Promise<void> {
    await updateService.start();
}
