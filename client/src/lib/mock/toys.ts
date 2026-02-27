import { PEPE_MODELS, PepeModel } from '@/lib/data/pepe_models';

export interface Toy {
    id: string;
    name: string;
    model: string;
    serialNumber?: string;
    rarity: 'common' | 'rare' | 'legendary';
    price: number;
    imageUrl: string;
    tgsUrl?: string;
    status: 'available' | 'sold' | 'activated';
    ownerId?: number;
    nfcId?: string;
    rarityChance: number;
}

// Pricing rules based on rarity (in UZS)
const getPrice = (rarity: string) => {
    switch (rarity) {
        case 'legendary': return 2500000;
        case 'rare': return 650000;
        case 'common': return 199000;
        default: return 50000;
    }
};

// Generate a curated list for the store
const generateStoreInventory = (): Toy[] => {
    // Select specific interesting models to showcase
    const showcaseModels = [
        'Midas Pepe', 'X-Ray', 'Gucci Leap', 'Pink Galaxy', 'Steel Frog', 'Emerald Plush', // Legendary
        'Polka Dots', 'Magnate', 'Spectrum', 'Santa Pepe', 'Christmas', 'Amalgam', // Rare
        'Ninja Mike', 'Raphael', 'Bavaria', 'Pumpkin', 'Yellow Hug', 'Tropical' // Common
    ];

    return showcaseModels.map((name, index) => {
        const modelData = PEPE_MODELS.find(m => m.name === name);
        if (!modelData) return null;

        // Generate a deterministic serial number based on index
        const serialNum = ((index * 17 + 23) % 100) + 1;
        const serialStr = `#${serialNum.toString().padStart(3, '0')}`;

        return {
            id: `toy_${index + 1}`,
            name: modelData.name,
            model: `Series 1`,
            serialNumber: serialStr,
            rarity: modelData.rarity,
            price: getPrice(modelData.rarity),
            imageUrl: `/toys/pepe_default.png`,
            tgsUrl: `/models/${modelData.tgsFile}`, // Use the tgsFile from model
            status: 'available',
            nfcId: `nfc_${name.toLowerCase().replace(/\s/g, '_')}`,
            rarityChance: modelData.chance,
        };
    }).filter(Boolean) as Toy[];
};

export const mockToys: Toy[] = generateStoreInventory();