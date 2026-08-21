import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './RowActionsMenu.css';

export interface RowActionItem {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface RowActionsMenuProps {
  label: string;
  items: RowActionItem[];
}

// Minimal WAI-ARIA menu-button pattern (button + role="menu" popup).
// Escape and an outside click both close and return focus to the
// trigger; Up/Down move between items. Small enough (2-4 items) that a
// full roving-tabindex implementation would be more code than the
// pattern it replaces.
//
// The popup renders through a portal into document.body rather than as a
// child of the trigger. Table rows sit inside .email-builder-dashboard__
// table-wrap, which needs `overflow-x: auto` so a too-narrow viewport
// scrolls instead of breaking layout — but CSS has no way to set
// overflow-x without also forcing overflow-y to a clipping value, so an
// absolutely-positioned popup nested inside that wrapper gets clipped/
// scroll-trapped instead of floating above the table. Portaling out
// (position: fixed, coordinates read from the trigger's own
// getBoundingClientRect at open time) sidesteps the ancestor entirely.
export function RowActionsMenu({ label, items }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (menuItems.length === 0) return;
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex + 1) % menuItems.length
        : (currentIndex - 1 + menuItems.length) % menuItems.length;
      menuItems[nextIndex]?.focus();
    }
    // A scroll/resize while open would leave the portal's fixed position
    // stale — simplest correct behavior is to close, same as an outside
    // click, rather than track and re-measure on every scroll frame.
    function handleScrollOrResize() {
      setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    // Menu just opened — hand focus to the first item so ArrowDown/Up
    // and typeahead work immediately without an extra Tab.
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus();

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((current) => !current);
  }

  return (
    <div className="row-actions-menu">
      <button
        type="button"
        ref={triggerRef}
        className="row-actions-menu__trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className="row-actions-menu__glyph" aria-hidden="true">⋯</span>
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className="row-actions-menu__popup row-actions-menu__popup--portal"
          style={{ top: position.top, right: position.right }}
          role="menu"
          aria-label={label}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={
                item.destructive ? 'row-actions-menu__item row-actions-menu__item--destructive' : 'row-actions-menu__item'
              }
              onClick={() => {
                // Move focus back to the (persistent) trigger button before
                // this menuitem unmounts and before onSelect can open a
                // dialog. Without this, the menuitem is removed from the DOM
                // as part of the same commit that mounts the dialog, the
                // browser drops focus to <body> first, and the dialog's own
                // "restore focus on close" effect then captures <body>
                // instead of a real element to return focus to.
                triggerRef.current?.focus();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
