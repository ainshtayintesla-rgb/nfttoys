#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import signal
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import Forbidden, TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

SUPPORTED_LANGUAGES = ('ru', 'en', 'uz')
WRITE_ACCESS_STATUSES = ('unknown', 'allowed', 'denied', 'blocked')

DEFAULT_MINI_APP_URL = 'https://t.me'
DEFAULT_BOT_START_URL = 'https://t.me'

TEXTS: dict[str, dict[str, str]] = {
    'ru': {
        'start': (
            'Привет! Это NFT Toys.\n\n'
            'Здесь ты можешь активировать, хранить и отправлять NFT в Mini App.\n\n'
            'Команды:\n'
            '/language - выбрать язык\n'
            '/help - помощь'
        ),
        'help': (
            'Команды бота:\n'
            '/start - запуск и описание\n'
            '/language - язык бота\n'
            '/help - список команд'
        ),
        'language_prompt': 'Выбери язык уведомлений бота:',
        'language_saved': 'Язык сохранен: {language}.',
        'open_profile': 'Открыть профиль',
        'notify_title': '🎁 Вам отправили NFT',
        'notify_sender': 'Отправитель',
        'notify_model': 'Модель',
        'notify_number': 'Номер',
        'notify_rarity': 'Редкость',
        'notify_token': 'ID',
        'fallback_sender': 'пользователь',
    },
    'en': {
        'start': (
            'Hi! This is NFT Toys.\n\n'
            'You can activate, store, and transfer NFTs in the Mini App.\n\n'
            'Commands:\n'
            '/language - choose language\n'
            '/help - help'
        ),
        'help': (
            'Bot commands:\n'
            '/start - intro\n'
            '/language - bot language\n'
            '/help - command list'
        ),
        'language_prompt': 'Choose bot notification language:',
        'language_saved': 'Language saved: {language}.',
        'open_profile': 'Open Profile',
        'notify_title': '🎁 You received an NFT',
        'notify_sender': 'Sender',
        'notify_model': 'Model',
        'notify_number': 'Number',
        'notify_rarity': 'Rarity',
        'notify_token': 'ID',
        'fallback_sender': 'user',
    },
    'uz': {
        'start': (
            'Salom! Bu NFT Toys.\n\n'
            'Mini App ichida NFT ni faollashtirish, saqlash va yuborish mumkin.\n\n'
            'Buyruqlar:\n'
            '/language - tilni tanlash\n'
            '/help - yordam'
        ),
        'help': (
            'Bot buyruqlari:\n'
            '/start - boshlash\n'
            '/language - bot tili\n'
            '/help - buyruqlar ro\'yxati'
        ),
        'language_prompt': 'Bot bildirishnomalari tilini tanlang:',
        'language_saved': 'Til saqlandi: {language}.',
        'open_profile': 'Profilni ochish',
        'notify_title': '🎁 Sizga NFT yuborildi',
        'notify_sender': 'Yuboruvchi',
        'notify_model': 'Model',
        'notify_number': 'Raqam',
        'notify_rarity': 'Noyoblik',
        'notify_token': 'ID',
        'fallback_sender': 'foydalanuvchi',
    },
}

