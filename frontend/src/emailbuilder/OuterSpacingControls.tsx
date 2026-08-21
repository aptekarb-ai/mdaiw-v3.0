import { useState } from 'react';
import { isMobileOuterSpacingOverridden, resolveOuterSpacing, type EmailModuleSettings, type OuterSpacingSides } from './edm';
import type { DimensionValue } from './dimensions';
import { DimensionControl } from './DimensionControl';
import { OUTER_SPACING_PX_BOUNDS, type BuilderViewMode } from './registryCore';

interface OuterSpacingControlsProps {
  settings: EmailModuleSettings;
  viewport: BuilderViewMode;
  onChange: (patch: Partial<EmailModuleSettings>) => void;
}

// Left/right OUTER spacing (gutters) — separate from internal content
// padding. Desktop/Mobile-aware, same architecture as PaddingControls:
// editing while the toolbar is in Mobile view sets an explicit
// settings.outerSpacing.mobile override for that side only; Desktop
// stays untouched. px-only for now (instruction: outer spacing "may
// remain px-first unless compatibility testing validates %" — the
// allowedUnits list is the only place that would need to change once/if
// % is validated safe).
export function OuterSpacingControls({ settings, viewport, onChange }: OuterSpacingControlsProps) {
  const isMobile = viewport === 'mobile';
  const resolved = resolveOuterSpacing(settings, viewport);
  // Left and right must be fully independent by default (e.g. a fresh
  // module's 0/0 desktop values must NOT be treated as "linked" just
  // because they happen to be equal) — only an explicit user check on
  // the "Link left/right values" box below links them.
  const [linked, setLinked] = useState(false);

  // Applies one or both sides in a SINGLE onChange call — two sequential
  // calls would each read the same stale `settings` closure and the
  // second would clobber the first (both compute their patch from the
  // pre-update desktop/mobile object), losing whichever side was
  // "linked" in. One combined patch avoids that race entirely.
  function applySides(sides: Partial<OuterSpacingSides>) {
    if (isMobile) {
      onChange({ outerSpacing: { ...settings.outerSpacing, mobile: { ...settings.outerSpacing.mobile, ...sides } } });
    } else {
      onChange({ outerSpacing: { ...settings.outerSpacing, desktop: { ...settings.outerSpacing.desktop, ...sides } } });
    }
  }

  function handleLeftChange(dimension: DimensionValue) {
    applySides(linked ? { left: dimension, right: dimension } : { left: dimension });
  }

  function handleRightChange(dimension: DimensionValue) {
    applySides(linked ? { left: dimension, right: dimension } : { right: dimension });
  }

  function resetSide(side: keyof OuterSpacingSides) {
    const nextMobile = { ...settings.outerSpacing.mobile };
    delete nextMobile[side];
    onChange({ outerSpacing: { ...settings.outerSpacing, mobile: nextMobile } });
  }

  const leftOverridden = isMobile && isMobileOuterSpacingOverridden(settings, 'left');
  const rightOverridden = isMobile && isMobileOuterSpacingOverridden(settings, 'right');
  const anyOverridden = leftOverridden || rightOverridden;

  return (
    <div className="properties-panel__field-group">
      <span className="properties-panel__field-group-label">
        {isMobile ? 'Mobile' : 'Desktop'}
      </span>
      <label className="properties-panel__field">
        <span>
          Left Spacer
          {isMobile && (leftOverridden ? ' (override)' : ' (inherited)')}
        </span>
        <DimensionControl value={resolved.left} allowedUnits={['px']} pxBounds={OUTER_SPACING_PX_BOUNDS} onChange={handleLeftChange} />
        {isMobile && leftOverridden && (
          <button type="button" className="properties-panel__inherit-reset" onClick={() => resetSide('left')}>
            Use Desktop value
          </button>
        )}
      </label>
      <label className="properties-panel__field">
        <span>
          Right Spacer
          {isMobile && (rightOverridden ? ' (override)' : ' (inherited)')}
        </span>
        <DimensionControl value={resolved.right} allowedUnits={['px']} pxBounds={OUTER_SPACING_PX_BOUNDS} onChange={handleRightChange} />
        {isMobile && rightOverridden && (
          <button type="button" className="properties-panel__inherit-reset" onClick={() => resetSide('right')}>
            Use Desktop value
          </button>
        )}
      </label>
      <label className="properties-panel__link-toggle">
        <input
          type="checkbox"
          checked={linked}
          onChange={(event) => {
            const nextLinked = event.target.checked;
            setLinked(nextLinked);
            if (nextLinked) applySides({ right: resolved.left });
          }}
        />
        <span>Link left/right values</span>
      </label>
      {isMobile && anyOverridden && (
        <button
          type="button"
          className="properties-panel__inherit-reset"
          onClick={() => onChange({ outerSpacing: { ...settings.outerSpacing, mobile: {} } })}
        >
          Use Desktop values for all
        </button>
      )}
      <p className="properties-panel__hint">
        Set both to 0 for a full-width module.
      </p>
    </div>
  );
}
