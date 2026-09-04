# Auditoría local de la dev remota

Este proyecto se ejecuta en tu Mac, pero consulta la instancia remota de Supabase indicada en `.env`. No levanta una copia local de la web.

## Estado y alcance

El repositorio es público para revisión del equipo:

https://github.com/jackthony/sensor-politico-auditoria-dev

El archivo `.env` real está excluido por `.gitignore`. El repositorio contiene solamente el arnés de auditoría, ejemplos de configuración y un simulador local.

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
3. Solicitud y respuesta redactedas, sin publicar secretos.
4. Conteo después de dos identidades sintéticas.
5. Definición SQL de la función y sus permisos.
6. Policies RLS y constraints de `public.votes`.

Un resultado `delta: 2` en el modo QA demuestra que dos identidades elegidas por el cliente fueron tratadas como dos votantes. No es necesario enviar 10 000 solicitudes para demostrar el defecto; hacerlo contaminaría los datos y no aporta evidencia adicional sobre la causa.

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
