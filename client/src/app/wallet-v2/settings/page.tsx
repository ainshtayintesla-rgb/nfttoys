'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    IoAddCircle,
    IoCheckmark,
    IoCopy,
    IoFingerPrint,
    IoKey,
    IoLockClosed,
    IoTimer,
    IoWarning,
} from 'react-icons/io5';
import { TbFaceId } from 'react-icons/tb';

import { PinAuthScreen } from '@/components/features/walletV2/PinAuthScreen';
import { BottomDrawer } from '@/components/ui/BottomDrawer';
import { Button } from '@/components/ui/Button';
import { SettingActionItem } from '@/components/ui/SettingActionItem';
import { TelegramBackButton } from '@/components/ui/TelegramBackButton';
import { api } from '@/lib/api';
import { useLanguage } from '@/lib/context/LanguageContext';
import { useTelegram } from '@/lib/context/TelegramContext';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import {
    authenticateWalletV2WithBiometric,
    enableWalletV2Biometric,
    getWalletV2BiometricSnapshot,
} from '@/lib/walletV2/biometric';
import { buildWalletV2DeviceInput, resolveWalletV2BiometricVisualType } from '@/lib/walletV2/device';
import { isWalletV2ApiError } from '@/lib/walletV2/errors';
import { resetWalletV2ClientAuthState } from '@/lib/walletV2/sessionLifecycle';
import {
    getWalletV2BiometricConfirmationEnabled,
    getWalletV2MnemonicWords,
    getWalletV2RememberTimeoutMinutes,
    isWalletV2RememberedAuthValid,
    markWalletV2RememberedAuth,
    setWalletV2BiometricConfirmationEnabled,
    setWalletV2MnemonicWords,
    setWalletV2RememberTimeoutMinutes,
    setWalletV2StoredPinConfigured,
    WALLET_V2_REMEMBER_TIMEOUT_MINUTES_OPTIONS,
} from '@/lib/walletV2/settings';

import styles from './page.module.css';

type SettingsPinFlow = 'none' | 'unlock' | 'create_wallet' | 'change_pin';
type SettingsSensitiveAction = 'show_mnemonic' | null;

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 4;
const MNEMONIC_WORDS_COUNT = 24;

