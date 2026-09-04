import { createHash } from 'node:crypto';

export function createSeededRandom(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32BE(0);

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
function standardNormalRandom(random) {
  // Transformación Box-Muller: de dos valores uniformes a una normal estándar.
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

export function statistics(values) {
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

export function createTimingProfile({
  totalAcciones,
  mediaMs,
  jitterPercent,
  minIntervaloMs,
  semilla
}) {
  if (!Number.isInteger(totalAcciones) || totalAcciones < 0) {
    throw new Error('totalAcciones debe ser un entero mayor o igual a 0.');
  }
  if (!Number.isFinite(mediaMs) || mediaMs <= 0) {
    throw new Error('mediaMs debe ser un número mayor que 0.');
  }
  if (!Number.isFinite(jitterPercent) || jitterPercent < 0) {
    throw new Error('jitterPercent debe ser un número mayor o igual a 0.');
  }
  if (!Number.isFinite(minIntervaloMs) || minIntervaloMs < 0) {
    throw new Error('minIntervaloMs debe ser un número mayor o igual a 0.');
  }

  const intervalCount = Math.max(totalAcciones - 1, 0);
  if (!intervalCount) return [];

  const random = createSeededRandom(String(semilla));
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
