/** "?" opens the help in the UI's language (help/ in the repository). */
export const DOCUMENTATION_URL =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja')
    ? 'https://github.com/atskimura/sfbench/blob/main/help/ja/README.md'
    : 'https://github.com/atskimura/sfbench/blob/main/help/en/README.md'

export const GITHUB_URL = 'https://github.com/atskimura/sfbench'
