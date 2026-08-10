#!/bin/bash
#
# Install the patient email inbox on the live OSCAR box.
#
# Run ON the OSCAR box, as manucher, after the source files have been copied to
# /home/manucher/ (scp them from docs/oscar/inbox/ plus the updated
# infrastructure/oscar-patches/emailPatient.jsp).
#
#   bash /home/manucher/deploy.sh          # stages 1-5: schema, poller, dry run
#   bash /home/manucher/deploy.sh --pages  # stage 7-8: the JSPs (after the dry run looks right)
#   bash /home/manucher/deploy.sh --nav    # stage 9: the nav link, last
#
# Split into three deliberately: nothing is visible to a clinician until --pages, and the nav
# link does not exist until --nav, so a half-finished install is never reachable.
#
# Full context, verification steps and rollback: docs/oscar/inbox-install.md

set -euo pipefail

SRC=/home/manucher
WEBAPP=/opt/tomcat9/webapps/oscar
WORK=/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp
STORE=/var/lib/OscarDocument/oscar/mymd_inbox

say() { printf '\n=== %s ===\n' "$1"; }

clear_jsp() {
    # The glob MUST be expanded inside sudo: /opt/tomcat9/work is tomcat-only, so a login
    # shell cannot expand it, rm gets a literal * and exits 0 having done nothing.
    sudo sh -c "rm -f $WORK/$1"
}

deploy_core() {
    say "1. Schema"
    sudo mysql oscar_db -e "source $SRC/mymd_inbox.sql"
    sudo mysql oscar_db -e "SHOW TABLES LIKE 'mymd_inbox%'"

    say "2. Poller, config and storage"
    sudo install -o root -g root -m 0755 "$SRC/mymd_mail_sync.py" /usr/local/bin/mymd_mail_sync.py
    sudo mkdir -p /etc/mymd
    sudo install -o root -g tomcat -m 0640 "$SRC/mail-sync.conf" /etc/mymd/mail-sync.conf
    sudo mkdir -p "$STORE"
    sudo chown tomcat:tomcat "$STORE"
    sudo chmod 0750 "$STORE"

    say "3. Dry run (no writes) - check the summary below before continuing"
    sudo -u tomcat /usr/bin/python3 /usr/local/bin/mymd_mail_sync.py --dry-run

    cat <<'EOF'

Dry run complete. If the counts look right:

  # backfill for real
  sudo -u tomcat /usr/bin/python3 /usr/local/bin/mymd_mail_sync.py

  # run it AGAIN immediately - counts must not move. That is the idempotence test.
  sudo -u tomcat /usr/bin/python3 /usr/local/bin/mymd_mail_sync.py

  # then enable the timer
  sudo install -m 0644 /home/manucher/mymd-mail-sync.service \
                       /home/manucher/mymd-mail-sync.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now mymd-mail-sync.timer
  systemctl list-timers mymd-mail-sync.timer

Then send a test email to info@mymdonline.ca, leave it UNREAD in Roundcube, and confirm both
that a row appears in OSCAR and that the new-mail SMS still arrives. That is the check that
the read-only IMAP guarantee holds on a genuinely unread message.

Next: bash deploy.sh --pages
EOF
}

deploy_pages() {
    say "7-8. JSPs"
    for f in inbox.jsp inboxAttachment.jsp inboxHtml.jsp emailPatient.jsp; do
        [ -f "$SRC/$f" ] || { echo "MISSING: $SRC/$f"; exit 1; }
    done

    # Back up the existing emailPatient.jsp before replacing it - it is a live, working page.
    #
    # `sudo test -f`, not `[ -f ... ]`. The webapp directory is mode 750 tomcat:tomcat, so an
    # unprivileged `[ -f ]` cannot stat anything inside it and returns FALSE - the backup then
    # gets skipped in silence while the overwrite proceeds under sudo regardless. Same family
    # of trap as the /opt/tomcat9/work glob that must be expanded inside sudo. Caught the hard
    # way on 2026-08-10, after it had already skipped one backup.
    if sudo test -f "$WEBAPP/mymd/emailPatient.jsp"; then
        BAK="$WEBAPP/mymd/emailPatient.jsp.oscarbak.$(date +%Y%m%d%H%M%S)"
        sudo cp -p "$WEBAPP/mymd/emailPatient.jsp" "$BAK"
        echo "Backed up to $BAK"
    fi

    sudo install -o tomcat -g tomcat -m 0644 \
        "$SRC/inbox.jsp" "$SRC/inboxAttachment.jsp" "$SRC/inboxHtml.jsp" \
        "$SRC/emailPatient.jsp" "$WEBAPP/mymd/"

    say "Compile check (Jasper) - requesting the URL would prove nothing, CRFilter redirects first"
    sudo sh -c "CP=\$(ls /opt/tomcat9/lib/*.jar /opt/tomcat9/bin/*.jar $WEBAPP/WEB-INF/lib/*.jar | tr '\n' ':')$WEBAPP/WEB-INF/classes; \
        java -cp \"\$CP\" org.apache.jasper.JspC -uriroot $WEBAPP -d /tmp/jspout-inbox -compile \
        mymd/inbox.jsp mymd/inboxAttachment.jsp mymd/inboxHtml.jsp mymd/emailPatient.jsp"

    say "Clearing compiled copies"
    clear_jsp "mymd/inbox_jsp.*"
    clear_jsp "mymd/inboxAttachment_jsp.*"
    clear_jsp "mymd/inboxHtml_jsp.*"
    clear_jsp "mymd/emailPatient_jsp.*"

    echo
    echo "Pages installed. Open them directly before adding the nav link:"
    echo "  https://oscar.mymdonline.ca/oscar/mymd/inbox.jsp"
    echo
    echo "Next: bash deploy.sh --nav"
}

deploy_nav() {
    say "9. Nav link"
    sudo python3 "$SRC/patch_inbox_nav.py"
    clear_jsp "provider/appointmentprovideradminday_jsp.*"
    echo
    echo "Done. Reload the day sheet; 'Patient Email' sits right of 'Bill Day'."
    echo "Note: that nav block is admin-only (_admin oscarSec)."
}

case "${1:-}" in
    --pages) deploy_pages ;;
    --nav)   deploy_nav ;;
    "")      deploy_core ;;
    *)       echo "usage: deploy.sh [--pages|--nav]"; exit 2 ;;
esac
