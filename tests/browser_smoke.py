"""Optional browser integration script. Importing this module never launches Chromium."""

def main():
    """Browser integration walkthrough against a running server; no mocked APIs.
    Run: python tests/browser_smoke.py (requires playwright + Chromium).
    """
    import json
    import os
    import time
    from pathlib import Path
    from playwright.sync_api import sync_playwright, expect

    BASE=os.environ.get('KAVACH_URL','http://127.0.0.1:8000')
    ROOT=Path(__file__).resolve().parent.parent
    checks=[]
    errors=[]
    roundtrips=[]
    visible_latencies=[]

    def record(name,passed):
        checks.append({'name':name,'passed':bool(passed)})
        assert passed,name

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1,record_video_dir=str(ROOT/'reports/video'),record_video_size={'width':1440,'height':900})
        page=context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE,wait_until='networkidle')
        expect(page.locator('.submit-btn')).to_be_enabled()
        record('API connection and initial signed fixture',bool(json.loads(page.get_by_label('Editable message JSON').input_value())['auth_tag']))
        record('Desktop layout has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(ROOT/'reports/console-desktop.png'),full_page=True)
        page.get_by_role('button',name='New demo session',exact=True).click()
        page.get_by_role('button',name='Create session',exact=True).click()
        expect(page.locator('.confirm-modal')).to_have_count(0)
        def submit(expected):
            started=time.perf_counter()
            with page.expect_response(lambda r:'/api/messages?' in r.url and r.request.method=='POST') as response:
                page.locator('.submit-btn').click()
            result=response.value.json()
            expect(page.locator('.verdict-banner h3')).to_have_text('Message accepted' if expected=='OK' else 'Message rejected')
            if expected!='OK':
                expect(page.locator('.verdict-banner p')).to_contain_text(expected.replace('_',' ').lower())
            visible_latencies.append(round((time.perf_counter()-started)*1000,2))
            record('Browser submitted message: '+expected,result['reason_code']==expected)
            roundtrips.append(result.get('duration_ms',0))
            return result
        result=submit('OK')
        expect(page.locator('.state-values')).to_contain_text('Power saving')
        page.wait_for_timeout(800)
        page.screenshot(path=str(ROOT/'reports/accepted-decision.png'),full_page=True)
        page.get_by_role('button',name='Tamper',exact=True).click()
        expect(page.locator('.signature-status')).to_contain_text('Modified since signing')
        rejected=submit('AUTH_FAILED')
        record('Tampered browser input leaves protected state unchanged',rejected['protected_state_before']==rejected['protected_state_after'])
        page.wait_for_timeout(800)
        page.get_by_role('button',name='Replay',exact=True).click()
        replay=submit('REPLAY')
        record('Replay used original accepted bytes',page.get_by_label('Editable message JSON').input_value()==result['submitted_text'])
        page.wait_for_timeout(700)
        page.get_by_role('button',name='Inspect full decision & state diff',exact=True).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        record('Evidence modal shows committed before and after snapshots',page.locator('.state-comparison pre').count()==2)
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).to_have_count(0)
        # Malformed JSON is passed unchanged to the backend, not blocked in the UI.
        page.get_by_label('Editable message JSON').fill('{"version":1,"version":1}')
        submit('INVALID_JSON')
        page.get_by_role('button',name='Scenario Lab',exact=True).click()
        page.get_by_role('button',name='Run full test suite',exact=True).click()
        expect(page.locator('.suite-score')).to_contain_text('29',timeout=30000)
        record('Scenario Lab runs all 29 real checks',page.locator('.test-row').count()==29)
        page.screenshot(path=str(ROOT/'reports/scenario-lab.png'),full_page=True)
        page.wait_for_timeout(800)
        page.get_by_role('button',name='Audit & Evidence',exact=True).click()
        page.get_by_label('Filter by verdict').select_option('REJECTED')
        expect(page.locator('.audit-table tbody tr')).to_have_count(3)
        record('Audit verdict filtering',page.locator('.audit-table tbody tr').count()==3)
        page.locator('.audit-table tbody tr').first.click()
        expect(page.locator('.detail-content')).to_contain_text('Duplicate JSON key')
        page.keyboard.press('Escape')
        with page.expect_download() as download:
            page.get_by_role('button',name='Export evidence',exact=True).click()
        evidence=json.loads(Path(download.value.path()).read_text())
        record('Downloaded evidence contains decisions and scenario results',len(evidence['events'])==4 and evidence['scenario_results'][0]['passed']==29)
        download.value.save_as(str(ROOT/'reports/browser-session-evidence.json'))
        page.screenshot(path=str(ROOT/'reports/audit-evidence.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        page.get_by_role('button',name='Mission Console',exact=True).click()
        record('Mobile layout has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(ROOT/'reports/console-mobile.png'),full_page=True)
        page.get_by_role('button',name='Telemetry',exact=True).click()
        page.get_by_role('button',name='Generate fresh signed sample',exact=True).click()
        expect(page.locator('.signature-status')).to_contain_text('Signed by local fixture issuer')
        telemetry=submit('OK')
        record('Mobile telemetry remains separate from spacecraft state',not telemetry['state_changed'] and telemetry['telemetry_after']['source']=='Accepted satellite fixture')
        record('No JavaScript runtime errors',not errors)
        # Preserve the demonstration history but leave a clean current mission for the user.
        page.request.post(BASE+'/api/demo/sessions')
        video_path=page.video.path()
        context.close()
        Path(video_path).replace(ROOT/'reports/kavach-walkthrough.webm')
        browser.close()

    report={'executed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'browser':'Playwright Chromium','viewports':['1440x900','390x844'],'checks':checks,'passed':sum(c['passed'] for c in checks),'total':len(checks),'javascript_errors':errors,'backend_validation_ms':roundtrips,'click_to_visible_verdict_ms':visible_latencies,'note':'Browser tests use real HTTP API and synthetic messages, without mocked validation.'}
    (ROOT/'reports/browser-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


def _record_failure(status,reason):
    import json,time
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    (root/'reports').mkdir(exist_ok=True)
    (root/'reports/browser-results.json').write_text(json.dumps({'status':status,'reason':reason,'executed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'passed':0},indent=2))

if __name__ == '__main__':
    try:
        main()
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith('playwright'):
            _record_failure('BLOCKED','Playwright Python package missing')
            print('BLOCKED: optional Playwright package is not installed. Run: python -m pip install playwright')
            raise SystemExit(2)
        _record_failure('FAIL',type(exc).__name__)
        raise
    except Exception as exc:
        message=str(exc)
        if "Executable doesn't exist" in message or 'error while loading shared libraries' in message:
            _record_failure('BLOCKED','Chromium binary or required OS libraries missing')
            print('BLOCKED: Chromium binary or OS libraries missing. Run: python -m playwright install chromium && python -m playwright install-deps chromium')
            raise SystemExit(2)
        _record_failure('FAIL',type(exc).__name__)
        raise
