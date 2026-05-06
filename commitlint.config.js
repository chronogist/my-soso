/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'revert'],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
