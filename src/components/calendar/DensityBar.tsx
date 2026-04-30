interface Props {
  morningLoad: number;
  middayLoad: number;
  afternoonLoad: number;
  eveningLoad: number;
}

function loadColor(load: number): string {
  if (load >= 0.9) return 'var(--error)';
  if (load >= 0.7) return 'var(--warn)';
  if (load >= 0.4) return 'var(--text-faint)';
  return 'var(--border2)';
}

interface BandProps {
  label: string;
  load: number;
}

function Band({ label, load }: BandProps) {
  const pct = Math.round(load * 100);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="h-[5px] rounded-full bg-[var(--surface3)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: loadColor(load) }}
        />
      </div>
      <span className="text-[8px] text-[var(--text-faint)]/60 leading-none">{label}</span>
    </div>
  );
}

export default function DensityBar({ morningLoad, middayLoad, afternoonLoad, eveningLoad }: Props) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Band label="AM" load={morningLoad} />
      <Band label="Mid" load={middayLoad} />
      <Band label="PM" load={afternoonLoad} />
      {eveningLoad > 0.1 && <Band label="Eve" load={eveningLoad} />}
    </div>
  );
}
