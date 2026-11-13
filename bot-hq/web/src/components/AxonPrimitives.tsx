import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function AxonAvatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const safe = src && (src.startsWith('/api/local/files/') || src.startsWith('/assets/'));
  return <span className="axon-avatar" style={{ width: size, height: size, fontSize: Math.max(11, size / 3) }} aria-hidden="true">{safe ? <img src={src} alt="" /> : name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>;
}
export function AxonModal({ title, onClose, children, wide = false, error }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; error?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`axon-modal${wide ? ' axon-modal--wide' : ''}`} aria-label={title} onKeyDown={event => {
    if (event.key !== 'Tab' || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]')).filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[inert]') && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden');
    const first = controls[0], last = controls.at(-1);
    if (first && last && ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first))) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><button className="axon-icon" aria-label={`Close ${title}`} onClick={onClose}><X size={19} /></button></header><div className="axon-modal-body">{error && <div className="axon-alert" role="alert">{error}</div>}{children}</div></dialog>;
}
export function AxonEmpty({ title, children }: { title: string; children: ReactNode }) { return <div className="axon-empty"><h3>{title}</h3><p>{children}</p></div>; }