async function writeToClipboard(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function isValidPin(pin: string): boolean {
    return /^[0-9]{4}$/.test(pin);
}

function formatRememberTimeoutButtonValue(minutes: number, locale: string): string {
    if (minutes <= 0) {
        return '0';
    }

    if (minutes % 60 === 0) {
        const hours = Math.floor(minutes / 60);
        return locale === 'ru' ? `${hours}ч` : `${hours}h`;
    }

    return locale === 'ru' ? `${minutes}м` : `${minutes}m`;
}

function safeErrorMessage(error: unknown): string {
    if (isWalletV2ApiError(error)) {
        if (error.code === 'WALLET_LIMIT_REACHED') {
            return 'Wallet limit reached. Up to 10 wallets per user are allowed.';
        }

        if (error.code === 'INVALID_PIN') {
            return 'Invalid PIN';
        }

        if (error.code === 'WALLET_NOT_FOUND') {
            return 'Wallet was not found on server. Create or import wallet again.';
        }

        if (
            error.code === 'WALLET_SESSION_MISSING'
            || error.code === 'SESSION_REVOKED'
            || error.code === 'INVALID_REFRESH_TOKEN'
        ) {
            return 'Wallet session is missing. Open Wallet V2 and authenticate again.';
        }

        if (error.message) {
            return error.message;
        }
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Request failed';
}

export default function WalletV2SettingsPage() {
    const { t, locale } = useLanguage();
    const { haptic, webApp, isAuthenticated } = useTelegram();
    const router = useRouter();

    const tr = useCallback((key: string, fallback: string): string => {
        const value = t(key as never);
        return value === key ? fallback : value;
    }, [t]);

    const [walletId, setWalletId] = useState<string | null>(() => api.walletV2.session.getWalletId());
    const [isBiometricEnabled, setIsBiometricEnabled] = useState(true);
    const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
    const [isBiometricChecking, setIsBiometricChecking] = useState(false);
    const [deviceBiometricSupported, setDeviceBiometricSupported] = useState(false);
    const [devicePubKey, setDevicePubKey] = useState<string | null>(null);

    const [rememberTimeoutMinutes, setRememberTimeoutMinutesState] = useState<number>(
        () => getWalletV2RememberTimeoutMinutes(),
    );
    const [isRememberDropdownOpen, setIsRememberDropdownOpen] = useState(false);

    const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
    const [isMnemonicDrawerOpen, setIsMnemonicDrawerOpen] = useState(false);
    const [isMnemonicCopied, setIsMnemonicCopied] = useState(false);

    const [pinFlow, setPinFlow] = useState<SettingsPinFlow>('none');
    const [pinAuthError, setPinAuthError] = useState('');
    const [isPinAuthSubmitting, setIsPinAuthSubmitting] = useState(false);
    const [isPinAuthBiometricLoading, setIsPinAuthBiometricLoading] = useState(false);
    const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SettingsSensitiveAction>(null);

    const [statusError, setStatusError] = useState('');
    const [statusSuccess, setStatusSuccess] = useState('');

    const isPinAuthOpen = pinFlow !== 'none';
    useBodyScrollLock(isMnemonicDrawerOpen || isPinAuthOpen);

    const hasMnemonicWords = mnemonicWords.length === MNEMONIC_WORDS_COUNT;
    const mnemonicPhrase = useMemo(() => mnemonicWords.join(' '), [mnemonicWords]);
    const mnemonicColumns = useMemo(() => {
        return [
            mnemonicWords.slice(0, 12),
            mnemonicWords.slice(12, 24),
        ];
    }, [mnemonicWords]);

    const rememberOptions = useMemo(() => {
        return WALLET_V2_REMEMBER_TIMEOUT_MINUTES_OPTIONS.map((minutes) => {
            if (minutes === 0) {
                return {
                    key: String(minutes),
                    label: tr('wallet_v2_remember_timeout_zero', '0 min (always ask)'),
                    minutes,
                };
            }

            return {
                key: String(minutes),
                label: tr('wallet_v2_remember_timeout_value', `${minutes} min`).replace('{minutes}', String(minutes)),
                minutes,
            };
        });
    }, [tr]);

    const rememberValueLabel = useMemo(() => {
        return formatRememberTimeoutButtonValue(rememberTimeoutMinutes, locale);
    }, [locale, rememberTimeoutMinutes]);

    useEffect(() => {
        const currentWalletId = api.walletV2.session.getWalletId();

        setWalletId(currentWalletId);
        setRememberTimeoutMinutesState(getWalletV2RememberTimeoutMinutes());

        if (!currentWalletId) {
            setIsBiometricEnabled(true);
            setMnemonicWords([]);
            return;
        }

        setIsBiometricEnabled(getWalletV2BiometricConfirmationEnabled(currentWalletId));
        setMnemonicWords(getWalletV2MnemonicWords(currentWalletId));
    }, []);

    useEffect(() => {
        let canceled = false;

        const checkBiometricAvailability = async () => {
            const deviceId = api.walletV2.session.getDeviceId();

            if (!deviceId) {
                setIsBiometricAvailable(false);
                setDeviceBiometricSupported(false);
                setDevicePubKey(null);
                return;
            }

            setIsBiometricChecking(true);

            try {
                const snapshot = await getWalletV2BiometricSnapshot(webApp, deviceId);

                if (canceled) {
                    return;
                }

                const biometricAvailable = Boolean(snapshot.managerAvailable && snapshot.biometricAvailable);
                const biometricSupported = Boolean(
                    snapshot.managerAvailable
                    && snapshot.biometricAvailable
                    && snapshot.accessGranted
                    && snapshot.tokenSaved
                    && snapshot.devicePubKey,
                );

                setIsBiometricAvailable(biometricAvailable);
                setDeviceBiometricSupported(biometricSupported);
                setDevicePubKey(snapshot.devicePubKey);
            } finally {
                if (!canceled) {
                    setIsBiometricChecking(false);
                }
            }
        };

        void checkBiometricAvailability();

        return () => {
            canceled = true;
        };
    }, [webApp]);

    const resolveDevicePayloadForWalletMutation = useCallback(async (reason: string) => {
        const walletDeviceId = api.walletV2.session.getDeviceId();

        if (!walletDeviceId) {
            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: deviceBiometricSupported,
                devicePubKey,
            });
        }

        try {
            const result = await enableWalletV2Biometric({
                webApp,
                walletDeviceId,
                reason,
            });

            setDeviceBiometricSupported(result.biometricSupported);
            setDevicePubKey(result.devicePubKey);

            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: result.biometricSupported,
                devicePubKey: result.devicePubKey,
            });
        } catch {
            return buildWalletV2DeviceInput(webApp?.platform, {
                biometricSupported: deviceBiometricSupported,
                devicePubKey,
            });
        }
    }, [deviceBiometricSupported, devicePubKey, webApp]);

    const clearInlineStatus = useCallback(() => {
        setStatusError('');
        setStatusSuccess('');
    }, []);

    const resolveFatalSessionMessage = useCallback((error?: unknown): string => {
        if (isWalletV2ApiError(error) && error.code === 'WALLET_NOT_FOUND') {
            return tr(
                'wallet_v2_wallet_missing_error',
                'Wallet was not found on server. Create or import wallet again.',
            );
        }

        return tr(
            'wallet_v2_session_revoked_error',
            'Wallet session was revoked. Authenticate and import wallet again.',
        );
    }, [tr]);

    const applyFatalSessionReset = useCallback((error?: unknown) => {
        const currentWalletId = walletId || api.walletV2.session.getWalletId();
        const currentDeviceId = api.walletV2.session.getDeviceId();

        resetWalletV2ClientAuthState({
            walletId: currentWalletId,
            deviceId: currentDeviceId,
            clearAllWalletSettings: !currentWalletId,
        });

        setWalletId(null);
        setIsBiometricEnabled(true);
        setIsBiometricAvailable(false);
        setIsBiometricChecking(false);
        setDeviceBiometricSupported(false);
        setDevicePubKey(null);
        setMnemonicWords([]);
        setIsMnemonicDrawerOpen(false);
        setIsMnemonicCopied(false);
        setIsRememberDropdownOpen(false);
        setPinFlow('none');
        setPinAuthError('');
        setIsPinAuthSubmitting(false);
        setIsPinAuthBiometricLoading(false);
        setPendingSensitiveAction(null);
        setStatusSuccess('');
        setStatusError(resolveFatalSessionMessage(error));
        router.replace('/wallet-v2');
    }, [resolveFatalSessionMessage, router, walletId]);

    useEffect(() => {
        const unsubscribe = api.walletV2.session.onRevoked((error) => {
            applyFatalSessionReset(error);
        });

        return unsubscribe;
    }, [applyFatalSessionReset]);

    const handleToggleBiometric = (nextValue: boolean) => {
        if (!walletId) {
            return;
        }

        setWalletV2BiometricConfirmationEnabled(walletId, nextValue);
        setIsBiometricEnabled(nextValue);
        haptic.impact('medium');
    };

    const completeSensitiveAuth = useCallback(() => {
        if (walletId) {
            markWalletV2RememberedAuth(walletId);
        }

        const action = pendingSensitiveAction;
        setPendingSensitiveAction(null);
        setPinAuthError('');
        setPinFlow('none');

        if (action === 'show_mnemonic') {
            setIsMnemonicDrawerOpen(true);
        }
    }, [pendingSensitiveAction, walletId]);

    const openPhraseWithAuthGuard = useCallback(() => {
        if (!walletId) {
            return;
        }

        clearInlineStatus();

        if (isWalletV2RememberedAuthValid(walletId)) {
            setIsMnemonicDrawerOpen(true);
            haptic.impact('light');
            return;
        }

        setPendingSensitiveAction('show_mnemonic');
        setPinAuthError('');
        setPinFlow('unlock');
        haptic.impact('light');
    }, [clearInlineStatus, haptic, walletId]);

    const handleUnlockWithPin = useCallback(async (pin: string) => {
        if (!walletId) {
            const message = tr('wallet_v2_error_session_missing', 'Wallet session is missing');
            setPinAuthError(message);
            setStatusError(message);
            return;
        }

        if (!isValidPin(pin)) {
            const message = tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits');
            setPinAuthError(message);
            haptic.error();
            return;
        }

        setIsPinAuthSubmitting(true);
        setPinAuthError('');
        clearInlineStatus();

        try {
            await api.walletV2.verifyPin({ walletId, pin });
            setWalletV2StoredPinConfigured(true);
            completeSensitiveAuth();
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setStatusError(message);
            haptic.error();
        } finally {
            setIsPinAuthSubmitting(false);
        }
    }, [clearInlineStatus, completeSensitiveAuth, haptic, tr, walletId]);

    const handleUnlockWithBiometric = useCallback(async () => {
        setIsPinAuthBiometricLoading(true);
        setPinAuthError('');
        clearInlineStatus();

        try {
            const biometric = await authenticateWalletV2WithBiometric({
                webApp,
                reason: 'Unlock wallet',
            });

            if (!biometric.authenticated) {
                haptic.warning();
                return;
            }

            setWalletV2StoredPinConfigured(true);
            completeSensitiveAuth();
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setStatusError(message);
            haptic.error();
        } finally {
            setIsPinAuthBiometricLoading(false);
        }
    }, [clearInlineStatus, completeSensitiveAuth, haptic, webApp]);

    const handleCreateWallet = useCallback(async (pin?: string) => {
        if (!isAuthenticated) {
            const message = t('login_required') || 'Login required';
            setPinAuthError(message);
            setStatusError(message);
            return;
        }

        const nextPin = typeof pin === 'string' ? pin.trim() : '';
        const shouldRequirePinInput = !walletId;

        if (shouldRequirePinInput && !isValidPin(nextPin)) {
            setPinAuthError(tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits'));
            haptic.error();
            return;
        }

        if (!shouldRequirePinInput && nextPin && !isValidPin(nextPin)) {
            setPinAuthError(tr('wallet_v2_error_pin_length', 'PIN must contain 4 digits'));
            haptic.error();
            return;
        }

        setIsPinAuthSubmitting(true);
        setPinAuthError('');
        clearInlineStatus();

        try {
            const nextDevicePayload = await resolveDevicePayloadForWalletMutation(
                'Enable biometric confirmation for wallet transfers',
            );
            const response = await api.walletV2.create({
                ...(nextPin ? { pin: nextPin } : {}),
                device: nextDevicePayload,
            });

            setWalletV2StoredPinConfigured(true);
            markWalletV2RememberedAuth(response.wallet.id);
            setWalletV2BiometricConfirmationEnabled(response.wallet.id, true);
            setWalletV2MnemonicWords(response.wallet.id, response.mnemonic || []);

            setWalletId(response.wallet.id);
            setIsBiometricEnabled(true);
            setMnemonicWords(response.mnemonic || []);
            setIsMnemonicCopied(false);
            setIsMnemonicDrawerOpen(true);
            setPinFlow('none');
            setStatusSuccess(tr('wallet_v2_create_success', 'Wallet created. Save your 24 recovery words now.'));
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setStatusError(message);
            haptic.error();
        } finally {
            setIsPinAuthSubmitting(false);
        }
    }, [
        clearInlineStatus,
        haptic,
        isAuthenticated,
        resolveDevicePayloadForWalletMutation,
        t,
        tr,
        walletId,
    ]);

    const handleOpenCreateWallet = useCallback(() => {
        clearInlineStatus();
        setPinAuthError('');
        haptic.impact('light');

        if (walletId) {
            void handleCreateWallet();
            return;
        }

        setPinFlow('create_wallet');
    }, [clearInlineStatus, haptic, handleCreateWallet, walletId]);

    const handleChangePin = useCallback(async (newPin: string) => {
        if (!walletId) {
            const message = tr('wallet_v2_error_session_missing', 'Wallet session is missing');
            setPinAuthError(message);
            setStatusError(message);
            return;
        }

        if (!isValidPin(newPin)) {
            setPinAuthError(tr('wallet_v2_error_new_pin_length', 'New PIN must contain 4 digits'));
            haptic.error();
            return;
        }

        setIsPinAuthSubmitting(true);
        setPinAuthError('');
        clearInlineStatus();

        try {
            await api.walletV2.changePin({
                walletId,
                newPin,
            });

            setWalletV2StoredPinConfigured(true);
            markWalletV2RememberedAuth(walletId);
            setPinFlow('none');
            setStatusSuccess(tr('wallet_v2_pin_changed_success', 'PIN updated successfully.'));
            haptic.success();
        } catch (error) {
            const message = safeErrorMessage(error);
            setPinAuthError(message);
            setStatusError(message);
            haptic.error();
        } finally {
            setIsPinAuthSubmitting(false);
        }
    }, [clearInlineStatus, haptic, tr, walletId]);

    const handlePinSetupComplete = useCallback(async (pin: string) => {
        if (pinFlow === 'create_wallet') {
            await handleCreateWallet(pin);
            return;
        }

        if (pinFlow === 'change_pin') {
            await handleChangePin(pin);
        }
    }, [handleChangePin, handleCreateWallet, pinFlow]);

    const handleCopyPhrase = useCallback(async () => {
        if (!mnemonicPhrase) {
            return;
        }

        try {
            await writeToClipboard(mnemonicPhrase);
            setIsMnemonicCopied(true);
            haptic.success();
            window.setTimeout(() => {
                setIsMnemonicCopied(false);
            }, 1500);
        } catch {
            haptic.error();
        }
    }, [haptic, mnemonicPhrase]);

    const handleRememberTimeoutSelect = useCallback((minutes: number) => {
        setWalletV2RememberTimeoutMinutes(minutes);
        setRememberTimeoutMinutesState(minutes);
        setIsRememberDropdownOpen(false);
        haptic.selection();
    }, [haptic]);

    const pinSubtitle = pinFlow === 'create_wallet'
        ? tr('wallet_v2_settings_create_wallet_subtitle', 'Set a PIN for the new wallet before generation.')
        : pinFlow === 'change_pin'
            ? tr('wallet_v2_settings_change_pin_subtitle', 'Create a new PIN. Old PIN is not required.')
            : tr('wallet_v2_unlock_subtitle', 'Use biometric or PIN to continue.');

    const biometricIconKind = useMemo(() => {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

        return resolveWalletV2BiometricVisualType(webApp?.platform, {
            biometricType: webApp?.BiometricManager?.biometricType,
            userAgent,
        });
    }, [webApp?.BiometricManager?.biometricType, webApp?.platform]);

    const canUseUnlockBiometric = Boolean(pinFlow === 'unlock' && isBiometricEnabled && deviceBiometricSupported);

    return (
        <>
            <TelegramBackButton href="/wallet-v2" />

            <div className={styles.container}>
                <main className={styles.main}>
                    <header className={styles.header}>
                        <h1>{tr('wallet_v2_settings_title', 'Wallet v2 settings')}</h1>
                    </header>

                    {statusError && <p className={styles.statusError}>{statusError}</p>}
                    {statusSuccess && <p className={styles.statusSuccess}>{statusSuccess}</p>}

                    <div className={styles.settingsList}>
                        <SettingActionItem
                            mode="toggle"
                            icon={biometricIconKind === 'face'
                                ? <TbFaceId size={20} color="white" />
                                : <IoFingerPrint size={20} color="white" />}
                            iconBackground="linear-gradient(135deg, #0ea5e9, #0284c7)"
                            label={tr('wallet_v2_settings_biometric_title', 'Biometric confirmation')}
                            checked={isBiometricEnabled && isBiometricAvailable}
                            onCheckedChange={handleToggleBiometric}
                            ariaLabel={tr('wallet_v2_settings_biometric_title', 'Biometric confirmation')}
                            disabled={!walletId || !isBiometricAvailable || isBiometricChecking}
                        />

                        <SettingActionItem
                            mode="select"
                            icon={<IoTimer size={20} color="white" />}
                            iconBackground="linear-gradient(135deg, #64748b, #475569)"
                            label={tr('wallet_v2_settings_remember_title', 'Remember login')}
                            value={rememberValueLabel}
                            open={isRememberDropdownOpen}
                            onToggleOpen={() => {
                                setIsRememberDropdownOpen((prev) => !prev);
                                haptic.impact('light');
                            }}
                            onRequestClose={() => {
                                setIsRememberDropdownOpen(false);
                            }}
                            selectButtonClassName={styles.rememberSelectButton}
                            selectValueClassName={styles.rememberSelectValue}
                            options={rememberOptions.map((option) => ({
                                key: option.key,
                                active: option.minutes === rememberTimeoutMinutes,
                                onSelect: () => handleRememberTimeoutSelect(option.minutes),
                                label: option.label,
                            }))}
                            disabled={!walletId}
                        />

                        <SettingActionItem
                            mode="disclosure"
                            icon={<IoAddCircle size={20} color="white" />}
                            iconBackground="linear-gradient(135deg, #22c55e, #16a34a)"
                            label={tr('wallet_v2_settings_create_wallet_button', 'Create new wallet')}
                            onPress={handleOpenCreateWallet}
                            disabled={!isAuthenticated}
                        />

                        <SettingActionItem
                            mode="disclosure"
                            icon={<IoLockClosed size={20} color="white" />}
                            iconBackground="linear-gradient(135deg, #f59e0b, #ea580c)"
                            label={tr('wallet_v2_settings_change_pin_button', 'Change PIN')}
                            onPress={() => {
                                clearInlineStatus();
                                setPinAuthError('');
                                setPinFlow('change_pin');
                                haptic.impact('light');
                            }}
                            disabled={!walletId}
                        />

                        <SettingActionItem
                            mode="disclosure"
                            icon={<IoKey size={20} color="white" />}
                            iconBackground="linear-gradient(135deg, #f59e0b, #ea580c)"
                            label={tr('wallet_v2_settings_recovery_title', 'Recovery phrase')}
                            onPress={openPhraseWithAuthGuard}
                            disabled={!walletId}
                        />
                    </div>
                </main>
            </div>

            <BottomDrawer
                open={isMnemonicDrawerOpen}
                onClose={() => {
                    setIsMnemonicDrawerOpen(false);
                    // Clear mnemonic from localStorage after user closes the drawer.
                    const currentWalletId = walletId || api.walletV2.session.getWalletId();
                    if (currentWalletId) {
                        setWalletV2MnemonicWords(currentWalletId, []);
                    }
                    setMnemonicWords([]);
                }}
                title={tr('wallet_v2_settings_recovery_drawer_title', 'Recovery phrase')}
                overlayClassName={styles.drawerOverlay}
                drawerClassName={styles.drawer}
                bodyClassName={styles.drawerBody}
            >
                <div className={styles.drawerContent}>
                    {hasMnemonicWords ? (
                        <div className={styles.wordsColumns}>
                            {mnemonicColumns.map((columnWords, columnIndex) => (
                                <div key={columnIndex} className={styles.wordsColumn}>
                                    {columnWords.map((word, wordIndex) => {
                                        const visibleIndex = columnIndex * 12 + wordIndex + 1;

                                        return (
                                            <div key={`${visibleIndex}-${word}`} className={styles.wordItem}>
                                                <span className={styles.wordIndex}>{visibleIndex}</span>
                                                <span className={styles.wordValue}>{word}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className={styles.emptyText}>
                            {tr(
                                'wallet_v2_settings_recovery_missing',
                                'Recovery phrase is not available on this device yet. Re-import wallet on this device to store words locally.',
                            )}
                        </p>
                    )}

                    <div className={styles.warningBox}>
                        <IoWarning size={18} />
                        <p>
                            {tr(
                                'wallet_v2_settings_recovery_warning',
                                'If someone learns your 24 words, they can access your assets. Keep them private and never share.',
                            )}
                        </p>
                    </div>

                    <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => {
                            void handleCopyPhrase();
                        }}
                        disabled={!hasMnemonicWords}
                    >
                        {isMnemonicCopied ? <IoCheckmark size={16} /> : <IoCopy size={16} />}
                        {isMnemonicCopied
                            ? tr('wallet_copied', 'Copied')
                            : tr('wallet_v2_settings_copy_phrase', 'Copy 24 words')}
                    </Button>
                </div>
            </BottomDrawer>

            {isPinAuthOpen && (
                <PinAuthScreen
                    key={pinFlow}
                    open={isPinAuthOpen}
                    mode={pinFlow === 'unlock' ? 'confirm' : 'setup'}
                    subtitle={pinSubtitle}
                    backLabel={tr('back', 'Back')}
                    biometricLabel={tr('wallet_v2_unlock_with_biometric', 'Unlock with biometric')}
                    errorMessage={pinAuthError}
                    isSubmitting={isPinAuthSubmitting}
                    minLength={PIN_MIN_LENGTH}
                    maxLength={PIN_MAX_LENGTH}
                    biometricEnabled={canUseUnlockBiometric}
                    isBiometricLoading={isPinAuthBiometricLoading}
                    biometricIconKind={biometricIconKind}
                    autoTriggerBiometric={canUseUnlockBiometric}
                    onSetupComplete={handlePinSetupComplete}
                    onPinConfirm={handleUnlockWithPin}
                    onBiometricConfirm={handleUnlockWithBiometric}
                    onSetupMismatch={() => {
                        const mismatchMessage = pinFlow === 'change_pin'
                            ? tr('wallet_v2_error_new_pin_mismatch', 'New PIN confirmation does not match')
                            : tr('wallet_v2_error_pin_mismatch', 'PIN confirmation does not match');
                        setPinAuthError(mismatchMessage);
                        haptic.error();
                    }}
                    onPinChange={() => {
                        setPinAuthError('');
                    }}
                />
            )}
        </>
    );
}
