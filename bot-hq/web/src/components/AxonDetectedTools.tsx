import { useEffect, useRef, useState } from 'react';
import { nativeRequest } from '../lib/axon-native';

/** The tools already installed on this Mac.
 *
 * Detection only reads the file system and asks each tool for its own
 * version. Nothing is installed, updated or run beyond that, and no tool is
 * ever launched on the owner's behalf.
 */
export function AxonDetectedTools({ native }: { native: any }) {
  const [tools, setTools] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const mounted = useRef(true);

  async function load() {
    setError('');
    try {
      const result = await nativeRequest('detectTools');
      if (!mounted.current) return;
      setTools(Array.isArray(result?.tools) ? result.tools : []);
    } catch (cause) {
      if (!mounted.current) return;
      setTools([]);
      setError(String((cause as Error)?.message ?? cause));
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (native?.toolDiscovery) void load();
    return () => { mounted.current = false; };
  }, [native?.toolDiscovery]);

  async function use(tool: any) {
    setBusy(tool.id);
    setError('');
    try {
      await nativeRequest('selectModelRoute', { toolId: tool.id });
      if (!mounted.current) return;
      // The server restarts to read the new route, so the page must reload.
      window.setTimeout(() => window.location.reload(), 900);
    } catch (cause) {
      if (!mounted.current) return;
      setError(String((cause as Error)?.message ?? cause));
    } finally {
      if (mounted.current) setBusy('');
    }
  }

  if (!native?.toolDiscovery) {
    return <section className="ax-card"><h2>Detected tools</h2>
      <p className="ax-notice">Detecting the tools on this Mac needs the installed AxonCROS app. A browser cannot read this Mac's tools.</p>
    </section>;
  }

  return <section className="ax-card"><h2>Detected tools on this Mac</h2>
    <p>AxonCROS looks for the tools you already have and shows you where they live. It never installs or updates anything.</p>
    {error && <p className="ax-error" role="alert">{error}</p>}
    {tools === null && <p className="ax-muted">Checking this Mac…</p>}
    {tools !== null && !tools.length && <p className="ax-muted">No known tools were found in your PATH or in your installed applications.</p>}
    {tools?.length ? <div className="ax-list">{tools.map(tool => <div className="ax-list-row" key={tool.id}>
      <div><strong>{tool.name}</strong><small>{tool.path}</small>{tool.version && <small>Version {tool.version}</small>}</div>
      <span className="ax-tag">{tool.role}</span>
      {tool.route
        ? <button disabled={busy === tool.id} onClick={() => void use(tool)}>{busy === tool.id ? 'Switching…' : 'Use as model route'}</button>
        : <span className="ax-muted">Not a model route</span>}
    </div>)}</div> : null}
    <p className="ax-muted">Using a tool as the model route rewrites one private setting and restarts the local server. Your conversations, files and connections are untouched.</p>
  </section>;
}
