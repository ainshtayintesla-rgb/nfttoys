'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';

import { Navigation } from '@/components/layout/Navigation';
import { Button } from '@/components/ui/Button';
import { PEPE_MODELS } from '@/lib/data/pepe_models';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { AlertTriangle, CheckCircle, Clock, Database, Eye, QrCode, Shuffle, Sparkles, Trash2, UserX, X } from 'lucide-react';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { api } from '@/lib/api';
import { BalanceTopupTab } from './components/BalanceTopupTab';
import { AdminCustomSelect } from './components/AdminCustomSelect';
import { AdminUpdatesTab } from './components/UpdatesTab';
import styles from './page.module.css';

// Admin whitelist - Telegram IDs allowed to access admin
const ADMIN_IDS = process.env.NEXT_PUBLIC_ADMIN_IDS?.split(',') || [];
const MAX_BULK_GENERATION = 500;

type AdminTab = 'nft' | 'db' | 'topup' | 'updates';
type DbActionType = 'purgeNfts' | 'purgeUsers';

interface QRCodeData {
    id: string;
    nfcId: string;
    modelName: string;
    serialNumber: string;
    rarity: 'common' | 'rare' | 'legendary';
    status: 'created' | 'used';
    token: string;
    createdAt: string | null;
    usedAt: string | null;
    usedBy?: string;
}

interface GeneratedQRDraft {
    modelName: string;
    rarity: 'common' | 'rare' | 'legendary';
    serialNumber: number;
}

interface DbStats {
    nftCount: number;
    userCount: number;
    adminUsers: number;
}

interface DbActionConfig {
    title: string;
    description: string;
    confirmPhrase?: string;
    danger: boolean;
}

function getMaxSerialNumber(items: QRCodeData[]): number {
    return items.reduce((max, item) => {
        const serial = Number.parseInt(item.serialNumber, 10);
        if (Number.isNaN(serial)) return max;
        return Math.max(max, serial);
    }, 0);
}

function pickRandomItem<T>(items: T[]): T | null {
    if (items.length === 0) return null;
    const index = Math.floor(Math.random() * items.length);
    return items[index] || null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '';
}

