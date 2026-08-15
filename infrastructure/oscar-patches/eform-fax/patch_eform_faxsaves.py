"""Make the eForms that fax directly also keep a copy in the patient's Documents.

fid 39 goes through eform/faxEformSend.jsp, which has a ticked-by-default "Also keep a
copy in the patient's Documents" checkbox. fids 5, 52, 62 and 74 skip that window and
call eform/faxEformReq.jsp themselves, so they need saveToChart=1 on the URL.

Nothing is duplicated by doing this: faxEformReq.jsp dedups against EFormDocs on fdid, so
a form that was already filed with Save to chart is not filed a second time by faxing it.

Run ON the OSCAR box:  sudo python3 patch_eform_faxsaves.py [<fid> ...]

Idempotent, asserts the anchor matches exactly once, hex backup before any change.
"""

import os
import subprocess
import sys
import time

BACKUP_DIR = '/var/lib/OscarDocument/oscar/mymd_eform_backups'
STAMP = time.strftime('%Y%m%d%H%M%S')

# All four build the URL identically - they were written from the same template.
ANCHOR = '+ "&faxNumber=" + encodeURIComponent(dest), { credentials: "same-origin" })'
REPLACEMENT = ('+ "&faxNumber=" + encodeURIComponent(dest) + "&saveToChart=1"'
               ', { credentials: "same-origin" })')

FIDS = [5, 52, 62, 74]


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


def patch(fid):
    hexs = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % fid)
    assert len(hexs) > 1000, 'form_html looks empty for fid %d' % fid
    s = bytes.fromhex(hexs).decode('latin-1')

    if 'saveToChart' in s:
        print('fid=%d already files a copy when faxing - skipped' % fid)
        return

    n = s.count(ANCHOR)
    assert n == 1, 'fid %d: expected 1 match for the fax URL, found %d' % (fid, n)

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'eform_fid%d_faxsave_%s.hex' % (fid, STAMP))
    with open(backup, 'w') as fh:
        fh.write(hexs)

    s = s.replace(ANCHOR, REPLACEMENT)
    blob = s.encode('latin-1')
    sqlfile = '/tmp/upd_fid%d_faxsave.sql' % fid
    with open(sqlfile, 'w') as fh:
        fh.write("UPDATE eform SET form_html=UNHEX('%s') WHERE fid=%d;\n" % (blob.hex(), fid))
    subprocess.check_call('mysql oscar_db < %s' % sqlfile, shell=True)

    after = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % fid)
    assert after.lower() == blob.hex().lower(), 'fid %d: written blob does not match - CHECK THE FORM' % fid
    print('fid=%d now files a copy when faxing (hex backup %s)' % (fid, backup))


if __name__ == '__main__':
    for fid in ([int(a) for a in sys.argv[1:]] or FIDS):
        patch(fid)
