import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as ui from '../ui';
import { ComponentGallery } from './ComponentGallery';
import { PRIMITIVE_SECTIONS } from './gallerySections';

describe('ComponentGallery', () => {
  it('renders every section without React warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ComponentGallery />);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('links each contents entry to its section', () => {
    const { container } = render(<ComponentGallery />);
    const links = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link');
    expect(links.length).toBeGreaterThan(PRIMITIVE_SECTIONS.length);
    for (const link of links) {
      const section = container.querySelector(link.getAttribute('href')!);
      expect(section, link.textContent!).not.toBeNull();
      expect(section!.querySelector(':scope > h2')).toHaveTextContent(link.textContent!);
    }
  });

  // Each primitive must be on show for review: a new one without a section fails here.
  it.each(Object.keys(ui).filter((name) => /^[A-Z]/.test(name) || name === 'toast'))('has a section showing %s', (name) => {
    expect(PRIMITIVE_SECTIONS.some((section) => section.split(' / ').includes(name))).toBe(true);
  });
});
