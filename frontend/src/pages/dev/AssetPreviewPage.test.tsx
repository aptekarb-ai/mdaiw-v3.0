import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssetPreviewPage } from './AssetPreviewPage';

describe('AssetPreviewPage', () => {
  it('renders all 60 icons and 8 illustrations', () => {
    render(<AssetPreviewPage />);
    const iconGrid = screen.getByTestId('icon-grid');
    const imageGrid = screen.getByTestId('image-grid');
    expect(iconGrid.children.length).toBe(60);
    expect(imageGrid.children.length).toBe(8);
  });
});
