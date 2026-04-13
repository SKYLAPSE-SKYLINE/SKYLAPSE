import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LogOut, MapPin, Clock, Eye, Monitor, Wifi, WifiOff, Camera, Images } from "lucide-react";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
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
  senhaAlterada: boolean;
};

type ClientCamera = {
  id: string;
  nome: string;
  marca: string | null;
  modelo: string | null;
  status: string;
  ultimaCaptura: string | null;
  intervaloCaptura: number;
  streamUrl: string | null;
  localidade: { nome: string; cidade?: string | null; estado?: string | null } | null;
};

function LiveDialog({ camera, open, onClose }: { camera: ClientCamera | null; open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"snapshot" | "stream">("snapshot");
  const [streamActive, setStreamActive] = useState(false);
  const snapshotUrl = camera ? `/api/client/cameras/${camera.id}/snapshot?t=${Date.now()}` : "";
  const safeStreamUrl = camera?.streamUrl && /^https?:\/\//i.test(camera.streamUrl) ? camera.streamUrl : null;
  const liveStreamUrl = safeStreamUrl
    ? `${safeStreamUrl.replace(/\/$/, "")}/stream.html?src=camera1&mode=mse`
    : null;

  const handleClose = () => {
    setMode("snapshot");
    setStreamActive(false);
    onClose();
  };

  if (!camera) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl p-0 bg-zinc-950 border-zinc-800 gap-0 overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${camera.status === "online" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-zinc-600"}`} />
            <span className="text-sm font-medium text-white">{camera.nome}</span>
            {camera.localidade && (
              <span className="text-xs text-zinc-500">{camera.localidade.nome}</span>
            )}
          </div>
          {liveStreamUrl && (
            <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-0.5">
              <button
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === "snapshot" ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300"
                }`}
                onClick={() => { setMode("snapshot"); setStreamActive(false); }}
              >
                Snapshot
              </button>
              <button
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === "stream" ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300"
                }`}
                onClick={() => setMode("stream")}
              >
                Ao Vivo
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="relative bg-zinc-900 rounded-xl overflow-hidden">
          {mode === "stream" && liveStreamUrl ? (
            streamActive ? (
              <iframe
                src={liveStreamUrl}
                className="w-full border-0"
                style={{ height: "65vh" }}
                allow="autoplay"
                title={`Stream ao vivo — ${camera.nome}`}
                data-testid="iframe-client-live-stream"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-5" style={{ height: "65vh" }}>
                <div className="w-20 h-20 rounded-full bg-zinc-800/80 flex items-center justify-center">
                  <Monitor className="h-8 w-8 text-zinc-500" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-white/80 text-sm font-medium">Stream pausado</p>
                  <p className="text-zinc-500 text-xs max-w-xs">A transmissao consome dados. Inicie apenas quando necessario.</p>
                </div>
                <Button
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                  onClick={() => setStreamActive(true)}
                  data-testid="button-start-client-stream"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Iniciar transmissao
                </Button>
              </div>
            )
          ) : (
            <img
              src={snapshotUrl}
              alt={`Snapshot de ${camera.nome}`}
              className="w-full object-cover max-h-[65vh]"
              data-testid="img-live-snapshot"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CameraCard({ cam, onLiveClick, onGalleryClick }: {
  cam: ClientCamera;
  onLiveClick: () => void;
  onGalleryClick: () => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/50">
      {/* Thumbnail area */}
      <div className="relative aspect-[16/10] bg-zinc-800 overflow-hidden">
        {!imgError && (
          <img
            src={`/api/client/cameras/${cam.id}/thumbnail`}
            alt={cam.nome}
            loading="lazy"
            className={`h-full w-full object-cover transition-all duration-500 ${imgLoaded ? "opacity-100 scale-100" : "opacity-0 scale-105"} group-hover:scale-[1.03]`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
        {(!imgLoaded || imgError) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Camera className="h-8 w-8 text-zinc-700" />
          </div>
        )}

        {/* Status dot */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full border-2 border-black/40 ${
            cam.status === "online"
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
              : "bg-zinc-500"
          }`} />
        </div>

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end justify-center pb-4 gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onLiveClick(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors shadow-sm"
            data-testid={`button-live-${cam.id}`}
          >
            <Eye className="h-3.5 w-3.5" />
            Ao Vivo
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onGalleryClick(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-white/35 transition-colors shadow-sm"
            data-testid={`button-gallery-${cam.id}`}
          >
            <Images className="h-3.5 w-3.5" />
            Galeria
          </button>
        </div>
      </div>

      {/* Info strip */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-white truncate" data-testid={`text-camera-name-${cam.id}`}>
            {cam.nome}
          </h3>
          <div className="flex items-center gap-3 mt-0.5">
            {cam.localidade && (
              <span className="text-xs text-zinc-500 flex items-center gap-1 truncate" data-testid={`text-camera-localidade-${cam.id}`}>
                <MapPin className="h-3 w-3 shrink-0" />
                {cam.localidade.nome}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Ultima captura</p>
          <p className="text-xs text-zinc-400" data-testid={`text-camera-ultima-captura-${cam.id}`}>
            {cam.ultimaCaptura
              ? formatDistanceToNow(new Date(cam.ultimaCaptura), { addSuffix: true, locale: ptBR })
              : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ClienteDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [liveCamera, setLiveCamera] = useState<ClientCamera | null>(null);
  const [passwordDialogDone, setPasswordDialogDone] = useState(false);

  const { data: me, isLoading: meLoading } = useQuery<ClientMe>({
    queryKey: ["/api/client/me"],
  });

  const { data: cameras, isLoading: camerasLoading } = useQuery<ClientCamera[]>({
    queryKey: ["/api/client/cameras"],
    enabled: !!me,
    refetchInterval: 60_000,
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
  const onlineCount = cameras?.filter((c) => c.status === "online").length ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 dark">
      {/* Header — minimal */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/50">
        <div className="mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
          <Link href="/cliente/dashboard" className="flex items-center gap-2">
            <span className="text-lg font-bold text-white tracking-tight">
              Sky<span className="text-blue-400">Lapse</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500 hidden sm:block" data-testid="text-client-name">
              {me?.nome}
            </span>
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              data-testid="button-client-logout"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto px-6 lg:px-10 py-8 space-y-8">
        {/* Summary bar */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white" data-testid="text-client-welcome">
              Cameras
            </h1>
            {!isLoading && cameras && (
              <p className="text-sm text-zinc-500 mt-1">
                {cameras.length} camera{cameras.length !== 1 ? "s" : ""}
                {onlineCount > 0 && (
                  <> · <span className="text-emerald-400">{onlineCount} online</span></>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Camera grid */}
        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/50">
                <Skeleton className="aspect-[16/10] w-full bg-zinc-800" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3 bg-zinc-800" />
                  <Skeleton className="h-3 w-1/3 bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        ) : !cameras || cameras.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/60 flex items-center justify-center mb-4">
              <Camera className="h-7 w-7 text-zinc-600" />
            </div>
            <p className="text-white font-medium">Nenhuma camera disponivel</p>
            <p className="text-sm text-zinc-600 mt-1">Entre em contato com o suporte para mais informacoes.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {cameras.map((cam) => (
              <CameraCard
                key={cam.id}
                cam={cam}
                onLiveClick={() => setLiveCamera(cam)}
                onGalleryClick={() => navigate(`/cliente/cameras/${cam.id}/capturas`)}
              />
            ))}
          </div>
        )}
      </main>

      <LiveDialog
        camera={liveCamera}
        open={!!liveCamera}
        onClose={() => setLiveCamera(null)}
      />

      {me && !me.senhaAlterada && !passwordDialogDone && (
        <ChangePasswordDialog
          open={true}
          forceChange={true}
          onSuccess={() => {
            setPasswordDialogDone(true);
            queryClient.invalidateQueries({ queryKey: ["/api/client/me"] });
          }}
        />
      )}
    </div>
  );
}
