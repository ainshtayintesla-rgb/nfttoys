"""
NFTToys Userbot Service
-----------------------
Pyrogram-based Telegram userbot for:
  1. Auth flow (send code → verify code/2FA → save session)
  2. Story verification (check if user posted a story with verification code)
  3. Active boost re-verification (periodically re-check that stories are still up)

Exposes a simple HTTP API consumed by the main Node.js server.
"""

import asyncio
import json
import logging
import os
import re
import signal
import sys
from typing import Optional

import aiohttp
from aiohttp import web
from pyrogram import Client
from pyrogram.errors import (
    SessionPasswordNeeded,
    PhoneCodeInvalid,
    PhoneCodeExpired,
    PasswordHashInvalid,
    FloodWait,
    RPCError,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("userbot")

# ─── Config ──────────────────────────────────────────────────────────────────

TELEGRAM_API_ID = int(os.environ.get("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.environ.get("TELEGRAM_API_HASH", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://api:4200")
USERBOT_PORT = int(os.environ.get("USERBOT_PORT", "8095"))
SESSION_DIR = os.environ.get("SESSION_DIR", "/app/data/sessions")

# Verification intervals (seconds)
# Pending shares: first-time verification
VERIFY_PENDING_INTERVAL = int(os.environ.get("VERIFY_PENDING_INTERVAL", "120"))  # 2 min
# Active (verified) shares: re-check that story is still up
VERIFY_ACTIVE_INTERVAL = int(os.environ.get("VERIFY_ACTIVE_INTERVAL", "120"))  # 2 min
# Delay between individual story checks (Telegram rate-limit protection)
CHECK_DELAY_SECONDS = float(os.environ.get("CHECK_DELAY_SECONDS", "2"))

os.makedirs(SESSION_DIR, exist_ok=True)

# ─── In-memory state ────────────────────────────────────────────────────────

# sessionId -> { client: Client, phone_code_hash: str }
pending_auths: dict[str, dict] = {}
# The active authenticated client (only one userbot account at a time)
active_client: Optional[Client] = None


def get_session_path(session_id: str) -> str:
    safe_id = session_id.replace("/", "_").replace("..", "_")
    return os.path.join(SESSION_DIR, safe_id)


# ─── Auth endpoints ─────────────────────────────────────────────────────────

async def handle_send_code(request: web.Request) -> web.Response:
    """Initiate Telegram login: send SMS code to the given phone."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    phone = body.get("phone", "").strip()
    session_id = body.get("sessionId", "").strip()

    if not phone or not session_id:
        return web.json_response(
            {"error": "phone and sessionId are required"},
            status=400,
        )

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        return web.json_response(
            {"error": "TELEGRAM_API_ID and TELEGRAM_API_HASH not configured"},
            status=500,
        )

    try:
        session_path = get_session_path(session_id)
        client = Client(
            name=session_path,
            api_id=TELEGRAM_API_ID,
            api_hash=TELEGRAM_API_HASH,
            in_memory=False,
        )
        await client.connect()

        sent_code = await client.send_code(phone)

        pending_auths[session_id] = {
            "client": client,
            "phone": phone,
            "phone_code_hash": sent_code.phone_code_hash,
        }

        log.info(f"Code sent to {phone} for session {session_id}")
        return web.json_response({"success": True, "status": "code_sent"})

    except FloodWait as e:
        log.warning(f"FloodWait: {e.value}s for phone {phone}")
        return web.json_response(
            {"error": f"Too many attempts. Wait {e.value} seconds.", "code": "FLOOD_WAIT"},
            status=429,
        )
    except RPCError as e:
        log.error(f"RPC error sending code: {e}")
        return web.json_response(
            {"error": str(e), "code": "RPC_ERROR"},
            status=400,
        )
    except Exception as e:
        log.exception("Error sending code")
        return web.json_response({"error": str(e)}, status=500)


async def handle_verify(request: web.Request) -> web.Response:
    """Verify SMS code or 2FA password to complete Telegram login."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session_id = body.get("sessionId", "").strip()
    code = body.get("code", "").strip()
    password = body.get("password")

    if not session_id:
        return web.json_response(
            {"error": "sessionId is required"},
            status=400,
        )

    auth_state = pending_auths.get(session_id)
    if not auth_state:
        return web.json_response(
            {"error": "No pending auth for this session. Send code first."},
            status=404,
        )

    client: Client = auth_state["client"]
    phone = auth_state["phone"]
    phone_code_hash = auth_state["phone_code_hash"]

    try:
        if code:
            try:
                await client.sign_in(
                    phone_number=phone,
                    phone_code_hash=phone_code_hash,
                    phone_code=code,
                )
            except SessionPasswordNeeded:
                if password:
                    await client.check_password(password)
                else:
                    return web.json_response(
                        {
                            "error": "Two-factor authentication required",
                            "code": "TWO_FA_REQUIRED",
                        },
                        status=400,
                    )
        elif password:
            await client.check_password(password)
        else:
            return web.json_response(
                {"error": "code or password required"},
                status=400,
            )

        # Export session string for persistence
        session_string = await client.export_session_string()

        # Clean up pending state
        pending_auths.pop(session_id, None)

        # Set as active client
        global active_client
        if active_client and active_client != client:
            try:
                await active_client.disconnect()
            except Exception:
                pass
        active_client = client

        log.info(f"Session {session_id} authenticated successfully")
        return web.json_response({
            "success": True,
            "sessionString": session_string,
            "status": "active",
        })

    except PhoneCodeInvalid:
        return web.json_response(
            {"error": "Invalid verification code", "code": "INVALID_CODE"},
            status=400,
        )
    except PhoneCodeExpired:
        pending_auths.pop(session_id, None)
        try:
            await client.disconnect()
        except Exception:
            pass
        return web.json_response(
            {"error": "Code expired. Request a new one.", "code": "CODE_EXPIRED"},
            status=400,
        )
    except PasswordHashInvalid:
        return web.json_response(
            {"error": "Invalid 2FA password", "code": "INVALID_PASSWORD"},
            status=400,
        )
    except FloodWait as e:
        return web.json_response(
            {"error": f"Too many attempts. Wait {e.value} seconds.", "code": "FLOOD_WAIT"},
            status=429,
        )
    except RPCError as e:
        log.error(f"RPC error verifying: {e}")
        return web.json_response(
            {"error": str(e), "code": "RPC_ERROR"},
            status=400,
        )
    except Exception as e:
        log.exception("Error verifying code")
        return web.json_response({"error": str(e)}, status=500)


async def handle_disconnect(request: web.Request) -> web.Response:
    """Disconnect and clean up a userbot session."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session_id = body.get("sessionId", "").strip()

    # Clean up pending auth if exists
    auth_state = pending_auths.pop(session_id, None)
    if auth_state:
        try:
            await auth_state["client"].disconnect()
        except Exception:
            pass

    # Disconnect active client
    global active_client
    if active_client:
        try:
            await active_client.disconnect()
        except Exception:
            pass
        active_client = None

    # Remove session file
    session_path = get_session_path(session_id)
    for ext in ("", ".session"):
        path = f"{session_path}{ext}"
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass

    log.info(f"Session {session_id} disconnected")
    return web.json_response({"success": True, "status": "disconnected"})


# ─── Story verification helpers ──────────────────────────────────────────────

def find_verification_code_in_story(story, expected_code: str | None) -> bool:
    """
    Check if a story contains our verification code.
    The code is in the format NT-XXXXXXXX and appears in the story caption.
    If no expected_code is provided, just check if any NT- code exists.
    """
    caption = getattr(story, "caption", "") or ""

    if expected_code:
        return expected_code in caption

    # Fallback: check for any NT- pattern
    return bool(re.search(r"NT-[A-F0-9]{8}", caption))


async def check_user_story(telegram_id: int, verification_code: str | None, story_id: int | None = None) -> dict:
    """
    Check if a user has an active story with the given verification code.
    If story_id is provided, fetch only that specific story (fast path for re-checks).
    Returns { has_story: bool, code_found: bool, verified: bool, story_id: int | None }.
    """
    has_story = False
    code_found = False
    found_story_id = None

    try:
        if story_id is not None:
            # Fast path: check specific story by ID
            try:
                result = await active_client.get_stories(telegram_id, story_id)
                # get_stories returns a single Story or list; handle both
                stories = result if isinstance(result, list) else [result] if result else []
                for story in stories:
                    if story and getattr(story, "id", None) is not None:
                        has_story = True
                        found_story_id = story.id
                        if find_verification_code_in_story(story, verification_code):
                            code_found = True
                        break
            except Exception as e:
                # Story may have been deleted — id not found
                log.debug(f"get_stories({telegram_id}, {story_id}) failed: {e}")
                has_story = False
        else:
            # Full scan: iterate all stories to find the one with our code
            async for story in active_client.get_peer_stories(telegram_id):
                has_story = True
                if find_verification_code_in_story(story, verification_code):
                    code_found = True
                    found_story_id = getattr(story, "id", None)
                    break
    except Exception as e:
        log.warning(f"Story check failed for {telegram_id}: {e}")

    verified = code_found if verification_code else has_story

    return {
        "has_story": has_story,
        "code_found": code_found,
        "verified": verified,
        "story_id": found_story_id,
    }


async def report_verification(share_id: str, telegram_id: str, verified: bool, story_id: int | None = None):
    """Report verification result back to the API server."""
    if not API_INTERNAL_SECRET:
        return

    try:
        payload: dict = {
            "shareId": share_id,
            "telegramId": telegram_id,
            "verified": verified,
        }
        if story_id is not None:
            payload["telegramStoryId"] = story_id

        async with aiohttp.ClientSession() as session:
            await session.post(
                f"{API_BASE_URL}/v2/internal/story-verify",
                json=payload,
                headers={"X-Internal-Secret": API_INTERNAL_SECRET},
                timeout=aiohttp.ClientTimeout(total=10),
            )
    except Exception as e:
        log.error(f"Failed to report verification for share {share_id}: {e}")


# ─── HTTP endpoint: manual story check ────────────────────────────────────────

async def handle_check_story(request: web.Request) -> web.Response:
    """
    Check if a Telegram user has an active story with our verification code.
    Called internally by the scheduled verification loop or admin trigger.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    telegram_id = body.get("telegramId")
    share_id = body.get("shareId", "").strip()
    verification_code = body.get("verificationCode", "").strip() or None

    if not telegram_id or not share_id:
        return web.json_response(
            {"error": "telegramId and shareId are required"},
            status=400,
        )

    if not active_client:
        return web.json_response(
            {"error": "Userbot is not authenticated", "code": "NOT_AUTHENTICATED"},
            status=503,
        )

    try:
        telegram_id_int = int(telegram_id)
        result = await check_user_story(telegram_id_int, verification_code)

        # Report result back to the API server
        await report_verification(share_id, str(telegram_id), result["verified"])

        return web.json_response({
            "success": True,
            "hasStory": result["has_story"],
            "codeFound": result["code_found"],
            "verified": result["verified"],
            "telegramId": telegram_id,
        })

    except RPCError as e:
        log.error(f"RPC error checking story for {telegram_id}: {e}")
        return web.json_response(
            {"error": str(e), "code": "RPC_ERROR"},
            status=400,
        )
    except Exception as e:
        log.exception(f"Error checking story for {telegram_id}")
        return web.json_response({"error": str(e)}, status=500)


# ─── Periodic verification: PENDING shares (first-time check) ────────────────

async def periodic_pending_verification():
    """
    Check pending story shares — users who just shared but haven't been verified yet.
    Runs every VERIFY_PENDING_INTERVAL seconds.
    """
    while True:
        try:
            await asyncio.sleep(VERIFY_PENDING_INTERVAL)

            if not active_client or not API_INTERNAL_SECRET:
                continue

            log.info("⏳ Pending verification cycle — checking new shares")

            async with aiohttp.ClientSession() as session:
                resp = await session.get(
                    f"{API_BASE_URL}/v2/internal/pending-story-shares",
                    headers={"X-Internal-Secret": API_INTERNAL_SECRET},
                    timeout=aiohttp.ClientTimeout(total=30),
                )

                if resp.status != 200:
                    log.warning(f"pending-story-shares returned {resp.status}")
                    continue

                data = await resp.json()
                shares = data.get("shares", [])

            if not shares:
                log.debug("No pending shares to verify")
                continue

            log.info(f"Found {len(shares)} pending shares to verify")

            verified_count = 0
            revoked_count = 0

            for share in shares:
                share_id = share.get("id", "")
                tg_id = share.get("telegramId")
                v_code = share.get("verificationCode", "") or None

                if not tg_id or not share_id:
                    continue

                try:
                    tg_id_int = int(tg_id)
                    result = await check_user_story(tg_id_int, v_code)
                    await report_verification(share_id, str(tg_id), result["verified"], result.get("story_id"))

                    if result["verified"]:
                        verified_count += 1
                    else:
                        revoked_count += 1

                    log.info(
                        f"[PENDING] share={share_id[:8]}.. tg={tg_id} "
                        f"story={result['has_story']} code={result['code_found']} storyId={result.get('story_id')} "
                        f"→ {'✅ verified' if result['verified'] else '❌ not verified'}"
                    )
                    await asyncio.sleep(CHECK_DELAY_SECONDS)

                except Exception as e:
                    log.error(f"Error verifying pending share {share_id}: {e}")
                    continue

            log.info(f"Pending cycle done: {verified_count} verified, {revoked_count} not verified")

        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error(f"Periodic pending verification error: {e}")
            await asyncio.sleep(60)


# ─── Periodic re-verification: ACTIVE (verified) shares ──────────────────────

async def periodic_active_recheck():
    """
    Re-check stories of verified shares to ensure the story is still up.
    If user removes the story, boost gets revoked.
    Runs every VERIFY_ACTIVE_INTERVAL seconds.
    """
    while True:
        try:
            await asyncio.sleep(VERIFY_ACTIVE_INTERVAL)

            if not active_client or not API_INTERNAL_SECRET:
                continue

            log.info("🔄 Active re-check cycle — verifying stories are still up")

            async with aiohttp.ClientSession() as session:
                resp = await session.get(
                    f"{API_BASE_URL}/v2/internal/active-story-shares",
                    headers={"X-Internal-Secret": API_INTERNAL_SECRET},
                    timeout=aiohttp.ClientTimeout(total=30),
                )

                if resp.status != 200:
                    log.warning(f"active-story-shares returned {resp.status}")
                    continue

                data = await resp.json()
                shares = data.get("shares", [])

            if not shares:
                log.debug("No active shares to re-check")
                continue

            log.info(f"Re-checking {len(shares)} active (verified) shares")

            still_valid = 0
            revoked_count = 0

            for share in shares:
                share_id = share.get("id", "")
                tg_id = share.get("telegramId")
                v_code = share.get("verificationCode", "") or None
                saved_story_id = share.get("telegramStoryId")  # fast path

                if not tg_id or not share_id:
                    continue

                try:
                    tg_id_int = int(tg_id)
                    # Use saved story_id for instant lookup instead of scanning all stories
                    result = await check_user_story(tg_id_int, v_code, story_id=saved_story_id)

                    if result["verified"]:
                        still_valid += 1
                        log.debug(f"[RECHECK] share={share_id[:8]}.. tg={tg_id} storyId={saved_story_id} → ✅ still active")
                    else:
                        # Story removed! Revoke the boost
                        await report_verification(share_id, str(tg_id), False)
                        revoked_count += 1
                        log.warning(
                            f"[RECHECK] share={share_id[:8]}.. tg={tg_id} storyId={saved_story_id} → ❌ STORY REMOVED — boost revoked!"
                        )

                    await asyncio.sleep(CHECK_DELAY_SECONDS)

                except Exception as e:
                    log.error(f"Error re-checking active share {share_id}: {e}")
                    continue

            log.info(f"Active re-check done: {still_valid} still valid, {revoked_count} revoked")

        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error(f"Periodic active re-check error: {e}")
            await asyncio.sleep(60)


# ─── Restore session on startup ─────────────────────────────────────────────

async def try_restore_session():
    """Try to restore active userbot session from saved session files on disk."""
    global active_client

    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        log.warning("TELEGRAM_API_ID/API_HASH not set, skipping session restore")
        return

    if not os.path.isdir(SESSION_DIR):
        return

    for filename in os.listdir(SESSION_DIR):
        if not filename.endswith(".session"):
            continue

        session_name = os.path.join(SESSION_DIR, filename.replace(".session", ""))
        try:
            client = Client(
                name=session_name,
                api_id=TELEGRAM_API_ID,
                api_hash=TELEGRAM_API_HASH,
            )
            await client.connect()
            me = await client.get_me()
            if me:
                active_client = client
                log.info(f"Restored session: {me.first_name} (@{me.username}, id={me.id})")
                return
            else:
                await client.disconnect()
        except Exception as e:
            log.warning(f"Failed to restore session from {filename}: {e}")
            try:
                await client.disconnect()
            except Exception:
                pass


# ─── Health check ────────────────────────────────────────────────────────────

async def handle_health(_request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "authenticated": active_client is not None,
        "intervals": {
            "pending_seconds": VERIFY_PENDING_INTERVAL,
            "active_seconds": VERIFY_ACTIVE_INTERVAL,
            "check_delay": CHECK_DELAY_SECONDS,
        },
    })


# ─── App setup ───────────────────────────────────────────────────────────────

async def on_startup(app: web.Application):
    await try_restore_session()
    # Two separate verification loops
    app["verify_pending_task"] = asyncio.create_task(periodic_pending_verification())
    app["verify_active_task"] = asyncio.create_task(periodic_active_recheck())
    log.info(
        f"Verification loops started: pending every {VERIFY_PENDING_INTERVAL}s, "
        f"active re-check every {VERIFY_ACTIVE_INTERVAL}s"
    )


async def on_shutdown(app: web.Application):
    for task_name in ("verify_pending_task", "verify_active_task"):
        task = app.get(task_name)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    global active_client
    if active_client:
        try:
            await active_client.disconnect()
        except Exception:
            pass

    for auth_state in pending_auths.values():
        try:
            await auth_state["client"].disconnect()
        except Exception:
            pass


def create_app() -> web.Application:
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    app.router.add_get("/health", handle_health)
    app.router.add_post("/auth/send-code", handle_send_code)
    app.router.add_post("/auth/verify", handle_verify)
    app.router.add_post("/auth/disconnect", handle_disconnect)
    app.router.add_post("/story/check", handle_check_story)

    return app


def main():
    if not TELEGRAM_API_ID or not TELEGRAM_API_HASH:
        log.warning(
            "TELEGRAM_API_ID or TELEGRAM_API_HASH not set. "
            "Userbot will start but auth features will be unavailable."
        )

    app = create_app()
    log.info(f"Starting userbot service on port {USERBOT_PORT}")
    web.run_app(app, host="0.0.0.0", port=USERBOT_PORT)


if __name__ == "__main__":
    main()