export default function AdminPage() {
    const { t } = useLanguage();
    const { user, ready, webApp } = useTelegram();

    const [activeTab, setActiveTab] = useState<AdminTab>('nft');
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [selectedRarity, setSelectedRarity] = useState<string>('');
    const [serialNumber, setSerialNumber] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [stats, setStats] = useState({ total: 0, used: 0, created: 0 });
    const [qrCodes, setQrCodes] = useState<QRCodeData[]>([]);
    const [viewingQR, setViewingQR] = useState<QRCodeData | null>(null);
    const [deletingQR, setDeletingQR] = useState<QRCodeData | null>(null);
    const [error, setError] = useState<string>('');
    const [lastCreatedUrl, setLastCreatedUrl] = useState<string>('');
    const [validationErrors, setValidationErrors] = useState({ rarity: false, model: false, serial: false });
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [bulkCount, setBulkCount] = useState<string>('10');
    const [bulkPreview, setBulkPreview] = useState<GeneratedQRDraft[]>([]);
    const [bulkError, setBulkError] = useState<string>('');
    const [isBulkCreating, setIsBulkCreating] = useState(false);

    const [dbStats, setDbStats] = useState<DbStats>({ nftCount: 0, userCount: 0, adminUsers: 0 });
    const [isDbLoading, setIsDbLoading] = useState(false);
    const [dbError, setDbError] = useState('');
    const [dbResult, setDbResult] = useState('');
    const [confirmAction, setConfirmAction] = useState<DbActionType | null>(null);
    const [confirmInput, setConfirmInput] = useState('');
    const [isConfirmLoading, setIsConfirmLoading] = useState(false);

    // Get the Telegram user ID from multiple sources for reliability
    const telegramUserId = user?.id || webApp?.initDataUnsafe?.user?.id;

    // Check admin access
    const isAdmin = Boolean(telegramUserId && ADMIN_IDS.includes(String(telegramUserId)));

    useBodyScrollLock(Boolean(confirmAction));

    const dbActionConfig = useMemo<Record<DbActionType, DbActionConfig>>(() => ({
        purgeNfts: {
            title: t('admin_db_delete_nfts'),
            description: t('admin_db_confirm_delete_nfts'),
            confirmPhrase: 'DELETE ALL NFTS',
            danger: true,
        },
        purgeUsers: {
            title: t('admin_db_delete_users'),
            description: t('admin_db_confirm_delete_users'),
            confirmPhrase: 'DELETE ALL USERS',
            danger: true,
        },
    }), [t]);

    const activeDbAction = confirmAction ? dbActionConfig[confirmAction] : null;
    const normalizedConfirm = confirmInput.trim().toUpperCase();
    const isConfirmValid = activeDbAction
        ? !activeDbAction.confirmPhrase || normalizedConfirm === activeDbAction.confirmPhrase
        : false;

    const getNextSerialNumber = () => getMaxSerialNumber(qrCodes) + 1;

    const buildBalancedPreview = (amount: number): GeneratedQRDraft[] => {
        const modelCounts = new Map<string, number>();

        PEPE_MODELS.forEach((model) => {
            modelCounts.set(model.name, 0);
        });

        qrCodes.forEach((qr) => {
            if (!modelCounts.has(qr.modelName)) return;
            modelCounts.set(qr.modelName, (modelCounts.get(qr.modelName) || 0) + 1);
        });

        const preview: GeneratedQRDraft[] = [];
        const startSerial = getNextSerialNumber();

        for (let index = 0; index < amount; index += 1) {
            let minCount = Number.POSITIVE_INFINITY;
            modelCounts.forEach((count) => {
                if (count < minCount) minCount = count;
            });

            const candidates = PEPE_MODELS.filter((model) => (modelCounts.get(model.name) || 0) === minCount);
            const selected = pickRandomItem(candidates);
            if (!selected) break;

            preview.push({
                modelName: selected.name,
                rarity: selected.rarity,
                serialNumber: startSerial + index,
            });

            modelCounts.set(selected.name, (modelCounts.get(selected.name) || 0) + 1);
        }

        return preview;
    };

    const loadDbStats = async () => {
        setIsDbLoading(true);
        setDbError('');

        try {
            const data = await api.admin.dbStats();
            if (data?.stats) {
                setDbStats({
                    nftCount: Number(data.stats.nftCount || 0),
                    userCount: Number(data.stats.userCount || 0),
                    adminUsers: Number(data.stats.adminUsers || 0),
                });
            }
        } catch (loadError) {
            console.error('Error loading DB stats:', loadError);
            const message = getErrorMessage(loadError);
            setDbError(message || t('error_occurred'));
        } finally {
            setIsDbLoading(false);
        }
    };

    // Wait for auth to complete before checking admin
    useEffect(() => {
        if (ready) {
            if (telegramUserId) {
                setIsCheckingAuth(false);
            } else {
                const timer = setTimeout(() => {
                    setIsCheckingAuth(false);
                }, 2000);
                return () => clearTimeout(timer);
            }
        }
    }, [ready, telegramUserId]);

    // Load data on mount (only if admin)
    useEffect(() => {
        if (!isCheckingAuth && isAdmin) {
            loadData();
            loadDbStats();
        } else if (!isCheckingAuth) {
            setIsLoadingList(false);
        }
    }, [isAdmin, isCheckingAuth]);

    const loadData = async () => {
        setIsLoadingList(true);
        try {
            const data = await api.qr.list();

            if (data.qrCodes) {
                setQrCodes(data.qrCodes);
            }
            if (data.stats) {
                setStats(data.stats);
            }
        } catch (loadError) {
            console.error('Error loading data:', loadError);
        } finally {
            setIsLoadingList(false);
        }
    };

    const handleCreate = async () => {
        const errors = {
            rarity: !selectedRarity,
            model: !selectedModel,
            serial: !serialNumber,
        };

        setValidationErrors(errors);

        if (errors.rarity || errors.model || errors.serial) {
            return;
        }

        if (!selectedModel || !serialNumber) return;

        setIsLoading(true);
        setError('');
        setLastCreatedUrl('');

        try {
            const data = await api.qr.create({
                modelName: selectedModel,
                serialNumber: parseInt(serialNumber, 10),
            });

            setLastCreatedUrl(`${window.location.origin}${data.activationUrl}`);
            setSelectedModel('');
            setSerialNumber('');
            setSelectedRarity('');
            setValidationErrors({ rarity: false, model: false, serial: false });
            await loadData();
        } catch (createError: unknown) {
            console.error('Error creating QR:', createError);
            const message = getErrorMessage(createError);
            if (message.includes('DUPLICATE') || message.includes('exists')) {
                setError(t('qr_exists'));
            } else if (message.includes('SERIAL_EXISTS')) {
                setError(t('serial_exists'));
            } else {
                setError(t('error_occurred'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleAutoFill = () => {
        const modelPool = selectedRarity
            ? PEPE_MODELS.filter((model) => model.rarity === selectedRarity)
            : PEPE_MODELS;
        const selected = pickRandomItem(modelPool);
        if (!selected) return;

        setSelectedRarity(selected.rarity);
        setSelectedModel(selected.name);
        setSerialNumber(String(getNextSerialNumber()));
        setError('');
        setBulkError('');
        setValidationErrors({ rarity: false, model: false, serial: false });
    };

    const handleGenerateBulkPreview = () => {
        const amount = Number.parseInt(bulkCount, 10);
        if (!Number.isInteger(amount) || amount < 1 || amount > MAX_BULK_GENERATION) {
            setBulkError(t('bulk_invalid_count'));
            return;
        }

        const preview = buildBalancedPreview(amount);
        if (preview.length === 0) {
            setBulkError(t('error_occurred'));
            return;
        }

        setBulkError('');
        setError('');
        setBulkPreview(preview);
    };

    const handleCreateBulk = async () => {
        if (bulkPreview.length === 0) return;

        setIsBulkCreating(true);
        setError('');
        setBulkError('');
        setLastCreatedUrl('');

        try {
            const data = await api.qr.createBatch({
                items: bulkPreview.map((item) => ({
                    modelName: item.modelName,
                    serialNumber: item.serialNumber,
                })),
            });

            if (Array.isArray(data.qrCodes) && data.qrCodes[0]?.activationUrl) {
                setLastCreatedUrl(`${window.location.origin}${data.qrCodes[0].activationUrl}`);
            }

            setBulkPreview([]);
            await loadData();
        } catch (createError: unknown) {
            console.error('Error creating bulk QR:', createError);
            const message = getErrorMessage(createError);
            if (message.includes('DUPLICATE') || message.includes('exists')) {
                setError(t('qr_exists'));
            } else if (message.includes('SERIAL_EXISTS') || message.includes('Serial number')) {
                setError(t('serial_exists'));
            } else {
                setError(t('error_occurred'));
            }
        } finally {
            setIsBulkCreating(false);
        }
    };

    const getQRUrl = (qr: QRCodeData) => {
        return `${window.location.origin}/activate/${encodeURIComponent(qr.token)}`;
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleDelete = async (qr: QRCodeData) => {
        setDeletingQR(qr);
    };

    const confirmDelete = async () => {
        if (!deletingQR) return;

        try {
            await api.qr.delete(deletingQR.nfcId);
            setDeletingQR(null);
            await loadData();
        } catch (deleteError) {
            console.error('Error deleting QR:', deleteError);
        }
    };

    const openConfirmDrawer = (action: DbActionType) => {
        setConfirmAction(action);
        setConfirmInput('');
        setDbError('');
    };

    const closeConfirmDrawer = () => {
        if (isConfirmLoading) return;
        setConfirmAction(null);
        setConfirmInput('');
    };

    const executeDbAction = async () => {
        if (!confirmAction || !activeDbAction || !isConfirmValid) {
            return;
        }

        setIsConfirmLoading(true);
        setDbError('');

        try {
            if (confirmAction === 'purgeNfts') {
                const response = await api.admin.purgeNfts(normalizedConfirm);
                const deletedNfts = Number(response?.deletedNfts || 0);
                setDbResult(`${t('admin_db_done_nfts')} ${deletedNfts}`);
            }

            if (confirmAction === 'purgeUsers') {
                const response = await api.admin.purgeUsers(normalizedConfirm);
                const deletedUsers = Number(response?.deletedUsers || 0);
                setDbResult(`${t('admin_db_done_users')} ${deletedUsers}`);
            }

            setConfirmAction(null);
            setConfirmInput('');
            await Promise.all([loadData(), loadDbStats()]);
        } catch (actionError) {
            console.error('Error executing DB action:', actionError);
            const message = getErrorMessage(actionError);
            setDbError(message || t('error_occurred'));
        } finally {
            setIsConfirmLoading(false);
        }
    };

    if (isCheckingAuth) {
        return (
            <div className={styles.container}>
                <main className={styles.main}>
                    <div className={styles.loadingState}>
                        <div className={styles.spinner}></div>
                    </div>
                </main>
                <Navigation />
            </div>
        );
    }

    if (!isAdmin) {
        if (typeof window !== 'undefined') {
            window.location.href = '/404';
        }
        return null;
    }

    return (
        <div className={styles.container}>
            <TelegramBackButton href="/profile" />

            <main className={styles.main}>
                <SegmentedTabs<AdminTab>
                    items={[
                        { key: 'nft', label: t('admin_tab_nft') },
                        { key: 'db', label: t('admin_tab_db') },
                        { key: 'topup', label: t('admin_tab_topup') },
                        { key: 'updates', label: t('admin_tab_updates') },
                    ]}
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    scrollable
                    className={styles.adminTabs}
                    ariaLabel="Admin tabs"
                />

                {activeTab === 'nft' && (
                    <>
                        <div className={styles.statsGrid}>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
                                    <QrCode size={20} color="#3b82f6" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.total}</span>
                                    <span className={styles.statLabel}>{t('total_qr')}</span>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(251, 191, 36, 0.2)' }}>
                                    <Clock size={20} color="#fbbf24" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.created}</span>
                                    <span className={styles.statLabel}>{t('waiting')}</span>
                                </div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statIcon} style={{ background: 'rgba(34, 197, 94, 0.2)' }}>
                                    <CheckCircle size={20} color="#22c55e" />
                                </div>
                                <div className={styles.statInfo}>
                                    <span className={styles.statValue}>{stats.used}</span>
                                    <span className={styles.statLabel}>{t('used')}</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.creator}>
                            <div className={styles.form}>
                                <div className={styles.formRow}>
                                    <div className={styles.field}>
                                        <label>{t('rarity')}</label>
                                        <AdminCustomSelect
                                            value={selectedRarity}
                                            options={[
                                                { value: '', label: t('all') },
                                                { value: 'common', label: t('rarity_common') },
                                                { value: 'rare', label: t('rarity_rare') },
                                                { value: 'legendary', label: t('rarity_legendary') },
                                            ]}
                                            onChange={(value) => {
                                                setSelectedRarity(value);
                                                setSelectedModel('');
                                                setValidationErrors((prev) => ({ ...prev, rarity: false }));
                                            }}
                                            placeholder={t('select_rarity')}
                                            error={validationErrors.rarity}
                                        />
                                    </div>

                                    <div className={styles.field}>
                                        <label>{t('model')}</label>
                                        <AdminCustomSelect
                                            value={selectedModel}
                                            options={PEPE_MODELS
                                                .filter((model) => !selectedRarity || model.rarity === selectedRarity)
                                                .map((model) => ({
                                                    value: model.name,
                                                    label: model.name,
                                                }))}
                                            onChange={(value) => {
                                                setSelectedModel(value);
                                                setValidationErrors((prev) => ({ ...prev, model: false }));
                                            }}
                                            placeholder={t('select')}
                                            disabled={false}
                                            error={validationErrors.model}
                                        />
                                    </div>

                                    <div className={styles.field}>
                                        <label>{t('serial_number')}</label>
                                        <input
                                            type="number"
                                            value={serialNumber}
                                            onChange={(event) => {
                                                setSerialNumber(event.target.value);
                                                setValidationErrors((prev) => ({ ...prev, serial: false }));
                                            }}
                                            placeholder="1"
                                            className={`${styles.input} ${validationErrors.serial ? styles.inputError : ''}`}
                                        />
                                    </div>
                                </div>

                                <div className={styles.quickActions}>
                                    <button
                                        type="button"
                                        className={styles.iconActionBtn}
                                        onClick={handleAutoFill}
                                        title={t('autofill_random')}
                                    >
                                        <Shuffle size={16} />
                                    </button>
                                    <span className={styles.quickActionText}>{t('autofill_random')}</span>
                                </div>

                                {error && (
                                    <div className={styles.error}>
                                        <AlertTriangle size={16} />
                                        {error}
                                    </div>
                                )}

                                <Button onClick={handleCreate} disabled={isLoading}>
                                    {isLoading ? t('creating') : t('create_qr')}
                                </Button>

                                {lastCreatedUrl && (
                                    <div className={styles.urlBox}>
                                        <code>{lastCreatedUrl}</code>
                                    </div>
                                )}

                                <div className={styles.bulkGenerator}>
                                    <div className={styles.bulkHeader}>
                                        <Sparkles size={16} />
                                        <span>{t('bulk_generate')}</span>
                                    </div>

                                    <div className={styles.bulkControls}>
                                        <div className={styles.field}>
                                            <label>{t('bulk_count')}</label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={MAX_BULK_GENERATION}
                                                value={bulkCount}
                                                onChange={(event) => setBulkCount(event.target.value)}
                                                className={styles.input}
                                                placeholder="10"
                                            />
                                        </div>
                                        <Button type="button" variant="secondary" onClick={handleGenerateBulkPreview}>
                                            {t('bulk_preview')}
                                        </Button>
                                    </div>

                                    {bulkError && (
                                        <div className={styles.error}>
                                            <AlertTriangle size={16} />
                                            {bulkError}
                                        </div>
                                    )}
                                </div>

                                {bulkPreview.length > 0 && (
                                    <div className={styles.bulkPreview}>
                                        <div className={styles.bulkPreviewHeader}>
                                            <strong>{t('bulk_preview_items')}: {bulkPreview.length}</strong>
                                            <span>
                                                {t('bulk_range')}: #{bulkPreview[0]?.serialNumber} - #{bulkPreview[bulkPreview.length - 1]?.serialNumber}
                                            </span>
                                        </div>

                                        <div className={styles.bulkPreviewGrid}>
                                            {bulkPreview.slice(0, 60).map((item) => (
                                                <div key={`${item.modelName}-${item.serialNumber}`} className={styles.bulkPreviewItem}>
                                                    <span className={styles.bulkPreviewModel}>{item.modelName}</span>
                                                    <span className={`${styles.qrRarity} ${styles[item.rarity]}`}>{item.rarity}</span>
                                                    <span className={styles.bulkPreviewSerial}>#{item.serialNumber}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {bulkPreview.length > 60 && (
                                            <p className={styles.bulkMore}>+{bulkPreview.length - 60} {t('bulk_more_items')}</p>
                                        )}

                                        <div className={styles.bulkActions}>
                                            <Button
                                                type="button"
                                                onClick={handleCreateBulk}
                                                disabled={isBulkCreating}
                                            >
                                                {isBulkCreating ? t('bulk_creating') : t('bulk_create')}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => setBulkPreview([])}
                                                disabled={isBulkCreating}
                                            >
                                                {t('bulk_clear_preview')}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={styles.qrList}>
                            {isLoadingList ? (
                                <div className={styles.loadingSpinner}>
                                    <div className={styles.spinner}></div>
                                </div>
                            ) : qrCodes.length === 0 ? (
                                <div className={styles.empty}>{t('no_qr_yet')}</div>
                            ) : (
                                <div className={styles.tableWrapper}>
                                    <table className={styles.qrTable}>
                                        <thead>
                                            <tr>
                                                <th>{t('model')}</th>
                                                <th>{t('number')}</th>
                                                <th>{t('status')}</th>
                                                <th>{t('rarity')}</th>
                                                <th>{t('created_at')}</th>
                                                <th className={styles.stickyCol}>{t('actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {qrCodes.map((qr) => (
                                                <tr key={qr.id}>
                                                    <td>{qr.modelName}</td>
                                                    <td>#{qr.serialNumber}</td>
                                                    <td>
                                                        {qr.status === 'used' ? (
                                                            <CheckCircle size={18} color="#22c55e" />
                                                        ) : (
                                                            <Clock size={18} color="#fbbf24" />
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span className={`${styles.qrRarity} ${styles[qr.rarity]}`}>
                                                            {qr.rarity}
                                                        </span>
                                                    </td>
                                                    <td className={styles.dateCell}>{formatDate(qr.createdAt)}</td>
                                                    <td className={styles.stickyCol}>
                                                        <div className={styles.actionButtons}>
                                                            <button
                                                                className={styles.viewBtn}
                                                                onClick={() => setViewingQR(qr)}
                                                            >
                                                                <Eye size={16} />
                                                            </button>
                                                            <button
                                                                className={styles.deleteBtn}
                                                                onClick={() => handleDelete(qr)}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'db' && (
                    <div className={styles.dbSection}>
                        <div className={styles.dbStatsGrid}>
                            <div className={styles.dbStatCard}>
                                <div className={styles.dbStatIcon}>
                                    <Database size={18} />
                                </div>
                                <div className={styles.dbStatContent}>
                                    <span className={styles.dbStatValue}>{dbStats.nftCount}</span>
                                    <span className={styles.dbStatLabel}>{t('admin_db_stats_nft')}</span>
                                </div>
                            </div>

                            <div className={styles.dbStatCard}>
                                <div className={styles.dbStatIcon}>
                                    <UserX size={18} />
                                </div>
                                <div className={styles.dbStatContent}>
                                    <span className={styles.dbStatValue}>{dbStats.userCount}</span>
                                    <span className={styles.dbStatLabel}>{t('admin_db_stats_users')}</span>
                                </div>
                            </div>

                            <div className={styles.dbStatCard}>
                                <div className={styles.dbStatIcon}>
                                    <CheckCircle size={18} />
                                </div>
                                <div className={styles.dbStatContent}>
                                    <span className={styles.dbStatValue}>{dbStats.adminUsers}</span>
                                    <span className={styles.dbStatLabel}>{t('admin_db_stats_admins')}</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.dbCard}>
                            <h3>{t('admin_db_zone_title')}</h3>
                            <p>{t('admin_db_zone_desc')}</p>

                            {dbError && (
                                <div className={styles.error}>
                                    <AlertTriangle size={16} />
                                    {dbError}
                                </div>
                            )}

                            {dbResult && (
                                <div className={styles.dbResultBox}>
                                    <strong>{t('admin_db_last_result')}</strong>
                                    <span>{dbResult}</span>
                                </div>
                            )}

                            <div className={styles.dbActionsList}>
                                <button
                                    type="button"
                                    className={`${styles.dbActionBtn} ${styles.dbActionDanger}`}
                                    onClick={() => openConfirmDrawer('purgeNfts')}
                                    disabled={isDbLoading}
                                >
                                    <Trash2 size={16} />
                                    {t('admin_db_delete_nfts')}
                                </button>

                                <button
                                    type="button"
                                    className={`${styles.dbActionBtn} ${styles.dbActionDanger}`}
                                    onClick={() => openConfirmDrawer('purgeUsers')}
                                    disabled={isDbLoading}
                                >
                                    <UserX size={16} />
                                    {t('admin_db_delete_users')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === 'topup' && (
                    <BalanceTopupTab />
                )}

                {activeTab === 'updates' && (
                    <AdminUpdatesTab />
                )}
            </main>

            <Navigation />

            {viewingQR && (
                <div className={styles.modal} onClick={() => setViewingQR(null)}>
                    <div className={styles.modalContent} onClick={(event) => event.stopPropagation()}>
                        <button className={styles.closeBtn} onClick={() => setViewingQR(null)}>
                            <X size={20} />
                        </button>
                        <div className={styles.qrWrapper}>
                            <QRCode value={getQRUrl(viewingQR)} size={200} bgColor="#ffffff" fgColor="#000000" />
                        </div>
                        <h3>{viewingQR.modelName} #{viewingQR.serialNumber}</h3>
                        <div className={styles.modalInfo}>
                            <div className={styles.infoRow}>
                                <span>{t('status')}:</span>
                                <span className={`${styles.qrStatus} ${styles[viewingQR.status]}`}>
                                    {viewingQR.status === 'created' ? t('waiting') : t('used')}
                                </span>
                            </div>
                            <div className={styles.infoRow}>
                                <span>{t('created_at')}:</span>
                                <span>{formatDate(viewingQR.createdAt)}</span>
                            </div>
                            {viewingQR.usedAt && (
                                <div className={styles.infoRow}>
                                    <span>{t('used_at')}:</span>
                                    <span>{formatDate(viewingQR.usedAt)}</span>
                                </div>
                            )}
                        </div>
                        <div className={styles.urlBox}>
                            <code>{getQRUrl(viewingQR)}</code>
                        </div>
                    </div>
                </div>
            )}

            {deletingQR && (
                <div className={styles.modal} onClick={() => setDeletingQR(null)}>
                    <div className={styles.deleteModal} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.deleteIcon}>
                            <Trash2 size={28} />
                        </div>
                        <p>
                            <strong>{deletingQR.modelName} #{deletingQR.serialNumber}</strong> — {t('delete_confirm')}
                        </p>
                        <div className={styles.deleteActions}>
                            <button
                                className={styles.cancelBtn}
                                onClick={() => setDeletingQR(null)}
                            >
                                {t('no')}
                            </button>
                            <button
                                className={styles.confirmDeleteBtn}
                                onClick={confirmDelete}
                            >
                                {t('yes')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeDbAction && (
                <div className={`${styles.drawerOverlay} ${styles.drawerOverlayVisible}`} onClick={closeConfirmDrawer}>
                    <div className={`${styles.drawer} ${styles.drawerOpen}`} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.drawerHandle}></div>
                        <h3 className={styles.drawerTitle}>{activeDbAction.title}</h3>
                        <p className={styles.drawerText}>{activeDbAction.description}</p>

                        {activeDbAction.confirmPhrase && (
                            <div className={styles.drawerField}>
                                <label htmlFor="db-confirm-input">
                                    {t('admin_db_type_phrase')} <code>{activeDbAction.confirmPhrase}</code>
                                </label>
                                <input
                                    id="db-confirm-input"
                                    type="text"
                                    value={confirmInput}
                                    onChange={(event) => setConfirmInput(event.target.value)}
                                    placeholder={t('admin_db_phrase_placeholder')}
                                    className={styles.drawerInput}
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                            </div>
                        )}

                        <div className={styles.drawerActions}>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={closeConfirmDrawer}
                                disabled={isConfirmLoading}
                            >
                                {t('no')}
                            </Button>
                            <button
                                type="button"
                                className={`${styles.drawerConfirmBtn} ${activeDbAction.danger ? styles.drawerConfirmDanger : ''}`}
                                onClick={executeDbAction}
                                disabled={!isConfirmValid || isConfirmLoading}
                            >
                                {isConfirmLoading ? t('admin_db_processing') : t('continue')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
