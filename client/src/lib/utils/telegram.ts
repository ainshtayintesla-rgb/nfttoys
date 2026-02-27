export interface ITelegramUser {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  language_code: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface IWebAppInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type IWebAppEventName =
  | 'viewportChanged'
  | 'themeChanged'
  | 'mainButtonClicked'
  | 'backButtonClicked'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'
  | string;

export interface IWebApp {
  initData: string;
  initDataUnsafe: {
    query_id: string;
    user: ITelegramUser;
    auth_date: string;
    hash: string;
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: {
    bg_color: string;
    text_color: string;
    hint_color: string;
    link_color: string;
    button_color: string;
    button_text_color: string;
    secondary_bg_color: string;
  };
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: Partial<IWebAppInsets>;
  contentSafeAreaInset?: Partial<IWebAppInsets>;
  isClosingConfirmationEnabled: boolean;
  isFullscreen?: boolean;
  headerColor: string;
  backgroundColor: string;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  BackButton: {
    isVisible: boolean;
    onClick: (cb: VoidFunction) => void;
    offClick: (cb: VoidFunction) => void;
    show: VoidFunction;
    hide: VoidFunction;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText: (text: string) => void;
    onClick: (cb: VoidFunction) => void;
    offClick: (cb: VoidFunction) => void;
    show: VoidFunction;
    hide: VoidFunction;
    enable: VoidFunction;
    disable: VoidFunction;
    showProgress: (leave: boolean) => void;
    hideProgress: VoidFunction;
    setParams: (params: any) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: VoidFunction;
  };
  CloudStorage: {
    setItem: (key: string, value: string, callback?: (error: Error | null, success?: boolean) => void) => void;
    getItem: (key: string, callback: (error: Error | null, value?: string) => void) => void;
    getItems: (keys: string[], callback: (error: Error | null, values?: Record<string, string>) => void) => void;
    removeItem: (key: string, callback?: (error: Error | null, success?: boolean) => void) => void;
    removeItems: (keys: string[], callback?: (error: Error | null, success?: boolean) => void) => void;
    getKeys: (callback: (error: Error | null, keys?: string[]) => void) => void;
  };
  close: VoidFunction;
  expand: VoidFunction;
  ready: VoidFunction;
  requestFullscreen?: VoidFunction;
  onEvent?: (event: IWebAppEventName, callback: (...args: unknown[]) => void) => void;
  offEvent?: (event: IWebAppEventName, callback: (...args: unknown[]) => void) => void;
  // Swipe and closing controls
  disableVerticalSwipes: VoidFunction;
  enableVerticalSwipes: VoidFunction;
  isVerticalSwipesEnabled: boolean;
  enableClosingConfirmation: VoidFunction;
  disableClosingConfirmation: VoidFunction;
  showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
  // QR Scanner (Telegram 6.4+)
  showScanQrPopup: (params: { text?: string }, callback: (text: string) => boolean | void) => void;
  closeScanQrPopup: VoidFunction;
  // Open Telegram links natively
  openTelegramLink: (url: string) => void;
  // Request write access (Telegram 6.9+) - ask user for permission to send messages
  requestWriteAccess: (callback?: (allowed: boolean) => void) => void;
}

const mockWebApp: IWebApp = {
  initData: '',
  initDataUnsafe: {
    query_id: 'mock_query_id',
    user: {
      id: 123456789,
      first_name: 'Abdulloh',
      last_name: 'Dev',
      username: 'abdulloh_dev',
      language_code: 'en',
    },
    auth_date: '1700000000',
    hash: 'mock_hash',
  },
  version: '6.0',
  platform: 'unknown',
  colorScheme: 'dark',
  themeParams: {
    bg_color: '#121212',
    text_color: '#ffffff',
    hint_color: '#aaaaaa',
    link_color: '#3390ec',
    button_color: '#3390ec',
    button_text_color: '#ffffff',
    secondary_bg_color: '#1E1E1E',
  },
  isExpanded: true,
  viewportHeight: 600,
  viewportStableHeight: 600,
  safeAreaInset: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  contentSafeAreaInset: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  isClosingConfirmationEnabled: false,
  isFullscreen: false,
  headerColor: '#121212',
  backgroundColor: '#121212',
  setHeaderColor: (color: string) => {
    console.log('[Mock] Set Header Color:', color);
    mockWebApp.headerColor = color;
  },
  setBackgroundColor: (color: string) => {
    console.log('[Mock] Set Background Color:', color);
    mockWebApp.backgroundColor = color;
  },
  setBottomBarColor: (color: string) => {
    console.log('[Mock] Set Bottom Bar Color:', color);
  },
  BackButton: {
    isVisible: false,
    onClick: () => { },
    offClick: () => { },
    show: () => { },
    hide: () => { },
  },
  MainButton: {
    text: 'CONTINUE',
    color: '#3390ec',
    textColor: '#ffffff',
    isVisible: false,
    isActive: true,
    isProgressVisible: false,
    setText: () => { },
    onClick: () => { },
    offClick: () => { },
    show: () => { },
    hide: () => { },
    enable: () => { },
    disable: () => { },
    showProgress: () => { },
    hideProgress: () => { },
    setParams: () => { },
  },
  HapticFeedback: {
    impactOccurred: () => console.log('[Mock] Haptic Impact'),
    notificationOccurred: () => console.log('[Mock] Haptic Notification'),
    selectionChanged: () => console.log('[Mock] Haptic Selection'),
  },
  CloudStorage: {
    setItem: (key: string, value: string, cb?: (err: Error | null, success?: boolean) => void) => {
      localStorage.setItem(`tg_cloud_${key}`, value);
      if (cb) cb(null, true);
    },
    getItem: (key: string, cb: (err: Error | null, value?: string) => void) => {
      const value = localStorage.getItem(`tg_cloud_${key}`);
      cb(null, value || undefined);
    },
    getItems: (keys: string[], cb: (err: Error | null, values?: Record<string, string>) => void) => {
      const values: Record<string, string> = {};
      keys.forEach(k => {
        const v = localStorage.getItem(`tg_cloud_${k}`);
        if (v) values[k] = v;
      });
      cb(null, values);
    },
    removeItem: (key: string, cb?: (err: Error | null, success?: boolean) => void) => {
      localStorage.removeItem(`tg_cloud_${key}`);
      if (cb) cb(null, true);
    },
    removeItems: (keys: string[], cb?: (err: Error | null, success?: boolean) => void) => {
      keys.forEach(k => localStorage.removeItem(`tg_cloud_${k}`));
      if (cb) cb(null, true);
    },
    getKeys: (cb: (err: Error | null, keys?: string[]) => void) => {
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith('tg_cloud_'))
        .map(k => k.replace('tg_cloud_', ''));
      cb(null, keys);
    },
  },
  close: () => console.log('[Mock] Close WebApp'),
  expand: () => console.log('[Mock] Expand WebApp'),
  ready: () => console.log('[Mock] WebApp Ready'),
  requestFullscreen: () => {
    console.log('[Mock] Request Fullscreen');
    mockWebApp.isFullscreen = true;
  },
  onEvent: () => { },
  offEvent: () => { },
  disableVerticalSwipes: () => console.log('[Mock] Disable Vertical Swipes'),
  enableVerticalSwipes: () => console.log('[Mock] Enable Vertical Swipes'),
  isVerticalSwipesEnabled: true,
  enableClosingConfirmation: () => console.log('[Mock] Enable Closing Confirmation'),
  disableClosingConfirmation: () => console.log('[Mock] Disable Closing Confirmation'),
  showConfirm: (msg: string, cb: (confirmed: boolean) => void) => {
    console.log('[Mock] Show Confirm:', msg);
    cb(true);
  },
  showScanQrPopup: (params: { text?: string }, cb: (text: string) => boolean | void) => {
    console.log('[Mock] Show QR Scanner:', params.text);
    // For mock, we just log - real TG will show native scanner
  },
  closeScanQrPopup: () => {
    console.log('[Mock] Close QR Scanner');
  },
  openTelegramLink: (url: string) => {
    console.log('[Mock] Open Telegram Link:', url);
    window.open(url, '_blank');
  },
  requestWriteAccess: (cb?: (allowed: boolean) => void) => {
    console.log('[Mock] Request Write Access');
    if (cb) cb(true);
  },
};

export const getTelegramWebApp = (): IWebApp | null => {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
    return (window as any).Telegram.WebApp;
  }
  // In development, return mock for testing
  // In production, return null (browser visitors will be redirected to Telegram)
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    return mockWebApp;
  }
  return null;
};
