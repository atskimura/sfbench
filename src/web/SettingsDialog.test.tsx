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
})
