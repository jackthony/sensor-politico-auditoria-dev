# Auditoría local de la dev remota

Este proyecto se ejecuta en tu Mac, pero consulta la instancia remota de Supabase indicada en `.env`. No levanta una copia local de la web.

## Estado y alcance

El repositorio es público para revisión del equipo:

https://github.com/jackthony/sensor-politico-auditoria-dev

El archivo `.env` real está excluido por `.gitignore`. El repositorio contiene solamente el arnés de auditoría, ejemplos de configuración y un simulador local.

## 1. Objetivo remoto auditado

Página revisada:

```text
https://sensor-politico.pages.dev/lima/lima/san-martin-de-porres/?tipo=district&ubigeo=150135#resultados
```

Parámetros observados:

```text
tipo=district
ubigeo=150135
```

La aplicación está servida desde Cloudflare Pages y usa Supabase como backend. La encuesta revisada es:

```text
poll_id: 3e6a63a4-3494-46e4-9b92-374df51d580e
name: Sondeo Distrital de San Martin De Porres
geo_id: 37
status: active
```

El candidato usado para verificar el flujo fue:

```text
candidate_id: 3487f0a9-c231-414e-8b11-69822b32f67a
full_name: DIEGO ARMANDO LOPEZ JARA
territory_ubigeo: 150135
display_order: 19
active_in_poll: true
```

## 2. Assets y configuración del frontend

Assets observados durante la revisión:

```text
/assets/config.js?v=45
/assets/public-v13.js?v=81
/assets/public-v77.js?v=77
```

La configuración pública contiene la URL de Supabase y una clave `sb_publishable`. Esa clave identifica al cliente público; no es una clave `service_role`.

El flujo del navegador genera o recupera `localStorage.sensor_device`, usa `crypto.randomUUID()` cuando necesita crear el valor inicial y calcula un SHA-256 a partir del dispositivo y una semilla local. El resultado se envía como `p_voter_hash`; no hay evidencia en el bundle de una identidad autenticada, un nonce server-side, una sesión obligatoria, una IP enviada desde el frontend o un CAPTCHA integrado en ese flujo.

## 3. Interfaces Supabase observadas

### Votación

```text
POST /rest/v1/rpc/submit_scope_vote_v41
```

Parámetros observados en el cliente:

```text
p_poll_id
p_candidate_id
p_voter_hash
```

El RPC devolvió `VOTE_REGISTERED` para un hash sintético de 64 caracteres durante la prueba anterior y el contador aumentó. La tabla `public.votes` no devolvió filas al rol anónimo durante la lectura; eso no permite concluir si existe o no permiso de `INSERT` directo.

### Resultados

```text
POST /rest/v1/rpc/get_poll_results
```

Devuelve resultados agregados por candidato. En la última lectura el total fue 10 y Diego tenía 3.

### Analítica

```text
POST /rest/v1/rpc/record_analytics_event_v77
POST /rest/v1/rpc/record_site_visit
```

El frontend usa `sessionStorage.sensor_analytics_session_v77` y envía hashes de visitante/sesión, página, geografía, encuesta, candidato y fuente. No se observó envío de IP en el código cliente.

### Administración

```text
/admin/
admin_traffic_dashboard_v77
admin_profiles
```

El shell administrativo es descargable sin autenticación. La comprobación de sesión/rol se ejecuta posteriormente. Una llamada al RPC administrativo sin sesión devolvió `AUTH_REQUIRED` con HTTP 400.

## 4. Inventario visible para `anon`

Conteos observados mediante REST con la clave pública:

```text
geo_units:                  100
political_organizations:     69
candidates:                1184
polls:                      133
poll_candidates:           1758
candidate_import_scopes:    100
candidate_profiles:           0
service_requests:             0
site_visits:                  0
candidate_photos:             0
coverage_requests_v45:        0
votes:                        0 filas visibles
```

`candidates` expone, entre otros, `source_payload`, `source_candidate_uid`, `source_name`, `last_synced_at`, `source_active` y `source_removed_at`. `candidate_import_scopes` expone `source_url`, estado y notas de sincronización.

## 5. Observaciones de despliegue

```text
/.well-known/security.txt → fallback HTML de la página principal
Cloudflare Pages           → HSTS no observado
Supabase                   → HSTS observado
@supabase/supabase-js@2    → versión no fijada en el bundle
```

No se encontró una clave maestra, `service_role`, JWT privado, secreto OAuth ni evidencia pública del nombre del creador de la cuenta.

## 6. Estructura del arnés local

```text
audit-dev.mjs
  loadDotEnv()             carga .env
  request()                realiza REST/RPC con la clave pública
  rest()                   consultas REST de lectura
  rpc()                    llamadas RPC
  currentStateFor()        encuesta, candidato, relación y resultados
  readOnlyAudit()          inventario y probes sin escritura
  oneVote()                una escritura, solo poll [QA]
  qaTwoIdentities()        dos hashes QA, en serie

simulate-vote-flow.mjs
  simulación en memoria; no usa fetch ni Supabase
```

