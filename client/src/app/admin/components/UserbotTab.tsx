'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    IoAlertCircle,
    IoCheckmarkCircle,
    IoCall,
    IoRefresh,
    IoShieldCheckmark,
    IoCloseCircle,
    IoWifi,
} from 'react-icons/io5';

import { Button } from '@/components/ui/Button';
import { AdminUserbotSessionData, api } from '@/lib/api';
import styles from '../page.module.css';

type UserbotFlowStep = 'idle' | 'phone' | 'code' | '2fa' | 'loading';

function formatDate(value: string | null): string {
    if (!value) return '-';
    try {
        return new Date(value).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return value;
    }
}

function statusLabel(status: string): string {
    switch (status) {
        case 'active': return 'Active';
        case 'inactive': return 'Inactive';
        case 'awaiting_code': return 'Awaiting SMS code';
        case 'awaiting_2fa': return 'Awaiting 2FA password';
        case 'error': return 'Error';
        default: return status;
    }
}

function statusColor(status: string): string {
    switch (status) {
        case 'active': return '#22c55e';
        case 'error': return '#ef4444';
        case 'awaiting_code':
        case 'awaiting_2fa': return '#f59e0b';
        default: return '#6b7280';
    }
}

export function AdminUserbotTab() {
    const [session, setSession] = useState<AdminUserbotSessionData | null>(null);
    const [schemaReady, setSchemaReady] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Flow state
    const [flowStep, setFlowStep] = useState<UserbotFlowStep>('idle');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [pendingSessionId, setPendingSessionId] = useState('');

    // Story boost stats
    const [boostStats, setBoostStats] = useState<{ totalShares: number; activeBoosts: number; verifiedShares: number } | null>(null);

    const loadSession = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const [sessionRes, statsRes] = await Promise.all([
                api.admin.userbotSession(),
                api.admin.storyBoostStats().catch(() => null),
            ]);

            setSession(sessionRes.session);
            setSchemaReady(sessionRes.schemaReady);

            if (statsRes?.stats) {
                setBoostStats(statsRes.stats);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSession();
    }, [loadSession]);

    const handleInitLogin = useCallback(async () => {
        if (!phone.trim()) {
            setError('Phone number is required');
            return;
        }

        setFlowStep('loading');
        setError('');
        setSuccess('');

        try {
            const res = await api.admin.userbotInit(phone.trim());
            setPendingSessionId(res.sessionId);
            setFlowStep('code');
            setSuccess('SMS code sent. Enter it below.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to send code');
            setFlowStep('phone');
        }
    }, [phone]);

    const handleVerifyCode = useCallback(async () => {
        if (!code.trim()) {
            setError('Code is required');
            return;
        }

        setFlowStep('loading');
        setError('');
        setSuccess('');

        try {
            const res = await api.admin.userbotVerify({
                sessionId: pendingSessionId,
                code: code.trim(),
            });

            if (res.requires2fa) {
                setFlowStep('2fa');
                setSuccess('2FA password required.');
                return;
            }

            setFlowStep('idle');
            setSuccess('Userbot authenticated successfully!');
            setCode('');
            setPhone('');
            await loadSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Verification failed');
            setFlowStep('code');
        }
    }, [code, loadSession, pendingSessionId]);

    const handleVerify2fa = useCallback(async () => {
        if (!password) {
            setError('2FA password is required');
            return;
        }

        setFlowStep('loading');
        setError('');
        setSuccess('');

        try {
            await api.admin.userbotVerify({
                sessionId: pendingSessionId,
                password,
            });

            setFlowStep('idle');
            setSuccess('Userbot authenticated with 2FA!');
            setPassword('');
            setCode('');
            setPhone('');
            await loadSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : '2FA verification failed');
            setFlowStep('2fa');
        }
    }, [loadSession, password, pendingSessionId]);

    const handleDisconnect = useCallback(async () => {
        if (!session) return;

        setError('');
        setSuccess('');

        try {
            await api.admin.userbotDisconnect(session.id);
            setSuccess('Userbot disconnected.');
            await loadSession();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Disconnect failed');
        }
    }, [loadSession, session]);

    if (isLoading) {
        return (
            <div className={styles.loadingSpinner}>
                <div className={styles.spinner} />
            </div>
        );
    }

    if (!schemaReady) {
        return (
            <div className={styles.updatesCard}>
                <div className={styles.error}>
                    <IoAlertCircle size={18} />
                    <span>Userbot schema not ready. Run database migrations first.</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.dbSection}>
            {/* Current Session Status */}
            <div className={styles.updatesCard}>
                <div className={styles.updatesHeadline}>
                    <h3>
                        <IoWifi size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                        Userbot Session
                    </h3>
                    <button
                        type="button"
                        className={styles.iconActionBtn}
                        onClick={() => void loadSession()}
                        aria-label="Refresh"
                    >
                        <IoRefresh size={16} />
                    </button>
                </div>

                {session ? (
                    <div className={styles.updatesMetaGrid}>
                        <div className={styles.updatesMetaItem}>
                            <span>Phone</span>
                            <strong>{session.phone}</strong>
                        </div>
                        <div className={styles.updatesMetaItem}>
                            <span>Status</span>
                            <strong style={{ color: statusColor(session.status) }}>
                                {statusLabel(session.status)}
                            </strong>
                        </div>
                        {session.errorMessage && (
                            <div className={styles.updatesMetaItem}>
                                <span>Error</span>
                                <strong style={{ color: '#ef4444' }}>{session.errorMessage}</strong>
                            </div>
                        )}
                        <div className={styles.updatesMetaItem}>
                            <span>Last active</span>
                            <strong>{formatDate(session.lastActiveAt)}</strong>
                        </div>
                        <div className={styles.updatesMetaItem}>
                            <span>Created</span>
                            <strong>{formatDate(session.createdAt)}</strong>
                        </div>
                        {session.status === 'active' && (
                            <div className={styles.updatesMetaItem}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleDisconnect()}
                                    style={{ color: '#ef4444', width: '100%' }}
                                >
                                    <IoCloseCircle size={14} style={{ marginRight: 4 }} />
                                    Disconnect
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className={styles.updatesHint}>
                        No userbot session configured. Set up below.
                    </p>
                )}
            </div>

            {/* Story Boost Stats */}
            {boostStats && (
                <div className={styles.updatesCard}>
                    <h3>
                        <IoShieldCheckmark size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                        Story Boost Stats
                    </h3>
                    <div className={styles.dbStatsGrid}>
                        <div className={styles.dbStatCard}>
                            <div className={styles.dbStatContent}>
                                <span className={styles.dbStatValue}>{boostStats.totalShares}</span>
                                <span className={styles.dbStatLabel}>Total shares</span>
                            </div>
                        </div>
                        <div className={styles.dbStatCard}>
                            <div className={styles.dbStatContent}>
                                <span className={styles.dbStatValue}>{boostStats.activeBoosts}</span>
                                <span className={styles.dbStatLabel}>Active boosts</span>
                            </div>
                        </div>
                        <div className={styles.dbStatCard}>
                            <div className={styles.dbStatContent}>
                                <span className={styles.dbStatValue}>{boostStats.verifiedShares}</span>
                                <span className={styles.dbStatLabel}>Verified</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Auth Flow */}
            {(!session || session.status !== 'active') && (
                <div className={styles.updatesCard}>
                    <h3>
                        <IoCall size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                        Connect Telegram Account
                    </h3>

                    {error && (
                        <div className={styles.error}>
                            <IoAlertCircle size={14} />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className={styles.dbResultBox} style={{ borderColor: 'rgba(34, 197, 94, 0.3)' }}>
                            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e' }}>
                                <IoCheckmarkCircle size={14} />
                                {success}
                            </strong>
                        </div>
                    )}

                    {(flowStep === 'idle' || flowStep === 'phone') && (
                        <div className={styles.field}>
                            <label>Phone number</label>
                            <input
                                type="tel"
                                placeholder="+998901234567"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className={styles.input}
                                style={{ fontFamily: 'monospace' }}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleInitLogin()}
                                disabled={!phone.trim()}
                            >
                                Send SMS Code
                            </Button>
                        </div>
                    )}

                    {flowStep === 'code' && (
                        <div className={styles.field}>
                            <label>SMS code</label>
                            <input
                                type="text"
                                placeholder="12345"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                className={styles.input}
                                style={{ fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center' }}
                                maxLength={6}
                                autoFocus
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleVerifyCode()}
                                disabled={!code.trim()}
                            >
                                Verify Code
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setFlowStep('phone');
                                    setCode('');
                                    setError('');
                                    setSuccess('');
                                }}
                            >
                                Back
                            </Button>
                        </div>
                    )}

                    {flowStep === '2fa' && (
                        <div className={styles.field}>
                            <label>2FA password</label>
                            <input
                                type="password"
                                placeholder="2FA password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={styles.input}
                                autoFocus
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleVerify2fa()}
                                disabled={!password}
                            >
                                Verify 2FA
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setFlowStep('phone');
                                    setPassword('');
                                    setError('');
                                    setSuccess('');
                                }}
                            >
                                Start Over
                            </Button>
                        </div>
                    )}

                    {flowStep === 'loading' && (
                        <div className={styles.loadingSpinner}>
                            <div className={styles.spinner} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
