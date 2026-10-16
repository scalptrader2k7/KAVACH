"""Build a self-contained, explicitly browser-only fallback from the real React UI.
No production runtime keys/database are read, embedded, or copied.
"""
from pathlib import Path
import subprocess,re,base64
import os

def main():
    ROOT=Path(__file__).resolve().parent.parent
    source=(ROOT/'web/src/main.tsx').read_text()
    replacements={
     "import './styles.css';":"import '../web/src/styles.css';",
     "['commit','State commit','Atomic execution & audit record',CheckCheck]":"['commit','Apply preview state','In-memory update; no database',CheckCheck]",
     'BY VYOM':'PREVIEW',
     '<span>API <strong>':'<span>Engine <strong>',
     "isOnline?'Connected'":"isOnline?'Ready'",
     'Local API is unavailable. Check that the Python server is running.':'Browser engine unavailable. Open this HTML in a modern browser with Web Crypto support.',
     '29 ENGINE SCENARIOS':'8 BROWSER SCENARIOS',
     'Run full test suite':'Run browser suite',
     'deterministic suite in an isolated session':'eight-case browser suite in isolated memory',
     'Real validation decisions.':'Browser-only validation.',
     'Injected clock · ':'Clock · ',
     'Committed state snapshots, validation traces, and message fingerprints. Stored locally in SQLite.':'Preview snapshots, validation traces, and fingerprints. Stored in browser memory until this file is closed.',
     'PERSISTENT HISTORY':'IN-MEMORY PREVIEW',
     'Application records are persistent, not immutable or tamper-proof.':'Preview records are in-memory only, not persistent, immutable, or tamper-proof.',
     'Committed state update verified':'Preview memory updated',
     'Protected state changed in committed transaction.':'Preview state changed in browser memory only.',
     'No execution was committed.':'No preview execution was applied.',
     'Synthetic application record. Not immutable or tamper-proof. No secret key is included.':'Browser-only prototype record. Not Python/SQLite evidence. No production key is used or included.',
     'All verdicts and state changes come from the Python backend.':'In this offline preview, verdicts come from a separate JavaScript validator using Web Crypto. This is NOT the Python backend.',
     'Strict schemas, HMAC-SHA256, 60-second lifetimes, receiver permissions, and persistent replay protection.':'Strict parsing, browser HMAC-SHA256, 60-second lifetimes, fixed permissions, and in-memory replay checks.',
     'State, replay records, and acceptance logs commit in one SQLite transaction. Ordinary reloads retain your session. A new demo session creates an isolated namespace.':'This file keeps state, replay records, and activity in memory. Reopening resets all preview data. The full Python app separately provides SQLite transactions, persistence, restart protection, and concurrency tests.',
     'HMAC provides integrity and shared-key authentication, not encryption or proof of physical reality. Audit records are not tamper-proof. Passing scenarios covers these cases only.':'Preview keys are generated in browser memory and are NOT server-side secrets or an identity boundary. No database, durability, concurrency, or fault-injection guarantees are tested here. Browser records are not tamper-proof.',
     'kavach-policy/1.0':'browser-prototype/1.0',
     'Policy v1.0':'Browser-only policy',
     'Signed by local fixture issuer':'Signed by browser fixture issuer',
     'The fixture issuer is a deliberately privileged test harness. It can sign unauthorised fixtures so receiver policy is testable. Passing these cases does not establish production security.':'This eight-case suite runs the JavaScript browser validator only. It does not run the 29-case Python suite, SQLite transactions, restart, concurrency, or database-failure tests. Preview keys are ephemeral browser keys.',
     'LOCAL SATELLITE SECURITY SIMULATOR':'BROWSER-ONLY INTERACTIVE PROTOTYPE',
    }
    for a,b in replacements.items():source=source.replace(a,b)
    source=re.sub(r"from './(api|editor|types|components/[^']+)'",r"from '../web/src/\1'",source)
    source=source.replace('<ValidationPipeline result=', '<ValidationPipeline prototypeOnly result=')
    (ROOT/'preview/offline-main.tsx').write_text(source)
    folder=ROOT/'.arena/offline';folder.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(ROOT/'preview/offline-main.tsx'),'--bundle','--format=iife','--target=es2022','--minify','--external:/fonts/*','--outfile='+str(folder/'app.js')],cwd=ROOT,check=True)
    css=(folder/'app.css').read_text()
    def embed_font(match):
     name=match.group(1);data=(ROOT/'web/public/fonts'/name).read_bytes()
     mime='font/woff2' if name.endswith('.woff2') else 'font/ttf'
     return 'url(data:'+mime+';base64,'+base64.b64encode(data).decode()+')'
    css=re.sub(r'''url\(['"]?/fonts/([^)'"\s]+)['"]?\)''',embed_font,css)
    extra='''
    .prototype-banner{position:relative;z-index:71;background:#252016;color:#e5c291;border-bottom:1px solid #6c5030;padding:12px 24px;display:flex;gap:13px;align-items:center;font:11px/1.7 system-ui,sans-serif}.prototype-banner strong{font-size:10px;letter-spacing:.8px;white-space:nowrap;color:#ffc793}.prototype-banner span{color:#c7b395}.prototype-banner i{font-style:normal;color:#f0d4aa}.by-vyom{color:#bc956f}.prototype-banner button{background:#453420;border:1px solid #715335;color:#efd4af;border-radius:4px;padding:7px 10px;font:10px system-ui;white-space:nowrap;margin-left:auto}.prototype-banner button:hover{background:#594029}.local-label{color:#c4b196}@media(max-width:720px){.prototype-banner{padding:12px 17px;gap:7px;display:block;font-size:9px}.prototype-banner strong{display:block;font-size:9px;margin-bottom:3px}.prototype-banner button{display:none}}
    '''
    adapter=(ROOT/'preview/offline-adapter.js').read_text()
    app=(folder/'app.js').read_text()
    script=(adapter+'\n'+app).replace('</script','<\\/script')
    html='''<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0b0f15"><title>Kavach · Interactive browser prototype</title><style>'''+css+extra+'''</style></head><body><div class="prototype-banner"><strong>INTERACTIVE PROTOTYPE · BROWSER ONLY</strong><span>Works without the preview server. <i>Not the Python receiver.</i> Synthetic keys and records stay in memory; reopening resets this demo.</span><button onclick="document.querySelector('.help-button')?.click()">What is different?</button></div><div id="root"></div><script>'''+script+'''</script></body></html>'''
    output=Path(os.environ.get('KAVACH_OFFLINE_OUTPUT',str(ROOT/'preview/Kavach-interactive-prototype.html')))
    output.write_text(html)
    print(f'{output}: {output.stat().st_size:,} bytes; self-contained, no external resources')

if __name__=='__main__': main()
