# SMS Emergency Alerts Setup Guide

## Overview

This document describes how to set up SMS emergency alerts for your Health Assist AI platform. When the AI detects a critical/emergency case during the guided interview, it will automatically send an SMS notification to the assigned physician.

## What Was Implemented

### Files Created

1. **`/src/lib/sms.ts`** - Twilio SMS service layer
   - Initializes Twilio client with credentials
   - Exports `sendEmergencyAlertSMS()` function
   - Respects HIPAA_MODE environment variable (disables SMS when enabled)
   - Implements fire-and-forget pattern (doesn't block interview response)

2. **`/src/lib/physician-lookup.ts`** - Physician contact information lookup
   - Exports `getPhysicianPhone()` to fetch physician's phone number from database
   - Exports `getPhysicianContact()` for retrieving full contact info
   - Gracefully handles missing phone numbers

### Files Modified

1. **`/src/app/api/interview/route.ts`** - Interview API handler
   - Added imports for SMS and physician lookup functions
   - Added emergency SMS trigger logic after summary validation
   - Sends SMS when:
     - Interview response is a summary (interview complete)
     - Red flags are detected (`interviewState.escalation.hasRedFlagSignal === true`)
     - Physician has a valid phone number in the database
   - Uses fire-and-forget pattern: SMS sent asynchronously, doesn't block response
   - SMS errors are logged but don't interrupt the interview

2. **`/package.json`** - Added Twilio dependency
   - `"twilio": "^4.23.0"`

3. **`/.env.local`** - Added Twilio configuration variables
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`

## How It Works

### Emergency Detection

The system uses the existing red flag detection logic in `/src/app/api/interview/state-builder.ts` to identify emergencies. Red flags include:

- **Cardiac**: exertional chest pain, radiation to arm/jaw/back, dyspnea, diaphoresis, syncope
- **Trauma**: loss of consciousness, major mechanism, neurologic deficits, chest/abdominal injury
- **Neurologic**: focal weakness, acute vision loss, thunderclap headache, confusion
- **Respiratory**: stridor, severe dyspnea, hemoptysis
- **GI**: hematemesis, melena, persistent vomiting, jaundice
- **Musculoskeletal**: inability to weight bear, gross deformity, neurovascular compromise
- **Multi-system symptoms**: multiple concurrent complaints
- **Chronic complexity**: diabetes, COPD, CHF, CKD, cancer with acute changes

### Alert Flow

```
1. Patient completes guided interview
2. AI generates interview summary
3. Interview route checks if summary contains red flags
4. If red flags detected:
   a. Fetch physician's phone number from database
   b. If phone number exists:
      - Create alert message: "ALERT: Emergency case detected for [Patient Name]. Review at [URL]"
      - Send SMS via Twilio asynchronously
      - Log SMS success/failure
   c. Return interview summary to patient (SMS sent in background)
5. Physician receives SMS alert on their phone
6. Physician can click URL to access patient's full record in dashboard
```

## Setup Instructions

### Step 1: Get Twilio Credentials

1. **Sign up for Twilio** (if not already done)
   - Visit https://www.twilio.com/
   - Create an account and verify your phone number

2. **Get Your Credentials**
   - Login to Twilio Console: https://console.twilio.com/
   - In the "Account" section, find:
     - **Account SID**: Your account identifier
     - **Auth Token**: Your authentication token
     - Keep these secret and secure!

3. **Get a Twilio Phone Number**
   - In Twilio Console, go to "Develop" → "Phone Numbers" → "Manage Numbers"
   - Purchase a phone number (or use your trial number)
   - This is the number SMS will come FROM

### Step 2: Configure Environment Variables

#### For Development (Local Testing)

Edit `.env.local` and add your Twilio credentials:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+12125551234
```

**Note**: Phone number should be in E.164 format (e.g., +1-555-123-4567)

#### For Production (Azure)

Add the same environment variables to Azure App Service:

1. Open Azure Portal → App Service → "Configuration"
2. Click "+ New application setting" for each:
   - Name: `TWILIO_ACCOUNT_SID`, Value: your SID
   - Name: `TWILIO_AUTH_TOKEN`, Value: your auth token
   - Name: `TWILIO_PHONE_NUMBER`, Value: your Twilio number
3. Click "Save" at the top
4. Azure will automatically restart the app

### Step 3: Update Physician Phone Numbers

Ensure physicians have phone numbers in their database profiles:

1. Visit the physician management page
2. Edit each physician's profile
3. Add their cell phone number (in E.164 format recommended: +1-555-123-4567)
4. Save

**Important**: Without a phone number, no SMS will be sent (system logs this and continues gracefully).

### Step 4: Test the Implementation

#### Test Case: Emergency Detection

1. Start an intake interview
2. Answer questions indicating an emergency symptom:
   - "I have severe chest pain radiating to my left arm"
   - Or "I lost consciousness for a few seconds"
   - Or "I'm experiencing sudden vision loss"
3. Continue through the interview
4. When the summary is generated, the system detects red flags
5. Check the physician's phone for an SMS alert

**Expected SMS**:
```
ALERT: Emergency case detected for John Doe. Review at http://localhost:3000/org/dashboard?invitation=invitation-id
```

#### Test Case: Non-Emergency

1. Start an intake interview
2. Answer questions about a routine concern (headache, minor knee pain, etc.)
3. Complete the interview
4. No SMS should be sent
5. Check server logs: `[interview-route] Sending emergency SMS to physician` should NOT appear

### Step 5: Monitor SMS Delivery

#### View Logs

1. **Development**: Check console output for logs starting with `[sms]` or `[interview-route]`
2. **Production**: Check Azure Application Insights for logs

#### Twilio Dashboard

1. Login to Twilio Console: https://console.twilio.com/
2. Go to "Messaging" → "Logs"
3. View sent SMS messages, delivery status, and any errors

#### Test Logs Pattern

```
[sms] Sending emergency alert SMS
[sms] SMS sent successfully
[interview-route] Sending emergency SMS to physician
```

## Troubleshooting

### "SMS disabled in HIPAA mode"

**Cause**: `HIPAA_MODE=true` in environment variables

**Solution**: Set `HIPAA_MODE=false` if you want SMS notifications enabled. SMS is disabled by design when HIPAA mode is active to prevent external API calls.

### "Physician has no phone number for SMS alert"

**Cause**: The assigned physician doesn't have a phone number in their profile

**Solution**:
1. Go to physician management
2. Edit the physician's profile
3. Add their cell phone number
4. Re-run the interview test

### "Failed to send SMS" in logs

**Cause**: Twilio API error (invalid credentials, rate limiting, account balance, etc.)

**Solutions**:
- Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
- Check Twilio account has enough credits
- Verify phone numbers are in valid format: `+1-555-123-4567`
- Check Twilio dashboard for API errors and status

### SMS not received

**Cause**: Multiple possible issues

**Steps to debug**:
1. Check server logs for `[sms] SMS sent successfully` with message SID
2. Go to Twilio Console → Messaging → Logs
3. Find the message SID from logs
4. Check delivery status in Twilio dashboard
5. Verify recipient phone number is correct and registered in database
6. Check that phone number is in correct format: `+1-555-123-4567`

## HIPAA Compliance

### Important Security Considerations

1. **Patient Privacy**: SMS may contain patient names which is PHI
   - SMS alerts are brief and only include patient name (not medical details)
   - Ensure physician's phone number is properly secured
   - Twilio complies with HIPAA (BAA available from Twilio)

2. **HIPAA Mode**: When `HIPAA_MODE=true`
   - External SMS is disabled entirely
   - Set this to `true` in strict HIPAA environments where external API calls are prohibited
   - Emergency alerts will be logged locally instead of sent via SMS

3. **Audit Trail**: All SMS attempts are logged
   - Logs include physician ID, patient name, and red flag reasons
   - Useful for compliance audits and troubleshooting

4. **Recommended Actions**:
   - Request Twilio BAA (Business Associate Agreement) from Twilio
   - Review Twilio's HIPAA compliance: https://www.twilio.com/en-us/compliance/hipaa
   - Add HIPAA compliance notes to your documentation
   - Test with test phone numbers first (not real patient data)

## Rate Limiting & Best Practices

### Current Implementation

- No rate limiting on SMS sending (future enhancement)
- Fire-and-forget pattern (SMS sent asynchronously)
- SMS errors don't interrupt the interview flow

### Future Enhancements

Consider implementing:
- Rate limiting per physician (max SMS per hour)
- SMS delivery status callbacks from Twilio
- SMS templates/variables for different alert types
- Opt-in/opt-out per physician
- SMS retry logic for failed deliveries

## Deployment Notes

### Before Going to Production

1. ✅ Test with Twilio trial account (free SMS to verified numbers)
2. ✅ Verify all physician profiles have phone numbers
3. ✅ Get Twilio BAA (Business Associate Agreement) signed
4. ✅ Conduct full emergency detection tests
5. ✅ Review HIPAA compliance with your legal team
6. ✅ Set up SMS monitoring/alerting in Azure

### Deployment Steps

1. **Update Azure Configuration**:
   ```bash
   # Set Twilio credentials in Azure App Service
   # (See Step 2 above)
   ```

2. **Deploy to Main**:
   ```bash
   git add -A
   git commit -m "feat: add SMS emergency alerts for physicians"
   git push origin main
   ```

3. **GitHub Actions automatically deploys** to Azure (see `.github/workflows/main_healt-assist-ai-prod.yml`)

4. **Monitor Deployment**:
   - Check Azure App Service deployment logs
   - Monitor Application Insights for SMS logs
   - Test with a real emergency case after deployment

## Testing Edge Cases

```typescript
// Test scenarios to verify:

1. Emergency case (should send SMS)
   - Chest pain + dyspnea = hasRedFlagSignal: true ✓

2. Non-emergency case (should NOT send SMS)
   - Minor headache = hasRedFlagSignal: false ✓

3. No physician phone number (should log, not fail)
   - Physician exists but phone = null → logs gracefully ✓

4. HIPAA mode enabled (should skip SMS)
   - HIPAA_MODE=true → returns early, no SMS ✓

5. Invalid Twilio credentials (should log error, not fail interview)
   - Invalid SID/token → SMS error logged, interview succeeds ✓

6. Multi-system symptoms (should send SMS)
   - Multiple concurrent complaints → escalation detected ✓

7. Chronic complexity with acute change (should send SMS)
   - Diabetic patient with new severe symptom → red flag ✓
```

## Support & Questions

For issues or questions:

1. **Check logs** - Most issues are logged with `[sms]` prefix
2. **Review Twilio docs** - https://www.twilio.com/docs/sms
3. **Check HIPAA guide** - See `HIPAA_COMPLIANCE.md` in repo
4. **Contact team** - Reach out to your development team

## Files for Reference

- `/src/lib/sms.ts` - SMS service implementation
- `/src/lib/physician-lookup.ts` - Physician contact lookup
- `/src/app/api/interview/route.ts` - Interview handler with SMS trigger
- `/src/app/api/interview/state-builder.ts` - Red flag detection logic
- `/src/app/api/interview/complaint-protocols.ts` - Red flag definitions
- `/.env.local` - Environment configuration
- `/package.json` - Dependencies
