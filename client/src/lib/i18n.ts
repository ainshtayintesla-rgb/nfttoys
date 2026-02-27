import en from './locales/en.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

export type Locale = 'en' | 'ru' | 'uz';

export type TranslationKey = keyof typeof en;

export const translations: Record<Locale, Record<TranslationKey, string>> = {
    en,
    ru,
    uz,
};
