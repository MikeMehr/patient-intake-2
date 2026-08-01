# OSCAR EMR OAuth 1.0a Integration Setup

Health Assist AI uses OAuth 1.0a to call OSCAR EMR 19's REST API (e.g. `demographics/quickSearch`). This document records the full server-side setup required on a fresh OSCAR install, plus the specific fixes discovered while connecting to `oscar.mymdonline.ca`.

## Health Assist side

Tokens are stored per-organization in the `emr_connections` table. Admin connects via the "OSCAR" section in the org page, which runs the standard 3-leg OAuth 1.0a handshake against `/oscar/ws/oauth/initiate`, `/authorize`, `/token`.

All signed REST requests go to `${base_url}/ws/services/...`. See `src/lib/oscar/client.ts`.

## OSCAR server side

### 1. `spring_ws.xml` — OAuth beans and `/oauth` + `/services` endpoints

The OAuth 1.0a JAX-RS servers must be defined in `/opt/tomcat9/webapps/oscar/WEB-INF/classes/spring_ws.xml`. OSCAR ships these in `applicationContextREST.xml`, but in some deployments those beans silently fail to register with the CXF bus — putting them in `spring_ws.xml` is reliable.

```xml
<bean id="oauthProvider" class="oscar.login.OscarOAuthDataProvider" autowire="byName"/>
<bean id="requestTokenService" class="oscar.login.OscarRequestTokenService">
    <property name="dataProvider" ref="oauthProvider"/>
</bean>
<bean id="authorizationService" class="org.apache.cxf.rs.security.oauth.services.AuthorizationRequestService">
    <property name="dataProvider" ref="oauthProvider"/>
</bean>
<bean id="accessTokenService" class="org.apache.cxf.rs.security.oauth.services.AccessTokenService">
    <property name="dataProvider" ref="oauthProvider"/>
</bean>
<bean id="dispatchProvider" class="org.apache.cxf.jaxrs.provider.RequestDispatcherProvider">
    <property name="resourcePath" value="/login/3rdpartyLogin.jsp"/>
</bean>

<jaxrs:server id="oauthService" address="/oauth">
    <jaxrs:serviceBeans>
        <ref bean="requestTokenService"/>
        <ref bean="accessTokenService"/>
        <ref bean="authorizationService"/>
    </jaxrs:serviceBeans>
    <jaxrs:providers>
        <ref bean="dispatchProvider"/>
    </jaxrs:providers>
</jaxrs:server>

<bean id="oAuthFilter" class="org.apache.cxf.rs.security.oauth.filters.OAuthRequestFilter">
    <property name="dataProvider" ref="oauthProvider"/>
    <property name="useUserSubject" value="true"/>
    <property name="supportUnknownParameters" value="true"/>
</bean>

<jaxrs:server id="restServices" address="/services">
    <jaxrs:inInterceptors>
        <bean class="org.oscarehr.ws.oauth.util.OAuthInterceptor"/>
    </jaxrs:inInterceptors>
    <jaxrs:serviceBeans>
        <bean class="org.oscarehr.ws.oauth.OAuthStatusService" autowire="byName"/>
        <bean class="org.oscarehr.ws.rest.DemographicService" autowire="byName"/>
        <bean class="org.oscarehr.ws.rest.ScheduleService" autowire="byName"/>
        <bean class="org.oscarehr.ws.rest.ProviderService" autowire="byName"/>
        <bean class="org.oscarehr.ws.rest.StatusService" autowire="byName"/>
    </jaxrs:serviceBeans>
    <jaxrs:providers>
        <ref bean="oAuthFilter"/>
        <ref bean="jaxb"/>
        <ref bean="jsonProvider"/>
        <!-- REQUIRED: CXF's jsonProvider (JAXB-based) can't serialize POJOs like
             AbstractSearchResponse — Jackson handles them. Without this line you
             get HTTP 500: "No message body writer has been found for response
             class AbstractSearchResponse." -->
        <bean class="org.codehaus.jackson.jaxrs.JacksonJsonProvider"/>
    </jaxrs:providers>
</jaxrs:server>
```

### 2. `server.xml` — proxy attributes on the HTTPS connector

