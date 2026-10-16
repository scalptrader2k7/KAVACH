"""Explicit optional browser regression gate against real Python responses (no mocked verdicts)."""
def main():
    import json,os,re,time
    from pathlib import Path
    from playwright.sync_api import sync_playwright,expect
    root=Path(__file__).resolve().parents[1]
    base=os.environ.get('KAVACH_URL','http://127.0.0.1:8000')
    checks=[];errors=[]
    def record(name,condition=True):
        checks.append({'name':name,'passed':bool(condition)})
        assert condition,name
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':900})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base,wait_until='networkidle')
        expect(page.locator('.submit-btn')).to_be_enabled()
        page.get_by_role('button',name='New demo session',exact=True).click()
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST') as issued:
            page.get_by_role('button',name='Create session',exact=True).click()
        f=issued.value.json()
        expect(page.get_by_label('Editable message JSON')).to_have_value(re.compile(re.escape(f['message']['auth_tag'])))
        state=page.request.get(base+'/api/state').json()
        record('New-session fixture belongs to the new session, not a stale React closure',f['session_id']==state['session_id'])
        def submit(expected):
            raw=page.get_by_label('Editable message JSON').input_value()
            with page.expect_response(lambda r:'/api/messages?' in r.url and r.request.method=='POST') as response:
                page.locator('.submit-btn').click()
            r=response.value.json()
            assert r['reason_code']==expected,(expected,r)
            expect(page.locator('.attack-summary')).to_contain_text(r['reason_code'] if expected!='OK' else 'ACCEPTED')
            record('Exact editor UTF-8 bytes received for '+expected,response.value.request.post_data_buffer==raw.encode())
            record('Proof summary uses persisted receiver facts for '+expected,r['audit_persisted'] and r['replay_state_advanced']==(r['verdict']=='ACCEPTED'))
            if r['verdict']=='REJECTED':
                assert r['protected_state_before']==r['protected_state_after']
                assert r['telemetry_before']==r['telemetry_after']
                assert not r['replay_state_advanced']
            return r
        valid=submit('OK')
        expect(page.locator('.state-values')).to_contain_text('Power saving')
        record('Valid command updates committed state',valid['state_changed'])
        for name,raw in [('duplicate','{"version":1,"version":1}'),('malformed','{"version":')]:
            page.get_by_label('Editable message JSON').fill(raw)
            page.get_by_title('Format JSON without re-signing').click()
            expect(page.locator('.toast')).to_contain_text('Duplicate JSON key' if name=='duplicate' else 'Malformed JSON')
            record('Formatter preserves '+name+' attack bytes',page.get_by_label('Editable message JSON').input_value()==raw)
            submit('INVALID_JSON')
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST') as issued:
            page.get_by_role('button',name='Generate fresh signed sample',exact=True).click()
        fresh=issued.value.json()['message']
        expect(page.get_by_label('Editable message JSON')).to_have_value(re.compile(re.escape(fresh['auth_tag'])))
        reordered=dict(reversed(list(fresh.items())))
        page.get_by_label('Editable message JSON').fill(json.dumps(reordered,separators=(',',':')))
        page.get_by_title('Format JSON without re-signing').click()
        formatted=page.get_by_label('Editable message JSON').input_value()
        record('Valid formatting preserves signature and authenticated values',json.loads(formatted)==fresh)
        accepted=submit('OK')
        record('Whitespace/key-order format remains HMAC-valid',accepted['checks'][2]['status']=='PASS')
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST') as issued:
            page.get_by_role('button',name='Generate fresh signed sample',exact=True).click()
        fresh=issued.value.json()['message'];tag=fresh['auth_tag']
        expect(page.get_by_label('Editable message JSON')).to_have_value(re.compile(re.escape(tag)))
        fresh['payload']['mode']='SAFE' if fresh['payload']['mode']!='SAFE' else 'NORMAL'
        page.get_by_label('Editable message JSON').fill(json.dumps(fresh))
        page.get_by_title('Format JSON without re-signing').click()
        record('Changing payload never silently re-signs',json.loads(page.get_by_label('Editable message JSON').input_value())['auth_tag']==tag)
        submit('AUTH_FAILED')
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST'):
            page.get_by_role('button',name='Replay',exact=True).click()
        expect(page.get_by_label('Editable message JSON')).to_have_value(accepted['submitted_text'])
        submit('REPLAY')
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST') as issued:
            page.get_by_role('button',name='Unauthorised',exact=True).click()
        expect(page.get_by_label('Editable message JSON')).to_have_value(re.compile(re.escape(issued.value.json()['message']['auth_tag'])))
        unauthorised=submit('NOT_AUTHORISED')
        record('Authenticated observer still fails permissions',unauthorised['sender_verified'] and unauthorised['checks'][2]['status']=='PASS' and unauthorised['checks'][5]['status']=='FAIL')
        expect(page.locator('.attack-summary')).to_contain_text('First failed stage: Sender permissions')
        page.screenshot(path=str(root/'reports/sprint/mission-proof.png'),full_page=True)
        with page.expect_response(lambda r:'/api/demo/issue' in r.url and r.request.method=='POST') as issued:
            page.get_by_role('button',name='Telemetry fixture',exact=True).click()
        expect(page.get_by_label('Editable message JSON')).to_have_value(re.compile(re.escape(issued.value.json()['message']['auth_tag'])))
        telemetry=submit('OK')
        record('Telemetry is independent of protected spacecraft mode',not telemetry['state_changed'] and telemetry['telemetry_after']['mode']=='NORMAL' and telemetry['protected_state_after']['mode']=='POWER_SAVING')
        page.get_by_title('About this simulator').focus();page.keyboard.press('Enter')
        expect(page.get_by_role('dialog')).to_be_visible();page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).to_have_count(0)
        record('Keyboard Enter opens help and Escape closes it')
        page.get_by_role('button',name='Audit & Evidence',exact=True).click()
        page.get_by_label('Filter by exact reason code').fill('NOT_AUTHORISED')
        expect(page.locator('.audit-table tbody tr')).to_have_count(1)
        page.locator('.audit-table tbody tr').focus();page.keyboard.press('Enter')
        expect(page.get_by_role('dialog')).to_contain_text('NOT_AUTHORISED');page.keyboard.press('Escape')
        record('Audit row keyboard inspection uses real persisted decision')
        page.get_by_role('button',name='Mission Console',exact=True).click()
        record('Desktop has no page-level horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.set_viewport_size({'width':390,'height':844})
        record('Mobile proof/editor layout has no page-level horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.screenshot(path=str(root/'reports/sprint/mission-mobile.png'),full_page=True)
        record('No uncaught browser runtime errors',not errors)
        browser.close()
    report={'status':'PASS','executed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'passed':len(checks),'total':len(checks),'checks':checks,'javascript_errors':errors,'note':'Real FastAPI responses and committed SQLite state; no mocked verdicts. Isolated test runtime only.'}
    (root/'reports/sprint/browser-hardening.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        import json,time
        from pathlib import Path
        blocked=isinstance(exc,ModuleNotFoundError) and str(getattr(exc,'name','')).startswith('playwright') or "Executable doesn't exist" in str(exc) or 'error while loading shared libraries' in str(exc)
        status='BLOCKED' if blocked else 'FAIL'
        (Path(__file__).resolve().parents[1]/'reports/sprint/browser-hardening.json').write_text(json.dumps({'status':status,'passed':0,'reason':'Optional browser dependency unavailable' if blocked else type(exc).__name__,'executed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2))
        print(status+': '+('Install Playwright, Chromium, and required OS libraries.' if blocked else 'Browser regression assertion failed.'))
        if blocked:raise SystemExit(2)
        raise
