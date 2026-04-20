import Card from '../Card';
import QRCodeCard from '../QRCodeCard';

function SectionHeader({ title, description }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border-soft)] pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] sm:text-lg">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

export default function QrTab({ branchLinks, currentJornada }) {
  return (
    <Card>
      <SectionHeader
        title="QR por sucursal"
        description="Los enlaces siguen siendo simples por sucursal. El sistema elige automáticamente el sorteo activo que corresponda a esa sucursal y fecha."
      />
      {currentJornada ? (
        <div className="mb-4 rounded-[20px] border border-[var(--accent-strong)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">
          Jornada activa: {currentJornada.label}. El QR es fijo por sucursal y sólo funciona dentro del horario habilitado.
        </div>
      ) : (
        <div className="mb-4 rounded-[20px] border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-500">
          No hay una jornada activa en este momento. El QR sigue siendo fijo, pero la app no permitirá registrar fuera de horario.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {branchLinks.map(({ branch, url }) => (
          <QRCodeCard branch={branch} disabled={!url} key={branch} url={url} />
        ))}
      </div>
    </Card>
  );
}
