#!/usr/bin/env node


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const DEFAULT_TOTAL_ACCIONES = 50;
const DEFAULT_MEDIA_MS = 12_000;
const DEFAULT_JITTER_PERCENT = 30;
const DEFAULT_MIN_INTERVALO_MS = 1_000;
const DEFAULT_SEMILLA = 'clase-jitter-normal-001';

function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(projectDirectory, '.env'));

function readNonNegativeInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero mayor o igual a 0.`);
  }
  return value;
}

function readNonNegativeNumber(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return fallback;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} debe ser un número mayor o igual a 0.`);
  }
  return value;
}

function createSeededRandom(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32BE(0);

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function standardNormalRandom(random) {
  // Box-Muller transforma dos variables uniformes en una normal estándar.
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleVariance(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

function statistics(values) {
  const average = mean(values);
  const variance = sampleVariance(values);
  const standardDeviation = Math.sqrt(variance);

  return {
    count: values.length,
    meanMs: average,
    varianceMs2: variance,
    standardDeviationMs: standardDeviation,
    jitterPercent: average ? (standardDeviation / average) * 100 : 0
  };
}

function createTimingProfile({ totalAcciones, mediaMs, jitterPercent, minIntervaloMs, semilla }) {
  const intervalCount = Math.max(totalAcciones - 1, 0);
  if (!intervalCount) return [];

  const random = createSeededRandom(semilla);
  const coefficientOfVariation = jitterPercent / 100;
  const logVariance = Math.log(1 + coefficientOfVariation ** 2);
  const logStandardDeviation = Math.sqrt(logVariance);
  const logMean = Math.log(mediaMs) - logVariance / 2;

  return Array.from({ length: intervalCount }, () => {
    const standardNormal = standardNormalRandom(random);
    const lognormalValue = Math.exp(logMean + logStandardDeviation * standardNormal);
    return Math.max(minIntervaloMs, Math.round(lognormalValue));
  });
}

const esperar = milisegundos => new Promise(resolve => setTimeout(resolve, milisegundos));

async function main() {
  const totalAcciones = readNonNegativeInteger('TOTAL_ACCIONES', DEFAULT_TOTAL_ACCIONES);
  const mediaMs = readNonNegativeNumber('MEDIA_MS', DEFAULT_MEDIA_MS);
  const jitterPercent = readNonNegativeNumber('JITTER_PERCENT', DEFAULT_JITTER_PERCENT);
  const minIntervaloMs = readNonNegativeNumber('MIN_INTERVALO_MS', DEFAULT_MIN_INTERVALO_MS);
  const semilla = process.env.SEMILLA || DEFAULT_SEMILLA;
  const reproducir = process.env.REPRODUCIR === '1';
  const intervalosMs = createTimingProfile({
    totalAcciones,
    mediaMs,
    jitterPercent,
    minIntervaloMs,
    semilla
  });

  console.log(JSON.stringify({
    mode: reproducir ? 'replay-local' : 'profile-only',
    totalAcciones,
    mediaObjetivoMs: mediaMs,
    jitterObjetivoPercent: jitterPercent,
    distribucion: 'lognormal',
    parametrosLognormales: {
      mediaLogaritmica: Math.log(mediaMs) - Math.log(1 + (jitterPercent / 100) ** 2) / 2,
      desviacionLogaritmica: Math.sqrt(Math.log(1 + (jitterPercent / 100) ** 2))
    },
    semilla,
    intervalos: statistics(intervalosMs)
  }, null, 2));

  const timestamps = [];
  for (let i = 0; i < totalAcciones; i += 1) {
    if (reproducir && i > 0) await esperar(intervalosMs[i - 1]);

    const timestamp = new Date();
    timestamps.push(timestamp.getTime());
    console.log(JSON.stringify({
      sequence: i + 1,
      timestamp: timestamp.toISOString(),
      waitBeforeMs: i === 0 ? 0 : intervalosMs[i - 1]
    }));
  }

  if (reproducir) {
    const observedIntervals = timestamps.slice(1).map((value, index) => value - timestamps[index]);
    console.log(JSON.stringify({ observed: statistics(observedIntervals) }, null, 2));
  }

  console.log('Perfil generado sin solicitudes HTTP y sin modificaciones remotas.');
}

main().catch(error => {
  console.error(`ERROR: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});
