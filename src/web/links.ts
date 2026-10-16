/** Until the documentation site exists, "?" opens the README (docs/design.md). */
export const DOCUMENTATION_URL =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja')
    ? 'https://github.com/atskimura/sfbench/blob/main/README.ja.md'
    : 'https://github.com/atskimura/sfbench#readme'

export const GITHUB_URL = 'https://github.com/atskimura/sfbench'
