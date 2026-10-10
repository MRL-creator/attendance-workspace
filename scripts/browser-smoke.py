"""Exercise a disposable local installation using synthetic data only."""
import argparse
import datetime
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:8787')
parser.add_argument('--channel',default='msedge')
args=parser.parse_args()
if urlparse(args.url).hostname not in ('localhost','127.0.0.1','::1'):
    raise SystemExit('Use a disposable loopback development server, not a hosted installation.')
key=os.environ.get('SMOKE_SETUP_KEY','')
password=os.environ.get('SMOKE_PASSWORD','')
if len(key)<32 or len(password)<12:
    raise SystemExit('Set SMOKE_SETUP_KEY (32+ characters) and SMOKE_PASSWORD (12+ characters).')
root=Path(__file__).resolve().parent.parent
images=root/'docs'/'images'
images.mkdir(parents=True,exist_ok=True)
artifacts=root/'.test-artifacts'
artifacts.mkdir(exist_ok=True)
with sync_playwright() as p:
    options={'headless':True}
    if args.channel!='chromium': options['channel']=args.channel
    browser=p.chromium.launch(**options)
    context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    print('Initial screen:',page.locator('h2').first.inner_text())
    if page.get_by_role('heading',name='Create your workspace').count():
        page.screenshot(path=str(images/'setup.png'),full_page=True,style='#toast{visibility:hidden}')
        for name,value in {'bootstrap':key,'workspace_name':'Community Learning','name':'Alex Teacher','email':'alex@example.org','password':password}.items():
            page.locator(f'#auth-form [name="{name}"]').fill(value)
        page.get_by_role('button',name='Create workspace',exact=True).click()
        expect(page.get_by_role('heading',name='Welcome back')).to_be_visible()
    page.locator('#auth-form [name=email]').fill('alex@example.org')
    page.locator('#auth-form [name=password]').fill(password)
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.locator('#content h1')).to_be_visible()
    page.wait_for_load_state('networkidle')
    print('Navigation:',page.locator('.sidebar button[data-view]').evaluate_all('(els)=>els.map(e=>({view:e.dataset.view,text:e.innerText}))'))

    def api(path,method='GET',data=None,status=200):
        # Use browser fetch: browsers treat secure cookies on loopback differently
        # from Playwright's separate request client.
        result=page.evaluate("""async ({path,method,data})=>{
            const response=await fetch(path,{method,headers:data?{'content-type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});
            return {status:response.status,text:await response.text()};
        }""",{'path':path,'method':method,'data':data})
        assert result['status']==status,(path,result['status'],result['text'])
        import json
        return json.loads(result['text'])

    course=next((c for c in api('/api/courses') if c['name']=='Introduction to Python'),None)
    if not course: course=api('/api/courses','POST',{'name':'Introduction to Python','description':'Synthetic demonstration course'},201)
    group=next((g for g in api('/api/groups') if g['name']=='Python - Morning'),None)
    if not group: group=api('/api/groups','POST',{'name':'Python - Morning','course_id':course['id']},201)
    def nav(view):
        page.locator(f'.sidebar [data-view="{view}"]').first.click()
        page.wait_for_load_state('networkidle')
        expect(page.locator('#content h1')).to_be_visible()
        assert not page.locator('#content .error-panel').count(),page.locator('#content').inner_text()

    nav('import')
    page.locator('#import-course').select_option(course['id'])
    page.locator('#import-group').select_option(group['id'])
    page.locator('#import-file').set_input_files(str(root/'examples/sample-workbook.xlsx'))
    expect(page.get_by_role('tab',name='Students',exact=True)).to_be_visible()
    page.get_by_role('tab',name='Attendance',exact=True).click()
    expect(page.locator('#workbook-preview')).to_contain_text('Present')
    page.get_by_role('tab',name='Students',exact=True).click()
    page.get_by_role('button',name='Continue to column mapping').click()
    page.locator('[name="map-full_name"]').select_option('-1')
    page.get_by_role('button',name='Validate and preview').click()
    expect(page.locator('#toast')).to_contain_text('Map Student Name')
    page.locator('[name="map-full_name"]').select_option('0')
    page.get_by_role('button',name='Validate and preview').click()
    expect(page.locator('#import-preview')).to_be_visible()
    page.screenshot(path=str(images/'import.png'),full_page=True,style='#toast{visibility:hidden}')
    existing=api('/api/students?group='+group['id'])
    if not existing:
        page.get_by_role('button',name='Confirm import',exact=True).click()
        expect(page.locator('#content h1')).to_have_text('Students')
        assert len(api('/api/students?group='+group['id']))==3
    else:
        expect(page.locator('#import-preview')).to_contain_text('Skip possible duplicate')

    # Invalid files must clear any earlier usable mapping/review.
    nav('import')
    page.locator('#import-file').set_input_files(str(root/'examples/students.csv'))
    expect(page.locator('[name="map-full_name"]')).to_be_visible()
    page.get_by_role('button',name='Validate and preview').click()
    expect(page.locator('#import-preview')).to_contain_text('Skip possible duplicate')
    page.locator('#import-file').set_input_files({'name':'corrupt.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':b'not a workbook'})
    expect(page.locator('#workbook-preview')).to_contain_text('Workbook could not be opened')
    expect(page.locator('#import-preview')).to_be_hidden()
    assert page.locator('[name="map-full_name"]').count()==0

    uid=api('/api/me')['user']['id']
    sessions=api('/api/sessions?group='+group['id'])
    if not sessions:
        for offset in range(8):
            date=str(datetime.date.today()-datetime.timedelta(days=offset*3))
            result=api('/api/sessions','POST',{'course_id':course['id'],'group_id':group['id'],'instructor_id':uid,'session_date':date,'start_time':'10:00','end_time':'11:00','room':'Room 204','notes':'Synthetic example session'},201)
            roster=api('/api/sessions/'+result['id']+'/attendance')
            api('/api/sessions/'+result['id']+'/attendance','PUT',{'attendance':[{'student_key':row['student_key'],'status':'present' if (index+offset)%3 else 'absent'} for index,row in enumerate(roster)]})
        sessions=api('/api/sessions?group='+group['id'])

    # Attendance import uses the selected existing session, not file metadata.
    nav('import')
    page.locator('#import-type').select_option('attendance')
    page.locator('#import-session').select_option(sessions[0]['id'])
    page.locator('#import-file').set_input_files(str(root/'examples/sample-workbook.xlsx'))
    page.get_by_role('tab',name='Attendance',exact=True).click()
    page.get_by_role('button',name='Continue to column mapping').click()
    page.locator('[name="map-full_name"]').select_option('0')
    page.locator('[name="map-status"]').select_option('1')
    page.get_by_role('button',name='Validate and preview').click()
    expect(page.locator('#import-preview')).to_contain_text('3 rows ready')
    page.get_by_role('button',name='Confirm import',exact=True).click()
    expect(page.locator('#content h1')).to_have_text('Sessions')

    nav('overview')
    page.screenshot(path=str(images/'dashboard.png'),full_page=True,style='#toast{visibility:hidden}')
    nav('groups')
    page.locator('[data-action="open-group"]').first.click()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#content')).to_contain_text('Morgan Chen')
    assert not page.locator('#content .error-panel').count()

    nav('excel')
    page.locator('#excel-file').set_input_files(str(root/'examples/sample-workbook.xlsx'))
    expect(page.get_by_role('tab',name='Attendance',exact=True)).to_be_visible()
    page.get_by_role('tab',name='Attendance',exact=True).click()
    page.locator('[data-excel-search]').fill('Sam')
    expect(page.locator('[data-excel-count]')).to_contain_text('1 of 4 rows')
    page.locator('[data-excel-search]').fill('')
    page.screenshot(path=str(images/'excel.png'),full_page=True,style='#toast{visibility:hidden}')

    nav('reports')
    with page.expect_download() as pending:
        page.get_by_role('button',name='Download XLSX').click()
    download=pending.value
    download.save_as(str(artifacts/'export.xlsx'))
    assert (artifacts/'export.xlsx').read_bytes()[:2]==b'PK'
    csv=page.evaluate("async()=>{const r=await fetch('/api/export/attendance.csv');return {status:r.status,text:await r.text()}}")
    assert csv['status']==200 and 'Student name' in csv['text']

    nav('settings')
    page.locator('#workspace-settings-form [name=name]').fill('Community Learning')
    page.locator('#workspace-settings-form button').click()
    expect(page.locator('.brand strong')).to_have_text('Community Learning')
    page.locator('#theme-choice').select_option('dark')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    page.locator('#theme-choice').select_option('light')
    nav('overview')
    page.set_viewport_size({'width':390,'height':844})
    expect(page.locator('.mobile-menu')).to_be_visible()
    page.locator('.mobile-menu').click()
    expect(page.locator('.sidebar')).to_be_visible()
    page.locator('.sidebar [data-view="settings"]').first.click()
    expect(page.locator('#content h1')).to_have_text('Profile & settings')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile page overflows horizontally'
    page.screenshot(path=str(images/'mobile.png'),full_page=True,style='#toast{visibility:hidden}')
    assert not errors,errors
    browser.close()
    print('PASS: setup, login, manual mapping, student/attendance XLSX import, duplicate CSV review, corrupt-file handling, history, Excel tabs/search, XLSX/CSV export, settings/theme, mobile navigation; no browser exceptions.')
