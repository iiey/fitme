import clsx from "clsx";

export function Card({
  title,
  children,
  className,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={clsx("card p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
