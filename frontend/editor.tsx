import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { App } from '@modelcontextprotocol/ext-apps';
import type { Setting, SettingNumber } from '../shared/settings';
import './style.css';

function HelloWorld() {
  const embedded = window.parent !== window;

  const [message, setMessage] = createSignal('Hello, World');
  const [number, setNumber] = createSignal<SettingNumber>(1);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(true);

  async function save(value: SettingNumber) {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: value }),
      });

      if (!response.ok) throw new Error('Could not save setting.');

      const setting: Setting = await response.json();

      setNumber(setting.number);
      setMessage(`Hello, World ${setting.number}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save setting.');
    } finally {
      setBusy(false);
    }
  }

  onMount(async () => {
    try {
      if (embedded) {
        const app = new App({ name: 'hello-world', version: '1.0.0' });

        app.ontoolresult = (result) => {
          const message = result.structuredContent?.message;

          if (typeof message === 'string') setMessage(message);
        };

        await app.connect();
      } else {
        const response = await fetch('/api/setting');

        if (!response.ok) throw new Error('Could not load setting.');

        const setting: Setting = await response.json();

        setNumber(setting.number);
        setMessage(`Hello, World ${setting.number}`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not initialize.');
    } finally {
      setBusy(false);
    }
  });

  return (
    <main>
      <h1>{message()}</h1>

      {!embedded && (
        <label>
          Setting number{' '}
          <select
            value={number()}
            disabled={busy()}
            onChange={(event) => void save(Number(event.currentTarget.value) as SettingNumber)}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
      )}

      {error() && <p role="alert">{error()}</p>}
    </main>
  );
}

render(() => <HelloWorld />, document.getElementById('root')!);
