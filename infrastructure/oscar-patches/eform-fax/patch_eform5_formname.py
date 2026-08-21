"""Make the Brooke US eForm (fid=5) save which location was picked.

The form's location <select name="fax_location"> and its fax_override box live in the
floating "Floating Controls Box" (<div id="topbar" class="DoNotPrint">), which contains
a SECOND <form name="LazyForm">. Only <form name="FormName"> is submitted and saved, so
the chosen location was never stored anywhere: five saved fid=5 requisitions had zero
fax_location / fax_override rows in eform_values. That is why fax/faxDestSuggest.jsp
could not offer a destination for a Brooke requisition the way it does for Coastal Sleep.

The two controls cannot simply be moved inside FormName: they would then print on the
requisition (the topbar is DoNotPrint precisely so they do not) and the form's absolute
layout would shift. Instead they keep their place in the DOM and are associated with the
submitted form by the HTML5 form= attribute, which needs FormName to carry an id.

Verified with jsdom against the real form_html: before, new FormData(FormName) yielded 26
keys and no fax_location; after, 28 keys including fax_location with the chosen value,
while FormName.contains(select) stays false - i.e. nothing moved.

form_html is a CRLF blob edited via HEX/UNHEX so nothing is mangled in transit.
"""

import subprocess
import time

FID = 5
STAMP = time.strftime('%Y%m%d%H%M%S')


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


hexs = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % FID)
assert len(hexs) > 1000, 'form_html looks empty'
s = bytes.fromhex(hexs).decode('latin-1')

with open('/tmp/eform_fid%d_%s.hex' % (FID, STAMP), 'w') as fh:
    fh.write(hexs)

if 'name="FormName" id="FormName"' in s:
    raise SystemExit('fid=%d already patched - nothing to do' % FID)


def crlf(t):
    return t.replace('\r\n', '\n').replace('\n', '\r\n')


WHY = crlf('''<!-- MyMD Aug2026: form="FormName" associates these two controls with the submitted form, so
     the chosen location is saved with the requisition and the New Fax page can read it back.
     They must STAY in this DoNotPrint box - moving them inside the form would print them on
     the requisition and break the absolute layout. -->
''')

SELECT_OLD = '<select name="fax_location" id="fax_location" style="width:225px;">'
OVERRIDE_OLD = ('<input name="fax_override" id="fax_override" size="11" type="text"'
                ' placeholder="10-digit">')

edits = [
    # 1. form= can only point at an id, and FormName had none
    ('<form method="post" action="" name="FormName">',
     '<form method="post" action="" name="FormName" id="FormName">'),
    # 2. the location picker, left exactly where it is
    (SELECT_OLD, WHY + SELECT_OLD[:-1] + ' form="FormName">'),
    # 3. the manual override box beside it
    (OVERRIDE_OLD, OVERRIDE_OLD[:-1] + ' form="FormName">'),
]

for old, new in edits:
    n = s.count(old)
    assert n == 1, 'expected 1 match, found %d for %r' % (n, old[:60])
    s = s.replace(old, new)

blob = s.encode('latin-1')
with open('/tmp/upd_fid%d.sql' % FID, 'w') as fh:
    fh.write("UPDATE eform SET form_html=UNHEX('%s') WHERE fid=%d;\n" % (blob.hex(), FID))

subprocess.check_call('mysql oscar_db < /tmp/upd_fid%d.sql' % FID, shell=True)

after = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % FID)
assert after.lower() == blob.hex().lower(), 'written blob does not match - CHECK THE FORM'
print('fid=%d updated, %d -> %d bytes, hex backup /tmp/eform_fid%d_%s.hex'
      % (FID, len(hexs) // 2, len(blob), FID, STAMP))
