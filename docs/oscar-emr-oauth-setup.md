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
