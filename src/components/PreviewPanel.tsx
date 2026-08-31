import { ArrowRight, FlaskConical, RotateCcw, Trash2, Info } from 'lucide-react';
import type { AuditReport, DraftEdits } from '../../shared/types';
import { statesFor } from '../../shared/preview';
import { sameValue, validateEdit } from '../../shared/records';

export function PreviewPanel({
  report,
  edits,
  onChange,
  onReset,
}: {
  report: AuditReport;
  edits: DraftEdits;
  onChange: (edits: DraftEdits) => void;
  onReset: () => void;
}) {
  const states = statesFor(report);
  function change(id: string, value: string | null) {
    const next = { ...edits };
    const state = states.find((item) => item.id === id)!;
    if (state.storedValue !== undefined && sameValue(state.storedValue, value)) delete next[id];
    else next[id] = value;
    onChange(next);
  }
  return (
    <section className="draft-editor">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            <FlaskConical size={14} /> YOUR DRAFT
          </span>
          <h2>What would you change?</h2>
        </div>
        <button className="quiet-button" onClick={onReset} disabled={!Object.keys(edits).length}>
          <RotateCcw size={15} /> Reset
        </button>
      </div>
      <p className="section-description">
        Edit a value to replace it, or clear its explicit record. Nothing is published. Clearing a
        chain override may activate the Default.
      </p>
      {!report.resolverSupport?.canSimulate && (
        <div className="notice amber">
          <Info size={18} />
          <span>
            This resolver has unverified edit semantics. You can prepare a checklist, but predicted
            results stay unknown.
          </span>
        </div>
      )}
      <div className="draft-fields">
        {states
          .filter((state) => state.chain !== 'Solana')
          .map((state) => {
            const edited = Object.hasOwn(edits, state.id);
            const value = edited
              ? edits[state.id] || ''
              : state.storedValue !== undefined
                ? state.storedValue || ''
                : state.value || '';
            const error = edited ? validateEdit(state.id, edits[state.id]) : null;
            return (
              <div
                className={`draft-field ${state.kind !== 'address' ? 'profile-field' : ''} ${edited ? 'edited' : ''}`}
                key={state.id}
              >
                <label htmlFor={`draft-${state.id}`}>
                  <strong>{state.label}</strong>
                  <span className={`badge ${state.origin === 'default' ? 'amber' : ''}`}>
                    {edited
                      ? edits[state.id] === null
                        ? 'Clear record'
                        : 'Changed'
                      : state.origin === 'default'
                        ? 'Uses Default'
                        : state.status}
                  </span>
                </label>
                <div className="draft-input-row">
                  <input
                    id={`draft-${state.id}`}
                    value={value}
                    onChange={(event) => change(state.id, event.target.value || null)}
                    placeholder={
                      state.origin === 'default'
                        ? 'No override · currently inherits Default'
                        : state.kind === 'address'
                          ? '0x…'
                          : 'Not published'
                    }
                    maxLength={2048}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(error)}
                    aria-describedby={`help-${state.id}`}
                  />
                  <button
                    className="icon-button"
                    title={`Clear ${state.label}`}
                    aria-label={`Clear ${state.label}`}
                    onClick={() => change(state.id, null)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <p id={`help-${state.id}`} className={error ? 'field-error' : 'field-help'}>
                  {error ||
                    (state.origin === 'default'
                      ? `Currently resolves to ${state.value || 'no address'} through Default.`
                      : state.kind === 'address'
                        ? 'A change also changes where this name directs payments. Review before publishing.'
                        : state.key === 'avatar'
                          ? 'Only the reference is inspected. Remote images are never loaded.'
                          : `Public ENS text record: ${state.key}`)}
                </p>
              </div>
            );
          })}
      </div>
      {report.mode === 'demo' && (
        <button
          className="secondary-button"
          onClick={() => change('address:base', '0x3333333333333333333333333333333333333333')}
        >
          Try the demo payment wallet <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}
