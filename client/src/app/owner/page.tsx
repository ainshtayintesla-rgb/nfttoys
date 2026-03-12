'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { apiFetch } from '@/lib/api';
import { useTelegram } from '@/lib/context/TelegramContext';
import styles from './page.module.css';

const OWNER_TG_ID = process.env.NEXT_PUBLIC_OWNER_TELEGRAM_ID?.trim() || '';

type OwnerTab = 'admins' | 'health' | 'users' | 'info';

interface AdminAccount {
    id: string;
    telegramId: string;
    login: string;
    createdAt: string;
    lastLoginAt: string | null;
}

interface HealthData {
    status: string;
    dbPingMs: number | null;
    uptimeSeconds: number;
    nodeVersion: string;
    memMb: number;
    timestamp: string;
}

interface UserRow {
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string | null;
    nftCount: number;
    createdAt: string;
    lastLoginAt: string | null;
    walletAddress: string | null;
}

interface InfoData {
    users: number;
    nfts: number;
    admins: number;
    qrCodes: number;
    nodeVersion: string;
    uptimeSeconds: number;
    memMb: number;
    env: string;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// ── Admins Tab ─────────────────────────────────────────────────────────────────

function AdminsTab() {
    const [admins, setAdmins] = useState<AdminAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [addTgId, setAddTgId] = useState('');
    const [addLoading, setAddLoading] = useState(false);
    const [addResult, setAddResult] = useState<{ login: string; password: string } | null>(null);
    const [addError, setAddError] = useState('');
    const [resetResult, setResetResult] = useState<{ login: string; password: string } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await apiFetch<{ admins: AdminAccount[] }>('/owner/admins');
            setAdmins(data.admins);
        } catch {
            setError('Failed to load admins');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async () => {
        const tgId = addTgId.trim();
        if (!tgId || !/^\d{5,}$/.test(tgId)) {
            setAddError('Enter a valid numeric Telegram ID (min 5 digits)');
            return;
        }
        setAddLoading(true);
        setAddError('');
        setAddResult(null);
        try {
            const data = await apiFetch<{ admin: AdminAccount; tempPassword: string }>('/owner/admins', {
                method: 'POST',
                body: JSON.stringify({ telegramId: tgId }),
            });
            setAddResult({ login: data.admin.login, password: data.tempPassword });
            setAddTgId('');
            load();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to add admin';
            setAddError(msg);
        } finally {
            setAddLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Remove this admin?')) return;
        try {
            await apiFetch(`/owner/admins/${id}`, { method: 'DELETE' });
            load();
        } catch {
            alert('Failed to remove admin');
        }
    };

    const handleReset = async (id: string) => {
        if (!confirm('Reset credentials for this admin?')) return;
        try {
            const data = await apiFetch<{ login: string; tempPassword: string }>(`/owner/admins/${id}/reset`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            setResetResult({ login: data.login, password: data.tempPassword });
        } catch {
            alert('Failed to reset admin credentials');
        }
    };

    return (
        <div className={styles.tabContent}>
            <div className={styles.card}>
                <div className={styles.cardTitle}>Add Admin</div>
                <div className={styles.addRow}>
                    <input
                        className={styles.input}
                        type="text"
                        inputMode="numeric"
                        placeholder="Telegram User ID"
                        value={addTgId}
                        onChange={(e) => { setAddTgId(e.target.value); setAddError(''); }}
                    />
                    <Button onClick={handleAdd} disabled={addLoading} className={styles.addBtn}>
                        {addLoading ? '...' : 'Add'}
                    </Button>
                </div>
                {addError && <div className={styles.errorText}>{addError}</div>}
                {addResult && (
                    <div className={styles.credBox}>
                        <div>Login: <code>{addResult.login}</code></div>
                        <div>Password: <code>{addResult.password}</code></div>
                        <div className={styles.credNote}>Save these credentials — password won't be shown again.</div>
                    </div>
                )}
            </div>

            {resetResult && (
                <div className={styles.card}>
                    <div className={styles.cardTitle}>Reset Result</div>
                    <div className={styles.credBox}>
                        <div>Login: <code>{resetResult.login}</code></div>
                        <div>Password: <code>{resetResult.password}</code></div>
                        <div className={styles.credNote}>New credentials — save them now.</div>
                    </div>
                    <Button onClick={() => setResetResult(null)} className={styles.closeBtn}>Dismiss</Button>
                </div>
            )}

            <div className={styles.card}>
                <div className={styles.cardTitle}>
                    Admins
                    <button className={styles.refreshBtn} onClick={load}>↻</button>
                </div>
                {loading ? (
                    <div className={styles.spinner} />
                ) : error ? (
                    <div className={styles.errorText}>{error}</div>
                ) : admins.length === 0 ? (
                    <div className={styles.empty}>No admins yet</div>
                ) : (
                    <div className={styles.list}>
                        {admins.map((a) => (
                            <div key={a.id} className={styles.listRow}>
                                <div className={styles.listRowMain}>
                                    <div className={styles.listRowTitle}>{a.login}</div>
                                    <div className={styles.listRowSub}>TG: {a.telegramId}</div>
                                    <div className={styles.listRowSub}>
                                        Last login: {formatDate(a.lastLoginAt)}
                                    </div>
                                </div>
                                <div className={styles.listRowActions}>
                                    <button
                                        className={styles.iconBtn}
                                        onClick={() => handleReset(a.id)}
                                        title="Reset credentials"
                                    >
                                        ↺
                                    </button>
                                    <button
                                        className={`${styles.iconBtn} ${styles.dangerBtn}`}
                                        onClick={() => handleDelete(a.id)}
                                        title="Remove admin"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Health Tab ─────────────────────────────────────────────────────────────────

function HealthTab() {
    const [data, setData] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch<HealthData>('/owner/health');
            setData(res);
        } catch {
            setError('Health check failed');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className={styles.tabContent}>
            <div className={styles.card}>
                <div className={styles.cardTitle}>
                    System Health
                    <button className={styles.refreshBtn} onClick={load}>↻</button>
                </div>
                {loading ? (
                    <div className={styles.spinner} />
                ) : error ? (
                    <div className={styles.errorText}>{error}</div>
                ) : data ? (
                    <div className={styles.infoGrid}>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Status</span>
                            <span className={`${styles.infoValue} ${data.status === 'ok' ? styles.ok : styles.error}`}>
                                {data.status === 'ok' ? 'OK' : data.status}
                            </span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>DB Ping</span>
                            <span className={styles.infoValue}>
                                {data.dbPingMs !== null ? `${data.dbPingMs} ms` : '—'}
                            </span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Uptime</span>
                            <span className={styles.infoValue}>{formatUptime(data.uptimeSeconds)}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Memory</span>
                            <span className={styles.infoValue}>{data.memMb} MB</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Node</span>
                            <span className={styles.infoValue}>{data.nodeVersion}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Checked</span>
                            <span className={styles.infoValue}>{formatDate(data.timestamp)}</span>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// ── Users Tab ──────────────────────────────────────────────────────────────────

function UsersTab() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const limit = 30;

    const load = useCallback(async (q: string, off: number) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ limit: String(limit), offset: String(off) });
            if (q) params.set('search', q);
            const data = await apiFetch<{ users: UserRow[]; total: number }>(`/owner/users?${params}`);
            setUsers(data.users);
            setTotal(data.total);
        } catch {
            setError('Failed to load users');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(search, offset); }, [load, search, offset]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
        setOffset(0);
    };

    return (
        <div className={styles.tabContent}>
            <div className={styles.card}>
                <div className={styles.cardTitle}>
                    Users ({total})
                    <button className={styles.refreshBtn} onClick={() => load(search, offset)}>↻</button>
                </div>
                <input
                    className={`${styles.input} ${styles.searchInput}`}
                    type="text"
                    placeholder="Search by username, name, or Telegram ID..."
                    value={search}
                    onChange={handleSearch}
                />
                {loading ? (
                    <div className={styles.spinner} />
                ) : error ? (
                    <div className={styles.errorText}>{error}</div>
                ) : users.length === 0 ? (
                    <div className={styles.empty}>No users found</div>
                ) : (
                    <>
                        <div className={styles.list}>
                            {users.map((u) => (
                                <div key={u.id} className={styles.listRow}>
                                    <div className={styles.listRowMain}>
                                        <div className={styles.listRowTitle}>
                                            {u.username ? `@${u.username}` : u.firstName || '—'}
                                        </div>
                                        <div className={styles.listRowSub}>TG: {u.telegramId}</div>
                                        <div className={styles.listRowSub}>
                                            NFTs: {u.nftCount} · Joined: {formatDate(u.createdAt)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className={styles.pagination}>
                            <button
                                className={styles.pageBtn}
                                disabled={offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - limit))}
                            >
                                ← Prev
                            </button>
                            <span className={styles.pageInfo}>
                                {offset + 1}–{Math.min(offset + limit, total)} of {total}
                            </span>
                            <button
                                className={styles.pageBtn}
                                disabled={offset + limit >= total}
                                onClick={() => setOffset(offset + limit)}
                            >
                                Next →
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Info Tab ───────────────────────────────────────────────────────────────────

function InfoTab() {
    const [data, setData] = useState<InfoData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch<{ info: InfoData }>('/owner/info');
            setData(res.info);
        } catch {
            setError('Failed to load info');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className={styles.tabContent}>
            <div className={styles.card}>
                <div className={styles.cardTitle}>
                    System Info
                    <button className={styles.refreshBtn} onClick={load}>↻</button>
                </div>
                {loading ? (
                    <div className={styles.spinner} />
                ) : error ? (
                    <div className={styles.errorText}>{error}</div>
                ) : data ? (
                    <div className={styles.infoGrid}>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Users</span>
                            <span className={styles.infoValue}>{data.users}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>NFTs</span>
                            <span className={styles.infoValue}>{data.nfts}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Admins</span>
                            <span className={styles.infoValue}>{data.admins}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>QR Codes</span>
                            <span className={styles.infoValue}>{data.qrCodes}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Node</span>
                            <span className={styles.infoValue}>{data.nodeVersion}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Env</span>
                            <span className={styles.infoValue}>{data.env}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Uptime</span>
                            <span className={styles.infoValue}>{formatUptime(data.uptimeSeconds)}</span>
                        </div>
                        <div className={styles.infoRow}>
                            <span className={styles.infoLabel}>Memory</span>
                            <span className={styles.infoValue}>{data.memMb} MB</span>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OwnerPage() {
    const { user, ready, webApp } = useTelegram();
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [activeTab, setActiveTab] = useState<OwnerTab>('admins');

    const telegramUserId = user?.id || webApp?.initDataUnsafe?.user?.id;
    const isOwner = Boolean(OWNER_TG_ID && telegramUserId && String(telegramUserId) === OWNER_TG_ID);

    useEffect(() => {
        if (ready) {
            if (telegramUserId) {
                setIsCheckingAuth(false);
            } else {
                const timer = setTimeout(() => setIsCheckingAuth(false), 2000);
                return () => clearTimeout(timer);
            }
        }
    }, [ready, telegramUserId]);

    if (isCheckingAuth) {
        return (
            <div className={styles.container}>
                <div className={styles.centered}>
                    <div className={styles.spinner} />
                </div>
            </div>
        );
    }

    if (!isOwner) {
        if (typeof window !== 'undefined') {
            window.location.href = '/404';
        }
        return null;
    }

    return (
        <div className={styles.container}>
            <TelegramBackButton href="/profile" />
            <main className={styles.main}>
                <div className={styles.header}>
                    <span className={styles.headerTitle}>Owner Panel</span>
                </div>

                <SegmentedTabs<OwnerTab>
                    items={[
                        { key: 'admins', label: 'Admins' },
                        { key: 'health', label: 'Health' },
                        { key: 'users', label: 'Users' },
                        { key: 'info', label: 'Info' },
                    ]}
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    className={styles.tabs}
                    ariaLabel="Owner panel tabs"
                />

                {activeTab === 'admins' && <AdminsTab />}
                {activeTab === 'health' && <HealthTab />}
                {activeTab === 'users' && <UsersTab />}
                {activeTab === 'info' && <InfoTab />}
            </main>
        </div>
    );
}
