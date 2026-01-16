# Patient Intake Form Workflow

This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



This application allows physicians to send intake forms to patients. Patients complete the form, and physicians receive a summary link to copy information into their EMR system.

## Key Features

- ✅ **No Database Storage** - Patient data is NOT stored in any database
- ✅ **Temporary In-Memory Storage** - Data is only stored in server memory temporarily
- ✅ **Auto-Expiry** - Sessions expire after 24 hours
- ✅ **One-Time View** - Data is displayed once for physician review
- ✅ **HIPAA-Compliant** - No persistent storage, data is ephemeral

## Workflow

### Option 1: Physician Generates Link (Recommended)

1. **Physician generates link**
   - Go to `/physician/generate-link`
   - Enter physician email (optional, for tracking)
   - Click "Generate Link"
   - Copy and send the link to the patient

2. **Patient receives link**
   - Patient clicks the link
   - Patient enters their name and email
   - Patient completes the intake form

3. **Patient completes form**
   - Patient answers questions during the conversational interview
   - System generates a summary
   - Patient receives a shareable link

4. **Patient shares link with physician**
   - Patient copies the shareable link
   - Patient sends link to physician (email, text, etc.)

5. **Physician views summary**
   - Physician clicks the link
   - Views complete patient summary
   - Copies information into their EMR system
   - Data expires after 24 hours

### Option 2: Direct Patient Access

1. **Patient accesses form directly**
   - Patient goes to the main page
   - Enters name and email
   - Completes the intake form

2. **Patient receives shareable link**
   - After completion, patient gets a shareable link
   - Patient sends link to their physician

3. **Physician views summary**
   - Physician accesses via the link
   - Views and copies information

## Pages

### Patient Pages

- **`/`** - Main patient intake form
  - Patient enters name, email, and medical information
  - Conversational interview with AI
  - Receives shareable link upon completion

### Physician Pages

- **`/physician/generate-link`** - Generate patient intake link
  - Physician can generate a link to send to patients
  - Optional: Include physician email for tracking

- **`/physician/view?code=xxx`** - View patient summary
  - Access patient's completed intake summary
  - View all patient information and history
  - Copy information to EMR system

## Data Storage

### What is Stored

- **Temporary in-memory storage only**
- Data stored in server memory (Map data structure)
- Expires after 24 hours
- Cleared on server restart

### What is NOT Stored

- ❌ No database
- ❌ No file system storage
- ❌ No persistent storage of any kind
- ❌ No patient records

### Data Lifecycle

1. Patient completes form → Data stored in memory
2. Physician views summary → Data marked as viewed
3. After 24 hours → Data automatically deleted
4. Server restart → All data cleared

## API Endpoints

### `POST /api/sessions`
Create a new patient session when form is completed.

**Request:**
```json
{
  "patientName": "John Doe",
  "patientEmail": "john@example.com",
  "chiefComplaint": "3 days of sore throat",
  "patientProfile": { ... },
  "history": { ... },
  "physicianEmail": "optional@example.com"
}
```

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "viewUrl": "http://localhost:3000/physician/view?code=abc123xyz"
}
```

### `GET /api/sessions?code=xxx`
Get a patient session by code (for physician to view).

**Response:**
```json
{
  "sessionCode": "abc123xyz",
  "patientEmail": "john@example.com",
  "patientName": "John Doe",
  "chiefComplaint": "...",
  "patientProfile": { ... },
  "history": { ... },
  "completedAt": "2025-11-30T10:00:00Z",
  "viewedByPhysician": false
}
```

### `DELETE /api/sessions?code=xxx`
Delete a session (optional, after physician has copied data).

## Environment Variables

No special environment variables required for the session system. The application uses:

- `NEXT_PUBLIC_APP_URL` (optional) - Base URL for generating links
  - Defaults to `http://localhost:3000` in development

## Security Considerations

1. **Session Codes** - Randomly generated, not easily guessable
2. **No Authentication Required** - Patients don't need to login (as requested)
3. **Temporary Storage** - Data automatically expires
4. **No Cross-Patient Access** - Each session is isolated by unique code

## HIPAA Compliance

### Compliant Aspects

- ✅ No persistent storage of PHI
- ✅ Data automatically expires
- ✅ One-time access via secure link
- ✅ No database means no data breach risk from storage

### Considerations

- ⚠️ **In-Memory Storage** - Data is in server RAM (cleared on restart)
- ⚠️ **Link Security** - Anyone with the link can access the data
- ⚠️ **No Audit Trail** - No persistent logging of who accessed what
- ⚠️ **Server Restart** - All data is lost on server restart

### Recommendations

- Use HTTPS in production
- Consider adding link expiration notifications
- Implement rate limiting on session creation
- Add optional authentication for physicians

## Testing

1. **Test Patient Flow:**
   - Go to `/`
   - Enter patient information
   - Complete the interview
   - Copy the shareable link

2. **Test Physician View:**
   - Use the shareable link from patient
   - Go to `/physician/view?code=xxx`
   - Verify all information is displayed correctly

3. **Test Link Generation:**
   - Go to `/physician/generate-link`
   - Generate a link
   - Test that the link works

## Future Enhancements

- [ ] Email notifications to physician when patient completes form
- [ ] Optional patient authentication (Google OAuth)
- [ ] Link expiration notifications
- [ ] Rate limiting on session creation
- [ ] Optional database storage with patient consent



























