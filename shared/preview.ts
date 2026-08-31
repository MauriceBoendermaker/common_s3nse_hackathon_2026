import type {
  AuditReport,
  DraftEdits,
  PublicRecord,
  RecordState,
  WalletExposure,
} from './types.js';
import {
  DEFAULT_RECORD,
  isEmptyAddress,
  isEvmValue,
  recordDefinitions,
  sameValue,
  validateEdit,
} from './records.js';

export interface RouteOutcome {
  id: string;
  address: string;
  chain: 'Ethereum' | 'Base';
  status: 'new' | 'retained' | 'removed' | 'unknown';
  affected: boolean;
  reasons: string[];
  recordIds: string[];
  wallet?: WalletExposure;
}

export function statesFor(report: AuditReport): RecordState[] {
  return (
    report.recordStates ||
    recordDefinitions.map((definition) => {
      const record = report.records.find((item) => item.id === definition.id);
      const failed = report.coverage.failedKeys.includes(definition.key);
      return {
        ...definition,
        value: record?.value || null,
        status: failed ? 'failed' : record ? 'populated' : 'unsupported',
        origin: 'unknown',
        explanation:
          'Legacy snapshot: stored provenance and successful-empty reads cannot be independently established.',
      };
    })
  );
}

export function simulateDraft(
  report: AuditReport,
  edits: DraftEdits,
  enrichment: WalletExposure[] = [],
) {
  const originals = statesFor(report);
  const states = originals.map((state) => ({ ...state }));
  const supported = Boolean(report.resolverSupport?.canSimulate);
  const errors = Object.entries(edits).flatMap(([id, value]) => {
    const error = validateEdit(id, value);
    return error ? [{ id, error }] : [];
  });
  const changedDefault = Object.hasOwn(edits, DEFAULT_RECORD);
  for (const state of states) {
    const edited = Object.hasOwn(edits, state.id);
    const affectedByDefault = changedDefault && ['Ethereum', 'Base'].includes(state.chain || '');
    if (!edited && !affectedByDefault) continue;
    if (
      !supported ||
      errors.some((error) => error.id === state.id) ||
      (!edited && state.storedValue === undefined)
    ) {
      state.value = null;
      state.status = 'failed';
      state.origin = 'unknown';
      state.explanation =
        'This draft result cannot be determined from the checked resolver evidence.';
      continue;
    }
    if (edited) state.storedValue = edits[state.id];
    state.value = state.storedValue || null;
    state.status =
      state.value && !(state.kind === 'address' && isEmptyAddress(state.value))
        ? 'populated'
        : 'empty';
    if (state.status === 'empty') state.value = null;
    state.origin = 'explicit';
    state.sourceRecordId = undefined;
    state.explanation = 'Hypothetical stored value. No ENS transaction has been sent.';
  }
  const defaultState = states.find((state) => state.id === DEFAULT_RECORD);
  if (supported) {
    for (const state of states) {
      if (!['Ethereum', 'Base'].includes(state.chain || '')) continue;
      if (!Object.hasOwn(edits, state.id) && !changedDefault) continue;
      if (state.storedValue !== null || state.status === 'failed') continue;
      if (!defaultState || ['failed', 'unsupported'].includes(defaultState.status)) {
        state.value = null;
        state.status = 'failed';
        state.origin = 'unknown';
        state.explanation = 'The chain override is removed, but the Default could not be checked.';
      } else {
        state.value = defaultState.value;
        state.status = state.value ? 'populated' : 'empty';
        state.origin = 'default';
        state.sourceRecordId = DEFAULT_RECORD;
        state.explanation = state.value
          ? 'The explicit chain override is absent. The retained Default EVM address still resolves on this chain.'
          : 'Neither the chain override nor Default provides an address in this draft.';
      }
    }
  }
  const records: PublicRecord[] = states
    .filter((state) => state.status === 'populated' && state.value)
    .map((state) => ({
      id: state.id,
      key: state.key,
      label: state.label,
      kind: state.kind,
      chain: state.chain,
      value: state.value!,
      origin: state.origin,
      sourceRecordId: state.sourceRecordId,
    }));
  const candidateRecords = [...report.records, ...records].filter(
    (record) =>
      record.kind === 'address' &&
      (record.chain === 'Ethereum' || record.chain === 'Base') &&
      isEvmValue(record.value),
  );
  const candidates = new Map(
    candidateRecords.map((record) => [`${record.chain}:${record.value.toLowerCase()}`, record]),
  );
  const routes: RouteOutcome[] = [...candidates].map(([id, record]) => {
    const existed = report.records.some(
      (before) => before.chain === record.chain && sameValue(before.value, record.value),
    );
    const direct = records.filter(
      (item) => item.chain === record.chain && sameValue(item.value, record.value),
    );
    const references = records.filter(
      (item) => item.kind === 'address' && sameValue(item.value, record.value),
    );
    const controls = (report.controlRecords || []).filter((control) =>
      sameValue(control.address, record.value),
    );
    const uncertainty =
      report.controlStatus !== 'ready' ||
      states.some(
        (state) => ['failed', 'unsupported'].includes(state.status) && state.kind === 'address',
      );
    const reasons: string[] = [];
    direct.forEach((item) =>
      reasons.push(
        item.origin === 'default'
          ? `${item.label} still resolves through Default EVM address.`
          : `${item.label} ${existed ? 'still exposes' : 'would expose'} this address.`,
      ),
    );
    if (!direct.length)
      references.forEach((item) =>
        reasons.push(
          `${item.label} still publishes these address bytes. The already-observed ${record.chain} account remains queryable; matching bytes do not prove common ownership.`,
        ),
      );
    controls.forEach((control) =>
      reasons.push(
        `The unchanged ENS ${control.role.toLowerCase()} record still publishes this address. Editing payment records does not change name-control roles.`,
      ),
    );
    const survives = direct.length || references.length || controls.length;
    const status = survives ? (existed ? 'retained' : 'new') : uncertainty ? 'unknown' : 'removed';
    if (status === 'removed')
      reasons.push(
        'No route remains among the checked current records and name-control roles. Earlier disclosures and unchecked routes can still exist.',
      );
    if (status === 'unknown')
      reasons.push(
        'Address or name-control coverage is incomplete, so absence of another checked route cannot be established.',
      );
    return {
      id,
      address: record.value,
      chain: record.chain as 'Ethereum' | 'Base',
      status,
      affected:
        [...report.records, ...records].some(
          (item) => sameValue(item.value, record.value) && Object.hasOwn(edits, item.id),
        ) ||
        (changedDefault && ['Ethereum', 'Base'].includes(record.chain || '')),
      reasons,
      recordIds: references.map((item) => item.id),
      wallet: [...enrichment, ...report.wallets].find(
        (wallet) => wallet.chain === record.chain && sameValue(wallet.address, record.value),
      ),
    };
  });
  const changed = Object.keys(edits).map((id) => ({
    id,
    label: recordDefinitions.find((record) => record.id === id)?.label || id,
    before: originals.find((state) => state.id === id),
    after: states.find((state) => state.id === id),
    requested: edits[id],
  }));
  return {
    states,
    records,
    routes: routes.sort((a, b) => Number(b.affected) - Number(a.affected)),
    changed,
    errors,
    unknown: states.filter((state) => ['failed', 'unsupported'].includes(state.status)).length,
  };
}

