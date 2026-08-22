import { describe, expect, it } from 'vitest';
import { detectCompatibilityImpact } from './platformCompatibility';

describe('detectCompatibilityImpact', () => {
  it('reports no impact for plain HTML with no tokens', () => {
    expect(detectCompatibilityImpact('<p>Hello world</p>', 'generic')).toEqual([]);
  });

  it('reports percent-token impact when switching to a platform that does not support it', () => {
    const html = '<p>Hi %%FirstName%%, welcome %%FirstName%% again</p>';
    const impacts = detectCompatibilityImpact(html, 'generic');
    expect(impacts).toHaveLength(1);
    expect(impacts[0].family).toBe('percent');
    expect(impacts[0].count).toBe(2);
  });

  it('reports no percent-token impact when the target platform natively supports it', () => {
    const html = '<p>Hi %%FirstName%%</p>';
    expect(detectCompatibilityImpact(html, 'sfmc')).toEqual([]);
    expect(detectCompatibilityImpact(html, 'pardot')).toEqual([]);
  });

  it('reports curly-token impact when switching to a platform that does not support it', () => {
    const html = '<p>Hi {{lead.First Name}}</p>';
    const impacts = detectCompatibilityImpact(html, 'generic');
    expect(impacts).toHaveLength(1);
    expect(impacts[0].family).toBe('curly');
    expect(impacts[0].count).toBe(1);
  });

  it('reports no curly-token impact when the target platform natively supports it', () => {
    const html = '<p>Hi {{ contact.firstname }}</p>';
    expect(detectCompatibilityImpact(html, 'marketo')).toEqual([]);
    expect(detectCompatibilityImpact(html, 'hubspot')).toEqual([]);
  });

  it('reports both families when both are present and unsupported', () => {
    const html = '<p>%%FirstName%% and {{lead.Email}}</p>';
    const impacts = detectCompatibilityImpact(html, 'generic');
    expect(impacts).toHaveLength(2);
  });

  it('matches HubL block tags as curly-family tokens', () => {
    const html = '<p>{% if contact.lifecyclestage == "customer" %}VIP{% endif %}</p>';
    const impacts = detectCompatibilityImpact(html, 'generic');
    expect(impacts.some((impact) => impact.family === 'curly')).toBe(true);
  });
});
