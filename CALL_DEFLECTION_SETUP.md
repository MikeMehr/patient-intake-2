# Call Deflection — Text Callers the Booking Link

## What this does

When a patient phones the clinic, Twilio answers, texts them the online booking
link, says "stay on the line to speak with us", and then rings the clinic phone
as normal. Callers who would rather self-serve hang up and book online; everyone
else waits and is connected. Nobody is dropped.

Implemented in `src/app/api/voice/incoming/route.ts` and `sendBookingLinkSMS()`
in `src/lib/sms.ts`.

## The call path

```
Patient dials 604-880-7919
        ↓  (carrier forwards)
Twilio +1778xxxxxxx
        ↓  POST /api/voice/incoming   → texts booking link
        ↓  <Dial>
CLINIC_FORWARD_TO_NUMBER  (the cell that answers today)
        ↓  no answer
The cell's own voicemail — unchanged
```

Because Twilio dials the cell rather than the cell forwarding into Twilio, the
existing voicemail keeps working and no recordings are stored by this app.

> **Loop hazard.** Do **not** set the cell's own call-forwarding to point back at
> the Twilio number. Twilio dials the cell, so if the cell forwards unanswered
> calls back to Twilio, the call bounces between them and the caller is re-texted
> each hop. Forward the *published office line* into Twilio, never the cell.

## Setup

### 1. Azure app settings (`healt-assist-ai-prod`)

| Setting | Value | Notes |
| --- | --- | --- |
| `CALL_DEFLECT_CLINIC_SLUG` | the MyMD org slug | Same slug as `/booking/<slug>`. Find it in `/org` → Booking Settings. |
| `CLINIC_FORWARD_TO_NUMBER` | the cell that answers today | Where Twilio connects the caller. Omit and callers hear a polite hangup instead. |
| `TWILIO_WEBHOOK_BASE_URL` | `https://mymd.health-assist.org` | Optional. Only needed if signature validation fails because Azure rewrites the host. |

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` and
`NEXT_PUBLIC_APP_URL` are already set in prod.

The feature stays inert until `CALL_DEFLECT_CLINIC_SLUG` is set, so deploying the
code changes nothing on its own.

### 2. Twilio Console

On the `+1778…` number → **Voice & Fax** → *A call comes in*:

- Webhook: `https://mymd.health-assist.org/api/voice/incoming`
- Method: **HTTP POST**

### 3. Carrier — forward the office line

Point **604-880-7919** at the Twilio number instead of the cell. This is the only
step outside our control; how you do it depends on who serves the office line.

Do this step **last**, after testing (below).

### 4. A2P 10DLC registration

Canadian long codes need A2P registration in the Twilio Console for reliable
delivery. Unregistered traffic gets filtered by carriers. Do this before relying
on it.

## Testing before you touch the office line

The webhook is live as soon as steps 1–2 are done, and the Twilio number still
receives calls directly. So:

1. Call the **+1778 Twilio number** from a mobile.
2. You should hear the greeting, get the booking text, and be connected to the cell.
3. Only once that works, do step 3 and forward the office line.

To roll back at any point, remove the carrier forwarding — the office line goes
straight back to the cell.

## Behaviour worth knowing

- **Repeat callers** are texted at most once every 6 hours (`voice-deflect:<number>`
  bucket, via `consumeDbRateLimit`). Ringing back doesn't re-text.
- **Landline callers** get no text (the SMS just fails) but are still connected.
- **Blocked caller ID** — no text, still connected.
- **Every failure path connects the call.** A dead database, a failed SMS, or a
  bad clinic slug all fall through to `<Dial>`. The call is never dropped to save
  a text.
- **`HIPAA_MODE=true` disables this**, along with all other SMS. Prod is currently
  `false`. The message itself carries no PHI — clinic name, booking link, opt-out.
- **Opt-out**: the message includes "Reply STOP to opt out"; Twilio honours STOP
  automatically. Under CASL, someone phoning the clinic is an inquiry, which
  carries implied consent for a reply.

## Security

`/api/voice/incoming` is public (Twilio must reach it) and is authenticated by
the `X-Twilio-Signature` header, verified against `TWILIO_AUTH_TOKEN`. Without
that check anyone could POST to it and make the clinic send SMS at your cost.
Requests failing validation get a 403 and send nothing.
