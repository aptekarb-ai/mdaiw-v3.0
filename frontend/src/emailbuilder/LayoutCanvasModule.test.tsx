import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayoutCanvasModule } from './LayoutCanvasModule';
import { createModule } from './moduleFactory';
import type { EmailModule, EmailModuleType } from './edm';

// Front-Stage Width Contract correction — the builder canvas must render
// the SAME resolved pixel widths the Properties panel displays and the
// real HTML renderer emits (see registryCore.tsx's
// computeLayoutAvailableWidthPx / layoutModel.ts's
// resolveColumnPixelWidths — the one shared width-resolution chain).
// jsdom has no real CSS layout engine, so getBoundingClientRect() always
// reports 0 here regardless of any style applied — these tests instead
// assert the INLINE STYLE VALUES React actually put on the DOM (the
// deterministic INPUT to layout), which jsdom preserves correctly. Real
// getBoundingClientRect()/computed-layout verification against an actual
// browser box model is done separately, in Live Chrome (see this turn's
// implementation report).
function noopHandlers() {
  return {
    onSelectColumn: vi.fn(),
    onSelectNestedModule: vi.fn(),
    onInsertNewModule: vi.fn(),
    onInsertSavedModule: vi.fn(),
    onReorderNested: vi.fn(),
    onMoveNested: vi.fn(),
    onDuplicateNested: vi.fn(),
    onDeleteNested: vi.fn(),
  };
}

function renderLayout(layout: EmailModule, documentWidth: number, viewport: 'desktop' | 'mobile' = 'desktop') {
  const { container } = render(
    <LayoutCanvasModule
      layout={layout}
      viewport={viewport}
      canvasWidth={viewport === 'mobile' ? 375 : documentWidth}
      documentWidth={documentWidth}
      selectedModuleId={null}
      activeColumnId={null}
      savedModules={[]}
      {...noopHandlers()}
    />,
  );
  return container;
}

function columnStyles(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('.layout-canvas__column')).map((el) => ({
    flex: el.style.flex,
    width: el.style.width,
    maxWidth: el.style.maxWidth,
  }));
}

function containerGap(container: HTMLElement) {
  return container.querySelector<HTMLElement>('.layout-canvas')?.style.gap ?? '';
}

function withOuterSpacing(layout: EmailModule, left: number, right: number) {
  layout.settings = {
    ...layout.settings,
    outerSpacing: { desktop: { left: { value: left, unit: 'px' }, right: { value: right, unit: 'px' } }, mobile: {} },
  };
}

function withPadding(layout: EmailModule, left: number, right: number, top = 0, bottom = 0) {
  layout.settings = { ...layout.settings, desktop: { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left } };
}

