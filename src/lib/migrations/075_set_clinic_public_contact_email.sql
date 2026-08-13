-- The public booking form now turns away anyone whose coverage isn't MSP and tells them to email
-- the clinic instead. That message names organizations.email, which was never set for MyMD — so the
-- one instruction the patient actually needs would arrive without an address.
--
-- Backfills the clinic's own published contact address: the same one printed in their booking
-- footer and on mymdonline.ca. Fills a blank only, so whatever staff set in Admin → Organizations
-- wins on every later startup.
--
-- Side effect worth knowing: booking emails already use this address as Reply-To when its domain
-- isn't verified in Resend (see resolveSender in lib/booking-email.ts), so patient replies start
-- reaching the clinic rather than the platform sender.
UPDATE organizations
SET email = 'info@mymdonline.ca'
WHERE slug = 'mymd'
  AND COALESCE(TRIM(email), '') = '';
