#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';

function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const mode = process.argv[2] || 'read';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const pollId = process.env.POLL_ID || '';
const candidateId = process.env.CANDIDATE_ID || '';
const qaPollId = process.env.QA_POLL_ID || '';
const qaCandidateId = process.env.QA_CANDIDATE_ID || '';
const testHash = process.env.TEST_HASH || 'a'.repeat(64);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function requireConfig() {
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Completa .env: SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.');
  }
  if (!/^https:\/\//i.test(supabaseUrl)) throw new Error('SUPABASE_URL debe usar HTTPS.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY debe ser la clave sb_publishable del frontend, no una service_role.');
  }
  if (mode !== 'qa-two-identities') {
    if (!pollId || !candidateId) throw new Error('Completa .env: POLL_ID y CANDIDATE_ID.');
    if (!uuidPattern.test(pollId)) throw new Error('POLL_ID no parece un UUID válido.');
    if (!uuidPattern.test(candidateId)) throw new Error('CANDIDATE_ID no parece un UUID válido.');
  } else {
    if (!qaPollId || !qaCandidateId) throw new Error('Para QA completa QA_POLL_ID y QA_CANDIDATE_ID.');
    if (!uuidPattern.test(qaPollId)) throw new Error('QA_POLL_ID no parece un UUID válido.');
    if (!uuidPattern.test(qaCandidateId)) throw new Error('QA_CANDIDATE_ID no parece un UUID válido.');
  }
}

function headers(extra = {}) {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: headers(options.headers)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, headers: response.headers, data };
}

async function rest(path, options = {}) {
  const result = await request(`/rest/v1/${path}`, options);
  if (result.status >= 400) throw new Error(`REST ${result.status}: ${JSON.stringify(result.data)}`);
  return result;
}

async function rpc(name, body) {
  return request(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

function contentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+|\*)$/);
  return match && match[1] !== '*' ? Number(match[1]) : null;
}

async function tableInventory(table) {
  const result = await rest(`${table}?select=*&limit=1`, {
    headers: { Prefer: 'count=exact' }
  });
  const first = Array.isArray(result.data) && result.data[0] ? result.data[0] : null;
  return {
    table,
    visibleRowsToAnon: contentRangeTotal(result.headers.get('content-range')),
    sampleColumns: first ? Object.keys(first) : [],
    rawRowsReturned: Array.isArray(result.data) ? result.data.length : null
  };
}

async function currentStateFor(targetPollId, targetCandidateId) {
  const [poll, candidate, relation, results] = await Promise.all([
    rest(`polls?id=eq.${encodeURIComponent(targetPollId)}&select=id,name,status,starts_at,ends_at,geo_id`),
    rest(`candidates?id=eq.${encodeURIComponent(targetCandidateId)}&select=id,full_name,geo_id,visible`),
    rest(`poll_candidates?poll_id=eq.${encodeURIComponent(targetPollId)}&candidate_id=eq.${encodeURIComponent(targetCandidateId)}&select=poll_id,candidate_id,active,display_order`),
    rpc('get_poll_results', { p_poll_id: targetPollId })
  ]);
  if (results.status >= 400) throw new Error(`get_poll_results ${results.status}: ${JSON.stringify(results.data)}`);
  const rows = Array.isArray(results.data) ? results.data : [];
  return {
    poll: poll.data,
    candidate: candidate.data,
    pollCandidateRelation: relation.data,
    totalVotes: rows.reduce((sum, row) => sum + Number(row.vote_count || 0), 0),
    nonZeroResults: rows.filter(row => Number(row.vote_count || 0) > 0)
  };
}

async function currentState() {
  return currentStateFor(pollId, candidateId);
}

async function readOnlyAudit() {
  const [state, ...inventory] = await Promise.all([
    currentState(),
    ...['geo_units', 'political_organizations', 'candidates', 'polls', 'poll_candidates', 'candidate_profiles', 'service_requests', 'site_visits', 'candidate_photos', 'candidate_import_scopes', 'coverage_requests_v45', 'votes'].map(tableInventory)
  ]);

  // Entrada inválida: debe fallar sin modificar datos.
  const invalidVote = await rpc('submit_scope_vote_v41', {
    p_poll_id: pollId,
    p_candidate_id: candidateId,
    p_voter_hash: 'audit-invalid'
  });

  // RPC administrativo de solo lectura: debe exigir sesión.
  const adminProbe = await rpc('admin_traffic_dashboard_v77', { p_period: 'today' });

  console.log(JSON.stringify({
    target: { supabaseUrl, pollId, candidateId },
    state,
    inventory,
    safeProbes: {
      invalidVote,
      adminTrafficWithoutSession: adminProbe
    },
    interpretation: [
      'Esta ejecución no registra votos.',
      'invalidVote debería devolver INVALID_REQUEST.',
      'adminTrafficWithoutSession debería devolver AUTH_REQUIRED o HTTP 400.'
    ]
  }, null, 2));
}

