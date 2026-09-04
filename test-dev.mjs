#!/usr/bin/env node


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const pollId = process.env.POLL_ID || '';
const candidateId = process.env.CANDIDATE_ID || '';
const testRunId = process.env.TEST_RUN_ID || '';
const voteRpcName = process.env.VOTE_RPC_NAME || 'submit_scope_vote_v41';
const resultsRpcName = process.env.RESULTS_RPC_NAME || 'get_poll_results';
const totalAcciones = readNonNegativeInteger('TOTAL_ACCIONES', 50);
const intervaloMs = readNonNegativeInteger('INTERVALO_MS', 12_000);

function readNonNegativeInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero mayor o igual a 0.`);
  }
  return value;
}

const esperar = (milisegundos) => new Promise(resolve => setTimeout(resolve, milisegundos));

function requireConfig() {
  if (process.env.ENVIRONMENT !== 'development') {
    throw new Error('Bloqueado: define ENVIRONMENT=development para ejecutar pruebas con escrituras.');
  }
  if (process.env.CONFIRM_DEV_TEST !== 'I_UNDERSTAND_DEV_TEST_WRITES') {
    throw new Error(
      'Confirma la prueba con CONFIRM_DEV_TEST=I_UNDERSTAND_DEV_TEST_WRITES.'
    );
  }
  if (!supabaseUrl || !supabaseKey || !pollId || !candidateId || !testRunId) {
    throw new Error(
      'Completa .env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, POLL_ID, CANDIDATE_ID y TEST_RUN_ID.'
    );
  }
  if (!/^https:\/\//i.test(supabaseUrl)) throw new Error('SUPABASE_URL debe usar HTTPS.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey) && !/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(supabaseKey)) {
    throw new Error('La clave debe ser SUPABASE_PUBLISHABLE_KEY o una clave anon válida.');
  }
}

function hashDinamico(iteracion) {
  return createHash('sha256')
    .update(`class-dev-test|${testRunId}|${pollId}|${candidateId}|${iteracion}`)
    .digest('hex');
}

function headers() {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };
}

async function ejecutarRpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: response.status, data };
}

async function totalDeResultados() {
  const result = await ejecutarRpc(resultsRpcName, { p_poll_id: pollId });
  if (result.status >= 400) {
    throw new Error(`No se pudieron leer los resultados (${result.status}): ${JSON.stringify(result.data)}`);
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  return rows.reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
}

async function ejecutarFuncion(iteracion) {
  return ejecutarRpc(voteRpcName, {
    p_poll_id: pollId,
    p_candidate_id: candidateId,
    p_voter_hash: hashDinamico(iteracion)
  });
}

async function probarAccionesEspaciadas() {
  requireConfig();

  const beforeTotalVotes = await totalDeResultados();
  const responses = [];

  console.log(
    `Iniciando prueba de desarrollo: ${totalAcciones} acciones contra ${voteRpcName}, ` +
    `espaciadas cada ${intervaloMs / 1000} segundos.`
  );

  for (let i = 1; i <= totalAcciones; i += 1) {
    console.log(`[${new Date().toLocaleTimeString()}] Ejecutando iteración #${i}...`);

    const result = await ejecutarFuncion(i);
    responses.push({ sequence: i, status: result.status, data: result.data });
    console.log(JSON.stringify({ sequence: i, status: result.status, response: result.data }));

    // Evita repetir llamadas si el endpoint ya respondió con error.
    if (result.status >= 400) {
      throw new Error(`La iteración #${i} falló; se detiene la prueba para no repetir el error.`);
    }

    if (i < totalAcciones) await esperar(intervaloMs);
  }

  const afterTotalVotes = await totalDeResultados();
  const successfulRequests = responses.filter(result => result.status >= 200 && result.status < 300).length;

  console.log(JSON.stringify({
    target: {
      supabaseUrl,
      pollId,
      candidateId,
      voteRpcName,
      testRunId
    },
    beforeTotalVotes,
    afterTotalVotes,
    delta: afterTotalVotes - beforeTotalVotes,
    successfulRequests,
    requestedActions: totalAcciones,
    intervaloMs,
    message: 'Prueba completada contra la instancia marcada como development.'
  }, null, 2));
}

probarAccionesEspaciadas().catch(error => {
  console.error(`ERROR: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});
