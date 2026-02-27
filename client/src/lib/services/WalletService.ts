export interface Transaction {
    id: string;
    type: 'transfer' | 'receive';
    assetId?: string;
    assetName?: string;
    amount?: number;
    fromUser?: string;
    toUser?: string;
    timestamp: number;
    status: 'pending' | 'completed' | 'failed';
}

const STORAGE_KEY = 'wallet_transactions';

class WalletServiceImpl {
    private transactions: Transaction[] = [];

    constructor() {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                this.transactions = JSON.parse(stored);
            }
        }
    }

    private save() {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.transactions));
        }
    }

    // Mock Username Resolution
    async resolveUsername(username: string): Promise<{ id: number; name: string } | null> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 600));

        if (username.startsWith('@')) {
            username = username.substring(1);
        }

        // Mock: Accept any likely valid username, reject short ones
        if (username.length < 4) return null;

        return {
            id: Math.floor(Math.random() * 10000) + 1000,
            name: username
        };
    }

    async transferToy(toyId: string, toyName: string, fromUsername: string, toUsername: string): Promise<Transaction> {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate tx time

        const tx: Transaction = {
            id: `tx_${Date.now()}`,
            type: 'transfer',
            assetId: toyId,
            assetName: toyName,
            fromUser: fromUsername,
            toUser: toUsername,
            timestamp: Date.now(),
            status: 'completed'
        };

        this.transactions.unshift(tx);
        this.save();
        return tx;
    }

    getHistory(username?: string): Transaction[] {
        // In a real app, filter by user. For mock, return all.
        return this.transactions;
    }
}

export const WalletService = new WalletServiceImpl();
