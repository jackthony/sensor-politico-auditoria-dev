# Automatización de pruebas espaciadas con Supabase

Este proyecto combina una prueba controlada contra funciones RPC de Supabase con un perfil temporal reproducible. Las acciones se ejecutan usando intervalos variables de distribución lognormal, en lugar de un intervalo fijo, y al final se reportan los intervalos configurados y los observados.

## Requisitos

- Node.js 18 o superior.
- Una instancia de Supabase de desarrollo.
- Las funciones RPC configuradas para registrar el voto y consultar los resultados.

## Configuración

1. Copia `.env.example` a `.env`.
2. Completa `SUPABASE_URL`, la clave publicable/anon y los identificadores de la encuesta, candidato y ejecución.
3. Conserva estas dos protecciones:

```env
ENVIRONMENT=development
CONFIRM_DEV_TEST=I_UNDERSTAND_DEV_TEST_WRITES
```

El archivo `.env` está pensado para contener secretos y no debe subirse al repositorio.

## Ejecución

Para generar y revisar el perfil temporal sin hacer solicitudes HTTP:

```bash
npm run timing:qa
```

Para ejecutar la prueba integrada contra Supabase:

```bash
npm run test:dev
```

La prueba se detiene en la primera respuesta HTTP con error. También calcula el total de votos antes y después, el incremento, las solicitudes exitosas y las estadísticas temporales.

## Variables del perfil temporal

| Variable | Predeterminado | Descripción |
| --- | ---: | --- |
| `TOTAL_ACCIONES` | `50` | Número de acciones de la prueba. |
| `MEDIA_MS` | `12000` | Media objetivo del intervalo entre acciones. |
| `JITTER_PERCENT` | `30` | Variación relativa objetivo. |
| `MIN_INTERVALO_MS` | `1000` | Límite mínimo de cada intervalo. |
| `SEMILLA` | `clase-jitter-normal-001` | Semilla para repetir el mismo perfil. |

`INTERVALO_MS` se mantiene como alias de `MEDIA_MS` para conservar compatibilidad con la versión anterior.

## Fundamento matemático

### Intervalos entre acciones

Si `t_i` es el timestamp de la acción `i`, el intervalo observado se define como:

```text
Δt_i = t_i - t_(i-1)
```

Con 50 acciones se obtienen 49 intervalos. El primer evento no tiene un intervalo
anterior.

### Jitter como coeficiente de variación

En este proyecto, `JITTER_PERCENT` se interpreta como coeficiente de variación:

```text
CV = (desviación estándar / media) × 100
```

Con una media de 12 segundos y un jitter objetivo del 30%:

```text
μ = 12 s
σ = 12 × 0.30 = 3.6 s
varianza = σ² = 12.96 s²
```

Esta definición se declara explícitamente porque “jitter” puede tener distintos
significados según el área de medición.

### Distribución lognormal

El intervalo `T` se genera con:

```text
ln(T) ~ Normal(μ_log, σ_log²)
T = exp(μ_log + σ_log × Z)
```

Para conservar una media `m` y un coeficiente de variación `CV`:

```text
σ_log² = ln(1 + CV²)
μ_log = ln(m) - σ_log² / 2
```

Con `m = 12 s` y `CV = 0.30`:

```text
σ_log² ≈ 0.0862
σ_log ≈ 0.2936
μ_log ≈ 2.4418
```

La transformación exponencial garantiza intervalos positivos y permite una cola
derecha más larga que una distribución normal simétrica.

### Generación y medición

El método Box-Muller convierte dos valores uniformes `U1` y `U2` en una normal
estándar `Z`:

```text
Z = √(-2 ln(U1)) × cos(2πU2)
```

Luego `timing-profile.mjs` calcula la media y la varianza muestral:

```text
media = Σx_i / n
varianza = Σ(x_i - media)² / (n - 1)
```

Finalmente vuelve a calcular el jitter con los intervalos generados. Durante la
reproducción, `test-dev.mjs` también mide los timestamps reales y compara los
intervalos configurados con los observados.

### Interpretación

La distribución normal se conserva como modelo de comparación, porque es simétrica.
La lognormal resulta más adecuada para duraciones positivas y asimétricas. La
literatura sobre actividad humana también estudia comportamientos de cola pesada y
ráfagas, por lo que ninguna distribución debe presentarse como una ley universal.

Recursos recomendados:

- [Are human interactivity times lognormal?](https://arxiv.org/abs/1607.02952)
- [The origin of bursts and heavy tails in human dynamics](https://pubmed.ncbi.nlm.nih.gov/15889093/)
- [Power-Law Distributions in Empirical Data](https://doi.org/10.1137/070710111)
- [NIST: Normal Probability Plot](https://www.itl.nist.gov/div898/handbook/eda/section3/normprpl.htm)

## Estructura

- `test-dev.mjs`: ejecuta la prueba con escrituras protegidas en Supabase.
- `timing-profile.mjs`: módulo reutilizable para generar intervalos y calcular estadísticas.
- `timing-profile-qa.mjs`: valida el perfil localmente sin modificar datos remotos.

## Evidencia para la entrega

La salida JSON de `test-dev.mjs` permite documentar:

- configuración utilizada;
- total inicial y final de votos;
- `delta` de la prueba;
- cantidad de respuestas exitosas;
- media, desviación estándar y jitter de los intervalos configurados y observados.
