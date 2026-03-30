import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, LogOut, MapPin, Clock, Wifi, WifiOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ClientMe = {
  id: string;
  nome: string;
  email: string;
  clienteId: string | null;
  cameraIds: string[];
};

type ClientCamera = {
  id: string;
  nome: string;
  marca: string | null;
  modelo: string | null;
  status: string;
  ultimaCaptura: string | null;
  intervaloCaptura: number;
  localidade: { nome: string; cidade?: string | null; estado?: string | null } | null;
};

function CameraCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-video w-full" />
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </CardContent>
    </Card>
  );
}

function SnapshotDialog({ camera, open, onClose }: { camera: ClientCamera | null; open: boolean; onClose: () => void }) {
  const snapshotUrl = camera ? `/api/client/cameras/${camera.id}/snapshot?t=${Date.now()}` : "";
  if (!camera) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            {camera.nome} — Imagem ao Vivo
          </DialogTitle>
        </DialogHeader>
        <div className="relative bg-black">
          <img
            src={snapshotUrl}
            alt={`Snapshot ao vivo de ${camera.nome}`}
            className="w-full object-contain max-h-[70vh]"
            data-testid="img-live-snapshot"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <div className="px-6 py-3 flex items-center justify-between text-sm text-muted-foreground border-t">
          <span>{camera.localidade?.nome || "—"}</span>
          <Badge variant={camera.status === "online" ? "default" : "secondary"}>
            {camera.status === "online" ? (
              <><Wifi className="h-3 w-3 mr-1" />Online</>
            ) : (
              <><WifiOff className="h-3 w-3 mr-1" />Offline</>
            )}
          </Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClienteDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [snapshotCamera, setSnapshotCamera] = useState<ClientCamera | null>(null);

  const { data: me, isLoading: meLoading } = useQuery<ClientMe>({
    queryKey: ["/api/client/me"],
  });

  const { data: cameras, isLoading: camerasLoading } = useQuery<ClientCamera[]>({
    queryKey: ["/api/client/cameras"],
    enabled: !!me,
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/client/logout"),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
    onError: () => {
      toast({ title: "Erro ao sair", variant: "destructive" });
    },
  });

  const isLoading = meLoading || camerasLoading;

  function formatUltimaCaptura(ts: string | null) {
    if (!ts) return "Nunca capturado";
    try {
      return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ptBR });
    } catch {
      return "—";
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Camera className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight">SKYLAPSE</span>
            <p className="text-xs text-muted-foreground leading-none">Portal do Cliente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block" data-testid="text-client-name">
            {me?.nome}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-client-logout"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Sair
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-client-welcome">
            Olá, {me?.nome?.split(" ")[0] ?? "…"}!
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isLoading
              ? "Carregando câmeras…"
              : `Você tem acesso a ${cameras?.length ?? 0} câmera${(cameras?.length ?? 0) !== 1 ? "s" : ""}.`}
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => <CameraCardSkeleton key={i} />)}
          </div>
        ) : !cameras || cameras.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Camera className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Nenhuma câmera disponível no momento.</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Entre em contato com o suporte para mais informações.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cameras.map((cam) => (
              <Card
                key={cam.id}
                className="overflow-hidden flex flex-col"
                data-testid={`card-camera-${cam.id}`}
              >
                <div
                  className="relative aspect-video bg-muted flex items-center justify-center cursor-pointer group"
                  onClick={() => setSnapshotCamera(cam)}
                  data-testid={`button-snapshot-${cam.id}`}
                >
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Eye className="h-8 w-8 text-white" />
                    <span className="text-white text-sm ml-2 font-medium">Ver ao vivo</span>
                  </div>
                  <Camera className="h-10 w-10 text-muted-foreground/30" />
                </div>

                <CardContent className="p-4 space-y-2 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-tight" data-testid={`text-camera-name-${cam.id}`}>
                      {cam.nome}
                    </h3>
                    <Badge
                      variant={cam.status === "online" ? "default" : "secondary"}
                      className="shrink-0 text-xs"
                      data-testid={`badge-camera-status-${cam.id}`}
                    >
                      {cam.status === "online" ? (
                        <><Wifi className="h-3 w-3 mr-1" />Online</>
                      ) : (
                        <><WifiOff className="h-3 w-3 mr-1" />Offline</>
                      )}
                    </Badge>
                  </div>

                  {cam.localidade && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span data-testid={`text-camera-localidade-${cam.id}`}>
                        {cam.localidade.nome}
                        {cam.localidade.cidade ? `, ${cam.localidade.cidade}` : ""}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span data-testid={`text-camera-ultima-captura-${cam.id}`}>
                      {formatUltimaCaptura(cam.ultimaCaptura)}
                    </span>
                  </div>
                </CardContent>

                <CardFooter className="p-3 pt-0 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => setSnapshotCamera(cam)}
                    data-testid={`button-live-${cam.id}`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Ao Vivo
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 text-xs"
                    asChild
                  >
                    <Link href={`/cliente/cameras/${cam.id}/capturas`} data-testid={`button-gallery-${cam.id}`}>
                      <Camera className="h-3 w-3 mr-1" />
                      Galeria
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>

      <SnapshotDialog
        camera={snapshotCamera}
        open={!!snapshotCamera}
        onClose={() => setSnapshotCamera(null)}
      />
    </div>
  );
}