LANGUAGE_LABELS: dict[str, str] = {
    'ru': 'Русский',
    'en': 'English',
    'uz': "O'zbekcha",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


def normalize_lang(value: str | None, fallback: str) -> str:
    if not value:
        return fallback

    code = value.lower().strip()
    if len(code) > 2:
        code = code[:2]

    if code in SUPPORTED_LANGUAGES:
        return code

    return fallback


def normalize_write_access_status(value: Any) -> str:
    if isinstance(value, str):
        status = value.strip().lower()
        if status in WRITE_ACCESS_STATUSES:
            return status

    return 'unknown'


@dataclass(frozen=True)
class BotConfig:
    token: str
    internal_token: str
    host: str
    port: int
    profile_url: str
    start_url: str
    default_language: str
    language_file: Path
    prefs_file: Path
    server_url: str
    bot_service_token: str

    @classmethod
    def from_env(cls) -> 'BotConfig':
        env_file = Path(os.getenv('BOT_ENV_FILE', '/root/nfttoys/bot/.env'))
        load_env_file(env_file)

        token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
        internal_token = os.getenv('BOT_INTERNAL_TOKEN', '').strip()
        host = os.getenv('BOT_HOST', '127.0.0.1').strip() or '127.0.0.1'
        port_raw = os.getenv('BOT_PORT', '8090').strip() or '8090'
        profile_url = os.getenv('MINI_APP_PROFILE_URL', '').strip()
        start_url = os.getenv('BOT_START_URL', '').strip()
        default_language = normalize_lang(os.getenv('DEFAULT_LANGUAGE', 'ru'), 'ru')
        language_file = Path(os.getenv('BOT_LANG_STORE', '/root/nfttoys/bot/data/user_lang.json')).expanduser()
        prefs_file = Path(os.getenv('BOT_PREFS_STORE', '/root/nfttoys/bot/data/user_prefs.json')).expanduser()
        server_url = os.getenv('SERVER_URL', 'http://127.0.0.1:3000').strip().rstrip('/')
        bot_service_token = os.getenv('BOT_SERVICE_TOKEN', '').strip()

        try:
            port = int(port_raw)
        except ValueError as error:
            raise RuntimeError(f'Invalid BOT_PORT value: {port_raw}') from error

        if not token:
            raise RuntimeError('TELEGRAM_BOT_TOKEN is required for bot service')

        if not internal_token:
            raise RuntimeError('BOT_INTERNAL_TOKEN is required for bot service')

        return cls(
            token=token,
            internal_token=internal_token,
            host=host,
            port=port,
            profile_url=profile_url,
            start_url=start_url,
            default_language=default_language,
            language_file=language_file,
            prefs_file=prefs_file,
            server_url=server_url,
            bot_service_token=bot_service_token,
        )


class LanguageStore:
    def __init__(self, path: Path, default_language: str):
        self.path = path
        self.default_language = default_language
        self._lock = asyncio.Lock()
        self._data: dict[str, str] = {}

    async def load(self) -> None:
        async with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)

            if not self.path.exists():
                self.path.write_text('{}', encoding='utf-8')
                self._data = {}
                return

            try:
                content = self.path.read_text(encoding='utf-8').strip() or '{}'
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    self._data = {
                        str(key): normalize_lang(str(value), self.default_language)
                        for key, value in parsed.items()
                    }
                else:
                    self._data = {}
            except Exception:
                logging.exception('Failed to read language store, resetting %s', self.path)
                self._data = {}

    async def get(self, user_id: int | str) -> str | None:
        async with self._lock:
            return self._data.get(str(user_id))

    async def set(self, user_id: int | str, language: str) -> str:
        lang = normalize_lang(language, self.default_language)

        async with self._lock:
            self._data[str(user_id)] = lang
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(self._data, ensure_ascii=False, indent=2),
                encoding='utf-8',
            )

        return lang


class UserPreferencesStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = asyncio.Lock()
        self._data: dict[str, dict[str, Any]] = {}

    def _has_write_capability(self, entry: dict[str, Any]) -> bool:
        status = normalize_write_access_status(entry.get('write_access_status'))
        bot_started = bool(entry.get('bot_started'))
        return status != 'blocked' and (status == 'allowed' or bot_started)

    def _normalize_entry(self, raw_entry: Any) -> dict[str, Any]:
        if not isinstance(raw_entry, dict):
            raw_entry = {}

        entry: dict[str, Any] = {
            'write_access_status': normalize_write_access_status(raw_entry.get('write_access_status')),
            'bot_started': bool(raw_entry.get('bot_started')),
            'notifications_enabled': raw_entry.get('notifications_enabled') if isinstance(raw_entry.get('notifications_enabled'), bool) else None,
            'nft_received_enabled': raw_entry.get('nft_received_enabled') if isinstance(raw_entry.get('nft_received_enabled'), bool) else None,
            'preferences_touched': bool(raw_entry.get('preferences_touched')),
            'created_at': str(raw_entry.get('created_at') or now_iso()),
            'updated_at': str(raw_entry.get('updated_at') or now_iso()),
        }

        can_receive = self._has_write_capability(entry)

        if not entry['preferences_touched']:
            entry['notifications_enabled'] = can_receive
            entry['nft_received_enabled'] = can_receive
        else:
            if entry['notifications_enabled'] is None:
                entry['notifications_enabled'] = False
            if entry['nft_received_enabled'] is None:
                entry['nft_received_enabled'] = bool(entry['notifications_enabled'])

        if not can_receive:
            entry['notifications_enabled'] = False
            entry['nft_received_enabled'] = False

        if not entry['notifications_enabled']:
            entry['nft_received_enabled'] = False

        return entry

    def _serialize_for_client(self, user_id: str, entry: dict[str, Any], bot_start_url: str) -> dict[str, Any]:
        status = normalize_write_access_status(entry.get('write_access_status'))
        bot_started = bool(entry.get('bot_started'))
        has_write_access = status == 'allowed' or bot_started
        bot_blocked = status == 'blocked'
        can_manage = has_write_access and not bot_blocked

        return {
            'telegramId': user_id,
            'writeAccessStatus': status,
            'hasWriteAccess': has_write_access,
            'botBlocked': bot_blocked,
            'botStarted': bot_started,
            'canManageNotifications': can_manage,
            'notificationsEnabled': bool(entry.get('notifications_enabled')),
            'types': {
                'nftReceived': bool(entry.get('nft_received_enabled')),
            },
            'botStartUrl': bot_start_url,
            'updatedAt': entry.get('updated_at'),
        }

    async def _save_locked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding='utf-8')

    async def _ensure_entry_locked(self, user_key: str) -> dict[str, Any]:
        raw_entry = self._data.get(user_key)
        normalized = self._normalize_entry(raw_entry)
        self._data[user_key] = normalized
        return normalized

    async def load(self) -> None:
        async with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)

            if not self.path.exists():
                self.path.write_text('{}', encoding='utf-8')
                self._data = {}
                return

            try:
                content = self.path.read_text(encoding='utf-8').strip() or '{}'
                parsed = json.loads(content)
                if not isinstance(parsed, dict):
                    parsed = {}
            except Exception:
                logging.exception('Failed to read preferences store, resetting %s', self.path)
                parsed = {}

            self._data = {
                str(key): self._normalize_entry(value)
                for key, value in parsed.items()
            }

            await self._save_locked()

    async def get_public(self, user_id: int | str, bot_start_url: str) -> dict[str, Any]:
        async with self._lock:
            user_key = str(user_id)
            entry = await self._ensure_entry_locked(user_key)
            await self._save_locked()
            return self._serialize_for_client(user_key, entry, bot_start_url)

    async def set_write_access_status(self, user_id: int | str, status: str, bot_start_url: str) -> dict[str, Any]:
        normalized_status = normalize_write_access_status(status)

        async with self._lock:
            user_key = str(user_id)
            entry = await self._ensure_entry_locked(user_key)
            entry['write_access_status'] = normalized_status
            entry['updated_at'] = now_iso()

            # Blocked/denied should always disable pushes until user re-authorizes.
            if normalized_status in {'blocked', 'denied'}:
                entry['notifications_enabled'] = False
                entry['nft_received_enabled'] = False

            entry = self._normalize_entry(entry)
            self._data[user_key] = entry
            await self._save_locked()
            return self._serialize_for_client(user_key, entry, bot_start_url)

    async def mark_bot_started(self, user_id: int | str, bot_start_url: str) -> dict[str, Any]:
        async with self._lock:
            user_key = str(user_id)
            entry = await self._ensure_entry_locked(user_key)
            entry['bot_started'] = True
            entry['write_access_status'] = 'allowed'
            entry['updated_at'] = now_iso()
            entry = self._normalize_entry(entry)
            self._data[user_key] = entry
            await self._save_locked()
            return self._serialize_for_client(user_key, entry, bot_start_url)

    async def update_preferences(
        self,
        user_id: int | str,
        bot_start_url: str,
        notifications_enabled: bool | None,
        nft_received_enabled: bool | None,
    ) -> dict[str, Any]:
        async with self._lock:
            user_key = str(user_id)
            entry = await self._ensure_entry_locked(user_key)

            can_manage = self._has_write_capability(entry)

            if notifications_enabled is True and not can_manage:
                raise PermissionError('write_access_required')
            if nft_received_enabled is True and not can_manage:
                raise PermissionError('write_access_required')

            if notifications_enabled is not None:
                entry['preferences_touched'] = True
                entry['notifications_enabled'] = notifications_enabled
                if not notifications_enabled:
                    entry['nft_received_enabled'] = False

            if nft_received_enabled is not None:
                entry['preferences_touched'] = True
                entry['nft_received_enabled'] = nft_received_enabled and bool(entry.get('notifications_enabled'))

            entry['updated_at'] = now_iso()
            entry = self._normalize_entry(entry)
            self._data[user_key] = entry
            await self._save_locked()
            return self._serialize_for_client(user_key, entry, bot_start_url)


