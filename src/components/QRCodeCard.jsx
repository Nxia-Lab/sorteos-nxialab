import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QRCodeCard({ branch, url }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: {
        dark: '#00FFFF',
        light: '#0a0a0a',
      },
    }).then((value) => {
      if (!cancelled) {
        setSrc(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return;
      }
    } catch {
      // Fallback below.
    }

    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  return (
    <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel)] p-4 sm:p-5">
      <p className="text-sm font-medium text-[var(--text-primary)] sm:text-base">{branch}</p>
      <div className="mt-4 flex justify-center rounded-[20px] border border-[var(--border-soft)] bg-[var(--panel-muted)] p-3 sm:p-4">
        {src ? <img alt={`QR ${branch}`} className="h-36 w-36 rounded-xl sm:h-44 sm:w-44" src={src} /> : <div className="h-36 w-36 animate-pulse rounded-xl bg-[var(--accent-soft)] sm:h-44 sm:w-44" />}
      </div>
      <p className="mt-4 break-all text-xs leading-5 text-[var(--text-secondary)]">{url}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          className="rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent-strong)] transition hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
          onClick={copyLink}
          type="button"
        >
          Copiar link
        </button>
        <a
          className="rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
          href={url}
          rel="noreferrer"
          target="_blank"
        >
          Abrir
        </a>
      </div>
    </div>
  );
}
