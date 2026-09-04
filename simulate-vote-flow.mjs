#!/usr/bin/env node

// Simulación LOCAL: no usa fetch, Supabase ni modifica ninguna base de datos.
// Sirve para visualizar cómo una regla basada solo en voter_hash puede aceptar
// varias identidades distintas para el mismo sondeo.

import { createHash } from 'node:crypto';

const pollId = 'QA-POLL-ONLY';
const targetCandidateId = 'DIEGO-LOPEZ-QA';

const events = [
  { type: 'page_view', actor: 'browser-A' },
  { type: 'vote_attempt', actor: 'browser-A', candidateId: targetCandidateId, identity: 'A' },
  { type: 'analytics', actor: 'browser-B' },
  { type: 'vote_attempt', actor: 'browser-B', candidateId: targetCandidateId, identity: 'B' },
  { type: 'page_view', actor: 'browser-C' },
  { type: 'vote_attempt', actor: 'browser-C', candidateId: targetCandidateId, identity: 'C' },
  { type: 'analytics', actor: 'browser-D' },
  { type: 'vote_attempt', actor: 'browser-D', candidateId: targetCandidateId, identity: 'D' },
  { type: 'page_view', actor: 'browser-E' },
  { type: 'vote_attempt', actor: 'browser-E', candidateId: targetCandidateId, identity: 'E' }
];

const acceptedHashes = new Set();
let simulatedCount = 0;

function syntheticHash(identity) {
  return createHash('sha256')
    .update(`local-qa-fixture|${pollId}|${targetCandidateId}|${identity}`)
    .digest('hex');
}

for (const [index, event] of events.entries()) {
  if (event.type !== 'vote_attempt') {
    console.log(`${String(index + 1).padStart(2, '0')} ${event.type} actor=${event.actor}`);
    continue;
  }

  const voterHash = syntheticHash(event.identity);
  const accepted = !acceptedHashes.has(voterHash);
  if (accepted) {
    acceptedHashes.add(voterHash);
    simulatedCount += 1;
  }

  console.log(JSON.stringify({
    sequence: index + 1,
    type: event.type,
    candidateId: event.candidateId,
    identityLabel: event.identity,
    hashPrefix: voterHash.slice(0, 12),
    acceptedByHashOnlyRule: accepted,
    simulatedCount
  }));
}

console.log(`Resultado local: ${simulatedCount} eventos de voto aceptados para ${targetCandidateId}.`);
console.log('No se envió ninguna solicitud HTTP y no se modificó Supabase.');