def t(lang: str, key: str) -> str:
    base_lang = lang if lang in TEXTS else 'ru'
    return TEXTS[base_lang].get(key, TEXTS['ru'].get(key, key))


def build_language_keyboard(active_lang: str) -> InlineKeyboardMarkup:
    rows = []
    for code in SUPPORTED_LANGUAGES:
        label = LANGUAGE_LABELS[code]
        if code == active_lang:
            label = f'✓ {label}'
        rows.append([InlineKeyboardButton(label, callback_data=f'lang:{code}')])

    return InlineKeyboardMarkup(rows)


def build_profile_url(config: BotConfig, bot_username: str | None) -> str:
    if config.profile_url:
        return config.profile_url

    username = (bot_username or '').strip().lstrip('@')
    if username:
        return f'https://t.me/{username}?startapp=profile'

    return DEFAULT_MINI_APP_URL


def build_bot_start_url(config: BotConfig, bot_username: str | None) -> str:
    if config.start_url:
        return config.start_url

    username = (bot_username or '').strip().lstrip('@')
    if username:
        return f'https://t.me/{username}?start=nfttoys_notify'

    return DEFAULT_BOT_START_URL


def build_profile_button(lang: str, config: BotConfig, bot_username: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton(
                text=t(lang, 'open_profile'),
                url=build_profile_url(config, bot_username),
            ),
        ],
    ])


async def resolve_bot_username(
    telegram_app: Application,
    known_username: str | None,
) -> str | None:
    username = (known_username or '').strip().lstrip('@')
    if username:
        return username

    try:
        bot_me = await telegram_app.bot.get_me()
        resolved = (bot_me.username or '').strip().lstrip('@')
        return resolved or None
    except TelegramError as error:
        logging.info('Failed to resolve bot username via getMe: %s', error)
        return None


async def resolve_user_language(
    user_id: int,
    telegram_language_code: str | None,
    store: LanguageStore,
    default_language: str,
) -> str:
    saved = await store.get(user_id)
    if saved:
        return saved

    inferred = normalize_lang(telegram_language_code, default_language)
    await store.set(user_id, inferred)
    return inferred


def get_runtime_objects(
    context: ContextTypes.DEFAULT_TYPE,
) -> tuple[BotConfig, LanguageStore, UserPreferencesStore, str | None]:
    config = context.application.bot_data['config']
    store = context.application.bot_data['store']
    prefs_store = context.application.bot_data['prefs_store']
    bot_username = context.application.bot_data.get('bot_username')
    return config, store, prefs_store, bot_username


async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_message:
        return

    config, store, prefs_store, bot_username = get_runtime_objects(context)
    await prefs_store.mark_bot_started(
        user_id=update.effective_user.id,
        bot_start_url=build_bot_start_url(config, bot_username),
    )

    lang = await resolve_user_language(
        user_id=update.effective_user.id,
        telegram_language_code=update.effective_user.language_code,
        store=store,
        default_language=config.default_language,
    )

    await update.effective_message.reply_text(
        t(lang, 'start'),
        reply_markup=build_profile_button(lang, config, bot_username),
        disable_web_page_preview=True,
    )


