-- Where "Online booking not working? Tell us" forwards the patient so they can describe
-- what went wrong (e.g. the clinic website's contact form). Optional; when blank the
-- button falls back to the one-click SMS report with no forward.
ALTER TABLE booking_settings ADD COLUMN IF NOT EXISTS contact_page_url TEXT;
