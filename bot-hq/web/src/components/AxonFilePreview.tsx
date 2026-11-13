import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { fileSize, type LocalFile } from '../lib/axon';
import { AxonModal } from './AxonPrimitives';
export function AxonFilePreview({ file, onClose }: { file: LocalFile; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const url = `/api/local/files/${encodeURIComponent(file.id)}/content`;
  useEffect(() => {
    if (!file.deliverySupported) return;
    const controller = new AbortController();
    void fetch(url, { credentials: 'include', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('This stored file could not be read. Try reopening it from Library.');
      const content = await response.text(); if (!controller.signal.aborted) setText(content);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The preview could not be loaded.'); });
    return () => controller.abort();
  }, [file.id, file.deliverySupported, url]);
  return <AxonModal title={file.name} wide onClose={onClose} error={error}><p className="axon-caption">{file.mime} · {fileSize(file.size)} · Original stored file</p>{file.deliverySupported ? text === null ? <p role="status">Loading text preview…</p> : <pre className="axon-text-preview">{text}</pre> : file.mime.startsWith('image/') ? <img className="axon-file-preview" src={url} alt={file.name} onError={() => setError('This image could not be displayed. Download preserves the original file.')} /> : file.mime.startsWith('video/') ? <video controls className="axon-file-preview" src={url} onError={() => setError('This video format could not be played by this browser. Download the original to use a compatible player.')} /> : file.mime.startsWith('audio/') ? <audio controls src={url} onError={() => setError('This audio format could not be played by this browser. Download the original to use a compatible player.')} /> : <p className="axon-help">This format has no local preview. Download the original file to view it; its stored bytes are preserved.</p>}<a className="axon-button" href={`/api/local/files/${file.id}/download`} download={file.name}><Download size={16} />Download original</a></AxonModal>;
}
