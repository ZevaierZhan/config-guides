#!/usr/bin/env python3
"""Optional developer browser check. Runtime package does NOT depend on Python.
Requires Python Playwright + an existing Chromium. Set CHROMIUM_BIN when needed.
First tries real loopback navigation; falls back to an explicitly reported HTTP bridge
only when the managed browser blocks loopback URLs. No OCR is used.
"""
import json, os, pathlib, re, subprocess, tempfile, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = pathlib.Path(os.environ.get('GUIDE_TEST_OUTPUT', tempfile.gettempdir()))
OUTPUT.mkdir(parents=True, exist_ok=True)
REPORT = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    for label, source in [('hello', ROOT/'examples/hello-world.json'), ('jira', ROOT/'examples/opencli-plugin-jira/jira-guide.json')]:
        with tempfile.TemporaryDirectory(prefix='config-guide-js-ui-') as tmp:
            workspace = pathlib.Path(tmp)
            spec = json.loads(source.read_text())
            spec['targets']['config']['path'] = {'base':'workspaceDir', 'relative':'output/settings.json'}
            spec_file = workspace/'guide.json'; spec_file.write_text(json.dumps(spec, ensure_ascii=False))
            proc = subprocess.Popen(['node', str(ROOT/'bin/config-guide.js'), '--spec', str(spec_file), '--workspace-dir', tmp, '--no-open', '--timeout', '45s'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                url = None
                for line in proc.stderr:
                    match = re.search(r'http://127\.0\.0\.1:\d+/#session=[a-f0-9]+', line)
                    if match: url = match.group(); break
                assert url, 'Local URL not emitted'
                origin, token = url.split('/#session=')
                page = browser.new_page(viewport={'width':1280, 'height':1000})
                errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
                mode = 'direct-loopback'
                try:
                    response = page.goto(url, wait_until='domcontentloaded', timeout=5000)
                    if response and response.status >= 400: raise RuntimeError(f'navigation returned {response.status}')
                    page.locator('#field-0').wait_for(timeout=3000)
                except Exception:
                    mode = 'memory-assets-plus-real-http-bridge'
                    # A fresh about:blank page avoids inherited error-page CSP/origin.
                    page.close()
                    page = browser.new_page(viewport={'width':1280, 'height':1000})
                    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    def bridge(route, options):
                        headers = dict(options.get('headers', {}))
                        if options.get('method') == 'POST': headers['Origin'] = origin
                        data = options.get('body')
                        request = urllib.request.Request(origin + route, data=None if data is None else data.encode(), headers=headers, method=options.get('method', 'GET'))
                        try:
                            with opener.open(request, timeout=10) as response: return {'status':response.status, 'body':response.read().decode()}
                        except urllib.error.HTTPError as e: return {'status':e.code, 'body':e.read().decode()}
                    page.expose_function('__httpBridge', bridge)
                    html = (ROOT/'web/index.html').read_text().replace('<link rel="stylesheet" href="/style.css">', '').replace('<script src="/app.js" defer></script>', '')
                    page.set_content(html)
                    page.add_style_tag(content=(ROOT/'web/style.css').read_text())
                    page.evaluate("token => { location.hash='session='+token; window.fetch=async(route,options)=>{ const r=await window.__httpBridge(route,options); return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>JSON.parse(r.body)}; }; }", token)
                    page.add_script_tag(content=(ROOT/'web/app.js').read_text())
                    page.locator('#field-0').wait_for(timeout=5000)
                    errors.clear()  # only errors from actual form rendering count below
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(OUTPUT/f'{label}-desktop.png'), full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                if label == 'hello':
                    assert page.locator('#field-0').input_value() == 'World'
                    page.locator('#field-0').fill('Zevaier')
                    page.locator('#field-1').fill('Hello from JavaScript 配置引导工具!')
                else:
                    page.locator('#field-0').fill('https://jira.example.invalid')
                    page.locator('#field-1').fill('example@example.com')
                    assert page.locator('#field-2').input_value() == '0'
                    assert page.locator('#field-3').get_attribute('type') == 'password'
                    page.locator('#field-3').fill('FAKE_TEST_TOKEN')
                    page.locator('#field-4').fill('DEMO')
                page.get_by_role('button', name=spec['submit']['label'], exact=True).click()
                page.locator('#result-title').wait_for(state='visible')
                assert page.locator('#result-title').inner_text() == '配置已保存'
                if label == 'jira': assert page.locator('#field-3').input_value() == ''
                assert not errors, errors
                page.screenshot(path=str(OUTPUT/f'{label}-saved-mobile.png'), full_page=True)
                stdout, stderr = proc.communicate(timeout=8)
                assert proc.returncode == 0, (stdout,stderr)
                result = json.loads(stdout)
                assert result['persistence'] == 'saved'
                assert result['verification'] == 'not-requested'
                assert 'FAKE_TEST_TOKEN' not in stdout + stderr
                saved = json.loads((workspace/'output/settings.json').read_text())
                if label == 'hello': assert saved['profile']['name'] == 'Zevaier'
                else: assert saved['auth']['token'] == 'FAKE_TEST_TOKEN'
                REPORT.append({'case':label, 'mode':mode, 'desktop':True, 'mobile':True, 'save':True, 'browserVersion':browser.version})
                page.close()
            finally:
                if proc.poll() is None: proc.terminate(); proc.communicate(timeout=5)
    browser.close()
print(json.dumps(REPORT, ensure_ascii=False, indent=2))
(OUTPUT/'browser-report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2)+'\n')
