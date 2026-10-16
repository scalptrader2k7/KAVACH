"""Optional browser integration script. Importing this module never launches Chromium."""

def main():
    from playwright.sync_api import sync_playwright,expect
    from pathlib import Path
    import html,json,time
    ROOT=Path(__file__).resolve().parent.parent
    with sync_playwright() as p:
     b=p.chromium.launch(headless=True,args=['--no-sandbox'])
     page=b.new_page(viewport={'width':1440,'height':900})
     errors=[];requests=[]
     page.on('pageerror',lambda e:errors.append(str(e)))
     page.on('request',lambda r:requests.append(r.url))
     content=(ROOT/'preview/Kavach-interactive-prototype.html').read_text()
     wrapper='<iframe title="Kavach prototype" sandbox="allow-scripts" srcdoc="'+html.escape(content,quote=True)+'" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>'
     page.route('http://127.0.0.1:8000/__offline_preview_check',lambda route:route.fulfill(content_type='text/html; charset=utf-8',body=wrapper))
     page.goto('http://127.0.0.1:8000/__offline_preview_check',wait_until='networkidle')
     frame=page.frame_locator('iframe')
     expect(frame.get_by_role('heading',name='Mission Console',exact=True)).to_be_visible(timeout=20000)
     expect(frame.locator('.submit-btn')).to_be_enabled(timeout=20000)
     frame.locator('.submit-btn').click()
     expect(frame.locator('.verdict-banner h3')).to_have_text('Message accepted')
     expect(frame.locator('.state-values')).to_contain_text('Power saving')
     frame.get_by_role('button',name='Tamper',exact=True).click()
     expect(frame.locator('.signature-status')).to_contain_text('Modified since signing')
     frame.locator('.submit-btn').click()
     expect(frame.locator('.verdict-banner p')).to_contain_text('auth failed')
     frame.get_by_role('button',name='Replay',exact=True).click()
     expect(frame.locator('.signature-status')).not_to_contain_text('Modified since signing')
     frame.locator('.submit-btn').click()
     expect(frame.locator('.verdict-banner p')).to_contain_text('replay')
     frame.get_by_role('button',name='Scenario Lab',exact=True).click()
     frame.get_by_role('button',name='Run browser suite',exact=True).click()
     expect(frame.locator('.suite-score')).to_contain_text('8',timeout=20000)
     expect(frame.locator('.test-row')).to_have_count(8)
     print('Suite:',frame.locator('.suite-score').inner_text())
     assert frame.locator('.suite-score').inner_text().replace(' ','').strip()=='8/8'
     frame.get_by_role('button',name='Audit & Evidence',exact=True).click()
     frame.get_by_label('Filter by verdict').select_option('REJECTED')
     expect(frame.locator('.audit-table tbody tr')).to_have_count(2)
     frame.get_by_role('button',name='Export evidence',exact=True).click()
     expect(frame.get_by_role('heading',name='Export evidence ·',exact=False)).to_be_visible(timeout=15000)
     frame.get_by_role('button',name='Close',exact=True).click()
     frame.get_by_role('button',name='Mission Console',exact=True).click()
     page.screenshot(path=str(ROOT/'reports/offline-prototype-desktop.png'),full_page=True)
     page.set_viewport_size({'width':390,'height':844})
     assert frame.locator('html').evaluate('(e)=>e.scrollWidth<=innerWidth')
     print('Runtime errors:',errors)
     print('Requests:',len(requests),requests[:3])
     assert not errors
     assert len(requests)==1,'External request detected'
     (ROOT/'reports/offline-prototype-tests.json').write_text(json.dumps({'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'mode':'Browser-only HTML; sandbox allow-scripts without allow-same-origin; external network disabled by architecture','valid_command':'passed','tamper':'passed','byte_exact_replay':'passed','suite':'8/8 passed','audit_filter':'passed','evidence_overlay':'passed','mobile_no_horizontal_overflow':True,'external_requests':0,'javascript_errors':errors},indent=2))
     b.close()


def _record_failure(status,reason):
    import json,time
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    (root/'reports').mkdir(exist_ok=True)
    (root/'reports/offline-prototype-tests.json').write_text(json.dumps({'status':status,'reason':reason,'executed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'passed':0},indent=2))

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