OAuth 1.0a signs the request URL (scheme + host + port + path). If Tomcat's connector reports its own port (e.g. 8443) instead of the public one (443), the signature the client computed against `https://oscar.example.com/...` will never match what CXF reconstructs at `https://oscar.example.com:8443/...` — resulting in HTTP 500 "Access Denied" from `OAuthRequestFilter`.

On `oscar.mymdonline.ca` iptables forwards 443 → 8443. The 8443 `<Connector>` in `/opt/tomcat9/conf/server.xml` must declare the public scheme/host/port:

```xml
<Connector port="8443"
           protocol="org.apache.coyote.http11.Http11NioProtocol"
           maxThreads="150"
           SSLEnabled="true"
           scheme="https"
           proxyName="oscar.mymdonline.ca"
           proxyPort="443"
           secure="true">
    ...
</Connector>
```

### 3. `ServiceClient` — extend token lifetime

OSCAR's default access-token lifetime is 3600 seconds (1 hour). For a long-running integration, extend it:

```sql
UPDATE ServiceClient SET lifetime = 2592000 WHERE name = 'Health Assist';  -- 30 days
```

Existing tokens can be extended in the same session:

```sql
UPDATE ServiceAccessToken SET lifetime = 2592000 WHERE clientId = <id>;
```

### 4. `ServiceAccessToken.providerNo` — link tokens to an OSCAR user

`OscarOAuthDataProvider.getAccessToken()` reads `ServiceAccessToken.providerNo` and uses it as the `UserSubject.login` on the OAuth context. `OAuthInterceptor.handleMessage()` then looks that provider up via `ProviderDao` and builds the `LoggedInInfo` that `DemographicService` (etc.) need.

If you see HTTP 401 "Not authorized" even with a valid signature, the `providerNo` column is probably NULL. The standard CXF `AuthorizationRequestService` used in step 1 does not populate it automatically when the user authorizes via the JSP form — set it manually per token to the provider number that should own the integration:

```sql
UPDATE ServiceAccessToken SET providerNo = '100' WHERE clientId = <id>;
```

(Replace `100` with the appropriate `provider.provider_no`.)

## Health Assist middleware

- `src/middleware.test.ts` / `src/proxy.ts` — the callback route `/api/admin/emr/oscar/callback` is in `PUBLIC_EXCEPTIONS` so it doesn't require the physician-session cookie (OSCAR bounces the user back via a cross-site redirect that can't carry it).
- `src/app/api/admin/emr/oscar/callback/route.ts` — uses `x-forwarded-host` / `x-forwarded-proto` / `NEXT_PUBLIC_SITE_URL` to build the post-callback redirect. Behind Azure App Service, `request.url` contains the internal container hostname and would otherwise produce a broken redirect.

## Error → cause quick reference

| HTTP response | Likely cause |
|---|---|
| 404 on `/oscar/ws/oauth/initiate` | `spring_ws.xml` OAuth beans missing (step 1). |
| 500 "Access Denied" from `OAuthRequestFilter` | Signature URL mismatch. Check `proxyName` / `proxyPort` on the HTTPS connector (step 2). |
| 401 "Not authorized" after successful handshake | `ServiceAccessToken.providerNo` is NULL (step 4). |
| 500 "No message body writer has been found for response class ..." | `JacksonJsonProvider` missing from `/services` providers (step 1, last bean). |
| 401 on `/oscar/ws/rs/...` | That endpoint uses OSCAR session auth, not OAuth. Call `/ws/services/` instead. |

## Pharmacy bridge

Lets a patient pick their preferred pharmacy during online booking and have it set on their OSCAR
chart, so it shows up in the Rx module instead of being re-asked at the visit.

### Why this doesn't use OAuth REST

OSCAR publishes no pharmacy endpoint. `PharmacyService` and `RxWebService` are both listed in
`WEB-INF/classes/applicationContextREST.xml`, but neither appears in the live WADL:

```bash
curl -s 'http://127.0.0.1:8080/oscar/ws/services?_wadl' | grep -o 'resource path="[^"]*"' | sort -u
```