async def handle_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_message:
        return

    config, store, _, bot_username = get_runtime_objects(context)
    lang = await resolve_user_language(
        user_id=update.effective_user.id,
        telegram_language_code=update.effective_user.language_code,
        store=store,
        default_language=config.default_language,
    )

    await update.effective_message.reply_text(
        t(lang, 'help'),
        reply_markup=build_profile_button(lang, config, bot_username),
        disable_web_page_preview=True,
    )


async def handle_language(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_message:
        return

    config, store, _, _ = get_runtime_objects(context)
    lang = await resolve_user_language(
        user_id=update.effective_user.id,
        telegram_language_code=update.effective_user.language_code,
        store=store,
        default_language=config.default_language,
    )

    await update.effective_message.reply_text(
        t(lang, 'language_prompt'),
        reply_markup=build_language_keyboard(lang),
    )


async def handle_language_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not update.effective_user:
        return

    await query.answer()

    config, store, _, _ = get_runtime_objects(context)
    data = query.data or ''

    if not data.startswith('lang:'):
        return

    requested = normalize_lang(data.split(':', 1)[1], config.default_language)
    saved_lang = await store.set(update.effective_user.id, requested)

    text = t(saved_lang, 'language_saved').format(language=LANGUAGE_LABELS[saved_lang])

    await query.edit_message_text(
        text=text,
        reply_markup=build_language_keyboard(saved_lang),
    )


async def handle_pin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.effective_message:
        return

    config, _, _, _ = get_runtime_objects(context)
    telegram_id = str(update.effective_user.id)

    if not config.server_url or not config.bot_service_token:
        await update.effective_message.reply_text('Admin credentials service not configured.')
        return

    url = f'{config.server_url}/admin/auth/pin'
    headers = {
        'Authorization': f'Bearer {config.bot_service_token}',
        'Content-Type': 'application/json',
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json={'telegramId': telegram_id}, headers=headers) as resp:
                data = await resp.json()
    except Exception:
        logging.exception('Failed to contact server for /pin (telegramId=%s)', telegram_id)
        await update.effective_message.reply_text('Failed to contact server. Try again later.')
        return

    if not data.get('success'):
        code = data.get('code', '')
        if code == 'NOT_FOUND':
            await update.effective_message.reply_text('No admin account linked to your Telegram ID.')
        else:
            await update.effective_message.reply_text('Could not generate credentials. Contact the owner.')
        return

    login = escape(str(data['login']))
    password = escape(str(data['password']))
    await update.effective_message.reply_text(
        f'<b>Admin credentials</b>\n\n'
        f'Login: <code>{login}</code>\n'
        f'Password: <code>{password}</code>\n\n'
        f'<i>Change your password after first login.</i>',
        parse_mode=ParseMode.HTML,
    )


async def handle_write_access_allowed(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user:
        return

    config, _, prefs_store, bot_username = get_runtime_objects(context)
    await prefs_store.set_write_access_status(
        user_id=update.effective_user.id,
        status='allowed',
        bot_start_url=build_bot_start_url(config, bot_username),
    )


def is_request_authorized(request: web.Request, expected_token: str) -> bool:
    auth_header = request.headers.get('Authorization', '').strip()
    internal_header = request.headers.get('X-Bot-Internal-Token', '').strip()

    bearer_token = ''
    if auth_header.lower().startswith('bearer '):
        bearer_token = auth_header[7:].strip()

    return (
        (bearer_token and secrets.compare_digest(bearer_token, expected_token))
        or (internal_header and secrets.compare_digest(internal_header, expected_token))
    )


def normalize_sender(payload: dict[str, Any], lang: str) -> str:
    username = str(payload.get('senderUsername') or '').strip().lstrip('@')
    if username:
        return f'@{username}'

    first_name = str(payload.get('senderFirstName') or '').strip()
    if first_name:
        return first_name

    return t(lang, 'fallback_sender')


async def sync_block_status_from_telegram(
    telegram_app: Application,
    prefs_store: UserPreferencesStore,
    telegram_id: str,
    bot_start_url: str,
) -> None:
    chat_id: int | str = telegram_id
    if telegram_id.isdigit():
        try:
            chat_id = int(telegram_id)
        except ValueError:
            chat_id = telegram_id

    bot_id = telegram_app.bot.id
    if bot_id is None:
        try:
            bot_id = (await telegram_app.bot.get_me()).id
        except TelegramError as error:
            logging.info('Failed to resolve bot id for block sync (%s): %s', telegram_id, error)
            bot_id = None

    try:
        if bot_id is not None:
            chat_member = await telegram_app.bot.get_chat_member(chat_id=chat_id, user_id=bot_id)
            chat_member_status = str(getattr(chat_member, 'status', '')).lower()

            # "kicked" is returned for users who blocked the bot in private chat.
            if chat_member_status == 'kicked':
                await prefs_store.set_write_access_status(
                    user_id=telegram_id,
                    status='blocked',
                    bot_start_url=bot_start_url,
                )
                return

        await telegram_app.bot.get_chat(chat_id=chat_id)
    except Forbidden:
        await prefs_store.set_write_access_status(
            user_id=telegram_id,
            status='blocked',
            bot_start_url=bot_start_url,
        )
    except TelegramError as error:
        logging.info('Failed to sync bot block state for %s: %s', telegram_id, error)


async def handle_get_user_preferences(request: web.Request) -> web.Response:
    config: BotConfig = request.app['config']
    prefs_store: UserPreferencesStore = request.app['prefs_store']
    telegram_app: Application = request.app['telegram_app']
    bot_username: str | None = request.app.get('bot_username')

    if not is_request_authorized(request, config.internal_token):
        return web.json_response({'ok': False, 'error': 'unauthorized'}, status=401)

    telegram_id = str(request.query.get('telegramId') or '').strip()
    if not telegram_id:
        return web.json_response({'ok': False, 'error': 'telegramId_required'}, status=400)

    bot_start_url = build_bot_start_url(config, bot_username)
    await sync_block_status_from_telegram(
        telegram_app=telegram_app,
        prefs_store=prefs_store,
        telegram_id=telegram_id,
        bot_start_url=bot_start_url,
    )

    preferences = await prefs_store.get_public(
        user_id=telegram_id,
        bot_start_url=bot_start_url,
    )

    return web.json_response({'ok': True, 'preferences': preferences})


async def handle_update_user_preferences(request: web.Request) -> web.Response:
    config: BotConfig = request.app['config']
    prefs_store: UserPreferencesStore = request.app['prefs_store']
    telegram_app: Application = request.app['telegram_app']
    bot_username: str | None = request.app.get('bot_username')

    if not is_request_authorized(request, config.internal_token):
        return web.json_response({'ok': False, 'error': 'unauthorized'}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({'ok': False, 'error': 'invalid_json'}, status=400)

    if not isinstance(payload, dict):
        return web.json_response({'ok': False, 'error': 'invalid_payload'}, status=400)

    telegram_id = str(payload.get('telegramId') or '').strip()
    if not telegram_id:
        return web.json_response({'ok': False, 'error': 'telegramId_required'}, status=400)

    notifications_enabled = payload.get('notificationsEnabled')
    nft_received_enabled = payload.get('nftReceivedEnabled')

    if notifications_enabled is not None and not isinstance(notifications_enabled, bool):
        return web.json_response({'ok': False, 'error': 'notificationsEnabled_must_be_boolean'}, status=400)

    if nft_received_enabled is not None and not isinstance(nft_received_enabled, bool):
        return web.json_response({'ok': False, 'error': 'nftReceivedEnabled_must_be_boolean'}, status=400)

    bot_start_url = build_bot_start_url(config, bot_username)
    await sync_block_status_from_telegram(
        telegram_app=telegram_app,
        prefs_store=prefs_store,
        telegram_id=telegram_id,
        bot_start_url=bot_start_url,
    )

    try:
        preferences = await prefs_store.update_preferences(
            user_id=telegram_id,
            bot_start_url=bot_start_url,
            notifications_enabled=notifications_enabled,
            nft_received_enabled=nft_received_enabled,
        )
    except PermissionError:
        return web.json_response({'ok': False, 'error': 'write_access_required'}, status=409)

    return web.json_response({'ok': True, 'preferences': preferences})


async def handle_update_write_access(request: web.Request) -> web.Response:
    config: BotConfig = request.app['config']
    prefs_store: UserPreferencesStore = request.app['prefs_store']
    bot_username: str | None = request.app.get('bot_username')

    if not is_request_authorized(request, config.internal_token):
        return web.json_response({'ok': False, 'error': 'unauthorized'}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({'ok': False, 'error': 'invalid_json'}, status=400)

    if not isinstance(payload, dict):
        return web.json_response({'ok': False, 'error': 'invalid_payload'}, status=400)

    telegram_id = str(payload.get('telegramId') or '').strip()
    if not telegram_id:
        return web.json_response({'ok': False, 'error': 'telegramId_required'}, status=400)

    status = normalize_write_access_status(payload.get('status'))

    if payload.get('botStarted') is True:
        preferences = await prefs_store.mark_bot_started(
            user_id=telegram_id,
            bot_start_url=build_bot_start_url(config, bot_username),
        )
    else:
        preferences = await prefs_store.set_write_access_status(
            user_id=telegram_id,
            status=status,
            bot_start_url=build_bot_start_url(config, bot_username),
        )

    return web.json_response({'ok': True, 'preferences': preferences})


async def handle_get_bot_meta(request: web.Request) -> web.Response:
    config: BotConfig = request.app['config']
    telegram_app: Application = request.app['telegram_app']
    known_username: str | None = request.app.get('bot_username')

    if not is_request_authorized(request, config.internal_token):
        return web.json_response({'ok': False, 'error': 'unauthorized'}, status=401)

    bot_username = await resolve_bot_username(telegram_app, known_username)
    request.app['bot_username'] = bot_username
    telegram_app.bot_data['bot_username'] = bot_username

    return web.json_response({
        'ok': True,
        'bot': {
            'username': bot_username,
            'profileUrl': build_profile_url(config, bot_username),
            'startUrl': build_bot_start_url(config, bot_username),
        },
    })


async def handle_notify_nft_received(request: web.Request) -> web.Response:
    config: BotConfig = request.app['config']
    store: LanguageStore = request.app['store']
    prefs_store: UserPreferencesStore = request.app['prefs_store']
    telegram_app: Application = request.app['telegram_app']
    bot_username: str | None = request.app.get('bot_username')

    if not is_request_authorized(request, config.internal_token):
        return web.json_response({'ok': False, 'error': 'unauthorized'}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({'ok': False, 'error': 'invalid_json'}, status=400)

    if not isinstance(payload, dict):
        return web.json_response({'ok': False, 'error': 'invalid_payload'}, status=400)

    recipient_telegram_id = str(payload.get('recipientTelegramId') or '').strip()
    if not recipient_telegram_id:
        return web.json_response({'ok': False, 'error': 'recipientTelegramId_required'}, status=400)

    user_lang = await store.get(recipient_telegram_id)
    lang = normalize_lang(user_lang, config.default_language)
    bot_start_url = build_bot_start_url(config, bot_username)

    preferences = await prefs_store.get_public(recipient_telegram_id, bot_start_url)

    if not preferences.get('canManageNotifications'):
        return web.json_response({'ok': True, 'delivered': False, 'reason': 'write_access_required'})

    if not preferences.get('notificationsEnabled') or not preferences.get('types', {}).get('nftReceived'):
        return web.json_response({'ok': True, 'delivered': False, 'reason': 'disabled'})

    model_name = str(payload.get('modelName') or '—')
    serial_number = str(payload.get('serialNumber') or '—')
    rarity = str(payload.get('rarity') or '—')
    token_id = str(payload.get('tokenId') or '—')
    sender_label = normalize_sender(payload, lang)

    message_lines = [
        t(lang, 'notify_title'),
        '',
        f"<i>{t(lang, 'notify_sender')}: {escape(sender_label)}</i>",
        '',
        '<blockquote>',
        f"{t(lang, 'notify_model')}: {escape(model_name)}",
        f"{t(lang, 'notify_number')}: #{escape(serial_number)}",
        f"{t(lang, 'notify_rarity')}: {escape(rarity)}",
        f"{t(lang, 'notify_token')}: {escape(token_id)}",
        '</blockquote>',
    ]

    try:
        await telegram_app.bot.send_message(
            chat_id=recipient_telegram_id,
            text='\n'.join(message_lines),
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True,
            reply_markup=build_profile_button(lang, config, bot_username),
        )
    except Forbidden:
        await prefs_store.set_write_access_status(
            user_id=recipient_telegram_id,
            status='blocked',
            bot_start_url=bot_start_url,
        )
        return web.json_response({'ok': True, 'delivered': False, 'reason': 'blocked'})
    except TelegramError as error:
        logging.warning('Telegram send_message failed: %s', error)
        return web.json_response({'ok': False, 'error': 'telegram_error'}, status=502)

    return web.json_response({'ok': True, 'delivered': True})


async def run() -> None:
    logging.basicConfig(
        level=os.getenv('BOT_LOG_LEVEL', 'INFO').upper(),
        format='%(asctime)s %(levelname)s %(message)s',
    )

    config = BotConfig.from_env()
    store = LanguageStore(config.language_file, config.default_language)
    prefs_store = UserPreferencesStore(config.prefs_file)

    await store.load()
    await prefs_store.load()

    telegram_app = ApplicationBuilder().token(config.token).build()
    telegram_app.bot_data['config'] = config
    telegram_app.bot_data['store'] = store
    telegram_app.bot_data['prefs_store'] = prefs_store
    telegram_app.bot_data['bot_username'] = None

    telegram_app.add_handler(CommandHandler('start', handle_start))
    telegram_app.add_handler(CommandHandler('help', handle_help))
    telegram_app.add_handler(CommandHandler('language', handle_language))
    telegram_app.add_handler(CommandHandler('pin', handle_pin))
    telegram_app.add_handler(CallbackQueryHandler(handle_language_callback, pattern=r'^lang:'))
    telegram_app.add_handler(MessageHandler(filters.StatusUpdate.WRITE_ACCESS_ALLOWED, handle_write_access_allowed))

    await telegram_app.initialize()
    await telegram_app.start()

    bot_me = await telegram_app.bot.get_me()
    telegram_app.bot_data['bot_username'] = bot_me.username or None

    await telegram_app.bot.set_my_commands([
        BotCommand('start', 'Start bot'),
        BotCommand('help', 'Help'),
        BotCommand('language', 'Change language'),
    ])

    if telegram_app.updater is None:
        raise RuntimeError('Telegram updater is not available')

    await telegram_app.updater.start_polling(drop_pending_updates=True)

    web_app = web.Application()
    web_app['config'] = config
    web_app['store'] = store
    web_app['prefs_store'] = prefs_store
    web_app['telegram_app'] = telegram_app
    web_app['bot_username'] = telegram_app.bot_data.get('bot_username')
    web_app.add_routes([
        web.get('/internal/bot/meta', handle_get_bot_meta),
        web.post('/internal/notify/nft-received', handle_notify_nft_received),
        web.get('/internal/user/preferences', handle_get_user_preferences),
        web.post('/internal/user/preferences', handle_update_user_preferences),
        web.post('/internal/user/write-access', handle_update_write_access),
    ])

    web_runner = web.AppRunner(web_app)
    await web_runner.setup()
    web_site = web.TCPSite(web_runner, host=config.host, port=config.port)
    await web_site.start()

    logging.info('Bot polling started')
    logging.info('Internal API listening on %s:%s', config.host, config.port)

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for stop_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(stop_signal, stop_event.set)
        except NotImplementedError:
            pass

    await stop_event.wait()

    logging.info('Stopping bot service...')

    await web_runner.cleanup()
    await telegram_app.updater.stop()
    await telegram_app.stop()
    await telegram_app.shutdown()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
