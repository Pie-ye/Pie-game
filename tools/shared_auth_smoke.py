#!/usr/bin/env python3
"""正式首頁共用登入煙霧測試：訪客與不存在帳號，不建立／修改正式帳號。

成功登入、跨站 session、登出與票券由 Retire-count 的隔離 DB 整合測試覆蓋。
"""
import uuid

from playwright.sync_api import expect, sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        failures = []
        page.on("requestfailed", lambda req: failures.append(req.url)
                if "coinpilet.win/api/" in req.url else None)
        try:
            page.goto("https://game.coinpilet.win/#/login", wait_until="domcontentloaded", timeout=60000)
            expect(page.locator("#loginForm")).to_be_visible(timeout=30000)
            session = page.evaluate("""async () => {
              const r = await fetch('https://coinpilet.win/api/casino/session', {credentials:'include'});
              return {status:r.status, body:await r.json()};
            }""")
            assert session["status"] == 401, session
            assert session["body"]["error"] == "未登入", session
            print("PASS public browser can read guest 401 (CORS + credentials)")
            community = page.evaluate("""async () => {
              const r = await fetch('https://coinpilet.win/api/casino/community', {credentials:'include'});
              return {status:r.status, body:await r.json()};
            }""")
            assert community == {"status": 200, "body": {"games": []}}, community
            print("PASS public game list available without restoring coin games")
            page.locator('input[name="username"]').fill("probe_" + uuid.uuid4().hex[:20])
            page.locator('input[name="password"]').fill(uuid.uuid4().hex)
            page.locator('#loginForm button[type="submit"]').click()
            expect(page.locator("#loginError")).to_have_text("使用者名稱或密碼錯誤", timeout=30000)
            expect(page.locator('#loginForm button[type="submit"]')).to_be_enabled()
            assert not failures, failures
            print("PASS actual login form returns account error, not network failure")
            print("PASS no account API transport failures")
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