Only `demographics`, `schedule`, `provider` and `status` are actually published, and even if
`RxWebService` were reachable it exposes a *read* (`/rx/pharmacy/{demographicNo}`) and no write. The
only writer of the patient↔pharmacy link is the Struts action `RxManagePharmacyAction.setPreferred`,
which requires a logged-in OSCAR session.

A JSP wasn't viable either: every webapp path is gated by `CRFilter` (`cr.filter.ignore` in
`WEB-INF/web.xml`), which redirects a session-less request to `logout.jsp` before the JSP runs.
Opening a hole there means editing OSCAR's own auth config, restarting Tomcat, and redoing both
after every WAR redeploy.

So the clinic runs a small standalone service beside OSCAR. Full server-side install notes,
including the nginx `location =` exemption and its rollback, are in
`infrastructure/oscar-patches/README.md`.

### App-side environment

| Variable | Required | Purpose |
|---|---|---|
| `OSCAR_PHARMACY_BRIDGE_SECRET` | yes | Shared secret sent as `X-MyMD-Pharmacy-Secret`. Must equal `bridge.secret` in `/var/lib/OscarDocument/oscar/mymd_pharmacy_bridge.properties` on the OSCAR box. Never `NEXT_PUBLIC_`-prefixed; it is in `check-env-no-secrets.js`'s forbidden list. |
| `OSCAR_PHARMACY_BRIDGE_URL` | no | Full URL override. Default is the origin of `emr_connections.base_url` + `/mymd/pharmacy-bridge`. |
| `PHARMACY_DIRECTORY_MAX_AGE_DAYS` | no | How stale the local directory mirror may get before a lazy refresh, default 30. |
| `PHARMACY_BRIDGE_ALLOW_UPSERT` | no | Default off. See below. |
| `CRON_SECRET` | existing | Reused by `POST /api/cron/pharmacy-directory-sync` (weekly). |

Without `OSCAR_PHARMACY_BRIDGE_SECRET` the feature degrades quietly: the picker offers free-text
entry, bookings record the pharmacy locally, and the link is marked `SKIPPED`. Nothing errors.

### How it hangs together

1. **Mirror.** `POST /api/org/pharmacy-directory/sync` (org admin, also on the Booking Settings page)
   pulls `op=list` and mirrors ~1516 pharmacies into `pharmacy_directory`, org-scoped. Refreshed
   weekly by cron and lazily by the search route when the mirror is missing or stale.
2. **Pick.** `PharmacyPicker` searches the mirror through
   `GET /api/booking/[clinicSlug]/pharmacy-search` (gated by the booking hold cookie). Anything not
   in the list falls back to free text.
3. **Store.** The choice goes to `POST .../confirm`, which re-reads a directory pick from
   `pharmacy_directory` **by id** and discards the client's name/address/fax — that fax is where
   prescriptions get sent. It is persisted in the same CTE that creates the booking.
4. **Link.** After the booking is committed, `linkPharmacyToOscar` calls `op=link` and records
   `pharmacy_link_status` on the appointment. It can never throw, so a bridge outage costs at most
   the 8 s call timeout and the patient still gets a normal confirmation.

### Free text is not written back to OSCAR

`op=upsert` exists but the app leaves it off. Creating rows in OSCAR's shared `pharmacyInfo` table
from anonymous public booking input would let a stranger add a pharmacy — including the fax number
prescriptions are sent to — that OSCAR then offers to every clinician. A free-text pharmacy is stored
on the booking, marked `SKIPPED`, and surfaced on the Appointments page as "Add manually". Set
`PHARMACY_BRIDGE_ALLOW_UPSERT=true` only after reviewing how much free text actually arrives.

### Error → cause quick reference

| Symptom | Likely cause |
|---|---|
| `Pharmacy bridge is not configured for this clinic` | `OSCAR_PHARMACY_BRIDGE_SECRET` unset, or the org has no `emr_connections` row. |
| Sync returns 401 | Secret mismatch between the app and `mymd_pharmacy_bridge.properties`. |
| Sync returns 503 | `pharmacy-bridge.service` down, or the nginx `location =` exemption missing. |
| "Refusing to deactivate" in the logs | The bridge answered 200 with an empty list. Deliberate guard — one bad response must not empty the picker. |
| Every booking shows "Add manually" | The directory has never synced. Run it from Booking Settings. |
