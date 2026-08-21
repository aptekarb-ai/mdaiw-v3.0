// Locally defined Monaco language for AMPscript — never loaded from a CDN.
// Registers syntax highlighting (Monarch tokenizer) and basic folding for
// %%[ ]%% blocks, IF/ENDIF, and FOR/NEXT. This is presentation only; it has
// no bearing on the real AMPscript static analysis, which always runs
// server-side (see backend/landingpages/validation/ampscript/).
import type * as monaco from 'monaco-editor';

const AMPSCRIPT_KEYWORDS = [
  'VAR', 'SET', 'IF', 'THEN', 'ELSEIF', 'ELSE', 'ENDIF',
  'FOR', 'TO', 'DO', 'NEXT', 'WHILE', 'ENDWHILE',
];

let registered = false;

export function registerAmpscriptLanguage(monacoInstance: typeof monaco) {
  if (registered) return;
  registered = true;

  monacoInstance.languages.register({ id: 'ampscript' });

  monacoInstance.languages.setLanguageConfiguration('ampscript', {
    comments: { blockComment: ['/*', '*/'] },
    brackets: [['(', ')']],
    folding: {
      markers: {
        start: /^\s*(%%\[|IF\b.*THEN\s*$|FOR\b.*DO\s*$|WHILE\b.*DO\s*$)/i,
        end: /^\s*(\]%%|ENDIF\b|NEXT\b|ENDWHILE\b)/i,
      },
    },
  });

  monacoInstance.languages.setMonarchTokensProvider('ampscript', {
    ignoreCase: true,
    keywords: AMPSCRIPT_KEYWORDS,
    tokenizer: {
      root: [
        [/%%\[/, 'delimiter.ampscript.block'],
        [/\]%%/, 'delimiter.ampscript.block'],
        [/%%=/, 'delimiter.ampscript.inline'],
        [/=%%/, 'delimiter.ampscript.inline'],
        [/\/\*/, 'comment', '@comment'],
        [/@[a-zA-Z_]\w*/, 'variable'],
        [
          /[a-zA-Z_]\w*/,
          { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
        ],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [/[()]/, '@brackets'],
        [/,/, 'delimiter'],
        [/[=<>!+\-*/]/, 'operator'],
        [/[ \t\r\n]+/, 'white'],
      ],
      comment: [
        [/[^*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  });
}
