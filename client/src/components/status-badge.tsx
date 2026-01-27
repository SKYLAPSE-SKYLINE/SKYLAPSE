import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "online" | "offline" | "ativo" | "inativo" | "na_fila" | "processando" | "pronto" | "erro";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusConfig = {
    online: { label: "Online", variant: "default" as const },
    offline: { label: "Offline", variant: "destructive" as const },
    ativo: { label: "Ativo", variant: "default" as const },
    inativo: { label: "Inativo", variant: "secondary" as const },
    na_fila: { label: "Na Fila", variant: "secondary" as const },
    processando: { label: "Processando", variant: "outline" as const },
    pronto: { label: "Pronto", variant: "default" as const },
    erro: { label: "Erro", variant: "destructive" as const },
  };

  const config = statusConfig[status] || { label: status, variant: "secondary" as const };

  return (
    <Badge
      variant={config.variant}
      className={className}
      data-testid={`badge-status-${status}`}
    >
      {config.label}
    </Badge>
  );
}

interface StatusDotProps {
  status: "online" | "offline";
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === "online" 
          ? "bg-emerald-500 dark:bg-emerald-400" 
          : "bg-destructive",
        className
      )}
      data-testid={`dot-status-${status}`}
    />
  );
}
