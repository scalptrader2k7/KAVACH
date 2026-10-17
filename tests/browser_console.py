"""Phase 2 browser checks. API requests run through the real FastAPI app with
an isolated temporary Engine. No API request reaches the running live service.
Requires existing Playwright, Chrome, FastAPI and httpx; installs nothing.
Run: python -B tests/browser_console.py
"""
import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright, expect
from backend.engine import Engine
import backend.app as application


def main():
    checks = []
    def check(name, value=True):
        assert value, name
        checks.append(name)
        print('PASS ' + name, flush=True)
    with tempfile.TemporaryDirectory(prefix='kavach-console-qa-') as folder:
        receiver = Engine(folder)
        application.engine = receiver
        # get_engine uses _engine in some application versions; explicitly replace
        # the accessor within this isolated test process, never the live server.
        application.get_engine = lambda: receiver
        client = TestClient(application.app,base_url="http://127.0.0.1")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            ctx = browser.new_context(viewport={'width':1440,'height':1000}, permissions=['clipboard-read','clipboard-write'])
            errors, requests, responses, failed, console_errors = [], [], [], [], []
            injected = {'error':False, 'hold':False, 'route':None, 'service':False, 'offline':False, 'audit':False}
            def route_request(route):
                req = route.request
                url = urlsplit(req.url)
                if url.hostname not in ('127.0.0.1','localhost'):
                    route.abort(); return
                if url.path.startswith('/api/'):
                    requests.append((req.method,url.path,req.post_data))
                    if injected['offline'] and url.path in ['/api/health','/api/state']:
                        route.fulfill(status=503,content_type='application/json',body='{"detail":"Isolated offline state"}'); return
                    if injected['audit'] and url.path == '/api/audit':
                        route.fulfill(status=503,content_type='application/json',body='{"detail":"Isolated audit failure"}'); return
                    if injected['service'] and url.path == '/api/messages':
                        response=application.service_error()
                        route.fulfill(status=503,content_type='application/json',body=response.body); return
                    if injected['error'] and url.path == '/api/messages':
                        route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Isolated transport failure'})); return
                    if injected['hold'] and url.path == '/api/messages':
                        injected['route'] = route; return
                    response = client.request(req.method,url.path+('?' + url.query if url.query else ''),content=req.post_data_buffer,headers={'Content-Type':'application/json'})
                    responses.append((url.path,response.status_code,response.json()))
                    route.fulfill(status=response.status_code,content_type='application/json',body=response.content)
                elif req.method == 'GET': route.continue_()
                else: route.abort()
            ctx.route('**/*',route_request)
            page=ctx.new_page()
            page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('requestfailed',lambda r:failed.append(r.url))
            page.goto('http://127.0.0.1:8000',wait_until='networkidle')
            check('Landing present before entry',page.locator('.landing-hero-copy').is_visible())
            page.get_by_role('button',name='ENTER MISSION CONTROL',exact=True).first.click()
            expect(page.locator('.status-strip')).to_contain_text('Connected')
            check('Entry only reads API',all(r[0]=='GET' for r in requests))
            editor=page.get_by_role('textbox',name='Editable message JSON')
            submit=page.get_by_role('button',name='Submit for validation',exact=True)
            check('Empty editor disables submit',submit.is_disabled() and editor.input_value()=='')
            check('Empty telemetry',page.get_by_text('Awaiting first snapshot').is_visible())
            page.get_by_role('button',name='Collapse sidebar').click()
            check('Sidebar collapses',page.locator('.sidebar-collapsed').count()==1)
            page.get_by_role('button',name='Expand sidebar').click()
            for summary in page.locator('.pipeline-step summary').all():
                summary.focus();page.keyboard.press('Enter')
                assert summary.locator('..').get_attribute('open') is not None
                page.keyboard.press('Enter')
            check('All eight disclosures open and close by keyboard')
            page.get_by_role('button',name='Contract',exact=True).click()
            expect(page.locator('.contract-view')).to_contain_text('Message contract')
            page.get_by_role('button',name='JSON payload',exact=True).click()
            editor.fill('{"x":1,"x":2}')
            page.get_by_title('Format JSON without re-signing').click()
            check('Duplicate-key formatting preserves bytes',editor.input_value()=='{"x":1,"x":2}')
            expect(page.locator('.toast')).to_contain_text('Duplicate')
            editor.fill('{bad')
            page.get_by_title('Format JSON without re-signing').click()
            check('Malformed formatting preserves bytes',editor.input_value()=='{bad')
            page.locator('#sender').select_option('observer-01');page.locator('#action').select_option('GET_STATUS')
            check('GET_STATUS hides payload fields',page.locator('#mode').count()==0)
            page.locator('#sender').select_option('operator-01');page.locator('#action').select_option('SET_REPORT_INTERVAL');page.locator('#seconds').fill('20')
            page.get_by_role('button',name='Generate fresh signed sample').click()
            expect(editor).to_have_value(__import__('re').compile('"seconds": 20'))
            check('Interval and sender reach real fixture API',json.loads(editor.input_value())['payload']=={'seconds':20})
            page.get_by_title('Copy exact message').click()
            page.wait_for_timeout(100)
            check('Copy preserves text (Windows newline normalization)',page.evaluate('navigator.clipboard.readText()').replace('\r\n','\n')==editor.input_value().replace('\r\n','\n'))
            raw=editor.input_value();editor.fill(json.dumps(json.loads(raw),separators=(',',':')))
            page.get_by_title('Format JSON without re-signing').click()
            check('Formatting preserves envelope values',json.loads(editor.input_value())==json.loads(raw))
            injected['hold']=True;submit.click()
            expect(page.get_by_role('heading',name='Verifying message')).to_be_visible()
            check('Pending disables generation and submit',page.locator('.submit-btn').is_disabled() and page.get_by_role('button',name='Generate fresh signed sample').is_disabled())
            check('Pending never claims a pass',page.locator('.step-status.pending').count()==8 and page.locator('.pipeline-step.pass').count()==0)
            req=injected['route'].request
            res=client.post('/api/messages?'+urlsplit(req.url).query,content=req.post_data_buffer)
            injected['route'].fulfill(status=res.status_code,content_type='application/json',body=res.content);injected['hold']=False
            expect(page.get_by_role('heading',name='Message accepted',exact=True)).to_be_visible()
            check('Pipeline matches actual receiver checks',page.locator('.pipeline-step.pass').count()==sum(c['status']=='PASS' for c in res.json()['checks']))
            expect(page.locator('.state-values')).to_contain_text('20')
            check('Committed state shown from API')
            expect(page.locator('.console-audit tbody tr')).to_have_count(1)
            page.locator('.console-audit tbody tr').first.focus();page.keyboard.press('Enter')
            expect(page.get_by_role('dialog')).to_contain_text('OK')
            with page.expect_download() as decision_download:page.get_by_role('button',name='Export decision',exact=True).click()
            exported=json.loads(Path(decision_download.value.path()).read_text(encoding="utf-8"))
            check('Activity keyboard inspection and decision export',exported['event_id']==res.json()['event_id'])
            page.get_by_role('button',name='Done',exact=True).click()
            page.locator('.console-audit .row-arrow').first.click();page.get_by_role('button',name='Close decision').click()
            check('Activity row inspection closes')
            page.locator('.receipt-disclosure summary').click()
            expect(page.locator('.receipt-body')).to_contain_text('SET_REPORT_INTERVAL')
            page.get_by_role('button',name='Open persisted decision',exact=True).click();page.keyboard.press('Escape')
            check('Proof disclosure and persisted decision link')
            page.get_by_role('button',name='Inspect full decision & state diff').click()
            for width in [1440,768,390,320]:
                page.set_viewport_size({'width':width,'height':900})
                check('Decision dialog fits at '+str(width),page.get_by_role('dialog').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}'))
            page.set_viewport_size({'width':1440,'height':1000})
            expect(page.get_by_role('dialog')).to_be_visible();page.keyboard.press('Escape')
            check('Decision dialog closes and restores focus',page.get_by_role('button',name='Inspect full decision & state diff').evaluate('(e)=>e===document.activeElement'))
            page.get_by_role('button',name='Capture normal',exact=True).click()
            for name,reason in [('Tamper','AUTH_FAILED'),('Replay','REPLAY'),('Unauthorised','NOT_AUTHORISED'),('Unknown key','KEY_UNKNOWN'),('Malformed JSON','INVALID_JSON')]:
                page.get_by_role('button',name=name,exact=True).click()
                expect(page.locator('.toast')).to_be_visible()
                page.wait_for_timeout(150);submit.click()
                expect(page.get_by_role('heading',name='Message rejected',exact=True)).to_be_visible()
                last=[r for r in responses if r[0]=='/api/messages'][-1][2]
                check(name+' actual reason and trace',last['reason_code']==reason and page.locator('.pipeline-step.fail').count()==1 and page.locator('.pipeline-step.not_run').count()==sum(c['status']=='NOT_RUN' for c in last['checks']))
            page.get_by_role('button',name='Capture attack',exact=True).click()
            page.get_by_title('Open the side-by-side comparison').click()
            check('Captured decisions appear in comparison',page.locator('.compare-col.accepted').count()==1 and page.locator('.compare-col.rejected').count()==1)
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Console',exact=True).click()
            page.get_by_role('button',name='Telemetry',exact=True).click()
            page.locator('#battery').fill('61');page.locator('#temperature').fill('31');page.locator('#mode').select_option('SAFE')
            page.get_by_role('button',name='Generate fresh signed sample').click();page.wait_for_timeout(150)
            check('Telemetry controls reach fixture',json.loads(editor.input_value())['payload']=={'battery_pct':61,'temperature_c':31,'mode':'SAFE'})
            submit.click();expect(page.get_by_role('heading',name='Message accepted',exact=True)).to_be_visible()
            expect(page.locator('.telemetry-reading')).to_contain_text('61');expect(page.locator('.telemetry-reading')).to_contain_text('31')
            check('Telemetry values show actual received snapshot')
            page.get_by_role('button',name='Telemetry fixture',exact=True).click();page.wait_for_timeout(150)
            check('Telemetry shortcut generates fixture',json.loads(editor.input_value())['message_type']=='TELEMETRY')
            page.locator('.scenario-context>summary').focus();page.keyboard.press('Enter')
            expect(page.get_by_role('region',name='Threat explanation')).to_be_visible()
            page.keyboard.press('Enter');check('Scenario context disclosure by keyboard')
            page.get_by_role('button',name='Command',exact=True).click();page.locator('#mode').select_option('SAFE')
            page.get_by_role('button',name='Generate fresh signed sample').click();page.wait_for_timeout(150);submit.click()
            expect(page.get_by_role('heading',name='Message accepted',exact=True)).to_be_visible()
            check('Command selector and SET_MODE submit actual values',receiver.state()['protected_state']['mode']=='SAFE')
            page.locator('#mode').select_option('NORMAL');page.get_by_role('button',name='Generate fresh signed sample').click();page.wait_for_timeout(150)
            check('Mode selection generates NORMAL payload',json.loads(editor.input_value())['payload']['mode']=='NORMAL')
            injected['service']=True;submit.click();expect(page.get_by_role('heading',name='Service unavailable',exact=True)).to_be_visible()
            check('Service-error contract never claims success',page.locator('.pipeline-step.pass').count()==0)
            injected['service']=False
            injected['error']=True;submit.click();expect(page.locator('.inline-error')).to_contain_text('Isolated transport failure');injected['error']=False
            check('HTTP error shown without successful result',page.locator('.pipeline-step.pass').count()==0)
            page.get_by_title('About this simulator').click();expect(page.get_by_role('dialog')).to_be_visible()
            page.keyboard.press('Shift+Tab');check('Dialog focus stays within dialog',page.get_by_role('dialog').evaluate('(e)=>e.contains(document.activeElement)'))
            page.get_by_role('button',name='Back to mission').click()
            page.get_by_title('Show simulator information').click();page.keyboard.press('Escape')
            page.get_by_title('Read validation policy').click();page.keyboard.press('Escape');check('All help entry points open and close')
            page.get_by_role('button',name='New demo session',exact=True).click();page.get_by_role('button',name='Keep current session').click();check('Session dialog cancels')
            page.get_by_role('button',name='New demo session',exact=True).click();page.get_by_role('button',name='Create session',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
            check('Create session uses isolated API',any(r[1]=='/api/demo/sessions' for r in requests))
            page.get_by_role('button',name='Reset',exact=True).click();expect(editor).to_have_value('');check('Reset clears editor through isolated API')
            page.get_by_role('button',name='Generate telemetry',exact=True).click();page.wait_for_timeout(150);check('Empty telemetry action loads fixture',bool(editor.input_value()))
            with page.expect_download() as download:page.get_by_role('button',name='Export JSON').click()
            check('JSON export matches exact API response',json.loads(Path(download.value.path()).read_text(encoding="utf-8"))==[r for r in responses if r[0]=='/api/export'][-1][2])
            page.locator('.toast button').click()
            check('Toast dismissal',page.locator('.toast').count()==0)
            for width in [1440,1024,768,390,320]:
                page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(100)
                check('No horizontal overflow at '+str(width),page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                page.get_by_role('button',name='New demo session',exact=True).click()
                check('Dialog fits at '+str(width),page.get_by_role('dialog').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}'))
                page.keyboard.press('Escape')
                if width in [1440,768,390]:page.screenshot(path=str(Path(tempfile.gettempdir())/('kavach-console-'+str(width)+'.png')),full_page=True)
            page.get_by_role('button',name='Toggle navigation').click();check('Mobile navigation opens',page.get_by_role('navigation',name='Main navigation').is_visible())
            page.set_viewport_size({'width':1440,'height':1000})
            for label,heading in [('Demo','Guided Demo'),('Scenarios','Scenario Lab'),('Timeline','Attack Timeline'),('Compare','Normal vs Attack'),('Metrics','Security Metrics'),('Audit','Audit & Evidence'),('Policy','Policy Model'),('Console','Mission Console')]:
                page.get_by_role('navigation',name='Main navigation').get_by_role('button',name=label,exact=True).click();expect(page.get_by_role('heading',name=heading,exact=True)).to_be_visible()
                check('Navigation '+label)
            page.get_by_role('button',name='View all activity').click();expect(page.get_by_role('heading',name='Audit & Evidence',exact=True)).to_be_visible();check('Recent activity link')
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Console',exact=True).click()
            page.get_by_title('Open all scenarios').click();expect(page.get_by_role('heading',name='Scenario Lab',exact=True)).to_be_visible()
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Console',exact=True).click()
            page.get_by_title('Open the side-by-side comparison').click();expect(page.get_by_role('heading',name='Normal vs Attack',exact=True)).to_be_visible()
            check('Scenario and comparison shortcut navigation')
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Console',exact=True).click()
            page.get_by_role('button',name='Policy v1.0').click();page.get_by_role('button',name='Close information').click();check('Footer information dialog')
            injected['audit']=True
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Audit',exact=True).click()
            page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Console',exact=True).click()
            expect(page.get_by_role('button',name='Retry audit')).to_be_visible();injected['audit']=False
            page.get_by_role('button',name='Retry audit').click();expect(page.get_by_role('button',name='Retry audit')).to_have_count(0)
            check('Audit failure and retry')
            page.emulate_media(reduced_motion='reduce')
            check('Reduced motion removes console transitions',page.locator('.submit-btn').evaluate('(e)=>getComputedStyle(e).transitionDuration')=='0s')
            injected['offline']=True;page.reload();page.get_by_role('button',name='ENTER MISSION CONTROL',exact=True).first.click()
            expect(page.locator('.status-strip')).to_contain_text('Offline')
            check('Offline disables generation and submit',page.get_by_role('button',name='Generate fresh signed sample').is_disabled() and submit.is_disabled())
            check('No unexpected HTTP responses',all(r[1]<400 for r in responses))
            check('No unexpected browser console errors',all('503' in e for e in console_errors))
            check('No uncaught browser errors',not errors)
            check('No failed network requests',not failed)
            ctx.close();browser.close()
    print(json.dumps({'passed':len(checks),'failed':0,'api':'Real FastAPI + disposable Engine; live API never contacted'},indent=2))

if __name__=='__main__':main()
