"""Phase 1 browser regression checks. Never permits a persistent API write.

Requires an already running production build and existing Playwright/browser:
    python -B tests/browser_landing.py --channel chrome
No reports, screenshots, fixtures, sessions, or commands are written.
"""
import argparse
import json
import sys
from urllib.parse import urljoin, urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--channel', default='chrome')
    args = parser.parse_args()
    if urlsplit(args.base_url).hostname not in {'localhost', '127.0.0.1', '::1'}:
        parser.error('Use a local simulator URL only.')
    try:
        from playwright.sync_api import sync_playwright, expect
    except ImportError:
        print('BLOCKED: Playwright is not installed. Nothing was installed.')
        return 2
    checks = []

    def check(name, passed):
        checks.append({'name': name, 'passed': bool(passed)})
        assert passed, name

    counters = """(() => {
      window.__earthDraws=0;window.__earthDeletes=0;window.__earthContexts=[];
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        const gl=original.call(this,type,...args);
        if(gl&&String(type).startsWith('webgl')&&!window.__earthContexts.includes(gl)){
          window.__earthContexts.push(gl);
          for(const name of ['drawElements','drawArrays']){const fn=gl[name];gl[name]=function(...a){window.__earthDraws++;return fn.apply(this,a)}}
          for(const name of ['deleteTexture','deleteBuffer','deleteProgram']){const fn=gl[name];gl[name]=function(...a){window.__earthDeletes++;return fn.apply(this,a)}}
        }
        return gl;
      };
    })();"""
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel=args.channel, headless=True)
        except Exception as exc:
            print('BLOCKED: existing browser could not launch: ' + str(exc).splitlines()[0])
            return 2
        blocked, external, errors, bad_responses, api_requests = [], [], [], [], []

        def context(**kwargs):
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, **kwargs)

            def guard(route):
                request = route.request
                if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                    blocked.append(request.method + ' ' + request.url)
                    route.abort()
                elif urlsplit(request.url).hostname not in {'localhost', '127.0.0.1', '::1'}:
                    external.append(request.url)
                    route.abort()
                else:
                    route.continue_()
            ctx.route('**/*', guard)
            ctx.add_init_script(counters)
            return ctx

        ctx = context()
        page = ctx.new_page()
        page.on('request', lambda request: api_requests.append(request.url) if '/api/' in request.url else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('response', lambda response: bad_responses.append(response.url) if response.status >= 400 else None)
        before_state = page.request.get(args.base_url + '/api/state').json()
        before_count = page.request.get(args.base_url + '/api/audit?limit=1').json()['total']
        page.goto(args.base_url, wait_until='networkidle')
        expect(page.locator('[data-earth-status]')).to_have_attribute('data-earth-status', 'ready')
        check('Landing is first screen', page.locator('#landing-title').is_visible() and page.locator('.app-shell').count() == 0)
        check('Landing makes no API requests', not api_requests)
        draws = page.evaluate('window.__earthDraws')
        page.wait_for_timeout(650)
        check('Earth rotates/renders continuously', page.evaluate('window.__earthDraws') > draws)
        first_frame = page.locator('canvas').screenshot()
        page.wait_for_timeout(700)
        check('Rotation changes the rendered image', first_frame != page.locator('canvas').screenshot())
        page.get_by_role('button', name='Pause Earth rotation').click()
        page.wait_for_timeout(100)
        draws = page.evaluate('window.__earthDraws')
        page.wait_for_timeout(350)
        check('Pause stops rendering', draws == page.evaluate('window.__earthDraws'))
        page.get_by_role('button', name='Resume Earth rotation').click()
        page.wait_for_timeout(350)
        check('Resume restarts rendering', page.evaluate('window.__earthDraws') > draws)
        page.get_by_role('button', name='EXPLORE CAPABILITIES', exact=True).click()
        expect(page.locator('#landing-capabilities')).to_be_focused()
        page.wait_for_function("document.querySelector('#landing-capabilities').getBoundingClientRect().top<innerHeight*.6")
        check('Explore scrolls to capabilities', True)
        for title in ['Command Validation', 'Telemetry Intelligence', 'Audit & Evidence']:
            check(title + ' summary', page.get_by_role('heading', name=title, exact=True).is_visible())
        attribution = page.get_by_role('link', name='Earth imagery: NASA').get_attribute('href')
        credit = page.request.get(urljoin(args.base_url, attribution))
        check('Local attribution is readable', credit.status == 200 and 'Usage guidelines' in credit.text())
        for width in [1440, 768, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            check('No overflow at ' + str(width), page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.set_viewport_size({'width': 1440, 'height': 600})
        page.evaluate('scrollTo(0,document.documentElement.scrollHeight)')
        page.wait_for_function("document.querySelector('.landing-earth').getBoundingClientRect().bottom<0")
        page.wait_for_timeout(150)
        draws = page.evaluate('window.__earthDraws')
        page.wait_for_timeout(350)
        check('Offscreen globe stops rendering', draws == page.evaluate('window.__earthDraws'))
        page.evaluate('scrollTo(0,0)')
        page.wait_for_timeout(350)
        check('Visible globe resumes rendering', page.evaluate('window.__earthDraws') > draws)
        # Simulate document visibility without changing application configuration.
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        draws = page.evaluate('window.__earthDraws')
        page.wait_for_timeout(350)
        check('Hidden-document handler stops rendering', draws == page.evaluate('window.__earthDraws'))
        page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
        page.get_by_role('button', name='ENTER MISSION CONTROL', exact=True).first.click()
        expect(page.get_by_role('heading', name='Mission Console', exact=True)).to_be_focused()
        check('Existing console opens', page.locator('.app-shell').count() == 1)
        check('Globe unmounted', page.locator('canvas').count() == 0)
        check('GPU resources disposed', page.evaluate('window.__earthDeletes') > 0)
        draws = page.evaluate('window.__earthDraws')
        page.wait_for_timeout(350)
        check('No rendering after entry', draws == page.evaluate('window.__earthDraws'))
        navigation = page.get_by_role('navigation', name='Main navigation')
        for label, heading in [('Demo', 'Guided Demo'), ('Scenarios', 'Scenario Lab'), ('Timeline', 'Attack Timeline'), ('Compare', 'Normal vs Attack'), ('Metrics', 'Security Metrics'), ('Audit', 'Audit & Evidence'), ('Policy', 'Policy Model'), ('Console', 'Mission Console')]:
            navigation.get_by_role('button', name=label, exact=True).click()
            expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
            check('Existing navigation: ' + label, True)
        check('Console starts with empty editor', page.get_by_role('textbox', name='Editable message JSON').input_value() == '')
        check('No normal-path browser errors', not errors and not bad_responses)
        check('Live state unchanged', before_state == page.request.get(args.base_url + '/api/state').json())
        check('Audit count unchanged', before_count == page.request.get(args.base_url + '/api/audit?limit=1').json()['total'])
        ctx.close()

        ctx = context(reduced_motion='reduce')
        page = ctx.new_page(); page.goto(args.base_url, wait_until='networkidle')
        expect(page.locator('[data-earth-status]')).to_have_attribute('data-earth-status', 'ready')
        expect(page.get_by_role('button', name='Resume Earth rotation')).to_be_visible()
        page.wait_for_timeout(150); draws = page.evaluate('window.__earthDraws'); page.wait_for_timeout(350)
        check('Reduced motion is static', draws == page.evaluate('window.__earthDraws'))
        page.emulate_media(reduced_motion='no-preference'); page.wait_for_timeout(350)
        check('Motion preference changes are observed', page.evaluate('window.__earthDraws') > draws)
        ctx.close()

        for failure in ['webgl', 'texture', 'context-loss']:
            ctx = context()
            if failure == 'webgl':
                ctx.add_init_script("HTMLCanvasElement.prototype.getContext=function(){return null}")
            elif failure == 'texture':
                ctx.route('**/assets/blue-marble-2048-*.jpg', lambda route: route.abort())
            page = ctx.new_page(); page.goto(args.base_url, wait_until='networkidle')
            if failure == 'context-loss':
                expect(page.locator('[data-earth-status]')).to_have_attribute('data-earth-status', 'ready')
                page.evaluate("window.__earthContexts[0].getExtension('WEBGL_lose_context').loseContext()")
            expect(page.locator('[data-earth-status]')).to_have_attribute('data-earth-status', 'unavailable')
            check(failure + ' fallback', page.locator('.landing-hero-copy').is_visible())
            page.get_by_role('button', name='ENTER MISSION CONTROL', exact=True).first.click()
            expect(page.get_by_role('heading', name='Mission Console', exact=True)).to_be_visible()
            check(failure + ' does not block entry', True)
            ctx.close()
        for selector in ['.landing-header-right button', '.landing-continue button']:
            ctx = context(); page = ctx.new_page(); page.goto(args.base_url, wait_until='domcontentloaded')
            page.locator(selector).click()
            expect(page.get_by_role('heading', name='Mission Console', exact=True)).to_be_visible()
            check(selector + ' enters existing console', page.locator('canvas').count() == 0)
            ctx.close()
        check('No persistent requests attempted', not blocked)
        check('No external runtime dependencies', not external)
        browser.close()
    print(json.dumps({'passed': len(checks), 'failed': 0, 'checks': checks}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
