import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailCanvas } from './EmailCanvas';
import { createModule } from './moduleFactory';
import type { EmailModule } from './edm';

// Layout Background scope correction — the Builder Canvas WYSIWYG fix.
// The generated-HTML side (registryCore.tsx's wrapWithModuleBackground,
// see htmlRenderer.test.ts's "Layout Background scope" describe block)
// wraps the FULL outer-spacer-inclusive module row in ONE background
// wrapper. This mirrors that on the canvas: `.email-canvas__module-outer-row`
// (the sibling of both spacer regions and the content div) carries the
// SAME backgroundColor/backgroundImage, so it naturally shows through the
// transparent spacer regions, the content div's own padding, and the
// LayoutCanvasModule's transparent column gutters — never painted
// independently onto the spacer regions themselves.
function noopHandlers() {
  return {
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onReorder: vi.fn(),
    onDropNewModule: vi.fn(),
    onDropSavedModule: vi.fn(),
    onSaveModule: vi.fn(),
    onAddFirstModule: vi.fn(),
    onSelectColumn: vi.fn(),
    onSelectNestedModule: vi.fn(),
    onInsertNestedModule: vi.fn(),
    onInsertNestedSavedModule: vi.fn(),
    onReorderNested: vi.fn(),
    onMoveNested: vi.fn(),
    onDuplicateNested: vi.fn(),
    onDeleteNested: vi.fn(),
  };
}

function renderCanvas(module: EmailModule, width = 700) {
  const { container } = render(
    <EmailCanvas
      modules={[module]}
      selectedModuleId={null}
      width={width}
      viewMode="desktop"
      zoomLevel={100}
      savedModules={[]}
      activeColumn={null}
      {...noopHandlers()}
    />,
  );
  return container;
}

function outerRowStyle(container: HTMLElement) {
  return container.querySelector<HTMLElement>('.email-canvas__module-outer-row')?.style;
}

function spacerRegionStyles(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('.email-canvas__module-spacer-region'));
}

function withOuterSpacing(layout: EmailModule, left: number, right: number) {
  layout.settings = {
    ...layout.settings,
    outerSpacing: { desktop: { left: { value: left, unit: 'px' }, right: { value: right, unit: 'px' } }, mobile: {} },
  };
}

describe('EmailCanvas — Layout Background scope (WYSIWYG fix)', () => {
  it('a Layout module with backgroundColor set: the color is applied to the outer-row wrapper, not to the content div or a spacer region', () => {
    const layout = createModule('layout-2col-50-50', 0);
    layout.settings = { ...layout.settings, backgroundColor: '#D7C6C6' };
    const container = renderCanvas(layout);
    expect(outerRowStyle(container)?.backgroundColor).toBe('rgb(215, 198, 198)');
  });

  it('a Layout module with Outer Spacer Columns AND backgroundColor: the color is on the shared outer-row wrapper, so it covers the spacer regions too — never duplicated onto the spacer divs themselves', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withOuterSpacing(layout, 40, 40);
    layout.settings = { ...layout.settings, backgroundColor: '#0082AD' };
    const container = renderCanvas(layout);
    expect(outerRowStyle(container)?.backgroundColor).toBe('rgb(0, 130, 173)');
    const spacers = spacerRegionStyles(container);
    expect(spacers).toHaveLength(2);
    for (const spacer of spacers) {
      expect(spacer.style.backgroundColor).toBe('');
    }
  });

  it('a Layout module with backgroundImage set: the outer-row wrapper gets background-image/size/position, matching the renderer\'s own CSS technique', () => {
    const layout = createModule('layout-1col', 0);
    layout.settings = { ...layout.settings, backgroundImage: 'https://cdn.example.com/parent-bg.jpg' };
    const container = renderCanvas(layout);
    const style = outerRowStyle(container);
    // jsdom normalizes url() quoting to double quotes when reflecting the
    // inline style back — the source style object we set uses single
    // quotes (matching the HTML renderer's own url('...') convention),
    // this is purely a jsdom serialization detail.
    expect(style?.backgroundImage).toBe('url("https://cdn.example.com/parent-bg.jpg")');
    expect(style?.backgroundSize).toBe('cover');
    // jsdom normalizes the single-axis shorthand 'center' to the
    // two-axis longhand 'center center' when reflecting it back.
    expect(style?.backgroundPosition).toBe('center center');
  });

  it('a Layout module with both backgroundColor and backgroundImage: both are present on the outer-row wrapper (color as fallback underneath)', () => {
    const layout = createModule('layout-1col', 0);
    layout.settings = {
      ...layout.settings, backgroundColor: '#333333', backgroundImage: 'https://cdn.example.com/fallback.jpg',
    };
    const container = renderCanvas(layout);
    const style = outerRowStyle(container);
    expect(style?.backgroundColor).toBe('rgb(51, 51, 51)');
    expect(style?.backgroundImage).toBe('url("https://cdn.example.com/fallback.jpg")');
  });

  it('a Layout module with NEITHER backgroundColor nor backgroundImage set: the outer-row wrapper carries no background style at all (unchanged from before this fix)', () => {
    const layout = createModule('layout-2col-50-50', 0);
    const container = renderCanvas(layout);
    const style = outerRowStyle(container);
    expect(style?.backgroundColor).toBe('');
    expect(style?.backgroundImage).toBe('');
  });

  it('a non-Layout module (no columns) never gets a background applied, even if the generic settings field were somehow populated', () => {
    const text = createModule('text', 0);
    text.settings = { ...text.settings, backgroundColor: '#76C043' };
    const container = renderCanvas(text);
    const style = outerRowStyle(container);
    expect(style?.backgroundColor).toBe('');
  });
});
