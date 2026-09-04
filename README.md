# Auditoría local de la dev remota

Este proyecto se ejecuta en tu Mac, pero consulta la instancia remota de Supabase indicada en `.env`. No levanta una copia local de la web.

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
