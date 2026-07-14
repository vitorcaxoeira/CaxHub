interface AvatarProps {
  nome: string;
  fotoUrl?: string | null;
  size?: "sm" | "md";
}

export function Avatar({ nome, fotoUrl, size = "md" }: AvatarProps) {
  const dimension = size === "sm" ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm";
  const initials = nome
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt={nome}
        className={`${dimension} flex-none rounded-full border border-border object-cover`}
      />
    );
  }

  return (
    <div
      className={`${dimension} flex flex-none items-center justify-center rounded-full border border-border bg-primary font-medium text-primary-foreground`}
    >
      {initials}
    </div>
  );
}