async function oneVote() {
  if (process.env.CONFIRM_REMOTE_DEV !== 'I_UNDERSTAND_ONE_REMOTE_DEV_VOTE') {
    throw new Error('Para escribir en la dev remota ejecuta con CONFIRM_REMOTE_DEV=I_UNDERSTAND_ONE_REMOTE_DEV_VOTE.');
  }
  if (!/^[0-9a-f]{64}$/i.test(testHash)) throw new Error('TEST_HASH debe ser exactamente 64 caracteres hexadecimales.');

  const before = await currentState();
  const publicPollId = '3e6a63a4-3494-46e4-9b92-374df51d580e';
  const targetPoll = before.poll?.[0];
  if (pollId === publicPollId) throw new Error('Bloqueado: one-vote no puede escribir en el sondeo público auditado.');
  if (!targetPoll || !/\[qa\]/i.test(String(targetPoll.name || ''))) {
    throw new Error(`Bloqueado: el poll remoto debe llamarse con [QA]. Recibido: ${targetPoll?.name || 'no encontrado'}`);
  }
  const result = await rpc('submit_scope_vote_v41', {
    p_poll_id: pollId,
    p_candidate_id: candidateId,
    p_voter_hash: testHash
  });
  const after = await currentState();

  console.log(JSON.stringify({
    warning: 'Se envió exactamente una solicitud de voto a la instancia remota configurada.',
    target: { pollId, candidateId },
    beforeTotalVotes: before.totalVotes,
    rpcResult: result,
    afterTotalVotes: after.totalVotes,
    delta: after.totalVotes - before.totalVotes,
    expected: 'Usando un hash sintético ya utilizado, lo normal es ALREADY_VOTED_LEVEL/ALREADY_VOTED y delta 0.'
  }, null, 2));
}

async function qaTwoIdentities() {
  if (process.env.CONFIRM_QA_ONLY !== 'I_UNDERSTAND_QA_TWO_TEST_VOTES') {
    throw new Error('Para QA ejecuta con CONFIRM_QA_ONLY=I_UNDERSTAND_QA_TWO_TEST_VOTES.');
  }
  const publicPollId = '3e6a63a4-3494-46e4-9b92-374df51d580e';
  if (qaPollId === publicPollId) throw new Error('Bloqueado: QA_POLL_ID coincide con el sondeo público auditado.');

  const target = await currentStateFor(qaPollId, qaCandidateId);
  const poll = target.poll?.[0];
  const relation = target.pollCandidateRelation?.[0];
  if (!poll) throw new Error('No existe QA_POLL_ID en la base remota.');
  if (!/\[qa\]/i.test(String(poll.name || ''))) {
    throw new Error(`Bloqueado: el poll remoto debe llamarse con [QA]. Recibido: ${poll.name}`);
  }
  if (poll.status !== 'active') throw new Error('El sondeo QA no está activo.');
  if (!relation?.active) throw new Error('El candidato QA no está vinculado activamente al sondeo QA.');
  const now = Date.now();
  if (poll.starts_at && now < new Date(poll.starts_at).getTime()) throw new Error('El sondeo QA todavía no empezó.');
  if (poll.ends_at && now > new Date(poll.ends_at).getTime()) throw new Error('El sondeo QA ya terminó.');

  const hashA = createHash('sha256').update(`qa-fixture|${qaPollId}|${qaCandidateId}|A`).digest('hex');
  const hashB = createHash('sha256').update(`qa-fixture|${qaPollId}|${qaCandidateId}|B`).digest('hex');
  const before = target.totalVotes;

  // Exactamente dos identidades sintéticas y ninguna repetición/paralelismo.
  const first = await rpc('submit_scope_vote_v41', {
    p_poll_id: qaPollId,
    p_candidate_id: qaCandidateId,
    p_voter_hash: hashA
  });
  const second = await rpc('submit_scope_vote_v41', {
    p_poll_id: qaPollId,
    p_candidate_id: qaCandidateId,
    p_voter_hash: hashB
  });
  const after = await currentStateFor(qaPollId, qaCandidateId);

  console.log(JSON.stringify({
    warning: 'Se enviaron exactamente dos votos sintéticos al sondeo remoto marcado [QA].',
    target: { pollId: qaPollId, candidateId: qaCandidateId, pollName: poll.name },
    beforeTotalVotes: before,
    firstRpc: first,
    secondRpc: second,
    afterTotalVotes: after.totalVotes,
    delta: after.totalVotes - before,
    interpretation: after.totalVotes - before === 2
      ? 'VULNERABILIDAD REPRODUCIDA: dos hashes elegidos por el cliente fueron aceptados como dos votantes.'
      : 'La regla no aceptó dos identidades distintas o el poll QA no refleja el cambio esperado.'
  }, null, 2));
}

try {
  requireConfig();
  if (mode === 'read') await readOnlyAudit();
  else if (mode === 'one-vote') await oneVote();
  else if (mode === 'qa-two-identities') await qaTwoIdentities();
  else throw new Error(`Modo desconocido: ${mode}. Usa read, one-vote o qa-two-identities.`);
} catch (error) {
  fail(error?.stack || error?.message || String(error));
}
