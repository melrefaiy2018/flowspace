function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-sm)] bg-[var(--surface2)] animate-pulse ${className ?? ''}`}
    />
  );
}

export default function BriefingSkeleton() {
  return (
    <div className="kanban-board h-full">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`kanban-column${i === 3 ? ' kanban-column--wide' : ''}`}>
          <div className="kanban-column-header">
            <Shimmer className="h-4 w-24" />
          </div>
          <div className="kanban-column-body p-3 flex flex-col gap-2">
            {[1, 2, 3].map((j) => (
              <div key={j} className="rounded-[14px] border border-white/5 bg-white/[0.02] p-3">
                <Shimmer className="h-4 w-3/4 mb-2" />
                <Shimmer className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
