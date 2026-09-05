import { describe, expect, it } from 'vitest';
import { isProposalCorrection, matchProposalResponse } from './proposalResponseMatcher';

describe('matchProposalResponse — confirmation (English)', () => {
  it.each([
    'Yes, apply it.',
    'yes',
    'yep',
    'Looks good, do it.',
    'Sounds good.',
    'Apply it.',
    'Apply that.',
    'Apply both.',
    'go ahead',
    'Sure, apply it.',
  ])('matches %j as "confirm"', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('confirm');
  });
});

describe('matchProposalResponse — rejection (English)', () => {
  it.each([
    'Never mind.',
    'never mind',
    'Forget it.',
    "Don't make those changes.",
    "Don't do that.",
    'Skip that.',
    'Leave it.',
  ])('matches %j as "reject"', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('reject');
  });
});

describe('matchProposalResponse — no false positive from a bare "no" (language-detection collision check)', () => {
  it('"No, don\'t do that." still classifies as English reject, not misdetected as Spanish', () => {
    expect(matchProposalResponse("No, don't do that.")).toBe('reject');
  });
});

describe('matchProposalResponse — explanation-seeking gate (a question is never a confirmation/rejection)', () => {
  it.each([
    'Why did you choose that?',
    'What will this change?',
    'Will this break Outlook?',
    'Does this apply to the footer too?',
  ])('does NOT match %j', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('none');
  });
});

describe('matchProposalResponse — negative cases (ordinary commands must never misfire)', () => {
  it.each([
    'make the button green',
    'add a divider',
    'increase the padding to 20px',
    '',
    '   ',
  ])('does NOT match %j', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('none');
  });
});

describe('matchProposalResponse — Hindi (Devanagari)', () => {
  it('matches हाँ as confirm', () => {
    expect(matchProposalResponse('हाँ')).toBe('confirm');
  });
  it('matches लागू करो as confirm', () => {
    expect(matchProposalResponse('लागू करो')).toBe('confirm');
  });
  it('matches रहने दो as reject', () => {
    expect(matchProposalResponse('रहने दो')).toBe('reject');
  });
});

describe('matchProposalResponse — Hindi/Hinglish (romanized)', () => {
  it.each(['haan', 'theek hai', 'kar do', 'apply karo'])('matches %j as confirm', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('confirm');
  });
  it.each(['rehne do', 'cancel karo', 'mat karo'])('matches %j as reject', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('reject');
  });
  it('is case-insensitive for romanized Hinglish', () => {
    expect(matchProposalResponse('Cancel Karo')).toBe('reject');
    expect(matchProposalResponse('APPLY KARO')).toBe('confirm');
  });
});

describe('matchProposalResponse — Spanish', () => {
  it.each(['sí', 'aplícalo', 'hazlo', 'se ve bien'])('matches %j as confirm', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('confirm');
  });
  it.each(['olvídalo', 'déjalo', 'no lo hagas'])('matches %j as reject', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('reject');
  });
});

describe('isProposalCorrection (D4-E3K §3/§6/§9)', () => {
  it.each([
    'Actually make it blue.',
    'actually, make it blue',
    'Instead, use 16px.',
    'No, I meant the footer CTA.',
    'not that one, the other button',
    'Wait, I meant the second button.',
  ])('recognizes %j as a correction marker', (phrase) => {
    expect(isProposalCorrection(phrase)).toBe(true);
  });

  it.each([
    'make the button green',
    'increase the padding to 20px',
    'yes, apply it',
    'never mind',
    '',
  ])('does NOT treat %j as a correction marker', (phrase) => {
    expect(isProposalCorrection(phrase)).toBe(false);
  });

  it('recognizes Hindi/Hinglish, Spanish, and German correction markers', () => {
    expect(isProposalCorrection('actually footer button ko hi karo')).toBe(true);
    expect(isProposalCorrection('en realidad, hazlo azul')).toBe(true);
    expect(isProposalCorrection('eigentlich, mach es blau')).toBe(true);
  });
});

describe('matchProposalResponse — German', () => {
  it.each(['ja', 'mach das', 'wende an', 'sieht gut aus'])('matches %j as confirm', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('confirm');
  });
  it.each(['vergiss es', 'lass es', 'abbrechen'])('matches %j as reject', (phrase) => {
    expect(matchProposalResponse(phrase)).toBe('reject');
  });
});