`audit-dev.mjs:86-90` implementa la solicitud RPC genérica. `audit-dev.mjs:178-182` contiene la llamada controlada de un voto QA. `audit-dev.mjs:221-230` contiene las dos llamadas secuenciales del escenario QA.

## Hallazgo técnico confirmado

El frontend invoca el RPC `submit_scope_vote_v41` con tres valores controlados por el cliente:

```text
p_poll_id
p_candidate_id
p_voter_hash
```

El flujo observado es:

```text
cliente público
  → Supabase REST/RPC como rol anon
  → submit_scope_vote_v41
  → validación del formato y unicidad del hash
  → inserción del voto
  → resultado agregado incrementado
```

En una prueba controlada anterior, un hash sintético de 64 caracteres fue aceptado por el RPC y el contador aumentó. Esto demuestra que la identidad usada para evitar votos duplicados está controlada por el cliente. No demuestra por sí solo que el rol `anon` pueda hacer `INSERT` directo sobre `public.votes`; eso debe verificarse con los permisos, RLS y la definición SQL de la función desde el SQL Editor propietario.

## Relación con OWASP

El hallazgo encaja principalmente con:

- OWASP API Security Top 10 — API6: Unrestricted Access to Sensitive Business Flows.
- OWASP API Security Top 10 — API4: Unrestricted Resource Consumption, si no existen límites de frecuencia y volumen.
- OWASP Top 10 — A04: Insecure Design, por confiar en una identidad no verificable enviada por el cliente.

El mapeo definitivo debe confirmarse después de revisar el cuerpo de `submit_scope_vote_v41`, los `GRANT`, las policies RLS, los índices y las constraints.

## Evidencia que debe conservar el informe

1. Conteo antes de la prueba.
2. Nombre y firma del RPC invocado.
3. Solicitud y respuesta redactadas, sin publicar secretos.
4. Conteo después de dos identidades sintéticas.
5. Definición SQL de la función y sus permisos.
6. Policies RLS y constraints de `public.votes`.

El modo QA reporta `beforeTotalVotes`, las respuestas de ambas llamadas, `afterTotalVotes` y `delta`. Un `delta: 2` demuestra que dos identidades elegidas por el cliente fueron tratadas como dos votantes.

## Corrección recomendada

- No aceptar `p_voter_hash` como prueba de identidad.
- Vincular el voto a una sesión o identidad validada en servidor.
- Emitir un nonce o challenge server-side de un solo uso.
- Aplicar rate limiting por IP anonimizada/HMAC, sesión y dispositivo como señales de abuso, no como identidad única.
- Añadir una constraint de unicidad apropiada en servidor.
- Registrar `created_at` server-side, `request_id`, señales de riesgo y motivo de rechazo.
- Añadir Turnstile u otro control anti-bot en el flujo de votación.
- Revocar el acceso anónimo al RPC si el modelo de negocio lo permite.
- Mantener resultados y tablas de votos fuera de la lectura anónima directa.

## Preparar

```bash
cp .env.example .env
code .
```

Completa únicamente `SUPABASE_PUBLISHABLE_KEY` con la clave `sb_publishable` visible en `https://sensor-politico.pages.dev/assets/config.js?v=45`. No uses una clave `service_role`.

## Auditoría segura, sin escribir

```bash
npm run audit:dev -- read
```

Esto consulta el poll, candidato, relación, resultados agregados, inventario de tablas visible para el rol anónimo y dos probes inválidos. No registra votos.

## Una única escritura controlada en QA

Solo si deseas cambiar el contador de un poll remoto marcado `[QA]`:

```bash
CONFIRM_REMOTE_DEV=I_UNDERSTAND_ONE_REMOTE_DEV_VOTE npm run audit:dev -- one-vote
```

El script bloquea el poll público auditado y cualquier poll cuyo nombre no contenga `[QA]`. Hace exactamente una llamada a `submit_scope_vote_v41`, muestra el antes/después y termina. No tiene bucles, paralelismo, proxies ni generación de hashes.

Para una prueba limpia, usa primero un sondeo y candidato exclusivos de QA en `.env`, no el sondeo público actual.

## Demostrar dos identidades en QA

El siguiente modo está bloqueado para cualquier poll que no tenga `[QA]` en el nombre y rechaza el poll público auditado. Envía exactamente dos hashes sintéticos distintos, en serie, para demostrar si el RPC los trata como dos votantes:

```bash
CONFIRM_QA_ONLY=I_UNDERSTAND_QA_TWO_TEST_VOTES npm run audit:dev -- qa-two-identities
```

Debe responder con `delta: 2` si la vulnerabilidad se reproduce. Repetir el comando con los mismos hashes debería devolver un delta de `0` si el RPC aplica unicidad por hash.
