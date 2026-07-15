# Call Deflection — Text Callers the Booking Link

## What this does

MyMD's published number (604-880-7919) is a mobile. When a call goes unanswered,
the carrier forwards it to Twilio, which texts the caller their online booking
link and texts the clinic that a call was missed. Callers who'd rather self-serve
book online instead of calling back.

Implemented in `src/app/api/voice/incoming/route.ts`, with `sendBookingLinkSMS()`
and `sendMissedCallSMS()` in `src/lib/sms.ts`.

## The call path

```
Patient dials 604-880-7919
        ↓
The cell rings — answered calls are completely unaffected
        ↓  busy / no answer only
Twilio +1778xxxxxxx
        ↓  POST /api/voice/incoming
        ├── texts the caller the booking link
        ├── texts the clinic "missed call from +1604…"
        └── plays a short message, then hangs up
```

> **Why Twilio never dials back.** The published number *is* the handset. If
> Twilio dialled 604-880-7919, that call would hit the same busy/no-answer rule
> and forward straight back to Twilio — bouncing until it dropped. So in this
> configuration Twilio answers and hangs up; it never forwards onward.

> **This replaces the carrier voicemail.** Forwarded calls no longer reach it, so
> callers cannot leave a message. The missed-call text is what preserves your
> ability to ring people back. We deliberately do **not** record voicemail audio:
> patients leave health details in messages, and that would put PHI into Twilio's
> storage — a PIPA question worth avoiding.

## Setup

### 1. Azure app settings (`healt-assist-ai-prod`)

| Setting | Value | Notes |
| --- | --- | --- |
| `CALL_DEFLECT_CLINIC_SLUG` | `mymd` | Turns the feature on. Until set, the webhook does nothing. |
| `CALL_DEFLECT_NOTIFY_NUMBER` | *(optional)* | Where missed-call alerts go. Defaults to the clinic's own number on record (604-880-7919). |
| `CLINIC_FORWARD_TO_NUMBER` | **leave unset** | Setting this makes Twilio dial onward. Only correct if the published number ever stops being the handset. See below. |
| `TWILIO_WEBHOOK_BASE_URL` | *(optional)* | `https://mymd.health-assist.org`. Only needed if signature validation fails because Azure rewrites the host. |

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` and
`NEXT_PUBLIC_APP_URL` are already set in prod.

Changing app settings restarts the web app, which is a brief blip for anyone
mid-booking.

### 2. Twilio Console

On the `+1778…` number → **Voice & Fax** → *A call comes in*:

- Webhook: `https://mymd.health-assist.org/api/voice/incoming`
- Method: **HTTP POST**

### 3. Carrier — conditional forwarding on the cell

Forward **busy** and **no-answer** calls to the Twilio number. Do **not** set
unconditional forwarding — that would send every call to Twilio and the phone
would never ring.

On most Canadian carriers, dialled from the handset:

| Code | Meaning |
| --- | --- |
| `**61*+1778xxxxxxx*11*20#` | Forward after 20 seconds of no answer |
| `**67*+1778xxxxxxx#` | Forward when busy |
| `##002#` | Clear **all** forwarding — the rollback |

Confirm the codes with your carrier; they vary.

Do this step **last**, after testing.

### 4. A2P 10DLC registration

Canadian long codes need A2P registration in the Twilio Console for reliable
delivery. Unregistered traffic gets filtered by carriers. Do this before relying
on it.

## Testing before you touch the phone

After steps 1–2 the Twilio number still receives calls directly, so:

1. Call the **+1778 Twilio number** from a mobile.
2. You should hear the clinic name and the message, receive the booking text, and
   get a missed-call text on the clinic number.
3. Only once that works, set up forwarding (step 3).

Rollback at any point is `##002#` on the handset — calls go straight back to
ringing normally with carrier voicemail.

## Behaviour worth knowing

- **Answered calls are untouched.** Deflection only sees calls the cell doesn't pick up.
- **Repeat callers** are texted the link at most once every 6 hours
  (`voice-deflect:<number>` bucket, via `consumeDbRateLimit`). The missed-call
  alert to the clinic is **not** deduped — every missed call surfaces.
- **Landline callers** get no text but still trigger the missed-call alert, flagged
  so you know to ring back rather than expect them to book.
- **Blocked caller ID** — no text, and the alert reads "a withheld number".
- **Emergencies**: callers reach a recording, so it opens with "if this is a medical
  emergency, hang up and dial 911".
- **Every failure path still answers the call.** A dead database or a failed SMS
  falls through to a spoken message rather than dropping the caller.
- **`HIPAA_MODE=true` disables this**, along with all other SMS. Prod is currently
  `false`. The caller's message carries no PHI — clinic name, booking link, opt-out.
- **Opt-out**: the message includes "Reply STOP to opt out"; Twilio honours STOP
  automatically. Under CASL, phoning the clinic is an inquiry, which carries
  implied consent for a reply.

## If the published number ever moves off the handset

If MyMD later gets a separate line or a second eSIM, set
`CLINIC_FORWARD_TO_NUMBER` to the handset's *direct* number and forward the
published line unconditionally. Twilio will then text **every** caller and connect
them, rather than only catching missed calls. The code already supports this; only
the env var and the forwarding rule change.

## Security

`/api/voice/incoming` is public (Twilio must reach it) and is authenticated by
the `X-Twilio-Signature` header, verified against `TWILIO_AUTH_TOKEN`. Without
that check anyone could POST to it and make the clinic send SMS at your cost.
Requests failing validation get a 403 and send nothing.
