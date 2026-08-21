import { useState, type ReactNode } from 'react';

// Feature 06 — one shared repeatable-list editor for every bounded,
// user-editable list in the builder: header nav links (instruction 26),
// social platform links (instruction 30), footer social links
// (instruction 31), and product cards (instruction 29 — passing
// minItems === maxItems === the fixed card count disables Add/Remove
// entirely, giving product's "select a card to edit" behaviour for
// free from the same component, instead of a second implementation).
//
// Shows a compact list of items (instruction 29: "Do not render a
// gigantic flat form containing every field simultaneously") with one
// item's full editor expanded at a time via `renderItemEditor`.
export interface RepeatableItemEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  itemLabel: (item: T, index: number) => string;
  renderItemEditor: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
}

export function RepeatableItemEditor<T>({
  items, onChange, createItem, itemLabel, renderItemEditor, minItems = 0, maxItems = 20, addLabel = 'Add item',
}: RepeatableItemEditorProps<T>) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(items.length > 0 ? 0 : null);
  const canAdd = items.length < maxItems;
  const canRemove = items.length > minItems;

  function addItem() {
    if (!canAdd) return;
    const next = [...items, createItem()];
    onChange(next);
    setExpandedIndex(next.length - 1);
  }

  function removeItem(index: number) {
    if (!canRemove) return;
    const next = items.filter((_, i) => i !== index);
    onChange(next);
    setExpandedIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setExpandedIndex(target);
  }

  function updateItem(index: number, patch: Partial<T>) {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(next);
  }

  return (
    <div className="repeatable-editor">
      <ul className="repeatable-editor__list">
        {items.map((item, index) => (
          // eslint-disable-next-line react/no-array-index-key -- items have no stable id in this data model; index-keying is safe since the list itself (not per-item identity) drives all mutations
          <li key={index} className="repeatable-editor__item">
            <button
              type="button"
              className={
                expandedIndex === index
                  ? 'repeatable-editor__item-toggle repeatable-editor__item-toggle--active'
                  : 'repeatable-editor__item-toggle'
              }
              aria-expanded={expandedIndex === index}
              onClick={() => setExpandedIndex((current) => (current === index ? null : index))}
            >
              {itemLabel(item, index)}
            </button>
            <div className="repeatable-editor__item-actions">
              <button type="button" aria-label={`Move ${itemLabel(item, index)} up`} disabled={index === 0} onClick={() => moveItem(index, -1)}>
                <span className="mdaiw-icon mdaiw-icon--chevron-down properties-panel__mobile-order-icon--up" aria-hidden="true" />
              </button>
              <button type="button" aria-label={`Move ${itemLabel(item, index)} down`} disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}>
                <span className="mdaiw-icon mdaiw-icon--chevron-down" aria-hidden="true" />
              </button>
              {canRemove && (
                <button type="button" aria-label={`Remove ${itemLabel(item, index)}`} onClick={() => removeItem(index)}>
                  <span className="mdaiw-icon mdaiw-icon--delete" aria-hidden="true" />
                </button>
              )}
            </div>
            {expandedIndex === index && (
              <div className="repeatable-editor__item-editor">
                {renderItemEditor(item, (patch) => updateItem(index, patch), index)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canAdd && (
        <button type="button" className="properties-panel__view-all" onClick={addItem}>
          + {addLabel}
        </button>
      )}
    </div>
  );
}
