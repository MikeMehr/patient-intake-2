"""Restore the missing HTML for eForm fid=16, "CT/XR/US/Echo Req - VCH".

The form was uploaded 2026-06-17 and has been broken ever since: `eform.form_html` is
NULL, so there is nothing to render, and it has never been used once (0 rows in
eform_data). It was not data loss - the upload misfiled itself.

The cause is visible in the row: `file_name` is `CT/XR/US/EchoReq-VCH.html`. The slashes
in the form name were taken as a path, so the upload wrote the HTML into the eForm
*images* directory under its basename and left form_html NULL:

    /var/lib/OscarDocument/oscar/eform/images/EchoReq-VCH.html   18926 bytes, tomcat:tomcat

That file is a complete eForm - <html> to </html>, one <form name="FormName" id="FormName">,
title "VCH - Medical Imaging Requisition", standard oscarDB autofill tags, and it
references ${oscar_image_path}vch-medical_imaging_requisition.png, which is present in the
same directory. So the fix is to put it where it should have gone.

This script:
  1. reads the file as BYTES (it is CRLF; text mode would silently rewrite the endings)
  2. loads it into eform.form_html via HEX/UNHEX and verifies the blob round-trips
  3. corrects file_name to the basename, so the slashes cannot misfile it again

It does NOT touch form_name: the slashes there are the root cause, but the name is what
the doctor sees in the eForm list and renaming it is their call, not this script's.

Run ON the OSCAR box:  sudo python3 restore_eform16_html.py
Idempotent - refuses to overwrite a form_html that is already populated.
"""

import os
import subprocess
import time

FID = 16
SRC = '/var/lib/OscarDocument/oscar/eform/images/EchoReq-VCH.html'
NEW_FILE_NAME = 'EchoReq-VCH.html'
BACKUP_DIR = '/var/lib/OscarDocument/oscar/mymd_eform_backups'
STAMP = time.strftime('%Y%m%d%H%M%S')


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


def main():
    current = mysql_scalar('SELECT IFNULL(LENGTH(form_html), -1) FROM eform WHERE fid=%d' % FID)
    if current == '':
        raise SystemExit('no eform row with fid=%d' % FID)
    if int(current) > 0:
        print('fid=%d already has %s bytes of form_html - refusing to overwrite' % (FID, current))
        return

    if not os.path.isfile(SRC):
        raise SystemExit('source HTML not found: %s' % SRC)

    # Binary, not text: the file is CRLF and Python's text mode would normalise it,
    # which is exactly the kind of silent rewrite the HEX/UNHEX dance exists to avoid.
    with open(SRC, 'rb') as fh:
        blob = fh.read()

    assert blob.lstrip()[:5].lower() == b'<html', 'source does not start with <html'
    assert b'</html>' in blob[-200:].lower(), 'source does not end with </html>'
    assert b'name="FormName"' in blob, 'source has no FormName form'

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'eform_fid%d_restore_%s.html' % (FID, STAMP))
    with open(backup, 'wb') as fh:
        fh.write(blob)

    sqlfile = '/tmp/restore_fid%d.sql' % FID
    with open(sqlfile, 'w') as fh:
        fh.write("UPDATE eform SET form_html=UNHEX('%s'), file_name='%s' WHERE fid=%d;\n"
                 % (blob.hex(), NEW_FILE_NAME, FID))
    subprocess.check_call('mysql oscar_db < %s' % sqlfile, shell=True)

    after = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % FID)
    assert after.lower() == blob.hex().lower(), 'written blob does not match - CHECK THE FORM'
    print('fid=%d restored: %d bytes, file_name -> %s (copy kept at %s)'
          % (FID, len(blob), NEW_FILE_NAME, backup))


if __name__ == '__main__':
    main()
