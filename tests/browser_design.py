from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright, expect
out=Path('reports/design');out.mkdir(exist_ok=True)
checks=[]
with sync_playwright() as p:
 b=p.chromium.launch()
 page=b.new_page(viewport={'width':1440,'height':1000})
 page.goto(os.environ.get('KAVACH_URL','http://127.0.0.1:8001'));expect(page.locator('.submit-btn')).to_be_enabled()
 page.get_by_role('button',name='Unauthorised',exact=True).click()
 expect(page.locator('.submit-btn')).to_be_enabled()
 page.locator('.submit-btn').click()
 expect(page.locator('.proof-decision')).to_contain_text('action not authorised')
 expect(page.locator('.identity-gates')).to_contain_text('Denied')
 expect(page.locator('.identity-gates')).to_contain_text('Passed')
 checks.append('Authenticated but unauthorised receiver result rendered separately')
 for width in [1440,1024,768,390,320]:
  page.set_viewport_size({'width':width,'height':900})
  page.screenshot(path=str(out/f'after-console-{width}.png'),full_page=True)
  overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth')
  assert not overflow, f'Console overflow at {width}'
  for label in ['Scenario Lab','Audit & Evidence']:
   page.get_by_role('button',name=label,exact=True).click()
   assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'),f'{label} overflow at {width}'
   page.screenshot(path=str(out/f'after-{label.split()[0].lower()}-{width}.png'),full_page=True)
  page.get_by_role('button',name='Mission Console',exact=True).click()
  checks.append(f'Console, scenarios and audit reflow at {width}px')
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_title('About this simulator').focus()
 page.keyboard.press('Enter')
 expect(page.get_by_role('dialog')).to_be_visible()
 for _ in range(12):
  page.keyboard.press('Tab')
  assert page.evaluate('document.activeElement.closest("[role=dialog]") !== null')
 page.keyboard.press('Escape')
 expect(page.get_by_title('About this simulator')).to_be_focused()
 checks.append('Modal focus entry, containment, Escape and restoration')
 page.locator('.code-editor textarea').focus()
 assert page.locator('.code-editor').evaluate('(el)=>getComputedStyle(el).outlineStyle')=='solid'
 checks.append('Visible editor focus indicator')
 b.close()
(out/'verification.json').write_text(json.dumps({'checks':checks,'passed':len(checks)},indent=2))
print(json.dumps(checks,indent=2))
