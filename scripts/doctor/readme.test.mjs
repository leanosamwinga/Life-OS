// A5: the README's command blocks paste straight into zsh (which, unlike bash, doesn't treat
// `# …` as a comment in an interactive shell) and use the Supabase CLI through npx.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const blocks = [...readme.matchAll(/```([a-z]*)\n([\s\S]*?)```/g)].map((m) => ({
  lang: m[1],
  lines: m[2].split('\n').filter((l) => l.trim()),
}));
const section = (title) => {
  const start = readme.indexOf(`## ${title}`);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
};
const CLI = /(^|[\s`(])supabase (start|stop|status|db|functions|secrets|test|gen|link)\b/;

describe('README commands', () => {
  it('has command blocks to check', () => {
    expect(blocks.filter((b) => b.lang === 'bash').length).toBeGreaterThan(5);
  });

  it('no command block contains a comment line or an inline # comment', () => {
    for (const b of blocks.filter((x) => x.lang === 'bash')) {
      for (const l of b.lines) {
        expect(l.trim().startsWith('#'), l).toBe(false);
        expect(/\s#\s/.test(l), l).toBe(false);
      }
    }
  });

  it('every Supabase CLI command is `npx supabase …`', () => {
    for (const b of blocks.filter((x) => x.lang === 'bash'))
      for (const l of b.lines)
        if (/\bsupabase /.test(l)) expect(l.trim(), l).toMatch(/^npx supabase /);
    for (const l of readme.split('\n')) {
      const m = CLI.exec(l);
      if (m) expect(l.slice(0, m.index + m[1].length).endsWith('npx '), l).toBe(true);
    }
  });

  it('"Run it on your phone" uses npx supabase throughout', () => {
    const phone = section('Run it on your phone');
    expect(phone).toContain('npx supabase start');
    expect(phone).toContain('npx supabase db reset');
    expect(phone).toContain('npx supabase functions serve --env-file supabase/functions/.env');
    expect(phone.replace(/npx supabase /g, '')).not.toMatch(CLI);
  });
});
