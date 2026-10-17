// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./apiClient.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apiClient.ts')>()
  return { ...actual, api: { settings: vi.fn(), saveSettings: vi.fn(), aiTest: vi.fn() } }
})

const { api, ApiRequestError } = await import('./apiClient.ts')
const { AppProvider } = await import('./state/AppContext.tsx')
const { SettingsDialog } = await import('./components/SettingsDialog.tsx')
const { t } = await import('./i18n/i18n.ts')
const mocked = vi.mocked(api)

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}

const base = { omitNamespace: true, requestTimeoutSeconds: 120 }

function open(onClose = vi.fn()) {
  render(
    <AppProvider>
      <SettingsDialog onClose={onClose} />
    </AppProvider>,
  )
  return onClose
}

beforeEach(() => {
  mocked.saveSettings.mockImplementation(async (s) => ({ ...base, ...(s as object) }) as never)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('AI settings', () => {
  it('leaves the AI not set up when only other settings are saved', async () => {
    mocked.settings.mockResolvedValue(base)
    const onClose = open()
    await userEvent.click(await screen.findByLabelText(t.settingsOmitNamespace, { exact: false }))
    await userEvent.click(screen.getByRole('button', { name: t.save }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocked.saveSettings.mock.calls[0][0]).not.toHaveProperty('ai')
  })

  it('saves the provider, model and key, and needs a model', async () => {
    mocked.settings.mockResolvedValue(base)
    open()
    await userEvent.click(await screen.findByRole('radio', { name: 'Anthropic' }))
    expect((screen.getByRole('button', { name: t.save }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(t.aiModel), 'claude-x')
    await userEvent.type(screen.getByLabelText(t.aiKey), 'sk-ant')
    await userEvent.click(screen.getByRole('button', { name: t.save }))
    await waitFor(() => expect(mocked.saveSettings).toHaveBeenCalled())
    expect(mocked.saveSettings.mock.calls[0][0].ai).toEqual({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant' })
  })

  it('shows a saved key only for its provider, and can remove it', async () => {
    mocked.settings.mockResolvedValue({ ...base, ai: { provider: 'anthropic', model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' } })
    open()
    expect((await screen.findByLabelText(t.aiKey)).getAttribute('placeholder')).toBe(t.aiKeySaved)
    await userEvent.click(screen.getByRole('radio', { name: 'OpenAI' }))
    expect(screen.getByText(t.aiKeyOtherProvider)).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'Anthropic' }))
    await userEvent.click(screen.getByRole('button', { name: t.aiKeyClear }))
    await userEvent.click(screen.getByRole('button', { name: t.save }))
    await waitFor(() => expect(mocked.saveSettings).toHaveBeenCalled())
    expect(mocked.saveSettings.mock.calls[0][0].ai).toEqual({ provider: 'anthropic', model: 'claude-x', apiKey: null })
  })

  it('tests the unsaved settings and shows the result', async () => {
    mocked.settings.mockResolvedValue({ ...base, ai: { provider: 'anthropic', model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' } })
    mocked.aiTest.mockResolvedValueOnce({ elapsedMs: 1234 }).mockRejectedValueOnce(new ApiRequestError(502, 'AI_ERROR', 'invalid x-api-key'))
    open()
    const button = await screen.findByRole('button', { name: t.aiTest })
    await userEvent.clear(screen.getByLabelText(t.aiModel))
    await userEvent.type(screen.getByLabelText(t.aiModel), 'claude-y')
    await userEvent.click(button)
    expect(await screen.findByText(t.aiTestOk('1.2'))).toBeTruthy()
    expect(mocked.aiTest.mock.calls[0][0]).toEqual({ ai: { provider: 'anthropic', model: 'claude-y' } })
    await userEvent.click(screen.getByRole('button', { name: t.aiTest }))
    expect(await screen.findByText('invalid x-api-key')).toBeTruthy()
  })

  it('drops a test still running when the settings change', async () => {
    mocked.settings.mockResolvedValue({ ...base, ai: { provider: 'anthropic', model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' } })
    let finish: (v: { elapsedMs: number }) => void = () => {}
    mocked.aiTest.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    open()
    await userEvent.click(await screen.findByRole('button', { name: t.aiTest }))
    expect(screen.getByRole('button', { name: t.aiTesting })).toBeTruthy()
    await userEvent.type(screen.getByLabelText(t.aiModel), '-2')
    expect(screen.getByRole('button', { name: t.aiTest })).toBeTruthy()
    finish({ elapsedMs: 1000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(t.aiTestOk('1.0'))).toBeNull()
  })
})

describe('loading and saving', () => {
  it('cannot save until the settings load, and saves once and stays open while saving', async () => {
    let loaded: (s: typeof base) => void = () => {}
    mocked.settings.mockImplementationOnce(() => new Promise((resolve) => (loaded = resolve)))
    let saved: (s: typeof base) => void = () => {}
    mocked.saveSettings.mockImplementationOnce(() => new Promise((resolve) => (saved = resolve)))
    const onClose = open()
    const save = screen.getByRole('button', { name: t.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    loaded(base)
    await waitFor(() => expect(save.disabled).toBe(false))
    await userEvent.click(save)
    expect(save.disabled).toBe(true)
    await userEvent.click(save)
    await userEvent.click(screen.getByRole('button', { name: t.cancel }))
    expect(onClose).not.toHaveBeenCalled()
    saved(base)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocked.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('tells and closes when the settings cannot be loaded', async () => {
    mocked.settings.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'cannot read settings'))
    const onClose = open()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
