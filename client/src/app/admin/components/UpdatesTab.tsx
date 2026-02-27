'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, GitCommitHorizontal, RefreshCcw, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { AdminUpdateStatusResponse, api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import styles from '../page.module.css';

const DEFAULT_INTERVAL_MINUTES = 10;

function formatDate(value: string | null): string {
    if (!value) return '-';

    try {
        return new Date(value).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return value;
    }
}

function shortCommit(value: string | null): string {
    if (!value) return '-';
    return value.slice(0, 7);
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
    return text
        .split(/(`[^`]+`)/g)
        .filter(Boolean)
        .map((part, index) => {
            if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
                return <code key={`code-${index}`}>{part.slice(1, -1)}</code>;
            }

            return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
        });
}

function renderChangelogMarkdown(markdown: string): React.ReactNode {
    const lines = markdown.split(/\r?\n/);
    const blocks: React.ReactNode[] = [];

    let index = 0;
    while (index < lines.length) {
        const line = (lines[index] || '').trim();

        if (!line) {
            index += 1;
            continue;
        }

        if (line.startsWith('### ')) {
            blocks.push(
                <h4 key={`heading-${index}`}>
                    {renderInlineMarkdown(line.replace(/^###\s+/, ''))}
                </h4>,
            );
            index += 1;
            continue;
        }

        if (/^(?:-|\*)\s+/.test(line)) {
            const items: React.ReactNode[] = [];
            let listIndex = index;

            while (listIndex < lines.length) {
                const listLine = (lines[listIndex] || '').trim();
                if (!/^(?:-|\*)\s+/.test(listLine)) {
                    break;
                }

                items.push(
                    <li key={`list-item-${listIndex}`}>
                        {renderInlineMarkdown(listLine.replace(/^(?:-|\*)\s+/, ''))}
                    </li>,
                );
                listIndex += 1;
            }

            blocks.push(<ul key={`list-${index}`}>{items}</ul>);
            index = listIndex;
            continue;
        }

        const paragraph: string[] = [line];
        let paragraphIndex = index + 1;

        while (paragraphIndex < lines.length) {
            const next = (lines[paragraphIndex] || '').trim();
            if (!next || next.startsWith('### ') || /^(?:-|\*)\s+/.test(next)) {
                break;
            }

            paragraph.push(next);
            paragraphIndex += 1;
        }

        blocks.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
        index = paragraphIndex;
    }

    return <div className={styles.updatesChangelogMarkdown}>{blocks}</div>;
}

export const AdminUpdatesTab = () => {
    const { t } = useLanguage();

    const [status, setStatus] = useState<AdminUpdateStatusResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isChecking, setIsChecking] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    const [intervalMinutes, setIntervalMinutes] = useState<string>(String(DEFAULT_INTERVAL_MINUTES));
    const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);

    const syncSettings = useCallback((payload: AdminUpdateStatusResponse) => {
        setIntervalMinutes(String(payload.settings.intervalMinutes || DEFAULT_INTERVAL_MINUTES));
        setAutoUpdateEnabled(Boolean(payload.settings.autoUpdateEnabled));
    }, []);

    const loadStatus = useCallback(async (showLoader: boolean) => {
        if (showLoader) {
            setIsLoading(true);
        }

        try {
            const payload = await api.admin.updatesStatus();
            setStatus(payload);
            syncSettings(payload);
            setError('');
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : t('error_occurred');
            setError(message || t('error_occurred'));
        } finally {
            if (showLoader) {
                setIsLoading(false);
            }
        }
    }, [syncSettings, t]);

    useEffect(() => {
        void loadStatus(true);

        const timer = window.setInterval(() => {
            void loadStatus(false);
        }, 30_000);

        return () => window.clearInterval(timer);
    }, [loadStatus]);

    const handleCheck = async () => {
        setIsChecking(true);
        setError('');

        try {
            const payload = await api.admin.checkUpdates();
            setStatus(payload);
            syncSettings(payload);
        } catch (checkError) {
            const message = checkError instanceof Error ? checkError.message : t('error_occurred');
            setError(message || t('error_occurred'));
        } finally {
            setIsChecking(false);
        }
    };

    const handleApplyUpdate = async () => {
        setIsUpdating(true);
        setError('');

        try {
            const payload = await api.admin.applyUpdate();
            setStatus(payload);
            syncSettings(payload);
        } catch (applyError) {
            const message = applyError instanceof Error ? applyError.message : t('error_occurred');
            setError(message || t('error_occurred'));
        } finally {
            setIsUpdating(false);
        }
    };

    const handleSaveSettings = async () => {
        const parsedInterval = Number.parseInt(intervalMinutes, 10);
        if (!Number.isFinite(parsedInterval) || parsedInterval < 1) {
            setError(t('admin_updates_interval_invalid'));
            return;
        }

        setIsSaving(true);
        setError('');

        try {
            const payload = await api.admin.saveUpdateSettings({
                intervalMinutes: parsedInterval,
                autoUpdateEnabled,
            });

            setStatus(payload);
            syncSettings(payload);
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : t('error_occurred');
            setError(message || t('error_occurred'));
        } finally {
            setIsSaving(false);
        }
    };

    const modeLabel = useMemo(() => {
        if (!status) return '-';
        return status.runMode === 'production' ? t('admin_updates_mode_prod') : t('admin_updates_mode_dev');
    }, [status, t]);

    if (isLoading) {
        return (
            <div className={styles.loadingState}>
                <div className={styles.spinner}></div>
            </div>
        );
    }

    const isProduction = status?.runMode === 'production';
    const hasUpdate = Boolean(status?.state.hasUpdate);
    const updateButtonDisabled = !hasUpdate || isUpdating || isChecking || isSaving;

    return (
        <div className={styles.updatesSection}>
            <div className={styles.updatesCard}>
                <div className={styles.updatesHeadline}>
                    <h3>{t('admin_updates_title')}</h3>
                    <span className={`${styles.updatesPill} ${hasUpdate ? styles.updatesPillWarn : styles.updatesPillOk}`}>
                        {hasUpdate ? t('admin_updates_available') : t('admin_updates_latest')}
                    </span>
                </div>

                <div className={styles.updatesMetaGrid}>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_mode')}</span>
                        <strong>{modeLabel}</strong>
                    </div>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_branch')}</span>
                        <strong>{status?.branch || '-'}</strong>
                    </div>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_current')}</span>
                        <strong>{status?.state.current.version || '-'}</strong>
                    </div>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_remote')}</span>
                        <strong>{status?.state.remote.version || '-'}</strong>
                    </div>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_current_commit')}</span>
                        <strong>{shortCommit(status?.state.current.short || status?.state.current.full || null)}</strong>
                    </div>
                    <div className={styles.updatesMetaItem}>
                        <span>{t('admin_updates_remote_commit')}</span>
                        <strong>{shortCommit(status?.state.remote.short || status?.state.remote.full || null)}</strong>
                    </div>
                </div>

                {status?.state.remote.subject && (
                    <div className={styles.updatesCommitBox}>
                        <GitCommitHorizontal size={14} />
                        <span>{status.state.remote.subject}</span>
                    </div>
                )}

                <div className={styles.updatesTimeline}>
                    <div className={styles.updatesTimelineItem}>
                        <Clock3 size={14} />
                        <span>{t('admin_updates_last_check')}: {formatDate(status?.state.lastCheckedAt || null)}</span>
                    </div>
                    <div className={styles.updatesTimelineItem}>
                        <CheckCircle2 size={14} />
                        <span>{t('admin_updates_last_update')}: {formatDate(status?.state.lastUpdatedAt || null)}</span>
                    </div>
                </div>

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                {status?.state.lastError && !error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {status.state.lastError}
                    </div>
                )}

                <div className={styles.updatesActionsRow}>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleCheck}
                        disabled={isChecking || isUpdating || isSaving}
                    >
                        <span className={styles.updatesBtnContent}>
                            <RefreshCcw size={15} />
                            {isChecking ? t('admin_updates_checking') : t('admin_updates_check')}
                        </span>
                    </Button>

                    <button
                        type="button"
                        className={`${styles.updatesApplyBtn} ${updateButtonDisabled ? styles.updatesApplyBtnDisabled : ''}`}
                        onClick={handleApplyUpdate}
                        disabled={updateButtonDisabled}
                    >
                        <span className={styles.updatesBtnContent}>
                            <Rocket size={15} />
                            {isUpdating ? t('admin_updates_updating') : t('admin_updates_apply')}
                        </span>
                    </button>
                </div>
            </div>

            <div className={styles.updatesCard}>
                <h3>{t('admin_updates_settings_title')}</h3>
                <p>{t('admin_updates_settings_desc')}</p>

                <div className={styles.updatesSettingRow}>
                    <label htmlFor="updates-interval">{t('admin_updates_interval')}</label>
                    <input
                        id="updates-interval"
                        type="number"
                        min={1}
                        max={720}
                        value={intervalMinutes}
                        onChange={(event) => setIntervalMinutes(event.target.value)}
                        className={styles.updatesInput}
                    />
                </div>

                <label className={styles.updatesToggleRow}>
                    <input
                        type="checkbox"
                        checked={autoUpdateEnabled}
                        onChange={(event) => setAutoUpdateEnabled(event.target.checked)}
                        disabled={!isProduction || isSaving}
                    />
                    <span>{t('admin_updates_auto_toggle')}</span>
                </label>

                {!isProduction && (
                    <p className={styles.updatesHint}>{t('admin_updates_dev_hint')}</p>
                )}

                <Button
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                >
                    {isSaving ? t('admin_updates_saving') : t('admin_updates_save')}
                </Button>
            </div>

            <div className={styles.updatesCard}>
                <h3>{t('admin_updates_changelog_title')}</h3>

                {status?.state.changelog.latestTitle ? (
                    <div className={styles.updatesChangelogBox}>
                        <strong>{status.state.changelog.latestTitle}</strong>
                        {status.state.changelog.latestBody ? renderChangelogMarkdown(status.state.changelog.latestBody) : null}
                    </div>
                ) : (
                    <p className={styles.updatesHint}>{t('admin_updates_changelog_empty')}</p>
                )}
            </div>
        </div>
    );
};
