/** The Nordlane ring mark from the public site, drawn flat for the admin. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-md bg-adm-ink ${className}`}>
      <span className="size-3 rounded-full border-[2.5px] border-[#168bff] border-r-transparent" />
    </span>
  );
}