// A new portfolio observation must not be attached to a draft based on different
// record evidence. Compare unknown states and provenance too, not only values.
export function sameRecordSnapshot(before: AuditReport, after: AuditReport): boolean {
  if (
    before.name !== after.name ||
    before.mode !== after.mode ||
    before.resolver?.toLowerCase() !== after.resolver?.toLowerCase() ||
    before.controlStatus !== after.controlStatus
  )
    return false;
  const a = statesFor(before);
  const b = statesFor(after);
  return (
    a.length === b.length &&
    a.every((state) => {
      const next = b.find((item) => item.id === state.id);
      return (
        next &&
        next.status === state.status &&
        next.origin === state.origin &&
        next.sourceRecordId === state.sourceRecordId &&
        sameValue(next.value, state.value) &&
        (next.storedValue === undefined) === (state.storedValue === undefined) &&
        sameValue(next.storedValue, state.storedValue)
      );
    }) &&
    JSON.stringify(before.controlRecords || []) === JSON.stringify(after.controlRecords || [])
  );
}

export function compareReports(before: AuditReport, after: AuditReport, edits: DraftEdits = {}) {
  if (before.name !== after.name || before.mode !== after.mode)
    throw new Error('Compare snapshots of the same normalized name and data mode.');
  const fresh =
    before.mode === 'live'
      ? Boolean(
          before.blockNumber &&
          after.blockNumber &&
          BigInt(after.blockNumber) > BigInt(before.blockNumber),
        )
      : new Date(after.observedAt).getTime() > new Date(before.observedAt).getTime();
  const earlier = statesFor(before);
  const rows = statesFor(after).map((state) => {
    const previous = earlier.find((item) => item.id === state.id);
    const unknown =
      !previous ||
      ['failed', 'unsupported'].includes(state.status) ||
      ['failed', 'unsupported'].includes(previous.status);
    const changed =
      !unknown &&
      (!sameValue(previous.value, state.value) ||
        (previous.storedValue !== undefined &&
          state.storedValue !== undefined &&
          !sameValue(previous.storedValue, state.storedValue)));
    let expected: 'matches' | 'mismatch' | 'unknown' | 'not-requested' = 'not-requested';
    if (Object.hasOwn(edits, state.id))
      expected =
        !fresh ||
        state.storedValue === undefined ||
        ['failed', 'unsupported'].includes(state.status) ||
        before.resolver !== after.resolver
          ? 'unknown'
          : sameValue(state.storedValue, edits[state.id])
            ? 'matches'
            : 'mismatch';
    return {
      id: state.id,
      label: state.label,
      before: previous?.value || null,
      after: state.value,
      beforeStatus: previous?.status || 'failed',
      afterStatus: state.status,
      beforeOrigin: previous?.origin || 'unknown',
      afterOrigin: state.origin || 'unknown',
      change: unknown ? 'unknown' : changed ? 'changed' : 'unchanged',
      expected,
    };
  });
  return {
    fresh,
    resolverChanged: before.resolver !== after.resolver,
    rows,
    verified:
      Object.keys(edits).length > 0 &&
      rows.filter((row) => row.expected !== 'not-requested').length === Object.keys(edits).length &&
      rows
        .filter((row) => row.expected !== 'not-requested')
        .every((row) => row.expected === 'matches'),
  };
}
