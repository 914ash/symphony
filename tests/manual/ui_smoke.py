import json
import os
from pathlib import Path
from urllib import request, error
from urllib.parse import quote
from time import sleep

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("SYMPHONY_BASE_URL", "http://127.0.0.1:3210")
OUT_DIR = Path("artifacts/screenshots")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch_json(url: str, method: str = "GET") -> tuple[int, dict]:
    req = request.Request(url=url, method=method)
    req.add_header("content-type", "application/json")
    try:
        with request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return resp.getcode(), json.loads(body)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        parsed = json.loads(body) if body else {}
        return exc.code, parsed


def wait_for_issue_identifier(timeout_seconds: int = 25) -> str:
    waited = 0
    while waited < timeout_seconds:
        code, state = fetch_json(f"{BASE_URL}/api/v1/state")
        assert code == 200, f"GET /api/v1/state expected 200, got {code}"
        assert "generated_at" in state
        assert "counts" in state
        assert "running" in state
        assert "retrying" in state
        assert "codex_totals" in state

        running = state.get("running", [])
        if isinstance(running, list) and len(running) > 0:
            first = running[0]
            identifier = first.get("issue_identifier")
            if isinstance(identifier, str) and identifier.strip():
                return identifier.strip()

        retrying = state.get("retrying", [])
        if isinstance(retrying, list) and len(retrying) > 0:
            first = retrying[0]
            identifier = first.get("issue_identifier")
            if isinstance(identifier, str) and identifier.strip():
                return identifier.strip()

        sleep(1)
        waited += 1

    raise AssertionError("No live issue identifier found in /api/v1/state within timeout")


def assert_dashboard_response() -> str:
    issue_identifier = wait_for_issue_identifier()

    code, refresh = fetch_json(f"{BASE_URL}/api/v1/refresh", method="POST")
    assert code == 202, f"POST /api/v1/refresh expected 202, got {code}"
    assert refresh.get("queued") is True
    assert "operations" in refresh

    encoded = quote(issue_identifier, safe="")
    code, issue_detail = fetch_json(f"{BASE_URL}/api/v1/{encoded}")
    assert code == 200, f"GET /api/v1/{issue_identifier} expected 200, got {code}"
    assert issue_detail.get("issue_identifier") == issue_identifier
    assert issue_detail.get("status") in {"running", "retrying"}
    assert "attempts" in issue_detail
    assert "recent_events" in issue_detail

    code, not_found = fetch_json(f"{BASE_URL}/api/v1/DOES-NOT-EXIST")
    assert code == 404, f"GET /api/v1/DOES-NOT-EXIST expected 404, got {code}"
    assert not_found.get("error", {}).get("code") == "issue_not_found"

    code, method_not_allowed = fetch_json(f"{BASE_URL}/api/v1/refresh", method="GET")
    assert code == 405, f"GET /api/v1/refresh expected 405, got {code}"
    assert method_not_allowed.get("error", {}).get("code") == "method_not_allowed"
    return issue_identifier


def run_browser_checks(issue_identifier: str) -> dict:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1024})
        console_errors: list[str] = []
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )

        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_selector("h1")

        h1 = page.locator("h1").inner_text().strip()
        assert h1 == "Symphony Runtime", f"Unexpected heading: {h1}"
        assert page.locator("text=Counts").count() > 0
        assert page.locator("text=Tokens").count() > 0
        assert page.locator("text=Runtime").count() > 0
        assert page.locator("text=Running Sessions").count() > 0

        desktop_shot = OUT_DIR / "dashboard-desktop.png"
        page.screenshot(path=str(desktop_shot), full_page=True)

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(BASE_URL, wait_until="networkidle")
        mobile.wait_for_selector("h1")
        mobile_shot = OUT_DIR / "dashboard-mobile.png"
        mobile.screenshot(path=str(mobile_shot), full_page=True)

        state_page = browser.new_page(viewport={"width": 1280, "height": 720})
        state_page.goto(f"{BASE_URL}/api/v1/state", wait_until="networkidle")
        state_json_shot = OUT_DIR / "api-state-json.png"
        state_page.screenshot(path=str(state_json_shot), full_page=True)

        issue_page = browser.new_page(viewport={"width": 1280, "height": 720})
        issue_page.goto(f"{BASE_URL}/api/v1/DOES-NOT-EXIST", wait_until="networkidle")
        issue_json_shot = OUT_DIR / "api-issue-not-found.png"
        issue_page.screenshot(path=str(issue_json_shot), full_page=True)

        live_issue_page = browser.new_page(viewport={"width": 1280, "height": 720})
        live_issue_page.goto(
            f"{BASE_URL}/api/v1/{quote(issue_identifier, safe='')}",
            wait_until="networkidle",
        )
        live_issue_json_shot = OUT_DIR / "api-issue-live-json.png"
        live_issue_page.screenshot(path=str(live_issue_json_shot), full_page=True)

        browser.close()

        return {
            "console_errors": console_errors,
            "live_issue_identifier": issue_identifier,
            "screenshots": [
                str(desktop_shot),
                str(mobile_shot),
                str(state_json_shot),
                str(issue_json_shot),
                str(live_issue_json_shot),
            ],
        }


def main() -> None:
    issue_identifier = assert_dashboard_response()
    browser_report = run_browser_checks(issue_identifier)

    if browser_report["console_errors"]:
        raise AssertionError(f"Console errors detected: {browser_report['console_errors']}")

    report_path = OUT_DIR / "ui-smoke-report.json"
    report_path.write_text(json.dumps(browser_report, indent=2), encoding="utf-8")
    print(json.dumps(browser_report, indent=2))


if __name__ == "__main__":
    main()