describe('LayoutCanvasModule — Front-Stage Width Contract (rendered DIV geometry inputs)', () => {
  it('700px / outer 40-40 / 5 columns 20-20-20-20-20 / gutter 20: every column renders as exactly 108px, gap 20px', () => {
    const layout = createModule('layout-5col', 0);
    withOuterSpacing(layout, 40, 40);
    layout.settings = { ...layout.settings, columnGutterPx: 20 };
    const container = renderLayout(layout, 700);

    expect(containerGap(container)).toBe('20px');
    const styles = columnStyles(container);
    expect(styles).toHaveLength(5);
    for (const s of styles) {
      expect(s.flex).toBe('0 0 108px');
      expect(s.width).toBe('108px');
      expect(s.maxWidth).toBe('108px');
    }
    // Never the old percentage shape.
    expect(styles.some((s) => s.flex.includes('%'))).toBe(false);
  });

  it('700px / outer 20-20 / 60-40 / gutter 30: columns render as 378px + 252px', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    expect(styles[0].width).toBe('378px');
    expect(styles[1].width).toBe('252px');
    expect(containerGap(container)).toBe('30px');
  });

  it('700px / outer 20-20 / padding 15-15 / 60-40 / gutter 30: columns render as 360px + 240px (the exact worked example)', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    withPadding(layout, 15, 15);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    expect(styles[0].width).toBe('360px');
    expect(styles[1].width).toBe('240px');
  });

  it.each<[EmailModuleType, number]>([['layout-3col', 3], ['layout-4col', 4], ['layout-5col', 5], ['layout-6col', 6]])(
    '%s: every rendered column width sums with its gutters to the full available width',
    (type, count) => {
      const layout = createModule(type, 0);
      withOuterSpacing(layout, 10, 10);
      layout.settings = { ...layout.settings, columnGutterPx: 6 };
      const container = renderLayout(layout, 700);
      const styles = columnStyles(container);
      expect(styles).toHaveLength(count);
      const sum = styles.reduce((total, s) => total + Number(s.width.replace('px', '')), 0);
      // P = 700 - 10 - 10 = 680; sum(columns) + gutterTotal = 680.
      expect(sum + 6 * (count - 1)).toBe(680);
    },
  );

  it('asymmetric ratios (70/30) render proportionally distinct column widths', () => {
    const layout = createModule('layout-2col-70-30', 0);
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    expect(styles[0].width).toBe('490px');
    expect(styles[1].width).toBe('210px');
  });

  it('asymmetric outer spacers (10 left, 50 right) narrow the parent correctly', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withOuterSpacing(layout, 10, 50);
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    // P = 700 - 10 - 50 = 640, split 50/50 -> 320 + 320.
    expect(styles[0].width).toBe('320px');
    expect(styles[1].width).toBe('320px');
  });

  it('asymmetric left/right padding (10 left, 50 right) narrows the content region correctly', () => {
    const layout = createModule('layout-2col-50-50', 0);
    withPadding(layout, 10, 50);
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    // C = 700 - 10 - 50 = 640, split 50/50 -> 320 + 320.
    expect(styles[0].width).toBe('320px');
    expect(styles[1].width).toBe('320px');
  });

  it('zero gutter: columns fill the full content region and the gap style is 0px', () => {
    const layout = createModule('layout-2col-60-40', 0);
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    expect(styles[0].width).toBe('420px');
    expect(styles[1].width).toBe('280px');
    expect(containerGap(container)).toBe('0px');
  });

  it('nested layout two levels deep: each level receives its actual resolved parent column width, never document.width or the mobile canvas emulation width', () => {
    const outer = createModule('layout-2col-50-50', 0); // 700 -> 350 + 350
    const middle = createModule('layout-2col-50-50', 0); // 350 -> 175 + 175
    const inner = createModule('layout-2col-50-50', 0); // 175 -> 88 + 87
    outer.columns![0].modules.push(middle);
    middle.columns![0].modules.push(inner);

    const outerContainer = renderLayout(outer, 700);
    expect(columnStyles(outerContainer).map((s) => s.width)).toEqual(['350px', '350px']);

    // The middle layout, rendered on its own with its ACTUAL resolved
    // parent width (350px, what the outer column really gives it) —
    // never document.width (700) and never a mobile emulation width.
    const middleContainer = renderLayout(middle, 350);
    expect(columnStyles(middleContainer).map((s) => s.width)).toEqual(['175px', '175px']);

    const innerContainer = renderLayout(inner, 175);
    expect(columnStyles(innerContainer).map((s) => s.width)).toEqual(['88px', '87px']);
  });

  it('Mobile stacking: stacked columns are 100% width, never a resolved Desktop px value, and use the stacked CSS class (independent gap)', () => {
    const layout = createModule('layout-2col-60-40', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 30 };
    const container = renderLayout(layout, 700, 'mobile');
    const styles = columnStyles(container);
    for (const s of styles) {
      expect(s.flex).toBe('0 0 100%');
      expect(s.maxWidth).toBe('100%');
      expect(s.width).toBe('');
    }
    // The stacked container never carries the Desktop gutter as a gap
    // style inline (the fixed CSS class handles stacked spacing).
    expect(containerGap(container)).toBe('');
    expect(container.querySelector('.layout-canvas--stacked')).toBeTruthy();
  });

  it('Mobile with "Stack columns on Mobile" explicitly off: columns still render the DESKTOP-resolved px widths (matching the real HTML, which applies zero Mobile CSS override in this case) — never rescaled to the 375px mobile canvas emulation width', () => {
    const layout = createModule('layout-2col-60-40', 0);
    layout.settings = { ...layout.settings, columnGutterPx: 30, mobileStack: false };
    const container = renderLayout(layout, 700, 'mobile');
    const styles = columnStyles(container);
    // Desktop math: A = 700 - 30 = 670; col0 = round(670*0.6) = 402, col1 = 268.
    expect(styles[0].width).toBe('402px');
    expect(styles[1].width).toBe('268px');
  });

  it('Parent background: rendering with a parent background configured does not disturb the column width contract', () => {
    const layout = createModule('layout-2col-60-40', 0);
    withOuterSpacing(layout, 20, 20);
    withPadding(layout, 15, 15);
    layout.settings = {
      ...layout.settings, columnGutterPx: 30, backgroundColor: '#002D38', backgroundImage: 'https://cdn.example.com/bg.jpg',
    };
    const container = renderLayout(layout, 700);
    const styles = columnStyles(container);
    expect(styles[0].width).toBe('360px');
    expect(styles[1].width).toBe('240px');
  });
});
