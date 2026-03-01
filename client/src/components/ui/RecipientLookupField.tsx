import React from 'react';

import { SegmentedTabs } from './SegmentedTabs';
import styles from './RecipientLookupField.module.css';

export type RecipientLookupType = 'username' | 'wallet';

interface WalletSuggestion {
    displayName: string;
    address: string;
    photoUrl?: string | null;
    onSelect: () => void;
}

interface RecipientLookupFieldProps {
    recipientType: RecipientLookupType;
    onRecipientTypeChange: (nextType: RecipientLookupType) => void;
    walletTabLabel: string;
    usernameValue: string;
    walletValue: string;
    usernamePlaceholder: string;
    walletPlaceholder: string;
    onUsernameChange: (value: string) => void;
    onWalletChange: (value: string) => void;
    usernameAvatarUrl?: string | null;
    walletPrefix?: string;
    walletSuggestion?: WalletSuggestion | null;
    className?: string;
}

function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export function RecipientLookupField({
    recipientType,
    onRecipientTypeChange,
    walletTabLabel,
    usernameValue,
    walletValue,
    usernamePlaceholder,
    walletPlaceholder,
    onUsernameChange,
    onWalletChange,
    usernameAvatarUrl,
    walletPrefix = 'LV-',
    walletSuggestion,
    className,
}: RecipientLookupFieldProps) {
    const hasWalletSuggestion = recipientType === 'wallet'
        && Boolean(walletSuggestion?.address);

    return (
        <div className={cx(styles.root, className)}>
            <SegmentedTabs
                className={styles.tabs}
                tabClassName={styles.tab}
                activeTabClassName={styles.tabActive}
                items={[
                    { key: 'username' as const, label: '@username' },
                    { key: 'wallet' as const, label: walletTabLabel },
                ]}
                activeKey={recipientType}
                onChange={onRecipientTypeChange}
            />

            <div className={styles.fieldStack}>
                {hasWalletSuggestion && walletSuggestion && (
                    <button
                        type="button"
                        className={styles.walletSuggestion}
                        onClick={walletSuggestion.onSelect}
                    >
                        <span className={styles.walletSuggestionAvatarWrap}>
                            {walletSuggestion.photoUrl ? (
                                <img
                                    src={walletSuggestion.photoUrl}
                                    alt=""
                                    className={styles.walletSuggestionAvatar}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <span className={styles.walletSuggestionAvatarFallback}>@</span>
                            )}
                        </span>
                        <span className={styles.walletSuggestionMeta}>
                            <span className={styles.walletSuggestionName}>{walletSuggestion.displayName}</span>
                            <span className={styles.walletSuggestionAddress}>{walletSuggestion.address}</span>
                        </span>
                    </button>
                )}

                <div className={cx(styles.inputWrap, hasWalletSuggestion && styles.inputWrapConnected)}>
                    {recipientType === 'username' ? (
                        <span className={styles.inputPrefixSlot}>
                            {usernameAvatarUrl ? (
                                <img
                                    src={usernameAvatarUrl}
                                    alt=""
                                    className={styles.inputPrefixAvatar}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <span className={styles.inputPrefix}>@</span>
                            )}
                        </span>
                    ) : (
                        <span className={styles.inputPrefix}>{walletPrefix}</span>
                    )}
                    <input
                        type="text"
                        className={styles.input}
                        value={recipientType === 'username' ? usernameValue : walletValue}
                        placeholder={recipientType === 'username' ? usernamePlaceholder : walletPlaceholder}
                        onChange={(event) => {
                            if (recipientType === 'username') {
                                onUsernameChange(event.target.value);
                                return;
                            }

                            onWalletChange(event.target.value);
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
