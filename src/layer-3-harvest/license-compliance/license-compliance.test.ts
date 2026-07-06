import { describe, it, expect } from 'vitest';
import { classifyLicense, stackVerdict, ACCEPTED_LICENSES, type ComplianceResult } from './license-compliance.js';

// License & Compliance Engine (Module 10). Pure-logic: classification is a pure function of the
// license text (+ optional badge), so no DB.

// Minimal but signature-bearing license texts.
const TEXT = {
  'Apache-2.0': 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/',
  MIT: 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software...',
  'BSD-2-Clause': 'BSD 2-Clause License\nRedistribution and use in source and binary forms, with or without modification, are permitted...',
  'BSD-3-Clause': 'BSD 3-Clause License\nRedistribution and use ...\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products...',
  'MPL-2.0': 'Mozilla Public License Version 2.0\n1. Definitions...',
  PostgreSQL: 'PostgreSQL License\nPortions Copyright (c) 1996-2024, PostgreSQL Global Development Group. Permission to use, copy, modify, and distribute this software...',
  ISC: 'ISC License\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice...',
  'BlueOak-1.0.0': 'Blue Oak Model License 1.0.0\nVersion 1.0.0\nPurpose...',
  GPL: 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007',
  LGPL: 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007',
  AGPL: 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007',
  SSPL: 'Server Side Public License\nVERSION 1, October 16, 2018',
  BSL: 'License text copyright (c) 2020 MariaDB Corporation Ab.\nBusiness Source License 1.1\nLicensed Work: ...\nAdditional Use Grant: ...',
  Unlicense: 'This is free and unencumbered software released into the public domain.\nAnyone is free to copy, modify, publish, use...',
};

describe('License Compliance — rejected licenses', () => {
  for (const [name, text] of [['BSL', TEXT.BSL], ['SSPL', TEXT.SSPL], ['GPL', TEXT.GPL], ['AGPL', TEXT.AGPL]] as const) {
    it(`${name} ⇒ REJECT`, () => {
      expect(classifyLicense({ text }).decision).toBe('REJECT');
    });
  }
});

describe('License Compliance — accepted allowlist', () => {
  for (const id of ACCEPTED_LICENSES) {
    it(`${id} ⇒ ACCEPT`, () => {
      const r = classifyLicense({ text: TEXT[id] });
      expect(r.decision).toBe('ACCEPT');
      expect(r.detected).toBe(id);
    });
  }
});

describe('License Compliance — needs-review / unverifiable', () => {
  it('off-allowlist permissive (Unlicense) ⇒ NEEDS_REVIEW (not silent accept)', () => {
    const r = classifyLicense({ text: TEXT.Unlicense });
    expect(r.decision).toBe('NEEDS_REVIEW');
    expect(r.detected).toBe('Unlicense');
  });
  it('empty / unverifiable ⇒ REJECT', () => {
    expect(classifyLicense({}).decision).toBe('REJECT');
    expect(classifyLicense({ text: '   ' }).decision).toBe('REJECT');
  });
  it('badge-only (no text) ⇒ NEEDS_REVIEW (must verify from the actual text)', () => {
    expect(classifyLicense({ declaredSpdx: 'MIT' }).decision).toBe('NEEDS_REVIEW');
  });
});

describe('License Compliance — text beats badge (immudb-BSL regression)', () => {
  it('codenotary/immudb: badge "Apache-2.0", actual text BSL ⇒ REJECT, text wins', () => {
    const r = classifyLicense({ text: TEXT.BSL, declaredSpdx: 'Apache-2.0', source: 'codenotary/immudb' });
    expect(r.decision).toBe('REJECT');
    expect(r.detected).toBe('BSL');
    expect(r.badgeContradiction).toBe(true);
    expect(r.reason).toMatch(/text wins/i);
  });
  it('a NOASSERTION badge with BSL text is still REJECT (no contradiction flagged)', () => {
    const r = classifyLicense({ text: TEXT.BSL, declaredSpdx: 'NOASSERTION' });
    expect(r.decision).toBe('REJECT');
    expect(r.badgeContradiction).toBe(false);
  });
});

describe('License Compliance — stack verdicts', () => {
  const cls = (text: string): ComplianceResult => classifyLicense({ text });
  it('all-allowlisted stack ⇒ Clean', () => {
    const v = stackVerdict([cls(TEXT['Apache-2.0']), cls(TEXT.MIT), cls(TEXT.PostgreSQL)]);
    expect(v.verdict).toBe('Clean');
  });
  it('a stack with one rejected component ⇒ Collision-blocking', () => {
    const v = stackVerdict([cls(TEXT['Apache-2.0']), cls(TEXT.BSL)]);
    expect(v.verdict).toBe('Collision-blocking');
  });
  it('a stack with a needs-review (no rejects) ⇒ Collision-resolvable', () => {
    const v = stackVerdict([cls(TEXT.MIT), cls(TEXT.Unlicense)]);
    expect(v.verdict).toBe('Collision-resolvable');
  });
});
