import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface ResearchSource {
  ref: string;
  documentId: string;
  title: string;
  path: string;
  sha256: string;
  startLine: number;
  endLine: number;
  text: string;
  cited: boolean;
}

interface ResearchDocument { id: string; title: string; path: string; sha256: string; lineCount: number }
interface DocumentText extends ResearchDocument { text: string }
interface ResearchCatalog { documents: ResearchDocument[]; snapshotId: string; notice: string }
export interface ResearchSelection { documentId?: string; expectedSha256?: string }

const SNAPSHOT_NOTICE = 'Packaged local research is a dated reference for drafts. It has not been checked against current law, lender rules or guidance.';

async function readResearch<T>(suffix = '', signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = window.setTimeout(abort, 20_000);
  try {
    const response = await fetch(`/api/local/research${suffix}`, { credentials: 'include', signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Local chat is locked. Reopen AxonCROS on this Mac to view its research.');
      if (response.status === 404) throw new Error('This document is not in the current research package. Any excerpt saved with a reply remains available beneath that reply.');
      throw new Error('The local research could not be loaded. Please try again.');
    }
    return await response.json() as T;
  } catch (cause) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('The local research request timed out. Please try again.');
    throw cause;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function SourceExcerpt({ source, onOpen }: { source: ResearchSource; onOpen: (selection: ResearchSelection) => void }) {
  return <details className="local-research-source">
    <summary>
      <span className="local-research-ref">[{source.ref}]</span>
      <span className="local-research-source__title"><strong>{source.title}</strong><small>Lines {source.startLine}–{source.endLine} · {source.cited ? 'Referenced in reply' : 'Provided, not referenced'}</small></span>
    </summary>
    <div className="local-research-source__content">
      <pre className="local-research-excerpt">{source.text}</pre>
      <div className="local-research-source__actions"><button className="link-btn" onClick={() => onOpen({ documentId: source.documentId, expectedSha256: source.sha256 })}>View packaged document</button><details className="local-research-metadata"><summary>Saved source details</summary><dl><dt>Path</dt><dd>{source.path}</dd><dt>SHA-256</dt><dd>{source.sha256}</dd></dl></details></div>
    </div>
  </details>;
}

/** Per-message excerpts are rendered directly from their saved response metadata. */
export function ReplyResearch({ sources = [], notice, warning, onOpen }: {
  sources?: ResearchSource[];
  notice?: string | null;
  warning?: string | null;
  onOpen: (selection: ResearchSelection) => void;
}) {
  if (!sources.length && !notice && !warning) return null;
  const otherSources = sources.filter((source) => !source.cited);
  return <section className="local-research-reply" aria-label="Sources for this reply">
    <div className="local-research-reply__heading"><Icon name="file" size={14} /><strong>Local research for this reply</strong></div>
    {warning && <p className="local-research-warning" role="status">{warning}</p>}
    <p className="local-research-reply__notice">{sources.length ? 'Saved local research; not live verification. Check the quoted passage before relying on a claim.' : notice || SNAPSHOT_NOTICE}</p>
    {sources.length > 0 && <details className="local-research-about"><summary>About these excerpts</summary><p>{notice || SNAPSHOT_NOTICE}</p><p>These exact excerpts were supplied to the assistant and saved with this reply. A reference does not verify that an excerpt supports a claim.</p></details>}
    {sources.filter((source) => source.cited).map((source) => <SourceExcerpt key={source.ref} source={source} onOpen={onOpen} />)}
    {otherSources.length > 0 && <details className="local-research-additional"><summary>{otherSources.length} other supplied {otherSources.length === 1 ? 'excerpt' : 'excerpts'} (not cited)</summary>{otherSources.map((source) => <SourceExcerpt key={source.ref} source={source} onOpen={onOpen} />)}</details>}
  </section>;
}

export function LocalResearchViewer({ initialSelection, onClose }: { initialSelection: ResearchSelection; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<ResearchCatalog | null>(null);
  const [selectedId, setSelectedId] = useState(initialSelection.documentId ?? '');
  const [expectedSha256, setExpectedSha256] = useState(initialSelection.expectedSha256);
  const [document, setDocument] = useState<DocumentText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sourcePane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadingCatalog(true); setError(null);
    readResearch<ResearchCatalog>('', controller.signal).then((result) => {
      if (!active) return;
      setCatalog(result);
      if (!result.documents.length) { setError('No documents are included in this local research package.'); return; }
      setSelectedId((current) => current || result.documents[0].id);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'The local research could not be loaded.'); })
      .finally(() => { if (active) setLoadingCatalog(false); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  useEffect(() => {
    if (!selectedId || !catalog) return;
    const controller = new AbortController();
    let active = true;
    setDocument(null); setLoadingDocument(true); setError(null);
    readResearch<{ document: DocumentText; snapshotId: string; notice: string }>(`/${encodeURIComponent(selectedId)}`, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result.document.id !== selectedId) throw new Error('The selected document could not be verified. Choose it again to reload.');
        if (result.snapshotId !== catalog.snapshotId) throw new Error('The research package changed while it was open. Close and reopen it to load a consistent snapshot.');
        setDocument(result.document);
        sourcePane.current?.scrollTo({ top: 0 });
      }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'The local document could not be loaded.'); })
      .finally(() => { if (active) setLoadingDocument(false); });
    return () => { active = false; controller.abort(); };
  }, [selectedId, catalog, attempt]);

  const chooseDocument = (id: string) => { setExpectedSha256(undefined); setSelectedId(id); };
  const lines = document?.text.split('\n') ?? [];
  if (document && lines.length > document.lineCount && lines.at(-1) === '') lines.pop();
  const changedSource = !!(document && expectedSha256 && document.sha256 !== expectedSha256);

  return <dialog ref={dialog} className="local-research-dialog" aria-labelledby="local-research-title" aria-describedby="local-research-notice" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="local-research-header"><div><h2 id="local-research-title">Local research</h2><p>{catalog ? `${catalog.documents.length} packaged documents` : 'Packaged documents'} · Read only</p></div><button className="btn btn--secondary" onClick={onClose} autoFocus>Close</button></header>
    <div className="local-research-notice" id="local-research-notice"><span className="local-text-badge">Local snapshot</span><p>{catalog?.notice || SNAPSHOT_NOTICE}</p></div>
    <div className="local-research-layout">
      <nav className="local-research-catalog" aria-label="Research documents">
        <span className="local-research-catalog__label">DOCUMENTS</span>
        {loadingCatalog ? <p role="status">Loading research…</p> : catalog?.documents.map((item) => <button key={item.id} className={item.id === selectedId ? 'is-selected' : ''} onClick={() => chooseDocument(item.id)} aria-current={item.id === selectedId ? 'page' : undefined}><Icon name="file" size={15} /><span>{item.title}<small>{item.lineCount} lines</small></span></button>)}
      </nav>
      <div className="local-research-document-area">
        {catalog && <div className="local-research-mobile-picker"><label htmlFor="local-research-document">Document</label><select id="local-research-document" value={selectedId} onChange={(event) => chooseDocument(event.target.value)}>{catalog.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>}
        {error && <div className="local-research-load-error" role="alert"><p>{error}</p><button className="btn btn--secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
        {loadingDocument && <p className="local-research-loading" role="status">Loading document…</p>}
        {document && <>
          <div className="local-research-document-header"><h3>{document.title}</h3><p>{document.path}</p><details className="local-research-metadata"><summary>Package details</summary><dl><dt>SHA-256</dt><dd>{document.sha256}</dd><dt>Snapshot</dt><dd>{catalog?.snapshotId}</dd></dl></details></div>
          {changedSource && <p className="local-research-warning">This packaged document has changed since the reply was saved. The original excerpt and hash remain beneath that reply.</p>}
          <div ref={sourcePane} className="local-research-document-text" tabIndex={0} aria-label={`${document.title}, read-only source text`}>
            {lines.map((line, index) => <div className="local-research-line" key={index}><span className="local-research-line-number" aria-hidden>{index + 1}</span><span>{line || '\u00a0'}</span></div>)}
          </div>
        </>}
      </div>
    </div>
  </dialog>;
}
